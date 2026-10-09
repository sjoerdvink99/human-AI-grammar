// Representation types, named after the design identifiers (without version suffix).
import { z } from "zod";

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  /** For ui_graph: control | display | visual | container | logic. For other graphs: free category. */
  kind: z.string().default(""),
  /** Set by tool_1 modify (process 5) so the code regeneration knows what changed. */
  change_note: z.string().optional(),
});
export const GraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().default(""),
});
export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema).default([]),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;

const VariableSchema = z.object({
  name: z.string(),
  unit: z.string().default(""),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  default: z.union([z.number(), z.string()]).nullable().optional(),
  node_id: z.string().nullable().optional(),
  description: z.string().default(""),
});
export const ExperimentFactorsSchema = z.object({
  independent_variables: z.array(VariableSchema).min(1),
  dependent_variables: z.array(VariableSchema).min(1),
  controlled_variables: z.array(VariableSchema).default([]),
});
export type ExperimentFactors = z.infer<typeof ExperimentFactorsSchema>;

export const TestStepSchema = z.object({
  action: z.enum(["click", "set_value", "wait", "read_text"]),
  selector: z.string().default(""),
  value: z.union([z.string(), z.number()]).optional(),
});
export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  purpose: z.string().default(""),
  steps: z.array(TestStepSchema).min(1),
  expected: z.string(),
});
export type TestStep = z.infer<typeof TestStepSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;

export interface TestResult {
  test_id: string;
  step_errors: string[];
  console_errors: string[];
  read_values: string[];
  visible_text: string;
}

export const REPAIR_TARGETS = [
  "layout",
  "visual_rendering",
  "controls",
  "simulation_logic",
  "data_display",
  "text_labels",
] as const;
export type RepairTarget = (typeof REPAIR_TARGETS)[number];

export const UI_TEST_FEEDBACK = ["works", "partially_works", "broken"] as const;
export type UiTestFeedback = (typeof UI_TEST_FEEDBACK)[number];

export const GraphChangesSchema = z.object({
  add_nodes: z.array(GraphNodeSchema).default([]),
  update_nodes: z.array(GraphNodeSchema.partial().extend({ id: z.string() })).default([]),
  remove_node_ids: z.array(z.string()).default([]),
  add_edges: z.array(GraphEdgeSchema).default([]),
  remove_edges: z.array(GraphEdgeSchema.pick({ source: true, target: true })).default([]),
});
export type GraphChanges = z.infer<typeof GraphChangesSchema>;

export const SuggestedChangeSchema = z.object({
  target: z.enum(REPAIR_TARGETS),
  summary: z.string(),
  changes: z.array(z.string()).min(1),
  rationale: z.string().default(""),
  ui_graph_changes: GraphChangesSchema.optional(),
});
export type SuggestedChange = z.infer<typeof SuggestedChangeSchema>;

export const AssumptionsSchema = z.object({
  node_id: z.string(),
  items: z
    .array(z.object({ name: z.string(), value: z.string(), rationale: z.string().default("") }))
    .min(1),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;

/** A region on the rendered simulation, plus the DOM elements found inside it (gathered by tool_1). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  elements: RegionElement[];
}
export interface RegionElement {
  tag: string;
  id: string;
  ui_node: string;
  classes: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface CodeVersion {
  /** design identifier, e.g. simulation_code_3, simulation_code_chat_4 */
  id: string;
  html: string;
  createdAt: number;
  note: string;
}
