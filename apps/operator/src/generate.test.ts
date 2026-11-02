import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBrand } from "../test-support/brand-fixture.ts";

// The model is the one non-deterministic part, so it is replaced here. Everything below the
// call is the real pipeline: brand rules, then the commercial guard.
const replies: Array<string | { body: string; angle: string }> = [];
const calls: string[] = [];

vi.mock("./llm.ts", () => ({
  chatJson: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    calls.push(messages[messages.length - 1]?.content ?? "");
    const next = replies.shift() ?? "";
    const value = typeof next === "string" ? { body: next, angle: "stub angle" } : next;
    return {
      value,
      result: { text: value.body, model: "stub-model", promptTokens: 100, completionTokens: 200 },
    };
  }),
}));

const { BrandReviewRequired, generateDraft, RevisionDrift, subjectRetention } = await import(
  "./generate.ts"
);

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

// A revision is an edit of an existing draft. The model must see that draft, and the result must
// still be about the same subject, or the queue item silently becomes a different post.
const SHORTER_CLEAN =
  "A booking flow that drops the record is worse than none. The owner finds out when the customer " +
  "arrives and the chair is empty. We test the boring path instead: bad connection, duplicate tap, " +
  "phone lock screen. That is what a real Tuesday looks like in a clinic, and it is where most " +
  "builds stop. So the failing case goes into the test suite before the feature exists, and the " +
  "site ships with it, tested on the day it lands rather than the week before launch.";

const AI_DRIFT =
  "Most software requests we get now are about AI. The interesting part is not the model. It is " +
  "the plumbing around it: who owns the key, what happens when the provider raises the price, and " +
  "whether the answer can be checked at all. We build the plumbing first. A demo that impresses " +
  "in a meeting proves nothing about the second month, when the invoice arrives and the traffic " +
  "doubles. Ask what the system does when the model is unavailable.";

describe("revision mode", () => {
  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
  });

  it("puts the current draft verbatim in front of the model, with the instruction", async () => {
    replies.push(SHORTER_CLEAN);
    await generateDraft(brand, angle, {
      edit: { previous: CLEAN, instruction: "make it shorter" },
    });

    const prompt = calls[0] ?? "";
    expect(prompt).toContain(CLEAN);
    expect(prompt).toContain("INSTRUCTION FROM THE OWNER: make it shorter");
    expect(prompt).toContain(
      "Edit this draft. Keep its subject and argument. Apply only the instruction.",
    );
    expect(prompt).toContain("MODE: revision");
    // A revision is not a rejection, so the rejection wording must not be used for it.
    expect(prompt).not.toContain("rejected the previous draft");
  });

  it("returns a shorter edit that keeps the subject", async () => {
    replies.push(SHORTER_CLEAN);
    const draft = await generateDraft(brand, angle, {
      edit: { previous: CLEAN, instruction: "make it shorter" },
    });

    expect(draft.body.length).toBeLessThan(CLEAN.length);
    expect(draft.body).toContain("site");
    expect(draft.body).not.toMatch(/\bAI\b/);
    expect(subjectRetention(CLEAN, draft.body)).toBeGreaterThan(0.3);
  });

  it("refuses a revision that swaps the subject, and names it", async () => {
    replies.push(AI_DRIFT, AI_DRIFT);

    const failure = await generateDraft(brand, angle, {
      edit: { previous: CLEAN, instruction: "make it shorter" },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RevisionDrift);
    expect((failure as InstanceType<typeof RevisionDrift>).retention).toBeLessThan(0.3);
    expect((failure as Error).message).toContain("changed the subject");
    // One regeneration, then it stops rather than trying forever.
    expect(calls).toHaveLength(2);
  });

  it("recovers when the second attempt comes back to the subject", async () => {
    replies.push(AI_DRIFT, SHORTER_CLEAN);
    const draft = await generateDraft(brand, angle, {
      edit: { previous: CLEAN, instruction: "make it shorter" },
    });

    expect(draft.body).toBe(SHORTER_CLEAN);
    expect(calls).toHaveLength(2);
  });
});

describe("the angle summary is copy too", () => {
  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
  });

  it("sends an invented figure in the angle back for one regeneration", async () => {
    replies.push(
      { body: CLEAN, angle: "A 9,500 EGP deposit scheme for the site" },
      { body: CLEAN, angle: "Site price 12,000 EGP, half at signing" },
    );

    const draft = await generateDraft(brand, angle);
    expect(draft.angleSummary).toContain("12,000");
    expect(calls).toHaveLength(2);
  });

  it("flags for review when the angle keeps inventing figures", async () => {
    replies.push(
      { body: CLEAN, angle: "A 9,500 EGP deposit scheme for the site" },
      { body: CLEAN, angle: "A 9,500 EGP deposit scheme for the site" },
    );

    const failure = await generateDraft(brand, angle).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BrandReviewRequired);
    expect(
      (failure as InstanceType<typeof BrandReviewRequired>).violations.some((violation) =>
        violation.detail.startsWith("angle summary:"),
      ),
    ).toBe(true);
  });
});
