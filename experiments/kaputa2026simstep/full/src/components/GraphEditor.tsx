// P2 [human modify]: direct editing of any task-level graph (add / remove / rename nodes and links).
// Also used for P6 [human select] (node selection in the UI graph) and P8 (subgraph highlight).
import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChangeset,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Graph, GraphNode, Subgraph } from '../../shared/types';
import { layoutGraph, uid } from '../lib/graph';

const TYPE_COLORS: Record<string, string> = {
  concept: '#dbeafe', quantity: '#fef3c7', law: '#ede9fe', phenomenon: '#dcfce7', object: '#fee2e2',
  property: '#fef3c7', process: '#dcfce7', environment: '#e0f2fe',
  control: '#fde68a', display: '#bbf7d0', visual: '#bfdbfe', logic: '#e9d5ff', container: '#e5e7eb',
};

type GNodeData = { node: GraphNode; dim: boolean; hot: boolean };

function GNode({ data, selected }: NodeProps<Node<GNodeData>>) {
  const n = data.node;
  return (
    <div
      className="gnode"
      title={n.description}
      style={{
        background: TYPE_COLORS[n.type ?? ''] ?? '#f3f4f6',
        opacity: data.dim ? 0.25 : 1,
        boxShadow: data.hot ? '0 0 0 3px #ef4444' : selected ? '0 0 0 2px #2563eb' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="gnode-type">{n.type}</div>
      <div className="gnode-label">{n.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { g: GNode };

/** Fit the view once node sizes are measured (and whenever the node set changes). */
function AutoFit({ count }: { count: number }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (ready) void fitView({ padding: 0.15, duration: 200 });
  }, [ready, count, fitView]);
  return null;
}

interface Props {
  graph: Graph;
  version: number;
  idPrefix: string;
  readOnly?: boolean;
  highlight?: Subgraph | null;
  onSave?: (g: Graph) => void;
  onSelectNode?: (id: string | null) => void;
}

export function GraphEditor({ graph, version, idPrefix, readOnly, highlight, onSave, onSelectNode }: Props) {
  const [draft, setDraft] = useState<Graph>(graph);
  const [dirty, setDirty] = useState(false);
  const [positions, setPositions] = useState(() => layoutGraph(graph));
  const [measured, setMeasured] = useState<Record<string, Node['measured']>>({});
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);

  useEffect(() => {
    setDraft(graph);
    setDirty(false);
    setPositions((old) => ({ ...layoutGraph(graph), ...Object.fromEntries(Object.entries(old).filter(([k]) => graph.nodes.some((n) => n.id === k))) }));
    setSelNode(null);
    setSelEdge(null);
  }, [graph]);

  const hotNodes = useMemo(() => new Set(highlight?.nodeIds ?? []), [highlight]);
  const hotEdges = useMemo(() => new Set(highlight?.edgeIds ?? []), [highlight]);

  const nodes: Node<GNodeData>[] = draft.nodes.map((n) => ({
    id: n.id,
    type: 'g',
    position: positions[n.id] ?? { x: 0, y: 0 },
    measured: measured[n.id],
    selected: n.id === selNode,
    data: { node: n, hot: hotNodes.has(n.id), dim: !!highlight && !hotNodes.has(n.id) },
  }));
  const edges: Edge[] = draft.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    selected: e.id === selEdge,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: hotEdges.has(e.id) ? { stroke: '#ef4444', strokeWidth: 3 } : highlight ? { opacity: 0.2 } : undefined,
    labelStyle: { fontSize: 11 },
  }));

  const update = (g: Graph) => {
    setDraft(g);
    setDirty(true);
  };
  const onNodesChange = (changes: NodeChangeset<Node<GNodeData>>) => {
    const moved: Node<GNodeData>[] = changes.applyTo(nodes);
    setPositions(Object.fromEntries(moved.map((n) => [n.id, n.position])));
    setMeasured(Object.fromEntries(moved.map((n) => [n.id, n.measured])));
  };
  const onConnect = (c: Connection) => {
    if (readOnly || !c.source || !c.target || c.source === c.target) return;
    const id = uid('e');
    update({ ...draft, edges: [...draft.edges, { id, source: c.source, target: c.target, label: 'relates to' }] });
    setSelEdge(id);
    setSelNode(null);
  };
  const addNode = () => {
    const id = uid(idPrefix);
    update({ ...draft, nodes: [...draft.nodes, { id, label: 'New node', type: draft.nodes[0]?.type ?? '', description: '' }] });
    setPositions((p) => ({ ...p, [id]: { x: 0, y: -120 } }));
    setSelNode(id);
  };
  const node = draft.nodes.find((n) => n.id === selNode);
  const edge = draft.edges.find((e) => e.id === selEdge);

  return (
    <div className="graph-editor">
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          nodesConnectable={!readOnly}
          onNodeClick={(_, n) => {
            setSelNode(n.id);
            setSelEdge(null);
            onSelectNode?.(n.id);
          }}
          onEdgeClick={(_, e) => {
            setSelEdge(e.id);
            setSelNode(null);
          }}
          onPaneClick={() => {
            setSelNode(null);
            setSelEdge(null);
            onSelectNode?.(null);
          }}
          deleteKeyCode={null}
          fitView
          minZoom={0.2}
        >
          <AutoFit count={draft.nodes.length} />
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="graph-inspector">
        <div className="row">
          <strong>v{version}</strong>
          {!readOnly && <button onClick={addNode}>+ Node</button>}
          {!readOnly && <span className="hint">drag handle → handle to link</span>}
        </div>
        {node && (
          <div className="inspector-box">
            <label>Label<input value={node.label} disabled={readOnly} onChange={(e) => update({ ...draft, nodes: draft.nodes.map((n) => (n.id === node.id ? { ...n, label: e.target.value } : n)) })} /></label>
            <label>Type<input value={node.type ?? ''} disabled={readOnly} onChange={(e) => update({ ...draft, nodes: draft.nodes.map((n) => (n.id === node.id ? { ...n, type: e.target.value } : n)) })} /></label>
            <label>Description<textarea rows={4} value={node.description ?? ''} disabled={readOnly} onChange={(e) => update({ ...draft, nodes: draft.nodes.map((n) => (n.id === node.id ? { ...n, description: e.target.value } : n)) })} /></label>
            <div className="hint">id: {node.id}</div>
            {!readOnly && (
              <button className="danger" onClick={() => {
                update({ nodes: draft.nodes.filter((n) => n.id !== node.id), edges: draft.edges.filter((e) => e.source !== node.id && e.target !== node.id) });
                setSelNode(null);
              }}>Remove node</button>
            )}
          </div>
        )}
        {edge && (
          <div className="inspector-box">
            <div className="hint">{edge.source} → {edge.target}</div>
            <label>Link label<input value={edge.label ?? ''} disabled={readOnly} onChange={(e) => update({ ...draft, edges: draft.edges.map((x) => (x.id === edge.id ? { ...x, label: e.target.value } : x)) })} /></label>
            {!readOnly && (
              <button className="danger" onClick={() => {
                update({ ...draft, edges: draft.edges.filter((x) => x.id !== edge.id) });
                setSelEdge(null);
              }}>Remove link</button>
            )}
          </div>
        )}
        {!node && !edge && <div className="hint">Click a node or link to inspect{readOnly ? '' : ' and edit'} it.</div>}
        {dirty && !readOnly && (
          <div className="row">
            <button className="primary" onClick={() => { onSave?.(draft); setDirty(false); }}>Save as v{version + 1}</button>
            <button onClick={() => { setDraft(graph); setDirty(false); }}>Discard</button>
          </div>
        )}
      </aside>
    </div>
  );
}
