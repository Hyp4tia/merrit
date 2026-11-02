import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// pnpm dev and the CLI both read the repo .env. Values already in the environment win,
// so a shell override never gets clobbered by a stale file.
function loadDotEnv(): void {
  if (process.env.MERRIT_ENV_LOADED) return;
  const file = path.join(repoRoot, ".env");
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    process.env.MERRIT_ENV_LOADED = "1";
    return;
  }
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    const key = match?.[1];
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = (match?.[2] ?? "").replace(/^["']|["']$/g, "");
  }
  process.env.MERRIT_ENV_LOADED = "1";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See README.md for the .env block.`);
  return value;
}

loadDotEnv();

export const config = {
  port: Number(process.env.OPERATOR_PORT ?? 3300),
  databaseUrl: required("DATABASE_URL"),
  brandFile: process.env.MERRIT_BRAND_FILE ?? path.join(repoRoot, "..", "brand", "kot.yaml"),
  clientSlug: process.env.MERRIT_CLIENT ?? "kot",
  llm: {
    baseUrl: (process.env.MERRIT_LLM_BASE_URL ?? "https://api.commandcode.ai/provider/v1").replace(
      /\/$/,
      "",
    ),
    apiKey: required("MERRIT_LLM_API_KEY"),
    model: process.env.MERRIT_LLM_MODEL ?? "deepseek/deepseek-v4.1-flash",
    maxTokens: Number(process.env.MERRIT_LLM_MAX_TOKENS ?? 1200),
    temperature: Number(process.env.MERRIT_LLM_TEMPERATURE ?? 0.7),
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
    // LinkedIn accepts an http redirect only on localhost, not on 127.0.0.1.
    redirectUri:
      process.env.LINKEDIN_REDIRECT_URI ??
      `http://localhost:${Number(process.env.OPERATOR_PORT ?? 3300)}/oauth/linkedin/callback`,
    // LinkedIn retires API versions about a year after release. Override if the call 426s.
    version: process.env.LINKEDIN_VERSION ?? "202601",
  },
  kitDir: process.env.MERRIT_KIT_DIR ?? path.join(repoRoot, "..", ".merrit-kit"),
  // Env-level dry run. `publish --dry-run` overrides it per call; either one stops before the
  // LinkedIn POST and records the item as dry_run so it can never read as published.
  dryRun: /^(1|true|yes)$/i.test(process.env.MERRIT_DRY_RUN ?? ""),
} as const;
