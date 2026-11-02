import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Language = "en" | "ar";

export interface Brand {
  slug: string;
  name: string;
  category: string;
  oneLiner: string;
  register: string;
  audience: string;
  objections: string[];
  differentiators: string[];
  voice: {
    tone: string;
    sentenceLength: string;
    person: string;
    claimStyle: string;
    avoid: string[];
    goodExamples: string[];
    badExamples: string[];
  };
  languages: { en: string; ar: string; arabicRule: string };
  banned: string[];
  proofAllowed: string[];
  proofNever: string[];
  cta: string;
  offers: string[];
  /** Promises Kōt makes in writing. Empty means it may promise no response time or guarantee. */
  commitments: string[];
  cadence: string;
}

// Brand files are hand-written YAML, so a list field may arrive as a single comma string.
// Normalising here keeps the prompt builders free of shape checks.
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string") {
    return value
      .split(/,\s*/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

// The offers block is the only place commercial facts may come from: the prompt shows it to
// the model, and commercial.ts diffs generated copy against the same text. Every figure the
// client actually sells must appear here, or the guard will reject a true statement.
function offerLines(offers: Record<string, any>): string[] {
  const lead = offers.lead_offer;
  const siteOnly = offers.site_only;
  return [
    lead &&
      `${lead.name}: site ${lead.site_price_egp} EGP (${lead.site_payment_split}), or ${lead.site_price_paid_in_full_egp} EGP paid in full; marketing retainer ${lead.marketing_retainer_egp_month} EGP per month, ${lead.marketing_note}`,
    siteOnly &&
      `Site only: ${siteOnly.price_egp} EGP, or ${siteOnly.share}. ${siteOnly.no_log_rule}`,
    offers.extras &&
      `Extras: ${Object.entries(offers.extras)
        .map(([key, value]) => `${key.replace(/_/g, " ")} ${value} EGP`)
        .join("; ")}`,
    Array.isArray(offers.rules) ? `Rules: ${offers.rules.join("; ")}` : "",
  ].filter(Boolean) as string[];
}

export function brandFromYaml(raw: string, slug: string): Brand {
  const parsed = parse(raw) as Record<string, any>;
  const client = parsed.client ?? {};
  const positioning = parsed.positioning ?? {};
  const audience = parsed.audience ?? {};
  const voice = parsed.voice ?? {};
  const languages = parsed.languages ?? {};

  return {
    slug,
    name: client.name ?? slug,
    category: client.category ?? "",
    oneLiner: positioning.one_liner ?? "",
    register: positioning.register ?? "",
    audience: audience.primary ?? "",
    objections: asList(audience.objections_to_answer),
    differentiators: asList(positioning.differentiators),
    voice: {
      tone: voice.tone ?? "",
      sentenceLength: voice.sentence_length ?? "",
      person: voice.person ?? "",
      claimStyle: voice.claim_style ?? "",
      avoid: asList(voice.avoid),
      goodExamples: asList(voice.good_examples),
      badExamples: asList(voice.bad_examples),
    },
    languages: {
      en: languages.en?.dialect ?? "neutral international English",
      ar: languages.ar?.dialect ?? "Modern Standard Arabic",
      arabicRule: languages.ar?.note ?? "",
    },
    banned: asList(parsed.banned),
    proofAllowed: asList(parsed.proof?.allowed),
    proofNever: asList(parsed.proof?.never),
    cta: parsed.cta?.primary ?? "book a call",
    offers: offerLines(parsed.offers ?? {}),
    commitments: asList(parsed.commitments?.promises),
    cadence: parsed.cadence?.linkedin_personal
      ? `${parsed.cadence.linkedin_personal} per week`
      : "",
  };
}

// The brand file is the single source of truth for how a client sounds. Everything the
// model sees about voice, claims and banned phrasing comes from here, so a new client is
// one YAML file and no code change.
export function loadBrand(file: string, slug: string): Brand {
  return brandFromYaml(readFileSync(file, "utf8"), slug);
}
