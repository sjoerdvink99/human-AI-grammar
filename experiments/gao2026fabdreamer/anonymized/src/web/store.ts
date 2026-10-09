// Application state. Field names follow the design identifiers (see PLAN.md).
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Advice, Assembly, Box2D, BoxCheck, Constraints, Critique, EditOp, FabCheck, GroundingQuery, ImageVersion,
  Part3D, PartImageVerdict, PartRecord, PartSelection, PlannedPart, Placement3D, Spec, Svg,
} from "../shared/types";

export type Tab = "concept" | "spec" | "parts" | "refine" | "studio" | "assembly" | "fabrication" | "export";

export interface RefineRound { round: number; referenceSvg: Svg; queries: GroundingQuery[]; boxes: Box2D[]; parts3d: Part3D[]; critique: Critique | null }
export interface FabRound { checks: FabCheck[]; advice: Advice | null; chosen: Advice["suggestions"][number] | null; ops: EditOp[]; skipped: string[] }

export interface AppState {
  tab: Tab;
  // P1 / P2
  conceptPrompt: string;            // r1
  conceptCandidates: Svg[];         // r2*
  concept: ImageVersion[];          // r3 versions (r3_1, r3_2, …)
  conceptIndex: number;             // which version is current
  // P3
  spec: Spec[];                     // r5 versions (one per loop round)
  specIndex: number;
  // P4
  partSelection: PartSelection | null; // r7
  parts: PartRecord[];              // r8*
  assemblyNotes: string;            // r9
  reference: Svg | null;            // r10 (current)
  parts3d: Part3D[];                // r11* (current)
  groundingQueries: GroundingQuery[]; // r12*
  groundings: Box2D[];              // r13*
  refineRounds: RefineRound[];      // earlier rounds of the P4 loop
  // P5
  boxChecks: BoxCheck[];            // r15_1*
  regroundings: Box2D[];            // r16*
  boxChecks2: BoxCheck[];           // r15_2*
  sideViews: { partId: string; svg: Svg }[]; // r17*
  sideBoxes: Box2D[];               // r18*
  refinedParts: Part3D[];           // r19*
  // P6
  studio: {
    prompt: string;                 // r20
    candidates: Svg[];              // r21*
    chosen: Svg | null;             // r22
    verdict: PartImageVerdict | null; reason: string; // r23
    clean: Svg | null;              // r24
    box: Box2D | null;              // r25
    part: Part3D | null;            // r26
    height: number; depth: number; material: string;
  };
  // P7
  assemblyHistory: Assembly[];      // r27 versions
  assemblyIndex: number;
  selectedPartId: string | null;    // r29 / r33 (selection categorical)
  // P8
  regen: { partId: string | null; crop: Svg | null; image: Svg | null; part: Part3D | null }; // r29, r30, r31, r32
  // P9
  langEdit: { partId: string | null; instruction: string; planned: PlannedPart[]; placements: Placement3D[]; parts: (Part3D & { replacesId: string | null })[] }; // r33, r34, r35, r36, r37
  // P10
  constraints: Constraints;         // r38
  fabRounds: FabRound[];            // r39 / r40 / r41 / r42 per round
  // transient
  busy: Record<string, string>;
  errors: Record<string, string>;
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  method: "laser-cut sheet", material: "birch plywood", sheetThickness: 6, minThickness: 3, maxW: 600, maxH: 600, maxD: 600,
};

const initial = {
  tab: "concept" as Tab,
  conceptPrompt: "", conceptCandidates: [], concept: [], conceptIndex: -1,
  spec: [], specIndex: -1,
  partSelection: null, parts: [], assemblyNotes: "", reference: null, parts3d: [], groundingQueries: [], groundings: [], refineRounds: [],
  boxChecks: [], regroundings: [], boxChecks2: [], sideViews: [], sideBoxes: [], refinedParts: [],
  studio: { prompt: "", candidates: [], chosen: null, verdict: null, reason: "", clean: null, box: null, part: null, height: 300, depth: 6, material: "birch plywood" },
  assemblyHistory: [], assemblyIndex: -1, selectedPartId: null,
  regen: { partId: null, crop: null, image: null, part: null },
  langEdit: { partId: null, instruction: "", planned: [], placements: [], parts: [] },
  constraints: DEFAULT_CONSTRAINTS, fabRounds: [],
  busy: {}, errors: {},
};

export const useApp = create<AppState>()(
  persist(
    (set) => ({ ...initial, set: (p) => set(p as never) }),
    {
      name: "system-x",
      storage: createJSONStorage(() => ({
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota: keep in memory only */ } },
        removeItem: (k) => localStorage.removeItem(k),
      })),
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "busy" && k !== "errors" && k !== "set")) as never,
    },
  ),
);

export const resetAll = () => useApp.setState({ ...initial });

// selectors
export const currentConcept = (s: AppState) => (s.conceptIndex >= 0 ? s.concept[s.conceptIndex] : null);
export const currentSpec = (s: AppState) => (s.specIndex >= 0 ? s.spec[s.specIndex] : null);
export const currentAssembly = (s: AppState) => (s.assemblyIndex >= 0 ? s.assemblyHistory[s.assemblyIndex] : null);

/** Wrap an async step with busy/error bookkeeping under a key (one key per process). */
export async function track<T>(key: string, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const { set } = useApp.getState();
  set((s) => ({ busy: { ...s.busy, [key]: label }, errors: { ...s.errors, [key]: "" } }));
  try {
    return await fn();
  } catch (e) {
    set((s) => ({ errors: { ...s.errors, [key]: e instanceof Error ? e.message : String(e) } }));
    return undefined;
  } finally {
    set((s) => { const b = { ...s.busy }; delete b[key]; return { busy: b }; });
  }
}

export const setBusyLabel = (key: string, label: string) =>
  useApp.getState().set((s) => ({ busy: { ...s.busy, [key]: label } }));

/** P7 human modify: push a new r27 version (drops any redo tail). */
export function commitAssembly(a: Assembly) {
  useApp.getState().set((s) => {
    const hist = s.assemblyHistory.slice(0, s.assemblyIndex + 1).concat([a]).slice(-50);
    return { assemblyHistory: hist, assemblyIndex: hist.length - 1 };
  });
}
