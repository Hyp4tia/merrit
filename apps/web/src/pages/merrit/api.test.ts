// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { merritApi } from "./api";

// The real client, no module mock: this proves the URL shape and the error contract the page
// depends on.
function stubFetch(payload: unknown, status = 200) {
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
    const keys = Object.keys(merritApi);
    expect(keys).toContain("dryRun");
    expect(keys).not.toContain("publish");
  });

  it("sends the chosen account with the dry run, never a default", async () => {
    const spy = stubFetch({ payload: {}, kit: "/tmp/kit" });
    await merritApi.dryRun("abc", "kot-page");
    expect(String(spy.mock.calls[0]?.[0])).toBe("/merrit-api/items/abc/dry-run");
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ account: "kot-page" });
  });

  it("loads and posts chat through the operator", async () => {
    const spy = stubFetch({ messages: [] });
    await merritApi.chat("kot", "kot-writer");
    expect(String(spy.mock.calls[0]?.[0])).toBe("/merrit-api/chat?client=kot&bot=kot-writer");

    await merritApi.sendChat({
      client: "kot",
      bot: "kot-writer",
      account: "kot-personal",
      message: "hi",
    });
    const init = spy.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      client: "kot",
      bot: "kot-writer",
      account: "kot-personal",
      message: "hi",
    });
  });

  it("turns an ok:false payload into a thrown error with the server's message", async () => {
    stubFetch({ ok: false, error: "Kōt page is not connected. Page posting needs approval." });
    await expect(merritApi.dryRun("abc", "kot-page")).rejects.toThrow("Kōt page is not connected");
  });

  it("throws on a transport failure too", async () => {
    stubFetch({}, 500);
    await expect(merritApi.approve("abc")).rejects.toThrow(/Merrit API 500/);
  });
});
