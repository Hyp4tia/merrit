import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { ApprovalItem } from "./actions.ts";
import {
  approve,
  buildKitFor,
  checkDraft,
  clientSummaries,
  clients as clientsRegistry,
  editBody,
  getItem,
  itemWithHistory,
  listItems,
  publishApproved,
  rejectAndRegenerate,
  schedule,
} from "./actions.ts";
import { findClient } from "./clients.ts";
import { config } from "./config.ts";
import type { ItemFilters, ItemStatus } from "./db.ts";
import { initSchema } from "./db.ts";
import { authorizeUrl, exchangeCode, isConfigured } from "./publish-linkedin.ts";
import { delegate, listThreadSummaries, postToBot, threadView } from "./threads.ts";

const STATUS_ORDER = [
  "pending",
  "approved",
  "scheduled",
  "manual",
  "dry_run",
  "published",
  "deleted",
  "rejected",
];
const oauthStates = new Set<string>();

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function card(item: ApprovalItem): string {
  const badge = `<span class="badge ${item.status}">${item.status}</span>`;
  const lang = `<span class="badge lang">${item.language === "ar" ? "AR" : "EN"}</span>`;
  const when = new Date(item.created_at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const dir = item.language === "ar" ? "rtl" : "ltr";

  const actions: string[] = [];
  if (item.status === "pending") {
    actions.push(`<button data-act="approve" data-id="${item.id}">Approve</button>`);
    actions.push(`<button class="ghost" data-act="reject" data-id="${item.id}">Reject</button>`);
  }
  // No publish control anywhere in the UI in this build. Dry run is the only payload action.
  if (["approved", "scheduled", "manual"].includes(item.status)) {
    actions.push(`<button data-act="dry-run" data-id="${item.id}">Dry run</button>`);
  }
  actions.push(`<button class="ghost" data-act="kit" data-id="${item.id}">Publish kit</button>`);

  const published = item.published_url
    ? `<p class="meta"><a href="${escapeHtml(item.published_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.published_url)}</a></p>`
    : "";
  const kitPath = item.kit_path ? `<p class="meta mono">kit: ${escapeHtml(item.kit_path)}</p>` : "";
  const reason = item.reject_reason
    ? `<p class="meta reason">rejected: ${escapeHtml(item.reject_reason)}</p>`
    : "";
  const review = item.review_reason
    ? `<p class="meta review">flagged for review: ${escapeHtml(item.review_reason)}</p>`
    : "";

  return `<article class="card" data-status="${item.status}">
  <header>
    <div class="tags">${badge}${lang}</div>
    <span class="meta">${escapeHtml(item.angle)}</span>
  </header>
  <div class="body" dir="${dir}">${escapeHtml(item.body)}</div>
  ${review}${reason}${published}${kitPath}
  <footer class="row">
    <span class="meta">${when} · ${escapeHtml(item.model ?? "no model")} · attempt ${item.attempts} · <span class="mono">${item.id.slice(0, 8)}</span></span>
    <span class="actions">${actions.join("")}</span>
  </footer>
</article>`;
}

function page(items: ApprovalItem[]): string {
  const counts = STATUS_ORDER.map((status) => {
    const total = items.filter((item) => item.status === status).length;
    return total ? `<span class="count ${status}">${total} ${status}</span>` : "";
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Merrit · approval queue</title>
<style>
  :root { --navy:#051D35; --blue:#0D66D4; --line:#d8dee6; --ink:#0d1b2a; --muted:#5b6b7c; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f8fa; color:var(--ink);
    font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Geist, system-ui, sans-serif; }
  header.top { background:var(--navy); color:#fff; padding:22px 28px; display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; }
  header.top h1 { margin:0; font-size:19px; letter-spacing:.2px; font-weight:600; }
  header.top p { margin:0; color:#9fb3c8; font-size:13px; }
  main { max-width:1000px; margin:0 auto; padding:26px 20px 80px; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:22px; }
  .count { font-size:12px; padding:4px 9px; border-radius:999px; background:#e8edf3; color:var(--muted); text-transform:uppercase; letter-spacing:.6px; }
  .count.pending { background:#fff4d6; color:#7a5b00; }
  .count.approved { background:#dcf0e2; color:#1c6b38; }
  .count.published { background:#dbe7ff; color:#0b3f8f; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin-bottom:14px; }
  .card header { display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; }
  .tags { display:flex; gap:6px; }
  .badge { font-size:11px; text-transform:uppercase; letter-spacing:.7px; padding:3px 8px; border-radius:5px; background:#e8edf3; color:var(--muted); }
  .badge.pending { background:#fff4d6; color:#7a5b00; }
  .badge.approved { background:#dcf0e2; color:#1c6b38; }
  .badge.published { background:#dbe7ff; color:#0b3f8f; }
  .badge.rejected { background:#f7dede; color:#8a2b2b; }
  .badge.manual { background:#efe3ff; color:#5b2b8a; }
  .badge.lang { background:var(--navy); color:#fff; }
  .body { white-space:pre-wrap; margin:14px 0; font-size:15px; }
  .body[dir="rtl"] { font-family:"Noto Sans Arabic", "Geeza Pro", serif; font-size:16px; }
  .meta { color:var(--muted); font-size:12.5px; margin:6px 0 0; }
  .meta.reason { color:#8a2b2b; }
  .meta.review { color:#6b2b00; background:#ffe9d6; border:1px solid #f0c9a8; padding:8px 10px; border-radius:8px; }
  .mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .row { display:flex; justify-content:space-between; gap:14px; align-items:center; flex-wrap:wrap; margin-top:14px;
    border-top:1px solid #eef1f5; padding-top:12px; }
  button { font:inherit; font-size:13px; padding:7px 14px; border-radius:8px; border:1px solid var(--blue);
    background:var(--blue); color:#fff; cursor:pointer; }
  button.ghost { background:#fff; color:var(--blue); }
  button:hover { filter:brightness(1.06); }
  button[disabled] { opacity:.5; cursor:default; }
  #toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:var(--navy); color:#fff;
    padding:10px 16px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; max-width:80vw; }
  #toast.show { opacity:1; }
</style>
</head>
<body>
<header class="top">
  <h1>Merrit</h1>
  <p>Approval queue · ${escapeHtml(config.clientSlug)} · publishing disabled · dry run only</p>
</header>
<main>
  <div class="toolbar">
    ${counts || '<span class="count">queue empty</span>'}
    <span style="flex:1"></span>
    <button data-act="generate" data-count="7"${items.length ? "" : ""}>Generate drafts</button>
    <button class="ghost" data-act="auth">Authorize LinkedIn</button>
  </div>
  ${items.length ? items.map(card).join("\n") : '<div class="card"><p class="meta">No drafts yet. Generate the first batch.</p></div>'}
</main>
<div id="toast"></div>
<script>
  const toastEl = document.getElementById('toast');
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastEl.timer);
    toastEl.timer = setTimeout(() => toastEl.classList.remove('show'), 6000);
  }
  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return response.json();
  }
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const action = button.dataset.act;
    const id = button.dataset.id;
    button.disabled = true;
    try {
      if (action === 'generate') {
        toast('Generating drafts. This calls the model once per angle.');
        const result = await post('/api/generate', { count: Number(button.dataset.count || 7) });
        toast(result.ok
          ? 'Created ' + result.created + ' drafts'
            + (result.flagged ? ', ' + result.flagged + ' flagged for review' : '')
            + (result.failures.length ? ', ' + result.failures.length + ' failed' : '')
          : 'Generation failed: ' + result.error);
        if (result.ok) setTimeout(() => location.reload(), 1400);
        return;
      }
      if (action === 'auth') {
        location.href = '/oauth/linkedin/start';
        return;
      }
      if (action === 'reject') {
        const reason = prompt('Why is this rejected? The reason drives the rewrite.');
        if (!reason) { button.disabled = false; return; }
        const result = await post('/api/items/' + id + '/reject', { reason });
        toast(result.ok ? (result.replacement ? 'Rejected and redrafted' : 'Rejected, redraft failed: ' + result.error) : result.error);
        setTimeout(() => location.reload(), 1200);
        return;
      }
      const result = await post('/api/items/' + id + '/' + action, {});
      if (!result.ok) { toast(result.error); button.disabled = false; return; }
      if (action === 'dry-run') {
        toast('Dry run: ' + (result.payload ? result.payload.wouldPostTo + ' as ' + result.payload.authorUrn : 'no payload'));
      } else if (action === 'kit') {
        toast('Kit written to ' + result.kit);
      } else {
        toast('Done');
      }
      setTimeout(() => location.reload(), 1500);
    } catch (error) {
      toast(String(error));
      button.disabled = false;
    }
  });
</script>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (req.method === "GET" && url.pathname === "/") {
      const items = await listItems();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(items));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/items") {
      const filters: ItemFilters = {};
      const client = url.searchParams.get("client");
      const status = url.searchParams.get("status");
      const channel = url.searchParams.get("channel");
      const language = url.searchParams.get("language");
      const q = url.searchParams.get("q");
      if (client) filters.client = client;
      if (status) filters.status = status as ItemStatus;
      if (channel) filters.channel = channel;
      if (language) filters.language = language;
      if (q) filters.q = q;
      json(res, 200, { items: await listItems(filters) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/clients") {
      json(res, 200, { clients: await clientSummaries() });
      return;
    }

    if (url.pathname === "/api/threads") {
      const clientSlug = url.searchParams.get("client") ?? "";
      if (req.method !== "GET") throw new Error("Use /api/threads/:bot for messages");
      const clientEntry = findClient(clientsRegistry(), clientSlug);
      json(res, 200, { ok: true, threads: await listThreadSummaries(clientEntry) });
      return;
    }

    const threadRoute = /^\/api\/threads\/([a-z0-9-]+)(\/messages)?$/.exec(url.pathname);
    if (threadRoute?.[1]) {
      const botId = threadRoute[1];
      const isMessages = Boolean(threadRoute[2]);
      // The body is read once: readJson drains the stream, so a second read would come back empty.
      const body = isMessages && req.method === "POST" ? await readJson(req) : {};
      const clientSlug = isMessages
        ? String(body.client ?? "")
        : (url.searchParams.get("client") ?? "");
      const clientEntry = findClient(clientsRegistry(), clientSlug);

      if (!isMessages && req.method === "GET") {
        json(res, 200, { ok: true, ...(await threadView(clientEntry, botId)) });
        return;
      }
      if (isMessages && req.method === "POST") {
        const result = await postToBot(clientEntry, botId, String(body.content ?? ""));
        json(res, 200, { ok: true, ...result });
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/delegate") {
      const body = await readJson(req);
      const clientEntry = findClient(clientsRegistry(), String(body.client ?? ""));
      const result = await delegate({
        client: clientEntry,
        fromBotId: String(body.from ?? ""),
        toBotId: String(body.to ?? ""),
        request: String(body.request ?? ""),
      });
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/check") {
      const body = await readJson(req);
      json(res, 200, {
        ok: true,
        ...checkDraft(
          String(body.client ?? ""),
          body.language === "ar" ? "ar" : "en",
          String(body.body ?? ""),
        ),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, linkedinConfigured: isConfigured() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req);
      const count = Math.min(Number(body.count ?? 7), 14);
      const { generateBatch } = await import("./actions.ts");
      const { config } = await import("./config.ts");
      const result = await generateBatch(
        count,
        undefined,
        String(body.client ?? config.clientSlug),
      );
      json(res, 200, {
        ok: true,
        created: result.created.length,
        flagged: result.flagged.length,
        failures: result.failures,
      });
      return;
    }

    const detailRoute = /^\/api\/items\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (detailRoute?.[1]) {
      const id = detailRoute[1];
      if (req.method === "GET") {
        json(res, 200, { ok: true, ...(await itemWithHistory(id)) });
        return;
      }
      if (req.method === "PATCH") {
        const body = await readJson(req);
        json(res, 200, { ok: true, item: await editBody(id, String(body.body ?? "")) });
        return;
      }
    }

    // Publishing is deliberately not routed over HTTP in this build: the UI must not be able to
    // reach it, so the CLI is the only publish surface. dry-run is the one action here that
    // produces a payload, and it sends nothing.
    const itemRoute = /^\/api\/items\/([0-9a-f-]{36})\/(approve|reject|dry-run|kit|schedule)$/.exec(
      url.pathname,
    );
    if (req.method === "POST" && itemRoute) {
      const id = itemRoute[1];
      const action = itemRoute[2];
      if (!id || !action) throw new Error(`Malformed item route: ${url.pathname}`);
      const body = await readJson(req);
      if (action === "approve") {
        json(res, 200, { ok: true, item: await approve(id) });
        return;
      }
      if (action === "reject") {
        const result = await rejectAndRegenerate(id, String(body.reason ?? ""));
        json(res, 200, {
          ok: true,
          replacement: Boolean(result.replacement),
          error: result.error,
          item: result.rejected,
        });
        return;
      }
      if (action === "dry-run") {
        const result = await publishApproved(id, {
          dryRun: true,
          accountId: body.account ? String(body.account) : undefined,
        });
        json(res, 200, { ok: true, ...result, kit: result.kit?.dir });
        return;
      }
      if (action === "kit") {
        const kit = await buildKitFor(id);
        json(res, 200, { ok: true, kit: kit.dir, files: kit.files });
        return;
      }
      if (action === "schedule") {
        const when = new Date(String(body.at ?? ""));
        if (Number.isNaN(when.getTime())) throw new Error("Invalid schedule time");
        json(res, 200, { ok: true, item: await schedule(id, when) });
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/oauth/linkedin/start") {
      if (!isConfigured())
        throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are not set in .env");
      const state = randomUUID();
      oauthStates.add(state);
      res.writeHead(302, { location: authorizeUrl(state) });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/oauth/linkedin/callback") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (error) throw new Error(`LinkedIn returned: ${error}`);
      if (!oauthStates.delete(state)) throw new Error("Unknown OAuth state, start the flow again");
      if (!code) throw new Error("No authorization code");
      const { personUrn } = await exchangeCode(code);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Merrit</title><body style="font:15px system-ui;padding:40px"><h1>LinkedIn connected</h1><p>Authorized as <code>${escapeHtml(personUrn)}</code>. You can close this tab.</p><p><a href="/">Back to the queue</a></p></body>`,
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/kit") {
      const id = url.searchParams.get("id") ?? "";
      const item = await getItem(id);
      if (!item?.kit_path) throw new Error("No kit for that item");
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end(readFileSync(`${item.kit_path}/post.md`, "utf8"));
      return;
    }

    json(res, 404, { ok: false, error: `No route for ${route}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A failed turn is also written to the log: the response alone is easy to miss in the UI.
    console.error(`[merrit] ${req.method} ${req.url} failed: ${message}`, error);
    json(res, 200, { ok: false, error: message });
  }
});

await initSchema();
server.listen(config.port, "127.0.0.1", () => {
  console.log(`[merrit] approval queue on http://127.0.0.1:${config.port}`);
});
