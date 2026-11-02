import { createHash } from "node:crypto";
import type { Brand } from "./brand.ts";
import type { Bot, ClientEntry } from "./clients.ts";
import { clientBrand, findBot, findBotByRole } from "./clients.ts";
import type { DelegationRow } from "./db.ts";
import {
  addEvent,
  addMessage,
  ensureThread,
  getItem,
  getThread,
  insertItem,
  linkDelegationItem,
  listDelegations,
  listMessages,
  listThreads,
  updateBody,
  upsertDelegation,
} from "./db.ts";
import type { Angle } from "./generate.ts";
import { generateDraft, PROMPT_VERSION } from "./generate.ts";
import { chatJson } from "./llm.ts";

export interface MessageView {
  id: number;
  role: "user" | "assistant" | "delegation";
  bot: string;
  content: string;
  itemId: string | null;
  delegationId: string | null;
  at: string;
}

export interface DelegationView {
  id: string;
  fromBot: string;
  toBot: string;
  request: string;
  itemId: string | null;
  status: string;
  at: string;
}

export interface ThreadView {
  threadId: string;
  bot: Bot;
  messages: MessageView[];
  /** Delegations this bot sent or received. The card appears in both threads from the same row. */
  delegations: DelegationView[];
}

export interface ThreadSummary {
  threadId: string | null;
  bot: Bot;
  messageCount: number;
  lastMessageAt: string | null;
}

function messageView(row: Awaited<ReturnType<typeof listMessages>>[number]): MessageView {
  return {
    id: row.id,
    role: row.role,
    bot: row.bot,
    content: row.content,
    itemId: row.item_id,
    delegationId: row.delegation_id,
    at: row.created_at.toISOString(),
  };
}

function delegationView(row: DelegationRow): DelegationView {
  return {
    id: row.id,
    fromBot: row.from_bot,
    toBot: row.to_bot,
    request: row.request,
    itemId: row.item_id,
    status: row.status,
    at: row.created_at.toISOString(),
  };
}

/** Every declared bot gets a row in the rail, with or without a thread yet. */
export async function listThreadSummaries(client: ClientEntry): Promise<ThreadSummary[]> {
  const threads = await listThreads(client.slug);
  const messages = await Promise.all(threads.map((thread) => listMessages(thread.id)));

  return client.bots.map((bot) => {
    const index = threads.findIndex((thread) => thread.bot === bot.id);
    const thread = index === -1 ? undefined : threads[index];
    const threadMessages = index === -1 ? [] : (messages[index] ?? []);
    const last = threadMessages[threadMessages.length - 1];
    return {
      threadId: thread?.id ?? null,
      bot,
      messageCount: threadMessages.length,
      lastMessageAt: last?.created_at.toISOString() ?? null,
    };
  });
}

export async function threadView(client: ClientEntry, botId: string): Promise<ThreadView> {
  const bot = findBot(client, botId);
  if (!bot.active) {
    throw new Error(
      `${bot.name} is declared but not active in this build. Nothing was routed to it.`,
    );
  }

  const thread = await ensureThread(client.slug, bot.id);
  const [messages, delegations] = await Promise.all([
    listMessages(thread.id),
    listDelegations(client.slug),
  ]);

  return {
    threadId: thread.id,
    bot,
    messages: messages.map(messageView),
    delegations: delegations
      .filter((row) => row.from_bot === bot.id || row.to_bot === bot.id)
      .map(delegationView),
  };
}

interface LeadDecision {
  action?: "delegate" | "answer";
  to?: string;
  request?: string;
  reply?: string;
}

function leadPrompt(brandFile: Brand, bot: Bot): string {
  return [
    `You are ${bot.name}, the lead for ${brandFile.name}.`,
    `You do not write posts. You route work and report outcomes.`,
    `The team: copywriter drafts and revises posts. Strategist, designer, analyst and ads are not`,
    "active in this build, so never route to them.",
    "",
    "Decide what the owner wants:",
    '- "delegate": they want a post written or changed. Put the finished instruction in request.',
    '- "answer": they asked something you can answer. Reply in one or two short sentences.',
    "",
    `Voice: ${brandFile.voice.tone}. No em dashes. No promises about publishing: publishing is`,
    "disabled and no post can go out from here.",
    "",
    'Reply with JSON only: {"action":"delegate|answer","to":"copywriter","request":"<instruction>","reply":"<one or two sentences>"}',
  ].join("\n");
}

/**
 * The copywriter is the only bot that writes. It drafts through the same pipeline as the queue:
 * brand file, brand rules, commercial guard, one regeneration.
 */
async function draftFor(
  brandFile: Brand,
  request: string,
  previous?: { body: string; language: "en" | "ar"; angle: string },
) {
  const angle: Angle = previous
    ? {
        key: previous.angle,
        brief: `Revise the current draft. Instruction: ${request}`,
        language: previous.language,
      }
    : { key: "delegated-request", brief: request, language: "en" };

  const draft = await generateDraft(brandFile, angle, {
    rejectReason: previous ? request : null,
    previousBody: previous?.body ?? null,
  });

  return draft;
}

function delegationKey(clientSlug: string, from: string, to: string, request: string): string {
  const normalized = request.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update([clientSlug, from, to, normalized].join("|")).digest("hex");
}

export interface TurnResult {
  reply: string;
  messages: MessageView[];
  delegation: DelegationView | null;
  itemId: string | null;
}

async function leadTurn(client: ClientEntry, bot: Bot, text: string): Promise<TurnResult> {
  const thread = await ensureThread(client.slug, bot.id);
  const { value } = await chatJson<LeadDecision>(
    [
      { role: "system", content: leadPrompt(clientBrand(client), bot) },
      { role: "user", content: text },
    ],
    700,
  );

  if (value.action !== "delegate") {
    const reply = (value.reply ?? "").trim() || "Understood.";
    await addMessage({
      threadId: thread.id,
      client: client.slug,
      bot: bot.id,
      role: "assistant",
      content: reply,
    });
    return { reply, messages: await messageViews(thread.id), delegation: null, itemId: null };
  }

  const target = findBotByRole(client, value.to ?? "copywriter");
  if (!target) {
    throw new Error(
      `No bot with role "${value.to ?? "copywriter"}" is declared, so nothing was routed.`,
    );
  }
  if (!target.active) {
    throw new Error(
      `${target.name} is declared but not active in this build, so nothing was routed to it.`,
    );
  }

  const request = (value.request ?? text).trim();
  // Keyed on what the owner asked, not on the model's paraphrase: the model rewrites the same
  // request differently between runs, and a retry must still resolve to one delegation and one item.
  const key = delegationKey(client.slug, bot.id, target.id, text);
  const { delegation, created } = await upsertDelegation({
    client: client.slug,
    fromBot: bot.id,
    toBot: target.id,
    request,
    idempotencyKey: key,
  });

  let current = delegation;
  let itemId = delegation.item_id;
  if (!itemId) {
    const brandFile = clientBrand(client);
    const draft = await draftFor(brandFile, request);
    const item = await insertItem({
      client: brandFile.slug,
      language: draft.language,
      angle: draft.angleSummary,
      body: draft.body,
      model: draft.model,
      promptVersion: PROMPT_VERSION,
      attempts: draft.attempts,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    });
    itemId = item.id;
    current = await linkDelegationItem(delegation.id, item.id);
  }

  // The card is written once. A retry must not duplicate the copywriter's thread.
  if (created) {
    const copyThread = await ensureThread(client.slug, target.id);
    await addMessage({
      threadId: copyThread.id,
      client: client.slug,
      bot: target.id,
      role: "delegation",
      content: request,
      itemId,
      delegationId: delegation.id,
    });
    const item = itemId ? await getItem(itemId) : null;
    if (item) {
      await addMessage({
        threadId: copyThread.id,
        client: client.slug,
        bot: target.id,
        role: "assistant",
        content: item.body,
        itemId,
        delegationId: delegation.id,
      });
    }
  }

  const reply = created
    ? `${(value.reply ?? "").trim() || `Sent that to ${target.name}.`} The draft is in the queue as one item, waiting for your review.`
    : `That request is already with ${target.name}. I did not create a second draft.`;

  await addMessage({
    threadId: thread.id,
    client: client.slug,
    bot: bot.id,
    role: "assistant",
    content: reply,
    itemId,
    delegationId: delegation.id,
  });

  return {
    reply,
    messages: await messageViews(thread.id),
    delegation: delegationView(current),
    itemId,
  };
}

async function copywriterTurn(client: ClientEntry, bot: Bot, text: string): Promise<TurnResult> {
  const thread = await ensureThread(client.slug, bot.id);
  const messages = await listMessages(thread.id);
  const linked = [...messages].reverse().find((message) => message.item_id)?.item_id ?? null;

  if (!linked) {
    const reply = "Nothing is assigned to me yet. Ask the lead for a post and it will land here.";
    await addMessage({
      threadId: thread.id,
      client: client.slug,
      bot: bot.id,
      role: "assistant",
      content: reply,
    });
    return { reply, messages: await messageViews(thread.id), delegation: null, itemId: null };
  }

  const item = await getItem(linked);
  if (!item) throw new Error(`Item ${linked} no longer exists`);

  // A copywriter reply is a revision instruction against the same item: one item, edited in place.
  const draft = await draftFor(clientBrand(client), text, {
    body: item.body,
    language: item.language,
    angle: item.angle,
  });
  await updateBody(item.id, draft.body);
  await addEvent(item.id, "revised", text);

  const reply = `Revised. Still one item, now ${draft.body.trim().length} characters, waiting in the queue for your review.`;
  await addMessage({
    threadId: thread.id,
    client: client.slug,
    bot: bot.id,
    role: "assistant",
    content: draft.body,
    itemId: item.id,
  });
  await addMessage({
    threadId: thread.id,
    client: client.slug,
    bot: bot.id,
    role: "assistant",
    content: reply,
    itemId: item.id,
  });

  return { reply, messages: await messageViews(thread.id), delegation: null, itemId: item.id };
}

async function messageViews(threadId: string): Promise<MessageView[]> {
  return (await listMessages(threadId)).map(messageView);
}

export async function postToBot(
  client: ClientEntry,
  botId: string,
  content: string,
): Promise<TurnResult> {
  const text = content.trim();
  if (!text) throw new Error("An empty message cannot be sent");

  const bot = findBot(client, botId);
  if (!bot.active) {
    throw new Error(
      `${bot.name} is declared but not active in this build. Nothing was routed to it.`,
    );
  }

  const thread = await ensureThread(client.slug, bot.id);
  await addMessage({
    threadId: thread.id,
    client: client.slug,
    bot: bot.id,
    role: "user",
    content: text,
  });

  if (bot.role === "lead") return leadTurn(client, bot, text);
  if (bot.role === "copywriter") return copywriterTurn(client, bot, text);

  // Any other active role answers without touching the queue.
  const reply = `${bot.name} has no work defined in this build, so nothing was created.`;
  await addMessage({
    threadId: thread.id,
    client: client.slug,
    bot: bot.id,
    role: "assistant",
    content: reply,
  });
  return { reply, messages: await messageViews(thread.id), delegation: null, itemId: null };
}

/** Thin internal delegate call, used by tests and future bots. Idempotent by request. */
export async function delegate(input: {
  client: ClientEntry;
  fromBotId: string;
  toBotId: string;
  request: string;
}): Promise<{ delegation: DelegationView; itemId: string | null; created: boolean }> {
  const from = findBot(input.client, input.fromBotId);
  const to = findBot(input.client, input.toBotId);
  if (!from.active) throw new Error(`${from.name} is declared but not active in this build.`);
  if (!to.active) throw new Error(`${to.name} is declared but not active in this build.`);

  const request = input.request.trim();
  if (!request) throw new Error("A delegation needs a request");

  const key = delegationKey(input.client.slug, from.id, to.id, request);
  const { delegation, created } = await upsertDelegation({
    client: input.client.slug,
    fromBot: from.id,
    toBot: to.id,
    request,
    idempotencyKey: key,
  });

  let current = delegation;
  let itemId = delegation.item_id;
  if (!itemId) {
    const brandFile = clientBrand(input.client);
    const draft = await draftFor(brandFile, request);
    const item = await insertItem({
      client: brandFile.slug,
      language: draft.language,
      angle: draft.angleSummary,
      body: draft.body,
      model: draft.model,
      promptVersion: PROMPT_VERSION,
      attempts: draft.attempts,
      promptTokens: draft.promptTokens,
      completionTokens: draft.completionTokens,
    });
    itemId = item.id;
    current = await linkDelegationItem(delegation.id, item.id);
  }

  return { delegation: delegationView(current), itemId, created };
}

export async function threadForBot(client: ClientEntry, botId: string) {
  return getThread(client.slug, (await ensureThread(client.slug, botId)).id);
}
