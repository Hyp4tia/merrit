import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authorUrnFor, findAccount, loadClients } from "./clients.ts";

const REGISTRY = `
clients:
  - slug: kot
    name: Kōt Dynamics
    file: kot.yaml
    accounts:
      - id: kot-personal
        label: Personal
        kind: person
        permission: granted
        member_urn: urn:li:person:FROMREGISTRY
      - id: kot-page
        label: Kōt page
        kind: organization
        permission: blocked
    bots:
      - id: kot-writer
        name: Kōt writer
        description: drafts
`;

function registry() {
  const dir = mkdtempSync(path.join(tmpdir(), "merrit-registry-"));
  const file = path.join(dir, "clients.yaml");
  writeFileSync(file, REGISTRY, "utf8");
  return loadClients(file);
}

describe("the registry declares permission, never connectivity", () => {
  it("has no connected flag to go stale", () => {
    const [client] = registry();
    expect(client).toBeDefined();
    const personal = findAccount(client as NonNullable<typeof client>, "kot-personal");
    expect(personal.permission).toBe("granted");
    expect(personal).not.toHaveProperty("status");
    expect(personal).not.toHaveProperty("connected");
  });

  it("keeps the member urn as a public identifier on the account", () => {
    const [client] = registry();
    const personal = findAccount(client as NonNullable<typeof client>, "kot-personal");
    expect(personal.member_urn).toBe("urn:li:person:FROMREGISTRY");
  });

  it("marks a page account blocked, with no member urn", () => {
    const [client] = registry();
    const page = findAccount(client as NonNullable<typeof client>, "kot-page");
    expect(page.permission).toBe("blocked");
    expect(page.member_urn).toBe("");
  });
});

describe("payload author resolution", () => {
  it("prefers a live token, because it is authoritative", () => {
    expect(authorUrnFor({ member_urn: "urn:li:person:FROMREGISTRY" }, "urn:li:person:LIVE")).toBe(
      "urn:li:person:LIVE",
    );
  });

  it("names the author from the registry when there is no token", () => {
    expect(authorUrnFor({ member_urn: "urn:li:person:FROMREGISTRY" }, null)).toBe(
      "urn:li:person:FROMREGISTRY",
    );
  });

  it("says unresolved rather than guessing when neither exists", () => {
    expect(authorUrnFor({ member_urn: "" }, null)).toBe("unresolved");
  });

  it("never borrows another account's identity", () => {
    // A blocked page account has no member urn, so it can only resolve to unresolved.
    expect(authorUrnFor({ member_urn: "" }, null)).not.toContain("KhbMnlToOL");
  });
});
