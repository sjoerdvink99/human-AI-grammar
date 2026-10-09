import { describe, expect, it } from "vitest";
import { applyCompletion, complete, completePart, identifiersIn, type CompletionSource } from "./completion";

const source: CompletionSource = {
  vocabulary: { role: ["instruction", "artifact"], medium: ["language", "visual"], operation: ["generate", "evaluate"] },
  identifiers: ["prompt_1", "draft_1", "draft_2"],
};

const at = (text: string) => complete(text, text.length, source);

const values = (text: string) => at(text)?.options.map((option) => option.value);

describe("completion", () => {
  it("finds identifiers in expressions", () => {
    expect(identifiersIn("(prompt_1: instruction language) -> [model generate]~ -> ( draft_1 : artifact language)")).toEqual([
      "prompt_1",
      "draft_1",
    ]);
  });

  it("suggests identifiers and their next versions", () => {
    expect(values("(")).toEqual(["prompt_1", "draft_1", "draft_2", "prompt_2", "draft_3"]);
    expect(values("(dr")).toEqual(["draft_1", "draft_2", "draft_3"]);
  });

  it("suggests roles, then media", () => {
    expect(values("(prompt_1: ")).toEqual(["instruction", "artifact"]);
    expect(values("(prompt_1: in")).toEqual(["instruction"]);
    expect(values("(prompt_1: instruction ")).toEqual(["language", "visual"]);
    expect(at("(prompt_1: instruction language ")).toBeNull();
  });

  it("suggests actors, then operations", () => {
    expect(values("(a: b c) -> [")).toEqual(["human", "model", "tool"]);
    expect(values("(a: b c) -> [model ev")).toEqual(["evaluate"]);
    expect(at("(a: b c) -> [model generate]~")).toBeNull();
  });

  it("stays quiet outside brackets and on exact matches", () => {
    expect(at("(a: b c) -> ")).toBeNull();
    expect(at("(a: b c) -> [model")).toBeNull();
  });

  it("inserts the value with the right suffix", () => {
    const text = "(prompt_1: instruction la";
    expect(applyCompletion(text, at(text)!, "language")).toEqual({ text: "(prompt_1: instruction language)", caret: 32 });
    const closed = "(a: b c) -> [model ge]";
    const completion = complete(closed, closed.length - 1, source)!;
    expect(applyCompletion(closed, completion, "generate").text).toBe("(a: b c) -> [model generate]");
  });

  it("parses the complete part of an expression that is still being typed", () => {
    expect(completePart("(a: b c)\n-> [model generate]~\n-> (d: e f)\n-> [human sel")?.transforms).toHaveLength(1);
    expect(completePart("(a: b c)\n-> [mod")).toBeNull();
  });
});
