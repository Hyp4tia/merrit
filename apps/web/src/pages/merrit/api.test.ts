// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { merritApi } from "./api";

// The real client, no module mock: this is what proves the URL shape and the error contract that
// the page depends on.
function stubFetch(payload: unknown, status = 200) {
  // Takes the arguments fetch takes, so the call tuple carries the URL for assertions.
  const spy = vi.fn(
    async (..._args: unknown[]) => new Response(JSON.stringify(payload), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("merrit api client", () => {
  it("goes through the dev proxy path, never the operator origin", async () => {
    const spy = stubFetch({ items: [] });
    await merritApi.items({ client: "kot", status: "all", channel: "all", language: "all", q: "" });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url.startsWith("/merrit-api/")).toBe(true);
    expect(url).not.toContain("3300");
  });

  it("scopes every queue request to one brand and drops the all-values", async () => {
    const spy = stubFetch({ items: [] });
    await merritApi.items({
      client: "kot",
      status: "pending",
      channel: "all",
      language: "ar",
      q: "  price  ",
    });
    const url = new URL(String(spy.mock.calls[0]?.[0]), "http://127.0.0.1");
    expect(url.pathname).toBe("/merrit-api/items");
    expect(url.searchParams.get("client")).toBe("kot");
    expect(url.searchParams.get("status")).toBe("pending");
    expect(url.searchParams.get("language")).toBe("ar");
    expect(url.searchParams.get("q")).toBe("price");
    expect(url.searchParams.has("channel")).toBe(false);
  });

  it("has no publish method at all, only a dry run", () => {
    expect(Object.keys(merritApi)).toContain("dryRun");
    expect(Object.keys(merritApi)).not.toContain("publish");
  });

  it("posts to the dry-run route for a payload", async () => {
    const spy = stubFetch({
      payload: { wouldPostTo: "https://api.linkedin.com/rest/posts" },
      kit: "/tmp/kit",
    });
    const result = await merritApi.dryRun("abc");
    expect(String(spy.mock.calls[0]?.[0])).toBe("/merrit-api/items/abc/dry-run");
    expect(result.payload.wouldPostTo).toBe("https://api.linkedin.com/rest/posts");
  });

  it("turns an ok:false payload into a thrown error with the server's message", async () => {
    stubFetch({ ok: false, error: "Only an approved draft can publish." });
    await expect(merritApi.dryRun("abc")).rejects.toThrow("Only an approved draft can publish.");
  });

  it("throws on a transport failure too", async () => {
    stubFetch({}, 500);
    await expect(merritApi.approve("abc")).rejects.toThrow(/Merrit API 500/);
  });
});
