import { loadBrand, type Language } from "./brand.ts";
import { config } from "./config.ts";
import {
  addEvent,
  getItem,
  insertItem,
  listItems,
  setStatus,
  type ApprovalItem,
  type ItemStatus,
} from "./db.ts";
import { DEFAULT_ANGLES, PROMPT_VERSION, generateDraft, type Angle } from "./generate.ts";
import { buildKit, type Kit } from "./kit.ts";
import { LinkedInError, publishPost } from "./publish-linkedin.ts";

export function brand() {
  return loadBrand(config.brandFile, config.clientSlug);
}

export interface BatchResult {
  created: ApprovalItem[];
  failures: Array<{ angle: string; error: string }>;
}

export async function generateBatch(count: number, angles: Angle[] = DEFAULT_ANGLES): Promise<BatchResult> {
  const brandFile = brand();
  const wanted = angles.slice(0, count);
  const created: ApprovalItem[] = [];
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
      failures.push({ angle: angle.key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { created, failures };
}

export async function approve(id: string): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (item.status !== "pending") throw new Error(`Item is ${item.status}, only a pending draft can be approved`);
  const updated = await setStatus(id, "approved");
  if (!updated) throw new Error(`No item ${id}`);
  return updated;
}

export async function schedule(id: string, when: Date): Promise<ApprovalItem> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  if (!["pending", "approved"].includes(item.status)) throw new Error(`Item is ${item.status}, cannot schedule`);
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
    const draft = await generateDraft(brandFile, angle, { rejectReason: trimmed, previousBody: item.body });
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
    return { rejected, replacement: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface PublishResult {
  mode: "api" | "manual";
  item: ApprovalItem;
  url?: string;
  kit?: Kit;
  detail?: string;
}

// Publishing is gated on a human approval that already happened. There is no path here
// that posts an unapproved draft.
export async function publishApproved(id: string): Promise<PublishResult> {
  const item = await getItem(id);
  if (!item) throw new Error(`No item ${id}`);
  // manual means a human already approved it and the API path failed, so retrying after the
  // credentials or permissions are fixed is legitimate. Nothing else can reach publish.
  if (!["approved", "scheduled", "manual"].includes(item.status)) {
    throw new Error(`Item is ${item.status}. Only an approved draft can publish.`);
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
  const updated = await setStatus(id, "published", { published_url: url, published_at: new Date() });
  await addEvent(id, "published-manually", url);
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

export { listItems, getItem, type ApprovalItem, type ItemStatus, LinkedInError };
