import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBrand } from "../test-support/brand-fixture.ts";

// The model is the one non-deterministic part, so it is replaced here. Everything below the
// call is the real pipeline: brand rules, then the commercial guard.
const replies: string[] = [];
const calls: string[] = [];

vi.mock("./llm.ts", () => ({
  chatJson: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    calls.push(messages[messages.length - 1]?.content ?? "");
    const body = replies.shift() ?? "";
    return {
      value: { body, angle: "stub angle" },
      result: { text: body, model: "stub-model", promptTokens: 100, completionTokens: 200 },
    };
  }),
}));

const { BrandReviewRequired, generateDraft } = await import("./generate.ts");

const brand = testBrand();
const angle = {
  key: "engagement-and-price",
  brief: "Lay out how an engagement works and what it costs.",
  language: "en" as const,
};

const CLEAN =
  "A booking flow that confirms on the phone and then drops the record is worse than no booking flow. " +
  "The owner finds out when the customer arrives and the chair is empty. " +
  "We test the boring path instead: bad connection, duplicate tap, phone lock screen, a customer who types Arabic into a Latin field. " +
  "That path is what a real Tuesday looks like in a clinic, and it is where most builds quietly stop. " +
  "So the failing case goes into the test suite before the feature exists, and the site ships with it. " +
  "Slower on the first day, faster every day after that, which is the whole argument for doing it this way.";

const INVENTED =
  "An engagement starts with a paid scoping week, then a fixed price for a fixed scope, " +
  "with the balance tied to milestones you can check. Marketing is an hourly rate after that.";

describe("commercial guard in the generation pipeline", () => {
  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
  });

  it("accepts a clean first draft without regenerating", async () => {
    replies.push(CLEAN);
    const draft = await generateDraft(brand, angle);
    expect(draft.body).toBe(CLEAN);
    expect(calls).toHaveLength(1);
  });

  it("regenerates once when the first draft invents commercial terms, then accepts", async () => {
    replies.push(
      `${CLEAN} ${INVENTED}`,
      `${CLEAN} Site plus marketing is 12,000 EGP, half at signing and half at launch.`,
    );
    const draft = await generateDraft(brand, angle);
    expect(draft.body).toContain("12,000 EGP");
    expect(calls).toHaveLength(2);
    // The retry prompt names the exact violations instead of asking for a generic rewrite.
    expect(calls[1]).toContain("scoping week");
    expect(calls[1]).toContain("COMMERCIAL TERMS");
  });

  it("flags for manual review when the second draft still invents terms", async () => {
    replies.push(`${CLEAN} ${INVENTED}`, `${CLEAN} ${INVENTED}`);
    await expect(generateDraft(brand, angle)).rejects.toBeInstanceOf(BrandReviewRequired);
    expect(calls).toHaveLength(2);
  });

  it("carries the named violations and the draft text on the review error", async () => {
    replies.push(`${CLEAN} ${INVENTED}`, `${CLEAN} ${INVENTED}`);
    const error = await generateDraft(brand, angle).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrandReviewRequired);
    const review = error as InstanceType<typeof BrandReviewRequired>;
    const details = review.violations.map((violation) => violation.detail).join(" | ");
    expect(details).toContain("scoping week");
    expect(details).toContain("fixed scope");
    expect(details).toContain("milestone");
    expect(review.draft.body).toContain("scoping week");
    expect(review.draft.attempts).toBe(2);
  });

  it("keeps brand rule failures hard, they never reach the queue", async () => {
    replies.push(`${CLEAN} This is a game changer.`);
    await expect(generateDraft(brand, angle)).rejects.not.toBeInstanceOf(BrandReviewRequired);
  });
});
