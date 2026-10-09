"use client";

import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { completePart, identifiersIn } from "@/domain/grammar/completion";
import { Expression, StateView, TransformView } from "@/components/grammar/expression";
import { ParseErrorView } from "@/components/grammar/parse-error-view";
import { parseProcess } from "@/domain/grammar/parser";
import type { Process, Representation } from "@/domain/grammar/types";
import type { VocabularyType } from "@/domain/grammar/vocabulary";
import { plural } from "@/lib/format";
import type { ProcessDraft } from "./draft";
import { ExpressionInput } from "./expression-input";

export type KnownVocabulary = Record<VocabularyType, string[]>;

const noIdentifiers: string[] = [];

const placeholder = `(prompt_1: instruction language)
-> [model generate]~
-> (artifact_1: artifact language)`;

function distinctRepresentations(process: Process): Representation[] {
  const seen = new Map<string, Representation>();
  for (const representation of process.states.flatMap((state) => state.representations)) {
    seen.set(`${representation.id}:${representation.role}:${representation.medium}`, representation);
  }
  return [...seen.values()];
}

function newTerms(process: Process, known: KnownVocabulary): { type: VocabularyType; term: string }[] {
  const representations = process.states.flatMap((state) => state.representations);
  const terms: Record<VocabularyType, string[]> = {
    role: representations.map((representation) => representation.role),
    medium: representations.map((representation) => representation.medium),
    operation: process.transforms.map((transform) => transform.operation),
  };
  return (Object.keys(terms) as VocabularyType[]).flatMap((type) =>
    [...new Set(terms[type])].filter((term) => !known[type].includes(term)).map((term) => ({ type, term })),
  );
}

export function ProcessEditor({
  index,
  process,
  known,
  onChange,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
  identifiers = noIdentifiers,
}: {
  index: number;
  process: ProcessDraft;
  known: KnownVocabulary;
  onChange: (changes: Partial<ProcessDraft>) => void;
  onMove: (offset: number) => void;
  onRemove?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  identifiers?: string[];
}) {
  const empty = process.rawExpression.trim() === "";
  const result = useMemo(() => parseProcess(process.rawExpression), [process.rawExpression]);
  const parsed = !empty && result.ok ? result.process : null;
  const [editing, setEditing] = useState(false);
  const pending = editing && !empty && !result.ok;
  const partial = useMemo(() => (pending ? completePart(process.rawExpression) : null), [pending, process.rawExpression]);
  const rows = Math.max(5, process.rawExpression.split("\n").length + 1);
  const source = useMemo(
    () => ({ vocabulary: known, identifiers: [...new Set([...identifiers, ...identifiersIn(process.rawExpression)])] }),
    [known, identifiers, process.rawExpression],
  );

  return (
    <div className="rounded border border-line">
      <div className="flex items-center gap-3 border-b border-line px-3 py-1.5">
        <span className="font-mono text-xs text-faint tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <input
          value={process.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Process name (optional)"
          aria-label="Process name"
          className="h-7 flex-1 bg-transparent text-[13px] font-medium placeholder:font-normal placeholder:text-faint focus:outline-none"
        />
        {empty ? (
          <span className="text-xs text-faint">Empty</span>
        ) : pending ? (
          <span className="text-xs text-faint">Editing…</span>
        ) : result.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <CircleCheck className="size-3.5 text-tool" />
            {plural(result.process.states.length, "state")} · {plural(result.process.transforms.length, "transformation")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <CircleAlert className="size-3.5" />
            Line {result.error.line}, column {result.error.column}
          </span>
        )}
        <div className="flex items-center gap-0.5 text-faint">
          <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} aria-label="Move up" className="rounded p-1 hover:bg-wash hover:text-ink disabled:opacity-30">
            <ArrowUp className="size-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} aria-label="Move down" className="rounded p-1 hover:bg-wash hover:text-ink disabled:opacity-30">
            <ArrowDown className="size-3.5" />
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label="Remove process" className="rounded p-1 hover:bg-wash hover:text-danger">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line">
        <ExpressionInput
          value={process.rawExpression}
          onChange={(rawExpression) => onChange({ rawExpression })}
          source={source}
          rows={rows}
          invalid={!empty && !result.ok && !editing}
          placeholder={placeholder}
          onFocusChange={setEditing}
        />
        <div className="min-w-0 bg-wash/60 px-3 py-2.5">
          {empty && <p className="text-xs leading-6 text-faint">The parsed process appears here as you type.</p>}
          {pending &&
            (partial ? (
              <Expression process={partial} className="opacity-60" />
            ) : (
              <p className="text-xs leading-6 text-faint">The parsed process appears here once the first step is complete.</p>
            ))}
          {!empty && !result.ok && !editing && <ParseErrorView source={process.rawExpression} error={result.error} />}
          {parsed && <Expression process={parsed} />}
        </div>
      </div>

      {parsed && <Extraction process={parsed} known={known} />}
    </div>
  );
}

function Extraction({ process, known }: { process: Process; known: KnownVocabulary }) {
  const fresh = newTerms(process, known);
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line px-3 py-2.5 text-xs">
      <span className="text-muted">Representations</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
        {distinctRepresentations(process).map((representation) => (
          <StateView key={`${representation.id}:${representation.role}:${representation.medium}`} state={{ representations: [representation] }} />
        ))}
      </div>
      <span className="text-muted">Transformations</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
        {process.transforms.map((transform, index) => (
          <TransformView key={index} transform={transform} />
        ))}
      </div>
      {fresh.length > 0 && (
        <>
          <span className="text-muted">New vocabulary</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {fresh.map(({ type, term }) => (
              <span key={`${type}:${term}`}>
                <span className="text-faint">{type}</span> <span className="font-mono text-accent">{term}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
