import { describe, expect, it } from "vitest";
import { entry, parseAll } from "../test-fixtures";
import { cellKey, flow, grid, longestModelRun, motifs, oversight, processSteps } from "./structure";

const entries = [
  entry(1, "Writer", [
    "(c_1: instruction language) -> [human specify] -> (p_1: instruction language) -> [tool translate] -> (q_1: instruction language) -> [model generate]~ -> (d_1: artifact language) -> [human select] -> (s_1: selection spatial)",
  ]),
  entry(2, "Chain", [
    "(c_1: instruction language) -> [human specify] -> (p_1: instruction language) -> [model generate]~ -> (l_1: label categorical) -> [tool select] -> (r_1: selection categorical) -> [model generate]~ -> (a_1: artifact language)",
  ]),
];

describe("processSteps", () => {
  it("reads inputs from what the previous step introduced", () => {
    const [process] = parseAll("(a_1: artifact visual) -> [human select] -> (a_1: artifact visual) + (s_1: selection spatial) -> [model modify]~ -> (a_2: artifact visual)");
    expect(processSteps(process).map((step) => [step.inputs.map(({ id }) => id), step.outputs.map(({ id }) => id)])).toEqual([
      [["a_1"], ["s_1"]],
      [["s_1"], ["a_2"]],
    ]);
  });
});

describe("oversight", () => {
  it("follows each generative output to the next human or model", () => {
    const processes = entries.flatMap((system) => system.processes.flatMap((process) => (process.result.ok ? [process.result.process] : [])));
    expect(oversight(processes)).toEqual({ generativeOutputs: 3, next: { human: 1, model: 1, end: 1 }, longestModelRun: 2 });
  });

  it("resets the model run at each human transformation", () => {
    const [process] = parseAll("(c_1: instruction language) -> [human specify] -> (p_1: instruction language) -> [model generate]~ -> (d_1: artifact language) -> [human select] -> (s_1: selection spatial) -> [model modify]~ -> (d_2: artifact language)");
    expect(longestModelRun(process.transforms)).toBe(1);
  });
});

describe("motifs", () => {
  it("ranks sequences by the number of systems that contain them", () => {
    const [top] = motifs(entries, 2, false);
    expect(top.key).toBe("human specify → model generate");
    expect(top.systems).toBe(2);
    expect(top.occurrences.map((occurrence) => occurrence.indices)).toEqual([[0, 2], [0, 1]]);
  });

  it("keeps tool steps when asked", () => {
    expect(motifs(entries, 3, true).map((motif) => motif.key)).toContain("model generate → tool select → model generate");
  });
});

describe("flow", () => {
  it("links input types to actors and actors to output types", () => {
    const { links } = flow(entries, "role");
    const count = (side: string, type: string, actor: string) => links.find((link) => link.side === side && link.type === type && link.actor === actor)?.count;
    expect(count("in", "instruction", "human")).toBe(2);
    expect(count("out", "artifact", "model")).toBe(2);
    expect(count("in", "label", "tool")).toBe(1);
  });
});

describe("grid", () => {
  it("counts systems per cell and keeps unused vocabulary as empty rows and columns", () => {
    const transformations = grid(entries, "transformations");
    expect(transformations.cells.get(cellKey("model", "generate"))?.systems).toBe(2);
    expect(transformations.columns).toContain("train");
    expect(transformations.cells.has(cellKey("human", "train"))).toBe(false);
    expect(grid(entries, "representations").rows).toContain("evaluation");
  });
});
