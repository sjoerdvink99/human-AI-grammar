// One function (and one prompt) per model operation in the design.
// Each prompt is built only from the representations in the state preceding the operation.
import { z } from "zod";
import { callModel, extractHtml, extractJson, extractSvg } from "./model.js";
import {
  AssumptionsSchema,
  ExperimentFactorsSchema,
  GraphSchema,
  REPAIR_TARGETS,
  SuggestedChangeSchema,
  TestCaseSchema,
  type Assumptions,
  type ExperimentFactors,
  type Graph,
  type Region,
  type RepairTarget,
  type SuggestedChange,
  type TestCase,
  type TestResult,
  type UiTestFeedback,
} from "../shared/types.js";

const j = (v: unknown) => JSON.stringify(v, null, 2);

/** Call the model, parse with `parse`, retry once with the validation error fed back. */
async function modelWith<T>(op: string, system: string, prompt: string, parse: (text: string) => T, images?: { name: string; dataUrl: string }[]): Promise<T> {
  let lastErr: unknown;
  let p = prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel({ op, system, prompt: p, images });
    try {
      return parse(text);
    } catch (e) {
      lastErr = e;
      console.warn(`[model] ${op} invalid output (attempt ${attempt + 1}): ${(e as Error).message.slice(0, 300)}`);
      p = `${prompt}\n\nYour previous answer was invalid: ${(e as Error).message.slice(0, 800)}\nAnswer again, strictly in the requested format.`;
    }
  }
  throw lastErr;
}

const jsonOf = <S extends z.ZodTypeAny>(schema: S) => (text: string): z.infer<S> => schema.parse(extractJson(text));

function checkGraphRefs(g: Graph): Graph {
  const ids = new Set(g.nodes.map((n) => n.id));
  if (ids.size !== g.nodes.length) throw new Error("graph node ids must be unique");
  return { ...g, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}
const graphOf = (text: string) => checkGraphRefs(GraphSchema.parse(extractJson(text)));

const GRAPH_FORMAT = `Return JSON only: {"nodes":[{"id":"snake_case_id","label":"Short label","description":"one sentence","kind":"category"}],"edges":[{"source":"id","target":"id","label":"relation verb"}]}`;

const SIM_RULES = `Simulation code rules:
- One complete, self-contained HTML document (inline <style> and <script>, no external network resources, no imports).
- It runs inside a sandboxed iframe (~900x640 px). Use a canvas or inline SVG for the visual model, and HTML inputs for controls.
- Every element that realizes a UI-graph node MUST carry the attribute data-ui-node="<node id>" and a stable id attribute.
- Controls must be real <input>, <select> or <button> elements with ids, so tests can drive them.
- Show current values of the dependent variables as text with ids.
- No alert/prompt/confirm dialogs. No console errors.
Return the full document inside one \`\`\`html fenced block and nothing else.`;

// ---------------- Process 1 ----------------

export const translateConceptGraph = (learning_content: string) =>
  modelWith(
    "p1.translate.concept_graph",
    "You turn educational learning content into a concept graph of its key scientific concepts and how they relate.",
    `Learning content:\n"""\n${learning_content}\n"""\n\nBuild a concept graph with 6-14 concept nodes (kind: "concept", "quantity", "law" or "phenomenon") and labelled relation edges.\n${GRAPH_FORMAT}`,
    graphOf,
  );

export const generateScenarios = (concept_graph: Graph) =>
  modelWith(
    "p1.generate.scenarios",
    "You propose concrete, real-world scenarios in which learners can explore a set of concepts through an interactive simulation.",
    `Concept graph:\n${j(concept_graph)}\n\nPropose 4 distinct real-world scenarios (2-3 sentences each) that each exercise several of these concepts and could be simulated interactively.\nReturn JSON only: {"scenarios":["...","..."]}`,
    (t) => z.object({ scenarios: z.array(z.string().min(10)).min(2) }).parse(extractJson(t)).scenarios,
  );

export const translateScenarioGraph = (concept_graph: Graph, scenario: string) =>
  modelWith(
    "p1.translate.scenario_graph",
    "You model a real-world scenario as a graph of the entities, variables and processes in it, grounded in a concept graph.",
    `Concept graph:\n${j(concept_graph)}\n\nChosen scenario:\n"""${scenario}"""\n\nBuild a scenario graph with 8-16 nodes. kind is one of "entity", "variable", "process", "concept". Variables should name their quantity and unit in the description. Edges describe causal or structural relations (e.g. "increases", "has", "determines").\n${GRAPH_FORMAT}`,
    graphOf,
  );

export const generateLearningGoals = (scenario_graph: Graph) =>
  modelWith(
    "p1.generate.learning_goals",
    "You write learning goals for inquiry-based simulation activities.",
    `Scenario graph:\n${j(scenario_graph)}\n\nWrite 4 distinct, measurable learning goals ("Learners will be able to ...") that a learner could reach by experimenting with a simulation of this scenario. Each goal should focus on a relationship between a few variables.\nReturn JSON only: {"learning_goals":["...","..."]}`,
    (t) => z.object({ learning_goals: z.array(z.string().min(10)).min(2) }).parse(extractJson(t)).learning_goals,
  );

export const selectLearningGoalGraph = async (scenario_graph: Graph, learning_goal: string): Promise<Graph> => {
  const ids = new Set(scenario_graph.nodes.map((n) => n.id));
  const chosen = await modelWith(
    "p1.select.learning_goal_graph",
    "You select the part of a scenario graph that a learning goal depends on.",
    `Scenario graph:\n${j(scenario_graph)}\n\nLearning goal: "${learning_goal}"\n\nSelect the node ids needed to reach this learning goal (the variables involved, the entities/processes connecting them). Use only ids from the graph.\nReturn JSON only: {"node_ids":["..."]}`,
    (t) => {
      const r = z.object({ node_ids: z.array(z.string()).min(1) }).parse(extractJson(t)).node_ids;
      const bad = r.filter((id) => !ids.has(id));
      if (bad.length) throw new Error(`unknown node ids: ${bad.join(", ")}`);
      return new Set(r);
    },
  );
  // Deterministic sub-graph construction from the model's selection.
  return {
    nodes: scenario_graph.nodes.filter((n) => chosen.has(n.id)),
    edges: scenario_graph.edges.filter((e) => chosen.has(e.source) && chosen.has(e.target)),
  };
};

export const extractExperimentFactors = (learning_goal_graph: Graph, learning_goal: string) =>
  modelWith(
    "p1.extract.experiment_factors",
    "You extract the experimental design (variables) implied by a learning goal and its concept sub-graph.",
    `Learning goal: "${learning_goal}"\nLearning-goal graph:\n${j(learning_goal_graph)}\n\nExtract the experiment factors. Independent variables are what the learner manipulates (give numeric min, max and default where meaningful); dependent variables are what they observe/measure; controlled variables are held fixed. Set node_id to the graph node each variable comes from (or null).\nReturn JSON only: {"independent_variables":[{"name":"","unit":"","min":0,"max":10,"default":5,"node_id":"","description":""}],"dependent_variables":[...],"controlled_variables":[...]}`,
    jsonOf(ExperimentFactorsSchema),
  );

export const generateProcedure = (learning_goal_graph: Graph, learning_goal: string, experiment_factors: ExperimentFactors) =>
  modelWith(
    "p1.generate.procedure",
    "You write the experiment procedure a learner follows in an interactive simulation.",
    `Learning goal: "${learning_goal}"\nLearning-goal graph:\n${j(learning_goal_graph)}\nExperiment factors:\n${j(experiment_factors)}\n\nWrite a numbered procedure of 5-9 steps that a learner follows in the simulation to reach the goal: what to set, what to run, what to observe and record, and what to conclude. Plain text only, one step per line.`,
    (t) => {
      const s = t.trim();
      if (s.length < 40) throw new Error("procedure too short");
      return s;
    },
  );

export const generateUiGraph = (learning_goal_graph: Graph, learning_goal: string, procedure: string) =>
  modelWith(
    "p1.generate.ui_graph",
    "You design the user interface of an educational simulation as a graph of UI components and the data flow between them.",
    `Learning goal: "${learning_goal}"\nLearning-goal graph:\n${j(learning_goal_graph)}\nProcedure:\n${procedure}\n\nDesign a UI graph with 6-14 nodes. kind must be one of "container", "control", "display", "visual", "logic". Controls are sliders/buttons/selects that set variables; displays show values, charts or tables; visuals are the animated depiction of the scenario; logic nodes are the simulation model computations; containers group components. Edges: "contains", "sets", "updates", "drives". Node descriptions must be specific (ranges, units, what is drawn).\n${GRAPH_FORMAT}`,
    (t) => {
      const g = graphOf(t);
      const kinds = ["container", "control", "display", "visual", "logic"];
      for (const n of g.nodes) if (!kinds.includes(n.kind)) throw new Error(`node ${n.id} has invalid kind ${n.kind}`);
      return g;
    },
  );

export const translateSimulationCode = (ui_graph: Graph, learning_goal: string) =>
  modelWith(
    "p1.translate.simulation_code",
    "You implement an interactive educational simulation from a UI graph.",
    `Learning goal: "${learning_goal}"\nUI graph:\n${j(ui_graph)}\n\nImplement the simulation so that every UI-graph node is realized and the edges (sets/updates/drives) are honored.\n${SIM_RULES}`,
    extractHtml,
  );

// ---------------- Process 3 ----------------

export const fixJavascriptErrors = (code: string, ui_graph: Graph, learning_goal: string, javascript_errors: string[]) =>
  modelWith(
    "p3.modify.fix_errors",
    "You fix runtime JavaScript errors in an HTML simulation without changing its intended design.",
    `Learning goal: "${learning_goal}"\nUI graph:\n${j(ui_graph)}\nJavaScript errors observed when loading and interacting in a headless browser:\n${javascript_errors.length ? javascript_errors.map((e) => `- ${e}`).join("\n") : "(none observed — still check the code against the UI graph and fix any defect you find)"}\n\nCurrent code:\n\`\`\`html\n${code}\n\`\`\`\n\nReturn the corrected code.\n${SIM_RULES}`,
    extractHtml,
  );

export const generateTestCases = (code: string, ui_graph: Graph, learning_goal: string) =>
  modelWith(
    "p3.generate.test_cases",
    "You write automated UI test cases for an HTML simulation.",
    `Learning goal: "${learning_goal}"\nUI graph:\n${j(ui_graph)}\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nWrite 3-6 test cases that check the simulation supports the learning goal: controls change the model, displays update, the visual responds. Steps use CSS selectors that exist in the code. Actions: "click" (selector), "set_value" (selector, value — for inputs/selects; fires input and change events), "wait" (value = milliseconds, max 3000), "read_text" (selector — records its text for checking).\nReturn JSON only: {"test_cases":[{"id":"t1","title":"","purpose":"","steps":[{"action":"set_value","selector":"#mass","value":"5"}],"expected":"what should be observed"}]}`,
    (t) => {
      const tcs = z.object({ test_cases: z.array(TestCaseSchema).min(1) }).parse(extractJson(t)).test_cases;
      return tcs.map((tc, i) => ({ ...tc, id: tc.id || `t${i + 1}` }));
    },
  );

export const evaluateTests = (
  code: string,
  ui_graph: Graph,
  learning_goal: string,
  test_cases: TestCase[],
  test_results: TestResult[],
  test_screenshots: string[],
) =>
  modelWith(
    "p3.evaluate.tests",
    "You assess automated test results and screenshots of an educational simulation and identify defects.",
    `Learning goal: "${learning_goal}"\nUI graph:\n${j(ui_graph)}\nTest cases:\n${j(test_cases)}\nTest results (step errors, console errors, values read, visible text):\n${j(test_results)}\nOne screenshot per test case is attached, in the same order (test_<id>.png).\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nWrite an assessment: for each test say PASS or FAIL with the evidence, then list concrete defects to fix (visual, logic, layout, labels), most important first. If everything passes, say so and list only minor improvements. Plain text.`,
    (t) => t.trim(),
    test_screenshots.map((d, i) => ({ name: `test_${test_cases[i]?.id ?? i}.png`, dataUrl: d })),
  );

export const repairFromAssessment = (code: string, ui_graph: Graph, test_cases: TestCase[], test_assessment: string) =>
  modelWith(
    "p3.modify.repair",
    "You repair an HTML simulation according to a test assessment.",
    `UI graph:\n${j(ui_graph)}\nTest cases (keep their selectors working):\n${j(test_cases)}\nAssessment:\n${test_assessment}\n\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nFix the defects in the assessment. Keep everything that works.\n${SIM_RULES}`,
    extractHtml,
  );

// ---------------- Process 4 & 5: repair target, suggestion, application ----------------

const TARGET_HELP = `Repair targets: ${REPAIR_TARGETS.join(", ")}.`;

export const selectRepairTarget = (code: string, context: string) =>
  modelWith(
    "p45.select.repair_target",
    "You classify which part of an HTML simulation a reported problem lies in.",
    `${context}\n\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\n${TARGET_HELP}\nPick the single most likely target.\nReturn JSON only: {"repair_target":"one of the targets","reason":"short"}`,
    (t) => z.object({ repair_target: z.enum(REPAIR_TARGETS) }).parse(extractJson(t)).repair_target,
  );

export const suggestRepair = (code: string, repair_target: RepairTarget, ui_test_feedback: UiTestFeedback, about: string) =>
  modelWith(
    "p4.generate.suggested_repair",
    "You propose concrete repairs to an HTML simulation; the teacher will approve individual changes.",
    `Human verdict on a UI test: ${ui_test_feedback} (test: ${about})\nRepair target: ${repair_target}\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nPropose a repair as 1-5 independent, concrete changes the teacher can approve or reject one by one.\nReturn JSON only: {"target":"${repair_target}","summary":"","changes":["..."],"rationale":""}`,
    jsonOf(SuggestedChangeSchema),
  );

export const suggestChange = (code: string, ui_graph: Graph, repair_target: RepairTarget, issue: string, region: Region) =>
  modelWith(
    "p5.generate.suggested_change",
    "You propose changes to an educational simulation and its UI graph in response to a teacher's request about a region of the screen.",
    `Teacher's request: "${issue}"\nRegion of the simulation it refers to (px) and the elements inside it:\n${j(region)}\nRepair target: ${repair_target}\nUI graph:\n${j(ui_graph)}\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nPropose 1-5 concrete changes the teacher can approve one by one, AND the corresponding edits to the UI graph. Every change must be reflected in ui_graph_changes (update a node's description, add/remove nodes or edges) so that the code can be regenerated from the graph. For updated nodes include id and the full new description.\nReturn JSON only: {"target":"${repair_target}","summary":"","changes":["..."],"rationale":"","ui_graph_changes":{"add_nodes":[],"update_nodes":[{"id":"","description":""}],"remove_node_ids":[],"add_edges":[],"remove_edges":[]}}`,
    jsonOf(SuggestedChangeSchema),
  );

export const applyApprovedChange = (code: string, approved: SuggestedChange) =>
  modelWith(
    "p4.modify.apply_repair",
    "You apply approved changes to an HTML simulation, changing nothing else.",
    `Approved repair (apply exactly these changes):\n${j(approved)}\n\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\n${SIM_RULES}`,
    extractHtml,
  );

export const regenerateFromUiGraph = (code: string, ui_graph: Graph) =>
  modelWith(
    "p5.modify.code_from_ui_graph",
    "You update an HTML simulation so that it matches its UI graph.",
    `Updated UI graph (nodes with a change_note were just changed; realize those changes):\n${j(ui_graph)}\n\nCurrent code:\n\`\`\`html\n${code}\n\`\`\`\n\nUpdate the code so it matches the graph. Keep unchanged parts as they are.\n${SIM_RULES}`,
    extractHtml,
  );

// ---------------- Process 6 ----------------

export const extractAssumptions = (code: string, ui_graph: Graph, selected_node: string) =>
  modelWith(
    "p6.extract.assumptions",
    "You surface the modelling and design assumptions an HTML simulation makes for one UI component.",
    `Selected UI-graph node: "${selected_node}"\nUI graph:\n${j(ui_graph)}\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nList 3-8 assumptions the code makes for this component: constants, formulas, ranges, units, simplifications, initial values, visual mappings. Each value must be short and editable (e.g. "9.81 m/s²", "linear drag", "0–100 °C").\nReturn JSON only: {"node_id":"${selected_node}","items":[{"name":"","value":"","rationale":""}]}`,
    (t) => {
      const a = AssumptionsSchema.parse(extractJson(t));
      return { ...a, node_id: selected_node };
    },
  );

export const applyAssumptions = (code: string, assumptions: Assumptions) =>
  modelWith(
    "p6.modify.apply_assumptions",
    "You update an HTML simulation so it follows a set of edited assumptions.",
    `Assumptions for UI node "${assumptions.node_id}" (the teacher may have edited values; the code must now follow every one of them):\n${j(assumptions.items)}\n\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\n${SIM_RULES}`,
    extractHtml,
  );

// ---------------- Process 7 ----------------

export const sketchToSvg = (sketch: string, region: Region) =>
  modelWith(
    "p7.translate.sketch_to_svg",
    "You turn a rough hand-drawn sketch into clean SVG graphics.",
    `The attached image sketch.png is a teacher's rough drawing meant to replace a ${Math.round(region.w)}x${Math.round(region.h)} px region of a simulation. Interpret what is drawn and produce a clean, simple, colourful SVG with viewBox="0 0 ${Math.round(region.w)} ${Math.round(region.h)}". Give meaningful ids to the main shapes. No scripts. Return only the <svg>…</svg> markup.`,
    extractSvg,
    [{ name: "sketch.png", dataUrl: sketch }],
  );

export const integrateSvg = (code: string, replacement_svg: string, region: Region) =>
  modelWith(
    "p7.modify.integrate_svg",
    "You integrate new SVG graphics into an HTML simulation.",
    `Region of the simulation to redraw (px) and the elements currently inside it:\n${j(region)}\nReplacement SVG:\n${replacement_svg}\n\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nReplace the visual content in that region with this SVG design. If the region shows animated or data-driven graphics, keep the behaviour: redraw with the new look (e.g. draw the SVG shapes, or reproduce them on the canvas) and keep any position/size bindings to variables. Keep data-ui-node attributes.\n${SIM_RULES}`,
    extractHtml,
  );

// ---------------- Process 8 ----------------

export const matchSubgraph = async (ui_graph: Graph, region: Region, code: string): Promise<string[]> => {
  const ids = new Set(ui_graph.nodes.map((n) => n.id));
  return modelWith(
    "p8.match.subgraph",
    "You match a region of a rendered simulation to the UI-graph nodes that produce it.",
    `Region (px) and the DOM elements inside it (ui_node = data-ui-node attribute):\n${j(region)}\nUI graph:\n${j(ui_graph)}\nCode:\n\`\`\`html\n${code}\n\`\`\`\n\nWhich UI-graph nodes are responsible for what is shown in this region (including logic nodes that drive it)?\nReturn JSON only: {"node_ids":["..."]}`,
    (t) => {
      const r = z.object({ node_ids: z.array(z.string()) }).parse(extractJson(t)).node_ids.filter((id) => ids.has(id));
      if (!r.length) throw new Error("no valid node ids matched");
      return r;
    },
  );
};
