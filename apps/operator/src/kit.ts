import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { ApprovalItem } from "./db.ts";

export interface Kit {
  dir: string;
  files: string[];
}

const CHANNEL_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn, personal profile",
  linkedin_company: "LinkedIn, company page",
  instagram: "Instagram",
  x: "X",
};

// The fallback path. When an API is unavailable, missing a scope, or waiting on platform
// review, the owner still gets the copy handed to them in a form they can paste, plus the
// exact steps, so publishing never depends on our integration being approved.
export function buildKit(item: ApprovalItem, dirOverride?: string): Kit {
  const dir = dirOverride ?? path.join(config.kitDir, item.id);
  mkdirSync(dir, { recursive: true });

  const label = CHANNEL_LABEL[item.channel] ?? item.channel;
  const body = item.body.trim();
  const rtl = item.language === "ar" ? "\u200F" : "";

  const files: Array<[string, string]> = [
    ["post.txt", `${rtl}${body}\n`],
    [
      "post.md",
      [`# ${label} post`, "", `Language: ${item.language === "ar" ? "Arabic (MSA, RTL)" : "English"}`, "", "---", "", body, "", "---", ""].join("\n"),
    ],
    [
      "README.txt",
      [
        `Merrit publish kit`,
        `Item:   ${item.id}`,
        `Channel: ${label}`,
        `Language: ${item.language}`,
        `Status:  ${item.status}`,
        "",
        "How to publish by hand:",
        `1. Open ${label}.`,
        "2. Paste post.txt exactly as it is. Do not reflow the line breaks.",
        item.language === "ar" ? "3. Confirm the text renders right to left before posting." : "3. Confirm the first two lines read well in the preview.",
        "",
        "Override the published URL once posted:",
        `  pnpm exec tsx apps/operator/src/cli.ts published ${item.id} --url <url>`,
      ].join("\n"),
    ],
  ];

  for (const [name, content] of files) {
    writeFileSync(path.join(dir, name), content, "utf8");
  }

  return { dir, files: files.map(([name]) => path.join(dir, name)) };
}
