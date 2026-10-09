import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FeedItem, Session } from "./types.ts";

export const DATA_DIR = join(process.cwd(), "data");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");
export const AUDIO_DIR = join(DATA_DIR, "audio");
mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });

const cache = new Map<string, Session>();

export function createSession(): Session {
  const s: Session = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    phase: "therapy",
    busy: null,
    error: null,
    feed: [],
    chatHistory: [],
    requiredVariables: {},
    stepStatus: { status: "incomplete", currentStep: 0, completedSteps: [], missing: [], allComplete: false },
    turnsInStep: 0,
    lyricQuestions: [],
    lyricInputs: null,
    songConcept: null,
    lyricElements: null,
    lyrics: [],
    lyricsAccepted: false,
    musicGuidance: null,
    musicAttributes: [],
    stylePrompts: [],
    songs: [],
    reviewQuestion: null,
    reflectionQuestion: null,
    reflection: null,
    supportiveResponse: null,
  };
  save(s);
  return s;
}

export function getSession(id: string): Session | null {
  if (cache.has(id)) return cache.get(id)!;
  const file = join(SESSIONS_DIR, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, "utf8")) as Session;
  s.busy = null; // a server restart interrupts any running job
  cache.set(id, s);
  return s;
}

export function save(s: Session) {
  cache.set(s.id, s);
  writeFileSync(join(SESSIONS_DIR, `${s.id}.json`), JSON.stringify(s, null, 2));
}

export function pushFeed(s: Session, item: Omit<FeedItem, "at">) {
  s.feed.push({ ...item, at: new Date().toISOString() });
}

/**
 * Run a (possibly long) chain of steps in the background. The client polls the
 * session and shows `busy` as a loading state; failures become `error` with a
 * retry action name.
 */
export function runJob(s: Session, retry: string, job: (setBusy: (op: string, label: string) => void) => Promise<void>) {
  if (s.busy) throw new Error("Session is busy");
  s.error = null;
  const setBusy = (op: string, label: string) => {
    s.busy = { op, label };
    save(s);
  };
  setBusy("starting", "Working…");
  job(setBusy)
    .then(() => {
      s.busy = null;
      save(s);
    })
    .catch((err: Error) => {
      console.error(err);
      s.busy = null;
      s.error = { message: err.message.slice(0, 400), retry };
      save(s);
    });
}
