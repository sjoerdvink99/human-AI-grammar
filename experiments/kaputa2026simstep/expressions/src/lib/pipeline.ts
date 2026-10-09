// Automatic model/tool chains: the tail of process 1 (after the learning goal is chosen) and process 3.
import type { CodeVersion, ExperimentFactors, Graph, TestCase, TestResult } from "../../shared/types";
import type { Project } from "../state";
import { post } from "./api";

type Update = (patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
type OnStep = (step: string) => void;

const version = (id: string, html: string, note: string): CodeVersion => ({ id, html, note, createdAt: Date.now() });

/** Process 1, from (scenario_graph_1 + learning_goal_1) to (ui_graph_1 + learning_goal_1 + simulation_code_1). */
export async function runGoalChain(scenario_graph: Graph, learning_goal: string, update: Update, onStep: OnStep) {
  onStep("learning_goal_graph");
  const learning_goal_graph = await post<Graph>("p1/learning-goal-graph", { scenario_graph, learning_goal });
  update({ learning_goal_graph });

  onStep("experiment_factors");
  const experiment_factors = await post<ExperimentFactors>("p1/experiment-factors", { learning_goal_graph, learning_goal });
  update({ experiment_factors });

  onStep("procedure");
  const procedure = await post<string>("p1/procedure", { learning_goal_graph, learning_goal, experiment_factors });
  update({ procedure });

  onStep("ui_graph");
  const ui_graph = await post<Graph>("p1/ui-graph", { learning_goal_graph, learning_goal, procedure });
  update({ ui_graph: [ui_graph] });

  onStep("simulation_code_1");
  const html = await post<string>("p1/simulation-code", { ui_graph, learning_goal });
  update({ simulation_code: [version("simulation_code_1", html, "generated from UI graph")], current_code_id: "simulation_code_1", verified: false });
  return { ui_graph, simulation_code: html };
}

/** Process 3: headless error check, fix, test generation, test run, evaluation, repair, live render. */
export async function runVerify(simulation_code_1: string, ui_graph: Graph, learning_goal: string, update: Update, onStep: OnStep) {
  update({ javascript_errors: undefined, test_cases: undefined, test_results: undefined, test_screenshots: undefined, test_assessment: undefined, verified: false });

  onStep("javascript_errors");
  const javascript_errors = await post<string[]>("p3/javascript-errors", { simulation_code: simulation_code_1 });
  update({ javascript_errors });

  onStep("simulation_code_2");
  const code2 = await post<string>("p3/fix-errors", { simulation_code: simulation_code_1, ui_graph, learning_goal, javascript_errors });
  update((p) => ({
    simulation_code: [...p.simulation_code.filter((c) => c.id === "simulation_code_1"), version("simulation_code_2", code2, `fixed ${javascript_errors.length} JS error(s)`)],
    current_code_id: "simulation_code_2",
  }));

  onStep("test_cases");
  const test_cases = await post<TestCase[]>("p3/test-cases", { simulation_code: code2, ui_graph, learning_goal });
  update({ test_cases });

  onStep("test_results");
  const { results: test_results, screenshots: test_screenshots } = await post<{ results: TestResult[]; screenshots: string[] }>("p3/run-tests", {
    simulation_code: code2,
    test_cases,
  });
  update({ test_results, test_screenshots });

  onStep("test_assessment");
  const test_assessment = await post<string>("p3/evaluate", { simulation_code: code2, ui_graph, learning_goal, test_cases, test_results, test_screenshots });
  update({ test_assessment });

  onStep("simulation_code_3");
  const code3 = await post<string>("p3/repair", { simulation_code: code2, ui_graph, test_cases, test_assessment });
  update((p) => ({
    simulation_code: [...p.simulation_code.filter((c) => c.id !== "simulation_code_3"), version("simulation_code_3", code3, "repaired from test assessment")],
    current_code_id: "simulation_code_3",
    verified: true,
  }));
  onStep("simulation"); // tool_1 execute happens when the workspace renders the code
}
