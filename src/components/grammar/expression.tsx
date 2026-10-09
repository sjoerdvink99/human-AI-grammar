import { Fragment } from "react";
import { formatActor, formatType } from "@/domain/grammar/formatter";
import type { Process, Representation, State, Transform } from "@/domain/grammar/types";
import { describeActor } from "@/domain/systems/actors";
import type { ActorCatalog } from "@/domain/systems/types";
import { cx } from "@/lib/cx";
import { Identifier } from "./identifier";

export interface Emphasis {
  roles?: string[];
  media?: string[];
  operations?: string[];
}

const marked = "rounded-sm bg-accent-wash underline decoration-accent/50 underline-offset-2";

// A representation carried over unchanged from the previous state is written by its identifier alone, as =(id).
function CarriedView({ representation }: { representation: Representation }) {
  return (
    <span className="whitespace-nowrap text-faint" title={`carried over: ${formatType(representation)}`}>
      =(
      <Identifier name={representation.id} />)
    </span>
  );
}

function RepresentationView({ representation, emphasis }: { representation: Representation; emphasis?: Emphasis }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-faint">(</span>
      <span className="text-muted">
        <Identifier name={representation.id} />
      </span>
      <span className="text-faint">: </span>
      <span className={cx(emphasis?.roles?.includes(representation.role) && marked)}>{representation.role}</span>{" "}
      <span className={cx(emphasis?.media?.includes(representation.medium) && marked)}>{representation.medium}</span>
      <span className="text-faint">){representation.collection && "*"}</span>
    </span>
  );
}

export function StateView({ state, previous, emphasis }: { state: State; previous?: State; emphasis?: Emphasis }) {
  const carried = new Set(previous?.representations.map(({ id }) => id));
  return (
    <span className="inline-flex flex-wrap gap-x-1.5">
      {state.representations.map((representation, index) => (
        <Fragment key={`${representation.id}-${index}`}>
          {index > 0 && <span className="text-faint">+</span>}
          {carried.has(representation.id) ? (
            <CarriedView representation={representation} />
          ) : (
            <RepresentationView representation={representation} emphasis={emphasis} />
          )}
        </Fragment>
      ))}
    </span>
  );
}

export function TransformView({ transform, emphasis, actors }: { transform: Transform; emphasis?: Emphasis; actors?: ActorCatalog }) {
  const details = actors?.[formatActor(transform)];
  return (
    <span className="whitespace-nowrap text-accent">
      <span className="text-accent/50">[</span>
      <span title={details && describeActor(details)}>
        <Identifier name={formatActor(transform)} />
      </span>{" "}
      <span className={cx("font-semibold", emphasis?.operations?.includes(transform.operation) && marked)}>
        {transform.operation}
      </span>
      <span className="text-accent/50">]</span>
      {transform.generative && <span className="font-semibold">~</span>}
    </span>
  );
}

function Line({ arrow, children }: { arrow?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-4 shrink-0 text-faint select-none">{arrow ? "→" : ""}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// The models and tools of a process that the paper describes, listed under its expression.
function ActorLegend({ process, actors }: { process: Process; actors: ActorCatalog }) {
  const described = [...new Set(process.transforms.map(formatActor))].filter((actor) => actors[actor]);
  if (described.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 border-t border-line pt-2 text-[12px] leading-5">
      {described.map((actor) => (
        <Fragment key={actor}>
          <dt className="text-accent">
            <Identifier name={actor} />
          </dt>
          <dd className="font-sans text-muted">{describeActor(actors[actor])}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function Expression({
  process,
  emphasis,
  actors,
  className,
}: {
  process: Process;
  emphasis?: Emphasis;
  actors?: ActorCatalog;
  className?: string;
}) {
  return (
    <div className={cx("font-mono text-[13px] leading-6 text-ink", className)}>
      <Line>
        <StateView state={process.states[0]} emphasis={emphasis} />
      </Line>
      {process.transforms.map((transform, index) => (
        <Fragment key={index}>
          <Line arrow>
            <TransformView transform={transform} emphasis={emphasis} actors={actors} />
          </Line>
          <Line arrow>
            <StateView state={process.states[index + 1]} previous={process.states[index]} emphasis={emphasis} />
          </Line>
        </Fragment>
      ))}
      {actors && <ActorLegend process={process} actors={actors} />}
    </div>
  );
}
