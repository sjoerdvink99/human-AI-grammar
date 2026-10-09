// tool_2 — deterministic renderers (translate record/tabular/graph -> visual).
// renderDiagram: r13 -> r14 / r21   renderChart: r17 -> r18   renderTree: r22

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

const ROW_H = 22, HEAD_H = 30, BOX_W = 230;
export const ROLE_BADGE = { primary_key: "PK", foreign_key: "FK", attribute: "" };

/** Default grid positions for entities, kept by the caller so dragging persists. */
export function defaultLayout(dm, prev = {}) {
  const pos = { ...prev };
  const n = dm.entities.length, cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  dm.entities.forEach((e, i) => {
    if (!pos[e.name]) pos[e.name] = { x: 40 + (i % cols) * (BOX_W + 120), y: 40 + Math.floor(i / cols) * 260 };
  });
  return pos;
}

/**
 * Render the data model as an ER diagram.
 * opts: { positions, selection, onSelect(sel), onMove(name,pos), showModelDisagreement }
 */
export function renderDiagram(svg, dm, opts) {
  svg.innerHTML = "";
  svg._ac?.abort();
  svg._ac = new AbortController();
  const sig = { signal: svg._ac.signal };
  const pos = opts.positions;
  const defs = el("defs", {}, svg);
  const mk = el("marker", { id: "many", viewBox: "0 0 12 12", refX: "1", refY: "6", markerWidth: "12", markerHeight: "12", orient: "auto-start-reverse" }, defs);
  el("path", { d: "M12 6 L1 1 M12 6 L1 6 M12 6 L1 11", stroke: "#475569", fill: "none", "stroke-width": "1.3" }, mk);
  const one = el("marker", { id: "one", viewBox: "0 0 12 12", refX: "11", refY: "6", markerWidth: "12", markerHeight: "12", orient: "auto-start-reverse" }, defs);
  el("path", { d: "M8 1 L8 11", stroke: "#475569", "stroke-width": "1.5" }, one);

  const colY = (ent, col) => {
    const i = ent.columns.findIndex((c) => c.name === col);
    return pos[ent.name].y + HEAD_H + i * ROW_H + ROW_H / 2;
  };
  const ents = Object.fromEntries(dm.entities.map((e) => [e.name, e]));

  const linkLayer = el("g", {}, svg);
  const boxLayer = el("g", {}, svg);

  const drawLinks = () => {
    linkLayer.innerHTML = "";
    for (const r of dm.relationships) {
      const a = ents[r.from_table], b = ents[r.to_table];
      if (!a || !b) continue;
      const pa = pos[a.name], pb = pos[b.name];
      const y1 = colY(a, r.from_column), y2 = colY(b, r.to_column);
      let d;
      if (Math.abs(pa.x - pb.x) < BOX_W + 20) {
        // stacked boxes: leave and enter on the right side with a loop
        const x1 = pa.x + BOX_W, x2 = pb.x + BOX_W, xo = Math.max(x1, x2) + 60;
        d = `M${x1} ${y1} C${xo} ${y1} ${xo} ${y2} ${x2} ${y2}`;
      } else {
        const aRight = pa.x < pb.x;
        const x1 = aRight ? pa.x + BOX_W : pa.x, x2 = aRight ? pb.x : pb.x + BOX_W;
        const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (aRight ? 1 : -1);
        d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      }
      const sel = opts.selection?.kind === "relationship" && opts.selection.id === r.id;
      const g = el("g", { class: "rel" + (sel ? " selected" : "") }, linkLayer);
      const manyEnd = r.cardinality === "1:1" ? "url(#one)" : "url(#many)";
      el("path", { d, class: "rel-line", "marker-start": manyEnd, "marker-end": "url(#one)" }, g);
      el("path", { d, class: "rel-hit" }, g);
      const line = g.querySelector(".rel-line");
      const mid = line.getTotalLength ? line.getPointAtLength(line.getTotalLength() / 2) : { x: 0, y: 0 };
      const t = el("text", { x: mid.x, y: mid.y - 6, class: "rel-label" }, g);
      t.textContent = r.cardinality;
      g.addEventListener("click", (ev) => { ev.stopPropagation(); opts.onSelect({ kind: "relationship", id: r.id }); });
      const tip = el("title", {}, g);
      tip.textContent = `${r.from_table}.${r.from_column} → ${r.to_table}.${r.to_column} (${r.cardinality})`;
    }
  };

  for (const e of dm.entities) {
    const p = pos[e.name];
    const h = HEAD_H + e.columns.length * ROW_H;
    const selected = opts.selection?.kind === "entity" && opts.selection.id === e.name;
    const g = el("g", { class: "entity" + (selected ? " selected" : ""), transform: `translate(${p.x},${p.y})` }, boxLayer);
    el("rect", { width: BOX_W, height: h, rx: 6, class: "entity-box" }, g);
    el("rect", { width: BOX_W, height: HEAD_H, rx: 6, class: "entity-head" }, g);
    const title = el("text", { x: 10, y: 20, class: "entity-title" }, g);
    title.textContent = e.label && e.label !== e.name ? `${e.label}  (${e.name})` : e.name;
    e.columns.forEach((c, i) => {
      const y = HEAD_H + i * ROW_H;
      const colSel = selected && opts.selection.column === c.name;
      const row = el("g", { class: "col-row" + (colSel ? " selected" : ""), transform: `translate(0,${y})` }, g);
      el("rect", { width: BOX_W, height: ROW_H, class: "col-bg" }, row);
      const badge = ROLE_BADGE[c.role] || "";
      if (badge) {
        el("rect", { x: 6, y: 4, width: 24, height: 14, rx: 3, class: `badge ${c.role}` }, row);
        const bt = el("text", { x: 18, y: 15, class: "badge-text" }, row);
        bt.textContent = badge;
      }
      const nt = el("text", { x: 36, y: 15, class: "col-name" + (c.role === "primary_key" ? " pk" : "") }, row);
      nt.textContent = c.name;
      const tt = el("text", { x: BOX_W - 8, y: 15, class: "col-type" }, row);
      tt.textContent = `${c.data_type} · ${c.semantic_type}`;
      if (opts.showModelDisagreement && c.model_role && c.model_role !== c.role) {
        const w = el("text", { x: BOX_W - 4, y: 15, class: "warn" }, row);
        w.textContent = "⚠";
        tt.setAttribute("x", BOX_W - 20);
      }
      const tip = el("title", {}, row);
      tip.textContent = `${e.name}.${c.name}\nrole: ${c.role}` +
        (c.rule_role ? `\nrule label: ${c.rule_role}` : "") +
        (c.model_role ? `\nclassifier label: ${c.model_role} (${c.confidence})` : `\nclassifier confidence: ${c.confidence}`);
      row.addEventListener("click", (ev) => { ev.stopPropagation(); opts.onSelect({ kind: "entity", id: e.name, column: c.name }); });
    });
    // drag by header, click header to select the entity
    let start = null, moved = false;
    const head = g.querySelector(".entity-head");
    const onDown = (ev) => { start = { mx: ev.clientX, my: ev.clientY, x: p.x, y: p.y }; moved = false; ev.preventDefault(); };
    head.addEventListener("mousedown", onDown);
    title.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      p.x = start.x + dx; p.y = start.y + dy;
      g.setAttribute("transform", `translate(${p.x},${p.y})`);
      drawLinks();
    }, sig);
    window.addEventListener("mouseup", () => {
      if (!start) return;
      start = null;
      if (moved) opts.onMove?.(e.name, p); else opts.onSelect({ kind: "entity", id: e.name });
    }, sig);
  }
  drawLinks();
  // fit the viewBox to the content
  const maxX = Math.max(...dm.entities.map((e) => pos[e.name].x + BOX_W)) + 60;
  const maxY = Math.max(...dm.entities.map((e) => pos[e.name].y + HEAD_H + e.columns.length * ROW_H)) + 60;
  svg.setAttribute("width", Math.max(maxX, 600));
  svg.setAttribute("height", Math.max(maxY, 400));
}

/** r17 -> r18: horizontal bar chart of a label/value result table. */
export function renderChart(svg, result) {
  svg.innerHTML = "";
  const rows = result.rows.map((r) => ({ label: r[0] === null ? "(null)" : String(r[0]), value: Number(r[1]) || 0 }));
  const W = 360, barH = 18, gap = 6, left = 110, top = 28;
  const H = top + rows.length * (barH + gap) + 10;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  const t = el("text", { x: 0, y: 16, class: "chart-title" }, svg);
  t.textContent = result.title;
  const max = Math.max(1, ...rows.map((r) => r.value));
  rows.forEach((r, i) => {
    const y = top + i * (barH + gap);
    const lab = el("text", { x: left - 8, y: y + 13, class: "chart-label" }, svg);
    lab.textContent = r.label.length > 16 ? r.label.slice(0, 15) + "…" : r.label;
    const w = ((W - left - 45) * r.value) / max;
    el("rect", { x: left, y, width: Math.max(1, w), height: barH, rx: 3, class: "chart-bar" }, svg);
    const v = el("text", { x: left + w + 6, y: y + 13, class: "chart-value" }, svg);
    v.textContent = r.value;
  });
}

/** r22: decision tree as a top-down node-link diagram. */
export function renderTree(svg, tree) {
  svg.innerHTML = "";
  if (!tree || !tree.nodes.length) return;
  const kids = {};
  for (const l of tree.links) (kids[l.source] ||= []).push(l);
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const pos = {}; let leafX = 0;
  const NW = 150, NH = 46, HG = 14, VG = 50;
  const place = (id, depth) => {
    const ch = kids[id] || [];
    if (!ch.length) { pos[id] = { x: leafX * (NW + HG), y: depth * (NH + VG) }; leafX++; }
    else {
      ch.forEach((l) => place(l.target, depth + 1));
      const xs = ch.map((l) => pos[l.target].x);
      pos[id] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth * (NH + VG) };
    }
  };
  place(0, 0);
  const W = leafX * (NW + HG) + 20, H = Math.max(...Object.values(pos).map((p) => p.y)) + NH + 20;
  svg.setAttribute("viewBox", `-10 -10 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  for (const l of tree.links) {
    const a = pos[l.source], b = pos[l.target];
    el("path", { d: `M${a.x + NW / 2} ${a.y + NH} C${a.x + NW / 2} ${a.y + NH + VG / 2} ${b.x + NW / 2} ${b.y - VG / 2} ${b.x + NW / 2} ${b.y}`, class: "tree-link" }, svg);
    const t = el("text", { x: (a.x + b.x) / 2 + NW / 2, y: (a.y + NH + b.y) / 2, class: "tree-branch" }, svg);
    t.textContent = l.branch === "≤" ? "no" : "yes";
  }
  for (const n of tree.nodes) {
    const p = pos[n.id];
    const g = el("g", { transform: `translate(${p.x},${p.y})`, class: "tree-node " + (n.leaf ? "leaf " + n.class : "split") }, svg);
    el("rect", { width: NW, height: NH, rx: 6 }, g);
    const t1 = el("text", { x: NW / 2, y: 18, class: "tree-t1" }, g);
    t1.textContent = n.leaf ? n.class.replace("_", " ") : `${n.feature} > ${n.threshold}?`;
    const t2 = el("text", { x: NW / 2, y: 36, class: "tree-t2" }, g);
    t2.textContent = `${n.samples} columns`;
    const tip = el("title", {}, g);
    tip.textContent = Object.entries(n.distribution).map(([k, v]) => `${k}: ${v}`).join("\n");
  }
}
