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
  note: string;
}

export interface Bot {
  id: string;
  name: string;
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

export function clientBrand(client: ClientEntry): Brand {
  return loadBrand(client.file, client.slug);
}
