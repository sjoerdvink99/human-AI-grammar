import { useEffect, useState } from "react";
import type {
  Brief,
  BriefStatus,
  BriefTemplate,
  Outline,
  RequestMessage,
  StyleSpec,
  Take,
  VoiceSettings,
} from "../../shared/types.ts";

export interface ScriptVersion {
  text: string; // r10_n
  feedback?: string; // r11 that produced the next version
  createdAt: string;
}

export interface TakeReview {
  analysis?: string; // r21
  feedback?: string; // r22
  tips?: string; // r23
  qa: { question: string; answer?: string }[]; // r24 → r25
}

/** All application state, named after the design's identifiers. */
export interface Project {
  template: BriefTemplate; // r1
  request: RequestMessage[]; // r2 (user messages; assistant follow-ups r5 become context once answered)
  brief: Brief | null; // r3
  briefStatus: BriefStatus | null; // r4
  approach: string; // r6
  approachEdited: string; // r7
  styleSpec: StyleSpec | null; // r8
  outline: Outline | null; // r9
  scriptVersions: ScriptVersion[]; // r10 history
  activeScript: number; // index into scriptVersions used downstream
  deliveryAdvice: string; // r12
  voiceSettings: VoiceSettings | null; // r13 (draft for the next take)
  takes: Take[]; // r13..r20 for each take
  activeTakeId: string | null;
  reviews: Record<string, TakeReview>;
  step: 0 | 1 | 2 | 3;
}

export const emptyProject = (template: BriefTemplate): Project => ({
  template,
  request: [],
  brief: null,
  briefStatus: null,
  approach: "",
  approachEdited: "",
  styleSpec: null,
  outline: null,
  scriptVersions: [],
  activeScript: 0,
  deliveryAdvice: "",
  voiceSettings: null,
  takes: [],
  activeTakeId: null,
  reviews: {},
  step: 0,
});

/** r2 as language: the request conversation as one text. */
export const requestText = (msgs: RequestMessage[]) =>
  msgs.map((m) => `${m.from === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");

const KEY = "speech-studio-project-v1";

export function usePersistentProject(): [Project | null, (fn: (p: Project) => Project) => void, (p: Project) => void] {
  const [project, setProject] = useState<Project | null>(() => {
    try {
      const s = localStorage.getItem(KEY);
      return s ? (JSON.parse(s) as Project) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (project) localStorage.setItem(KEY, JSON.stringify(project));
  }, [project]);
  const update = (fn: (p: Project) => Project) => setProject((p) => (p ? fn(p) : p));
  return [project, update, setProject];
}

/** Tracks one async operation at a time per key, for loading and error states. */
export function useBusy() {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };
  return { busy, error, setError, run };
}
