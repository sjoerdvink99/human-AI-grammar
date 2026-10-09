// canvas (artifact graph): gold nodes from highlight cards, silver nodes from query cards, related_edges from the KG.
import { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { CanvasGraph, CanvasNode, Card } from '../../../shared/types.ts';

type CardNodeData = { node: CanvasNode; card?: Card; active: boolean; onRemove: (id: string) => void };

function CardNode({ data }: NodeProps<Node<CardNodeData>>) {
  const { node, card, active, onRemove } = data;
  const sub =
    card?.kind === 'highlight' ? `“${card.span.text}”` : card ? `${card.facts.length} fact${card.facts.length === 1 ? '' : 's'}` : '';
  return (
    <div className={`cnode ${node.kind} ${active ? 'active' : ''}`} title={card?.kind === 'highlight' ? card.explanation : card?.facts.map((f) => f.statements[0] ?? f.description).join('\n')}>
      <Handle type="target" position={Position.Left} />
      <div className="cnode-kind">{node.kind === 'gold' ? '● draft' : '○ question'}</div>
      <div className="cnode-title">{node.title}</div>
      <div className="cnode-sub">{sub}</div>
      <button className="cnode-x nodrag" onClick={(e) => { e.stopPropagation(); onRemove(node.id); }} title="Remove from canvas">×</button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { card: CardNode };

interface Props {
  canvas: CanvasGraph;
  cards: Card[];
  activeCardId: string | null;
  onDropCards: (ids: string[], pos: { x: number; y: number }) => void;
  onNodeClick: (n: CanvasNode) => void;
  onNodeMove: (id: string, pos: { x: number; y: number }) => void;
  onNodeRemove: (id: string) => void;
}

function Inner({ canvas, cards, activeCardId, onDropCards, onNodeClick, onNodeMove, onNodeRemove }: Props) {
  const flow = useReactFlow();
  const nodes: Node<CardNodeData>[] = useMemo(
    () =>
      canvas.nodes.map((n) => ({
        id: n.id,
        type: 'card',
        position: n.position,
        data: { node: n, card: cards.find((c) => c.id === n.cardId), active: n.cardId === activeCardId, onRemove: onNodeRemove },
      })),
    [canvas.nodes, cards, activeCardId, onNodeRemove],
  );
  const edges: Edge[] = useMemo(
    () =>
      canvas.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        className: e.hops === 2 ? 'edge-2hop' : 'edge-1hop',
        animated: e.hops === 2,
      })),
    [canvas.edges],
  );

  return (
    <div
      className="canvas"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-card')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/x-card');
        if (!raw) return;
        e.preventDefault();
        onDropCards(JSON.parse(raw), flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => onNodeClick(n.data.node)}
        onNodesChange={(changes) => {
          for (const c of changes) if (c.type === 'position' && c.position) onNodeMove(c.id, c.position);
        }}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!canvas.nodes.length && (
        <div className="canvas-empty">Drag cards here, or select cards below and press “Add to canvas”.<br />Related cards are connected using the knowledge graph.</div>
      )}
    </div>
  );
}

export default function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
