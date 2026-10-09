// Shared types. Names follow the design identifiers (r1, r2, …) — see PLAN.md.

export interface GraphNode {
  id: string;
  label: string;
  kind: string; // e.g. goal | data | encoding | interaction | style | component
  description: string;
}
export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}
/** medium `graph` — r2, r5, r8, r11 */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** r9 — artifact record: data spec */
export interface DataSpec {
  fields: { name: string; type: 'number' | 'string' | 'date' | 'boolean'; description: string }[];
  sample: Record<string, unknown>[];
}

/** r14 — artifact record: test case */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  expectation: string;
  data: unknown;
}

/** r15 (record) + r16 (visual: svg snapshot) — produced together by tool_2 */
export interface TestResult {
  testId: string;
  status: 'ok' | 'error';
  errors: string[];
  logs: string[];
  stats: Record<string, number>;
  svg: string;
}

/** r22 — selection categorical: fixed set */
export const ISSUE_CATEGORIES = [
  'layout',
  'scales-axes',
  'marks',
  'labels-text',
  'color',
  'data-handling',
  'interaction',
  'other',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/** r21 — evaluation categorical: fixed set */
export const VERDICTS = ['correct', 'something-missing', 'something-wrong', 'unreadable'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** r23 — fix proposals; r24 is one of the options */
export interface FixOption {
  title: string;
  instruction: string;
}
export interface FixProposal {
  diagnosis: string;
  options: FixOption[];
}

/** spatial selection (r26, r34, r39) in SVG user units of the 640×400 canvas */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** r28 options / r29 chosen edit, applied by tool_1 modify */
export interface GraphEdit {
  addNodes: GraphNode[];
  updateNodes: GraphNode[];
  removeNodeIds: string[];
  addEdges: GraphEdge[];
  removeEdges: { source: string; target: string }[];
}
export interface GraphEditOption {
  summary: string;
  edit: GraphEdit;
}

/** r32 — parameters of a component */
export interface Param {
  name: string;
  kind: 'number' | 'color' | 'string' | 'boolean';
  value: string;
  description: string;
}

/** r35 — sketch strokes in SVG units (relative to the whole canvas) */
export type Stroke = [number, number][];

export interface CodeVersion {
  id: string; // design identifier: r12_1, r12_2, r12_3, r25_4, r30_4, r33_4, r37_4
  label: string;
  code: string;
  createdAt: number;
}

export const CANVAS = { width: 640, height: 400 };
