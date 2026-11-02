import type { Language } from "./brand.ts";
import type { ClientEntry, ResolvedAccount } from "./clients.ts";
import { clientBrand, findClient, loadClients } from "./clients.ts";
import { checkCommercialTerms, extractCommercialFacts } from "./commercial.ts";
import { config } from "./config.ts";
import type { ApprovalItem, ItemStatus } from "./db.ts";
import {
  addEvent,
  clientCounts,
  getEvents,
  getItem,
  getLinkedInToken,
  insertItem,
  listItems,
  setStatus,
  updateBody,
} from "./db.ts";
import type { Angle } from "./generate.ts";
import { BrandReviewRequired, DEFAULT_ANGLES, generateDraft, PROMPT_VERSION } from "./generate.ts";
import type { Kit } from "./kit.ts";
import { buildKit } from "./kit.ts";
import { LinkedInError, publishPost } from "./publish-linkedin.ts";
import type { Violation } from "./validate.ts";
import { validatePost } from "./validate.ts";

export function clients(): ClientEntry[] {
  return loadClients(config.clientsFile);
}

export function brand(slug: string = config.clientSlug) {
  return clientBrand(findClient(clients(), slug));
}

export interface ClientSummary extends ClientEntry {
  counts: Record<string, number>;
  /** Drafts waiting on a human. This is the number the left rail shows. */
  needsReview: number;
  /** Accounts with the runtime state resolved, so the UI never guesses what is usable. */
  accounts: ResolvedAccount[];
}

/**
 * An account is connected only if the registry says so AND we hold credentials for it. A page
 * account is never connected while Community Management API approval is missing, and nothing
 * here substitutes the personal profile for it.
 */
export async function resolveAccounts(client: ClientEntry): Promise<ResolvedAccount[]> {
  const token = await getLinkedInToken();
  const tokenUsable = Boolean(token?.access_token && token.person_urn);

  return client.accounts.map((account) => {
    // Permission comes from the registry. Connectivity is derived here, from token presence, so a
    // static "connected" can never contradict the system.
    if (account.permission === "blocked") {
      return {
        ...account,
        connected: false,
        reason:
          account.note ||
          "This account is not permitted to post in this build. See the client registry for the reason.",
      };
    }
    return {
      ...account,
      connected: tokenUsable,
      reason: tokenUsable
        ? ""
        : "No LinkedIn token on file. Authorize the account before it can post.",
    };
  });
}

export async function clientSummaries(): Promise<ClientSummary[]> {
  const counts = await clientCounts();
  const summaries: ClientSummary[] = [];
  for (const client of clients()) {
    const slate = counts[client.slug] ?? {};
    summaries.push({
      ...client,
      counts: slate,
      needsReview: slate.pending ?? 0,
      accounts: await resolveAccounts(client),
    });
  }
  return summaries;
}

export interface BatchResult {
  created: ApprovalItem[];
  /** Drafts that invented commercial terms twice: queued, but flagged for a human to judge. */
  flagged: ApprovalItem[];
  failures: Array<{ angle: string; error: string }>;
}

export async function generateBatch(
  count: number,
  angles: Angle[] = DEFAULT_ANGLES,
  clientSlug: string = config.clientSlug,
): Promise<BatchResult> {
  const brandFile = brand(clientSlug);
  const wanted = angles.slice(0, count);
  const created: ApprovalItem[] = [];
  const flagged: ApprovalItem[] = [];
  const failures: BatchResult["failures"] = [];

  // Sequential on purpose: one failure should not lose the whole batch, and a retry storm
  // against a cheap endpoint helps nobody.
  for (const angle of wanted) {
    try {
      const draft = await generateDraft(brandFile, angle);
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
      created.push(item);
    } catch (error) {
      // A commercial-terms violation that survived one regeneration is not garbage: queue it
      // flagged, so the owner sees the exact claim instead of a silent gap in the batch.
      if (error instanceof BrandReviewRequired) {
        const item = await insertItem({
          client: brandFile.slug,
          language: error.draft.language,
          angle: error.draft.angleSummary,
          body: error.draft.body,
          model: error.draft.model,
          promptVersion: PROMPT_VERSION,
          attempts: error.draft.attempts,
          promptTokens: error.draft.promptTokens,
          completionTokens: error.draft.completionTokens,
          reviewReason: error.message,
        });
        flagged.push(item);
        continue;
      }
      failures.push({
        angle: angle.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { created, flagged, failures };
}

export async function approve(id: string): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (item.status !== "pending")
    throw new Error(`Item is ${item.status}, only a pending draft can be approved`);
  const updated = await setStatus(id, "approved");
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

export async function schedule(id: string, when: Date): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (!["pending", "approved"].includes(item.status))
    throw new Error(`Item is ${item.status}, cannot schedule`);
  const updated = await setStatus(id, "scheduled", { scheduled_for: when });
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

export interface RejectResult {
  rejected: ApprovalItem;
  replacement: ApprovalItem | null;
  error: string | null;
}

// Rejection is not a dead end: the reason goes straight back into a fresh draft for the
// same angle, so the owner keeps iterating instead of writing it themselves.
export async function rejectAndRegenerate(id: string, reason: string): Promise<RejectResult> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A rejection needs a reason, it drives the regeneration");

  const rejected = await setStatus(id, "rejected", { reject_reason: trimmed });
  if (!rejected) throw new Error(`No item ${id}`);

  const brandFile = brand();
  const angle: Angle = {
    key: item.angle,
    brief: item.angle,
    language: item.language as Language,
  };

  try {
    const draft = await generateDraft(brandFile, angle, {
      rejectReason: trimmed,
      previousBody: item.body,
    });
    const replacement = await insertItem({
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
    await addEvent(replacement.id, "regenerated-from", id);
    return { rejected, replacement, error: null };
  } catch (error) {
    if (error instanceof BrandReviewRequired) {
      const item = await insertItem({
        client: brandFile.slug,
        language: error.draft.language,
        angle: error.draft.angleSummary,
        body: error.draft.body,
        model: error.draft.model,
        promptVersion: PROMPT_VERSION,
        attempts: error.draft.attempts,
        promptTokens: error.draft.promptTokens,
        completionTokens: error.draft.completionTokens,
        reviewReason: error.message,
      });
      await addEvent(item.id, "regenerated-from", id);
      return { rejected, replacement: item, error: null };
    }
    return {
      rejected,
      replacement: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DryRunPayload {
  itemId: string;
  channel: string;
  language: string;
  body: string;
  accountId: string;
  accountLabel: string;
  authorUrn: string;
  kitPath: string;
  wouldPostTo: string;
}

export interface PublishResult {
  mode: "api" | "manual" | "dry-run";
  item: ApprovalItem;
  url?: string;
  kit?: Kit;
  detail?: string;
  /** Exactly what a real publish would send. Present only for a dry run. */
  payload?: DryRunPayload;
}

// manual means a human already approved it and the API path failed, so retrying after the
// credentials or permissions are fixed is legitimate. Nothing else can reach publish.
const PUBLISHABLE: ItemStatus[] = ["approved", "scheduled", "manual"];

// Publishing is gated on a human approval that already happened. There is no path here
// that posts an unapproved draft.
export async function publishApproved(
  id: string,
  options: { dryRun?: boolean; accountId?: string } = {},
): Promise<PublishResult> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (!PUBLISHABLE.includes(item.status)) {
    throw new Error(`Item is ${item.status}. Only an approved draft can publish.`);
  }

  const client = findClient(clients(), item.client);
  const accounts = await resolveAccounts(client);
  const dryRun = options.dryRun ?? config.dryRun;

  // A named account is honoured exactly or refused. With no name, prefer a connected account and
  // otherwise the first one with permission, because a rehearsal does not need credentials. A
  // blocked account is never a candidate, so nothing falls back to a profile that may not post.
  const chosen = options.accountId
    ? accounts.find((account) => account.id === options.accountId)
    : (accounts.find((account) => account.connected) ??
      accounts.find((account) => account.permission === "granted"));

  if (!chosen) {
    const reasons = accounts.map((account) => `${account.label}: ${account.reason}`).join(" ");
    throw new Error(
      options.accountId
        ? `Unknown account "${options.accountId}" for ${client.slug}.`
        : `No usable account for ${client.slug}. ${reasons}`,
    );
  }
  if (chosen.permission !== "granted") {
    throw new Error(`${chosen.label} cannot post. ${chosen.reason}`);
  }
  // Only a real publish needs a live credential. A dry run sends nothing, so blocking it on a
  // token would hide the payload behind a promise it never makes.
  if (!dryRun && !chosen.connected) {
    throw new Error(`${chosen.label} is not connected. ${chosen.reason}`);
  }

  // A dry run stops before the POST. It builds the kit and moves the item to its own state, so
  // a rehearsal can never be read as a publication.
  if (dryRun) {
    const kit = buildKit(item);
    const token = await getLinkedInToken();
    const payload: DryRunPayload = {
      itemId: item.id,
      channel: item.channel,
      language: item.language,
      body: item.body,
      accountId: chosen.id,
      accountLabel: chosen.label,
      // Never invent an author. If the account has no token, the payload says so in the field
      // that will be sent, so a rehearsal cannot be mistaken for a ready-to-publish request.
      authorUrn: chosen.connected
        ? (token?.person_urn ?? "unresolved (account not connected)")
        : "unresolved (account not connected)",
      kitPath: kit.dir,
      wouldPostTo: "https://api.linkedin.com/rest/posts",
    };
    const updated = await setStatus(id, "dry_run", { kit_path: kit.dir });
    await addEvent(id, "dry-run", `kit ${kit.dir}`);
    return { mode: "dry-run", item: updated ?? item, kit, payload };
  }

  try {
    const { url, postUrn } = await publishPost(item.body);
    const updated = await setStatus(id, "published", {
      published_url: url,
      published_at: new Date(),
      platform_post_id: postUrn,
    });
    return { mode: "api", item: updated ?? item, url };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Missing scope, expired token, platform review pending: hand over the copy instead of
    // working around the platform. The item is marked manual, not published.
    const kit = buildKit(item);
    const updated = await setStatus(id, "manual", { kit_path: kit.dir });
    await addEvent(id, "publish-blocked", detail);
    return { mode: "manual", item: updated ?? item, kit, detail };
  }
}

export async function markPublishedManually(id: string, url: string): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  const updated = await setStatus(id, "published", {
    published_url: url,
    published_at: new Date(),
  });
  await addEvent(id, "published-manually", url);
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

/**
 * The owner took the post down. The row keeps published_url and platform_post_id so the audit
 * trail survives, and the status stops it counting as a live post anywhere.
 */
export async function markDeleted(id: string, note = ""): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (item.status === "deleted") return item;

  const updated = await setStatus(id, "deleted");
  await addEvent(id, "deleted", note || item.published_url || "no note");
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

export interface QueueStats {
  counts: Record<string, number>;
  /** Counted by status, so a post that was later deleted cannot inflate it. */
  publishedLive: number;
  promptTokens: number;
  completionTokens: number;
}

export async function queueStats(): Promise<QueueStats> {
  const items = await listItems();
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;

  return {
    counts,
    publishedLive: items.filter((item) => item.status === "published").length,
    promptTokens: items.reduce((total, item) => total + (item.prompt_tokens ?? 0), 0),
    completionTokens: items.reduce((total, item) => total + (item.completion_tokens ?? 0), 0),
  };
}

export interface DraftCheck {
  brandViolations: Violation[];
  commercialViolations: Violation[];
}

/**
 * Runs both guards against arbitrary text, so the detail panel can show warnings inline while
 * the owner edits instead of only at generation time.
 */
export function checkDraft(slug: string, language: Language, body: string): DraftCheck {
  const brandFile = brand(slug);
  return {
    brandViolations: validatePost(body, brandFile, language),
    commercialViolations: checkCommercialTerms(body, extractCommercialFacts(brandFile)),
  };
}

export async function itemWithHistory(id: string) {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  return { item, events: await getEvents(id) };
}

export async function editBody(id: string, body: string): Promise<ApprovalItem> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("An empty body cannot be saved");

  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (item.status === "published" || item.status === "deleted") {
    throw new Error(
      `Item is ${item.status}. Its body is the record of what was sent, so it is read only.`,
    );
  }

  const updated = await updateBody(id, trimmed);
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

export async function buildKitFor(id: string): Promise<Kit> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  const kit = buildKit(item);
  await setStatus(id, item.status === "pending" ? "manual" : item.status, { kit_path: kit.dir });
  return kit;
}

export { type ApprovalItem, getItem, type ItemStatus, LinkedInError, listItems };
