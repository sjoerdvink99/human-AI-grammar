// Process 3 — "Voice collage": prompt + boxes + voice notes → labels → records → descriptions → item images → collage.
import { useMemo, useRef, useState } from "react";
import { toCanvasPoint } from "../components/DrawCanvas";
import { ErrorBox, Steps, type StepInfo } from "../components/Steps";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { api, downloadSvg, svgUrl, uid } from "../lib/api";
import { CANVAS_H, CANVAS_W, CATEGORIES, type Box, type ItemRecord, type Label, type VoiceNote } from "../shared/types";
import { composeCollage, composeRecords, transcriptToCategory } from "../tools/tool3";

type Tool = "draw" | "move";
type ItemState = { description?: string; svg?: string; status: "describing" | "drawing" | "done" | "error"; error?: string };

const BOX_COLORS = ["#0091ff", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6", "#d6409f", "#12a594", "#ad7f58"];

export function CollageMode() {
  const [globalPrompt, setGlobalPrompt] = useState(""); // r16_1
  const [boxes, setBoxes] = useState<Box[]>([]); // r18
  const [boxesModified, setBoxesModified] = useState(false); // r18_1 → r18_2
  const [tool, setTool] = useState<Tool>("draw");
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, VoiceNote>>({}); // r19_1*
  const [labels, setLabels] = useState<Label[] | null>(null); // r20_1*
  const [records, setRecords] = useState<ItemRecord[] | null>(null); // r21_1*
  const [items, setItems] = useState<Record<string, ItemState>>({}); // r22_1*, r23_1*
  const [collage, setCollage] = useState<string | null>(null); // r24_1
  const [error, setError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "new" | "move" | "resize"; id: string; ox: number; oy: number; start: Box } | null>(null);

  const colorOf = (id: string) => BOX_COLORS[boxes.findIndex((b) => b.id === id) % BOX_COLORS.length];
  const invalidateDownstream = () => { setLabels(null); setRecords(null); setItems({}); setCollage(null); };

  // P3.1 [human specify] draw boxes / P3.2 [human modify] move & resize boxes
  const onDown = (e: React.PointerEvent, target?: { id: string; kind: "move" | "resize" }) => {
    if (!svgRef.current) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toCanvasPoint(svgRef.current, e);
    if (target) {
      const b = boxes.find((x) => x.id === target.id)!;
      setSelected(b.id);
      drag.current = { kind: target.kind, id: b.id, ox: p.x, oy: p.y, start: b };
    } else if (tool === "draw") {
      const b: Box = { id: uid("b"), x: p.x, y: p.y, w: 0, h: 0 };
      setBoxes((a) => [...a, b]);
      setSelected(b.id);
      drag.current = { kind: "new", id: b.id, ox: p.x, oy: p.y, start: b };
    } else setSelected(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !svgRef.current) return;
    const p = toCanvasPoint(svgRef.current, e);
    const dx = p.x - d.ox, dy = p.y - d.oy, s = d.start;
    let nb: Box;
    if (d.kind === "new") nb = { ...s, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    else if (d.kind === "move") nb = { ...s, x: Math.max(0, Math.min(CANVAS_W - s.w, s.x + dx)), y: Math.max(0, Math.min(CANVAS_H - s.h, s.y + dy)) };
    else nb = { ...s, w: Math.max(20, Math.min(CANVAS_W - s.x, s.w + dx)), h: Math.max(20, Math.min(CANVAS_H - s.y, s.h + dy)) };
    setBoxes((a) => a.map((b) => (b.id === d.id ? nb : b)));
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === "new") setBoxes((a) => a.filter((b) => b.id !== d.id || (b.w >= 20 && b.h >= 20)));
    else setBoxesModified(true);
    invalidateDownstream();
  };
  const removeBox = (id: string) => {
    setBoxes((a) => a.filter((b) => b.id !== id));
    setNotes((n) => { const c = { ...n }; delete c[id]; return c; });
    invalidateDownstream();
  };

  // P3.4 [tool_3 translate] r19_1* → r20_1*
  const interpret = () => {
    setLabels(boxes.map((b) => {
      const t = notes[b.id]?.transcript ?? "";
      return { boxId: b.id, transcript: t, category: transcriptToCategory(t) };
    }));
    setRecords(null); setItems({}); setCollage(null);
  };
  const allLabelled = !!labels && boxes.length > 0 && labels.length === boxes.length && labels.every((l) => l.category);

  // P3.8 [tool_3 compose]
  const recompose = (recs: ItemRecord[], its: Record<string, ItemState>) => {
    const imgs = recs.flatMap((r) => (its[r.boxId]?.svg ? [{ boxId: r.boxId, svg: its[r.boxId].svg! }] : []));
    setCollage(imgs.length === recs.length ? composeCollage(recs, imgs, globalPrompt) : null);
  };

  const itemsRef = useRef(items);
  const patch = (id: string, p: Partial<ItemState>) => {
    itemsRef.current = { ...itemsRef.current, [id]: { ...itemsRef.current[id], ...p } as ItemState };
    setItems(itemsRef.current);
  };

  // P3.6 [model_2 generate]~ for one record
  const describe = async (r: ItemRecord) => {
    patch(r.boxId, { status: "describing", error: undefined, svg: undefined });
    try {
      const { text } = await api.describe(globalPrompt, r);
      patch(r.boxId, { description: text });
      return true;
    } catch (e) { patch(r.boxId, { status: "error", error: (e as Error).message }); return false; }
  };
  // P3.7 [model_1 generate]~ for one record
  const draw = async (r: ItemRecord) => {
    const d = itemsRef.current[r.boxId]?.description; if (!d) return;
    patch(r.boxId, { status: "drawing", error: undefined });
    try {
      const { svg } = await api.generateItem(r, d);
      patch(r.boxId, { svg, status: "done" });
    } catch (e) { patch(r.boxId, { status: "error", error: (e as Error).message }); }
  };

  const generate = async () => {
    if (!labels) return;
    setError(null); setCollage(null);
    // P3.5 [tool_3 compose] r16 + r18_2* + r20_1* → r21_1*
    const recs = composeRecords(globalPrompt, boxes, labels);
    if (recs.length === 0) { setError("No labelled boxes to generate."); return; }
    setRecords(recs);
    itemsRef.current = {}; setItems({});
    const ok = await Promise.all(recs.map(describe)); // all descriptions (r22) first …
    await Promise.all(recs.filter((_, i) => ok[i]).map(draw)); // … then all item images (r23)
    recompose(recs, itemsRef.current);
  };

  const redoItem = async (r: ItemRecord, what: "description" | "image") => {
    setCollage(null);
    if (what === "description" && !(await describe(r))) return;
    await draw(r);
    if (records) recompose(records, itemsRef.current);
  };

  const anyBusy = Object.values(items).some((i) => i.status === "describing" || i.status === "drawing");
  const recorded = boxes.filter((b) => notes[b.id]?.transcript || notes[b.id]?.audioUrl).length;
  const steps: StepInfo[] = [
    { id: "1", actor: "human", op: "specify", label: "Draw boxes (r18_1)", status: boxes.length ? "done" : "ready" },
    { id: "2", actor: "human", op: "modify", label: "Move / resize boxes (r18_2)", status: boxesModified ? "done" : boxes.length ? "ready" : "todo" },
    { id: "3", actor: "human", op: "specify", label: `Voice note per box (r19) ${recorded}/${boxes.length}`, status: boxes.length && recorded === boxes.length ? "done" : boxes.length ? "ready" : "todo" },
    { id: "4", actor: "tool_3", op: "translate", label: "Voice → category (r20)", status: labels ? (allLabelled ? "done" : "error") : recorded ? "ready" : "todo" },
    { id: "5", actor: "tool_3", op: "compose", label: "Compose records (r21)", status: records ? "done" : allLabelled ? "ready" : "todo" },
    { id: "6", actor: "model_2", op: "generate", label: "Describe each item (r22)", generative: true,
      status: Object.values(items).some((i) => i.status === "describing") ? "running" : records && Object.values(items).some((i) => i.description) ? "done" : "todo" },
    { id: "7", actor: "model_1", op: "generate", label: "Draw each item (r23)", generative: true,
      status: Object.values(items).some((i) => i.status === "drawing") ? "running" : records && Object.values(items).some((i) => i.svg) ? "done" : "todo" },
    { id: "8", actor: "tool_3", op: "compose", label: "Compose collage (r24)", status: collage ? "done" : "todo" },
  ];

  return (
    <div className="mode">
      <div className="stage">
        <label className="prompt">
          Scene prompt (r16)
          <textarea value={globalPrompt} onChange={(e) => { setGlobalPrompt(e.target.value); setRecords(null); setCollage(null); }} placeholder="e.g. a sunny afternoon in a park, flat pastel illustration style" rows={2} />
        </label>
        <div className="toolbar">
          <button className={tool === "draw" ? "on" : ""} onClick={() => setTool("draw")}>▭ Draw boxes</button>
          <button className={tool === "move" ? "on" : ""} onClick={() => setTool("move")}>✥ Move / resize</button>
          <span className="hint">{tool === "draw" ? "Drag on the canvas to place a box for each thing in the picture." : "Drag a box to move it, its corner to resize."}</span>
        </div>
        {collage ? (
          <>
            <img className="canvas" src={svgUrl(collage)} alt="collage" />
            <div className="toolbar">
              <button onClick={() => setCollage(null)}>Back to boxes</button>
              <button onClick={() => downloadSvg(collage, "collage.svg")}>Download SVG</button>
            </div>
          </>
        ) : (
          <svg ref={svgRef} className={`canvas ${tool}`} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp}>
            <rect width={CANVAS_W} height={CANVAS_H} fill="#fff" />
            {boxes.map((b, i) => {
              const l = labels?.find((x) => x.boxId === b.id);
              const it = items[b.id];
              const c = colorOf(b.id);
              return (
                <g key={b.id}>
                  {it?.svg && <image href={svgUrl(it.svg)} x={b.x} y={b.y} width={b.w} height={b.h} />}
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={c} fillOpacity={it?.svg ? 0 : 0.12} stroke={c} strokeWidth={selected === b.id ? 3 : 2}
                    onPointerDown={tool === "move" ? (e) => onDown(e, { id: b.id, kind: "move" }) : undefined} style={{ cursor: tool === "move" ? "move" : undefined }} />
                  <text x={b.x + 6} y={b.y + 18} fontSize={14} fontWeight={700} fill={c} pointerEvents="none">{i + 1}{l ? ` · ${l.category ?? "?"}` : ""}</text>
                  {tool === "move" && <rect x={b.x + b.w - 8} y={b.y + b.h - 8} width={14} height={14} fill={c} style={{ cursor: "nwse-resize" }} onPointerDown={(e) => onDown(e, { id: b.id, kind: "resize" })} />}
                </g>
              );
            })}
          </svg>
        )}
        <ErrorBox error={error} />
      </div>

      <aside className="panel">
        <h3>Process 3 · Voice collage</h3>
        <Steps steps={steps} />
        <section>
          <h4>Boxes & voice notes</h4>
          {boxes.length === 0 && <p className="mini">No boxes yet.</p>}
          <ul className="boxes">
            {boxes.map((b, i) => {
              const l = labels?.find((x) => x.boxId === b.id);
              const r = records?.find((x) => x.boxId === b.id);
              const it = items[b.id];
              return (
                <li key={b.id} className={selected === b.id ? "sel" : ""} onClick={() => setSelected(b.id)} style={{ borderLeftColor: colorOf(b.id) }}>
                  <div className="row"><b>Box {i + 1}</b>
                    {l && (l.category ? <span className="tag">{l.category}</span> : <span className="tag bad">not recognised — re-record</span>)}
                    <span className="grow" /><button className="x" onClick={() => removeBox(b.id)}>✕</button></div>
                  <VoiceRecorder boxId={b.id} note={notes[b.id]} onChange={(n) => { setNotes((a) => ({ ...a, [b.id]: n })); setLabels(null); setRecords(null); setCollage(null); }} />
                  {it?.description && <p className="desc">{it.description}</p>}
                  {it?.status === "describing" && <p className="mini">model_2 is describing…</p>}
                  {it?.status === "drawing" && <p className="mini">model_1 is drawing…</p>}
                  {it?.error && <p className="err">{it.error}</p>}
                  {r && it && !anyBusy && (
                    <div className="row">
                      <button className="chip" onClick={() => redoItem(r, "description")}>New description</button>
                      <button className="chip" disabled={!it.description} onClick={() => redoItem(r, "image")}>Redraw</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mini">Categories: {CATEGORIES.join(", ")}. Say e.g. “a big oak tree”.</p>
          <div className="toolbar">
            <button disabled={!recorded || anyBusy} onClick={interpret}>Interpret voice notes</button>
            <button className="primary" disabled={!allLabelled || anyBusy} onClick={generate}>{records ? "Regenerate all" : "Generate collage →"}</button>
          </div>
        </section>
        {records && (
          <section><h4>Records (r21)</h4><pre className="mini pre">{JSON.stringify(records.map(({ globalPrompt: _g, ...r }) => r), null, 1)}</pre></section>
        )}
      </aside>
    </div>
  );
}
