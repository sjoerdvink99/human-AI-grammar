import { formatTransform, formatType } from "../grammar/formatter";
import type { Process, Representation, Transform } from "../grammar/types";
import type { SystemEntry } from "../systems/types";

export const treeDetails = ["type", "role", "medium"] as const;

export type TreeDetail = (typeof treeDetails)[number];

export interface TreePath {
  systemId: number;
  processId: number;
}

export interface TreeNode {
  key: string;
  transform?: Transform;
  types: string[];
  paths: TreePath[];
  children: TreeNode[];
}

const typeOf = (representation: Representation, detail: TreeDetail) =>
  detail === "type" ? formatType(representation) : representation[detail];

const typesOf = (representations: Representation[], detail: TreeDetail) =>
  [...new Set(representations.map((representation) => typeOf(representation, detail)))].sort();

function parsed(entries: SystemEntry[]) {
  return entries.flatMap((entry) =>
    entry.processes.flatMap((process) => (process.result.ok ? [{ path: { systemId: entry.id, processId: process.id }, process: process.result.process }] : [])),
  );
}

function steps(process: Process, detail: TreeDetail) {
  return process.transforms.map((transform, index) => {
    const before = new Set(process.states[index].representations.map(({ id }) => id));
    const outputs = process.states[index + 1].representations;
    const introduced = outputs.filter(({ id }) => !before.has(id));
    return { transform: { ...transform, actorInstance: undefined }, types: typesOf(introduced.length ? introduced : outputs, detail) };
  });
}

export function treeRoots(entries: SystemEntry[], detail: TreeDetail): string[] {
  const counts = new Map<string, number>();
  for (const { process } of parsed(entries)) {
    for (const type of typesOf(process.states[0].representations, detail)) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
}

const sortTree = (node: TreeNode) => {
  node.children.sort((a, b) => b.paths.length - a.paths.length || a.key.localeCompare(b.key));
  node.children.forEach(sortTree);
};

export const overviewKey = "*";

// Without a root, the first level groups processes by the representations they start from, so each process counts once.
export function processTree(entries: SystemEntry[], root: string | undefined, detail: TreeDetail): TreeNode {
  const tree: TreeNode = root === undefined
    ? { key: overviewKey, types: ["All processes"], paths: [], children: [] }
    : { key: root, types: [root], paths: [], children: [] };
  const childOf = (node: TreeNode, key: string, step: Omit<TreeNode, "key" | "paths" | "children">) => {
    let child = node.children.find((candidate) => candidate.key === key);
    if (!child) node.children.push((child = { key, ...step, paths: [], children: [] }));
    return child;
  };
  for (const { path, process } of parsed(entries)) {
    const start = typesOf(process.states[0].representations, detail);
    if (root !== undefined && !start.includes(root)) continue;
    let node = tree;
    node.paths.push(path);
    if (root === undefined) {
      node = childOf(node, start.join(" + "), { types: start });
      node.paths.push(path);
    }
    for (const step of steps(process, detail)) {
      node = childOf(node, `${node.key} ${formatTransform(step.transform)} ${step.types.join(" + ")}`, step);
      node.paths.push(path);
    }
  }
  sortTree(tree);
  return tree;
}

export function pathTo(node: TreeNode, key: string | null): TreeNode[] | undefined {
  if (node.key === key) return [node];
  for (const child of node.children) {
    const path = pathTo(child, key);
    if (path) return [node, ...path];
  }
}
