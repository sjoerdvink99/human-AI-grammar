import { useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { autoPlacements, composePictorial, fitInto } from "../../shared/pictorial";
import type { AutoPlacement, ClickPoint, Placement, Point, Rect } from "../../shared/types";
import { extractObject } from "../api";
import { annotate, applyMask, cropCanvas, download, rasterize, svgDataUrl } from "../tools/raster";
import { uid } from "../state";

type Cutout = { dataUrl: string; width: number; height: number };

/** Deterministic auto placement for process 6 (no human placement step in that process). */
const autoModeFor = (type: string): AutoPlacement => (type === "pie" ? "corner" : "marks");

/**
 * Processes 6 and 7 (they share r6 and r18):
 * [human select] region r19/r24 → [human select] points r20/r25 → [model_3 extract] mask r21/r26
 * → [tool_5 modify] cutout r22/r27 → (P7 only: [human select] placement r28) → [tool_6 compose] r23/r29.
 */
export function CutoutPanel() {
  const { state, dispatch } = useApp();
  const [mode, setMode] = useState<6 | 7>(6);
  const [region, setRegion] = useState<Rect | null>(null); // r19
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [crop, setCrop] = useState<HTMLCanvasElement | null>(null);
  const [cropUrl, setCropUrl] = useState("");
  const [points, setPoints] = useState<ClickPoint[]>([]); // r20
  const [polygon, setPolygon] = useState<Point[] | null>(null); // r21
  const [label, setLabel] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [cutout, setCutout] = useState<Cutout | null>(null); // r22 / r27
  const [placement, setPlacement] = useState<Placement | null>(null); // r28
  const [preview, setPreview] = useState<string | null>(null); // r23 / r29
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<HTMLImageElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [placeDrag, setPlaceDrag] = useState<{ sx: number; sy: number; orig: Placement; resize: boolean } | null>(null);

  const scene = state.scene;
  const chart = state.chart;

  // reset downstream state when inputs change
  useEffect(() => resetAll(), [scene?.svg]);
  useEffect(() => {
    setPreview(null);
    if (cutout && chart) setPlacement(fitInto(cutout.width, cutout.height, { ...chart.plot, w: chart.plot.w * 0.3, h: chart.plot.h * 0.3 }));
  }, [chart?.svg]);

  function resetAll() {
    setRegion(null);
    setCrop(null);
    setPoints([]);
    setPolygon(null);
    setCutout(null);
    setPlacement(null);
    setPreview(null);
    setWarning(null);
    setError(null);
  }

  if (!scene || !chart)
    return (
      <div className="empty">
        <h2>Needs a scene and a chart</h2>
        <p>
          {!scene && "Generate a scene (Scene tab). "}
          {!chart && "Make a chart (Chart tab). "}
          Then cut an object out of the scene and put it on the chart.
        </p>
      </div>
    );

  // ---- r19: drag a rectangle on the scene -------------------------------------------------
  const toScene = (e: React.PointerEvent): Point => {
    const r = sceneRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(scene.width, ((e.clientX - r.left) / r.width) * scene.width)),
      y: Math.max(0, Math.min(scene.height, ((e.clientY - r.top) / r.height) * scene.height)),
    };
  };
  async function finishRegion(rect: Rect) {
    if (rect.w < 10 || rect.h < 10) return;
    resetAll();
    setRegion(rect);
    const full = await rasterize(scene!.svg, scene!.width, scene!.height);
    const scale = Math.max(1, Math.min(4, 480 / Math.max(rect.w, rect.h)));
    const c = cropCanvas(full, rect, scale);
    setCrop(c);
    setCropUrl(c.toDataURL("image/png"));
  }

  // ---- r20: click points on the crop ------------------------------------------------------
  function addPoint(e: React.MouseEvent<HTMLDivElement>) {
    if (!crop) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * crop.width, y: ((e.clientY - r.top) / r.height) * crop.height };
    setPoints([...points, { ...p, positive: !(e.shiftKey || e.button === 2) }]);
    setPolygon(null);
    setCutout(null);
    setPreview(null);
  }

  // ---- model_3 extract → tool_5 modify ------------------------------------------------------
  async function extract() {
    if (!crop) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const out = await extractObject({
        crop: cropUrl,
        annotated: annotate(crop, points).toDataURL("image/png"),
        width: crop.width,
        height: crop.height,
        points,
      });
      setPolygon(out.polygon);
      setLabel(out.label);
      if (out.warning) setWarning(out.warning);
      const c = applyMask(crop, out.polygon); // tool_5 modify
      setCutout(c);
      const pl = fitInto(c.width, c.height, { ...chart!.plot, w: chart!.plot.w * 0.3, h: chart!.plot.h * 0.3 });
      setPlacement(pl);
      if (mode === 6) {
        // tool_6 compose with automatic placement (process 6)
        setPreview(composePictorial(chart!, c, autoPlacements(chart!, c.width, c.height, autoModeFor(chart!.type))));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ---- P7: r28 placement by dragging on the chart -----------------------------------------
  function onPlaceDown(e: React.PointerEvent, resize: boolean) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (placement) setPlaceDrag({ sx: e.clientX, sy: e.clientY, orig: placement, resize });
  }
  function onPlaceMove(e: React.PointerEvent) {
    if (!placeDrag || !chartRef.current || !cutout) return;
    const k = chartRef.current.clientWidth / chart!.width;
    const dx = (e.clientX - placeDrag.sx) / k;
    const dy = (e.clientY - placeDrag.sy) / k;
    const o = placeDrag.orig;
    if (placeDrag.resize) {
      const w = Math.max(16, o.w + dx);
      setPlacement({ ...o, w, h: (w * cutout.height) / cutout.width });
    } else
      setPlacement({
        ...o,
        x: Math.max(0, Math.min(chart!.width - o.w, o.x + dx)),
        y: Math.max(0, Math.min(chart!.height - o.h, o.y + dy)),
      });
    setPreview(null);
  }

  function composeManual() {
    if (!cutout || !placement) return;
    setPreview(composePictorial(chart!, cutout, [{ p: placement, opacity: 1, behind: false }])); // tool_6 compose
  }

  function save() {
    if (!preview) return;
    dispatch({
      type: "set",
      patch: {
        pictorials: [{ id: uid("pc"), process: mode, svg: preview, label: label || "cutout", createdAt: Date.now() }, ...state.pictorials],
      },
    });
  }

  const step = !crop ? 1 : !cutout ? 2 : 3;

  return (
    <div className="pictorial">
      <div className="toolbar">
        <div className="segmented">
          <button className={mode === 6 ? "active" : ""} onClick={() => { setMode(6); setPreview(null); }}>
            Auto placement
          </button>
          <button className={mode === 7 ? "active" : ""} onClick={() => { setMode(7); setPreview(null); }}>
            Place manually
          </button>
        </div>
        <ol className="steps">
          <li className={step === 1 ? "cur" : "done"}>1 · Drag a region on the scene</li>
          <li className={step === 2 ? "cur" : step > 2 ? "done" : ""}>2 · Click the object, extract</li>
          <li className={step === 3 ? "cur" : ""}>{mode === 6 ? "3 · Review composition" : "3 · Place on chart, compose"}</li>
        </ol>
        <span className="grow" />
        <button className="ghost small" onClick={resetAll}>
          Start over
        </button>
      </div>

      <div className="pictorial-grid">
        <section>
          <h3>1 · Scene region</h3>
          <div
            className="region-stage"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              const p = toScene(e);
              setDragStart(p);
              setRegion({ x: p.x, y: p.y, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              if (!dragStart) return;
              const p = toScene(e);
              setRegion({
                x: Math.min(p.x, dragStart.x),
                y: Math.min(p.y, dragStart.y),
                w: Math.abs(p.x - dragStart.x),
                h: Math.abs(p.y - dragStart.y),
              });
            }}
            onPointerUp={() => {
              if (dragStart && region) finishRegion(region);
              setDragStart(null);
            }}
          >
            <img ref={sceneRef} src={svgDataUrl(scene.svg)} alt="Scene" draggable={false} />
            {region && (
              <div
                className="region"
                style={{
                  left: `${(region.x / scene.width) * 100}%`,
                  top: `${(region.y / scene.height) * 100}%`,
                  width: `${(region.w / scene.width) * 100}%`,
                  height: `${(region.h / scene.height) * 100}%`,
                }}
              />
            )}
          </div>
        </section>

        <section>
          <h3>2 · Object</h3>
          {!crop && <p className="muted">Drag a rectangle around the object you want to cut out.</p>}
          {crop && (
            <>
              <p className="muted small">Click on the object (green). Shift-click or right-click to exclude areas (red).</p>
              <div
                className="crop-stage checker"
                style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
                onClick={addPoint}
                onContextMenu={addPoint}
              >
                <img src={cropUrl} alt="Region" draggable={false} />
                <svg viewBox={`0 0 ${crop.width} ${crop.height}`} preserveAspectRatio="none">
                  {polygon && (
                    <polygon
                      points={polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(29,185,84,0.25)"
                      stroke="#1db954"
                      strokeWidth={Math.max(1.5, crop.width / 250)}
                    />
                  )}
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={Math.max(5, crop.width / 70)} fill={p.positive ? "#1db954" : "#e63946"} stroke="#fff" strokeWidth={2} />
                  ))}
                </svg>
              </div>
              <div className="row">
                <button className="primary" disabled={busy || !points.some((p) => p.positive)} onClick={extract}>
                  {busy ? "Extracting…" : polygon ? "Extract again" : "Extract object"}
                </button>
                <button className="ghost small" onClick={() => { setPoints([]); setPolygon(null); setCutout(null); setPreview(null); }}>
                  Clear points
                </button>
              </div>
              {busy && (
                <div className="loading">
                  <div className="spinner" /> The vision model is tracing the object outline…
                </div>
              )}
              {error && <p className="error">{error}</p>}
              {warning && <p className="warn-text">{warning}</p>}
              {cutout && (
                <div className="cutout-preview checker">
                  <img src={cutout.dataUrl} alt={label} />
                  <span className="muted small">{label}</span>
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h3>3 · Pictorial chart</h3>
          {!cutout && <p className="muted">The cut-out object will be composed onto your {chart.type} chart.</p>}
          {cutout && mode === 7 && !preview && placement && (
            <>
              <p className="muted small">Drag the object to place it; drag the corner handle to resize.</p>
              <div
                ref={chartRef}
                className="place-stage"
                style={{ aspectRatio: `${chart.width} / ${chart.height}` }}
                onPointerMove={onPlaceMove}
                onPointerUp={() => setPlaceDrag(null)}
              >
                <img src={svgDataUrl(chart.svg)} alt="Chart" draggable={false} />
                <div
                  className="placed"
                  style={{
                    left: `${(placement.x / chart.width) * 100}%`,
                    top: `${(placement.y / chart.height) * 100}%`,
                    width: `${(placement.w / chart.width) * 100}%`,
                    height: `${(placement.h / chart.height) * 100}%`,
                  }}
                  onPointerDown={(e) => onPlaceDown(e, false)}
                >
                  <img src={cutout.dataUrl} alt="" draggable={false} />
                  <span className="handle" onPointerDown={(e) => onPlaceDown(e, true)} />
                </div>
              </div>
              <button className="primary" onClick={composeManual}>
                Compose
              </button>
            </>
          )}
          {preview && (
            <>
              <img className="chart-img" src={svgDataUrl(preview)} alt="Pictorial chart" />
              <div className="row">
                <button className="primary" onClick={save}>
                  Keep result
                </button>
                {mode === 7 && (
                  <button className="ghost small" onClick={() => setPreview(null)}>
                    Adjust placement
                  </button>
                )}
                <button className="ghost small" onClick={() => download("pictorial-chart.svg", preview)}>
                  Download SVG
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {state.pictorials.length > 0 && (
        <section className="kept">
          <h3>Kept pictorial charts</h3>
          <div className="results row-wrap">
            {state.pictorials.map((p) => (
              <figure key={p.id} className="result">
                <img src={svgDataUrl(p.svg)} alt={p.label} />
                <figcaption>
                  <span>
                    {p.label} · {p.process === 6 ? "auto" : "manual"}
                  </span>
                  <button className="ghost small" onClick={() => download(`pictorial-${p.id}.svg`, p.svg)}>
                    Download
                  </button>
                  <button
                    className="icon"
                    onClick={() => dispatch({ type: "set", patch: { pictorials: state.pictorials.filter((x) => x.id !== p.id) } })}
                  >
                    ×
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
