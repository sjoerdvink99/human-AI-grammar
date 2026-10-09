// Process 1: brief intake loop.
// (r1 + r2) → [model_1 extract] → r3 → [tool_1 evaluate] → r4 → [model_1 generate]~ → r5 → [human specify] → r2 …
import { useState } from "react";
import type { Brief, BriefStatus, BriefTemplate } from "../../../shared/types.ts";
import { post } from "../api.ts";
import type { StepProps } from "../App.tsx";
import { requestText, useBusy } from "../state.ts";
import { Pipeline, type PipelineStep } from "../components/Pipeline.tsx";

export function BriefStep({ project, update }: StepProps) {
  const [draft, setDraft] = useState("");
  const [stage, setStage] = useState<number>(-1);
  const [showTemplate, setShowTemplate] = useState(false);
  const { busy, error, run } = useBusy();
  const status = project.briefStatus;

  const pipeline: PipelineStep[] = [
    { label: "Extract brief", actor: "model_1 extract" },
    { label: "Check completeness", actor: "tool_1 evaluate" },
    { label: "Write follow-up", actor: "model_1 generate" },
  ];

  /** One round of the loop, triggered by the human specifying (sending a message). */
  const send = () =>
    run("round", async () => {
      const text = draft.trim();
      if (!text) return;
      const request = [...project.request, { from: "user" as const, text }];
      update((p) => ({ ...p, request }));
      setDraft("");
      const r2 = requestText(request);
      setStage(0);
      const brief = await post<Brief>("/api/brief/extract", { template: project.template, request: r2 });
      update((p) => ({ ...p, brief }));
      setStage(1);
      const briefStatus = await post<BriefStatus>("/api/brief/check", { template: project.template, brief });
      update((p) => ({ ...p, briefStatus }));
      setStage(2);
      const { followUp } = await post<{ followUp: string }>("/api/brief/follow-up", {
        template: project.template,
        request: r2,
        brief,
        status: briefStatus,
      });
      update((p) => ({ ...p, request: [...request, { from: "assistant", text: followUp }] }));
      setStage(3);
    }).finally(() => setStage(-1));

  return (
    <section className="step">
      <header>
        <h2>1 · Brief</h2>
        <p className="hint">
          Describe the speech you need. The assistant extracts a brief, checks it against the template, and asks about anything missing.
        </p>
      </header>

      <div className="two-col">
        <div className="col">
          <div className="chat">
            {project.request.length === 0 && (
              <div className="empty">
                e.g. “I'm giving a toast at my sister's wedding next month, about 3 minutes. I want it funny but heartfelt…”
              </div>
            )}
            {project.request.map((m, i) => (
              <div key={i} className={`bubble ${m.from}`}>
                {m.text}
              </div>
            ))}
          </div>
          {stage >= 0 && <Pipeline steps={pipeline} current={stage} />}
          {error && <div className="error">{error}</div>}
          <div className="composer">
            <textarea
              value={draft}
              placeholder={project.request.length ? "Answer the question or add details…" : "Describe your speech…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              rows={3}
            />
            <button className="primary" disabled={busy.round || !draft.trim()} onClick={send}>
              {busy.round ? "Working…" : "Send"}
            </button>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-head">
              <h3>Extracted brief</h3>
              {status && (
                <span className={`badge ${status.status}`} title="tool_1 evaluate">
                  {status.status}
                </span>
              )}
            </div>
            {!project.brief ? (
              <p className="muted">Nothing extracted yet.</p>
            ) : (
              <table className="kv">
                <tbody>
                  {project.template.map((f) => (
                    <tr key={f.key} className={status?.missing.includes(f.key) ? "missing" : ""}>
                      <th>
                        {f.label}
                        {f.required && <span className="req">*</span>}
                      </th>
                      <td>{project.brief![f.key] ?? <em>missing</em>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              className="primary wide"
              disabled={status?.status !== "complete"}
              title={status?.status !== "complete" ? "The brief needs all required fields" : ""}
              onClick={() => update((p) => ({ ...p, step: 1 }))}
            >
              Continue to script →
            </button>
          </div>

          <div className="card">
            <button className="link" onClick={() => setShowTemplate((s) => !s)}>
              {showTemplate ? "▾" : "▸"} Brief template (r1)
            </button>
            {showTemplate && <TemplateEditor template={project.template} onChange={(template) => update((p) => ({ ...p, template }))} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function TemplateEditor({ template, onChange }: { template: BriefTemplate; onChange: (t: BriefTemplate) => void }) {
  const set = (i: number, patch: Partial<BriefTemplate[number]>) => onChange(template.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="template">
      {template.map((f, i) => (
        <div key={i} className="template-row">
          <input
            value={f.label}
            onChange={(e) => set(i, { label: e.target.value, key: f.key || e.target.value.replace(/\W+/g, "_").toLowerCase() })}
          />
          <input value={f.description} onChange={(e) => set(i, { description: e.target.value })} />
          <label>
            <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} /> required
          </label>
          <button className="link" onClick={() => onChange(template.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button
        className="link"
        onClick={() => onChange([...template, { key: `field_${template.length + 1}`, label: "New field", description: "", required: false }])}
      >
        + Add field
      </button>
    </div>
  );
}
