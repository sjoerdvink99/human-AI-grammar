import { useCallback, useEffect, useState } from "react";
import type {
  BaseChart, ChartSpec, Crop, DataProfile, Dataset, ExportFormat, FinalSpec, GenStatus,
  IllustrationRound, MatchQuery, MatchResult, Rect, Segment, SegmentLabel, Variant,
} from "./types.ts";

/** Whole-application state. Field names follow the design identifiers. */
export interface AppState {
  step: number;
  r1?: Dataset;
  r2?: DataProfile;
  r3?: string;
  r4?: string;
  r4Status?: GenStatus;
  r4Error?: string;
  r5: string[];
  r6?: BaseChart;
  r7: string[];
  r8Rounds: IllustrationRound[]; // r8_1, r8_2, … (earlier rounds kept for comparison)
  r9: string;
  r10?: string;
  r11?: { svg: string; from: string };
  r12: Rect[];
  r13: Segment[];
  r13Version: 0 | 1 | 2;
  segStatus?: GenStatus;
  segError?: string;
  r14: SegmentLabel[];
  crops: Crop[]; // r15 + r16 + r17
  r19: Variant[]; // r18 + r19 pairs
  r21?: ChartSpec;
  r24: MatchQuery;
  r25?: MatchResult;
  r26: FinalSpec;
  r28: ExportFormat;
}

export const initialState: AppState = {
  step: 0,
  r5: [],
  r7: [],
  r8Rounds: [],
  r9: "",
  r12: [],
  r13: [],
  r13Version: 0,
  r14: [],
  crops: [],
  r19: [],
  r24: { field: "", op: "max", value: "" },
  r26: { chartIndex: 0, annotate: [], title: "", subtitle: "", note: "" },
  r28: "svg",
};

const KEY = "pictograph-studio-v1";

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState;
    const s = { ...initialState, ...JSON.parse(raw) } as AppState;
    // generation that was in flight when the page closed cannot resume
    const fix = <T extends { status?: GenStatus; error?: string }>(x: T): T =>
      x.status === "pending" ? { ...x, status: "error", error: "interrupted by reload" } : x;
    s.r8Rounds = s.r8Rounds.map((r) => ({ ...r, items: r.items.map(fix) }));
    s.r19 = s.r19.map(fix);
    if (s.r4Status === "pending") s.r4Status = "error";
    if (s.segStatus === "pending") s.segStatus = "error";
    s.crops = s.crops.map((c) => (c.descStatus === "pending" ? { ...c, descStatus: "error" } : c));
    return s;
  } catch {
    return initialState;
  }
}

export type Update = (fn: (s: AppState) => AppState) => void;

export function useAppState(): [AppState, Update, () => void] {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* quota exceeded: keep running in memory */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);
  const update: Update = useCallback((fn) => setState(fn), []);
  const reset = useCallback(() => setState(initialState), []);
  return [state, update, reset];
}

let counter = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;
