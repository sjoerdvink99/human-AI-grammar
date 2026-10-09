// Process 2: approach → plan → script, with a feedback/revision loop.
// (r2 + r3) → [model_1 generate]~ → r6 → [human specify] → r7 → [model_1 extract] → r8 + r9
//   → [model_1 generate]~ → r10 → [human evaluate] → r10 + r11 → [model_1 modify]~ → r10 …
import { useEffect, useRef, useState } from "react";
import type { Outline, StyleSpec } from "../../../shared/types.ts";
import { post } from "../api.ts";
import type { StepProps } from "../App.tsx";
import { requestText, useBusy } from "../state.ts";
import { Pipeline, Prose } from "../components/Pipeline.tsx";

export function ScriptStep({ project, update }: StepProps) {
  const { busy, error, run } = useBusy();
  const [stage, setStage] = useState(-1);
  const [feedback, setFeedback] = useState("");
  const [viewVersion, setViewVersion] = useState(Math.max(0, project.scriptVersions.length - 1));
  const started = useRef(false);

  const generateApproach = () =>
    run("approach", async () => {
      const { approach } = await post<{ approach: string }>("/api/approach", {
        request: requestText(project.request),
        brief: project.brief,
      });
      update((p) => ({ ...p, approach, approachEdited: approach }));
    });

  // Triggered by entering the step with a complete brief and no approach yet.
  useEffect(() => {
    if (!project.approach && !started.current) {
      started.current = true;
      generateApproach();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeScript = () =>
    run("script", async () => {
      setStage(0);
      const plan = await post<{ styleSpec: StyleSpec; outline: Outline }>("/api/plan", { approach: project.approachEdited });
      update((p) => ({ ...p, ...plan }));
      setStage(1);
      const { script } = await post<{ script: string }>("/api/script", plan);
      update((p) => ({
        ...p,
        scriptVersions: [...p.scriptVersions, { text: script, createdAt: new Date().toISOString() }],
        activeScript: p.scriptVersions.length,
      }));
      setViewVersion(project.scriptVersions.length);
    }).finally(() => setStage(-1));

  const revise = () =>
    run("revise", async () => {
      const current = project.scriptVersions[viewVersion];
      const { script } = await post<{ script: string }>("/api/script/revise", { script: current.text, feedback });
      update((p) => {
        const versions = p.scriptVersions.map((v, i) => (i === viewVersion ? { ...v, feedback } : v));
        return {
          ...p,
          scriptVersions: [...versions, { text: script, createdAt: new Date().toISOString() }],
          activeScript: versions.length,
        };
      });
      setViewVersion(project.scriptVersions.length);
      setFeedback("");
    });

  const versions = project.scriptVersions;
  const shown = versions[viewVersion];

  return (
    <section className="step">
      <header>
        <h2>2 · Script</h2>
        <p className="hint">Edit the proposed approach until it is yours, then let the assistant plan and write the script. Comment on the draft to revise it.</p>
      </header>

      <div className="two-col">
        <div className="col">
          <div className="card">
            <div className="card-head">
              <h3>Approach</h3>
              <span className="actions">
                {project.approach && project.approachEdited !== project.approach && (
                  <button className="link" onClick={() => update((p) => ({ ...p, approachEdited: p.approach }))}>
                    Reset to proposal
                  </button>
                )}
                <button className="link" disabled={busy.approach} onClick={generateApproach}>
                  ↻ New proposal
                </button>
              </span>
            </div>
            {busy.approach ? (
              <div className="skeleton">Drafting an approach…</div>
            ) : (
              <textarea
                className="approach"
                rows={14}
                value={project.approachEdited}
                onChange={(e) => update((p) => ({ ...p, approachEdited: e.target.value }))}
              />
            )}
            {project.approach && project.approachEdited !== project.approach && <p className="muted small">Edited by you</p>}
            <button className="primary wide" disabled={!project.approachEdited.trim() || busy.script || busy.approach} onClick={writeScript}>
              {versions.length ? "Re-plan & write new draft" : "Plan & write script"}
            </button>
            {stage >= 0 && (
              <Pipeline
                current={stage}
                steps={[
                  { label: "Extract style spec & outline", actor: "model_1 extract" },
                  { label: "Write script", actor: "model_1 generate" },
                ]}
              />
            )}
          </div>

          {project.styleSpec && project.outline && (
            <div className="card">
              <h3>Plan</h3>
              <div className="chips">
                <span className="chip">tone: {project.styleSpec.tone}</span>
                <span className="chip">{project.styleSpec.register}</span>
                <span className="chip">{project.styleSpec.audienceLevel} audience</span>
                <span className="chip">~{project.styleSpec.targetWords} words</span>
                {project.styleSpec.mustInclude.map((m) => (
                  <span key={m} className="chip include">+ {m}</span>
                ))}
                {project.styleSpec.avoid.map((m) => (
                  <span key={m} className="chip avoid">− {m}</span>
                ))}
              </div>
              <ol className="outline">
                {project.outline.sections.map((s, i) => (
                  <li key={i}>
                    <strong>{s.title}</strong> <span className="muted">~{s.seconds}s</span>
                    <ul>
                      {s.keyPoints.map((k, j) => (
                        <li key={j}>{k}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="col">
          <div className="card">
            <div className="card-head">
              <h3>Script</h3>
              {versions.length > 0 && (
                <span className="tabs">
                  {versions.map((_, i) => (
                    <button key={i} className={i === viewVersion ? "tab active" : "tab"} onClick={() => setViewVersion(i)}>
                      v{i + 1}
                    </button>
                  ))}
                </span>
              )}
            </div>
            {busy.script && <div className="skeleton">Writing…</div>}
            {!shown && !busy.script && <p className="muted">No script yet.</p>}
            {shown && (
              <>
                <div className="script">
                  <Prose text={shown.text} />
                </div>
                <p className="muted small">
                  {shown.text.split(/\s+/).length} words · ~{Math.round((shown.text.split(/\s+/).length / 140) * 60)} s at 140 wpm
                  {shown.feedback && <> · revised with: “{shown.feedback}”</>}
                </p>
                <label className="field">
                  <span>Your feedback on v{viewVersion + 1}</span>
                  <textarea
                    rows={3}
                    value={feedback}
                    placeholder="e.g. Make the opening funnier and cut the second story."
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </label>
                <div className="row">
                  <button disabled={!feedback.trim() || busy.revise} onClick={revise}>
                    {busy.revise ? "Revising…" : "Revise script"}
                  </button>
                  <span className="spacer" />
                  <button
                    className="primary"
                    disabled={busy.revise}
                    onClick={() => update((p) => ({ ...p, activeScript: viewVersion, step: 2 }))}
                  >
                    Use v{viewVersion + 1} → Voice
                  </button>
                </div>
              </>
            )}
            {error && <div className="error">{error}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
