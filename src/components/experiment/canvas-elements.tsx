"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  useReactFlow,
  useStore,
  type EdgeProps,
  type ReactFlowState,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { RepresentationData, StepData } from "@/domain/experiment/canvas";
import { actorKinds, type ActorKind } from "@/domain/grammar/types";
import { cx } from "@/lib/cx";

export type RepresentationNodeType = Node<RepresentationData, "representation">;
export type StepNodeType = Node<StepData, "step">;
export type AppNode = RepresentationNodeType | StepNodeType;

export const listId = (type: "role" | "medium" | "operation") => `experiment-${type}`;

export const actorFill: Record<ActorKind, string> = { human: "bg-human", model: "bg-model", tool: "bg-tool" };

const actorBorder: Record<ActorKind, string> = { human: "border-human", model: "border-model", tool: "border-tool" };

const actorWash: Record<ActorKind, string> = { human: "bg-human/5", model: "bg-model/5", tool: "bg-tool/5" };

const actorHandle: Record<ActorKind, string> = { human: "!bg-human", model: "!bg-model", tool: "!bg-tool" };

const field =
  "nodrag w-full rounded-sm border border-line bg-white px-1.5 py-1 text-xs placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none";

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx("nodrag nopan flex size-5 shrink-0 items-center justify-center rounded-full", className)}
    >
      <X className="size-3.5" />
    </button>
  );
}

function Frame({
  id,
  selected,
  header,
  handle,
  className,
  headerClass,
  removeClass,
  children,
}: {
  id: string;
  selected: boolean;
  header: ReactNode;
  handle: string;
  className: string;
  headerClass: string;
  removeClass: string;
  children: ReactNode;
}) {
  const { deleteElements } = useReactFlow();
  return (
    <div className={cx("group shadow-sm", selected && "shadow-lg ring-2 ring-accent/40 ring-offset-2", className)}>
      <Handle type="target" position={Position.Left} className={cx("!size-3 !border-2 !border-white", handle)} />
      <div className={cx("flex h-8 cursor-grab items-center gap-1.5 pr-1.5 pl-2.5 active:cursor-grabbing", headerClass)}>
        {header}
        <RemoveButton
          label="Remove"
          onClick={() => deleteElements({ nodes: [{ id }] })}
          className={cx("ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100", selected && "opacity-100", removeClass)}
        />
      </div>
      <div className="space-y-1.5 px-2.5 pt-1 pb-2.5">{children}</div>
      <Handle type="source" position={Position.Right} className={cx("!size-3 !border-2 !border-white", handle)} />
    </div>
  );
}

function Toggle({ label, symbol, checked, onChange }: { label: string; symbol: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="nodrag flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-muted select-none">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-accent" />
      {label}
      <span className="font-mono">{symbol}</span>
    </label>
  );
}

function Kind({ symbol, label }: { symbol: string; label?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase select-none">
      <span className="font-mono text-xs">{symbol}</span>
      {label}
    </span>
  );
}

function useUpdate<T extends Record<string, unknown>>(id: string) {
  const { updateNodeData } = useReactFlow();
  return (changes: Partial<T>) => updateNodeData(id, changes);
}

export function RepresentationNode({ id, data, selected }: NodeProps<RepresentationNodeType>) {
  const update = useUpdate<RepresentationData>(id);
  return (
    <Frame
      id={id}
      selected={selected}
      header={<Kind symbol="( )" label="Representation" />}
      handle="!rounded-full !bg-faint"
      className="w-52 rounded-2xl border border-line-strong bg-white"
      headerClass="text-faint"
      removeClass="text-faint hover:bg-wash hover:text-danger"
    >
      <input
        className={cx(field, "font-mono text-[13px] font-medium")}
        value={data.name}
        placeholder="name"
        onChange={(event) => update({ name: event.target.value })}
      />
      <div className="grid grid-cols-2 gap-1">
        <input className={field} list={listId("role")} value={data.role} placeholder="role" onChange={(event) => update({ role: event.target.value })} />
        <input className={field} list={listId("medium")} value={data.medium} placeholder="medium" onChange={(event) => update({ medium: event.target.value })} />
      </div>
      <Toggle label="many items" symbol="*" checked={data.collection} onChange={(collection) => update({ collection })} />
      <textarea className={cx(field, "resize-none")} rows={2} value={data.note} placeholder="what it contains" onChange={(event) => update({ note: event.target.value })} />
    </Frame>
  );
}

export function StepNode({ id, data, selected }: NodeProps<StepNodeType>) {
  const update = useUpdate<StepData>(id);
  return (
    <Frame
      id={id}
      selected={selected}
      header={
        <>
          <Kind symbol="[ ]" />
          <select
            aria-label="Actor"
            className="nodrag cursor-pointer rounded-sm bg-white/15 px-1 py-0.5 text-[11px] font-semibold tracking-wide uppercase hover:bg-white/25 focus:outline-none"
            value={data.actor}
            onChange={(event) => update({ actor: event.target.value as ActorKind })}
          >
            {actorKinds.map((actor) => (
              <option key={actor} value={actor} className="text-ink">
                {actor}
              </option>
            ))}
          </select>
        </>
      }
      handle={cx("!rounded-[2px]", actorHandle[data.actor])}
      className={cx("w-48 rounded-[3px] border-2", actorBorder[data.actor], actorWash[data.actor])}
      headerClass={cx("text-white", actorFill[data.actor])}
      removeClass="text-white/80 hover:bg-white/20 hover:text-white"
    >
      <input
        className={cx(field, "font-mono text-[13px] font-medium")}
        list={listId("operation")}
        value={data.operation}
        placeholder="operation"
        onChange={(event) => update({ operation: event.target.value })}
      />
      <Toggle label="generative" symbol="~" checked={data.generative} onChange={(generative) => update({ generative })} />
      <textarea className={cx(field, "resize-none")} rows={2} value={data.note} placeholder="how it works" onChange={(event) => update({ note: event.target.value })} />
    </Frame>
  );
}

const loopGap = 32;

const lowestEdge = (state: ReactFlowState) =>
  Math.max(...[...state.nodeLookup.values()].map((node) => node.internals.positionAbsolute.y + (node.measured.height ?? 0)));

function loopPath(sourceX: number, sourceY: number, targetX: number, targetY: number, floor: number): [string, number, number] {
  const bottom = Math.max(sourceY, targetY, floor) + loopGap;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `C ${sourceX + 48} ${sourceY} ${sourceX + 48} ${bottom} ${sourceX} ${bottom}`,
    `L ${targetX} ${bottom}`,
    `C ${targetX - 48} ${bottom} ${targetX - 48} ${targetY} ${targetX} ${targetY}`,
  ].join(" ");
  return [path, (sourceX + targetX) / 2, bottom];
}

export function RemovableEdge({ id, selected, markerEnd, style, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const floor = useStore(lowestEdge);
  const [path, x, y] = targetX < sourceX ? loopPath(sourceX, sourceY, targetX, targetY, floor) : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={selected ? { ...style, stroke: "var(--color-accent)", strokeWidth: 2 } : style} interactionWidth={24} />
      {selected && (
        <EdgeLabelRenderer>
          <div className="pointer-events-auto absolute" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>
            <RemoveButton
              label="Remove connection"
              onClick={() => deleteElements({ edges: [{ id }] })}
              className="border border-line bg-white text-faint shadow-sm hover:text-danger"
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
