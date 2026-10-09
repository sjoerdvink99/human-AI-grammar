"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { KnownVocabulary } from "@/components/editor/process-editor";
import { Expression } from "@/components/grammar/expression";
import { ParseErrorView } from "@/components/grammar/parse-error-view";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { deriveProcesses, type Canvas, type RepresentationData, type StepData } from "@/domain/experiment/canvas";
import { arrange, structureKey } from "@/domain/experiment/layout";
import { parseProcess } from "@/domain/grammar/parser";
import { actorKinds, type ActorKind } from "@/domain/grammar/types";
import { vocabularyTypes } from "@/domain/grammar/vocabulary";
import { cx } from "@/lib/cx";
import { actorFill, listId, RemovableEdge, RepresentationNode, StepNode, type AppNode } from "./canvas-elements";

const nodeTypes = { representation: RepresentationNode, step: StepNode };

const edgeTypes = { removable: RemovableEdge };

const edgeColor = "#5b626d";

const edgeStyle = {
  type: "removable",
  markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
  style: { stroke: edgeColor, strokeWidth: 1.5 },
};

type NewNode = { type: "representation"; data: RepresentationData } | { type: "step"; data: StepData };

const blankRepresentation = (): NewNode => ({ type: "representation", data: { name: "", role: "", medium: "", collection: false, note: "" } });

const blankStep = (actor: ActorKind): NewNode => ({ type: "step", data: { actor, operation: "", generative: actor === "model", note: "" } });

const fallbackSize = { width: 208, height: 160 };

const pointer = (event: MouseEvent | TouchEvent) => ("changedTouches" in event ? event.changedTouches[0] : event);

interface CanvasProps {
  canvas: Canvas;
  onChange: (update: (canvas: Canvas) => Canvas) => void;
  onEvent?: (type: string) => void;
}

function Editor({ canvas, onChange, onEvent = () => {} }: CanvasProps) {
  const { screenToFlowPosition, getNode, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const arranged = useRef<string>(null);
  const initialized = useNodesInitialized();
  const structure = structureKey(canvas);
  const nodes = canvas.nodes as AppNode[];
  const edges = useMemo(() => canvas.edges.map((edge): Edge => ({ ...edge, ...edgeStyle })), [canvas.edges]);
  const typeOf = (id: string) => canvas.nodes.find((node) => node.id === id)?.type;

  const place = (node: NewNode, position: { x: number; y: number }, edge?: (id: string) => Omit<Edge, "id">) => {
    const id = crypto.randomUUID();
    onChange((current) => ({
      nodes: [...current.nodes, { ...node, id, position }],
      edges: edge ? [...current.edges, { id: `edge-${id}`, ...edge(id) }] : current.edges,
    }));
    onEvent(`add ${node.type}`);
    if (edge) onEvent("connect");
  };

  useEffect(() => {
    if (!initialized || arranged.current === structure) return;
    arranged.current = structure;
    onChange((current) => arrange(current, (id) => ({ ...fallbackSize, ...getNode(id)?.measured })));
    setTimeout(() => fitView({ duration: 300, maxZoom: 1, padding: 0.15 }));
  }, [initialized, structure, onChange, getNode, fitView]);

  const add = (node: NewNode) => {
    const box = wrapper.current!.getBoundingClientRect();
    place(node, screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }));
  };

  const extend: OnConnectEnd = (event, { isValid, fromNode, fromHandle }) => {
    if (isValid || !fromNode || !(event.target as Element).classList.contains("react-flow__pane")) return;
    const outgoing = fromHandle?.type === "source";
    const { x, y } = screenToFlowPosition({ x: pointer(event).clientX, y: pointer(event).clientY });
    place(fromNode.type === "step" ? blankRepresentation() : blankStep("human"), { x, y }, (id) =>
      outgoing ? { source: fromNode.id, target: id } : { source: id, target: fromNode.id },
    );
  };

  return (
    <div className="overflow-hidden rounded border border-line">
      <div className="flex items-center gap-1 border-b border-line bg-wash px-2 py-1.5">
        <Button variant="secondary" onClick={() => add(blankRepresentation())}>
          <Plus className="size-3.5" />
          Representation
        </Button>
        {actorKinds.map((actor) => (
          <Button key={actor} variant="secondary" onClick={() => add(blankStep(actor))}>
            <span className={cx("size-2 rounded-full", actorFill[actor])} />
            <span className="capitalize">{actor}</span> step
          </Button>
        ))}
        <span className="ml-auto text-xs text-faint">Drag from a dot to connect or into empty space to add a node · the layout tidies itself</span>
      </div>
      <div ref={wrapper} className="experiment-canvas relative h-[70vh] min-h-[560px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) => {
            onChange((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes as AppNode[]) }));
            if (changes.some((change) => change.type === "remove")) onEvent("delete node");
          }}
          onEdgesChange={(changes) => {
            onChange((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges as Edge[]) }));
            if (changes.some((change) => change.type === "remove")) onEvent("delete edge");
          }}
          onConnect={(connection: Connection) => {
            onChange((current) => ({ ...current, edges: addEdge(connection, current.edges as Edge[]) }));
            onEvent("connect");
          }}
          onConnectEnd={extend}
          isValidConnection={({ source, target }) => source !== target && typeOf(source) !== typeOf(target)}
          connectionLineStyle={{ stroke: edgeColor, strokeWidth: 1.5 }}
          connectionRadius={40}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          minZoom={0.3}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#d5d8dd" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {canvas.nodes.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-faint">
            Start with a representation, then drag from its right dot to add the step that uses it.
          </p>
        )}
      </div>
    </div>
  );
}

function Preview({ canvas }: { canvas: Canvas }) {
  const { processes, problems } = useMemo(() => deriveProcesses(canvas), [canvas]);
  return (
    <Section title="Grammar" aside="Derived from the canvas">
      {processes.length === 0 && <p className="text-[13px] text-faint">Connect a representation to a step and the step to what it produces.</p>}
      <div className="space-y-4">
        {processes.map(({ rawExpression }) => {
          const result = parseProcess(rawExpression);
          return (
            <div key={rawExpression} className="rounded border border-line px-3 py-2">
              {result.ok ? <Expression process={result.process} /> : <ParseErrorView source={rawExpression} error={result.error} />}
            </div>
          );
        })}
      </div>
      {problems.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-muted">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function CanvasWorkspace({ known, ...props }: CanvasProps & { known: KnownVocabulary }) {
  return (
    <ReactFlowProvider>
      {vocabularyTypes.map((type) => (
        <datalist key={type} id={listId(type)}>
          {known[type].map((term) => (
            <option key={term} value={term} />
          ))}
        </datalist>
      ))}
      <Editor {...props} />
      <Preview canvas={props.canvas} />
    </ReactFlowProvider>
  );
}
