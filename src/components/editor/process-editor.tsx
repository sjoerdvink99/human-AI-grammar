"use client";

import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, CircleDashed, X } from "lucide-react";
import { useMemo, useState } from "react";
import { completePart, identifiersIn } from "@/domain/grammar/completion";
import { Expression, StateView, TransformView } from "@/components/grammar/expression";
import { ParseErrorView } from "@/components/grammar/parse-error-view";
import { parseProcess } from "@/domain/grammar/parser";
import type { ParseError, Process, Representation } from "@/domain/grammar/types";
import type { VocabularyType } from "@/domain/grammar/vocabulary";
import { plural } from "@/lib/format";
import type { ProcessDraft } from "./draft";
import { ExpressionInput } from "./expression-input";

/** The input stops early but is valid so far, as after picking a starting point or a suggested step. */
const endsEarly = (source: string, error: ParseError) => error.offset + error.length >= source.trimEnd().length;

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
  const incomplete = !empty && !result.ok && (editing || endsEarly(process.rawExpression, result.error));
  const invalid = !empty && !result.ok && !incomplete;
  const partial = useMemo(() => (incomplete ? completePart(process.rawExpression) : null), [incomplete, process.rawExpression]);
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
        ) : incomplete ? (
          <span className="inline-flex items-center gap-1 text-xs text-faint">
            <CircleDashed className="size-3.5" />
            {editing ? "Editing…" : "Incomplete"}
          </span>
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

      <input
        value={process.description}
        onChange={(event) => onChange({ description: event.target.value })}
        placeholder="What happens, in plain words, and when? e.g. After a draft exists, the user highlights a passage and the model rewrites only that passage."
        aria-label="Process description"
        className="block h-9 w-full border-b border-line bg-transparent px-3 text-[13px] placeholder:text-faint focus:outline-none"
      />

      <div className="grid grid-cols-2 divide-x divide-line">
        <ExpressionInput
          value={process.rawExpression}
          onChange={(rawExpression) => onChange({ rawExpression })}
          source={source}
          rows={rows}
          invalid={invalid}
          placeholder={placeholder}
          onFocusChange={setEditing}
        />
        <div className="min-w-0 bg-wash/60 px-3 py-2.5">
          {empty && <p className="text-xs leading-6 text-faint">The parsed process appears here as you type.</p>}
          {incomplete && partial && <Expression process={partial} className="opacity-60" />}
          {incomplete && !editing && !result.ok && (
            <p className={partial ? "mt-2 text-xs text-faint" : "text-xs leading-6 text-faint"}>
              {result.error.message}. Pick a next step below or keep typing.
            </p>
          )}
          {incomplete && editing && !partial && (
            <p className="text-xs leading-6 text-faint">The parsed process appears here once the first step is complete.</p>
          )}
          {invalid && !result.ok && <ParseErrorView source={process.rawExpression} error={result.error} />}
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
