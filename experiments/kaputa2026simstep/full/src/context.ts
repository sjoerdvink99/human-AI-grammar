import { createContext, useContext } from 'react';
import type { Project } from './project';
import type { Graph, GraphLevel, Subgraph } from '../shared/types';
import type { MarkMode } from './components/SimulationView';

export interface AppCtx {
  project: Project;
  setProject: (fn: (p: Project) => Project) => void;
  busy: string | null;
  /** run an async step with a busy label and error reporting */
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  log: (msg: string) => void;
  addCode: (labelBase: string, html: string, note: string) => void;
  addGraphVersion: (level: GraphLevel, g: Graph) => void;
  frameRef: React.RefObject<HTMLIFrameElement>;
  reloadSimulation: () => void;
  markMode: MarkMode;
  setMarkMode: (m: MarkMode) => void;
  selectedUiNode: string | null;
  setSubgraph: (s: Subgraph | null) => void;
  showGraph: (level: GraphLevel) => void;
  runAutomatedTesting: (code_1_html: string, ui_graph: Graph, learning_goal: string) => Promise<void>;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
