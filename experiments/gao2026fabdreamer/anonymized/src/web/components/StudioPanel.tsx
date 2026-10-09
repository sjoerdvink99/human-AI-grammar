// P6: r20 → part images (r21*) → select (r22) → judge (r23) → clean image (r24) → silhouette (r25) → 3D part (r26).
import { useApp, currentAssembly } from "../store";
import { p6Generate, p6Select, p7AddOrReplace } from "../pipelines";
import { AssemblyView } from "./AssemblyView";
import { BoxOverlay, Empty, Status, Step, SvgImage } from "./common";

export function StudioPanel() {
  const s = useApp();
  const st = s.studio;
  const asm = currentAssembly(s);
  const upd = (p: Partial<typeof st>) => s.set({ studio: { ...st, ...p } });
  const busy = !!s.busy.p6;
  return (
    <div className="panel two-col">
      <div>
        <Step id="r20 → r21*" actor="model_2" title="Describe a single part">
          <textarea rows={3} placeholder="e.g. a curved armrest with a rounded front end" value={st.prompt} onChange={(e) => upd({ prompt: e.target.value })} />
          <div className="row">
            <label>height <input type="number" value={st.height} onChange={(e) => upd({ height: Number(e.target.value) || 1 })} /> mm</label>
            <label>thickness <input type="number" value={st.depth} onChange={(e) => upd({ depth: Number(e.target.value) || 1 })} /> mm</label>
            <label>material <input value={st.material} onChange={(e) => upd({ material: e.target.value })} /></label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy || !st.prompt.trim()} onClick={() => p6Generate()}>Generate part images</button>
            <Status k="p6" />
          </div>
        </Step>
        <Step id="r21* → r22" actor="human" title="Pick one">
          {st.candidates.length === 0 ? <Empty>Candidates appear here.</Empty> : (
            <div className="gallery">
              {st.candidates.map((svg, i) => (
                <figure key={i} className={st.chosen === svg ? "picked" : ""}>
                  <SvgImage svg={svg} size={150} onClick={() => !busy && p6Select(svg)} title={`Option ${i + 1}`} />
                  <figcaption><button disabled={busy} onClick={() => p6Select(svg)}>Use option {i + 1}</button></figcaption>
                </figure>
              ))}
            </div>
          )}
        </Step>
      </div>
      <div>
        <Step id="r22 → r23" actor="model_1" title="Suitability">
          {st.verdict ? <p><span className={`badge ${st.verdict}`}>{st.verdict.replace("_", " ")}</span> {st.reason}</p> : <Empty>model_1 judges whether the image can become a part.</Empty>}
        </Step>
        <Step id="r24 + r25" actor="model_2 / tool_1" title="Clean silhouette and its bounds">
          {st.clean && st.box ? <BoxOverlay svg={st.clean} boxes={[st.box]} labels={{ studio: "" }} size={220} /> : st.clean ? <SvgImage svg={st.clean} size={220} /> : <Empty>The clean image appears here.</Empty>}
        </Step>
        <Step id="r26" actor="tool_1" title="3D part">
          {st.part ? (
            <>
              <AssemblyView parts={[st.part]} height={260} />
              <p className="small">{st.part.size.w} × {st.part.size.h} × {st.part.size.d} mm, extruded silhouette</p>
              <button disabled={!asm} onClick={() => { p7AddOrReplace(st.part!, null); s.set({ tab: "assembly" }); }}
                title={asm ? "" : "Compose an assembly first"}>Add to assembly</button>
            </>
          ) : <Empty>The extruded part appears here.</Empty>}
        </Step>
      </div>
    </div>
  );
}
