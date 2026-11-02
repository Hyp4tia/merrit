#!/usr/bin/env node
// Rebrands the upstream shell's user-facing copy from Rakazo to Merrit.
//
// Scope is deliberate: only display strings change. Internal identifiers stay as they are,
// because they are code namespaces rather than product marks, and Apache-2.0 does not ask
// for a mechanical rename of every symbol:
//   - the @rakazo/* package scope and RAKAZO_* env vars
//   - types such as RakazoDesktop and RakazoDesktopDevice
//   - database, route and storage keys
// Renaming those would touch thousands of call sites for no user-visible benefit and would
// make future upstream syncs unmergeable.
//
// Run with --write to apply, without it to see the diff count. Safe to re-run.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const TARGETS = ["apps/web/src", "apps/web/index.html", "apps/api/src", "packages"];
const EXTENSIONS = new Set([".ts", ".tsx", ".html", ".json", ".md"]);
const SKIP = /(\.test\.|\.spec\.|__snapshots__|node_modules|\/dist\/|\/e2e\/)/;

// A capital Rakazo followed by another capital letter is a compound identifier
// (RakazoDesktop), never prose. Import paths and lowercase identifiers carry the scope.
const IDENTIFIER = /Rakazo(?=[A-Z])|@rakazo\/|RAKAZO_|\/rakazo\b/;

function* walk(target) {
  const full = path.join(ROOT, target);
  let info;
  try {
    info = statSync(full);
  } catch {
    return;
  }
  if (info.isFile()) {
    yield full;
    return;
  }
  for (const entry of readdirSync(full)) {
    const child = path.join(full, entry);
    const childInfo = statSync(child);
    if (childInfo.isDirectory()) {
      if (!SKIP.test(child + "/")) yield* walk(path.relative(ROOT, child));
    } else if (EXTENSIONS.has(path.extname(child)) && !SKIP.test(child)) {
      yield child;
    }
  }
}

let files = 0;
let lines = 0;
for (const target of TARGETS) {
  for (const file of walk(target)) {
    const original = readFileSync(file, "utf8");
    if (!original.includes("Rakazo")) continue;
    const rewritten = original
      .split("\n")
      .map((line) => {
        if (!line.includes("Rakazo") || IDENTIFIER.test(line)) return line;
        lines += 1;
        return line.replaceAll("Rakazo", "Merrit");
      })
      .join("\n");
    if (rewritten === original) continue;
    files += 1;
    if (WRITE) writeFileSync(file, rewritten, "utf8");
  }
}

console.log(`${WRITE ? "rewrote" : "would rewrite"} ${lines} line(s) in ${files} file(s)`);
if (!WRITE) console.log("run again with --write to apply");
