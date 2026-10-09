// Process 2: [human modify] concept_graph_1 -> concept_graph_2, by direct editing of nodes and links.
import { useState } from "react";
import type { Graph } from "../../shared/types";
import { GraphView } from "./GraphView";

interface Props {
  graph: Graph;
  onChange: (g: Graph) => void;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "node";

export function GraphEditor({ graph, onChange }: Props) {
  const [sel, setSel] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("relates to");
  const node = graph.nodes.find((n) => n.id === sel);

  const clickNode = (id: string) => {
    if (connectFrom && connectFrom !== id) {
      onChange({ ...graph, edges: [...graph.edges, { source: connectFrom, target: id, label: edgeLabel }] });
      setConnectFrom(null);
      setSel(id);
      return;
    }
    setSel(id === sel ? null : id);
  };
  const addNode = () => {
    if (!newLabel.trim()) return;
    let id = slug(newLabel);
    while (graph.nodes.some((n) => n.id === id)) id += "_x";
    onChange({ ...graph, nodes: [...graph.nodes, { id, label: newLabel.trim(), description: "", kind: "concept" }] });
    setNewLabel("");
    setSel(id);
  };
  const patchNode = (patch: { label?: string; description?: string }) =>
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === sel ? { ...n, ...patch } : n)) });
  const deleteNode = () => {
    if (!sel || graph.nodes.length <= 1) return;
    onChange({ nodes: graph.nodes.filter((n) => n.id !== sel), edges: graph.edges.filter((e) => e.source !== sel && e.target !== sel) });
    setSel(null);
  };
  const deleteEdge = (i: number) => {
    const e = graph.edges[i];
    if (confirm(`Delete link "${e.source} —${e.label}→ ${e.target}"?`)) onChange({ ...graph, edges: graph.edges.filter((_, k) => k !== i) });
  };

  return (
    <div>
      <GraphView graph={graph} selected={[sel, connectFrom].filter(Boolean) as string[]} onNodeClick={clickNode} onEdgeClick={deleteEdge} />
      <div className="toolbar">
        <input placeholder="New concept" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNode()} />
        <button onClick={addNode}>Add concept</button>
        <span className="hint">Click a node to edit it · click a link to delete it</span>
      </div>
      {node && (
        <div className="node-edit">
          <label>
            Label <input value={node.label} onChange={(e) => patchNode({ label: e.target.value })} />
          </label>
          <label>
            Description <input value={node.description} onChange={(e) => patchNode({ description: e.target.value })} style={{ width: 320 }} />
          </label>
          <button onClick={deleteNode} className="danger">
            Delete
          </button>
          {connectFrom ? (
            <button onClick={() => setConnectFrom(null)}>Cancel link</button>
          ) : (
            <>
              <input value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} style={{ width: 110 }} title="link label" />
              <button onClick={() => setConnectFrom(node.id)}>Link to… (then click target)</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
