import type { Brand, Language } from "./brand.ts";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const ARABIC = /[\u0600-\u06FF]/;

export interface Violation {
  rule: string;
  detail: string;
}

// Brand rules are enforced on the way in, not trusted to the model. A draft that breaks
// them never reaches the queue, so nothing brand-damaging can be approved by accident.
export function validatePost(body: string, brand: Brand, language: Language): Violation[] {
  const violations: Violation[] = [];
  const text = body.trim();
  const lower = text.toLowerCase();

  if (!text) violations.push({ rule: "body", detail: "post is empty" });

  // Em and en dashes: the owner's rule covers all user-facing copy.
  for (const dash of ["\u2014", "\u2013"]) {
    if (text.includes(dash)) {
      violations.push({ rule: "dashes", detail: `contains the character ${JSON.stringify(dash)}; use a full stop or comma` });
    }
  }

  if (text.includes("!")) violations.push({ rule: "punctuation", detail: "exclamation mark in body copy" });
  if (EMOJI.test(text)) violations.push({ rule: "punctuation", detail: "emoji in body copy" });

  for (const phrase of brand.banned) {
    const needle = phrase.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();
    if (needle.length < 4) continue;
    if (lower.includes(needle)) {
      violations.push({ rule: "banned", detail: `banned phrase: "${phrase}"` });
    }
  }

  for (const kind of ["em dash", "emdash"]) {
    if (lower.includes(kind)) violations.push({ rule: "dashes", detail: `mentions "${kind}"` });
  }

  const chars = [...text].length;
  if (chars < 400) violations.push({ rule: "length", detail: `${chars} characters, under the 400 minimum` });
  if (chars > 2800) violations.push({ rule: "length", detail: `${chars} characters, over LinkedIn's 3000 limit` });

  if (language === "ar" && !ARABIC.test(text)) {
    violations.push({ rule: "language", detail: "Arabic draft contains no Arabic characters" });
  }
  if (language === "en" && (text.match(/[\u0600-\u06FF]/g) ?? []).length > 40) {
    violations.push({ rule: "language", detail: "English draft is mostly Arabic" });
  }

  // Proof discipline: the brand file forbids unqualified social proof.
  for (const banned of brand.proofNever) {
    const needle = banned.toLowerCase().split(" ").slice(0, 3).join(" ");
    if (needle.length > 8 && lower.includes(needle)) {
      violations.push({ rule: "proof", detail: `touches a forbidden proof claim: "${banned}"` });
    }
  }
  for (const phrase of ["trusted by", "our clients love", "clients rave"]) {
    if (lower.includes(phrase)) violations.push({ rule: "proof", detail: `unqualified social proof: "${phrase}"` });
  }

  return violations;
}

export function describeViolations(violations: Violation[]): string {
  return violations.map((v) => `- ${v.rule}: ${v.detail}`).join("\n");
}
