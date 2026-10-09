// P4: select spec parts (r7) → parts (r8*) → notes (r9) → reference + initial 3D parts (r10, r11*)
//     → grounding queries (r12*) → boxes (r13*) → 3D parts (r11_2*) → critique (r14) → edit reference → loop.
import { useEffect, useState } from "react";
import { useApp, currentConcept, currentSpec } from "../store";
import { p4AnotherRound, p4Build, p4RestoreRound, p7Compose } from "../pipelines";
import { AssemblyView } from "./AssemblyView";
import { BoxOverlay, DimInputs, Empty, Status, Step, SvgImage, colorFor } from "./common";
import type { Dim } from "../../shared/types";

export function PartsPanel() {
  const s = useApp();
  const concept = currentConcept(s);
  const spec = currentSpec(s);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [dims, setDims] = useState<Dim>({ w: 400, h: 400, d: 400 });

  useEffect(() => {
    if (!spec) return;
    setChosen(Object.fromEntries(spec.parts.map((p) => [p.name, s.partSelection ? s.partSelection.parts.some((q) => q.name === p.name) : true])));
    setDims(s.partSelection?.dimensions ?? spec.dimensions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  if (!concept || !spec) return <div className="panel"><Empty>Steps 1 and 2 (concept and specification) come first.</Empty></div>;
  const busy = !!s.busy.p4;
  const labels = Object.fromEntries(s.parts.map((p) => [p.id, p.name]));
  const lastRound = s.refineRounds.at(-1);

  return (
    <div className="panel">
      <div className="two-col">
        <div>
          <Step id="r3 + r5 → r7" actor="human" title="Choose which parts to build">
            <div className="checklist">
              {spec.parts.map((p) => (
                <label key={p.name}>
                  <input type="checkbox" checked={!!chosen[p.name]} onChange={(e) => setChosen({ ...chosen, [p.name]: e.target.checked })} />
                  <b>{p.name}</b> ×{p.count} <small>{p.material}</small>
                </label>
              ))}
            </div>
            <div className="row">Overall size <DimInputs value={dims} onChange={setDims} /></div>
            <div className="row">
              <button className="primary" disabled={busy || !Object.values(chosen).some(Boolean)}
                onClick={() => p4Build({ objectName: spec.name, dimensions: dims, parts: spec.parts.filter((p) => chosen[p.name]) })}>
                {s.parts.length ? "Rebuild parts" : "Build parts"}
              </button>
              <Status k="p4" />
            </div>
          </Step>
          <Step id="r8*" actor="model_1" title="Physical pieces" done={s.parts.length > 0}>
            {s.parts.length === 0 ? <Empty>Extracted pieces appear here.</Empty> : (
              <table className="compact">
                <thead><tr><th /><th>Piece</th><th>Shape</th><th>Size (w×h×d)</th><th>Depth</th><th>Attaches to</th></tr></thead>
                <tbody>{s.parts.map((p, i) => (
                  <tr key={p.id}><td><span className="swatch" style={{ background: colorFor(i) }} /></td><td title={p.notes}>{p.name}</td><td>{p.shape}</td>
                    <td>{p.size.w}×{p.size.h}×{p.size.d}</td><td>{p.zHint}</td><td>{p.attachTo ?? "—"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Step>
          <Step id="r9" actor="model_1" title="Assembly notes" done={!!s.assemblyNotes}>
            {s.assemblyNotes ? <p className="prose">{s.assemblyNotes}</p> : <Empty>Assembly notes appear here.</Empty>}
          </Step>
        </div>
        <div>
          <Step id="r10 + r13*" actor="model_3" title="Reference image with grounded pieces">
            {s.reference ? (
              <BoxOverlay svg={s.reference} boxes={s.groundings} labels={labels} size={420} />
            ) : <SvgImage svg={concept.svg} size={420} />}
            {s.groundingQueries.length > 0 && (
              <details><summary>Grounding queries (r12*)</summary>
                <ul className="small">{s.groundingQueries.map((q) => <li key={q.partId}><b>{labels[q.partId] ?? q.partId}</b>: {q.query}</li>)}</ul>
              </details>
            )}
          </Step>
          <Step id="r11*" actor="tool_1" title="3D parts">
            {s.parts3d.length ? <AssemblyView parts={s.parts3d} height={300} /> : <Empty>3D parts appear here.</Empty>}
          </Step>
        </div>
      </div>
      <Step id="r14 → r10 (loop)" actor="model_1" title="Critique rounds">
        {s.refineRounds.length === 0 ? <Empty>model_1 compares the parts with the image; if needed model_2 edits the reference image and the round repeats (max 2 automatic rounds).</Empty> : (
          <div className="rounds">
            {s.refineRounds.map((r) => (
              <div key={r.round} className="round">
                <SvgImage svg={r.referenceSvg} size={120} />
                <div>
                  <b>Round {r.round}</b> — {r.critique?.ok ? <span className="ok">parts consistent</span> : <span className="warn">needs changes</span>}
                  {r.critique?.instruction && <p className="small">r14: “{r.critique.instruction}”</p>}
                  <button className="small" onClick={() => p4RestoreRound(r)}>Use this round</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button disabled={busy || !lastRound} onClick={() => p4AnotherRound()}>Run another round</button>
          <button disabled={busy || !s.parts3d.length} onClick={() => s.set({ tab: "refine" })}>Refine with side views →</button>
          <button className="primary" disabled={busy || !s.parts3d.length} onClick={() => p7Compose("r11")}>Assemble these parts →</button>
        </div>
      </Step>
    </div>
  );
}
