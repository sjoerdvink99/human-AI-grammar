"use client";

import { useMemo } from "react";
import { appendTransition, lastStateOf, recommend } from "@/domain/design/inspiration";
import { formatActor, formatType } from "@/domain/grammar/formatter";
import type { SystemEntry } from "@/domain/systems/types";
import { plural } from "@/lib/format";
import { starters } from "./guide";

const chipClass = "rounded-sm border border-line bg-wash px-1.5 py-px leading-5 hover:border-line-strong";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-1.5 text-xs">
      <span className="w-10 shrink-0 text-muted">{label}</span>
      <div className="flex flex-wrap gap-x-2 gap-y-1.5">{children}</div>
    </div>
  );
}

export function NextSteps({
  entries,
  rawExpression,
  onChange,
}: {
  entries: SystemEntry[];
  rawExpression: string;
  onChange: (rawExpression: string) => void;
}) {
  const state = useMemo(() => lastStateOf(rawExpression), [rawExpression]);
  const options = useMemo(() => (state ? recommend(entries, state) : []), [entries, state]);

  if (!rawExpression.trim()) {
    return (
      <Row label="Start">
        {starters.map((starter) => (
          <button key={starter.label} type="button" onClick={() => onChange(starter.expression)} className={chipClass}>
            {starter.label}
          </button>
        ))}
      </Row>
    );
  }

  if (options.length === 0) return null;

  return (
    <Row label="Then">
      {options.map(({ transform, after, produced, systems }, index) => (
        <button
          key={index}
          type="button"
          title={`Follows a similar state in ${plural(systems, "system")}`}
          onClick={() => onChange(appendTransition(rawExpression, transform, after))}
          className={`${chipClass} font-mono`}
        >
          <span className="text-accent">
            {formatActor(transform)} {transform.operation}
            {transform.generative && "~"}
          </span>{" "}
          <span className="text-faint">→</span> {produced.map(formatType).join(" + ")}
          <span className="ml-1.5 font-sans text-faint">{systems}</span>
        </button>
      ))}
    </Row>
  );
}
