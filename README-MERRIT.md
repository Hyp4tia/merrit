# Merrit

Marketing that earns it.

Merrit drafts content for a brand, holds every draft in an approval queue, and publishes only
what a human approved, through official platform APIs. When an API is unavailable or a scope
is missing, it hands over a copy/download publish kit instead of working around the platform.

This repository is a fork of [Rakazo](https://github.com/elie222/rakazo) (Apache-2.0) used as
the agent shell. The Merrit content engine lives in `apps/operator` and is original code. See
`NOTICE` for attribution.

---

## What is here

| Piece | Path | What it does |
| --- | --- | --- |
| Agent shell | `apps/web`, `apps/api`, `apps/worker` | Forked Rakazo shell, rebranded to Merrit. Chat UI, bots, Postgres-backed state. |
| Operator | `apps/operator` | Brand-aware drafting, approval queue, LinkedIn publisher, publish kit. |
| Brand files | `../brand/<client>.yaml` | One file per client: voice, offers, banned phrases, proof rules, cadence. |
| Rebrand script | `scripts/rebrand-to-merrit.mjs` | Re-applies the Merrit rename after syncing upstream. |

The operator is deliberately not a second app framework: one Postgres database, its own
`merrit_*` tables, plain Node HTTP, no build step.

---

## Prerequisites

Verified on macOS 27.2, Apple Silicon, 16 GB RAM, Node 22.23.2.

```bash
brew install postgresql@16          # no Docker in this setup, by design
brew services start postgresql@16
corepack enable --install-directory ~/.local/bin pnpm   # pnpm 9.15.0, matches packageManager
export PATH="$HOME/.local/bin:$PATH"
```

Node must satisfy `^22.22.2 || ^24 || >=26`. Postgres runs natively; the documented upstream
Docker path is not used because the target machine has about 14 GB free disk.

---

## Setup, exact commands

```bash
# 1. Database (role and database named merrit, local only)
createuser -s merrit 2>/dev/null; createdb -O merrit merrit

# 2. Dependencies. Mobile and desktop are excluded to keep node_modules around 2.2 GB.
cd merrit
pnpm install --filter "@rakazo/api..." --filter "@rakazo/web..." \
             --filter "@rakazo/worker..." --filter "@rakazo/sandbox-supervisor" \
             --filter "@merrit/operator"

# 3. Prisma client, then schema
pnpm db:generate
pnpm --filter @rakazo/api db:migrate

# 4. Environment: copy the block below into .env at the repository root
# 5. Run the shell (web 5173, api 3100, worker, sandbox supervisor 7091)
pnpm dev

# 6. Run the operator in a second terminal (queue UI on 3300)
pnpm --filter @merrit/operator start
```

`.env` at the repository root, minimum viable content:

```dotenv
NODE_ENV=development
DATABASE_URL=postgres://merrit:<password>@127.0.0.1:5432/merrit
DATABASE_MIGRATION_URL=postgres://merrit:<password>@127.0.0.1:5432/merrit
POSTGRES_USER=merrit
POSTGRES_PASSWORD=<password>
POSTGRES_DB=merrit
POSTGRES_APP_PASSWORD=<another password>
BETTER_AUTH_SECRET=<openssl rand -hex 24>
BETTER_AUTH_URL=http://127.0.0.1:5173
API_URL=http://127.0.0.1:3100
API_HOST=127.0.0.1
WEB_ORIGIN=http://127.0.0.1:5173
ENCRYPTION_KEY=<openssl rand -hex 32>
WEB_PORT=5173
API_PORT=3100

OPERATOR_PORT=3300
MERRIT_CLIENT=kot
MERRIT_BRAND_FILE=/absolute/path/to/brand/kot.yaml
MERRIT_LLM_BASE_URL=https://api.commandcode.ai/provider/v1
MERRIT_LLM_MODEL=deepseek/deepseek-v4.1-flash
MERRIT_LLM_API_KEY=<openai-compatible key>
MERRIT_LLM_MAX_TOKENS=2600
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:3300/oauth/linkedin/callback
LINKEDIN_VERSION=202601
```

`MERRIT_LLM_MAX_TOKENS` is 2600 because this model spends completion budget on reasoning
before it writes the post. Setting it near 1000 truncates the JSON reply.

The operator accepts any OpenAI-compatible `/chat/completions` endpoint. Pointing it at
DeepSeek's own API is `MERRIT_LLM_BASE_URL=https://api.deepseek.com/v1` with that key.

---

## Using the queue

```bash
pnpm --filter @merrit/operator exec tsx src/cli.ts generate --count 7
pnpm --filter @merrit/operator exec tsx src/cli.ts list --status pending
pnpm --filter @merrit/operator exec tsx src/cli.ts approve <id>
pnpm --filter @merrit/operator exec tsx src/cli.ts publish <id>
```

Or use the UI at http://127.0.0.1:3300, which has the same actions plus reject with a reason.

States, and what each one means:

| State | Meaning |
| --- | --- |
| `pending` | Drafted, waiting for a human. Nothing can publish from here. |
| `approved` | A human said yes. The only state that can publish. |
| `rejected` | A human said no, with a reason. A replacement draft is generated from that reason. |
| `scheduled` | Approved with a publish time attached. Still publishes only through the API. |
| `published` | Live, with the URL recorded. |
| `manual` | Publishing was blocked (no token, missing scope, platform review). A publish kit was written instead. |
| `dry_run` | A rehearsal ran. The payload was produced and the kit written, nothing was sent, and it is not a publication. |
| `deleted` | Was published, then taken down. The URL and post urn stay on the row for the audit trail. |

The approval gate is enforced in `apps/operator/src/actions.ts`, not just in the UI:
`publishApproved` refuses any item that is not `approved` or `scheduled`.

---

## Brand rules are enforced, not suggested

`apps/operator/src/validate.ts` runs on every draft before it reaches the queue. A draft is
thrown away and regenerated, up to three attempts, when it contains:

- an em dash or en dash anywhere (house rule for all copy)
- an exclamation mark or emoji in the body
- any phrase from `banned` in the brand file
- unqualified social proof such as "trusted by" or "our clients love"
- a reference to a forbidden proof claim
- under 400 or over 2800 characters
- the wrong script for the requested language

A draft that still fails after three attempts is reported as a failure and never inserted. There
is no path where a brand-violating draft silently lands in the queue.

## Commercial terms are guarded, not trusted

`apps/operator/src/commercial.ts` is the backstop behind the prompt. The brand rules above catch
tone. This catches invention, which is a different bug: a draft once manufactured a "paid scoping
week" and a "milestone linked balance" while quoting no numbers at all, so a price list check
alone would have missed it.

On every draft the guard extracts:

- every currency amount, and diffs it against the figures in the brand file offers block
- every percentage
- every duration, because an unpublished commitment ("answer within 24 hours") is still a claim
- every commercial structure word: scoping week, audit, hourly, fixed scope, milestone, package,
  tier, pricing plan, discount, free trial, setup or onboarding fee, rush fee, minimum contract,
  plus the Arabic equivalents

Context decides the category, so a bare count such as "found 3 broken forms" is not a commercial
claim and passes. Anything that does not trace back to the offers block becomes a violation with a
named reason: `commercial-amount`, `commercial-percentage`, `commercial-duration` or
`commercial-structure`.

Commitments are facts from the same file. Kōt's `commitments.promises` list is empty, so the
agent may not promise a response time, turnaround, availability, support window or guarantee of
any kind. Put a promise in that list and the guard accepts that exact figure while still rejecting
any other: with "answer within 24 hours" listed, "within 24 hours" passes and "within 48 hours"
still fails. The guard reads the brand file, it does not hardcode phrases, and the prompt tells
the model the same thing.

Flow: draft, brand rules, commercial guard, one regeneration told exactly what it invented, then
the item is still queued but with `review_reason` set and a visible flag in the UI. A human
decides. Invented terms cannot reach a published post without someone overriding a flag they can
see.

## Tests

```bash
pnpm vitest run apps/operator
```

44 tests covering the incident copy verbatim (paid scoping week, fixed price for fixed scope,
milestone balance, hourly rate, package tier), invented amount, percentage and duration, the real
pricing post passing unchanged, Arabic digits, the regenerate-once-then-flag flow, commitments
being read from the brand file rather than hardcoded, dry runs making zero network calls, the
approval gate refusing unapproved drafts, deleted posts keeping their audit trail, and the em
dash, exclamation mark and emoji rules that must not regress. The generation tests replace only the
model call, so the brand rules and the guard run for real.

---

## Dry run

A rehearsal that stops before the POST, and proves what would have been sent:

```bash
pnpm --filter @merrit/operator exec tsx src/cli.ts publish <id> --dry-run
MERRIT_DRY_RUN=1 pnpm --filter @merrit/operator exec tsx src/cli.ts publish <id>
```

It prints the payload (channel, author urn, body, kit path, and the endpoint it would call),
writes the kit, and moves the item to `dry_run`. It never calls LinkedIn, so it cannot create a
post, and the state means it can never be read as published. The approval gate applies to a
rehearsal as well: a pending or rejected draft is refused, so a dry run cannot quietly move work
out of review.

## Taking a post down

```bash
pnpm --filter @merrit/operator exec tsx src/cli.ts deleted <id> --note "owner removed it"
```

The row moves to `deleted` and keeps `published_url` and the post urn. `stats` and the live
published count exclude it, because a post that was taken down is not a live post:

```bash
pnpm --filter @merrit/operator exec tsx src/cli.ts stats
```

## Publishing to LinkedIn

Publisher: `apps/operator/src/publish-linkedin.ts`. Official API only, no browser automation,
no unofficial endpoints.

1. Create an app at https://www.linkedin.com/developers/apps
2. Add products: **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**
3. Auth tab, authorized redirect URL: `http://localhost:3300/oauth/linkedin/callback`
4. Scopes granted: `openid`, `profile`, `w_member_social`
5. Put the client id and secret in `.env`, then press **Authorize LinkedIn** in the queue UI
6. `openid profile` identifies the member, `w_member_social` posts as that member

Publishing uses `POST https://api.linkedin.com/rest/posts` with `LinkedIn-Version`. The created
post urn comes back in the `x-restli-id` response header and is stored as the live URL,
`https://www.linkedin.com/feed/update/<urn>/`.

Company page publishing is not wired. It needs `w_organization_social` with Community
Management API approval, which is a partner review, not a self-serve product.

### Verified live post

2026-11-02, item `82ffa402` went through this exact path to Zeyad's personal profile:

- `POST https://api.linkedin.com/rest/posts` with `LinkedIn-Version: 202601`, accepted, no 426
- created URN returned in `x-restli-id`: `urn:li:share:7523062737069998080`
- feed URL answers HTTP 200 to a fetch, with the post body present in the HTML and the first line
  as `og:title`
- token grants `openid,profile,w_member_social`, member `urn:li:person:KhbMnlToOL`, expires
  2027-01-01

https://www.linkedin.com/feed/update/urn:li:share:7523062737069998080/

`GET /rest/posts/{urn}` is not a usable existence check: LinkedIn answers
`400 ILLEGAL_ARGUMENT, Syntax exception in path variables` regardless of API version, so the
create response header is the authoritative record.

---

## Publish kit

When the API path fails, `buildKit` writes `post.txt`, `post.md` and `README.txt` under
`.merrit-kit/<item id>/` and the item is marked `manual`, never `published`. Arabic items ship
with a right-to-left mark so pasting does not reorder the text. After posting by hand:

```bash
pnpm --filter @merrit/operator exec tsx src/cli.ts published <id> --url <url>
```

---

## Costs

Measured on 2026-11-02 with this build. The seven Kōt drafts, plus one draft that failed
validation and was regenerated, plus one draft replaced after a rejection:

| | Tokens | Rate | Cost |
| --- | --- | --- | --- |
| Input | 6,197 | $0.15 per 1M | $0.00093 |
| Output | 13,886 | $0.60 per 1M | $0.00833 |
| **Total** | 20,083 | | **$0.0093** |

About one US cent for a full week of drafts, roughly $0.04 for thirty posts a month.

Rates are DeepSeek's published list price for DeepSeek-V4.1-Flash
(https://api-docs.deepseek.com/quick_start/pricing): $0.15 per 1M cache-miss input tokens,
$0.003 per 1M cache-hit input tokens, $0.60 per 1M output tokens, off-peak. Output dominates
because the model spends most of its budget reasoning before it writes, and Arabic drafts
reason roughly twice as long as English ones. If CommandCode bills differently, its own rate
applies; the token counts above are measured, not estimated.

Token counts are stored per item in `prompt_tokens` and `completion_tokens`, and `generate`
prints the totals, so a spend check is one query:

```bash
psql -d merrit -c "select sum(prompt_tokens), sum(completion_tokens) from merrit_approval_item;"
```

Everything else is free and local: Postgres, the shell, the queue, publishing through the
LinkedIn API. There is no hosted control plane and no per-seat fee.

---

## API approval checklist

| Platform | What you need | Access path | Lead time |
| --- | --- | --- | --- |
| LinkedIn personal | `w_member_social` + `openid profile` | Share on LinkedIn product, self-serve | Immediate |
| LinkedIn company page | `w_organization_social` | Community Management API, partner review | Weeks |
| Meta Pages / Instagram | `pages_manage_posts`, `instagram_content_publish`, App Review with a screen recording | Meta app review | 2 to 6 weeks |
| X | paid API tier, `tweet.write`, OAuth 2.0 user context | X developer portal, paid | Days, needs the paid plan |
| TikTok | Content Posting API, app audit for public posts | TikTok developer review | Weeks |
| Google Ads | developer token, Basic access for campaign creation | Google Ads API application | Days to weeks |

Only LinkedIn personal is wired in this milestone. The rest of the table is the honest work
ahead, not a claim of coverage.

---

## Known gaps

- **Billing and credit screens** inherited from upstream render Merrit labels but have no
  payment processor behind them. Merrit v1 is bring-your-own-key. Remove or wire them before
  a customer sees this.
- **Desktop and mobile apps** (`apps/desktop`, `apps/mobile`) are not built and still carry
  their own bundled copy. Only the web shell is rebranded.
- **Sandbox supervisor** logs `connect ENOENT /var/run/docker.sock` because there is no Docker.
  Bots that need a sandboxed computer will not start; drafting, the queue and publishing are
  unaffected.
- **Row-level security** is not enforced locally: the API connects as a superuser, so Postgres
  logs a warning on boot. Create a runtime role and split `DATABASE_URL` from
  `DATABASE_MIGRATION_URL` before this faces other people's data.
- **Postiz** is not part of v1. The publisher is a direct LinkedIn API client. Postiz
  (AGPL-3.0) comes back as an external service for the multi-channel milestone, unmodified and
  driven over its public API.

---

## Rebranding, and staying rebranded

```bash
node scripts/rebrand-to-merrit.mjs          # dry run, prints how many lines would change
node scripts/rebrand-to-merrit.mjs --write  # apply
```

The script only rewrites display strings. The `@rakazo/*` package scope, `RAKAZO_*` env vars
and type names such as `RakazoDesktop` are left alone on purpose: they are code namespaces,
not product marks, and renaming them would touch thousands of call sites and make upstream
syncs unmergeable.

---

## License

Merrit's own code (`apps/operator`, `scripts/rebrand-to-merrit.mjs`, `NOTICE`) is copyright
Zeyad Hussein. The forked shell remains Apache-2.0 from Rakazo, see `LICENSE` and `NOTICE`.
No AGPL code is linked in this build. No code from OpenBot (PolyForm Noncommercial) is present.
