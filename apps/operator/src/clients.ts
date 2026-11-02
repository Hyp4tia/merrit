import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Brand } from "./brand.ts";
import { loadBrand } from "./brand.ts";

export type AccountKind = "person" | "organization";
/** May this account post at all, if it is authorized. Never a claim about connectivity. */
export type AccountPermission = "granted" | "blocked";

export interface Account {
  id: string;
  label: string;
  kind: AccountKind;
  permission: AccountPermission;
  /** Public member identifier, for naming the author in a payload. Never a credential. */
  member_urn: string;
  note: string;
}

export type BotRole = "lead" | "copywriter" | "strategist" | "designer" | "analyst" | "ads";

export interface Bot {
  id: string;
  name: string;
  role: string;
  /** Declared bots that are not active are refused by name, never silently routed. */
  active: boolean;
  description: string;
}

export interface ClientEntry {
  slug: string;
  name: string;
  /** Absolute path to this client's brand file. */
  file: string;
  note: string;
  accounts: Account[];
  bots: Bot[];
}

/** An account as the API reports it, with connectivity derived at runtime. */
export interface ResolvedAccount extends Account {
  /** Derived: permission granted AND a usable token exists. Never read from the registry. */
  connected: boolean;
  /** Why it cannot post right now, in the words the UI shows. Empty when connected. */
  reason: string;
}

function accountsOf(entry: Record<string, unknown>): Account[] {
  const raw = Array.isArray(entry.accounts) ? entry.accounts : [];
  return raw.map((account) => {
    const record = account as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      label: String(record.label ?? record.id ?? ""),
      kind: record.kind === "organization" ? "organization" : "person",
      permission: record.permission === "granted" ? "granted" : "blocked",
      member_urn: String(record.member_urn ?? ""),
      note: String(record.note ?? ""),
    };
  });
}

function botsOf(entry: Record<string, unknown>): Bot[] {
  const raw = Array.isArray(entry.bots) ? entry.bots : [];
  return raw.map((bot) => {
    const record = bot as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      name: String(record.name ?? record.id ?? ""),
      role: String(record.role ?? ""),
      active: record.active === true,
      description: String(record.description ?? ""),
    };
  });
}

// The registry is the switch from one brand to many. Adding a client is one entry plus one
// brand file, with no code change and no deploy.
export function loadClients(registryFile: string): ClientEntry[] {
  const parsed = parse(readFileSync(registryFile, "utf8")) as {
    clients?: Array<Record<string, unknown>>;
  };
  const dir = path.dirname(registryFile);

  const clients = (parsed.clients ?? [])
    .map((entry) => {
      const slug = String(entry.slug ?? "").trim();
      return {
        slug,
        name: String(entry.name ?? slug),
        file: path.resolve(dir, String(entry.file ?? `${slug}.yaml`)),
        note: String(entry.note ?? ""),
        accounts: accountsOf(entry),
        bots: botsOf(entry),
      };
    })
    .filter((entry) => entry.slug.length > 0);

  if (clients.length === 0) throw new Error(`No clients listed in ${registryFile}`);
  return clients;
}

export function findClient(clients: ClientEntry[], slug: string): ClientEntry {
  const client = clients.find((entry) => entry.slug === slug);
  if (!client) {
    throw new Error(
      `Unknown client "${slug}". Known: ${clients.map((entry) => entry.slug).join(", ")}`,
    );
  }
  return client;
}

export function findAccount(client: ClientEntry, accountId: string): Account {
  const account = client.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(
      `Unknown account "${accountId}" for ${client.slug}. Known: ${
        client.accounts.map((entry) => entry.id).join(", ") || "none"
      }`,
    );
  }
  return account;
}

/**
 * The author a payload would carry. A live token wins, because it is authoritative. Without one,
 * the registry's public member urn still names the account exactly. With neither, the payload says
 * "unresolved" rather than guessing or borrowing another account's identity.
 */
export function authorUrnFor(
  account: Pick<Account, "member_urn">,
  tokenUrn: string | null,
): string {
  if (tokenUrn) return tokenUrn;
  return account.member_urn || "unresolved";
}

export function findBot(client: ClientEntry, botId: string): Bot {
  const bot = client.bots.find((entry) => entry.id === botId);
  if (!bot) {
    throw new Error(
      `Unknown bot "${botId}" for ${client.slug}. Declared: ${client.bots.map((entry) => entry.id).join(", ") || "none"}`,
    );
  }
  return bot;
}

/** The bot a delegation should go to, matched by role first, then id. */
export function findBotByRole(client: ClientEntry, role: string): Bot | undefined {
  return (
    client.bots.find((entry) => entry.role === role) ??
    client.bots.find((entry) => entry.id === role)
  );
}

export function clientBrand(client: ClientEntry): Brand {
  return loadBrand(client.file, client.slug);
}
