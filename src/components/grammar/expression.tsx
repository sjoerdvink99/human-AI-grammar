import { Fragment } from "react";
import { formatActor } from "@/domain/grammar/formatter";
import type { Process, Representation, State, Transform } from "@/domain/grammar/types";
import { cx } from "@/lib/cx";
import { Identifier } from "./identifier";

export interface Emphasis {
  roles?: string[];
  media?: string[];
  operations?: string[];
}

const marked = "rounded-sm bg-accent-wash underline decoration-accent/50 underline-offset-2";

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
      <span className="text-faint">)</span>
    </span>
  );
}

export function StateView({ state, emphasis }: { state: State; emphasis?: Emphasis }) {
  return (
    <span className="inline-flex flex-wrap gap-x-1.5">
      {state.representations.map((representation, index) => (
        <Fragment key={`${representation.id}-${index}`}>
          {index > 0 && <span className="text-faint">+</span>}
          <RepresentationView representation={representation} emphasis={emphasis} />
        </Fragment>
      ))}
    </span>
  );
}

export function TransformView({ transform, emphasis }: { transform: Transform; emphasis?: Emphasis }) {
  return (
    <span className="whitespace-nowrap text-accent">
      <span className="text-accent/50">[</span>
      <Identifier name={formatActor(transform)} />{" "}
      <span className={cx("font-semibold", emphasis?.operations?.includes(transform.operation) && marked)}>
        {transform.operation}
      </span>
      <span className="text-accent/50">]</span>
      {transform.stochastic && <span className="font-semibold">~</span>}
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

export function Expression({ process, emphasis, className }: { process: Process; emphasis?: Emphasis; className?: string }) {
  return (
    <div className={cx("font-mono text-[13px] leading-6 text-ink", className)}>
      <Line>
        <StateView state={process.states[0]} emphasis={emphasis} />
      </Line>
      {process.transforms.map((transform, index) => (
        <Fragment key={index}>
          <Line arrow>
            <TransformView transform={transform} emphasis={emphasis} />
          </Line>
          <Line arrow>
            <StateView state={process.states[index + 1]} emphasis={emphasis} />
          </Line>
        </Fragment>
      ))}
    </div>
  );
}
