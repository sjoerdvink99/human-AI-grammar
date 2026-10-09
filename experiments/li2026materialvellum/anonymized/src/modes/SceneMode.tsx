// Process 1 — "Scene": ground plan → 3D block scene → camera → render → image → region edits.
import { useMemo, useRef, useState } from "react";
import { DrawCanvas } from "../components/DrawCanvas";
import { ErrorBox, Spinner, Steps, type StepInfo } from "../components/Steps";
import { api, downloadSvg, svgUrl, uid } from "../lib/api";
import { EDIT_INTENTS, type Camera, type EditIntent, type Layout, type Point, type Scene3D, type Shape, type Stroke } from "../shared/types";
import { beautifyStroke } from "../tools/tool1";
import { applyCamera, clampCamera, extrudeLayout } from "../tools/tool2";
import { composeLayout, deriveCamera, HEIGHT_PENS, PX_PER_M, renderScene, strokesToSelections } from "../tools/tool3";

type Stage = "plan" | "camera" | "image";

export function SceneMode() {
  const [stage, setStage] = useState<Stage>("plan");
  const [showRaw, setShowRaw] = useState(false);

  // r1 groundPlan is the fixed canvas (CANVAS_W×CANVAS_H at PX_PER_M px per metre).
  const [pen, setPen] = useState<string>(HEIGHT_PENS[1].color);
  const [footprintStrokes, setFootprintStrokes] = useState<Stroke[]>([]); // r2_1
  const [footprints, setFootprints] = useState<Shape[]>([]); // r2_2

  const [layout, setLayout] = useState<Layout | null>(null); // r3_1
  const [scene1, setScene1] = useState<Scene3D | null>(null); // r4_1
  const [camera1, setCamera1] = useState<Camera | null>(null); // r5_1
  const [camera2, setCamera2] = useState<Camera | null>(null); // r5_2

  const [image1, setImage1] = useState<string | null>(null); // r7_1
  const [renderUsed, setRenderUsed] = useState<string | null>(null); // r6_1 sent to model_1
  const [intent, setIntent] = useState<EditIntent>("add-detail");
  const [recolorTo, setRecolorTo] = useState("#e5484d");
  const [editStrokes, setEditStrokes] = useState<Stroke[]>([]); // r8_1
  const [editShapes, setEditShapes] = useState<Shape[]>([]); // r8_2
  const [image2, setImage2] = useState<string | null>(null); // r7_2
  const [view, setView] = useState<"after" | "before" | "side">("side");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // P1.2 [tool_1 modify] — each footprint stroke is beautified as soon as it is drawn.
  const addFootprint = (points: Point[]) => {
    const s: Stroke = { id: uid("f"), points, color: pen, width: 3 };
    setFootprintStrokes((a) => [...a, s]);
    setFootprints((a) => [...a, beautifyStroke(s, { forceClosed: true, snap: PX_PER_M / 2, allow: ["rectangle", "polygon", "ellipse", "triangle"] })]);
  };

  // P1.3 [tool_3 compose] → P1.4 [tool_2 translate] → P1.5 [tool_3 translate]
  const buildScene = () => {
    const l = composeLayout(footprints);
    const s = extrudeLayout(l);
    const c = deriveCamera(s);
    setLayout(l); setScene1(s); setCamera1(c); setCamera2(c);
    setStage("camera");
  };

  // P1.7 [tool_2 modify] (r4_1 + r5_2 → r4_2) and P1.8 [tool_3 translate] (r4_2 → r6_1), live while the camera moves.
  const scene2 = useMemo(() => (scene1 && camera2 ? applyCamera(scene1, camera2) : null), [scene1, camera2]);
  const render = useMemo(() => (scene2 ? renderScene(scene2) : null), [scene2]);

  // P1.6 [human modify] — orbit the camera by dragging / wheel / sliders.
  const drag = useRef<{ x: number; y: number; cam: Camera } | null>(null);
  const setCam = (c: Camera) => setCamera2(clampCamera(c));

  // P1.9 [model_1 generate]~
  const generate = async () => {
    if (!render) return;
    setBusy("model_1 is generating an image from the render…"); setError(null);
    try {
      const { svg } = await api.generateFromRender(render);
      setRenderUsed(render);
      setImage1(svg); setImage2(null); setEditStrokes([]); setEditShapes([]);
      setStage("image");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  // P1.10 [human specify] + P1.11 [tool_1 modify]
  const intentColor = EDIT_INTENTS.find((i) => i.id === intent)!.color;
  const addEditStroke = (points: Point[]) => {
    const s: Stroke = { id: uid("e"), points, color: intentColor, width: 3, intent, recolorTo: intent === "recolor" ? recolorTo : undefined };
    setEditStrokes((a) => [...a, s]);
    setEditShapes((a) => [...a, beautifyStroke(s, { forceClosed: true })]);
  };
  const removeEdit = (id: string) => {
    setEditStrokes((a) => a.filter((s) => s.id !== id));
    setEditShapes((a) => a.filter((s) => s.id !== id));
  };

  // P1.12 [tool_3 translate] r8_2* → r9_1* + r10_1*
  const { selections, instructions } = useMemo(() => strokesToSelections(editShapes), [editShapes]);

  // P1.13 [model_1 modify]~
  const applyEdits = async () => {
    if (!image1 || selections.length === 0) return;
    setBusy("model_1 is editing the selected regions…"); setError(null);
    try {
      const { edited } = await api.modify(image1, selections.map((s) => ({ index: s.index, polygon: s.polygon })), instructions);
      setImage2(edited); setView("side");
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const st = (done: boolean, ready: boolean, running = false): StepInfo["status"] => (running ? "running" : done ? "done" : ready ? "ready" : "todo");
  const steps: StepInfo[] = [
    { id: "1", actor: "human", op: "specify", label: "Draw building footprints (r2)", status: st(footprints.length > 0, true) },
    { id: "2", actor: "tool_1", op: "modify", label: "Beautify footprints", status: st(footprints.length > 0, false) },
    { id: "3", actor: "tool_3", op: "compose", label: "Compose layout (r3)", status: st(!!layout, footprints.length > 0) },
    { id: "4", actor: "tool_2", op: "translate", label: "Extrude to 3D scene (r4_1)", status: st(!!scene1, false) },
    { id: "5", actor: "tool_3", op: "translate", label: "Derive camera (r5_1)", status: st(!!camera1, false) },
    { id: "6", actor: "human", op: "modify", label: "Adjust camera (r5_2)", status: st(!!camera1 && camera2 !== camera1, !!camera1) },
    { id: "7", actor: "tool_2", op: "modify", label: "Apply camera (r4_2)", status: st(!!scene2, false) },
    { id: "8", actor: "tool_3", op: "translate", label: "Render (r6)", status: st(!!render, false) },
    { id: "9", actor: "model_1", op: "generate", label: "Image from render (r7_1)", status: st(!!image1, !!render, busy?.includes("generating") ?? false), generative: true },
    { id: "10", actor: "human", op: "specify", label: "Paint edit regions (r8)", status: st(editShapes.length > 0, !!image1) },
    { id: "11", actor: "tool_1", op: "modify", label: "Clean region outlines", status: st(editShapes.length > 0, false) },
    { id: "12", actor: "tool_3", op: "translate", label: "Selections + instructions (r9, r10)", status: st(selections.length > 0, false) },
    { id: "13", actor: "model_1", op: "modify", label: "Edit regions (r7_2)", status: st(!!image2, selections.length > 0, busy?.includes("editing") ?? false), generative: true },
  ];

  return (
    <div className="mode">
      <div className="stage">
        <div className="tabs small">
          <button className={stage === "plan" ? "on" : ""} onClick={() => setStage("plan")}>1 · Ground plan</button>
          <button className={stage === "camera" ? "on" : ""} disabled={!scene1} onClick={() => setStage("camera")}>2 · Camera</button>
          <button className={stage === "image" ? "on" : ""} disabled={!image1} onClick={() => setStage("image")}>3 · Image & edits</button>
        </div>

        {stage === "plan" && (
          <>
            <div className="toolbar">
              <span className="hint">Draw closed outlines of buildings, seen from above. Pen = building height. 1 grid cell = 1 m.</span>
              {HEIGHT_PENS.map((h) => (
                <button key={h.color} className={`pen ${pen === h.color ? "on" : ""}`} onClick={() => setPen(h.color)}>
                  <i style={{ background: h.color }} /> {h.label}
                </button>
              ))}
            </div>
            <DrawCanvas grid={PX_PER_M} strokes={footprintStrokes} shapes={footprints} showRaw={showRaw} pen={{ color: pen, width: 3 }} closedFill onStroke={addFootprint} />
            <div className="toolbar">
              <button onClick={() => { setFootprintStrokes((a) => a.slice(0, -1)); setFootprints((a) => a.slice(0, -1)); }} disabled={!footprints.length}>Undo</button>
              <button onClick={() => { setFootprintStrokes([]); setFootprints([]); }} disabled={!footprints.length}>Clear</button>
              <label><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> show raw strokes</label>
              <span className="grow" />
              <button className="primary" disabled={!footprints.length} onClick={buildScene}>Build 3D scene →</button>
            </div>
          </>
        )}

        {stage === "camera" && render && camera2 && (
          <>
            <div className="toolbar"><span className="hint">Drag to orbit, scroll to zoom. The render updates as the camera moves.</span></div>
            <div
              className="canvas render"
              onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cam: camera2 }; }}
              onPointerMove={(e) => {
                const d = drag.current; if (!d) return;
                setCam({ ...d.cam, yaw: d.cam.yaw - (e.clientX - d.x) * 0.4, pitch: d.cam.pitch + (e.clientY - d.y) * 0.3 });
              }}
              onPointerUp={() => (drag.current = null)}
              onWheel={(e) => setCam({ ...camera2, distance: camera2.distance * (e.deltaY > 0 ? 1.08 : 0.93) })}
            >
              <img src={svgUrl(render)} alt="render r6" draggable={false} />
            </div>
            <div className="toolbar sliders">
              {([["yaw", 0, 359], ["pitch", 5, 85], ["distance", 8, 200], ["fov", 20, 90]] as const).map(([k, min, max]) => (
                <label key={k}>{k}
                  <input type="range" min={min} max={max} value={Math.round(camera2[k])} onChange={(e) => setCam({ ...camera2, [k]: Number(e.target.value) })} />
                  <output>{Math.round(camera2[k])}</output>
                </label>
              ))}
              <button onClick={() => camera1 && setCamera2(camera1)}>Reset camera</button>
              <span className="grow" />
              <button className="primary" disabled={!!busy} onClick={generate}>{image1 ? "Regenerate image" : "Generate image →"}</button>
            </div>
          </>
        )}

        {stage === "image" && image1 && (
          <>
            {!image2 ? (
              <>
                <div className="toolbar">
                  <span className="hint">Lasso regions to edit. Brush:</span>
                  {EDIT_INTENTS.map((i) => (
                    <button key={i.id} className={`pen ${intent === i.id ? "on" : ""}`} onClick={() => setIntent(i.id)}><i style={{ background: i.color }} /> {i.label}</button>
                  ))}
                  {intent === "recolor" && <input type="color" value={recolorTo} onChange={(e) => setRecolorTo(e.target.value)} />}
                </div>
                <DrawCanvas background={image1} strokes={editStrokes} shapes={editShapes} showRaw={showRaw} pen={{ color: intentColor, width: 3 }} closedFill disabled={!!busy}
                  onStroke={addEditStroke} shapeLabel={(_s, i) => String(i + 1)} />
              </>
            ) : (
              <>
                <div className="toolbar">
                  {(["side", "before", "after"] as const).map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v === "side" ? "Side by side" : v === "before" ? "Before (r7_1)" : "After (r7_2)"}</button>)}
                </div>
                <div className={view === "side" ? "compare" : ""}>
                  {view !== "after" && <figure><img className="canvas" src={svgUrl(image1)} alt="before" /><figcaption>Before</figcaption></figure>}
                  {view !== "before" && <figure><img className="canvas" src={svgUrl(image2)} alt="after" /><figcaption>After</figcaption></figure>}
                </div>
              </>
            )}
            <div className="toolbar">
              {!image2 && <button onClick={() => { setEditStrokes([]); setEditShapes([]); }} disabled={!editShapes.length}>Clear regions</button>}
              {image2 && <button onClick={() => setImage2(null)}>Back to regions</button>}
              <button onClick={() => downloadSvg(image2 ?? image1, image2 ? "scene-edited.svg" : "scene.svg")}>Download SVG</button>
              <span className="grow" />
              <button className="primary" disabled={!!busy || selections.length === 0} onClick={applyEdits}>{image2 ? "Regenerate edit" : "Apply edits →"}</button>
            </div>
          </>
        )}
        {busy && <Spinner text={busy} />}
        <ErrorBox error={error} />
      </div>

      <aside className="panel">
        <h3>Process 1 · Scene</h3>
        <Steps steps={steps} />
        {stage === "plan" && footprints.length > 0 && (
          <section><h4>Footprints (r2_2)</h4>
            <ul className="mini">{footprints.map((f, i) => <li key={f.id}>{i + 1}. {f.kind}, {HEIGHT_PENS.find((h) => h.color === f.color)?.label}</li>)}</ul>
          </section>
        )}
        {stage === "camera" && layout && (
          <section><h4>Scene (r4_2)</h4><p className="mini">{layout.footprints.length} blocks on a {layout.extent.w}×{layout.extent.d} m plot.</p></section>
        )}
        {stage === "image" && renderUsed && (
          <section><h4>Render sent to model_1 (r6)</h4><img className="thumb" src={svgUrl(renderUsed)} alt="render" /></section>
        )}
        {stage === "image" && selections.length > 0 && (
          <section><h4>Selections & instructions (r9, r10)</h4>
            <ol className="mini">
              {selections.map((s, i) => (
                <li key={s.id}>{instructions[i].replace(/^Region \d+ /, "")} {!image2 && <button className="x" onClick={() => removeEdit(s.id)}>✕</button>}</li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}
