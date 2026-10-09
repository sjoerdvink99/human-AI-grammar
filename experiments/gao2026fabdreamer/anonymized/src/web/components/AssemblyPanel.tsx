// P7: compose (r27) → render (r28) → human modify (r27_2) → render (loop).
// P8: select part (r29) → crop (r30) → regenerate (r31) → new part (r32).
// P9: select part (r33) + request (r34) → plan (r35*) → 3D placement (r36*) → parts (r37*).
import { useState } from "react";
import { useApp, currentAssembly, commitAssembly } from "../store";
import { p7AddOrReplace, p8Regenerate, p9LanguageEdit } from "../pipelines";
import { AssemblyView } from "./AssemblyView";
import { DimInputs, Empty, Status, Step, SvgImage } from "./common";
import type { Part3D } from "../../shared/types";

export function AssemblyPanel() {
  const s = useApp();
  const asm = currentAssembly(s);
  const [mode, setMode] = useState<"translate" | "rotate">("translate");
  const [instruction, setInstruction] = useState("");
  if (!asm) return <div className="panel"><Empty>Build parts (step 3) and click “Assemble these parts”.</Empty></div>;
  const sel = asm.parts.find((p) => p.id === s.selectedPartId) ?? null;

  const updatePart = (id: string, patch: Partial<Part3D>) =>
    commitAssembly({ parts: asm.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const ghosts = [...(s.regen.part ? [s.regen.part] : []), ...s.langEdit.parts];

  return (
    <div className="panel assembly">
      <div className="main-view">
        <div className="toolbar">
          <span className="actor actor-tool">tool_2</span><b>r27 → r28</b>
          <span className="sep" />
          <button className={mode === "translate" ? "chip active" : "chip"} onClick={() => setMode("translate")}>Move</button>
          <button className={mode === "rotate" ? "chip active" : "chip"} onClick={() => setMode("rotate")}>Rotate</button>
          <span className="sep" />
          <button disabled={s.assemblyIndex <= 0} onClick={() => s.set({ assemblyIndex: s.assemblyIndex - 1 })}>↶ Undo</button>
          <button disabled={s.assemblyIndex >= s.assemblyHistory.length - 1} onClick={() => s.set({ assemblyIndex: s.assemblyIndex + 1 })}>↷ Redo</button>
          <small>r27_{s.assemblyIndex + 1} of {s.assemblyHistory.length}</small>
        </div>
        <AssemblyView parts={asm.parts} selectedId={s.selectedPartId} editable mode={mode} ghostParts={ghosts} height={560}
          onSelect={(id) => s.set({ selectedPartId: id })}
          onTransform={(id, position, rotationY) => updatePart(id, { position, rotationY })} />
        <p className="hint">Click a part to select it, drag the gizmo to move or rotate it, drag the background to orbit. Blue ghosts are proposed parts not yet applied.</p>
      </div>

      <aside className="inspector">
        <Step id="r29 / r33" actor="human" title="Part">
          <select value={s.selectedPartId ?? ""} onChange={(e) => s.set({ selectedPartId: e.target.value || null })}>
            <option value="">— select a part —</option>
            {asm.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {sel && (
            <div className="part-form">
              <label>name <input value={sel.name} onChange={(e) => updatePart(sel.id, { name: e.target.value })} /></label>
              <label>material <input value={sel.material} onChange={(e) => updatePart(sel.id, { material: e.target.value })} /></label>
              <div>size <DimInputs value={sel.size} onChange={(size) => updatePart(sel.id, { size })} /></div>
              <div className="dims">position
                {(["x", "y", "z"] as const).map((k) => (
                  <label key={k}>{k}<input type="number" value={Math.round(sel.position[k])}
                    onChange={(e) => updatePart(sel.id, { position: { ...sel.position, [k]: Number(e.target.value) || 0 } })} /></label>
                ))}
              </div>
              <label>rotation° <input type="number" value={sel.rotationY} onChange={(e) => updatePart(sel.id, { rotationY: Number(e.target.value) || 0 })} /></label>
              <div className="row">
                <button onClick={() => commitAssembly({ parts: [...asm.parts, { ...sel, id: `${sel.id}_copy${Date.now() % 1000}`, name: `${sel.name} copy`, position: { ...sel.position, x: sel.position.x + sel.size.w + 20 } }] })}>Duplicate</button>
                <button className="danger" onClick={() => { commitAssembly({ parts: asm.parts.filter((p) => p.id !== sel.id) }); s.set({ selectedPartId: null }); }}>Delete</button>
              </div>
              <small>{sel.shape}{sel.shape === "profile" ? ` (extruded along ${sel.profileAxis})` : ""} · from {sel.source}</small>
            </div>
          )}
        </Step>

        <Step id="r3 + r29 → r30 → r31 → r32" actor="model_2" title="Regenerate part from the concept">
          <div className="row">
            <button disabled={!sel || !!s.busy.p8} onClick={() => sel && p8Regenerate(sel.id)}>Regenerate selected part</button>
            <Status k="p8" />
          </div>
          {s.regen.crop && (
            <div className="row">
              <figure><SvgImage svg={s.regen.crop} size={110} /><figcaption>r30 crop</figcaption></figure>
              {s.regen.image && <figure><SvgImage svg={s.regen.image} size={110} /><figcaption>r31 redrawn</figcaption></figure>}
            </div>
          )}
          {s.regen.part && (
            <button className="primary" onClick={() => { p7AddOrReplace(s.regen.part!, s.regen.partId); s.set({ regen: { partId: null, crop: null, image: null, part: null } }); }}>
              Replace “{asm.parts.find((p) => p.id === s.regen.partId)?.name ?? "part"}” with r32
            </button>
          )}
        </Step>

        <Step id="r27 + r33 + r34 → r35* → r36* → r37*" actor="model_1 / model_3" title="Change by description">
          <textarea rows={2} placeholder={sel ? `e.g. add a shelf below ${sel.name}` : "Select a part first"} disabled={!sel}
            value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <div className="row">
            <button disabled={!sel || !instruction.trim() || !!s.busy.p9} onClick={() => sel && p9LanguageEdit(sel.id, instruction.trim())}>Plan change</button>
            <Status k="p9" />
          </div>
          {s.langEdit.planned.length > 0 && (
            <ul className="small">
              {s.langEdit.planned.map((p) => {
                const made = s.langEdit.parts.find((q) => q.name === p.name);
                return (
                  <li key={p.key}>
                    <b>{p.action}</b> {p.name} — {p.placement}
                    {made && <> <code>{made.size.w}×{made.size.h}×{made.size.d}</code></>}
                  </li>
                );
              })}
            </ul>
          )}
          {s.langEdit.parts.length > 0 && (
            <div className="row">
              <button className="primary" onClick={() => {
                s.langEdit.parts.forEach(({ replacesId, ...p }) => p7AddOrReplace(p, replacesId));
                s.set((st) => ({ langEdit: { ...st.langEdit, parts: [], planned: [], placements: [] } }));
                setInstruction("");
              }}>Apply {s.langEdit.parts.length} part(s)</button>
              <button onClick={() => s.set((st) => ({ langEdit: { ...st.langEdit, parts: [], planned: [], placements: [] } }))}>Discard</button>
            </div>
          )}
        </Step>

        {s.refinedParts.length > 0 && (
          <Step id="r19*" actor="human" title="Refined parts from step 4">
            <ul className="small">
              {s.refinedParts.map((p) => (
                <li key={p.id}>{p.name} <button className="small" onClick={() => p7AddOrReplace(p, asm.parts.some((q) => q.id === p.id) ? p.id : null)}>
                  {asm.parts.some((q) => q.id === p.id) ? "replace" : "add"}</button></li>
              ))}
            </ul>
          </Step>
        )}
      </aside>
    </div>
  );
}
