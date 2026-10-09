import { useEffect, useState } from "react";
import { api, type Concept, type Project } from "../api.ts";
import type { Act } from "../App.tsx";

/** Process 2 (r9…r12) and process 3 (human modify r8). */
export default function ScriptView({ project, act, next }: { project: Project; act: Act; next: () => void }) {
  const p = project;
  const questions = p.questions.split("\n").filter(Boolean);
  const [answers, setAnswers] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  useEffect(() => setAnswers(questions.map(() => "")), [p.questions]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <header>
        <h2>Concept &amp; script</h2>
        <p className="muted">Refine the chosen concept, answer the model's questions, then let it write the narration.</p>
      </header>
      <div className="two-col">
        <ConceptEditor project={p} act={act} />
        <div>
          <div className="panel">
            <h3>Questions from the script writer</h3>
            {!questions.length && p.busy?.step === "Clarify" && <p className="muted">Thinking of questions…</p>}
            {!questions.length && !p.busy && (
              <button className="secondary" onClick={() => act(api.askAgain)}>
                Ask questions
              </button>
            )}
            {questions.map((q, i) => (
              <label key={q} className="field">
                <span>{q}</span>
                <input
                  value={answers[i] ?? ""}
                  onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder="Your answer (optional)"
                />
              </label>
            ))}
            {questions.length > 0 && (
              <>
                <label className="field">
                  <span>Anything else the script should do?</span>
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <div className="row">
                  <button disabled={!!p.busy} onClick={() => act(() => api.writeScript(answers, notes))}>
                    {p.script ? "Rewrite script" : "Write script"}
                  </button>
                  <button className="secondary" disabled={!!p.busy} onClick={() => act(api.askAgain)}>
                    Ask different questions
                  </button>
                </div>
              </>
            )}
          </div>

          {(p.script || p.busy?.step === "Write script") && (
            <div className="panel">
              <h3>Narration script</h3>
              {p.busy?.step === "Write script" ? (
                <p className="muted">Writing…</p>
              ) : (
                <>
                  <div className="script">
                    {p.script.split(/\n\s*\n/).map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                  <p className="muted small">
                    {p.script.split(/\s+/).length} words · ≈ {Math.round(p.script.split(/\s+/).length / 2.4)}s spoken
                  </p>
                  <details className="small muted">
                    <summary>What the writer was told</summary>
                    <pre>{p.preferences}</pre>
                  </details>
                  <button
                    disabled={!!p.busy}
                    onClick={() => {
                      if (p.scenes.length && !confirm("Re-planning replaces the current scenes. Continue?")) return;
                      act(api.planScenes).then(next);
                    }}
                  >
                    {p.scenes.length ? "Re-plan scenes →" : "Plan scenes →"}
                  </button>
                  {p.scenes.length > 0 && (
                    <button className="secondary" onClick={next}>
                      Go to scenes
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Process 3: [human modify] r8 */
function ConceptEditor({ project, act }: { project: Project; act: Act }) {
  const [c, setC] = useState<Concept>(project.concept!);
  useEffect(() => setC(project.concept!), [project.concept]);
  const dirty = JSON.stringify(c) !== JSON.stringify(project.concept);
  const set = <K extends keyof Concept>(k: K, v: Concept[K]) => setC({ ...c, [k]: v });

  return (
    <div className="panel">
      <h3>Concept</h3>
      <label className="field">
        <span>Title</span>
        <input value={c.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label className="field">
        <span>Audience</span>
        <input value={c.audience} onChange={(e) => set("audience", e.target.value)} />
      </label>
      <label className="field">
        <span>Hook</span>
        <textarea rows={2} value={c.hook} onChange={(e) => set("hook", e.target.value)} />
      </label>
      <label className="field">
        <span>Tone</span>
        <input value={c.tone} onChange={(e) => set("tone", e.target.value)} />
      </label>
      <label className="field">
        <span>Key message</span>
        <textarea rows={2} value={c.keyMessage} onChange={(e) => set("keyMessage", e.target.value)} />
      </label>
      <label className="field">
        <span>Outline (one beat per line)</span>
        <textarea
          rows={6}
          value={c.outline.join("\n")}
          onChange={(e) => set("outline", e.target.value.split("\n"))}
        />
      </label>
      <label className="field">
        <span>Target length (seconds)</span>
        <input type="number" min={20} max={600} value={c.targetSeconds} onChange={(e) => set("targetSeconds", Number(e.target.value))} />
      </label>
      <div className="row">
        <button
          disabled={!dirty || !!project.busy}
          onClick={() => act(() => api.saveConcept({ ...c, outline: c.outline.map((o) => o.trim()).filter(Boolean) }))}
        >
          Save concept
        </button>
        {dirty && (
          <button className="secondary" onClick={() => setC(project.concept!)}>
            Discard edits
          </button>
        )}
      </div>
    </div>
  );
}
