import type { StepProps } from "../App.tsx";
import { ErrorNote, Panel, Spinner, SvgView } from "../components.tsx";
import { generateVariant, runProcess5 } from "../pipelines.ts";
import { fmt } from "../tools/profile.ts";
import type { Variant } from "../types.ts";

export default function VariantsStep({ state, update, go }: StepProps) {
  const busy = state.crops.some((c) => c.descStatus === "pending") || state.r19.some((v) => v.status === "pending");
  const setPrompt = (id: string, prompt: string) => update((s) => ({ ...s, r19: s.r19.map((v) => (v.id === id ? { ...v, prompt } : v)) }));
  const restore = (v: Variant, i: number) =>
    update((s) => ({
      ...s,
      r19: s.r19.map((x) => (x.id === v.id ? { ...x, svg: x.history[i], history: [...x.history.filter((_, j) => j !== i), ...(x.svg ? [x.svg] : [])] } : x)),
    }));

  return (
    <div className="step">
      <h2>4 · Element variants</h2>
      <p className="lead">
        Each object labelled as a <b>mark</b> is cut out <code className="tag">r15</code>, described by a model{" "}
        <code className="tag">r17</code>, and redrawn once per category of its field <code className="tag">r19</code>. Edit any
        prompt <code className="tag">r18</code> and regenerate until the set looks right.
      </p>
      <div className="cta left">
        <button className="primary" disabled={busy} onClick={() => runProcess5(state, update)}>
          {state.crops.length ? "Rebuild all variants" : "Cut out & generate variants"}
        </button>
        {busy && <Spinner label="Working (model_4 / model_5)…" />}
      </div>
      {state.crops.map((c) => {
        const variants = state.r19.filter((v) => v.segmentId === c.segmentId);
        return (
          <Panel key={c.segmentId} title={`${c.name} → ${c.field}`} tag="r15 · r16 · r17 → r18* · r19*">
            <div className="croprow">
              <div className="crop">
                <SvgView svg={c.svg} />
                <span className="muted small">
                  {fmt(c.bbox.w)}×{fmt(c.bbox.h)} at ({fmt(c.bbox.x)}, {fmt(c.bbox.y)})
                </span>
              </div>
              <div className="prose small">
                {c.descStatus === "pending" ? <Spinner label="Describing (model_4)…" /> : c.description}
                {c.descStatus === "error" && <span className="error"> description failed; using the name instead</span>}
              </div>
            </div>
            <div className="gallery variants">
              {variants.map((v) => (
                <div key={v.id} className="card">
                  <h4>{v.category}</h4>
                  <div className="variant-img">
                    {v.status === "pending" && <Spinner label="Drawing (model_5)…" />}
                    {v.status === "error" && <ErrorNote msg={v.error ?? "failed"} />}
                    {v.svg && v.status !== "pending" && <SvgView svg={v.svg} />}
                  </div>
                  {v.history.length > 0 && (
                    <div className="history">
                      {v.history.map((h, i) => (
                        <button key={i} title="Restore this earlier version" onClick={() => restore(v, i)}>
                          <SvgView svg={h} />
                        </button>
                      ))}
                    </div>
                  )}
                  <details>
                    <summary className="muted small">Prompt r18</summary>
                    <textarea rows={6} value={v.prompt} onChange={(e) => setPrompt(v.id, e.target.value)} />
                  </details>
                  <button disabled={v.status === "pending"} onClick={() => generateVariant(update, state.r19.find((x) => x.id === v.id)!)}>
                    Regenerate
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}
      <div className="cta">
        <button className="primary" disabled={!state.r19.some((v) => v.svg)} onClick={() => go(4)}>
          Build charts →
        </button>
      </div>
    </div>
  );
}
