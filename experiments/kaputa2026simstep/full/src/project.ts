// Application state: one field per design representation (identifier without version).
// Versioned representations keep every version so earlier rounds can be compared or reverted.
import type {
  CodeVersion,
  ExperimentFactors,
  Graph,
  GraphLevel,
  TestAssessment,
  TestCase,
  TestResult,
} from '../shared/types';

export interface Project {
  learning_content: string;
  concept_graph: Graph[];
  scenarios: string[];
  scenario: string | null;
  scenario_graph: Graph[];
  learning_goals: string[];
  learning_goal: string | null;
  learning_goal_graph: Graph[];
  experiment_factors: ExperimentFactors | null;
  procedure: string | null;
  ui_graph: Graph[];
  simulation_code: CodeVersion[];
  current_code_id: string | null;
  javascript_errors: string[];
  test_cases: TestCase[];
  test_results: TestResult[];
  test_screenshots: { test_id: string; dataUrl: string }[];
  test_assessment: TestAssessment | null;
  log: { t: number; msg: string }[];
}

export const emptyProject = (): Project => ({
  learning_content: '',
  concept_graph: [],
  scenarios: [],
  scenario: null,
  scenario_graph: [],
  learning_goals: [],
  learning_goal: null,
  learning_goal_graph: [],
  experiment_factors: null,
  procedure: null,
  ui_graph: [],
  simulation_code: [],
  current_code_id: null,
  javascript_errors: [],
  test_cases: [],
  test_results: [],
  test_screenshots: [],
  test_assessment: null,
  log: [],
});

export const GRAPH_LEVELS: { key: GraphLevel; title: string }[] = [
  { key: 'concept_graph', title: 'Concept Graph' },
  { key: 'scenario_graph', title: 'Scenario Graph' },
  { key: 'learning_goal_graph', title: 'Learning Goal Graph' },
  { key: 'ui_graph', title: 'UI Graph' },
];

export const latest = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

export function currentCode(p: Project): CodeVersion | undefined {
  return p.simulation_code.find((c) => c.id === p.current_code_id) ?? latest(p.simulation_code);
}

const KEY = 'system-x-project';
export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyProject(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return emptyProject();
}
export function saveProject(p: Project) {
  try {
    // screenshots are large; they are kept in memory only
    localStorage.setItem(KEY, JSON.stringify({ ...p, test_screenshots: [] }));
  } catch {
    /* quota exceeded: keep in memory */
  }
}
