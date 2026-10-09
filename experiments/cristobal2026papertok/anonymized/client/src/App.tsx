import { useCallback, useEffect, useState } from "react";
import { api, type Project } from "./api.ts";
import SourceView from "./views/SourceView.tsx";
import ConceptsView from "./views/ConceptsView.tsx";
import ScriptView from "./views/ScriptView.tsx";
import ScenesView from "./views/ScenesView.tsx";
import ExportView from "./views/ExportView.tsx";

export type Act = (fn: () => Promise<Project>) => Promise<void>;
type Tab = "source" | "concepts" | "script" | "scenes" | "export";

const TABS: { id: Tab; label: string; hint: string; enabled: (p: Project) => boolean }[] = [
  { id: "source", label: "1 · Source", hint: "the document", enabled: () => true },
  { id: "concepts", label: "2 · Concepts", hint: "find video ideas", enabled: (p) => !!p.paper },
  { id: "script", label: "3 · Script", hint: "concept & narration", enabled: (p) => !!p.concept },
  { id: "scenes", label: "4 · Scenes", hint: "voice & visuals", enabled: (p) => !!p.script },
  { id: "export", label: "5 · Export", hint: "title & video", enabled: (p) => p.scenes.some((s) => s.audio && s.image) },
];

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("source");
  const [voices, setVoices] = useState<string[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    api.project().then((p) => {
      setProject(p);
      const last = [...TABS].reverse().find((t) => t.enabled(p));
      if (last) setTab(last.id);
    });
    api.voices().then((v) => setVoices(v.voices));
  }, []);

  // poll while a background job runs
  useEffect(() => {
    if (!project?.busy) return;
    const t = setInterval(() => api.project().then(setProject).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [project?.busy]);

  const act: Act = useCallback(async (fn) => {
    setClientError(null);
    try {
      setProject(await fn());
    } catch (e) {
      setClientError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (!project) return <div className="loading">Loading…</div>;
  const busy = project.busy;
  const error = clientError || project.error;

  return (
    <div className="app">
      <nav className="rail">
        <h1>Paper → Video</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            disabled={!t.enabled(project)}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            <small>{t.hint}</small>
          </button>
        ))}
        <div className="spacer" />
        <button
          className="link"
          disabled={!!busy}
          onClick={() => confirm("Start over? This clears the current project.") && act(api.reset).then(() => setTab("source"))}
        >
          Start over
        </button>
      </nav>
      <main>
        {busy && (
          <div className="banner busy">
            <span className="spinner" /> {busy.step}: {busy.message}
          </div>
        )}
        {error && (
          <div className="banner error" onClick={() => setClientError(null)}>
            {error}
          </div>
        )}
        {tab === "source" && <SourceView project={project} act={act} next={() => setTab("concepts")} />}
        {tab === "concepts" && <ConceptsView project={project} act={act} next={() => setTab("script")} />}
        {tab === "script" && <ScriptView project={project} act={act} next={() => setTab("scenes")} />}
        {tab === "scenes" && <ScenesView project={project} act={act} voices={voices} next={() => setTab("export")} />}
        {tab === "export" && <ExportView project={project} act={act} />}
      </main>
    </div>
  );
}
