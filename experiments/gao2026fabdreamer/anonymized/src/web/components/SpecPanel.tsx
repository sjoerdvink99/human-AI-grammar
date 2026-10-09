// P3: r3 → [model_1 generate]~ → r5; r6 → [model_1 modify]~ → r5 (loop: "Revise again").
import { useState } from "react";
import { useApp, currentConcept, currentSpec } from "../store";
import { p3GenerateSpec, p3ReviseSpec } from "../pipelines";
import { Empty, Status, Step, SvgImage } from "./common";
import type { Spec } from "../../shared/types";

export function SpecView({ spec }: { spec: Spec }) {
  return (
    <div className="spec">
      <h2>{spec.name} <small>{spec.category}</small></h2>
      <p>{spec.summary}</p>
      <dl>
        <dt>Overall size</dt><dd>{spec.dimensions.w} × {spec.dimensions.h} × {spec.dimensions.d} mm (w × h × d)</dd>
        <dt>Materials</dt><dd>{spec.materials.join(", ")}</dd>
        <dt>Style</dt><dd>{spec.style}</dd>
      </dl>
      <table>
        <thead><tr><th>Part</th><th>Count</th><th>Material</th><th>Description</th></tr></thead>
        <tbody>{spec.parts.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.count}</td><td>{p.material}</td><td>{p.description}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function SpecPanel() {
  const s = useApp();
  const concept = currentConcept(s);
  const spec = currentSpec(s);
  const [feedback, setFeedback] = useState("");

  if (!concept) return <div className="panel"><Empty>Select a concept in step 1 first.</Empty></div>;
  return (
    <div className="panel two-col">
      <div>
        <Step id="r3" actor="human" title="Concept">
          <SvgImage svg={concept.svg} size={320} className="hero" />
        </Step>
      </div>
      <div>
        <Step id="r3 → r5" actor="model_1" title="Design specification">
          <div className="row">
            <button className={spec ? "" : "primary"} disabled={!!s.busy.p3} onClick={() => p3GenerateSpec()}>{spec ? "Regenerate spec" : "Generate spec"}</button>
            <Status k="p3" />
          </div>
          {spec ? <SpecView spec={spec} /> : <Empty>The spec describes size, materials and part types.</Empty>}
          {s.spec.length > 1 && (
            <div className="versions">
              {s.spec.map((_, i) => <button key={i} className={i === s.specIndex ? "chip active" : "chip"} onClick={() => s.set({ specIndex: i })}>r5 round {i + 1}</button>)}
            </div>
          )}
        </Step>
        {spec && (
          <Step id="r5 + r6 → r5" actor="model_1" title="Give feedback on the spec">
            <textarea rows={2} placeholder="e.g. make it 450 mm tall and use oak instead of pine" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="row">
              <button className="primary" disabled={!feedback.trim() || !!s.busy.p3} onClick={() => p3ReviseSpec(feedback.trim()).then(() => setFeedback(""))}>
                {s.spec.length > 1 ? "Revise again" : "Revise spec"}
              </button>
              <button onClick={() => s.set({ tab: "parts" })}>Next: parts →</button>
            </div>
          </Step>
        )}
      </div>
    </div>
  );
}
