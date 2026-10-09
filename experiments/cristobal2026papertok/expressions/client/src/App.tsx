import { useCallback, useEffect, useState } from "react";
import { api, type ProjectView } from "./api.ts";
import { PaperPanel, ScriptPanel, VoicePanel, ScenesPanel, CreditsPanel } from "./panels.tsx";

export interface Ctx {
  project: ProjectView;
  setProject: (p: ProjectView) => void;
  busy: string | null;
  /** Run an action with a busy label; errors are shown in the banner. */
  run: (label: string, fn: () => Promise<ProjectView | void>) => Promise<boolean>;
}

export function App() {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (id: string) => {
    try {
      setProject(await api.get(id));
      location.hash = id;
    } catch {
      location.hash = "";
    }
  }, []);

  useEffect(() => {
    api.list().then(setProjects).catch(() => {});
    if (location.hash.length > 1) open(location.hash.slice(1));
  }, [open]);

  // Poll while scenes are rendering in the background.
  const rendering = project && Object.values(project.sceneStatus).some((s) => s === "rendering");
  useEffect(() => {
    if (!rendering || !project) return;
    const t = setInterval(() => api.get(project.id).then(setProject).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [rendering, project?.id]);

  const run: Ctx["run"] = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      const p = await fn();
      if (p) setProject(p);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const newProject = () => run("Creating project", async () => {
    const p = await api.create();
    location.hash = p.id;
    return p;
  });

  return (
    <div className="app">
      <header>
        <h1>Paper → Video</h1>
        <span className="sub">Turn a research paper into a narrated short explainer</span>
        <div className="spacer" />
        <select value={project?.id ?? ""} onChange={(e) => e.target.value && open(e.target.value)}>
          <option value="">Open project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title} ({p.createdAt.slice(0, 10)})</option>
          ))}
        </select>
        <button onClick={newProject}>New project</button>
      </header>
      {busy && <div className="banner busy"><span className="spinner" /> {busy}…</div>}
      {error && <div className="banner error" onClick={() => setError(null)}>{error} <small>(click to dismiss)</small></div>}
      {!project ? (
        <div className="empty">
          <p>Start a new project and upload a paper.</p>
          <button className="primary" onClick={newProject}>New project</button>
        </div>
      ) : (
        <Workspace ctx={{ project, setProject, busy, run }} />
      )}
    </div>
  );
}

function Workspace({ ctx }: { ctx: Ctx }) {
  const p = ctx.project;
  return (
    <main>
      <PaperPanel ctx={ctx} />
      {p.script && <ScriptPanel ctx={ctx} />}
      {p.script && <VoicePanel ctx={ctx} />}
      {p.voiceStyle && <ScenesPanel ctx={ctx} />}
      {p.scenes?.some((s) => s.clip) && <CreditsPanel ctx={ctx} />}
    </main>
  );
}
