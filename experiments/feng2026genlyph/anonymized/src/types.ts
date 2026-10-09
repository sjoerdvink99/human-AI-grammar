/** Application state, one type per design identifier (version suffix dropped). */

export type Cell = string | number | null;

/** r1: artifact tabular */
export interface Dataset {
  name: string;
  columns: string[];
  rows: Record<string, Cell>[];
}

export interface ColumnProfile {
  name: string;
  type: "number" | "category" | "text";
  distinct: number;
  values?: string[]; // for category columns, up to 30
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
}

/** r2: artifact record */
export interface DataProfile {
  rowCount: number;
  columns: ColumnProfile[];
  defaultCategory?: string;
  defaultValue?: string;
}

/** r6 also exposes the bars it draws so the compose step can describe the data shape. */
export interface BaseChart {
  svg: string;
  categoryField: string;
  valueField: string;
  bars: { category: string; value: number }[];
}

export type GenStatus = "pending" | "done" | "error";

/** one item of r8*: artifact visual */
export interface Illustration {
  id: string;
  prompt: string;
  status: GenStatus;
  svg?: string;
  error?: string;
}

/** one generation round of r8 (r8_1, r8_2, …) */
export interface IllustrationRound {
  id: string;
  version: number;
  steer?: string; // r9 used for this round
  items: Illustration[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** one item of r13*: artifact spatial */
export interface Segment {
  id: string;
  name: string;
  elementIds: string[];
  bbox: Rect;
}

/** one item of r14*: label record */
export interface SegmentLabel {
  segmentId: string;
  role: "mark" | "anchor" | "decoration";
  field?: string; // category field this mark represents
}

/** r15 + r16 + r17 per mark segment */
export interface Crop {
  segmentId: string;
  name: string;
  svg: string; // r15
  bbox: Rect; // r16
  field: string;
  description?: string; // r17
  descStatus?: GenStatus;
}

/** one item of r18* paired with its r19 output */
export interface Variant {
  id: string;
  segmentId: string;
  category: string;
  prompt: string; // r18
  aspect: Rect; // r16 carried with the prompt
  status?: GenStatus;
  svg?: string; // r19
  error?: string;
  history: string[]; // earlier r19 svgs for this variant
}

/** r20 item */
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
  segmentId: string;
}

export type LayoutKind = "in-place" | "isotype" | "sized-row" | "bars";

/** r21: instruction record */
export interface ChartSpec {
  categoryField: string;
  valueField: string; // "" means count rows
  aggregate: "sum" | "mean" | "count";
  layouts: LayoutKind[];
  unitValue: number; // for isotype: value per icon (0 = auto)
  minSize: number;
  maxSize: number;
  sort: "none" | "asc" | "desc";
  segmentId: string; // which mark segment's variants to use
}

/** r22 item */
export interface Mark {
  category: string;
  value: number;
  svg: string;
}

/** r23 item */
export interface ComposedChart {
  layout: LayoutKind;
  svg: string;
  width: number;
  height: number;
  positions: Record<string, Rect>;
  categoryField: string;
  values: Record<string, number>;
}

/** r24: instruction record */
export interface MatchQuery {
  field: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "max" | "min";
  value: string;
}

/** r25: artifact record */
export interface MatchResult {
  rowIndices: number[];
  categories: { category: string; value: number; rows: number }[];
}

/** r26: instruction record */
export interface FinalSpec {
  chartIndex: number;
  annotate: string[];
  title: string;
  subtitle: string;
  note: string;
}

/** r28: instruction categorical */
export type ExportFormat = "svg" | "png" | "jpeg";
