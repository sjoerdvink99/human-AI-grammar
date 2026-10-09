// Application state: one typed field per design representation (identifier without version).
// Versioned representations keep every version in an array.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CodeVersion, ExperimentFactors, Graph, TestCase, TestResult } from "../shared/types";

export interface Project {
  learning_content: string;
  concept_graph: Graph[]; // [concept_graph_1, concept_graph_2 (human-modified)]
  scenarios?: string[];
  scenario?: string;
  scenario_graph?: Graph;
  learning_goals?: string[];
  learning_goal?: string;
  learning_goal_graph?: Graph;
  experiment_factors?: ExperimentFactors;
  procedure?: string;
  ui_graph: Graph[]; // ui_graph_1, ui_graph_2, ...
  simulation_code: CodeVersion[]; // simulation_code_1, _2, _3, *_4 ...
  current_code_id?: string;
  // Process 3 intermediates (kept for review)
  javascript_errors?: string[];
  test_cases?: TestCase[];
  test_results?: TestResult[];
  test_screenshots?: string[];
  test_assessment?: string;
  verified: boolean;
}

export const emptyProject = (): Project => ({
  learning_content: "",
  concept_graph: [],
  ui_graph: [],
  simulation_code: [],
  verified: false,
});

const KEY = "systemx.project.v1";

interface Ctx {
  project: Project;
  update: (patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  reset: () => void;
}
const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...emptyProject(), ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return emptyProject();
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(project));
    } catch {
      // screenshots can exceed quota; persist without them
      localStorage.setItem(KEY, JSON.stringify({ ...project, test_screenshots: undefined }));
    }
  }, [project]);
  const update: Ctx["update"] = (patch) =>
    setProject((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
  const reset = () => setProject(emptyProject());
  return <ProjectContext.Provider value={{ project, update, reset }}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject outside provider");
  return c;
}

export const latest = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

export function currentCode(p: Project): CodeVersion | undefined {
  return p.simulation_code.find((c) => c.id === p.current_code_id) ?? latest(p.simulation_code);
}

/** Next design-style identifier for a new code version, e.g. simulation_code_chat_4. */
export function nextCodeId(p: Project, kind: string): string {
  const n = p.simulation_code.length + 1;
  return kind ? `simulation_code_${kind}_${n}` : `simulation_code_${n}`;
}
