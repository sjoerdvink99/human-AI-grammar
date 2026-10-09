import { useMemo, useRef, useState } from "react";
import { renderAndSnapshot, useApp } from "../App";
import { retrieveProvenance } from "../../shared/provenance";
import { CANVAS } from "../../shared/sanitize";
import type { VisualElement } from "../../shared/types";
import { download, svgDataUrl } from "../tools/raster";
import { ElementEditor } from "./ElementEditor";

type Drag = { id: string; mode: "move" | "resize"; sx: number; sy: number; orig: VisualElement };

/** Processes 1 (output), 2 (provenance), 3 (evaluate → modify → re-render loop). */
export function ScenePanel({ busy }: { busy: boolean }) {
  const { state, dispatch } = useApp();
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const selected = state.elements.find((e) => e.id === state.selectedElementId) ?? null;

  // P2 — [tool_3 select]: selected element r9 → passages r10 + linked images r11*
  const provenance = useMemo(
    () => (selected ? retrieveProvenance(selected, state.documents, state.sourceImages) : null),
    [selected, state.documents, state.sourceImages],
  );

  if (!state.scene) {
    return (
      <div className="empty">
        {busy ? (
          <div className="loading">
            <div className="spinner" /> The model is drafting visual elements from your sources…
          </div>
        ) : (
          <>
            <h2>No scene yet</h2>
            <p>Write a brief, add source documents (or load the example) and press <b>Generate elements</b>.</p>
          </>
        )}
      </div>
    );
  }

  const scale = () => (stageRef.current ? stageRef.current.clientWidth / CANVAS.width : 1);

  function onPointerDown(e: React.PointerEvent, el: VisualElement, mode: Drag["mode"]) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dispatch({ type: "set", patch: { selectedElementId: el.id } }); // P2 [human select] → r9
    setDrag({ id: el.id, mode, sx: e.clientX, sy: e.clientY, orig: el });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const k = scale();
    const dx = (e.clientX - drag.sx) / k;
    const dy = (e.clientY - drag.sy) / k;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;
    const o = drag.orig;
    const patch =
      drag.mode === "move"
        ? {
            x: Math.round(Math.min(CANVAS.width - o.w, Math.max(0, o.x + dx))),
            y: Math.round(Math.min(CANVAS.height - o.h, Math.max(0, o.y + dy))),
          }
        : {
            w: Math.round(Math.min(CANVAS.width - o.x, Math.max(20, o.w + dx))),
            h: Math.round(Math.min(CANVAS.height - o.y, Math.max(20, o.h + dy))),
          };
    dispatch({ type: "updateElement", id: drag.id, patch }); // P3 [human modify] → r4_2
  }

  // P3 — tool_1 compose → tool_2 execute → tool_7 compose, closing the loop
  function rerender() {
    const { scene, snapshots } = renderAndSnapshot(state.elements, state.snapshots, state.critique.trim() || undefined);
    dispatch({ type: "set", patch: { scene, snapshots, elementsDirty: false, critique: "" } });
  }

  const round = state.snapshots.length ? state.snapshots[state.snapshots.length - 1].round : 0;

  return (
    <div className="scene-layout">
      <div className="scene-main">
        <div className="toolbar">
          <span className="pill">Round {round}</span>
          {state.elementsDirty && <span className="pill warn">Edited — scene shows the last render</span>}
          <span className="grow" />
          <button className="ghost small" onClick={() => download(`scene-round-${round}.svg`, state.scene!.svg)}>
            Download SVG
          </button>
        </div>
        <div
          className="stage"
          ref={stageRef}
          style={{ aspectRatio: `${CANVAS.width} / ${CANVAS.height}` }}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDrag(null)}
          onPointerDown={() => dispatch({ type: "set", patch: { selectedElementId: null } })}
        >
          <img src={svgDataUrl(state.scene.svg)} alt="Rendered scene" draggable={false} />
          {state.elements.map((el) => (
            <div
              key={el.id}
              className={`box ${el.id === state.selectedElementId ? "sel" : ""}`}
              style={{
                left: `${(el.x / CANVAS.width) * 100}%`,
                top: `${(el.y / CANVAS.height) * 100}%`,
                width: `${(el.w / CANVAS.width) * 100}%`,
                height: `${(el.h / CANVAS.height) * 100}%`,
              }}
              onPointerDown={(e) => onPointerDown(e, el, "move")}
              title={el.name}
            >
              <span className="box-label">{el.name}</span>
              <span className="handle" onPointerDown={(e) => onPointerDown(e, el, "resize")} />
            </div>
          ))}
        </div>

        <section className="critique">
          <h3>Evaluate this round</h3>
          <p className="muted">
            Note what works and what to change, then edit elements (drag on the scene or use the inspector) and re-render.
            The note is stored with the next snapshot.
          </p>
          <textarea
            rows={3}
            placeholder="e.g. The headline is too long; the hive illustration should be bigger; facts overlap."
            value={state.critique}
            onChange={(e) => dispatch({ type: "set", patch: { critique: e.target.value } })}
          />
          <div className="row">
            <button className="primary" onClick={rerender} disabled={!state.elementsDirty && !state.critique.trim()}>
              Re-render &amp; snapshot
            </button>
            <span className="muted small">Adds round {round + 1} to the Gallery; earlier rounds are kept.</span>
          </div>
        </section>
      </div>

      <aside className="inspector">
        <h3>Elements ({state.elements.length})</h3>
        <ul className="el-list">
          {state.elements.map((el) => (
            <li
              key={el.id}
              className={el.id === state.selectedElementId ? "sel" : ""}
              onClick={() => dispatch({ type: "set", patch: { selectedElementId: el.id } })}
            >
              <span className="swatch" style={{ background: el.color }} />
              <span className="grow">{el.name}</span>
              <span className="kind">{el.kind}</span>
            </li>
          ))}
        </ul>

        {selected && provenance && (
          <>
            <section className="provenance">
              <h3>Sources for “{selected.name}”</h3>
              {provenance.passages.length === 0 && <p className="muted">This element cites no source passage.</p>}
              {provenance.passages.map((p, i) => (
                <blockquote key={i} className={p.found ? "" : "notfound"}>
                  <div className="doc-title">{p.docTitle}</div>
                  {p.found ? (
                    <>
                      {p.before}
                      <mark>{p.match}</mark>
                      {p.after}
                    </>
                  ) : (
                    <>
                      <em>Quote not found verbatim in the document:</em> “{p.match}”
                    </>
                  )}
                </blockquote>
              ))}
              {provenance.images.length > 0 && (
                <div className="linked-images">
                  {provenance.images.map((img) => (
                    <figure key={img.id}>
                      <img src={img.dataUrl} alt={img.caption} />
                      <figcaption>{img.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
            <ElementEditor el={selected} />
          </>
        )}
        {!selected && <p className="muted">Select an element on the scene or in the list to see its sources and edit it.</p>}
      </aside>
    </div>
  );
}
