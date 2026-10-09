import { useEffect, useMemo, useRef, useState } from "react";
import type { StepProps } from "../App.tsx";
import { ErrorNote, Panel, Spinner } from "../components.tsx";
import { api } from "../api.ts";
import { uid } from "../store.ts";
import { parseViewBox } from "../tools/sanitize.ts";
import { clientToUser, intersects, measureElements, unionBox, type ElementGeometry } from "../tools/svg.ts";
import type { Rect, Segment, SegmentLabel } from "../types.ts";

const COLORS = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#c2255c", "#5c940d"];

export default function SegmentStep({ state, update, go }: StepProps) {
  const r11 = state.r11!;
  const vb = parseViewBox(r11.svg);
  const holder = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"select" | "edit">(state.r13.length ? "edit" : "select");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [active, setActive] = useState<string | null>(state.r13[0]?.id ?? null);
  const [geom, setGeom] = useState<ElementGeometry[]>([]);

  const svgEl = () => holder.current?.querySelector("svg") as SVGSVGElement | null;

  useEffect(() => {
    const measure = () => {
      const el = svgEl();
      if (el) setGeom(measureElements(el));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [r11.svg]);
  const geomById = useMemo(() => new Map(geom.map((g) => [g.id, g])), [geom]);

  const categoryFields = state.r2?.columns.filter((c) => c.type === "category").map((c) => c.name) ?? [];

  // ---- Process 4 · human select: draw rectangles -> r12*
  const toUser = (e: React.PointerEvent) => {
    const el = svgEl();
    return el ? clientToUser(el, e.clientX, e.clientY) : { x: 0, y: 0 };
  };
  const onDown = (e: React.PointerEvent) => {
    if (mode !== "select") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toUser(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toUser(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag) return;
    const r: Rect = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (r.w > 4 && r.h > 4) update((s) => ({ ...s, r12: [...s.r12, r] }));
  };

  // ---- Process 4 · model_3 extract: r11 + r12* -> r13_1*
  const runSegmentation = async () => {
    const elements = geom.filter((g) => state.r12.some((r) => intersects(g.bbox, r)));
    update((s) => ({ ...s, segStatus: "pending", segError: undefined }));
    try {
      const { segments } = await api.segment(elements, state.r12);
      const r13: Segment[] = segments.map((s) => ({
        id: uid("s"),
        name: s.name,
        elementIds: s.elementIds,
        bbox: unionBox(s.elementIds.map((id) => geomById.get(id)!.bbox).filter(Boolean)),
      }));
      const r14: SegmentLabel[] = r13.map((s) => ({ segmentId: s.id, role: "anchor" }));
      update((s) => ({ ...s, r13, r13Version: 1, r14, segStatus: "done" }));
      setActive(r13[0]?.id ?? null);
      setMode("edit");
    } catch (e) {
      update((s) => ({ ...s, segStatus: "error", segError: (e as Error).message }));
    }
  };

  // ---- Process 4 · human modify: r13_1* -> r13_2*
  const editSegments = (fn: (segs: Segment[]) => Segment[]) =>
    update((s) => {
      const r13 = fn(s.r13).map((seg) => ({ ...seg, bbox: unionBox(seg.elementIds.map((id) => geomById.get(id)?.bbox).filter((b): b is ElementGeometry["bbox"] => !!b)) }));
      const ids = new Set(r13.map((x) => x.id));
      return { ...s, r13, r13Version: 2, r14: s.r14.filter((l) => ids.has(l.segmentId)) };
    });
  const onCanvasClick = (e: React.MouseEvent) => {
    if (mode !== "edit" || !active) return;
    const eid = (e.target as Element).closest("[data-eid]")?.getAttribute("data-eid");
    if (!eid) return;
    editSegments((segs) =>
      segs.map((seg) => {
        if (seg.id === active) {
          const has = seg.elementIds.includes(eid);
          return { ...seg, elementIds: has ? seg.elementIds.filter((x) => x !== eid) : [...seg.elementIds, eid] };
        }
        return { ...seg, elementIds: seg.elementIds.filter((x) => x !== eid) }; // an element belongs to one segment
      }),
    );
  };
  const addSegment = () => {
    const id = uid("s");
    update((s) => ({
      ...s,
      r13: [...s.r13, { id, name: `element ${s.r13.length + 1}`, elementIds: [], bbox: { x: 0, y: 0, w: 0, h: 0 } }],
      r13Version: 2,
      r14: [...s.r14, { segmentId: id, role: "anchor" }],
    }));
    setActive(id);
    setMode("edit");
  };

  // ---- Process 4 · human assign: r13_2* -> r14*
  const setLabel = (segmentId: string, patch: Partial<SegmentLabel>) =>
    update((s) => ({
      ...s,
      r14: s.r14.some((l) => l.segmentId === segmentId)
        ? s.r14.map((l) => (l.segmentId === segmentId ? { ...l, ...patch } : l))
        : [...s.r14, { segmentId, role: "anchor", ...patch }],
    }));

  const activeSeg = state.r13.find((s) => s.id === active);
  const highlightCss =
    mode === "edit" && activeSeg
      ? `.seg-edit [data-eid]{opacity:.28;transition:opacity .15s} ${activeSeg.elementIds.map((id) => `.seg-edit [data-eid="${id}"]`).join(",") || ".none"}{opacity:1}`
      : "";
  const hasMark = state.r14.some((l) => l.role === "mark" && l.field && state.r13.find((s) => s.id === l.segmentId)?.elementIds.length);

  return (
    <div className="step">
      <h2>3 · Segment &amp; bind</h2>
      <p className="lead">
        Draw boxes around the objects you want to use <code className="tag">r12</code>, let the model cut them out{" "}
        <code className="tag">r13</code>, fix the cut by clicking shapes, then bind each object to the data{" "}
        <code className="tag">r14</code>.
      </p>
      <div className="grid-side">
        <Panel
          title="Illustration"
          tag="r11 · visual"
          actions={
            <div className="tabs">
              <button className={mode === "select" ? "active" : ""} onClick={() => setMode("select")}>
                Draw selections
              </button>
              <button className={mode === "edit" ? "active" : ""} disabled={!state.r13.length} onClick={() => setMode("edit")}>
                Edit segments
              </button>
            </div>
          }
        >
          <div className={`canvas ${mode === "edit" ? "seg-edit" : "seg-select"}`} onClick={onCanvasClick}>
            <style>{highlightCss}</style>
            <div ref={holder} className="svgbox" dangerouslySetInnerHTML={{ __html: r11.svg }} />
            <svg
              className="overlay"
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              style={{ pointerEvents: mode === "select" ? "all" : "none" }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {mode === "select" &&
                state.r12.map((r, i) => (
                  <g key={i}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} className="sel" />
                    <text x={r.x + 3} y={r.y + 11} className="sel-label">
                      S{i + 1}
                    </text>
                  </g>
                ))}
              {drag && (
                <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="sel drawing" />
              )}
              {mode === "edit" &&
                state.r13.map((s, i) => (
                  <g key={s.id} opacity={s.id === active ? 1 : 0.55}>
                    <rect x={s.bbox.x - 1} y={s.bbox.y - 1} width={s.bbox.w + 2} height={s.bbox.h + 2} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={s.id === active ? 2 : 1} strokeDasharray={s.id === active ? "" : "4 2"} />
                    <text x={s.bbox.x} y={s.bbox.y - 3} fill={COLORS[i % COLORS.length]} fontSize={10} fontWeight="bold">
                      {s.name}
                    </text>
                  </g>
                ))}
            </svg>
          </div>
          <p className="muted small">
            {mode === "select"
              ? "Drag on the illustration to draw a box around each object (or group of similar objects)."
              : activeSeg
                ? `Click shapes to add them to or remove them from “${activeSeg.name}”.`
                : "Pick a segment on the right to edit it."}
          </p>
        </Panel>
        <div>
          <Panel title="Selections" tag="r12 · selection spatial*">
            {state.r12.length === 0 && <p className="muted">No boxes yet.</p>}
            <ul className="chips">
              {state.r12.map((_, i) => (
                <li key={i}>
                  S{i + 1}{" "}
                  <button className="x" onClick={() => update((s) => ({ ...s, r12: s.r12.filter((_, j) => j !== i) }))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={!state.r12.length || state.segStatus === "pending" || !geom.length} onClick={runSegmentation}>
              {state.r13.length ? "Re-segment selections" : "Segment selections"}
            </button>
            {state.segStatus === "pending" && <Spinner label="Finding objects (model_3)…" />}
            {state.segStatus === "error" && <ErrorNote msg={state.segError ?? "failed"} onRetry={runSegmentation} />}
          </Panel>
          <Panel
            title="Segments & labels"
            tag={`r13_${Math.max(state.r13Version, 1)} · spatial* + r14 · label*`}
            actions={
              <button className="ghost small" onClick={addSegment}>
                + segment
              </button>
            }
          >
            {state.r13.length === 0 && <p className="muted">Segments appear here after segmentation.</p>}
            {state.r13.map((seg, i) => {
              const label = state.r14.find((l) => l.segmentId === seg.id);
              return (
                <div key={seg.id} className={`segrow ${seg.id === active ? "active" : ""}`} onClick={() => { setActive(seg.id); setMode("edit"); }}>
                  <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
                  <input value={seg.name} onChange={(e) => editSegments((segs) => segs.map((x) => (x.id === seg.id ? { ...x, name: e.target.value } : x)))} />
                  <span className="muted small">{seg.elementIds.length} shapes</span>
                  <button className="x" title="Delete segment" onClick={(e) => { e.stopPropagation(); editSegments((segs) => segs.filter((x) => x.id !== seg.id)); }}>
                    ×
                  </button>
                  <div className="labelrow" onClick={(e) => e.stopPropagation()}>
                    <select value={label?.role ?? "anchor"} onChange={(e) => setLabel(seg.id, { role: e.target.value as SegmentLabel["role"] })}>
                      <option value="mark">mark — redraw per category</option>
                      <option value="anchor">anchor — position only</option>
                      <option value="decoration">decoration — ignore</option>
                    </select>
                    {label?.role === "mark" && (
                      <select value={label.field ?? ""} onChange={(e) => setLabel(seg.id, { field: e.target.value || undefined })}>
                        <option value="">field…</option>
                        {categoryFields.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </Panel>
          <div className="cta">
            <span className="muted small">{hasMark ? "" : "Label at least one segment as a mark bound to a category field."}</span>
            <button className="primary" disabled={!hasMark} onClick={() => go(3)}>
              Continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
