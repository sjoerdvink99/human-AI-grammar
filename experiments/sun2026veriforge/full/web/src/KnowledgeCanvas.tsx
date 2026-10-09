// The Knowledge Canvas (canvas: artifact graph). Gold nodes = highlight cards,
// silver nodes = query cards; labeled edges from tool_1 match. Clicking a node is
// the human select of process 7 (gold) or process 8 (silver).
import { useEffect, useMemo } from "react";
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, type Node, type Edge, type NodeProps, type OnNodesChange, useReactFlow } from "@xyflow/react";
import type { Canvas, CanvasNode } from "../../shared/types.ts";

type CardNodeData = { node: CanvasNode; onRemove(id: string): void };

function CardNode({ data }: NodeProps<Node<CardNodeData>>) {
  const { node, onRemove } = data;
  const fact = node.card.facts[0];
  return (
    <div className={`cnode ${node.tone}`} title={node.tone === "gold" ? "From an inline highlight — click to find it in the draft" : "From a query — click to open the conversation turn"}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="cnode-head">
        <span className="badge">{node.tone === "gold" ? "highlight" : "query"}</span>
        <button className="icon nodrag" onClick={(e) => { e.stopPropagation(); onRemove(node.id); }} title="Remove from canvas">×</button>
      </div>
      <strong>{node.card.concept}</strong>
      <p>{node.card.explanation.length > 140 ? node.card.explanation.slice(0, 137) + "…" : node.card.explanation}</p>
      {fact && <small className="muted">— {fact.docTitle}</small>}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { card: CardNode };

/** Re-fit the view when cards are added or removed (not when they are dragged). */
function FitOnCountChange({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ maxZoom: 1, padding: 0.2, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [count, fitView]);
  return null;
}

interface Props {
  canvas: Canvas;
  relating: boolean;
  onChange(c: Canvas): void;
  onRemove(id: string): void;
  onNodeClick(n: CanvasNode): void;
}

export function KnowledgeCanvas({ canvas, relating, onChange, onRemove, onNodeClick }: Props) {
  const nodes: Node<CardNodeData>[] = useMemo(
    () => canvas.nodes.map((n) => ({ id: n.id, type: "card", position: { x: n.x, y: n.y }, data: { node: n, onRemove } })),
    [canvas.nodes, onRemove],
  );
  const edges: Edge[] = useMemo(
    () => canvas.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed }, className: "kedge",
      labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4,
    })),
    [canvas.edges],
  );

  const onNodesChange: OnNodesChange<Node<CardNodeData>> = (changes) => {
    const pos = new Map<string, { x: number; y: number }>();
    for (const c of changes.getByType("position")) if (c.position) pos.set(c.id, c.position);
    if (!pos.size) return;
    onChange({ ...canvas, nodes: canvas.nodes.map((n) => ({ ...n, x: pos.get(n.id)?.x ?? n.x, y: pos.get(n.id)?.y ?? n.y })) });
  };

  return (
    <section className="pane canvas-pane">
      <header className="pane-head">
        <h2>Knowledge Canvas</h2>
        <span className="muted small">
          {relating ? "finding connections…" : `${canvas.nodes.length} cards · ${canvas.edges.length} connections`}
          <span className="legend"><i className="dot gold" /> highlight <i className="dot silver" /> query</span>
        </span>
      </header>
      <div className="flow">
        {!canvas.nodes.length && <p className="muted empty canvas-empty">Add Knowledge Cards here from highlights or queries. Related cards are connected automatically.</p>}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => onNodeClick(n.data.node)}
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
        >
          <FitOnCountChange count={canvas.nodes.length} />
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
