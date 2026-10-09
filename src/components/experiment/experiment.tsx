"use client";

import { Download } from "lucide-react";
import { useEffect, useState, type SetStateAction } from "react";
import type { KnownVocabulary } from "@/components/editor/process-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, TextArea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import type { Canvas } from "@/domain/experiment/canvas";
import { elapsedSeconds, newStudy, sessionFile, type Session } from "@/domain/experiment/session";
import { conditionLabels, instruction, tasks, timeBox, tips, tutorialCanvas, type TaskId } from "@/domain/experiment/study";
import { cx } from "@/lib/cx";
import { CanvasWorkspace } from "./canvas-workspace";

function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

function download(session: Session) {
  const { name, type, content } = sessionFile(session);
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Timer({ started }: { started: string }) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(started));
  useEffect(() => {
    const interval = setInterval(() => setSeconds(elapsedSeconds(started)), 1000);
    return () => clearInterval(interval);
  }, [started]);
  return <span className={cx("font-mono text-[13px] tabular-nums", seconds > timeBox ? "text-danger" : "text-muted")}>{clock(seconds)}</span>;
}

function Brief({ task }: { task: TaskId }) {
  return (
    <div className="max-w-3xl space-y-2">
      <h2 className="text-base font-semibold">{tasks[task].title}</h2>
      <p className="text-[13px] leading-relaxed">{tasks[task].description}</p>
      <p className="text-[13px] text-muted">{instruction}</p>
    </div>
  );
}

function Setup({ onStart }: { onStart: (parts: Session[]) => void }) {
  const [participant, setParticipant] = useState("");
  return (
    <>
      <PageHeader
        title="Experiment"
        description="You will specify two systems, each in about 15 minutes: one as a text prompt and one on a grammar canvas. The order is drawn at random."
      />
      <Field label="Participant" className="max-w-xs">
        <Input value={participant} onChange={(event) => setParticipant(event.target.value)} placeholder="P01" />
      </Field>
      <Button variant="primary" className="mt-5" disabled={!participant.trim()} onClick={() => onStart(newStudy(participant))}>
        Start
      </Button>
    </>
  );
}

function Tutorial({ known, label, onDone }: { known: KnownVocabulary; label: string; onDone: () => void }) {
  const [canvas, setCanvas] = useState<Canvas>(tutorialCanvas);
  return (
    <>
      <PageHeader
        title="Grammar canvas tutorial"
        description={label}
        actions={
          <Button variant="primary" onClick={onDone}>
            Continue to the system
          </Button>
        }
      />
      <ol className="mb-5 max-w-3xl list-decimal space-y-1 pl-5 text-[13px]">
        {tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ol>
      <CanvasWorkspace known={known} canvas={canvas} onChange={setCanvas} />
    </>
  );
}

function Work({ session, update, known }: { session: Session; update: (changes: SetStateAction<Session>) => void; known: KnownVocabulary }) {
  const set = (changes: Partial<Session>) => update((current) => ({ ...current, ...changes }));
  const changeCanvas = (change: (canvas: Canvas) => Canvas) => update((current) => ({ ...current, canvas: change(current.canvas) }));
  const log = (type: string) => update((current) => ({ ...current, events: [...current.events, { at: new Date().toISOString(), type }] }));

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-6 border-b border-line pb-4">
        <Brief task={session.task} />
        <div className="flex shrink-0 items-center gap-3">
          <Timer started={session.started!} />
          <Button variant="primary" onClick={() => window.confirm("Finish this part?") && set({ phase: "done", finished: new Date().toISOString() })}>
            Finish
          </Button>
        </div>
      </div>
      <div className="grid max-w-5xl grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
        <Field label="Name">
          <Input value={session.name} onChange={(event) => set({ name: event.target.value })} placeholder="Untitled system" />
        </Field>
        <Field label="Goal" hint="who it is for and what it helps them do">
          <Input value={session.goal} onChange={(event) => set({ goal: event.target.value })} />
        </Field>
      </div>
      {session.condition === "text" ? (
        <Field label="Prompt" hint="everything the coding agent needs to build the system" className="mt-4 max-w-5xl">
          <TextArea value={session.prompt} onChange={(event) => set({ prompt: event.target.value })} rows={22} />
        </Field>
      ) : (
        <>
          <Field label="How it works" hint="the system in a few sentences" className="mt-4 mb-6 max-w-5xl">
            <TextArea value={session.description} onChange={(event) => set({ description: event.target.value })} rows={3} />
          </Field>
          <CanvasWorkspace known={known} canvas={session.canvas} onChange={changeCanvas} onEvent={log} />
        </>
      )}
    </>
  );
}

export function Experiment({ known }: { known: KnownVocabulary }) {
  const [parts, setParts] = useState<Session[] | null>(null);
  const index = parts?.findIndex(({ phase }) => phase !== "done") ?? -1;
  useLeaveWarning(parts !== null);

  if (!parts) return <Setup onStart={setParts} />;

  if (index === -1)
    return (
      <>
        <PageHeader title="Thank you" description="Download both files and hand them to the researcher." />
        <div className="flex flex-wrap gap-2">
          {parts.map((session) => (
            <Button key={session.part} variant="primary" onClick={() => download(session)}>
              <Download className="size-3.5" />
              {sessionFile(session).name}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => window.confirm("Start a new participant? Download both files first.") && setParts(null)}>
            New participant
          </Button>
        </div>
      </>
    );

  const session = parts[index];
  const update = (changes: SetStateAction<Session>) =>
    setParts((current) => current && current.map((part, i) => (i === index ? (typeof changes === "function" ? changes(part) : changes) : part)));
  const label = `${session.participant} · Part ${session.part} of ${parts.length} · ${conditionLabels[session.condition]}`;

  if (session.phase === "tutorial") return <Tutorial known={known} label={label} onDone={() => update({ ...session, phase: "brief" })} />;

  if (session.phase === "brief")
    return (
      <>
        <PageHeader title="System to specify" description={label} />
        <Brief task={session.task} />
        <Button variant="primary" className="mt-6" onClick={() => update({ ...session, phase: "work", started: new Date().toISOString() })}>
          Start
        </Button>
      </>
    );

  return <Work session={session} update={update} known={known} />;
}
