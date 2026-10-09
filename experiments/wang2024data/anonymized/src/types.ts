// Typed representations, named after the design identifiers (see PLAN.md / README.md).

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

/** r1 — the working table (artifact tabular). Also used for r9 candidate tables. */
export interface Table {
  name: string;
  columns: string[];
  rows: Row[];
}

export type FieldType = 'quantitative' | 'nominal' | 'temporal';
export type FieldSource = 'original' | 'reshaped' | 'derived';

/** r11 — a derived-concept request (instruction record). */
export interface DeriveRequest {
  name: string;
  description: string;
  sourceFields: string[];
}

/** r2 — one field's metadata (artifact record), a collection per table. */
export interface FieldMeta {
  name: string;
  type: FieldType;
  source: FieldSource;
  /** For derived fields: the request (r11) and the chosen code (r16) that produced it. */
  derivation?: { request: DeriveRequest; code: string };
}

/** r6 — a new concept declared by the user that is not (yet) in the table. */
export interface Concept {
  name: string;
}

export type Mark = 'bar' | 'line' | 'point' | 'area' | 'tick' | 'rect';
export const MARKS: Mark[] = ['bar', 'line', 'point', 'area', 'tick', 'rect'];
export type Channel = 'x' | 'y' | 'color' | 'size' | 'column';
export const CHANNELS: Channel[] = ['x', 'y', 'color', 'size', 'column'];

/** r3 — the encoding specification (instruction record). Values are field or concept names. */
export interface Encoding {
  mark: Mark;
  channels: Partial<Record<Channel, string>>;
  aggregate: Partial<Record<Channel, 'sum' | 'mean' | 'count' | 'none'>>;
}

/** r7 — example table the user fills in (instruction tabular). Empty string = not given. */
export interface ExampleTable {
  columns: string[];
  rows: Record<string, string>[];
}

/** r8 — a reshaping program (artifact formal). */
export type Program =
  | { op: 'fold'; columns: string[]; key: string; value: string }
  | { op: 'pivot'; index: string[]; key: string; value: string; renames: Record<string, string> };

/** r13/r14/r16 — generated code candidates (artifact formal). */
export interface CodeCandidate {
  id: string;
  code: string;
  promptIndex: number;
}

/** r14 + r15 — an evaluated candidate: code that ran, with its preview table. */
export interface EvaluatedCandidate extends CodeCandidate {
  preview: Table;
  outputType: FieldType;
  nullCount: number;
}
