import { describe, expect, it } from "vitest";
import { parseAll, entry } from "../test-fixtures";
import { formatState, formatTransform } from "../grammar/formatter";
import { adaptStep, appendTransition, corpusSteps, nextSteps, recommend, searchSteps, similarSystems, stepText } from "./inspiration";

const direct = entry(1, "DirectGPT", [
  "(p: instruction language) -> [model generate]~ -> (a: artifact language) -> [human select] -> (a: artifact language) + (r: selection spatial)",
]);
const runner = entry(2, "Runner", ["(c: artifact formal) -> [tool execute] -> (o: artifact visual) -> [model_1 evaluate]~ -> (s: evaluation language)"]);
const entries = [direct, runner];

describe("inspiration", () => {
  it("splits processes into single steps", () => {
    expect(corpusSteps(entries).map(stepText)).toEqual([
      "(p: instruction language) -> [model generate]~ -> (a: artifact language)",
      "(a: artifact language) -> [human select] -> (a: artifact language) + (r: selection spatial)",
      "(c: artifact formal) -> [tool execute] -> (o: artifact visual)",
      "(o: artifact visual) -> [model_1 evaluate]~ -> (s: evaluation language)",
    ]);
  });

  it("searches steps by grammar terms and system metadata", () => {
    expect(searchSteps(entries, "model evaluate").map((step) => step.entry.name)).toEqual(["Runner"]);
    expect(searchSteps(entries, "generative")).toHaveLength(2);
    expect(searchSteps(entries, "directgpt")).toHaveLength(2);
    expect(searchSteps(entries, "  ")).toEqual([]);
  });

  it("suggests steps that start from a similar state", () => {
    const [process] = parseAll("(x: artifact language) -> [human modify] -> (y: artifact language)");
    const steps = nextSteps(entries, process.states[1]);
    expect(steps.map((step) => step.transform.operation)).toEqual(["select"]);
  });

  it("prefers steps that share representation names", () => {
    const named = entry(3, "Named", ["(b: artifact language) -> [model expand]~ -> (c: artifact language)"]);
    const [process] = parseAll("(x: instruction language) -> [human modify] -> (a_2: artifact language)");
    expect(nextSteps([named, direct], process.states[1])[0].transform.operation).toBe("select");
  });

  it("ranks similar systems", () => {
    const ranked = similarSystems(entries, parseAll("(q: instruction language) -> [model generate]~ -> (b: artifact language)"));
    expect(ranked[0].entry.name).toBe("DirectGPT");
    expect(similarSystems(entries, [])).toEqual([]);
  });
});

describe("recommendations", () => {
  const corpus = [
    entry(1, "A", ["(p_1: instruction language) -> [model generate]~ -> (draft_1: artifact language)"]),
    entry(2, "B", ["(q_1: instruction language) -> [model_2 generate]~ -> (text_1: artifact language)"]),
    entry(3, "C", ["(q_1: instruction language) + (doc_1: artifact language) -> [human select] -> (q_1: instruction language) + (span_1: selection language)"]),
    entry(4, "D", ["(doc_1: artifact language) -> [human modify] -> (doc_2: artifact language)"]),
  ];
  const [prompt] = parseAll("(prompt_1: instruction language) -> [human specify] -> (prompt_1: instruction language)");

  it("ranks what most often follows a similar state", () => {
    const [first, second] = recommend(corpus, prompt.states[1]);
    expect(formatTransform(first.transform)).toBe("[model generate]~");
    expect(first.systems).toBe(2);
    expect(first.produced.map(({ role, medium }) => `${role} ${medium}`)).toEqual(["artifact language"]);
    expect(formatTransform(second.transform)).toBe("[human select]");
  });

  it("adapts steps to the identifiers of the current state", () => {
    const [state] = parseAll("(x_1: instruction language) -> [human specify] -> (essay_1: artifact language)").map((p) => p.states[1]);
    const [modify] = corpusSteps([corpus[3]]);
    expect(formatState(adaptStep(modify, state))).toBe("(essay_2: artifact language)");
    const [select] = corpusSteps([corpus[2]]);
    expect(formatState(adaptStep(select, prompt.states[1]))).toBe("(prompt_1: instruction language) + (span_1: selection language)");
  });

  it("appends a transition", () => {
    const [first] = recommend(corpus, prompt.states[1]);
    expect(appendTransition("(prompt_1: instruction language)\n", first.transform, first.after)).toBe(
      "(prompt_1: instruction language)\n-> [model generate]~\n-> (draft_1: artifact language)",
    );
  });
});
