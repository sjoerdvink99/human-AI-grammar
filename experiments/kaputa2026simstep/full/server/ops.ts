// Model operations from design.json. One prompt per operation, built only from the
// representations in the state that precedes the operation in the design.
import { z } from 'zod';
import { callModel } from './model.js';
import { annotatedScreenshot } from './browser.js';
import {
  REPAIR_TARGETS,
  UI_TEST_FEEDBACK,
  type Graph,
  type Region,
  type TestCase,
  type TestResult,
} from '../shared/types.js';

// ---------------------------------------------------------------- helpers

const SYSTEM =
  'You are the language model inside an authoring tool that helps school teachers create interactive ' +
  'educational simulations. Be accurate about the subject matter, concise, and age-appropriate. ' +
  'When asked for structured output, return only the requested structure.';

const GraphZ = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().describe('short snake_case id, unique'),
        label: z.string(),
        type: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string().describe('node id'),
      target: z.string().describe('node id'),
      label: z.string(),
    }),
  ),
});

function jsonSchema(schema: z.ZodType): object {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

async function structured<T extends z.ZodType>(
  op: string,
  prompt: string,
  schema: T,
  images?: { name: string; dataUrl: string }[],
): Promise<z.infer<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callModel({
      op,
      system: SYSTEM,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was invalid (${String(lastError)}). Follow the schema exactly.`,
      schema: jsonSchema(schema),
      images,
    });
    const parsed = schema.safeParse(res.structured);
    if (parsed.success) return parsed.data;
    lastError = parsed.error.message.slice(0, 400);
  }
  throw new Error(`${op}: model output failed validation: ${String(lastError)}`);
}

/** Enforce graph well-formedness where the graph is produced: unique ids, no dangling links. */
export function normalizeGraph(g: Graph): Graph {
  const seen = new Set<string>();
  const nodes = g.nodes
    .map((n) => ({ ...n, id: n.id.trim() || n.label.toLowerCase().replace(/\W+/g, '_') }))
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  const edgeIds = new Set<string>();
  const edges = g.edges
    .filter((e) => seen.has(e.source) && seen.has(e.target) && e.source !== e.target)
    .map((e, i) => {
      let id = e.id?.trim() || `e${i + 1}`;
      while (edgeIds.has(id)) id = `${id}_${i}`;
      edgeIds.add(id);
      return { ...e, id };
    });
  return { nodes, edges };
}

const graphText = (name: string, g: Graph) => `${name} (JSON):\n${JSON.stringify(g)}`;

const SIM_CONTRACT = `Simulation code contract (must hold for every version of the code):
- ONE self-contained HTML document (<!DOCTYPE html> … </html>) with inline CSS and vanilla JavaScript. No external scripts, fonts, images or network requests. Use inline SVG or <canvas> for graphics.
- It must fit a 900x640 pixel viewport without scrolling.
- Every element that realizes a node of the UI graph carries data-ui-node="<node id>" and a DOM id equal to that node id.
- Inputs (sliders, number fields, selects, buttons) must react to 'input'/'change'/'click' events and update the displays immediately.
- No alert(), confirm() or prompt(). No console errors.
- Physical / mathematical behaviour must be scientifically correct.`;

function extractHtml(text: string): string {
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const html = (fence ? fence[1] : text).trim();
  const start = html.search(/<!doctype html|<html/i);
  const out = start >= 0 ? html.slice(start) : html;
  if (!/<html[\s>]/i.test(out) || !/<\/html>/i.test(out)) throw new Error('model did not return a complete HTML document');
  return out;
}

async function codeOp(op: string, prompt: string, images?: { name: string; dataUrl: string }[]): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callModel({
      op,
      system: SYSTEM,
      prompt:
        `${prompt}\n\n${SIM_CONTRACT}\n\nReturn the COMPLETE updated HTML document in a single \`\`\`html fenced block and nothing else.` +
        (lastError ? `\nPrevious attempt failed: ${lastError}` : ''),
      images,
    });
    try {
      return extractHtml(res.text);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(`${op}: ${lastError}`);
}

const regionText = (name: string, r: Region) =>
  `${name}: the teacher drew a freehand mark (red outline in the screenshot) around the area x=${Math.round(r.bbox.x)}, y=${Math.round(
    r.bbox.y,
  )}, width=${Math.round(r.bbox.w)}, height=${Math.round(r.bbox.h)} px of the 900x640 simulation.\n` +
  `DOM elements under the mark (from the live page): ${JSON.stringify(r.elements.slice(0, 30))}`;

async function regionImage(name: string, html: string, r: Region) {
  return { name, dataUrl: await annotatedScreenshot(html, r.points) };
}

// ---------------------------------------------------------------- process 1

/** P1 [model translate]~ learning_content_1 -> concept_graph_1 */
export async function translateConceptGraph({ learning_content }: { learning_content: string }) {
  const g = await structured(
    'translateConceptGraph',
    `Learning content provided by the teacher:\n"""${learning_content}"""\n\n` +
      'Build a CONCEPT GRAPH of this content: nodes are the key concepts (type: "concept", "quantity", "law", "phenomenon" or "object"), ' +
      'edges are labelled relations between them (e.g. "depends on", "is proportional to", "causes", "is a"). ' +
      'Use 6–16 nodes. Every node gets a one-sentence description.',
    GraphZ,
  );
  return { concept_graph: normalizeGraph(g) };
}

/** P1 [model generate]~ concept_graph_1 -> scenarios_1* */
export async function generateScenarios({ concept_graph }: { concept_graph: Graph }) {
  const r = await structured(
    'generateScenarios',
    `${graphText('Concept graph', concept_graph)}\n\nSuggest 4 distinct, concrete teaching scenarios for an interactive simulation ` +
      'that would let students explore these concepts (e.g. a real-world situation or a lab setup). Each scenario is 1–2 sentences.',
    z.object({ scenarios: z.array(z.string().min(10)).min(2).max(6) }),
  );
  return { scenarios: r.scenarios };
}

/** P1 [model translate]~ concept_graph_1 + scenario_1 -> scenario_graph_1 */
export async function translateScenarioGraph({ concept_graph, scenario }: { concept_graph: Graph; scenario: string }) {
  const g = await structured(
    'translateScenarioGraph',
    `${graphText('Concept graph', concept_graph)}\n\nChosen scenario: "${scenario}"\n\n` +
      'Build a SCENARIO GRAPH: the concrete objects, their properties/quantities and the relations between them in this scenario. ' +
      'Node types: "object", "property", "quantity", "process", "environment". Edge labels state the relation (e.g. "has", "affects", "pulls"). ' +
      'Link quantities to the concepts they instantiate in the descriptions. Use 6–18 nodes.',
    GraphZ,
  );
  return { scenario_graph: normalizeGraph(g) };
}

/** P1 [model generate]~ scenario_graph_1 -> learning_goals_1* */
export async function generateLearningGoals({ scenario_graph }: { scenario_graph: Graph }) {
  const r = await structured(
    'generateLearningGoals',
    `${graphText('Scenario graph', scenario_graph)}\n\nSuggest 4 learning goals students could reach by experimenting in this scenario. ` +
      'Each goal is one sentence starting with "Students will be able to …" and must be testable through an experiment in the simulation.',
    z.object({ learning_goals: z.array(z.string().min(10)).min(2).max(6) }),
  );
  return { learning_goals: r.learning_goals };
}

/** P1 [model select] scenario_graph_1 + learning_goal_1 -> learning_goal_graph_1 (subset enforced in code) */
export async function selectLearningGoalGraph({ scenario_graph, learning_goal }: { scenario_graph: Graph; learning_goal: string }) {
  const r = await structured(
    'selectLearningGoalGraph',
    `${graphText('Scenario graph', scenario_graph)}\n\nLearning goal: "${learning_goal}"\n\n` +
      'Select the part of the scenario graph that matters for this learning goal. Return the ids of the nodes to keep. ' +
      'Only use ids that exist in the scenario graph.',
    z.object({ node_ids: z.array(z.string()).min(1) }),
  );
  const keep = new Set(r.node_ids.filter((id) => scenario_graph.nodes.some((n) => n.id === id)));
  if (keep.size === 0) throw new Error('selectLearningGoalGraph: no valid node ids selected');
  return {
    learning_goal_graph: {
      nodes: scenario_graph.nodes.filter((n) => keep.has(n.id)),
      edges: scenario_graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    },
  };
}

const FactorZ = z.object({ name: z.string(), description: z.string(), range: z.string(), unit: z.string() });

/** P1 [model extract] learning_goal_graph_1 + learning_goal_1 -> experiment_factors_1 */
export async function extractExperimentFactors({ learning_goal_graph, learning_goal }: { learning_goal_graph: Graph; learning_goal: string }) {
  const f = await structured(
    'extractExperimentFactors',
    `${graphText('Learning goal graph', learning_goal_graph)}\n\nLearning goal: "${learning_goal}"\n\n` +
      'Extract the experiment factors: independent variables the student can change (with sensible range and unit), ' +
      'dependent variables the student observes/measures, and controlled variables kept constant. Use only quantities present in the graph.',
    z.object({ independent: z.array(FactorZ).min(1), dependent: z.array(FactorZ).min(1), controlled: z.array(FactorZ) }),
  );
  return { experiment_factors: f };
}

/** P1 [model generate]~ learning_goal_graph_1 + learning_goal_1 + experiment_factors_1 -> procedure_1 */
export async function generateProcedure(input: { learning_goal_graph: Graph; learning_goal: string; experiment_factors: unknown }) {
  const r = await structured(
    'generateProcedure',
    `${graphText('Learning goal graph', input.learning_goal_graph)}\n\nLearning goal: "${input.learning_goal}"\n\n` +
      `Experiment factors: ${JSON.stringify(input.experiment_factors)}\n\n` +
      'Write the experimental procedure a student carries out in the simulation: 4–8 numbered, imperative steps ' +
      '(set up, vary the independent variable, observe/record the dependent variable, compare, conclude).',
    z.object({ steps: z.array(z.string()).min(3).max(10) }),
  );
  return { procedure: r.steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, '')}`).join('\n') };
}

/** P1 [model generate]~ learning_goal_graph_1 + learning_goal_1 + procedure_1 -> ui_graph_1 */
export async function generateUiGraph(input: { learning_goal_graph: Graph; learning_goal: string; procedure: string }) {
  const g = await structured(
    'generateUiGraph',
    `${graphText('Learning goal graph', input.learning_goal_graph)}\n\nLearning goal: "${input.learning_goal}"\n\nProcedure:\n${input.procedure}\n\n` +
      'Design the UI GRAPH of the simulation: nodes are interface elements, edges are how they connect (data flow / control). ' +
      'Node types: "control" (slider, button, toggle, select), "display" (readout, chart, table), "visual" (animated object or scene graphic), ' +
      '"logic" (model/state/computation), "container" (panel). Node ids are short snake_case and will become DOM ids. ' +
      'Each description must be precise enough to implement: for controls give the range/default/unit, for logic give the formula, ' +
      'for visuals say what is drawn and how it reacts. Edge labels: "sets", "updates", "drives", "contains", "triggers". Use 6–16 nodes.',
    GraphZ,
  );
  return { ui_graph: normalizeGraph(g) };
}

/** P1 [model translate]~ ui_graph_1 + learning_goal_1 -> simulation_code_1 */
export async function translateSimulationCode({ ui_graph, learning_goal }: { ui_graph: Graph; learning_goal: string }) {
  const html = await codeOp(
    'translateSimulationCode',
    `${graphText('UI graph', ui_graph)}\n\nLearning goal: "${learning_goal}"\n\nImplement this UI graph as an interactive educational simulation. ` +
      'Every node becomes a concrete element or piece of logic; every edge becomes a real connection in the code.',
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 3

/** P3 [model modify]~ simulation_code_1 + ui_graph_1 + learning_goal_1 + javascript_errors_1* -> simulation_code_2 */
export async function fixJavascriptErrors(input: { simulation_code: string; ui_graph: Graph; learning_goal: string; javascript_errors: string[] }) {
  const html = await codeOp(
    'fixJavascriptErrors',
    `${graphText('UI graph', input.ui_graph)}\n\nLearning goal: "${input.learning_goal}"\n\nJavaScript errors raised when the code runs:\n` +
      input.javascript_errors.map((e) => `- ${e}`).join('\n') +
      `\n\nCurrent code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\nFix these errors without changing intended behaviour.`,
  );
  return { simulation_code: html };
}

const StepZ = z.object({
  action: z.enum(['click', 'set_value', 'press', 'wait', 'read']),
  selector: z.string().describe('CSS selector, prefer #id or [data-ui-node="…"]; empty for wait/press'),
  value: z.string().describe('value for set_value, ms for wait, key for press, empty otherwise'),
});
const TestCaseZ = z.object({
  id: z.string(),
  title: z.string(),
  purpose: z.string(),
  steps: z.array(StepZ).min(1),
  expected: z.string(),
  needs_human_check: z.boolean().describe('true when the expected outcome is visual/animated and must be verified by a person'),
});

/** P3 [model generate]~ simulation_code_2 + ui_graph_1 + learning_goal_1 -> test_cases_1* */
export async function generateTestCases(input: { simulation_code: string; ui_graph: Graph; learning_goal: string }) {
  const r = await structured(
    'generateTestCases',
    `${graphText('UI graph', input.ui_graph)}\n\nLearning goal: "${input.learning_goal}"\n\nCode:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Write 4–7 structured interaction tests. Each test is a list of steps executed by a browser robot: ' +
      'click(selector), set_value(selector, value) for inputs/sliders/selects, press(key), wait(ms), read(selector) to record a displayed value. ' +
      'Use selectors that exist in the code. Cover each control, the main cause–effect relation of the learning goal, and edge values. ' +
      'Mark tests whose outcome is visual (animation, drawing, layout) with needs_human_check = true. Test ids: t1, t2, …',
    z.object({ test_cases: z.array(TestCaseZ).min(1).max(10) }),
  );
  return { test_cases: r.test_cases };
}

/** P3 [model evaluate]~ code + ui_graph + learning_goal + test_cases* + test_results* + test_screenshots* -> test_assessment_1 */
export async function evaluateTestResults(input: {
  simulation_code: string;
  ui_graph: Graph;
  learning_goal: string;
  test_cases: TestCase[];
  test_results: TestResult[];
  test_screenshots: { test_id: string; dataUrl: string }[];
}) {
  const a = await structured(
    'evaluateTestResults',
    `${graphText('UI graph', input.ui_graph)}\n\nLearning goal: "${input.learning_goal}"\n\n` +
      `Test cases: ${JSON.stringify(input.test_cases)}\n\nTest results: ${JSON.stringify(input.test_results)}\n\n` +
      `Code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'A screenshot taken at the end of each test is attached. Judge whether the results show that the simulation works and ' +
      'lets students reach the learning goal (correct science, responsive controls, readable displays). List concrete problems.',
    z.object({ meets_goal: z.boolean(), summary: z.string(), problems: z.array(z.string()) }),
    input.test_screenshots.slice(0, 8).map((s) => ({ name: `screenshot_${s.test_id}`, dataUrl: s.dataUrl })),
  );
  return { test_assessment: a };
}

/** P3 [model modify]~ code_2 + ui_graph + test_cases* + test_assessment -> simulation_code_3 */
export async function repairFromAssessment(input: { simulation_code: string; ui_graph: Graph; test_cases: TestCase[]; test_assessment: unknown }) {
  const html = await codeOp(
    'repairFromAssessment',
    `${graphText('UI graph', input.ui_graph)}\n\nTest cases: ${JSON.stringify(input.test_cases)}\n\n` +
      `Assessment of the test results: ${JSON.stringify(input.test_assessment)}\n\nCode:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Correct the code so that every problem in the assessment is fixed and the tests pass. Keep selectors used by the tests working.',
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 4

const TARGET_HELP =
  'Graph levels: concept_graph = which concepts/relations are taught; scenario_graph = objects and relations of the scenario; ' +
  'learning_goal_graph = which part of the scenario is in focus; ui_graph = interface elements and their wiring; code = an implementation bug only.';

/** P4 [model select] ui_test_feedback_1 (+ the test it reports on) + simulation_code_3 -> repair_target_1 */
export async function selectRepairTarget(input: { ui_test_feedback: { value: string; ui_test: TestCase }; simulation_code: string }) {
  const r = await structured(
    'selectRepairTarget',
    `The teacher played this test and reported "${input.ui_test_feedback.value}" (options: ${UI_TEST_FEEDBACK.join(', ')}).\n` +
      `Test: ${JSON.stringify(input.ui_test_feedback.ui_test)}\n\nCode:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      `${TARGET_HELP}\nAt which level does the problem lie?`,
    z.object({ repair_target: z.enum(REPAIR_TARGETS), reason: z.string() }),
  );
  return r;
}

/** P4 [model generate]~ repair_target_1 + ui_test_feedback_1 + simulation_code_3 -> suggested_repair_1 */
export async function generateSuggestedRepair(input: {
  repair_target: string;
  ui_test_feedback: { value: string; ui_test: TestCase };
  simulation_code: string;
}) {
  const r = await structured(
    'generateSuggestedRepair',
    `Problem level: ${input.repair_target}. ${TARGET_HELP}\n` +
      `Teacher feedback "${input.ui_test_feedback.value}" on test ${JSON.stringify(input.ui_test_feedback.ui_test)}\n\n` +
      `Code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Propose one correction phrased at that level (teacher-friendly summary, then concrete details of what will change).',
    z.object({ summary: z.string(), details: z.string() }),
  );
  return { suggested_repair: { level: input.repair_target, ...r } };
}

/** P4 [model modify]~ approved_repair_1 + simulation_code_3 -> simulation_code_guided_4 */
export async function applyRepairToCode(input: { approved_repair: unknown; simulation_code: string }) {
  const html = await codeOp(
    'applyRepairToCode',
    `Approved correction: ${JSON.stringify(input.approved_repair)}\n\nCode:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\nApply the correction to the code.`,
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 5

/** P5 [model select] chat_region_1 + issue_1 + ui_graph_1 + simulation_code_3 -> repair_target_2 */
export async function selectRepairTargetForIssue(input: { chat_region: Region; issue: string; ui_graph: Graph; simulation_code: string }) {
  return structured(
    'selectRepairTargetForIssue',
    `${regionText('Marked region', input.chat_region)}\n\nTeacher's issue: "${input.issue}"\n\n${graphText('UI graph', input.ui_graph)}\n\n` +
      `Code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n${TARGET_HELP}\nAt which level does the problem lie?`,
    z.object({ repair_target: z.enum(REPAIR_TARGETS), reason: z.string() }),
    [await regionImage('annotated_simulation', input.simulation_code, input.chat_region)],
  );
}

const GraphOpZ = z.object({
  op: z.enum(['add_node', 'remove_node', 'update_node', 'add_edge', 'remove_edge']),
  id: z.string().describe('node id (node ops) or edge id (edge ops)'),
  label: z.string(),
  type: z.string(),
  description: z.string(),
  source: z.string().describe('add_edge only, else empty'),
  target: z.string().describe('add_edge only, else empty'),
});

/** P5 [model generate]~ repair_target_2 + issue_1 + ui_graph_1 + simulation_code_3 -> suggested_change_1 */
export async function generateSuggestedChange(input: { repair_target: string; issue: string; ui_graph: Graph; simulation_code: string }) {
  const r = await structured(
    'generateSuggestedChange',
    `Problem level: ${input.repair_target}. ${TARGET_HELP}\nTeacher's issue: "${input.issue}"\n\n${graphText('UI graph', input.ui_graph)}\n\n` +
      `Code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Propose a change expressed as edit operations on the UI graph (add/remove/update nodes, add/remove edges). ' +
      'update_node keeps the id and sets the new label/type/description (put the full new description). ' +
      'Node descriptions must be precise enough to implement. Give a short teacher-friendly summary.',
    z.object({ summary: z.string(), operations: z.array(GraphOpZ).min(1) }),
  );
  return { suggested_change: { level: input.repair_target, ...r } };
}

/** P5 [model modify]~ ui_graph_2 + simulation_code_3 -> simulation_code_chat_4 */
export async function reviseCodeForGraph(input: { ui_graph: Graph; simulation_code: string }) {
  const html = await codeOp(
    'reviseCodeForGraph',
    `The UI graph was updated by the teacher:\n${graphText('UI graph', input.ui_graph)}\n\nCurrent code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Revise the code so it implements the updated UI graph exactly: elements for new nodes, removal of deleted nodes, ' +
      'changed descriptions reflected in behaviour, and edges as real connections. Leave everything else unchanged.',
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 6

/** P6 [model extract] selected_node_1 + ui_graph_1 + simulation_code_3 -> assumptions_1 */
export async function extractAssumptions(input: { selected_node: string; ui_graph: Graph; simulation_code: string }) {
  const node = input.ui_graph.nodes.find((n) => n.id === input.selected_node);
  if (!node) throw new Error(`unknown node ${input.selected_node}`);
  const r = await structured(
    'extractAssumptions',
    `${graphText('UI graph', input.ui_graph)}\n\nSelected node: ${JSON.stringify(node)}\n\nCode:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'List the hidden implementation assumptions the code makes about this node, in plain teacher-readable sentences: ' +
      'default values, ranges, units, constants, formulas, simplifications, timing, colours/sizes, what it updates. ' +
      'Each assumption must be checkable in the code. 4–10 items.',
    z.object({ assumptions: z.array(z.string()).min(1) }),
  );
  return {
    assumptions: { node_id: node.id, node_label: node.label, items: r.assumptions.map((text, i) => ({ id: `a${i + 1}`, text })) },
  };
}

/** P6 [model modify]~ assumptions_2 + simulation_code_3 -> simulation_code_assumptions_4 */
export async function reviseCodeForAssumptions(input: { assumptions: unknown; simulation_code: string }) {
  const html = await codeOp(
    'reviseCodeForAssumptions',
    `The teacher reviewed and edited the assumptions the code makes about one interface element:\n${JSON.stringify(input.assumptions)}\n\n` +
      `Current code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\nRevise the code so that it follows every assumption exactly as written now.`,
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 7

/** P7 [model translate]~ redraw_region_1 + sketch_1 + simulation_code_3 -> replacement_svg_1 */
export async function translateSketchToSvg(input: { redraw_region: Region; sketch: string; simulation_code: string }) {
  const region = await regionImage('annotated_simulation', input.simulation_code, input.redraw_region);
  const res = await callModel({
    op: 'translateSketchToSvg',
    system: SYSTEM,
    prompt:
      `${regionText('Region to redraw', input.redraw_region)}\n\nThe teacher drew a rough sketch of what should replace the graphic inside the red mark ` +
      '(image "sketch"). Turn the sketch into a clean, simple, flat SVG illustration that keeps the sketch\'s shapes, proportions and colours ' +
      'and suits the simulation style. Use a viewBox, no external references, no scripts, no text unless sketched. ' +
      'Return only the SVG in a ```svg fenced block.',
    images: [region, { name: 'sketch', dataUrl: input.sketch }],
  });
  const m = /<svg[\s\S]*<\/svg>/i.exec(res.text);
  if (!m) throw new Error('translateSketchToSvg: no <svg> element returned');
  const svg = m[0];
  if (/<script|href\s*=\s*["']https?:/i.test(svg)) throw new Error('translateSketchToSvg: SVG contains scripts or external references');
  return { replacement_svg: svg };
}

/** P7 [model modify]~ replacement_svg_1 + redraw_region_1 + simulation_code_3 -> simulation_code_redrawn_4 */
export async function replaceGraphic(input: { replacement_svg: string; redraw_region: Region; simulation_code: string }) {
  const html = await codeOp(
    'replaceGraphic',
    `${regionText('Region to redraw', input.redraw_region)}\n\nReplacement SVG:\n${input.replacement_svg}\n\n` +
      `Current code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Replace the graphic inside the marked region with the replacement SVG (inline it, or draw it via an Image from a data URL on canvas). ' +
      'Keep its position, size and any animation/transform behaviour the original graphic had.',
    [await regionImage('annotated_simulation', input.simulation_code, input.redraw_region)],
  );
  return { simulation_code: html };
}

// ---------------------------------------------------------------- process 8

/** P8 [model match] subgraph_region_1 + ui_graph_1 + simulation_code_3 -> subgraph_1 */
export async function matchSubgraph(input: { subgraph_region: Region; ui_graph: Graph; simulation_code: string }) {
  const r = await structured(
    'matchSubgraph',
    `${regionText('Region to inspect', input.subgraph_region)}\n\n${graphText('UI graph', input.ui_graph)}\n\n` +
      `Code:\n\`\`\`html\n${input.simulation_code}\n\`\`\`\n\n` +
      'Identify the UI graph nodes that implement what is inside the red mark, plus the nodes directly responsible for its behaviour ' +
      '(e.g. the logic that computes it, the control that sets it). Return node ids and the ids of edges connecting them, and explain briefly.',
    z.object({ node_ids: z.array(z.string()), edge_ids: z.array(z.string()), explanation: z.string() }),
    [await regionImage('annotated_simulation', input.simulation_code, input.subgraph_region)],
  );
  const nodeIds = r.node_ids.filter((id) => input.ui_graph.nodes.some((n) => n.id === id));
  const set = new Set(nodeIds);
  const edgeIds = input.ui_graph.edges
    .filter((e) => r.edge_ids.includes(e.id) || (set.has(e.source) && set.has(e.target)))
    .filter((e) => set.has(e.source) && set.has(e.target))
    .map((e) => e.id);
  return { subgraph: { nodeIds, edgeIds, explanation: r.explanation } };
}
