// Representations from design.json (identifiers without their version suffix).

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

/** table: artifact tabular */
export interface Table {
  columns: string[];
  rows: Row[];
}

export type ConceptType = 'quantitative' | 'nominal' | 'ordinal' | 'temporal';

/** derivation_request: instruction record */
export interface DerivationRequest {
  name: string;
  sourceConcepts: string[];
  description: string;
}

/** concepts / custom_concepts: artifact record */
export interface Concept {
  name: string;
  type: ConceptType;
  /** table = extracted/assigned from a table column; derived = computed by code; custom = named by the user, no data yet */
  source: 'table' | 'derived' | 'custom';
  derivation?: { request: DerivationRequest; code: string };
}

export type Channel = 'x' | 'y' | 'color' | 'size' | 'shape' | 'column' | 'row';
export const CHANNELS: Channel[] = ['x', 'y', 'color', 'size', 'shape', 'column', 'row'];

export type Mark = 'point' | 'bar' | 'line' | 'area' | 'rect' | 'tick' | 'boxplot';
export const MARKS: Mark[] = ['point', 'bar', 'line', 'area', 'rect', 'tick', 'boxplot'];

export type Aggregate = 'none' | 'sum' | 'mean' | 'count' | 'min' | 'max' | 'median';

export interface Encoding {
  field: string;
  aggregate?: Aggregate;
}

/** chart_spec: instruction record */
export interface ChartSpec {
  mark: Mark;
  encodings: Partial<Record<Channel, Encoding>>;
}

/** reshaping_programs: artifact formal */
export type ReshapeProgram =
  | { kind: 'identity'; keep: string[] }
  | { kind: 'pivot_longer'; cols: string[]; namesTo: string; valuesTo: string; keep: string[] }
  | { kind: 'pivot_wider'; namesFrom: string; valuesFrom: string; idCols: string[] };

/** Result of tool_1 evaluate for one code candidate. */
export interface CodeCandidate {
  code: string;
  prompt: number;
  valid: boolean;
  error?: string;
  preview?: Table;
  /** full column values, used to dedupe candidates with identical output */
  signature?: string;
}
