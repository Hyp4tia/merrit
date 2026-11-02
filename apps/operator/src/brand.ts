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

// The brand file is the single source of truth for how a client sounds. Everything the
// model sees about voice, claims and banned phrasing comes from here, so a new client is
// one YAML file and no code change.
export function loadBrand(file: string, slug: string): Brand {
  const raw = parse(readFileSync(file, "utf8")) as Record<string, any>;
  const client = raw.client ?? {};
  const positioning = raw.positioning ?? {};
  const audience = raw.audience ?? {};
  const voice = raw.voice ?? {};
  const languages = raw.languages ?? {};
  const offers = raw.offers ?? {};

  const offerLines = [
    offers.lead_offer &&
      `${offers.lead_offer.name}: site ${offers.lead_offer.site_price_egp} EGP (${offers.lead_offer.site_payment_split}), ${offers.lead_offer.marketing_retainer_egp_month} EGP per month for marketing, ${offers.lead_offer.marketing_note}`,
    offers.site_only &&
      `Site only: ${offers.site_only.price_egp} EGP, or ${offers.site_only.share}. ${offers.site_only.no_log_rule}`,
    offers.extras &&
      Object.entries(offers.extras)
        .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value} EGP`)
        .join("; "),
    Array.isArray(offers.rules) ? `Rules: ${offers.rules.join("; ")}` : "",
  ].filter(Boolean) as string[];

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
    banned: asList(raw.banned),
    proofAllowed: asList(raw.proof?.allowed),
    proofNever: asList(raw.proof?.never),
    cta: raw.cta?.primary ?? "book a call",
    offers: offerLines,
    cadence: raw.cadence?.linkedin_personal ? `${raw.cadence.linkedin_personal} per week` : "",
  };
}
