import { describe, expect, it } from "vitest";
import { entry } from "../test-fixtures";
import { pathTo, processTree, treeRoots, type TreeNode } from "./process-tree";

const entries = [
  entry(1, "Writer", [
    "(p_1: instruction language) -> [model_1 generate]~ -> (p_1: instruction language) + (d_1: artifact language) -> [human select] -> (s_1: selection language)",
    "(d_1: artifact language) -> [human modify] -> (d_2: artifact language)",
  ]),
  entry(2, "Painter", [
    "(q_1: instruction language) + (c_1: artifact visual) -> [model generate]~ -> (q_1: instruction language) + (i_1: artifact visual) -> [human select] -> (r_1: selection spatial)",
    "(q_1: instruction language) -> [human specify] -> (q_2: instruction structured)",
  ]),
];

const shape = (node: TreeNode): unknown => ({ types: node.types, count: node.paths.length, children: node.children.map(shape) });

describe("treeRoots", () => {
  it("ranks the types found in initial states", () => {
    expect(treeRoots(entries, "type")).toEqual(["instruction language", "artifact language", "artifact visual"]);
    expect(treeRoots(entries, "role")).toEqual(["instruction", "artifact"]);
  });
});

describe("processTree", () => {
  it("merges shared prefixes, ignores carried context, and splits where steps differ", () => {
    expect(shape(processTree(entries, "instruction language", "type"))).toEqual({
      types: ["instruction language"],
      count: 3,
      children: [
        { types: ["instruction structured"], count: 1, children: [] },
        {
          types: ["artifact language"],
          count: 1,
          children: [{ types: ["selection language"], count: 1, children: [] }],
        },
        {
          types: ["artifact visual"],
          count: 1,
          children: [{ types: ["selection spatial"], count: 1, children: [] }],
        },
      ],
    });
  });

  it("merges more at a coarser detail and treats actor instances as one actor", () => {
    const tree = processTree(entries, "instruction", "role");
    expect(shape(tree)).toEqual({
      types: ["instruction"],
      count: 3,
      children: [
        { types: ["artifact"], count: 2, children: [{ types: ["selection"], count: 2, children: [] }] },
        { types: ["instruction"], count: 1, children: [] },
      ],
    });
    expect(tree.children[0].transform).toEqual({ actor: "model", operation: "generate", stochastic: true });
  });

  it("finds the path from the root to a node", () => {
    const tree = processTree(entries, "instruction", "role");
    const leaf = tree.children[0].children[0];
    expect(pathTo(tree, leaf.key)).toEqual([tree, tree.children[0], leaf]);
    expect(pathTo(tree, "missing")).toBeUndefined();
  });
});
