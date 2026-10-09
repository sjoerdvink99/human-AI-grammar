// Types named after the design's representations (see PLAN.md).

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

/** table: the data table the user works with; later versions add or reshape columns. */
export interface Table {
  id: string;
  version: number;
  name: string;
  columns: string[];
  rows: Row[];
  /** how this version was produced */
  origin: string;
}

export type ConceptType = 'quantitative' | 'nominal' | 'ordinal' | 'temporal';

/** derivation_request: source concepts, new concept name, NL description. */
export interface DerivationRequest {
  sources: string[];
  name: string;
  description: string;
}

/** concepts / custom_concepts: data fields available for charts. */
export interface Concept {
  name: string;
  type: ConceptType;
  source: 'original' | 'custom' | 'derived' | 'reshaped';
  /** custom concepts: example values given by the user */
  examples?: string[];
  /** derived concepts: request history (derivation_request_1, _2, ...) and the applied code */
  derivation?: { requests: DerivationRequest[]; code: string };
}

export const CHANNELS = ['x', 'y', 'color', 'size', 'shape', 'column'] as const;
export type Channel = (typeof CHANNELS)[number];

export const MARKS = ['point', 'bar', 'line', 'area', 'rect', 'tick'] as const;
export type Mark = (typeof MARKS)[number];

/** chart_spec: chart type and the concept placed on each visual channel. */
export interface ChartSpec {
  mark: Mark;
  encodings: Partial<Record<Channel, string>>;
}

/** example_relation: one column per chart concept; the user fills in the cells. */
export interface ExampleRelation {
  columns: string[];
  rows: string[][];
}

/** reshaping_programs: AST of the reshaping DSL. */
export type Program =
  | { op: 'rename'; mapping: Record<string, string>; keep: string[] }
  | {
      op: 'fold';
      columns: string[];
      key: string;
      value: string;
      /** label written into the key column for each folded column */
      labels: Record<string, string>;
      keep: string[];
    }
  | {
      op: 'pivot';
      keyColumn: string;
      valueColumn: string;
      /** key value -> new column name */
      mapping: Record<string, string>;
      index: string[];
    };

export interface ReshapeCandidate {
  program: Program;
  code: string;
  table: { columns: string[]; rows: Row[] };
}

export interface CodeCandidate {
  code: string;
  prompt: number;
  valid: boolean;
  error?: string;
  /** preview_tables: source values and result for the first rows */
  preview?: Row[];
}
