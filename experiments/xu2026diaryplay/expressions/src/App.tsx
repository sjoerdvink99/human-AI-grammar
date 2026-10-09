import { useEffect, useRef, useState } from "react";
import type { Project } from "./shared/types";
import WorldTab from "./components/WorldTab";
import CharactersTab from "./components/CharactersTab";
import PlotTab from "./components/PlotTab";
import PlayView from "./components/PlayView";

const STORAGE_KEY = "system-x-project-v1";

export const EMPTY_PROJECT: Project = {
  story: "",
  characters: [],
  layoutId: null,
  roomLabels: [],
  objects: [],
  environment: null,
  activities: [],
  events: [],
  vignette: null,
};

function load(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY_PROJECT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return EMPTY_PROJECT;
}

export type Update = (patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;

const TABS = [
  { id: "world", label: "1 · World" },
  { id: "characters", label: "2 · Characters" },
  { id: "plot", label: "3 · Plot" },
  { id: "play", label: "4 · Play" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [project, setProject] = useState<Project>(load);
  const [tab, setTab] = useState<TabId>("world");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const update: Update = (patch) => setProject((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.vignette?.title || "vignette"}.json`;
    a.click();
  };
  const importJson = async (f: File) => {
    try {
      setProject({ ...EMPTY_PROJECT, ...JSON.parse(await f.text()) });
    } catch {
      alert("Not a valid project file.");
    }
  };

  const enabled: Record<TabId, boolean> = {
    world: true,
    characters: !!project.environment,
    plot: !!project.environment && project.characters.length > 0,
    play: !!project.vignette,
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Story → Vignette</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "tab active" : "tab"}
              disabled={!enabled[t.id]}
              onClick={() => setTab(t.id)}
              title={enabled[t.id] ? "" : "Finish the previous step first"}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <button onClick={exportJson}>Export</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button
            className="danger"
            onClick={() => {
              if (confirm("Start a new project? The current one is discarded (export it first if needed).")) {
                setProject(EMPTY_PROJECT);
                setTab("world");
              }
            }}
          >
            New
          </button>
        </div>
      </header>
      <main>
        {tab === "world" && <WorldTab project={project} update={update} next={() => setTab("characters")} />}
        {tab === "characters" && <CharactersTab project={project} update={update} next={() => setTab("plot")} />}
        {tab === "plot" && <PlotTab project={project} update={update} next={() => setTab("play")} />}
        {tab === "play" && project.vignette && <PlayView vignette={project.vignette} />}
      </main>
    </div>
  );
}
