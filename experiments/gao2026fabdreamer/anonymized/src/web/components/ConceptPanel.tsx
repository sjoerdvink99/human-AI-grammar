// P1 (prompt → concepts → select) and P2 (edit the selected concept).
import { useState } from "react";
import { useApp, currentConcept } from "../store";
import { p1Generate, p1Select, p2Edit } from "../pipelines";
import { Status, Step, SvgImage, Empty } from "./common";

export function ConceptPanel() {
  const s = useApp();
  const cur = currentConcept(s);
  const [edit, setEdit] = useState("");
  const busy = !!s.busy.p1;

  return (
    <div className="panel two-col">
      <div>
        <Step id="r1 → r2*" actor="model_2" title="Describe the object, generate concepts">
          <textarea rows={4} placeholder="e.g. a small bedside table with one drawer and tapered legs, Scandinavian style"
            value={s.conceptPrompt} onChange={(e) => s.set({ conceptPrompt: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) p1Generate(); }} />
          <div className="row">
            <button className="primary" disabled={busy || !s.conceptPrompt.trim()} onClick={() => p1Generate()}>
              {s.conceptCandidates.length ? "Regenerate concepts" : "Generate concepts"}
            </button>
            <Status k="p1" />
          </div>
        </Step>
        <Step id="r2* → r3" actor="human" title="Pick one concept">
          {s.conceptCandidates.length === 0 ? <Empty>Concepts appear here.</Empty> : (
            <div className="gallery">
              {s.conceptCandidates.map((svg, i) => (
                <figure key={i} className={cur && s.concept[0]?.svg === svg ? "picked" : ""}>
                  <SvgImage svg={svg} size={180} onClick={() => p1Select(svg)} title={`Concept ${i + 1}`} />
                  <figcaption><button onClick={() => p1Select(svg)}>Use concept {i + 1}</button></figcaption>
                </figure>
              ))}
            </div>
          )}
        </Step>
      </div>
      <div>
        <Step id="r3" actor="human" title="Selected concept">
          {!cur ? <Empty>No concept selected yet.</Empty> : (
            <>
              <SvgImage svg={cur.svg} size={400} className="hero" />
              <div className="versions">
                {s.concept.map((v, i) => (
                  <button key={v.id} className={i === s.conceptIndex ? "chip active" : "chip"} title={v.note}
                    onClick={() => s.set({ conceptIndex: i })}>r3_{i + 1}</button>
                ))}
                <small>{cur.note}</small>
              </div>
            </>
          )}
        </Step>
        <Step id="r3 + r4 → r3_2" actor="model_2" title="Edit the concept">
          <textarea rows={2} placeholder="e.g. make the legs thicker and remove the drawer handle" value={edit}
            disabled={!cur} onChange={(e) => setEdit(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={!cur || !edit.trim() || !!s.busy.p2} onClick={() => p2Edit(edit.trim()).then(() => setEdit(""))}>Apply edit</button>
            <Status k="p2" />
          </div>
          {cur && <div className="row"><button onClick={() => s.set({ tab: "spec" })}>Next: specification →</button></div>}
        </Step>
      </div>
    </div>
  );
}
