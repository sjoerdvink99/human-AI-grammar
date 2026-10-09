import { createContext, useContext, useEffect, useReducer, useState, type Dispatch } from "react";
import { addSnapshot, composeSceneSpec } from "../shared/compose";
import { renderScene } from "../shared/render";
import type { Snapshot, VisualElement } from "../shared/types";
import { generateElements } from "./api";
import { ChartPanel } from "./components/ChartPanel";
import { CutoutPanel } from "./components/CutoutPanel";
import { GalleryPanel } from "./components/GalleryPanel";
import { IllustratePanel } from "./components/IllustratePanel";
import { ScenePanel } from "./components/ScenePanel";
import { SourcesPanel } from "./components/SourcesPanel";
import { initialState, loadState, reducer, saveState, type Action, type AppState } from "./state";

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<Action> }>(null as any);
export const useApp = () => useContext(Ctx);

/**
 * tool_1 compose → tool_2 execute → tool_7 compose.
 * Shared by process 1 (after model_1) and process 3 (after the human edits, closing the loop).
 */
export function renderAndSnapshot(elements: VisualElement[], snapshots: Snapshot[], critique?: string) {
  const spec = composeSceneSpec(elements); // r5
  const scene = renderScene(spec); // r6
  return { scene, snapshots: addSnapshot(snapshots, scene, critique) }; // r7*
}

const TABS = [
  { id: "scene", label: "Scene", hint: "P1 · P2 · P3" },
  { id: "illustrate", label: "Illustrate", hint: "P4" },
  { id: "chart", label: "Chart", hint: "P5" },
  { id: "pictorial", label: "Pictorial chart", hint: "P6 · P7" },
  { id: "gallery", label: "Gallery", hint: "P8" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState, loadState);
  const [tab, setTab] = useState<Tab>("scene");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => saveState(state), 300);
    return () => clearTimeout(t);
  }, [state]);

  /** Process 1: [model_1 generate]~ then the tool chain. */
  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { elements } = await generateElements(state.brief, state.styleRefs, state.documents);
      const { scene, snapshots } = renderAndSnapshot(elements, state.snapshots);
      dispatch({ type: "set", patch: { elements, scene, snapshots, elementsDirty: false, selectedElementId: null, critique: "" } });
      setTab("scene");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Ctx.Provider value={{ state, dispatch }}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">◈</span> System X <span className="sub">pictorial infographic studio</span>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
                {t.label} <span className="hint">{t.hint}</span>
              </button>
            ))}
          </nav>
          <button
            className="ghost small"
            onClick={() => {
              if (confirm("Clear everything (sources, elements, gallery, charts)?")) dispatch({ type: "set", patch: initialState });
            }}
          >
            Reset
          </button>
        </header>
        <div className="body">
          <SourcesPanel onGenerate={generate} busy={busy} error={error} />
          <main className="workspace">
            {tab === "scene" && <ScenePanel busy={busy} />}
            {tab === "illustrate" && <IllustratePanel />}
            {tab === "chart" && <ChartPanel />}
            {tab === "pictorial" && <CutoutPanel />}
            {tab === "gallery" && <GalleryPanel />}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
