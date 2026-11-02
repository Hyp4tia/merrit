import { describe, expect, it } from "vitest";
import { testBrand } from "../test-support/brand-fixture.ts";
import { validatePost } from "./validate.ts";

const brand = testBrand();

// A clean draft that satisfies length and language rules, so each test isolates one rule.
const CLEAN = [
  "A booking flow that confirms on the phone and drops the record is worse than no booking flow.",
  "The owner finds out when the customer arrives and the chair is empty.",
  "We test the boring path: bad connection, duplicate tap, phone lock screen.",
  "That path is what a real Tuesday looks like in a clinic, and it is where most builds stop.",
  "So we write the failing case into the test suite before the feature exists, and the site ships with it.",
  "It is slower on the first day and faster every day after that, which is the whole argument.",
].join(" ");

function rules(body: string): string[] {
  return validatePost(body, brand, "en").map((violation) => violation.rule);
}

describe("brand rule regression guards", () => {
  it("accepts a clean draft", () => {
    expect(validatePost(CLEAN, brand, "en")).toEqual([]);
  });

  it("rejects an em dash", () => {
    expect(rules(`${CLEAN} The site \u2014 the whole thing \u2014 loads fast.`)).toContain(
      "dashes",
    );
  });

  it("rejects an en dash", () => {
    expect(rules(`${CLEAN} Builds run 2\u20133 weeks when the scope is settled.`)).toContain(
      "dashes",
    );
  });

  it("rejects an exclamation mark", () => {
    expect(rules(`${CLEAN} The site loads fast!`)).toContain("punctuation");
  });

  it("rejects an emoji in body copy", () => {
    expect(rules(`${CLEAN} The site loads fast \u{1F642}`)).toContain("punctuation");
  });

  it("rejects a banned phrase", () => {
    expect(rules(`${CLEAN} This is a game changer for the clinic.`)).toContain("banned");
  });

  it("rejects unqualified social proof", () => {
    expect(rules(`${CLEAN} We are trusted by clinics across Cairo.`)).toContain("proof");
  });

  it("rejects an Arabic draft with no Arabic in it", () => {
    const violations = validatePost(CLEAN, brand, "ar");
    expect(violations.map((violation) => violation.rule)).toContain("language");
  });

  it("rejects a draft that is too short to be a post", () => {
    expect(rules("We build sites.")).toContain("length");
  });
});
