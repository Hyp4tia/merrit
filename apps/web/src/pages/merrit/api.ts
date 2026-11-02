export type MerritStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "manual"
  | "dry_run"
  | "deleted";

export type Language = "en" | "ar";

export interface ApprovalItem {
  id: string;
  client: string;
  channel: string;
  language: Language;
  angle: string;
  body: string;
  status: MerritStatus;
  reject_reason: string | null;
  review_reason: string | null;
  model: string | null;
  attempts: number;
  scheduled_for: string | null;
  published_url: string | null;
  platform_post_id: string | null;
  published_at: string | null;
  kit_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemEvent {
  id: number;
  action: string;
  detail: string | null;
  at: string;
}

export interface ClientSummary {
  slug: string;
  name: string;
  file: string;
  note: string;
  counts: Partial<Record<MerritStatus, number>>;
  needsReview: number;
}

export interface Violation {
  rule: string;
  detail: string;
}

export interface DryRunPayload {
  itemId: string;
  channel: string;
  language: string;
  body: string;
  authorUrn: string;
  kitPath: string;
  wouldPostTo: string;
}

export interface Filters {
  client: string;
  status: MerritStatus | "all";
  channel: string;
  language: Language | "all";
  q: string;
}

// The operator runs as its own service on 3300. Vite proxies /merrit-api to it in development
// (see vite.config.ts), so the browser stays on one origin, the operator needs no CORS policy,
// and a production deploy only needs the same reverse-proxy rule.
const BASE = "/merrit-api";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Merrit API ${response.status} on ${path}`);
  }
  return payload as T;
}

function query(filters: Filters): string {
  const params = new URLSearchParams({ client: filters.client });
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.channel !== "all") params.set("channel", filters.channel);
  if (filters.language !== "all") params.set("language", filters.language);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params.toString();
}

export const merritApi = {
  async clients(): Promise<ClientSummary[]> {
    const { clients } = await request<{ clients: ClientSummary[] }>("/clients");
    return clients;
  },

  async items(filters: Filters): Promise<ApprovalItem[]> {
    const { items } = await request<{ items: ApprovalItem[] }>(`/items?${query(filters)}`);
    return items;
  },

  item(id: string): Promise<{ item: ApprovalItem; events: ItemEvent[] }> {
    return request(`/items/${id}`);
  },

  async approve(id: string): Promise<ApprovalItem> {
    const { item } = await request<{ item: ApprovalItem }>(`/items/${id}/approve`, {
      method: "POST",
      body: "{}",
    });
    return item;
  },

  async reject(id: string, reason: string) {
    return request<{ replacement: boolean; error: string | null; item: ApprovalItem }>(
      `/items/${id}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },

  async saveBody(id: string, body: string): Promise<ApprovalItem> {
    const { item } = await request<{ item: ApprovalItem }>(`/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return item;
  },

  dryRun(id: string) {
    return request<{ payload: DryRunPayload; kit: string; item: ApprovalItem }>(
      `/items/${id}/dry-run`,
      { method: "POST", body: "{}" },
    );
  },

  check(client: string, language: Language, body: string) {
    return request<{ brandViolations: Violation[]; commercialViolations: Violation[] }>("/check", {
      method: "POST",
      body: JSON.stringify({ client, language, body }),
    });
  },

  generate(client: string, count: number) {
    return request<{
      created: number;
      flagged: number;
      failures: Array<{ angle: string; error: string }>;
    }>("/generate", { method: "POST", body: JSON.stringify({ client, count }) });
  },
};

export const merritKeys = {
  clients: ["merrit", "clients"] as const,
  items: (filters: Filters) => ["merrit", "items", filters] as const,
  item: (id: string | null) => ["merrit", "item", id] as const,
  check: (client: string, language: Language, body: string) =>
    ["merrit", "check", client, language, body] as const,
};
