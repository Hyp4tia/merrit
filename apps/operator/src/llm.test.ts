import { describe, expect, it } from "vitest";
import { parseJsonReply } from "./llm.ts";

// The model is asked for one JSON object and regularly returns more: a second object, a sentence
// after it, or a fence. Parsing that must still land on the object it was asked for.
describe("model reply parsing", () => {
  it("reads a bare object", () => {
    expect(parseJsonReply<{ body: string }>('{"body":"hello"}')).toEqual({ body: "hello" });
  });

  it("ignores a second object after the first", () => {
    const text = '{"body":"one"}\n{"body":"two"}';
    expect(parseJsonReply<{ body: string }>(text)).toEqual({ body: "one" });
  });

  it("ignores prose around and after the object", () => {
    const text = 'Here is the post:\n{"body":"one"}\nLet me know if you want it shorter.';
    expect(parseJsonReply<{ body: string }>(text)).toEqual({ body: "one" });
  });

  it("keeps braces and quotes inside the body", () => {
    const text = '{"body":"the {shape} of it, and a \\"quote\\" too"}';
    expect(parseJsonReply<{ body: string }>(text)).toEqual({
      body: 'the {shape} of it, and a "quote" too',
    });
  });

  it("reads a fenced object", () => {
    const text = '```json\n{"body":"one"}\n```';
    expect(parseJsonReply<{ body: string }>(text)).toEqual({ body: "one" });
  });

  it("fails loudly when there is no object at all", () => {
    expect(() => parseJsonReply("no json here")).toThrow(/No JSON object/);
  });
});
