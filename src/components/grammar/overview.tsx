import { Code } from "lucide-react";
import { useId } from "react";
import { Section } from "@/components/ui/section";
import { formatActor } from "@/domain/grammar/formatter";
import type { ProcessGraph } from "@/domain/grammar/graph";
import { actorKinds, type ActorKind, type Process, type Transform } from "@/domain/grammar/types";
import { Expression } from "./expression";
import { layoutGraph } from "./graph-layout";

const nodeCharWidth = 7.2;
const labelCharWidth = 6.6;

const stroke: Record<ActorKind, string> = { human: "stroke-human", model: "stroke-model", tool: "stroke-tool" };
const fill: Record<ActorKind, string> = { human: "fill-human", model: "fill-model", tool: "fill-tool" };
const swatch: Record<ActorKind, string> = { human: "bg-human", model: "bg-model", tool: "bg-tool" };

const edgeLabel = (transform: Transform) => `${formatActor(transform)} ${transform.operation}${transform.stochastic ? "~" : ""}`;

const nodeWidth = (id: string) => id.length * nodeCharWidth + 20;

const tailLength = (transform: Transform) => edgeLabel(transform).length * labelCharWidth + 16;

function NodeText({ id, x, y }: { id: string; x: number; y: number }) {
  const match = /^(.*[^_])_([^_]+)$/.exec(id);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-ink font-mono text-[12px]">
      {match ? match[1] : id}
      {match && (
        <tspan dy={3} className="text-[9px]">
          {match[2]}
        </tspan>
      )}
    </text>
  );
}

function Graph({ graph }: { graph: ProcessGraph }) {
  const markerId = useId();
  const { width, height, boxes, strokes, labels } = layoutGraph(graph, nodeWidth, (edge) => tailLength(edge.transform));

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="mx-auto block overflow-visible">
        <defs>
          {actorKinds.map((actor) => (
            <marker key={actor} id={`${markerId}-${actor}`} viewBox="0 0 6 6" refX={6} refY={3} markerWidth={6} markerHeight={6} orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className={fill[actor]} />
            </marker>
          ))}
        </defs>
        {strokes.map(({ key, path, transform, arrow }) => (
          <path
            key={key}
            d={path}
            fill="none"
            strokeWidth={1.25}
            strokeDasharray={transform?.stochastic ? "4 3" : undefined}
            markerEnd={transform && arrow ? `url(#${markerId}-${transform.actor})` : undefined}
            className={transform ? stroke[transform.actor] : "stroke-line-strong"}
          />
        ))}
        {labels.map(({ key, x, y, transform }) => (
          <text
            key={key}
            x={x}
            y={y}
            textAnchor="end"
            paintOrder="stroke"
            strokeWidth={4}
            strokeLinejoin="round"
            className={`stroke-white font-mono text-[11px] ${fill[transform.actor]}`}
          >
            {edgeLabel(transform)}
          </text>
        ))}
        {graph.nodes.map(({ representation }) => {
          const { x, y, width: w, height: h } = boxes.get(representation.id)!;
          return (
            <g key={representation.id}>
              <title>{`${representation.role} ${representation.medium}`}</title>
              <rect x={x} y={y} width={w} height={h} rx={4} className="fill-white stroke-line-strong" />
              <NodeText id={representation.id} x={x + w / 2} y={y + h / 2} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ExpressionTip({ process }: { process: Process }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label="Show expression"
        className="rounded p-0.5 text-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
      >
        <Code className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className="invisible absolute top-full left-0 z-10 mt-1.5 w-max max-w-[min(56rem,calc(100vw-2rem))] rounded border border-line bg-white px-3 py-2 opacity-0 shadow-lg shadow-ink/5 transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        <Expression process={process} />
      </span>
    </span>
  );
}

export function Overview({ title = "Overview", graphs }: { title?: string; graphs: { label?: string; process?: Process; graph: ProcessGraph }[] }) {
  if (graphs.length === 0) return null;
  const actors = actorKinds.filter((actor) => graphs.some(({ graph }) => graph.edges.some((edge) => edge.transform.actor === actor)));

  return (
    <Section
      title={title}
      aside={
        <span className="flex gap-3">
          {actors.map((actor) => (
            <span key={actor} className="flex items-center gap-1.5">
              <span className={`h-0.5 w-3 rounded-full ${swatch[actor]}`} />
              {actor}
            </span>
          ))}
        </span>
      }
    >
      <ol className="divide-y divide-line border-y border-line">
        {graphs.map(({ label, process, graph }, index) => (
          <li key={label ?? index} className="py-6">
            {label && (
              <div className="mb-4 flex items-center gap-1.5">
                <span className="font-mono text-xs text-faint">{label}</span>
                {process && <ExpressionTip process={process} />}
              </div>
            )}
            <Graph graph={graph} />
          </li>
        ))}
      </ol>
    </Section>
  );
}
