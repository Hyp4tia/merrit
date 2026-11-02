import type { Brand, Language } from "./brand.ts";
import { chatJson } from "./llm.ts";
import { describeViolations, validatePost, type Violation } from "./validate.ts";

export interface Angle {
  key: string;
  brief: string;
  language: Language;
}

export const PROMPT_VERSION = "merrit-linkedin-v1";
const MAX_ATTEMPTS = 3;

// Each angle targets a different objection or differentiator so seven drafts read as a
// deliberate week of content, not seven paraphrases of one idea.
export const DEFAULT_ANGLES: Angle[] = [
  {
    key: "cheap-site-objection",
    language: "en",
    brief: "Answer the objection 'why not a cheap Wix site'. Do not mention Wix by name. Explain what a cheap site costs an owner later, in concrete operational terms, and what a maintained one does differently.",
  },
  {
    key: "production-grade",
    language: "ar",
    brief: "Explain the difference between a prototype and a system that holds up in production, from the point of view of a small business owner. Use one concrete failure mode a business actually feels, such as a booking that silently does not arrive.",
  },
  {
    key: "leng-proof",
    language: "en",
    brief: "Use the one allowed proof point: Leng was built at Nile University and the repository is public. Say what that proves about how the work is done. Do not claim customers, revenue or a client relationship.",
  },
  {
    key: "engagement-and-price",
    language: "en",
    brief: "Lay out how an engagement works and what it costs, using only the prices in the brand file. No discounts, no guarantees of customers. Mention the deposit rule and that there is no lock-in on the marketing retainer.",
  },
  {
    key: "maintenance-objection",
    language: "ar",
    brief: "Answer the objection 'who maintains this after you leave'. Be concrete about ownership, handover and what the owner keeps. Do not promise ongoing free support.",
  },
  {
    key: "outcomes-not-tech",
    language: "en",
    brief: "Write for owners who buy outcomes, not technology. Argue that the unit of success is a filled booking or a returning customer, and that the technology only matters insofar as it produces those.",
  },
  {
    key: "bilingual-delivery",
    language: "ar",
    brief: "Make the case for bilingual Arabic and English delivery in this market: who reads which language, and what breaks when a business only speaks one of them to its customers.",
  },
];

function systemPrompt(brand: Brand): string {
  return [
    `You write LinkedIn posts for ${brand.name}, ${brand.category}.`,
    `Register: ${brand.register}.`,
    `Primary audience: ${brand.audience}.`,
    `One-liner: ${brand.oneLiner}`,
    "",
    "The post is published from the founder's personal LinkedIn profile. Write in the first person of a firm, not a solo freelancer, unless a founder note is explicitly asked for.",
    "",
    "RULES THAT ARE NOT NEGOTIABLE",
    `- Never use an em dash or an en dash. Use a full stop, a comma or a middot.`,
    `- No exclamation marks. No emoji in the body.`,
    `- Banned phrases: ${brand.banned.join("; ")}.`,
    "- Never invent clients, testimonials, metrics, revenue, booking counts or delivered outcomes.",
    `- The only proof points that exist: ${brand.proofAllowed.join("; ")}. Refer to the demos as demos, never as clients.`,
    `- Never say or imply: ${brand.proofNever.join("; ")}.`,
    "- Do not use the words 'we are passionate', 'our clients love', 'trusted by', 'game changer', 'unlock' or 'cutting-edge'.",
    `- Voice: ${brand.voice.tone}. ${brand.voice.claimStyle}. ${brand.voice.sentenceLength} sentences.`,
    `- Avoid: ${brand.voice.avoid.join("; ")}.`,
    "",
    "COMMERCIAL TERMS. These are the only ones that exist. Do not invent scoping weeks, audits,",
    "discovery phases, packages, tiers, hourly rates, milestone structures, discounts or add-ons",
    "that are not on this list, and do not imply one exists.",
    ...brand.offers.map((offer) => `- ${offer}`),
    "",
    "STYLE ANCHORS. Match the register of the good examples, never the bad ones.",
    ...brand.voice.goodExamples.map((example) => `good: ${example}`),
    ...brand.voice.badExamples.map((example) => `bad: ${example}`),
    "",
    'Return JSON only, no prose around it: {"body": "<the full post text>", "angle": "<one line describing what this post argues>"}',
  ].join("\n");
}

function userPrompt(brand: Brand, angle: Angle, retry: { violations: Violation[]; previousBody: string } | null, rejectReason: string | null): string {
  const languageRule =
    angle.language === "ar"
      ? `Write in ${brand.languages.ar}, right to left script, using Arabic punctuation (,، and .). No Latin words except proper nouns and numbers. ${brand.languages.arabicRule}`
      : `Write in ${brand.languages.en}. Pick one spelling convention and keep it consistent.`;

  const lines = [
    `LANGUAGE: ${languageRule}`,
    `LENGTH: 700 to 1300 characters. Short paragraphs, blank line between them.`,
    `ANGLE: ${angle.brief}`,
    `Call to action: ${brand.cta}, only where it reads naturally. No links.`,
  ];

  if (brand.cadence) lines.push(`Cadence context: this is one of ${brand.cadence} on this profile.`);

  if (rejectReason) {
    lines.push("", `The human owner rejected the previous draft. Their reason, verbatim: "${rejectReason}". Fix exactly that while keeping the angle.`);
  }

  if (retry) {
    lines.push(
      "",
      "Your previous attempt broke these brand rules and was thrown away:",
      describeViolations(retry.violations),
      "",
      "Previous attempt, for reference only:",
      retry.previousBody,
    );
  }

  return lines.join("\n");
}

export interface GeneratedDraft {
  body: string;
  angleSummary: string;
  language: Language;
  attempts: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export async function generateDraft(
  brand: Brand,
  angle: Angle,
  options: { rejectReason?: string | null; previousBody?: string | null } = {},
): Promise<GeneratedDraft> {
  const system = systemPrompt(brand);
  let retry: { violations: Violation[]; previousBody: string } | null = null;
  let rejectReason = options.rejectReason ?? null;
  let lastViolations: Violation[] = [];
  // Every attempt costs tokens, including the discarded ones, so the queue reports the
  // real number rather than the cost of a clean first try.
  let promptTokens = 0;
  let completionTokens = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { value, result } = await chatJson<{ body?: string; angle?: string }>([
      { role: "system", content: system },
      { role: "user", content: userPrompt(brand, angle, retry, rejectReason) },
    ]);

    promptTokens += result.promptTokens;
    completionTokens += result.completionTokens;
    const body = (value.body ?? "").trim();
    const violations = validatePost(body, brand, angle.language);
    if (violations.length === 0) {
      return {
        body,
        angleSummary: value.angle?.trim() || angle.key,
        language: angle.language,
        attempts: attempt,
        model: result.model,
        promptTokens,
        completionTokens,
      };
    }
    lastViolations = violations;
    retry = { violations, previousBody: body };
    // Retrying with the same rejection reason adds nothing; the rule violations are the fix.
    rejectReason = null;
  }

  throw new Error(`Draft failed brand validation after ${MAX_ATTEMPTS} attempts:\n${describeViolations(lastViolations)}`);
}
