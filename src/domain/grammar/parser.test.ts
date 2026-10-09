import { describe, expect, it } from "vitest";
import { formatProcess } from "./formatter";
import { parseProcess } from "./parser";
import type { ParseError, Process } from "./types";

function parse(input: string): Process {
  const result = parseProcess(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.process;
}

function fail(input: string): ParseError {
  const result = parseProcess(input);
  if (result.ok) throw new Error("Expected a parse error");
  return result.error;
}

describe("parseProcess", () => {
  it("parses single-representation states", () => {
    expect(parse("(prompt_1: instruction language) -> [model generate] -> (artifact_1: artifact language)")).toEqual({
      states: [
        { representations: [{ id: "prompt_1", role: "instruction", medium: "language" }] },
        { representations: [{ id: "artifact_1", role: "artifact", medium: "language" }] },
      ],
      transforms: [{ actor: "model", operation: "generate", stochastic: false }],
    });
  });

  it("parses multi-representation states", () => {
    const process = parse(
      "(artifact_1: artifact language) -> [human select] -> (artifact_1: artifact language) + (region_1: selection spatial)",
    );
    expect(process.states[1].representations).toEqual([
      { id: "artifact_1", role: "artifact", medium: "language" },
      { id: "region_1", role: "selection", medium: "spatial" },
    ]);
  });

  it("distinguishes deterministic and stochastic transforms", () => {
    const process = parse("(a: artifact visual) -> [human modify] -> (b: artifact visual) -> [model modify]~ -> (c: artifact visual)");
    expect(process.transforms.map((transform) => transform.stochastic)).toEqual([false, true]);
  });

  it("parses multiple transitions in order", () => {
    const process = parse(
      "(q: instruction language) -> [model generate]~ -> (code: artifact formal) -> [tool execute] -> (out: artifact visual) -> [human evaluate] -> (out: artifact visual) + (note: evaluation language)",
    );
    expect(process.states).toHaveLength(4);
    expect(process.transforms.map((transform) => `${transform.actor} ${transform.operation}`)).toEqual([
      "model generate",
      "tool execute",
      "human evaluate",
    ]);
  });

  it("parses actor instances without changing the actor kind", () => {
    const process = parse("(a: artifact language) -> [model_1 generate]~ -> (b: artifact language) -> [model_2 evaluate] -> (c: evaluation language)");
    expect(process.transforms).toEqual([
      { actor: "model", actorInstance: "model_1", operation: "generate", stochastic: true },
      { actor: "model", actorInstance: "model_2", operation: "evaluate", stochastic: false },
    ]);
  });

  it("accepts arbitrary open vocabulary", () => {
    const process = parse("(sketch_1: scaffold haptic) -> [tool sonify] -> (tone_1: feedback audio)");
    expect(process.states[0].representations[0]).toEqual({ id: "sketch_1", role: "scaffold", medium: "haptic" });
    expect(process.transforms[0].operation).toBe("sonify");
  });

  it("normalizes vocabulary case but preserves identifiers", () => {
    const process = parse("(Prompt_A: Instruction Language) -> [Model Generate] -> (Out: Artifact Visual)");
    expect(process.states[0].representations[0]).toEqual({ id: "Prompt_A", role: "instruction", medium: "language" });
    expect(process.transforms[0]).toEqual({ actor: "model", operation: "generate", stochastic: false });
  });

  it("tolerates whitespace and multiline input", () => {
    const process = parse(`
      (  prompt_1 :instruction   language )
        ->   [ model   generate ] ~

      ->(artifact_1:artifact language)+(region_1 : selection spatial)
    `);
    expect(process.transforms[0]).toEqual({ actor: "model", operation: "generate", stochastic: true });
    expect(process.states[1].representations).toHaveLength(2);
  });

  it("accepts the unicode arrow", () => {
    expect(parse("(a: artifact language) → [human modify] → (b: artifact language)").transforms).toHaveLength(1);
  });

  it("round-trips through the formatter", () => {
    const source = "(a: artifact language) + (r: selection spatial) -> [tool_x translate] -> (p: instruction language) -> [model modify]~ -> (b: artifact language)";
    const process = parse(source);
    expect(parse(formatProcess(process))).toEqual(process);
    expect(formatProcess(process, " ")).toBe(source);
  });
});

describe("parse errors", () => {
  it("reports a missing closing parenthesis with its opening position", () => {
    const error = fail("(prompt_1: instruction language\n-> [model generate] -> (a: artifact language)");
    expect(error.message).toBe("Missing closing ')' for representation opened at line 1, column 1");
    expect(error).toMatchObject({ line: 2, column: 1 });
  });

  it("reports a malformed representation without a colon", () => {
    expect(fail("(prompt_1 instruction language) -> [model generate] -> (a: artifact language)").message).toBe(
      "Expected ':' after representation identifier 'prompt_1'",
    );
  });

  it("reports a representation missing its medium", () => {
    expect(fail("(prompt_1: instruction) -> [model generate] -> (a: artifact language)").message).toBe(
      "Representation 'prompt_1' is missing a medium after role 'instruction'",
    );
  });

  it("reports extra words inside a representation", () => {
    expect(fail("(a: artifact natural language) -> [human modify] -> (b: artifact language)").message).toBe(
      "Unexpected 'language' in representation 'a'; expected (id: role medium)",
    );
  });

  it("reports a missing actor", () => {
    const error = fail("(a: artifact language) -> [generate] -> (b: artifact language)");
    expect(error.message).toBe("Transformation is missing an actor before operation 'generate'");
    expect(error).toMatchObject({ line: 1, column: 27, length: 10 });
  });

  it("reports a missing operation", () => {
    expect(fail("(a: artifact language) -> [model]~ -> (b: artifact language)").message).toBe(
      "Transformation is missing an operation after actor 'model'",
    );
  });

  it("reports an empty transformation", () => {
    expect(fail("(a: artifact language) -> [] -> (b: artifact language)").message).toBe(
      "Transformation is missing an actor and an operation",
    );
  });

  it("reports an unknown actor", () => {
    expect(fail("(a: artifact language) -> [robot generate] -> (b: artifact language)").message).toMatch(/^Unknown actor 'robot'/);
  });

  it("reports a misplaced stochastic marker", () => {
    expect(fail("(a: artifact language) -> [model generate~] -> (b: artifact language)").message).toBe(
      "Place '~' after the closing bracket, as in [model generate]~",
    );
  });

  it("reports a transition without a following state", () => {
    const error = fail("(a: artifact language) -> [model generate] ->");
    expect(error.message).toBe("Transition '->' has no following state");
    expect(error.column).toBe(44);
  });

  it("reports a transformation without a following arrow", () => {
    expect(fail("(a: artifact language) -> [model generate]").message).toBe(
      "Transformation must be followed by '->' and a state",
    );
  });

  it("reports a process without transformations", () => {
    expect(fail("(a: artifact language)").message).toMatch(/at least one transformation/);
  });

  it("reports two states without a transformation between them", () => {
    expect(fail("(a: artifact language) -> (b: artifact language)").message).toBe(
      "Expected a transformation '[actor operation]'",
    );
  });

  it("reports a dangling plus", () => {
    expect(fail("(a: artifact language) + -> [human select] -> (b: artifact language)").message).toBe(
      "Expected a representation '(id: role medium)' after '+'",
    );
  });

  it("reports unexpected characters with their position", () => {
    expect(fail("(a: artifact language) -> [human select] -> (b: artifact language);")).toMatchObject({
      message: "Unexpected character ';'",
      line: 1,
      column: 67,
    });
  });

  it("reports empty input", () => {
    expect(fail("   \n ").message).toBe("Expression is empty");
  });
});
