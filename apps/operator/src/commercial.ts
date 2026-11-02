import type { Brand } from "./brand.ts";
import type { Violation } from "./validate.ts";

export interface CommercialFacts {
  /** Every numeric value that appears in the offers block, normalised. */
  amounts: Set<string>;
  /** Lowercased offers text, used to decide whether a commercial term is offered at all. */
  text: string;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/** Strips thousand separators and trailing zero decimals so 12,000 and 12000 compare equal. */
export function normalizeAmount(raw: string): string {
  const cleaned = normalizeDigits(raw).replace(/[,\u066C\u066B\s]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? String(value) : cleaned;
}

const NUMBER = /(?<![\w.])(\d{1,3}(?:[,\u066C]\d{3})+|\d+(?:\.\d+)?)/g;
const CURRENCY = /(egp|e\.g\.p|\ble\b|جنيه|ج\.م|usd|\$|dollar|aed|ريال|درهم)/i;
const PERCENT = /(%|٪|\bpercent\b|بالمئة|في المئة)/i;
const DURATION =
  /\b(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)\b|(يوم|أيام|اسبوع|أسابيع|شهر|أشهر|سنة|سنوات|ساعة|ساعات)/i;

// Commercial structures the client does not sell. A term only trips the guard when the offers
// block does not mention it, so an offered structure can never be blocked by mistake.
const STRUCTURE_TERMS: string[] = [
  "scoping week",
  "scope week",
  "scoping call",
  "discovery phase",
  "discovery call",
  "audit",
  "hourly",
  "per hour",
  "day rate",
  "fixed scope",
  "milestone",
  "package",
  "tier",
  "pricing plan",
  "discount",
  "free trial",
  "trial period",
  "setup fee",
  "onboarding fee",
  "rush fee",
  "minimum contract",
  "contract term",
  "سعر الساعة",
  "باقة تسعير",
  "خصم",
  "تدقيق",
  "فترة تجريبية",
  "استشارة مجانية",
];

export function extractCommercialFacts(brand: Brand): CommercialFacts {
  const text = brand.offers.join("\n").toLowerCase();
  const amounts = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    amounts.add(normalizeAmount(match[1] ?? match[0]));
  }
  return { amounts, text };
}

/**
 * The guard that makes invented commercial terms impossible rather than unlikely.
 *
 * Every currency amount, percentage and duration in the draft has to trace back to a figure in
 * the brand file's offers block, and every commercial structure word has to appear there too.
 * Context decides the category: a bare number describing a detail ("six taps", "3 branches")
 * is not a commercial claim and is ignored, while "500 EGP", "10 percent" and "6 weeks" are.
 */
export function checkCommercialTerms(body: string, facts: CommercialFacts): Violation[] {
  const violations: Violation[] = [];
  const text = normalizeDigits(body);

  for (const match of text.matchAll(NUMBER)) {
    const full = match[0];
    // A short window after the number carries its unit: "12,000 EGP", "10 percent", "6 weeks".
    const window = text.slice(match.index ?? 0, (match.index ?? 0) + full.length + 24);
    const category = CURRENCY.test(window)
      ? "amount"
      : PERCENT.test(window)
        ? "percentage"
        : DURATION.test(window)
          ? "duration"
          : null;
    if (!category) continue;

    const value = normalizeAmount(match[1] ?? full);
    if (!facts.amounts.has(value)) {
      violations.push({
        rule: `commercial-${category}`,
        detail: `"${full}" is not a figure in the brand file offers block`,
      });
    }
  }

  const lower = text.toLowerCase();
  for (const term of STRUCTURE_TERMS) {
    if (lower.includes(term) && !facts.text.includes(term)) {
      violations.push({
        rule: "commercial-structure",
        detail: `"${term}" is not part of an offered engagement in the brand file`,
      });
    }
  }

  // Invented engagement scaffolding usually arrives with a price attached to a phase rather
  // than a deliverable, which is the exact shape of the first bug this guards against.
  if (/\b(phase|stage)\s+(one|two|three|1|2|3)\b/i.test(lower) && !facts.text.includes("phase")) {
    violations.push({
      rule: "commercial-structure",
      detail: "phased engagement is not an offered structure",
    });
  }

  return violations;
}
