// Process 2 — "Sketch": sketch → beautified shapes → sketch render + description → image.
import { useMemo, useState } from "react";
import { DrawCanvas } from "../components/DrawCanvas";
import { ErrorBox, Spinner, Steps, type StepInfo } from "../components/Steps";
import { api, downloadSvg, svgUrl, uid } from "../lib/api";
import type { Point, Shape, Stroke } from "../shared/types";
import { beautifyStroke } from "../tools/tool1";
import { describeSketch, renderShapes, SKETCH_PENS } from "../tools/tool3";

export function SketchMode() {
  // r11 sketchCanvas is the blank CANVAS_W×CANVAS_H canvas.
  const [pen, setPen] = useState(SKETCH_PENS[0].color);
  const [width, setWidth] = useState(4);
  const [showRaw, setShowRaw] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]); // r12_1
  const [shapes, setShapes] = useState<Shape[]>([]); // r12_2
  const [images, setImages] = useState<string[]>([]); // r15_1 (regenerations kept)
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // P2.1 [human specify] + P2.2 [tool_1 modify]
  const add = (points: Point[]) => {
    const s: Stroke = { id: uid("s"), points, color: pen, width };
    setStrokes((a) => [...a, s]);
    setShapes((a) => [...a, beautifyStroke(s)]);
  };

  // P2.3 [tool_3 translate] r12_2* → r13_1 + r14_1
  const sketchRender = useMemo(() => renderShapes(shapes), [shapes]);
  const description = useMemo(() => describeSketch(shapes), [shapes]);

  // P2.4 [model_1 generate]~
  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const { svg } = await api.generateFromSketch(sketchRender, description);
      setShown(images.length);
      setImages((a) => [...a, svg]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const steps: StepInfo[] = [
    { id: "1", actor: "human", op: "specify", label: "Sketch (r12_1)", status: shapes.length ? "done" : "ready" },
    { id: "2", actor: "tool_1", op: "modify", label: "Beautify strokes (r12_2)", status: shapes.length ? "done" : "todo" },
    { id: "3", actor: "tool_3", op: "translate", label: "Render + describe sketch (r13, r14)", status: shapes.length ? "done" : "todo" },
    { id: "4", actor: "model_1", op: "generate", label: "Image (r15)", status: busy ? "running" : images.length ? "done" : shapes.length ? "ready" : "todo", generative: true },
  ];

  return (
    <div className="mode">
      <div className="stage">
        <div className="toolbar">
          {SKETCH_PENS.map((p) => (
            <button key={p.color} title={p.name} className={`swatch ${pen === p.color ? "on" : ""}`} style={{ background: p.color }} onClick={() => setPen(p.color)} />
          ))}
          <label>width <input type="range" min={2} max={14} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
          <label><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> show raw strokes</label>
        </div>
        <div className="compare">
          <figure>
            <DrawCanvas strokes={strokes} shapes={shapes} showRaw={showRaw} pen={{ color: pen, width }} onStroke={add} disabled={busy} />
            <figcaption>Sketch</figcaption>
          </figure>
          <figure>
            {images.length ? <img className="canvas" src={svgUrl(images[shown])} alt="generated" /> : <div className="canvas placeholder">The generated image appears here.</div>}
            <figcaption>
              {images.length > 1 && images.map((_, i) => <button key={i} className={`chip ${i === shown ? "on" : ""}`} onClick={() => setShown(i)}>#{i + 1}</button>)}
              {images.length > 0 && <button className="chip" onClick={() => downloadSvg(images[shown], "sketch-image.svg")}>Download</button>}
            </figcaption>
          </figure>
        </div>
        <div className="toolbar">
          <button disabled={!shapes.length} onClick={() => { setStrokes((a) => a.slice(0, -1)); setShapes((a) => a.slice(0, -1)); }}>Undo</button>
          <button disabled={!shapes.length} onClick={() => { setStrokes([]); setShapes([]); }}>Clear</button>
          <span className="grow" />
          <button className="primary" disabled={!shapes.length || busy} onClick={generate}>{images.length ? "Regenerate" : "Generate image →"}</button>
        </div>
        {busy && <Spinner text="model_1 is turning the sketch into an image…" />}
        <ErrorBox error={error} onRetry={generate} />
      </div>
      <aside className="panel">
        <h3>Process 2 · Sketch</h3>
        <Steps steps={steps} />
        <section><h4>Sketch render (r13)</h4><img className="thumb" src={svgUrl(sketchRender)} alt="sketch render" /></section>
        <section><h4>Sketch description (r14)</h4><pre className="mini pre">{description}</pre></section>
      </aside>
    </div>
  );
}
