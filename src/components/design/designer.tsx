"use client";

import { CornerDownRight, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { newProcess, type ProcessDraft } from "@/components/editor/draft";
import { ProcessEditor, type KnownVocabulary } from "@/components/editor/process-editor";
import { Button } from "@/components/ui/button";
import { Overview } from "@/components/grammar/overview";
import { Field, Input, TextArea } from "@/components/ui/field";
import { Section } from "@/components/ui/section";
import { connections } from "@/domain/design/connections";
import { similarSystems } from "@/domain/design/inspiration";
import { decodeSpec, designParam, emptySpec, encodeSpec, namedRepresentations, type DesignSpec } from "@/domain/design/spec";
import { identifiersIn } from "@/domain/grammar/completion";
import { formatState } from "@/domain/grammar/formatter";
import { processGraph } from "@/domain/grammar/graph";
import { parseProcess } from "@/domain/grammar/parser";
import type { Process } from "@/domain/grammar/types";
import type { SystemEntry } from "@/domain/systems/types";
import { Connections } from "./connections";
import { Guide } from "./guide";
import { Implement } from "./implement";
import { NextSteps } from "./next-steps";
import { Representations } from "./representations";
import { SimilarSystems } from "./similar-systems";

interface DesignProcess extends ProcessDraft {
  note: string;
}

interface DesignDraft {
  name: string;
  goal: string;
  processes: DesignProcess[];
  representations: Record<string, string>;
  references: string[];
}

const designProcess = (rawExpression = "", name = "", note = ""): DesignProcess => ({ ...newProcess(rawExpression, name), note });

const draftFromSpec = (spec: DesignSpec): DesignDraft => ({
  ...spec,
  processes: spec.processes.map((process) => designProcess(process.rawExpression, process.name, process.note)),
});

const optional = (value: string) => (value.trim() ? value.trim() : undefined);

const specFromDraft = (draft: DesignDraft): DesignSpec => {
  const names = new Set(namedRepresentations(draft.processes.map((process) => process.rawExpression)).map(({ name }) => name));
  return {
    name: draft.name.trim(),
    goal: draft.goal.trim(),
    processes: draft.processes.map(({ name, rawExpression, note }) => ({ name: optional(name), rawExpression, note: optional(note) })),
    representations: Object.fromEntries(
      Object.entries(draft.representations)
        .map(([name, description]) => [name, description.trim()])
        .filter(([name, description]) => description && names.has(name)),
    ),
    references: draft.references,
  };
};

const isEmpty = (spec: DesignSpec) =>
  !spec.name &&
  !spec.goal &&
  spec.references.length === 0 &&
  Object.keys(spec.representations).length === 0 &&
  spec.processes.every((process) => !process.rawExpression.trim());

export const processLabel = (index: number, name: string) => `${String(index + 1).padStart(2, "0")}${name.trim() ? ` ${name.trim()}` : ""}`;

export function Designer({ entries, known }: { entries: SystemEntry[]; known: KnownVocabulary }) {
  const params = useSearchParams();
  const [draft, setDraft] = useState(() => draftFromSpec(decodeSpec(params.get(designParam)) ?? emptySpec()));
  const [active, setActive] = useState(0);

  const spec = useMemo(() => specFromDraft(draft), [draft]);
  const encoded = isEmpty(spec) ? null : encodeSpec(spec);
  const results = useMemo(() => draft.processes.map((process) => parseProcess(process.rawExpression)), [draft.processes]);
  const processes = useMemo(() => results.map((result) => (result.ok ? result.process : null)), [results]);
  const parsed = useMemo(() => processes.filter((process): process is Process => process !== null), [processes]);
  const similar = useMemo(() => similarSystems(entries, parsed), [entries, parsed]);
  const links = useMemo(() => connections(processes), [processes]);
  const graph = useMemo(() => processGraph(parsed), [parsed]);
  const named = useMemo(() => namedRepresentations(draft.processes.map((process) => process.rawExpression)), [draft.processes]);
  const identifiers = useMemo(() => [...new Set(draft.processes.flatMap((process) => identifiersIn(process.rawExpression)))], [draft.processes]);
  const activeIndex = Math.min(active, draft.processes.length - 1);
  const activeProcess = processes[activeIndex];
  const activeLabel = processLabel(activeIndex, draft.processes[activeIndex].name);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (encoded) url.searchParams.set(designParam, encoded);
    else url.searchParams.delete(designParam);
    window.history.replaceState(null, "", url);
  }, [encoded]);

  const updateProcesses = (update: (processes: DesignProcess[]) => DesignProcess[]) =>
    setDraft((current) => ({ ...current, processes: update(current.processes) }));

  const updateProcess = (key: string, changes: Partial<DesignProcess>) =>
    updateProcesses((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const moveProcess = (index: number, offset: number) =>
    updateProcesses((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + offset, 0, moved);
      return next;
    });

  const addProcess = (rawExpression = "", note = "") => {
    updateProcesses((current) => [...current, designProcess(rawExpression, "", note)]);
    setActive(draft.processes.length);
  };

  const reference = (key: string) =>
    setDraft((current) => (current.references.includes(key) ? current : { ...current, references: [...current.references, key] }));


  return (
    <div className="max-w-5xl">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
        <Field label="Name">
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Untitled system" />
        </Field>
        <Field label="Goal" hint="who it is for and what it helps them do">
          <TextArea
            value={draft.goal}
            onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
            rows={2}
            placeholder="Help journalists verify claims with evidence a model retrieves and weighs"
          />
        </Field>
      </div>

      <Section title="Processes" aside="Type ( or [ for suggestions · Ctrl+Space to show them">
        <Guide />

        <div className="space-y-5">
          {draft.processes.map((process, index) => (
            <div
              key={process.key}
              onFocusCapture={() => setActive(index)}
              className={draft.processes.length > 1 && index === activeIndex ? "rounded ring-2 ring-accent/15" : undefined}
            >
              <ProcessEditor
                index={index}
                process={process}
                known={known}
                identifiers={identifiers}
                canMoveUp={index > 0}
                canMoveDown={index < draft.processes.length - 1}
                onMove={(offset) => moveProcess(index, offset)}
                onChange={(changes) => updateProcess(process.key, changes)}
                onRemove={
                  draft.processes.length > 1
                    ? () => updateProcesses((current) => current.filter((item) => item.key !== process.key))
                    : undefined
                }
              />
              {index === activeIndex && (
                <NextSteps
                  entries={entries}
                  rawExpression={process.rawExpression}
                  onChange={(rawExpression) => updateProcess(process.key, { rawExpression })}
                />
              )}
              <label className="flex items-center gap-3 px-3 py-1.5">
                <span className="w-10 shrink-0 text-xs text-muted">When</span>
                <input
                  value={process.note}
                  onChange={(event) => updateProcess(process.key, { note: event.target.value })}
                  placeholder="When does this happen? e.g. after 01, when the user selects text, repeats until the draft is accepted"
                  className="h-7 flex-1 bg-transparent text-[13px] placeholder:text-faint focus:outline-none"
                />
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 -ml-3 flex items-center gap-1">
          <Button variant="ghost" onClick={() => addProcess()}>
            <Plus className="size-3.5" />
            Add process
          </Button>
          {activeProcess && (
            <Button
              variant="ghost"
              onClick={() =>
                addProcess(`${formatState(activeProcess.states[activeProcess.states.length - 1])}\n`, `after ${activeLabel}`)
              }
            >
              <CornerDownRight className="size-3.5" />
              Continue after {activeLabel}
            </Button>
          )}
        </div>
      </Section>

      <Representations
        named={named}
        descriptions={draft.representations}
        onChange={(name, description) =>
          setDraft((current) => ({ ...current, representations: { ...current.representations, [name]: description } }))
        }
      />

      <Overview graphs={graph.edges.length > 0 ? [{ graph }] : []} />

      {draft.processes.length > 1 && (
        <Connections
          labels={draft.processes.map((process, index) => processLabel(index, process.name))}
          notes={draft.processes.map((process) => process.note.trim())}
          parsed={processes.map(Boolean)}
          links={links}
        />
      )}

      <SimilarSystems similar={similar} references={draft.references} onReference={reference} />

      <Implement
        spec={spec}
        encoded={encoded}
        complete={results.every((result) => result.ok)}
        entries={entries}
        onRemoveReference={(key) => setDraft({ ...draft, references: draft.references.filter((item) => item !== key) })}
      />
    </div>
  );
}
