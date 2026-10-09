import { useEffect } from "react";
import type { BriefTemplate } from "../../shared/types.ts";
import { get } from "./api.ts";
import { emptyProject, usePersistentProject, type Project } from "./state.ts";
import { BriefStep } from "./steps/BriefStep.tsx";
import { ScriptStep } from "./steps/ScriptStep.tsx";
import { VoiceStep } from "./steps/VoiceStep.tsx";
import { ReviewStep } from "./steps/ReviewStep.tsx";

const STEPS = [
  { title: "Brief", sub: "Describe the speech" },
  { title: "Script", sub: "Approach, outline, draft" },
  { title: "Voice", sub: "Settings & first take" },
  { title: "Review & coach", sub: "Listen, feedback, re-take" },
];

export interface StepProps {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
}

export function App() {
  const [project, update, setProject] = usePersistentProject();

  useEffect(() => {
    if (!project) get<BriefTemplate>("/api/template").then((t) => setProject(emptyProject(t)));
  }, [project, setProject]);

  if (!project) return <div className="loading-page">Loading…</div>;

  const reachable = [
    true,
    project.briefStatus?.status === "complete" || !!project.approach,
    project.scriptVersions.length > 0,
    project.takes.length > 0,
  ];

  const restart = () => {
    if (confirm("Start a new speech? The current project will be discarded.")) get<BriefTemplate>("/api/template").then((t) => setProject(emptyProject(t)));
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Speech Studio</h1>
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                className={project.step === i ? "active" : ""}
                disabled={!reachable[i]}
                onClick={() => update((p) => ({ ...p, step: i as Project["step"] }))}
              >
                <span className="num">{i + 1}</span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.sub}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {project.brief && (
          <div className="side-brief">
            <h3>Brief</h3>
            <dl>
              {project.template.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd className={project.brief![f.key] ? "" : "missing"}>{project.brief![f.key] ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <button className="link restart" onClick={restart}>
          New speech
        </button>
      </aside>
      <main className="main">
        {project.step === 0 && <BriefStep project={project} update={update} />}
        {project.step === 1 && <ScriptStep project={project} update={update} />}
        {project.step === 2 && <VoiceStep project={project} update={update} />}
        {project.step === 3 && <ReviewStep project={project} update={update} />}
      </main>
    </div>
  );
}
