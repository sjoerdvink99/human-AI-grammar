import { Code } from "lucide-react";
import { Fragment } from "react";
import { Section } from "@/components/ui/section";
import { representationPlaces, type ProcessGraph } from "@/domain/grammar/graph";
import { actorKinds, type ActorKind, type Process } from "@/domain/grammar/types";
import type { ActorCatalog } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { Expression, type Emphasis } from "./expression";
import { ExportButton } from "./graph-export";
import { GraphHighlight } from "./graph-highlight";
import { GraphView } from "./graph-view";
import { Identifier } from "./identifier";

const swatch: Record<ActorKind, string> = { human: "bg-human", model: "bg-model", tool: "bg-tool" };

export function ExpressionTip({
  process,
  actors,
  emphasis,
  align = "left",
}: {
  process: Process;
  actors?: ActorCatalog;
  emphasis?: Emphasis;
  align?: "left" | "right";
}) {
  return (
    <span className="group/tip inline-flex">
      <button
        type="button"
        aria-label="Show expression"
        className="rounded p-0.5 text-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
      >
        <Code className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={cx(
          "invisible absolute top-full z-10 mt-1.5 w-max max-w-[min(56rem,calc(100vw-2rem))] rounded border border-line bg-white px-3 py-2 opacity-0 shadow-lg shadow-ink/5 transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        <Expression process={process} actors={actors} emphasis={emphasis} />
      </span>
    </span>
  );
}

export interface ProcessRef {
  anchor: string;
  label: string;
  name?: string;
  via?: string[];
}

export interface Relations {
  from: ProcessRef[];
  to: ProcessRef[];
}

function Refs({ refs }: { refs: ProcessRef[] }) {
  return refs.map(({ anchor, label, name, via }, index) => (
    <Fragment key={anchor}>
      {index > 0 && ", "}
      <a href={`#${anchor}`} title={name} className="font-mono text-ink hover:text-accent">
        {label}
      </a>
      {via && (
        <span className="font-mono text-faint">
          {" ("}
          {via.map((id, position) => (
            <Fragment key={id}>
              {position > 0 && ", "}
              <Identifier name={id} />
            </Fragment>
          ))}
          {")"}
        </span>
      )}
    </Fragment>
  ));
}

function RelationLine({ relations }: { relations: Relations }) {
  const { from, to } = relations;
  if (from.length === 0 && to.length === 0) return <p className="mt-1 text-xs text-faint">Independent of the other processes</p>;
  return (
    <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
      {from.length > 0 ? (
        <span>
          Continues from <Refs refs={from} />
        </span>
      ) : (
        <span>Entry point</span>
      )}
      {to.length > 0 && (
        <span>
          Leads to <Refs refs={to} />
        </span>
      )}
    </p>
  );
}

export function Overview({
  title = "Overview",
  graphs,
  actors,
  exportName,
}: {
  title?: string;
  graphs: {
    label?: string;
    place?: string;
    anchor?: string;
    description?: string | null;
    relations?: Relations;
    process?: Process;
    graph: ProcessGraph;
  }[];
  actors?: ActorCatalog;
  exportName?: string;
}) {
  if (graphs.length === 0) return null;
  const kinds = actorKinds.filter((actor) => graphs.some(({ graph }) => graph.edges.some((edge) => edge.transform.actor === actor)));
  const carried = graphs.some(({ graph }) => graph.nodes.some((node) => node.carried));
  const places = representationPlaces(graphs.flatMap(({ place, graph }) => (place ? [{ place, graph }] : [])));

  return (
    <Section
      title={title}
      aside={
        <span className="flex gap-3">
          {kinds.map((actor) => (
            <span key={actor} className="flex items-center gap-1.5">
              <span className={`h-0.5 w-3 rounded-full ${swatch[actor]}`} />
              {actor}
            </span>
          ))}
          {carried && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-[2px] border border-dashed border-line-strong" />
              carried over
            </span>
          )}
        </span>
      }
    >
      <GraphHighlight places={places}>
        <ol className="divide-y divide-line border-y border-line">
          {graphs.map(({ label, place, anchor, description, relations, process, graph }, index) => (
            <li key={label ?? index} id={anchor} data-graph-card className="scroll-mt-6 py-6">
              {label && (
                <div className="mb-4">
                  <div className="relative flex items-center gap-1.5">
                    <span className="font-mono text-xs text-faint">{label}</span>
                    {process && <ExpressionTip process={process} actors={actors} />}
                    {exportName && place && <ExportButton fileName={`${exportName}-process-${place}.png`} />}
                  </div>
                  {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
                  {relations && <RelationLine relations={relations} />}
                </div>
              )}
              <GraphView graph={graph} actors={actors} place={place} />
            </li>
          ))}
        </ol>
      </GraphHighlight>
    </Section>
  );
}
