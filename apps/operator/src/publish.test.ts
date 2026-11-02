import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The kit is written to disk, so it needs a temp home before config is imported.
const kitDir = mkdtempSync(path.join(tmpdir(), "merrit-publish-"));
process.env.MERRIT_KIT_DIR = kitDir;
process.env.DATABASE_URL = "postgres://unused/unused";
process.env.MERRIT_LLM_API_KEY = "test-key";
process.env.MERRIT_DRY_RUN = "0";

const ID = "11111111-1111-1111-1111-111111111111";

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    client: "kot",
    channel: "linkedin_personal",
    language: "en" as const,
    angle: "pricing",
    body: "A site is 12,000 EGP. Half at signing, half at launch.",
    status: "approved",
    reject_reason: null,
    model: "stub-model",
    prompt_version: "v",
    attempts: 1,
    prompt_tokens: 10,
    completion_tokens: 20,
    scheduled_for: null,
    published_url: null,
    platform_post_id: null,
    published_at: null,
    kit_path: null,
    review_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const TOKEN = {
  access_token: "test-token-not-real",
  person_urn: "urn:li:person:DRYRUN",
  scope: "openid,profile,w_member_social",
  expires_at: null,
};

// Flippable so the no-token path can be exercised. A missing token must fail closed.
const state: {
  current: ReturnType<typeof makeItem>;
  items: ReturnType<typeof makeItem>[];
  token: typeof TOKEN | null;
} = {
  current: makeItem(),
  items: [makeItem()],
  token: TOKEN,
};
const setStatus = vi.fn(
  async (_id: string, status: string, patch: Record<string, unknown> = {}) => {
    state.current = { ...state.current, status, ...patch };
    return state.current;
  },
);
const addEvent = vi.fn(async () => undefined);

// Only the database is replaced. The publisher, the kit and the gate under test are the real
// modules, so "zero network calls" below is a statement about the production code path.
vi.mock("./db.ts", () => ({
  getItem: vi.fn(async () => state.current),
  listItems: vi.fn(async () => state.items),
  setStatus: (...args: Parameters<typeof setStatus>) => setStatus(...args),
  addEvent: (...args: Parameters<typeof addEvent>) => addEvent(...args),
  getLinkedInToken: vi.fn(async () => state.token),
  initSchema: vi.fn(async () => undefined),
  pool: { end: vi.fn(async () => undefined), query: vi.fn(async () => ({ rows: [] })) },
}));

const actions = await import("./actions.ts");

// One spy for the whole file. mockReset between tests clears both the calls and any stub a
// previous test installed, so "not called" always means "not called in this test".
const fetchSpy = vi.spyOn(globalThis, "fetch");

beforeEach(() => {
  state.current = makeItem();
  state.items = [makeItem()];
  state.token = TOKEN;
  setStatus.mockClear();
  addEvent.mockClear();
  fetchSpy.mockReset();
});

describe("dry run", () => {
  it("produces the exact payload and writes the kit without touching the network", async () => {
    const result = await actions.publishApproved(ID, { dryRun: true });

    expect(result.mode).toBe("dry-run");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.payload).toEqual({
      itemId: ID,
      channel: "linkedin_personal",
      language: "en",
      body: state.current.body,
      accountId: "kot-personal",
      accountLabel: "Personal",
      authorUrn: "urn:li:person:DRYRUN",
      kitPath: path.join(kitDir, ID),
      wouldPostTo: "https://api.linkedin.com/rest/posts",
    });

    const postFile = path.join(kitDir, ID, "post.txt");
    expect(existsSync(postFile)).toBe(true);
    expect(readFileSync(postFile, "utf8").trim()).toBe(state.current.body);
  });

  it("records the item as dry_run, never as published", async () => {
    await actions.publishApproved(ID, { dryRun: true });

    expect(setStatus).toHaveBeenCalledWith(
      ID,
      "dry_run",
      expect.objectContaining({ kit_path: path.join(kitDir, ID) }),
    );
    expect(setStatus).not.toHaveBeenCalledWith(ID, "published", expect.anything());
    expect(state.current.platform_post_id).toBeNull();
    expect(state.current.published_url).toBeNull();
  });

  it("refuses a blocked page account instead of falling back to personal", async () => {
    await expect(
      actions.publishApproved(ID, { dryRun: true, accountId: "kot-page" }),
    ).rejects.toThrow(/Kōt page cannot post.*Community Management API approval/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("refuses an unknown account rather than guessing one", async () => {
    await expect(actions.publishApproved(ID, { dryRun: true, accountId: "nope" })).rejects.toThrow(
      /Unknown account "nope"/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("honours the MERRIT_DRY_RUN switch with no flag at all", async () => {
    process.env.MERRIT_DRY_RUN = "1";
    vi.resetModules();
    const fresh = await import("./actions.ts");

    const result = await fresh.publishApproved(ID);

    expect(result.mode).toBe("dry-run");
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env.MERRIT_DRY_RUN = "0";
    vi.resetModules();
  });
});

describe("the approval gate still holds", () => {
  it("refuses to publish a pending draft", async () => {
    state.current = makeItem({ status: "pending" });
    await expect(actions.publishApproved(ID)).rejects.toThrow(/Only an approved draft can publish/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a dry run on a pending draft too, so a rehearsal cannot move it out of review", async () => {
    state.current = makeItem({ status: "pending" });
    await expect(actions.publishApproved(ID, { dryRun: true })).rejects.toThrow(
      /Only an approved draft can publish/,
    );
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("refuses a rejected draft", async () => {
    state.current = makeItem({ status: "rejected" });
    await expect(actions.publishApproved(ID)).rejects.toThrow(/Only an approved draft can publish/);
  });

  it("still posts an approved draft and records the urn", async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:share:7654321" } }),
    );

    const result = await actions.publishApproved(ID);

    expect(result.mode).toBe("api");
    expect(result.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:7654321/");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    expect(setStatus).toHaveBeenCalledWith(
      ID,
      "published",
      expect.objectContaining({ platform_post_id: "urn:li:share:7654321" }),
    );
  });
});

describe("with no token in the store", () => {
  beforeEach(() => {
    state.token = null;
  });

  it("still produces a dry-run payload, with the author named from the registry", async () => {
    const result = await actions.publishApproved(ID, { dryRun: true });

    expect(result.mode).toBe("dry-run");
    // kot-personal carries member_urn in the registry, so the payload names the real author even
    // with no token. The urn is a public identifier, not a credential.
    expect(result.payload?.authorUrn).toBe("urn:li:person:KhbMnlToOL");
    expect(result.payload?.accountId).toBe("kot-personal");
    expect(result.payload?.wouldPostTo).toBe("https://api.linkedin.com/rest/posts");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(ID, "dry_run", expect.anything());
  });

  it("resolves the named account's author too", async () => {
    const result = await actions.publishApproved(ID, { dryRun: true, accountId: "kot-personal" });
    expect(result.payload?.authorUrn).toBe("urn:li:person:KhbMnlToOL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still fails closed on a real publish, before any network call", async () => {
    const error = await actions.publishApproved(ID).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/Personal is not connected/);
    expect(String(error)).toMatch(/No LinkedIn token on file/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still refuses a blocked account, token or no token", async () => {
    await expect(
      actions.publishApproved(ID, { dryRun: true, accountId: "kot-page" }),
    ).rejects.toThrow(/cannot post/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the publisher itself refuses before building a request", async () => {
    const { publishPost } = await import("./publish-linkedin.ts");
    await expect(publishPost("body")).rejects.toThrow(/No LinkedIn token/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("deleted posts", () => {
  it("marks the item deleted and keeps the url and urn for the audit trail", async () => {
    state.current = makeItem({
      status: "published",
      published_url: "https://www.linkedin.com/feed/update/urn:li:share:7523062737069998080/",
      platform_post_id: "urn:li:share:7523062737069998080",
    });

    const item = await actions.markDeleted(ID, "owner removed it from LinkedIn");

    expect(item.status).toBe("deleted");
    expect(item.published_url).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:7523062737069998080/",
    );
    expect(item.platform_post_id).toBe("urn:li:share:7523062737069998080");
    expect(addEvent).toHaveBeenCalledWith(ID, "deleted", "owner removed it from LinkedIn");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is idempotent", async () => {
    state.current = makeItem({ status: "deleted", published_url: "https://example.test/post" });
    await actions.markDeleted(ID);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("is excluded from the live published count", async () => {
    state.items = [
      makeItem(),
      makeItem(),
      makeItem({ status: "published", published_url: "https://example.test/live" }),
      makeItem({ status: "deleted", published_url: "https://example.test/gone" }),
    ];

    const stats = await actions.queueStats();

    expect(stats.publishedLive).toBe(1);
    expect(stats.counts.published).toBe(1);
    expect(stats.counts.deleted).toBe(1);
  });
});
