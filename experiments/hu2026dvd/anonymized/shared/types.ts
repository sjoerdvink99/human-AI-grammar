// Representations of the design, named after their identifiers (rN) — see PLAN.md / README.md.

/** r2 / r3: a text item (style reference or source document). */
export interface TextItem {
  id: string;
  title: string;
  text: string;
}

/** r8: a user-provided source image. */
export interface SourceImage {
  id: string;
  name: string;
  caption: string;
  /** The source document (r3) this image belongs to, if any. */
  docId: string;
  dataUrl: string;
}

export const ELEMENT_KINDS = ["illustration", "icon", "headline", "text", "annotation", "shape"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** A citation from an element back into a source document (r3). */
export interface SourceRef {
  docId: string;
  quote: string;
}

/** r4: one visual element of the scene (artifact record). */
export interface VisualElement {
  id: string;
  name: string;
  kind: ElementKind;
  description: string;
  /** Text shown for headline / text / annotation elements. */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Inner SVG markup in a 0 0 100 100 viewBox (for illustration / icon / shape). */
  svg: string;
  sources: SourceRef[];
}

/** r5: scene specification (instruction record) consumed by the renderer (tool_2). */
export interface SceneLayer {
  elementId: string;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  svg: string;
  text: string;
  z: number;
}
export interface SceneSpec {
  width: number;
  height: number;
  background: string;
  layers: SceneLayer[];
}

/** r6: rendered scene (artifact visual), an SVG document. */
export interface Scene {
  svg: string;
  width: number;
  height: number;
}

/** r7: one item of the snapshot gallery (artifact visual)*. */
export interface Snapshot {
  id: string;
  round: number;
  createdAt: number;
  scene: Scene;
  /** r12 critique that preceded this round, if any. */
  critique?: string;
  /** r31 reviews attached by process 8. */
  reviews: string[];
}

/** r10: passage in a source document (selection language). */
export interface SourcePassage {
  docId: string;
  docTitle: string;
  before: string;
  match: string;
  after: string;
  found: boolean;
}

/** r14: illustration request (instruction record). */
export interface IllustrationRequest {
  subject: string;
  description: string;
  style: string;
  palette: string[];
  aspect: "square" | "landscape" | "portrait";
}

/** r16: table (artifact tabular). */
export interface Table {
  columns: string[];
  rows: (string | number)[][];
}

/** r17: chart type (instruction categorical). */
export const CHART_TYPES = ["bar", "column", "line", "pie", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** r18: chart (artifact visual) with geometry needed for composition. */
export interface Chart {
  svg: string;
  width: number;
  height: number;
  type: ChartType;
  /** Plot area in chart pixels. */
  plot: { x: number; y: number; w: number; h: number };
  /** Data mark rectangles (bars / points / slices bounding boxes) in chart pixels. */
  marks: { x: number; y: number; w: number; h: number; label: string; value: number }[];
}

export interface Point {
  x: number;
  y: number;
}
/** r19/r24: crop rectangle in scene pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** r20/r25: click points inside the crop (crop pixels). */
export interface ClickPoint extends Point {
  positive: boolean;
}
/** r28: placement of the cutout on the chart. */
export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Placement mode for tool_6 compose in process 6 (auto). */
export type AutoPlacement = "corner" | "marks" | "background";
