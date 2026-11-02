import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Brand } from "./brand.ts";
import { loadBrand } from "./brand.ts";

export interface ClientEntry {
  slug: string;
  name: string;
  /** Absolute path to this client's brand file. */
  file: string;
  note: string;
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

export function clientBrand(client: ClientEntry): Brand {
  return loadBrand(client.file, client.slug);
}
