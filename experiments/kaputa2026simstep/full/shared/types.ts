// Types for the representations in design.json. Names follow the design identifiers
// without their version suffix.

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  description?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
/** medium `graph`: concept_graph, scenario_graph, learning_goal_graph, ui_graph, subgraph */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphLevel = 'concept_graph' | 'scenario_graph' | 'learning_goal_graph' | 'ui_graph';

/** experiment_factors: the variables a student can change and observe */
export interface Factor {
  name: string;
  description: string;
  range?: string;
  unit?: string;
}
export interface ExperimentFactors {
  independent: Factor[];
  dependent: Factor[];
  controlled: Factor[];
}

/** test_cases: interaction tests for the simulation */
export type StepAction = 'click' | 'set_value' | 'press' | 'wait' | 'read';
export interface TestStep {
  action: StepAction;
  selector: string;
  value?: string;
}
export interface TestCase {
  id: string;
  title: string;
  purpose: string;
  steps: TestStep[];
  expected: string;
  needs_human_check: boolean;
}

/** test_results: the outcome of running each test */
export interface TestResult {
  test_id: string;
  completed: boolean;
  observations: string[];
  errors: string[];
}

/** test_assessment: whether the results meet the learning goal */
export interface TestAssessment {
  meets_goal: boolean;
  summary: string;
  problems: string[];
}

/** ui_test_feedback: categorical */
export const UI_TEST_FEEDBACK = [
  'as_expected',
  'no_response',
  'wrong_behavior',
  'wrong_visual',
  'layout_problem',
] as const;
export type UiTestFeedback = (typeof UI_TEST_FEEDBACK)[number];

/** repair_target: the graph level where the problem lies */
export const REPAIR_TARGETS = [
  'concept_graph',
  'scenario_graph',
  'learning_goal_graph',
  'ui_graph',
  'code',
] as const;
export type RepairTarget = (typeof REPAIR_TARGETS)[number];

/** suggested_repair / approved_repair */
export interface Repair {
  level: RepairTarget;
  summary: string;
  details: string;
}

/** A graph edit operation (used by suggested_change and applied by tool_1 modify). */
export type GraphOpKind = 'add_node' | 'remove_node' | 'update_node' | 'add_edge' | 'remove_edge';
export interface GraphOp {
  op: GraphOpKind;
  id?: string;
  label?: string;
  type?: string;
  description?: string;
  source?: string;
  target?: string;
}
/** suggested_change / approved_change */
export interface GraphChange {
  level: RepairTarget;
  summary: string;
  operations: GraphOp[];
}

/** chat_region / redraw_region / subgraph_region: a freehand mark over the simulation */
export interface RegionElement {
  ui_node?: string;
  tag: string;
  dom_id?: string;
  text?: string;
}
export interface Region {
  points: [number, number][];
  bbox: { x: number; y: number; w: number; h: number };
  elements: RegionElement[];
}

/** assumptions: assumptions the code makes about a node, in plain text */
export interface Assumption {
  id: string;
  text: string;
}

/** subgraph: the interface graph nodes and links for a region */
export interface Subgraph {
  nodeIds: string[];
  edgeIds: string[];
  explanation: string;
}

/** simulation_code versions (history kept so earlier rounds can be compared or reverted) */
export interface CodeVersion {
  id: string;
  /** design identifier this version corresponds to, e.g. simulation_code_2, simulation_code_chat_4 */
  label: string;
  html: string;
  note: string;
  createdAt: number;
}

export const SIM_WIDTH = 900;
export const SIM_HEIGHT = 640;
