import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ops from "./ops.js";
import { loadAndCollectErrors, runTests } from "./headless.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

/** Register a POST endpoint whose body is passed to `fn`; returns {result} or {error}. */
function route<B>(p: string, fn: (b: B) => Promise<unknown>) {
  app.post(`/api/${p}`, async (req: Request, res: Response) => {
    try {
      res.json({ result: await fn(req.body as B) });
    } catch (e) {
      console.error(`[api] ${p}:`, (e as Error).message);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}

type B = Record<string, any>; // bodies are validated by the ops' typed parameters / zod on output

// Process 1
route<B>("p1/concept-graph", (b) => ops.translateConceptGraph(b.learning_content));
route<B>("p1/scenarios", (b) => ops.generateScenarios(b.concept_graph));
route<B>("p1/scenario-graph", (b) => ops.translateScenarioGraph(b.concept_graph, b.scenario));
route<B>("p1/learning-goals", (b) => ops.generateLearningGoals(b.scenario_graph));
route<B>("p1/learning-goal-graph", (b) => ops.selectLearningGoalGraph(b.scenario_graph, b.learning_goal));
route<B>("p1/experiment-factors", (b) => ops.extractExperimentFactors(b.learning_goal_graph, b.learning_goal));
route<B>("p1/procedure", (b) => ops.generateProcedure(b.learning_goal_graph, b.learning_goal, b.experiment_factors));
route<B>("p1/ui-graph", (b) => ops.generateUiGraph(b.learning_goal_graph, b.learning_goal, b.procedure));
route<B>("p1/simulation-code", (b) => ops.translateSimulationCode(b.ui_graph, b.learning_goal));

// Process 3
route<B>("p3/javascript-errors", (b) => loadAndCollectErrors(b.simulation_code));
route<B>("p3/fix-errors", (b) => ops.fixJavascriptErrors(b.simulation_code, b.ui_graph, b.learning_goal, b.javascript_errors));
route<B>("p3/test-cases", (b) => ops.generateTestCases(b.simulation_code, b.ui_graph, b.learning_goal));
route<B>("p3/run-tests", (b) => runTests(b.simulation_code, b.test_cases));
route<B>("p3/evaluate", (b) =>
  ops.evaluateTests(b.simulation_code, b.ui_graph, b.learning_goal, b.test_cases, b.test_results, b.test_screenshots),
);
route<B>("p3/repair", (b) => ops.repairFromAssessment(b.simulation_code, b.ui_graph, b.test_cases, b.test_assessment));

// Process 4
route<B>("p4/repair-target", (b) =>
  ops.selectRepairTarget(b.simulation_code, `Human verdict "${b.ui_test_feedback}" on UI test: ${b.about}`),
);
route<B>("p4/suggest", (b) => ops.suggestRepair(b.simulation_code, b.repair_target, b.ui_test_feedback, b.about));
route<B>("p4/apply", (b) => ops.applyApprovedChange(b.simulation_code, b.approved_repair));

// Process 5
route<B>("p5/repair-target", (b) =>
  ops.selectRepairTarget(
    b.simulation_code,
    `Teacher's request about a region of the simulation: "${b.issue}"\nRegion and elements: ${JSON.stringify(b.chat_region)}\nUI graph: ${JSON.stringify(b.ui_graph)}`,
  ),
);
route<B>("p5/suggest", (b) => ops.suggestChange(b.simulation_code, b.ui_graph, b.repair_target, b.issue, b.chat_region));
route<B>("p5/regenerate", (b) => ops.regenerateFromUiGraph(b.simulation_code, b.ui_graph));

// Process 6
route<B>("p6/assumptions", (b) => ops.extractAssumptions(b.simulation_code, b.ui_graph, b.selected_node));
route<B>("p6/apply", (b) => ops.applyAssumptions(b.simulation_code, b.assumptions));

// Process 7
route<B>("p7/svg", (b) => ops.sketchToSvg(b.sketch, b.redraw_region));
route<B>("p7/integrate", (b) => ops.integrateSvg(b.simulation_code, b.replacement_svg, b.redraw_region));

// Process 8
route<B>("p8/match", (b) => ops.matchSubgraph(b.ui_graph, b.subgraph_region, b.simulation_code));

if (process.env.NODE_ENV === "production") {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8931);
const server = app.listen(port, () => console.log(`System X server on http://localhost:${port}`));
server.requestTimeout = 0; // model calls can take minutes
server.headersTimeout = 0;
server.timeout = 0;
