import { describe, expect, it } from "vitest";
import { testBrand } from "../test-support/brand-fixture.ts";
import { checkCommercialTerms, extractCommercialFacts, normalizeAmount } from "./commercial.ts";

const brand = testBrand();
const facts = extractCommercialFacts(brand);

function rules(body: string): string[] {
  return checkCommercialTerms(body, facts).map((violation) => violation.rule);
}

// The exact drafts that shipped the bug: a pricing post that invented an entire engagement
// structure while correctly avoiding invented numbers. Each must now be rejected.
describe("invented engagement structures", () => {
  it("rejects a paid scoping week", () => {
    const body =
      "Every engagement starts with a paid scoping week. We sit with your operation and write down what the software has to do.";
    expect(rules(body)).toContain("commercial-structure");
    expect(checkCommercialTerms(body, facts).map((violation) => violation.detail)).toContain(
      '"scoping week" is not part of an offered engagement in the brand file',
    );
  });

  it("rejects a fixed price for fixed scope", () => {
    const body =
      "From that we quote a fixed price for a fixed scope. If the scope changes, we re-quote in writing before anyone opens an editor.";
    expect(rules(body)).toContain("commercial-structure");
  });

  it("rejects a milestone tied balance", () => {
    const body =
      "Work starts on a deposit, and the balance is tied to milestones you can check: a flow that runs, a dashboard, a deploy.";
    const violations = checkCommercialTerms(body, facts);
    expect(violations.map((violation) => violation.rule)).toContain("commercial-structure");
    expect(violations.some((violation) => violation.detail.includes("milestone"))).toBe(true);
  });

  it("rejects an hourly rate, by term and by amount", () => {
    const body =
      "We charge an hourly rate of 500 EGP, billed in fifteen minute blocks against a timesheet.";
    const found = checkCommercialTerms(body, facts).map((violation) => violation.rule);
    expect(found).toContain("commercial-structure");
    expect(found).toContain("commercial-amount");
  });

  it("rejects a package tier", () => {
    const body =
      "Pick the Growth package tier at 25,000 EGP and we add a quarterly review on top of the build.";
    const found = checkCommercialTerms(body, facts).map((violation) => violation.rule);
    expect(found).toContain("commercial-structure");
    expect(found).toContain("commercial-amount");
  });

  it("rejects the full invented draft from the incident", () => {
    const body = [
      "People ask how we work before they ask what we build. Fair. Here is the shape of it.",
      "Every engagement starts with a paid scoping week. We sit with your operation and write down what the software has to do.",
      "From that we quote a fixed price for a fixed scope. Not an hourly rate that drifts.",
      "Work starts on a deposit, and the balance is tied to milestones you can check.",
    ].join("\n\n");
    const found = checkCommercialTerms(body, facts).map((violation) => violation.detail);
    expect(found.some((detail) => detail.includes("scoping week"))).toBe(true);
    expect(found.some((detail) => detail.includes("fixed scope"))).toBe(true);
    expect(found.some((detail) => detail.includes("milestone"))).toBe(true);
  });
});

describe("figures that are not in the brand file", () => {
  it("rejects an invented currency amount", () => {
    const body = "A landing page on its own is 2,500 EGP, and we deliver it in a week.";
    expect(rules(body)).toContain("commercial-amount");
  });

  it("rejects an invented percentage", () => {
    const body = "We ask for 25 percent up front and the rest when the site goes live.";
    expect(rules(body)).toContain("commercial-percentage");
  });

  it("rejects an invented duration", () => {
    const body = "Most builds are done in 3 weeks and the retainer starts after that.";
    expect(rules(body)).toContain("commercial-duration");
  });

  it("rejects a duration even without a price, unpublished commitments are still claims", () => {
    const body = "Every message gets an answer within 24 hours, from the person doing the work.";
    expect(rules(body)).toContain("commercial-duration");
  });
});

describe("copy that must keep passing", () => {
  it("accepts the real pricing post with only brand file figures", () => {
    const body = [
      "People ask what an engagement with Kōt Dynamics actually looks like, so here is the whole thing in one post.",
      "A site is 12,000 EGP. Half at signing, half at launch. Nothing starts before the deposit clears, ours included.",
      "If you would rather tie the price to the work the site brings in, it is 10 percent of site-attributed jobs for 12 months, settled monthly against a weekly log. No weekly log means no percentage, and the site price becomes 15,000 EGP.",
      "Optional additions: photo shoot at 4,000 EGP, extra page at 3,000, booking with reminders at 6,000.",
      "Marketing is 6,000 EGP per month. Brand page, both branches in one feed, month to month, no lock-in.",
      "12,000 EGP is the floor. We do not go under it and we do not do free work in any form.",
      "What we do not sell is customers. We guarantee the work: the site loads, the booking flow holds, the log adds up.",
    ].join("\n\n");
    expect(checkCommercialTerms(body, facts)).toEqual([]);
  });

  it("accepts an Arabic draft using the same figures in Arabic digits", () => {
    const body = [
      "الموقع بـ ١٢٬٠٠٠ جنيه، نصفها عند التوقيع ونصفها عند الإطلاق.",
      "التسويق ٦٠٠٠ جنيه شهرياً، من شهر إلى شهر، بدون ارتباط.",
      "جلسة تصوير بـ ٤٠٠٠ جنيه، وصفحة إضافية بـ ٣٠٠٠ جنيه.",
    ].join("\n\n");
    expect(checkCommercialTerms(body, facts)).toEqual([]);
  });

  it("ignores plain counts that are not commercial claims", () => {
    const body =
      "A contact form staleness check found 3 broken forms in a single afternoon of looking.";
    expect(checkCommercialTerms(body, facts)).toEqual([]);
  });

  it("accepts the offered retainer wording", () => {
    const body = "The marketing retainer is 6,000 EGP per month, and there is no lock-in.";
    expect(checkCommercialTerms(body, facts)).toEqual([]);
  });
});

describe("normalisation", () => {
  it("treats separator styles as the same figure", () => {
    expect(normalizeAmount("12,000")).toBe("12000");
    expect(normalizeAmount("12000")).toBe("12000");
    expect(normalizeAmount("١٢٬٠٠٠")).toBe("12000");
    expect(normalizeAmount("12000.00")).toBe("12000");
  });

  it("only allows figures the offers block actually contains", () => {
    expect([...facts.amounts].sort()).toEqual(
      ["10", "10000", "12", "12000", "15000", "3000", "4000", "6000"].sort(),
    );
  });
});
