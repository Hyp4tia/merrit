import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEntry } from "./clients.ts";

// The model is the only non-deterministic part, so it is replaced. Everything below it is the
// real pipeline: brand file, guards, one regeneration, queue.
interface ModelReply {
  action?: string;
  to?: string;
  request?: string;
  reply?: string;
  body?: string;
  angle?: string;
}

const queue: ModelReply[] = [];
vi.mock("./llm.ts", () => ({
  chatJson: vi.fn(async () => {
    const value = queue.shift() ?? {};
    return {
      value: { angle: "stub angle", ...value },
      result: { text: "", model: "stub-model", promptTokens: 11, completionTokens: 22 },
    };
  }),
}));

const LONG_DRAFT =
  "The counter at a clinic fills with small promises. A booking that never reaches the book. " +
  "A message that arrives after the patient has gone home. None of that shows up in a quote. " +
  "It shows up on a Tuesday, when the chair is empty and the phone is quiet. " +
  "We build the boring parts first: the form that sends, the log that adds up, the deploy that " +
  "survives a bad connection. Then the pages. The order matters, because a site that only looks " +
  "finished is a brochure with a bill attached. Everything here can be checked by hand, on the " +
  "day it ships.";

// Shorter than the first draft but still over the brand rule's 400 character floor, so the
// revision exercises the pipeline instead of the validator.
const SHORTER_DRAFT =
  "A booking that never reaches the book is the whole problem. We build the parts that carry " +
  "the work first: the form that sends, the log that adds up, the deploy that survives a bad " +
  "connection. The pages come after, because a site that only looks finished is a brochure with " +
  "a bill attached. Every claim on it can be checked by hand, on the day it ships, by the person " +
  "who has to use it the next morning.";

const REGISTRY = `${process.env.MERRIT_BRAND_FILE ?? ""}`;

const client: ClientEntry = {
  slug: "test-delegation",
  name: "Delegation Test Brand",
  file: REGISTRY,
  note: "",
  accounts: [],
  bots: [
    { id: "test-lead", name: "Test lead", role: "lead", active: true, description: "routes" },
    {
      id: "test-copy",
      name: "Test copywriter",
      role: "copywriter",
      active: true,
      description: "drafts",
    },
    {
      id: "test-strategist",
      name: "Test strategist",
      role: "strategist",
      active: false,
      description: "inactive",
    },
  ],
};

const { pool, initSchema } = await import("./db.ts");
const { delegate, postToBot, threadView } = await import("./threads.ts");

async function itemRows() {
  const { rows } = await pool.query<{ id: string; body: string; language: string }>(
    "SELECT id, body, language FROM merrit_approval_item WHERE client = $1 ORDER BY created_at ASC",
    [client.slug],
  );
  return rows;
}

async function messageCount(botId: string) {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM merrit_message WHERE client = $1 AND bot = $2",
    [client.slug, botId],
  );
  return Number(rows[0]?.count ?? 0);
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  if (!REGISTRY)
    throw new Error("MERRIT_BRAND_FILE is not set, so these tests cannot load a brand");
  await initSchema();
});

beforeEach(async () => {
  queue.length = 0;
  await pool.query("DELETE FROM merrit_message WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_delegation WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_thread WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_approval_item WHERE client = $1", [client.slug]);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterAll(async () => {
  await pool.query("DELETE FROM merrit_message WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_delegation WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_thread WHERE client = $1", [client.slug]);
  await pool.query("DELETE FROM merrit_approval_item WHERE client = $1", [client.slug]);
  await pool.end();
});

describe("the delegation loop", () => {
  it("has the lead route the request and create exactly one item", async () => {
    queue.push(
      {
        action: "delegate",
        to: "copywriter",
        request: "Draft a post that answers the cheap-site objection",
        reply: "Sending that to the copywriter.",
      },
      { body: LONG_DRAFT, angle: "cheap-site objection" },
    );

    const result = await postToBot(
      client,
      "test-lead",
      "Draft a post that answers the cheap-site objection",
    );

    const items = await itemRows();
    expect(items).toHaveLength(1);
    expect(result.itemId).toBe(items[0]?.id);
    expect(result.delegation?.toBot).toBe("test-copy");
    expect(result.delegation?.itemId).toBe(items[0]?.id);
    // The lead itself never writes the draft body.
    expect(result.reply).not.toContain("The counter at a clinic");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not create a second item when the same request repeats", async () => {
    const decide = {
      action: "delegate" as const,
      to: "copywriter",
      request: "Draft a post that answers the cheap-site objection",
      reply: "Sending that to the copywriter.",
    };
    queue.push(decide, { body: LONG_DRAFT, angle: "cheap-site objection" });
    await postToBot(client, "test-lead", "Draft a post that answers the cheap-site objection");
    const afterFirst = await itemRows();
    const copyMessagesAfterFirst = await messageCount("test-copy");

    // Same message again, and the model paraphrases it differently this time. The system keys on
    // what the owner asked, so the retry must still land on the same delegation and item.
    queue.push({
      ...decide,
      request: "Answer the cheap-site objection, the prospect thinks we cost too much.",
    });
    const second = await postToBot(
      client,
      "test-lead",
      "Draft a post that answers the cheap-site objection",
    );

    const afterSecond = await itemRows();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.id).toBe(afterFirst[0]?.id);
    expect(await messageCount("test-copy")).toBe(copyMessagesAfterFirst);
    expect(second.delegation?.itemId).toBe(afterFirst[0]?.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still drafts when the owner asks something different", async () => {
    queue.push(
      {
        action: "delegate",
        to: "copywriter",
        request: "Draft the cheap-site post",
        reply: "On it.",
      },
      { body: LONG_DRAFT, angle: "cheap-site objection" },
      {
        action: "delegate",
        to: "copywriter",
        request: "Draft the onboarding post",
        reply: "On it.",
      },
      { body: LONG_DRAFT, angle: "onboarding" },
    );
    await postToBot(client, "test-lead", "Draft the cheap-site post");
    await postToBot(client, "test-lead", "Draft the onboarding post");

    expect(await itemRows()).toHaveLength(2);
  });

  it("shows the delegation in both threads with the same item id", async () => {
    queue.push(
      {
        action: "delegate",
        to: "copywriter",
        request: "Draft the cheap-site post",
        reply: "On it.",
      },
      { body: LONG_DRAFT, angle: "cheap-site objection" },
    );
    await postToBot(client, "test-lead", "Draft the cheap-site post");

    const lead = await threadView(client, "test-lead");
    const copy = await threadView(client, "test-copy");

    expect(lead.delegations).toHaveLength(1);
    expect(copy.delegations).toHaveLength(1);
    expect(lead.delegations[0]?.id).toBe(copy.delegations[0]?.id);
    expect(lead.delegations[0]?.itemId).toBe(copy.delegations[0]?.itemId);
    expect(lead.messages.some((message) => message.delegationId === lead.delegations[0]?.id)).toBe(
      true,
    );
    expect(copy.messages.some((message) => message.delegationId === copy.delegations[0]?.id)).toBe(
      true,
    );
    // The copywriter's thread holds the draft; the lead's thread holds the outcome.
    expect(copy.messages.some((message) => message.content === LONG_DRAFT)).toBe(true);
    expect(lead.messages.some((message) => message.content === LONG_DRAFT)).toBe(false);
  });

  it("revises the same item when the copywriter is messaged directly", async () => {
    queue.push(
      {
        action: "delegate",
        to: "copywriter",
        request: "Draft the cheap-site post",
        reply: "On it.",
      },
      { body: LONG_DRAFT, angle: "cheap-site objection" },
    );
    await postToBot(client, "test-lead", "Draft the cheap-site post");
    const before = await itemRows();

    queue.push({ body: SHORTER_DRAFT, angle: "cheap-site objection" });
    const revision = await postToBot(client, "test-copy", "make it shorter");

    const after = await itemRows();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.body).toBe(SHORTER_DRAFT);
    expect(revision.itemId).toBe(before[0]?.id);

    const { rows } = await pool.query<{ action: string }>(
      "SELECT action FROM merrit_event WHERE item_id = $1 AND action = 'revised'",
      [before[0]?.id],
    );
    expect(rows).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an inactive bot by name instead of routing to it", async () => {
    await expect(postToBot(client, "test-strategist", "plan the week")).rejects.toThrow(
      /Test strategist is declared but not active in this build/,
    );
    expect(await itemRows()).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an unknown bot rather than guessing", async () => {
    await expect(postToBot(client, "nobody", "hi")).rejects.toThrow(/Unknown bot "nobody"/);
  });

  it("is idempotent through the thin delegate call too", async () => {
    queue.push({ body: LONG_DRAFT, angle: "cheap-site objection" });
    const first = await delegate({
      client,
      fromBotId: "test-lead",
      toBotId: "test-copy",
      request: "Draft the cheap-site post",
    });
    const second = await delegate({
      client,
      fromBotId: "test-lead",
      toBotId: "test-copy",
      request: "  draft   the CHEAP-SITE post ",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.itemId).toBe(first.itemId);
    expect(await itemRows()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
