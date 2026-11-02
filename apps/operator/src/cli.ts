import { DEFAULT_ANGLES } from "./generate.ts";
import {
  approve,
  brand,
  buildKitFor,
  generateBatch,
  getItem,
  listItems,
  markPublishedManually,
  publishApproved,
  rejectAndRegenerate,
  schedule,
  type ItemStatus,
} from "./actions.ts";
import { config } from "./config.ts";
import { initSchema, pool } from "./db.ts";

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
  show <id>                      full text of one draft
  approve <id>                   approve for publishing
  reject <id> --reason "..."     reject and redraft with that reason
  publish <id>                   publish an approved draft to LinkedIn
  kit <id>                       write the copy/download publish kit
  published <id> --url <url>     record a manual publish
  schedule <id> --at <iso>       schedule an approved draft

Queue UI: http://127.0.0.1:${config.port}`);
}

await initSchema();

try {
  switch (command) {
    case "generate": {
      const count = Number(flag("count") ?? 7);
      const only = flag("angle");
      const angles = only ? DEFAULT_ANGLES.filter((angle) => angle.key === only) : DEFAULT_ANGLES;
      if (only && angles.length === 0) throw new Error(`No angle named ${only}. Known: ${DEFAULT_ANGLES.map((a) => a.key).join(", ")}`);
      const brandFile = brand();
      console.log(`[merrit] ${brandFile.name}: drafting ${count} posts with ${config.llm.model}`);
      const { created, failures } = await generateBatch(count, angles);
      for (const item of created) {
        console.log(`  + ${item.id.slice(0, 8)}  ${item.language}  ${item.angle}`);
        console.log(`    ${shortBody(item.body)}`);
      }
      for (const failure of failures) console.log(`  ! ${failure.angle}: ${failure.error}`);
      const promptTokens = created.reduce((total, item) => total + (item.prompt_tokens ?? 0), 0);
      const completionTokens = created.reduce((total, item) => total + (item.completion_tokens ?? 0), 0);
      console.log(
        `[merrit] created ${created.length}, failed ${failures.length}, tokens ${promptTokens} in / ${completionTokens} out`,
      );
      break;
    }
    case "list": {
      const status = flag("status") as ItemStatus | undefined;
      const items = await listItems(status);
      for (const item of items) {
        console.log(`${item.id.slice(0, 8)}  ${item.status.padEnd(9)} ${item.language}  ${item.angle}`);
        console.log(`          ${shortBody(item.body, 160)}`);
        if (item.published_url) console.log(`          ${item.published_url}`);
      }
      console.log(`[merrit] ${items.length} item(s)`);
      break;
    }
    case "show": {
      const id = positional(0);
      if (!id) throw new Error("show needs an id");
      const item = await getItem(id) ?? (await listItems()).find((candidate) => candidate.id.startsWith(id)) ?? null;
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
      console.log(result.replacement ? `replacement ${result.replacement.id}` : `redraft failed: ${result.error}`);
      break;
    }
    case "publish": {
      const id = positional(0);
      if (!id) throw new Error("publish needs an id");
      const result = await publishApproved(id);
      if (result.mode === "api") {
        console.log(`published ${result.url}`);
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
