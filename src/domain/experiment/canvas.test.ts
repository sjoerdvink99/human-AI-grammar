import { describe, expect, it } from "vitest";
import { designSpecSchema } from "../design/spec";
import { loops } from "../grammar/features";
import { parseProcess } from "../grammar/parser";
import type { ActorKind } from "../grammar/types";
import { deriveProcesses, term, type Canvas, type CanvasNode } from "./canvas";
import { tutorialCanvas } from "./study";

const rep = (id: string, x: number, role = "artifact", medium = "language", note = ""): CanvasNode => ({
  id,
  type: "representation",
  position: { x, y: 0 },
  data: { name: id.replace(/\d+$/, ""), role, medium, collection: false, note },
});

const step = (id: string, x: number, actor: ActorKind, operation: string, note = ""): CanvasNode => ({
  id,
  type: "step",
  position: { x, y: 0 },
  data: { actor, operation, generative: actor === "model", note },
});

const links = (...pairs: [string, string][]) => pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target }));

const parsed = (rawExpression: string) => {
  const result = parseProcess(rawExpression);
  if (!result.ok) throw new Error(result.error.message);
  return result.process;
};

describe("deriveProcesses", () => {
  it("turns the tutorial canvas into a loop that parses", () => {
    const { processes, representations, problems } = deriveProcesses(tutorialCanvas);
    expect(problems).toEqual([]);
    expect(processes).toHaveLength(1);
    expect(processes[0].rawExpression).toBe(
      [
        "(prompt_1: instruction language)",
        "-> [model generate]~",
        "-> (drafts_1: artifact language)*",
        "-> [human select]",
        "-> (draft_1: artifact language)",
        "-> [human modify]",
        "-> (prompt_1: instruction language)",
      ].join("\n"),
    );
    expect(loops(parsed(processes[0].rawExpression))).toEqual([{ step: 2, to: 0 }]);
    expect(processes[0].description).toBe("model generate: Writes three alternatives\nhuman modify: Rewrites the prompt and tries again");
    expect(representations).toEqual({ prompt: "What the user wants written" });
  });

  it("versions representations that share a name and keeps inputs a later step reads", () => {
    const canvas: Canvas = {
      nodes: [
        rep("claim", 0, "instruction"),
        step("generate", 100, "model", "generate"),
        rep("draft1", 200),
        step("evaluate", 300, "model", "evaluate"),
        rep("draft2", 400),
      ],
      edges: links(["claim", "generate"], ["generate", "draft1"], ["claim", "evaluate"], ["draft1", "evaluate"], ["evaluate", "draft2"]),
    };
    const [process] = deriveProcesses(canvas).processes;
    expect(process.rawExpression).toBe(
      [
        "(claim_1: instruction language)",
        "-> [model generate]~",
        "-> (draft_1: artifact language) + (claim_1: instruction language)",
        "-> [model evaluate]~",
        "-> (draft_2: artifact language)",
      ].join("\n"),
    );
    expect(parseProcess(process.rawExpression).ok).toBe(true);
  });

  it("orders unconnected parts left to right as separate processes", () => {
    const canvas: Canvas = {
      nodes: [rep("b", 500), step("s2", 600, "tool", "Extract Text"), rep("c", 700), rep("a", 0), step("s1", 100, "human", "specify"), rep("x", 200)],
      edges: links(["b", "s2"], ["s2", "c"], ["a", "s1"], ["s1", "x"]),
    };
    const { processes } = deriveProcesses(canvas);
    expect(processes.map(({ rawExpression }) => rawExpression.split("\n")[1])).toEqual(["-> [human specify]", "-> [tool extract_text]"]);
  });

  it("reports incomplete steps and loose representations", () => {
    const canvas: Canvas = {
      nodes: [rep("a", 0), step("s1", 100, "model", "generate"), step("s2", 200, "human", ""), rep("b", 300, "")],
      edges: links(["a", "s1"], ["s1", "b"]),
    };
    const { processes, problems } = deriveProcesses(canvas);
    expect(processes).toEqual([]);
    expect(problems).toEqual([
      "model generate uses a representation without a name, role, or medium",
      "A human step has no operation",
      "a is not connected to a complete step",
      "b is not connected to a complete step",
    ]);
  });

  it("produces a design spec the plugin accepts", () => {
    const { processes, representations } = deriveProcesses(tutorialCanvas);
    const result = designSpecSchema.safeParse({ name: "Drafts", processes, representations, study: {}, canvas: tutorialCanvas });
    expect(result.success).toBe(true);
  });

  it("normalises terms", () => {
    expect(term("  Fact Check-list ")).toBe("fact_check_list");
  });
});
