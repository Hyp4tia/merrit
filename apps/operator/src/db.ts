import pg from "pg";
import { config } from "./config.ts";

export type ItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "scheduled"
  | "published"
  | "manual"
  | "dry_run"
  | "deleted";

export interface ApprovalItem {
  id: string;
  client: string;
  channel: string;
  language: "en" | "ar";
  angle: string;
  body: string;
  status: ItemStatus;
  reject_reason: string | null;
  model: string | null;
  prompt_version: string | null;
  attempts: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  scheduled_for: Date | null;
  published_url: string | null;
  platform_post_id: string | null;
  published_at: Date | null;
  kit_path: string | null;
  /** Set when the commercial guard still failed after one regeneration, so a human must look. */
  review_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });

// Idempotent so the operator can boot against a database the shell already created.
export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merrit_approval_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client text NOT NULL,
      channel text NOT NULL DEFAULT 'linkedin_personal',
      language text NOT NULL CHECK (language IN ('en','ar')),
      angle text NOT NULL,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected','scheduled','published','manual','dry_run','deleted')),
      reject_reason text,
      model text,
      prompt_version text,
      attempts integer NOT NULL DEFAULT 1,
      prompt_tokens integer,
      completion_tokens integer,
      scheduled_for timestamptz,
      published_url text,
      platform_post_id text,
      published_at timestamptz,
      kit_path text,
      review_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS merrit_approval_item_status_idx ON merrit_approval_item (status, created_at DESC);

    ALTER TABLE merrit_approval_item ADD COLUMN IF NOT EXISTS prompt_tokens integer;
    ALTER TABLE merrit_approval_item ADD COLUMN IF NOT EXISTS completion_tokens integer;
    ALTER TABLE merrit_approval_item ADD COLUMN IF NOT EXISTS review_reason text;

    -- Widen the status set for the dry-run and deleted states. Dropped and re-added every boot
    -- so the constraint always matches this file; a row outside the set fails loudly at startup.
    ALTER TABLE merrit_approval_item DROP CONSTRAINT IF EXISTS merrit_approval_item_status_check;
    ALTER TABLE merrit_approval_item ADD CONSTRAINT merrit_approval_item_status_check
      CHECK (status IN ('pending','approved','rejected','scheduled','published','manual','dry_run','deleted'));

    CREATE TABLE IF NOT EXISTS merrit_event (
      id bigserial PRIMARY KEY,
      item_id uuid REFERENCES merrit_approval_item(id) ON DELETE CASCADE,
      action text NOT NULL,
      detail text,
      at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS merrit_linkedin_token (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      access_token text NOT NULL,
      scope text,
      person_urn text,
      expires_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function addEvent(itemId: string | null, action: string, detail = ""): Promise<void> {
  await pool.query("INSERT INTO merrit_event (item_id, action, detail) VALUES ($1,$2,$3)", [
    itemId,
    action,
    detail,
  ]);
}

export interface NewItem {
  client: string;
  language: "en" | "ar";
  angle: string;
  body: string;
  model: string;
  promptVersion: string;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  channel?: string;
  reviewReason?: string | null;
}

export async function insertItem(item: NewItem): Promise<ApprovalItem> {
  const { rows } = await pool.query<ApprovalItem>(
    `INSERT INTO merrit_approval_item
       (client, channel, language, angle, body, model, prompt_version, attempts, prompt_tokens, completion_tokens, review_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      item.client,
      item.channel ?? "linkedin_personal",
      item.language,
      item.angle,
      item.body,
      item.model,
      item.promptVersion,
      item.attempts,
      item.promptTokens,
      item.completionTokens,
      item.reviewReason ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Insert into merrit_approval_item returned no row");
  await addEvent(row.id, "created", item.angle);
  return row;
}

export async function getItem(id: string): Promise<ApprovalItem | null> {
  const { rows } = await pool.query<ApprovalItem>(
    "SELECT * FROM merrit_approval_item WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function listItems(status?: ItemStatus): Promise<ApprovalItem[]> {
  const { rows } = status
    ? await pool.query<ApprovalItem>(
        "SELECT * FROM merrit_approval_item WHERE status = $1 ORDER BY created_at DESC",
        [status],
      )
    : await pool.query<ApprovalItem>("SELECT * FROM merrit_approval_item ORDER BY created_at DESC");
  return rows;
}

export async function setStatus(
  id: string,
  status: ItemStatus,
  patch: Partial<
    Pick<
      ApprovalItem,
      | "reject_reason"
      | "scheduled_for"
      | "kit_path"
      | "published_url"
      | "published_at"
      | "platform_post_id"
    >
  > = {},
): Promise<ApprovalItem | null> {
  const fields = Object.entries(patch).filter(([, value]) => value !== undefined);
  const assignments = [
    "status = $2",
    "updated_at = now()",
    ...fields.map(([key], index) => `${key} = $${index + 3}`),
  ];
  const { rows } = await pool.query<ApprovalItem>(
    `UPDATE merrit_approval_item SET ${assignments.join(", ")} WHERE id = $1 RETURNING *`,
    [id, status, ...fields.map(([, value]) => value)],
  );
  if (rows[0]) await addEvent(id, `status:${status}`, patch.reject_reason ?? "");
  return rows[0] ?? null;
}

export interface LinkedInToken {
  access_token: string;
  scope: string | null;
  person_urn: string | null;
  expires_at: Date | null;
}

export async function saveLinkedInToken(
  token: Omit<LinkedInToken, "expires_at"> & { expires_at: Date | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO merrit_linkedin_token (id, access_token, scope, person_urn, expires_at, updated_at)
     VALUES (1,$1,$2,$3,$4, now())
     ON CONFLICT (id) DO UPDATE SET access_token = $1, scope = $2, person_urn = $3, expires_at = $4, updated_at = now()`,
    [token.access_token, token.scope, token.person_urn, token.expires_at],
  );
}

export async function getLinkedInToken(): Promise<LinkedInToken | null> {
  const { rows } = await pool.query<LinkedInToken>(
    "SELECT * FROM merrit_linkedin_token WHERE id = 1",
  );
  return rows[0] ?? null;
}
