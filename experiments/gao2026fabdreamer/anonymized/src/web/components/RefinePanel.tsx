// P5: r10 + r12* + r13* → check (r15) → re-ground (r16) → check (r15_2) → side views (r17*) → silhouettes (r18*) → refined parts (r19*).
import { useApp } from "../store";
import { p5Refine, p7Compose } from "../pipelines";
import { AssemblyView } from "./AssemblyView";
import { BoxOverlay, Empty, Status, Step, SvgImage } from "./common";
import type { BoxCheck } from "../../shared/types";

function Checks({ checks, labels }: { checks: BoxCheck[]; labels: Record<string, string> }) {
  return (
    <table className="compact">
      <thead><tr><th>Piece</th><th>Result</th><th>Issues</th></tr></thead>
      <tbody>{checks.map((c) => (
        <tr key={c.partId}><td>{labels[c.partId] ?? c.partId}</td><td>{c.pass ? <span className="ok">pass</span> : <span className="bad">fail</span>}</td><td className="small">{c.issues.join("; ") || "—"}</td></tr>
      ))}</tbody>
    </table>
  );
}

export function RefinePanel() {
  const s = useApp();
  if (!s.reference || !s.groundings.length) return <div className="panel"><Empty>Build and ground parts in step 3 first.</Empty></div>;
  const labels = Object.fromEntries(s.parts.map((p) => [p.id, p.name]));
  const busy = !!s.busy.p5;
  return (
    <div className="panel">
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => p5Refine()}>{s.refinedParts.length ? "Run refinement again" : "Refine parts"}</button>
        <Status k="p5" />
      </div>
      <div className="two-col">
        <div>
          <Step id="r15* → r16* → r15_2*" actor="tool_1 / model_3" title="Check and fix the boxes">
            {s.boxChecks.length === 0 ? <Empty>Automatic checks: inside the image, size, duplicates, aspect vs. expected size, confidence.</Empty> : (
              <>
                <BoxOverlay svg={s.reference} boxes={s.regroundings.length ? s.regroundings : s.groundings} dashed={s.groundings}
                  labels={labels} checks={s.boxChecks2.length ? s.boxChecks2 : s.boxChecks} size={360} />
                <h4>Before (r15_1)</h4><Checks checks={s.boxChecks} labels={labels} />
                {s.boxChecks2.length > 0 && <><h4>After re-grounding (r15_2)</h4><Checks checks={s.boxChecks2} labels={labels} /></>}
              </>
            )}
          </Step>
        </div>
        <div>
          <Step id="r17* + r18*" actor="model_2 / tool_1" title="Side views and measured silhouettes">
            {s.sideViews.length === 0 ? <Empty>One side view per piece; its silhouette gives the piece's depth and profile.</Empty> : (
              <div className="gallery small">
                {s.sideViews.map((v) => {
                  const b = s.sideBoxes.find((x) => x.partId === v.partId);
                  return (
                    <figure key={v.partId}>
                      {b ? <BoxOverlay svg={v.svg} boxes={[b]} labels={{ [v.partId]: "" }} size={120} /> : <SvgImage svg={v.svg} size={120} />}
                      <figcaption>{labels[v.partId] ?? v.partId}{b ? ` · ${Math.round(b.w)}×${Math.round(b.h)}` : " · no silhouette"}</figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </Step>
          <Step id="r19*" actor="tool_1" title="Refined 3D parts">
            {s.refinedParts.length ? (
              <>
                <AssemblyView parts={s.refinedParts} height={300} />
                <div className="row"><button className="primary" onClick={() => p7Compose("r19")}>Assemble refined parts →</button></div>
              </>
            ) : <Empty>Refined parts appear here.</Empty>}
          </Step>
        </div>
      </div>
    </div>
  );
}
