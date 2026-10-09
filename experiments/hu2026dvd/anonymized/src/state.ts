import type {
  Chart, ChartType, IllustrationRequest, Scene, Snapshot, SourceImage, Table, TextItem, VisualElement,
} from "../shared/types";

/** Pictorial chart results of processes 6 (r23) and 7 (r29). */
export interface PictorialResult {
  id: string;
  process: 6 | 7;
  svg: string;
  label: string;
  createdAt: number;
}

/** Illustration results of process 4 (r15), with the request (r14) that produced them. */
export interface Illustration {
  id: string;
  elementId: string;
  request: IllustrationRequest;
  svg: string;
  alt: string;
  createdAt: number;
}

export interface AppState {
  brief: string; // r1
  styleRefs: TextItem[]; // r2*
  documents: TextItem[]; // r3*
  sourceImages: SourceImage[]; // r8*
  elements: VisualElement[]; // r4* (current version)
  /** True when elements were edited after the scene was last rendered (r4_2 vs r6_1). */
  elementsDirty: boolean;
  scene: Scene | null; // r6
  snapshots: Snapshot[]; // r7*
  critique: string; // r12 (draft for the current round)
  selectedElementId: string | null; // r9
  illustrations: Illustration[]; // r15 results
  tableText: string; // source text of r16
  table: Table | null; // r16
  chartType: ChartType | null; // r17
  chart: Chart | null; // r18
  pictorials: PictorialResult[]; // r23 / r29
}

export const initialState: AppState = {
  brief: "",
  styleRefs: [],
  documents: [],
  sourceImages: [],
  elements: [],
  elementsDirty: false,
  scene: null,
  snapshots: [],
  critique: "",
  selectedElementId: null,
  illustrations: [],
  tableText: "",
  table: null,
  chartType: null,
  chart: null,
  pictorials: [],
};

export type Action =
  | { type: "set"; patch: Partial<AppState> }
  | { type: "updateElement"; id: string; patch: Partial<VisualElement> }
  | { type: "deleteElement"; id: string }
  | { type: "addReview"; snapshotId: string; text: string };

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "set":
      return { ...s, ...a.patch };
    case "updateElement":
      return {
        ...s,
        elementsDirty: true,
        elements: s.elements.map((e) => (e.id === a.id ? { ...e, ...a.patch } : e)),
      };
    case "deleteElement":
      return {
        ...s,
        elementsDirty: true,
        selectedElementId: s.selectedElementId === a.id ? null : s.selectedElementId,
        elements: s.elements.filter((e) => e.id !== a.id),
      };
    case "addReview":
      return {
        ...s,
        snapshots: s.snapshots.map((sn) => (sn.id === a.snapshotId ? { ...sn, reviews: [...sn.reviews, a.text] } : sn)),
      };
  }
}

const KEY = "system-x-state-v1";
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...initialState, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return initialState;
}
export function saveState(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota exceeded (large images) — retry without images
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, sourceImages: [] }));
    } catch {
      /* give up */
    }
  }
}

export const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
