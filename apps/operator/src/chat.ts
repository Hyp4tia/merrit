import { brand, generateBatch } from "./actions.ts";
import type { ChatMessageRow } from "./db.ts";
import { addChatMessage, listChat } from "./db.ts";
import { DEFAULT_ANGLES } from "./generate.ts";
import { chatJson } from "./llm.ts";

export type ChatAction = "draft" | "answer" | "clarify";

interface RouterReply {
  action?: ChatAction;
  count?: number;
  reply?: string;
}

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  body: string;
  action?: string;
  created: number;
  at: string;
}

function toTurn(row: ChatMessageRow): ChatTurn {
  const meta = (row.meta ?? {}) as { action?: string; created?: number };
  return {
    id: row.id,
    role: row.role,
    body: row.body,
    action: meta.action,
    created: meta.created ?? 0,
    at: row.created_at.toISOString(),
  };
}

export async function chatHistory(client: string, bot: string): Promise<ChatTurn[]> {
  return (await listChat(client, bot)).map(toTurn);
}

function systemPrompt(clientSlug: string, botName: string): string {
  const brandFile = brand(clientSlug);
  return [
    `You are ${botName}, the content operator for ${brandFile.name}, ${brandFile.category}.`,
    `Voice: ${brandFile.voice.tone}. ${brandFile.voice.claimStyle}. Short sentences.`,
    `Audience: ${brandFile.audience}.`,
    `Banned phrasing: ${brandFile.banned.join("; ")}.`,
    "Commercial terms that exist, and no others:",
    ...brandFile.offers.map((offer) => `- ${offer}`),
    ...(brandFile.commitments.length
      ? [
          "Promises you may make, and no others:",
          ...brandFile.commitments.map((promise) => `- ${promise}`),
        ]
      : [
          "You may not promise a response time, turnaround, availability or guarantee of any kind.",
        ]),
    "",
    "You draft posts into an approval queue that a human reviews. You cannot publish. Publishing is",
    "disabled in this build, so never offer to post, schedule or send anything to a platform.",
    "",
    "Decide what the owner is asking for:",
    '- "draft": they want new posts written. Set count between 1 and 7.',
    '- "answer": they asked a question you can answer from the brand file or the queue.',
    '- "clarify": the request is ambiguous. Ask one short question.',
    "",
    'Reply with JSON only: {"action":"draft|answer|clarify","count":<1-7>,"reply":"<your message, 1-3 short sentences>"}',
  ].join("\n");
}

export interface SendResult {
  action: ChatAction;
  reply: string;
  created: number;
  flagged: number;
  failures: Array<{ angle: string; error: string }>;
  messages: ChatTurn[];
}

/**
 * One message in, one bot turn out. The bot can only draft into the queue: the publish path is
 * not reachable from here, by construction.
 */
export async function sendChatMessage(input: {
  client: string;
  bot: string;
  botName: string;
  account: string | null;
  message: string;
}): Promise<SendResult> {
  const text = input.message.trim();
  if (!text) throw new Error("An empty message cannot be sent");

  await addChatMessage({
    client: input.client,
    bot: input.bot,
    account: input.account,
    role: "user",
    body: text,
  });

  const { value } = await chatJson<RouterReply>(
    [
      { role: "system", content: systemPrompt(input.client, input.botName) },
      { role: "user", content: text },
    ],
    700,
  );

  const action: ChatAction =
    value.action === "draft" || value.action === "answer" || value.action === "clarify"
      ? value.action
      : "answer";
  const requested = Number(value.count ?? 3);
  const count = Math.min(Math.max(Number.isFinite(requested) ? requested : 3, 1), 7);
  let reply = (value.reply ?? "").trim() || "Understood.";
  let created = 0;
  let flagged = 0;
  let failures: Array<{ angle: string; error: string }> = [];

  if (action === "draft") {
    const result = await generateBatch(count, DEFAULT_ANGLES, input.client);
    created = result.created.length;
    flagged = result.flagged.length;
    failures = result.failures;
    reply = [
      reply,
      created > 0 ? `Queued ${created} draft${created === 1 ? "" : "s"} for review.` : "",
      flagged > 0
        ? `${flagged} came back flagged, so a human has to read ${flagged === 1 ? "it" : "them"}.`
        : "",
      failures.length > 0
        ? `Failed: ${failures.map((failure) => `${failure.angle} (${failure.error.split("\n")[0]})`).join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  await addChatMessage({
    client: input.client,
    bot: input.bot,
    account: input.account,
    role: "assistant",
    body: reply,
    meta: { action, created, flagged },
  });

  return {
    action,
    reply,
    created,
    flagged,
    failures,
    messages: await chatHistory(input.client, input.bot),
  };
}
