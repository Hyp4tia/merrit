import type { ItemStatus } from "./actions.ts";
import {
  approve,
  brand,
  buildKitFor,
  generateBatch,
  getItem,
  listItems,
  markDeleted,
  markPublishedManually,
  publishApproved,
  queueStats,
  rejectAndRegenerate,
  schedule,
} from "./actions.ts";
import { config } from "./config.ts";
import { initSchema, pool } from "./db.ts";
import { DEFAULT_ANGLES } from "./generate.ts";

const [command, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? undefined : rest[index + 1];
}

function positional(index: number): string | undefined {
  return rest.filter((arg) => !arg.startsWith("--"))[index];
}

function shortBody(body: string, limit = 320): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

function usage(): void {
  console.log(`Merrit operator

  generate [--count N]           draft posts into the approval queue
  list [--status pending]        show the queue
  brand                          what the brand file actually loaded
  show <id>                      full text of one draft
  approve <id>                   approve for publishing
  reject <id> --reason "..."     reject and redraft with that reason
  publish <id> [--dry-run] [--account id]   publish an approved draft, or rehearse it
  kit <id>                       write the copy/download publish kit
  published <id> --url <url>     record a manual publish
  deleted <id> [--note "..."]    mark a published post as taken down
  stats                          queue counts, live posts and token spend
  schedule <id> --at <iso>       schedule an approved draft

  MERRIT_DRY_RUN=1 makes every publish a rehearsal. A dry run never calls LinkedIn and
  records the item as dry_run, never as published.

Queue UI: http://127.0.0.1:${config.port}`);
}

await initSchema();

try {
  switch (command) {
    case "generate": {
      const count = Number(flag("count") ?? 7);
      const only = flag("angle");
      const angles = only ? DEFAULT_ANGLES.filter((angle) => angle.key === only) : DEFAULT_ANGLES;
      if (only && angles.length === 0)
        throw new Error(
          `No angle named ${only}. Known: ${DEFAULT_ANGLES.map((a) => a.key).join(", ")}`,
        );
      const brandFile = brand();
      console.log(`[merrit] ${brandFile.name}: drafting ${count} posts with ${config.llm.model}`);
      const { created, flagged, failures } = await generateBatch(count, angles);
      for (const item of created) {
        console.log(`  + ${item.id.slice(0, 8)}  ${item.language}  ${item.angle}`);
        console.log(`    ${shortBody(item.body)}`);
      }
      for (const item of flagged) {
        console.log(`  ~ ${item.id.slice(0, 8)}  ${item.language}  flagged for review`);
        console.log(`    ${shortBody(item.review_reason ?? "", 200)}`);
      }
      for (const failure of failures) console.log(`  ! ${failure.angle}: ${failure.error}`);
      const counted = [...created, ...flagged];
      const promptTokens = counted.reduce((total, item) => total + (item.prompt_tokens ?? 0), 0);
      const completionTokens = counted.reduce(
        (total, item) => total + (item.completion_tokens ?? 0),
        0,
      );
      console.log(
        `[merrit] created ${created.length}, flagged ${flagged.length}, failed ${failures.length}, tokens ${promptTokens} in / ${completionTokens} out`,
      );
      break;
    }
    case "list": {
      const status = flag("status") as ItemStatus | undefined;
      const items = await listItems(status ? { status } : {});
      for (const item of items) {
        console.log(
          `${item.id.slice(0, 8)}  ${item.status.padEnd(9)} ${item.language}  ${item.angle}`,
        );
        console.log(`          ${shortBody(item.body, 160)}`);
        if (item.published_url) console.log(`          ${item.published_url}`);
      }
      console.log(`[merrit] ${items.length} item(s)`);
      break;
    }
    case "brand": {
      const brandFile = brand();
      console.log(`file: ${config.brandFile}`);
      console.log(`client: ${brandFile.name} (${brandFile.slug})`);
      console.log(`offers lines: ${brandFile.offers.length}`);
      console.log(`commitments parsed: ${brandFile.commitments.length}`);
      for (const promise of brandFile.commitments) console.log(`  - ${promise}`);
      console.log(`banned phrases: ${brandFile.banned.length}`);
      break;
    }
    case "show": {
      const id = positional(0);
      if (!id) throw new Error("show needs an id");
      const item =
        (await getItem(id)) ??
        (await listItems()).find((candidate) => candidate.id.startsWith(id)) ??
        null;
      if (!item) throw new Error(`No item ${id}`);
      console.log(`${item.id}  ${item.status}  ${item.language}\n`);
      console.log(item.body);
      break;
    }
    case "approve": {
      const id = positional(0);
      if (!id) throw new Error("approve needs an id");
      console.log(`approved ${(await approve(id)).id}`);
      break;
    }
    case "reject": {
      const id = positional(0);
      const reason = flag("reason");
      if (!id || !reason) throw new Error('reject needs an id and --reason "..."');
      const result = await rejectAndRegenerate(id, reason);
      console.log(`rejected ${result.rejected.id}`);
      console.log(
        result.replacement
          ? `replacement ${result.replacement.id}`
          : `redraft failed: ${result.error}`,
      );
      break;
    }
    case "publish": {
      const id = positional(0);
      if (!id) throw new Error("publish needs an id");
      const result = await publishApproved(id, {
        dryRun: rest.includes("--dry-run"),
        accountId: flag("account"),
      });
      if (result.mode === "api") {
        console.log(`published ${result.url}`);
      } else if (result.mode === "dry-run") {
        const payload = result.payload;
        console.log("dry run, nothing was sent to LinkedIn");
        console.log(`  would POST to: ${payload?.wouldPostTo}`);
        console.log(`  author:        ${payload?.authorUrn}`);
        console.log(`  channel:       ${payload?.channel} (${payload?.language})`);
        console.log(`  kit:           ${payload?.kitPath}`);
        console.log(`  body (${payload?.body.length ?? 0} chars):`);
        console.log(payload?.body);
      } else {
        console.log(`publish blocked, kit at ${result.kit?.dir}`);
        console.log(result.detail);
      }
      break;
    }
    case "kit": {
      const id = positional(0);
      if (!id) throw new Error("kit needs an id");
      const kit = await buildKitFor(id);
      console.log(`kit: ${kit.dir}`);
      for (const file of kit.files) console.log(`  ${file}`);
      break;
    }
    case "published": {
      const id = positional(0);
      const url = flag("url");
      if (!id || !url) throw new Error("published needs an id and --url");
      console.log(`recorded ${(await markPublishedManually(id, url)).id} -> ${url}`);
      break;
    }
    case "deleted": {
      const id = positional(0);
      if (!id) throw new Error("deleted needs an id");
      const item = await markDeleted(id, flag("note") ?? "");
      console.log(`deleted ${item.id}`);
      console.log(
        `  kept for audit: ${item.published_url ?? "no url"} ${item.platform_post_id ?? ""}`,
      );
      break;
    }
    case "stats": {
      const stats = await queueStats();
      for (const [status, count] of Object.entries(stats.counts).sort()) {
        console.log(`  ${status.padEnd(10)} ${count}`);
      }
      console.log(`  published live (deleted excluded): ${stats.publishedLive}`);
      console.log(`  tokens ${stats.promptTokens} in / ${stats.completionTokens} out`);
      break;
    }
    case "schedule": {
      const id = positional(0);
      const at = flag("at");
      if (!id || !at) throw new Error("schedule needs an id and --at <iso>");
      console.log(`scheduled ${(await schedule(id, new Date(at))).id}`);
      break;
    }
    default:
      usage();
  }
} finally {
  await pool.end();
}
