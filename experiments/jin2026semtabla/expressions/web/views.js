// tool_2 translate — deterministic renderers that turn records into visual artifacts:
//   semantic_profile -> semantic_views (schema graph + details), validation results -> validation_view,
//   updated_table_classifier -> tree view.

export const TYPE_COLORS = {
  fact: "#d9644a", dimension: "#3b78c4", bridge: "#8a6cc4", lookup: "#4f9a3c",
  event_log: "#d98a1f", other: "#8a8a8a",
};
export const SOURCE_COLORS = { agree: "#2f8f5b", rule: "#3b78c4", model: "#8a6cc4", human: "#d97a1f" };

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SVG = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// ---------------------------------------------------------------- schema graph (semantic_views)
export function layoutTables(profile) {
  const edges = profile.key_relations.edges;
  const names = profile.tables.map((t) => t.name);
  const memo = {};
  const layer = (t, depth = 0) => {
    if (t in memo) return memo[t];
    if (depth > names.length) return 0;
    const outs = edges.filter((e) => e.from_table === t && e.to_table !== t);
    return (memo[t] = outs.length ? 1 + Math.max(...outs.map((e) => layer(e.to_table, depth + 1))) : 0);
  };
  const maxL = Math.max(0, ...names.map((n) => layer(n)));
  const W = 250, GAP_X = 130, ROW = 20, HEAD = 36, GAP_Y = 28;
  const pos = {}, colHeights = {};
  for (const t of profile.tables) {
    const L = maxL - layer(t.name);
    const y = colHeights[L] ?? 20;
    const h = HEAD + t.columns.length * ROW + 8;
    pos[t.name] = { x: 20 + L * (W + GAP_X), y, w: W, h };
    colHeights[L] = y + h + GAP_Y;
  }
  return { pos, ROW, HEAD, width: 40 + (maxL + 1) * (W + GAP_X) - GAP_X,
    height: Math.max(...Object.values(colHeights), 100) };
}

/**
 * Render the schema graph. `onSelect(selection)` receives a selected_feature record.
 * `compare` (optional) is the parent profile: changed table types / column types are marked.
 */
export function renderSchemaGraph(profile, { onSelect, selected, compare } = {}) {
  const { pos, ROW, HEAD, width, height } = layoutTables(profile);
  const svg = el("svg", { width, height, class: "schema", viewBox: `0 0 ${width} ${height}` });
  const defs = el("defs", {}, svg);
  const m = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, defs);
  el("path", { d: "M0,0 L10,5 L0,10 z", fill: "#555" }, m);

  const rowY = (t, col) => {
    const p = pos[t], i = profile.tables.find((x) => x.name === t).columns.findIndex((c) => c.column === col);
    return p.y + HEAD + i * ROW + ROW / 2;
  };
  const prevTypes = {}, prevCols = {};
  if (compare) for (const t of compare.tables) {
    prevTypes[t.name] = t.table_type;
    for (const c of t.columns) prevCols[t.name + "." + c.column] = c.semantic_type;
  }

  // foreign-key edges
  const gEdges = el("g", {}, svg);
  for (const e of profile.key_relations.edges) {
    const a = pos[e.from_table], b = pos[e.to_table];
    if (!a || !b) continue;
    const y1 = rowY(e.from_table, e.from_column), y2 = rowY(e.to_table, e.to_column);
    let d;
    if (b.x > a.x) { const x1 = a.x + a.w, x2 = b.x; d = `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`; }
    else if (b.x < a.x) { const x1 = a.x, x2 = b.x + b.w; d = `M${x1},${y1} C${x1 - 60},${y1} ${x2 + 60},${y2} ${x2},${y2}`; }
    else { const x = a.x + a.w; d = `M${x},${y1} C${x + 70},${y1} ${x + 70},${y2} ${x},${y2}`; }
    const isSel = selected?.kind === "foreign_key" && selected.id === e.id;
    const path = el("path", { d, class: "fk" + (isSel ? " sel" : "") + (e.exact === false ? " approx" : "") + (e.source === "human" ? " human" : ""), "marker-end": "url(#arrow)" }, gEdges);
    const hit = el("path", { d, class: "fk-hit" }, gEdges);
    const title = `${e.from_table}.${e.from_column} → ${e.to_table}.${e.to_column}` + (e.exact === false ? ` (${e.orphan_values} orphan values)` : "");
    el("title", {}, hit).textContent = title;
    hit.addEventListener("click", () => onSelect?.({ kind: "foreign_key", id: e.id, from_table: e.from_table, from_column: e.from_column, to_table: e.to_table, to_column: e.to_column, label: title }));
    path.style.pointerEvents = "none";
  }

  // tables
  for (const t of profile.tables) {
    const p = pos[t.name];
    const g = el("g", { transform: `translate(${p.x},${p.y})` }, svg);
    const color = TYPE_COLORS[t.table_type] || "#888";
    el("rect", { width: p.w, height: p.h, rx: 6, class: "tbox", stroke: color }, g);
    el("rect", { width: p.w, height: HEAD - 6, rx: 6, fill: color, class: "thead" }, g);
    el("rect", { y: HEAD - 12, width: p.w, height: 6, fill: color }, g);
    const name = el("text", { x: 10, y: 19, class: "tname" }, g); name.textContent = t.name;
    const changed = compare && prevTypes[t.name] && prevTypes[t.name] !== t.table_type;
    const ty = el("text", { x: p.w - 10, y: 19, class: "ttype", "text-anchor": "end" }, g);
    ty.textContent = (changed ? `${prevTypes[t.name]} → ` : "") + t.table_type + ` ${Math.round((t.type_confidence || 0) * 100)}%`;
    el("title", {}, ty).textContent = `model_2: ${t.type_rationale}\nrule: ${t.rule_label} (${t.rule})`;
    const fkCols = new Set(profile.key_relations.edges.filter((e) => e.from_table === t.name).map((e) => e.from_column));
    t.columns.forEach((c, i) => {
      const y = HEAD + i * ROW;
      const isSel = selected && ((selected.kind === "column_type" || selected.kind === "primary_key") && selected.table === t.name && selected.column === c.column);
      const row = el("g", { class: "crow" + (isSel ? " sel" : ""), transform: `translate(0,${y})` }, g);
      el("rect", { x: 1, width: p.w - 2, height: ROW, class: "crow-bg" }, row);
      const isPk = t.primary_key === c.column;
      if (isPk || fkCols.has(c.column)) {
        const k = el("text", { x: 8, y: 14, class: isPk ? "pk" : "fkmark" }, row);
        k.textContent = isPk ? "PK" : "FK";
        if (isPk) k.addEventListener("click", (ev) => { ev.stopPropagation(); onSelect?.({ kind: "primary_key", table: t.name, column: c.column, label: `primary key ${t.name}.${c.column}` }); });
      }
      const cn = el("text", { x: 30, y: 14, class: "cname" }, row); cn.textContent = c.column;
      const chipW = Math.max(60, c.semantic_type.length * 6.4 + 12);
      const changedCol = compare && prevCols[t.name + "." + c.column] && prevCols[t.name + "." + c.column] !== c.semantic_type;
      el("rect", { x: p.w - chipW - 6, y: 3, width: chipW, height: 14, rx: 7, fill: SOURCE_COLORS[c.source] || "#888", class: changedCol ? "chip changed" : "chip" }, row);
      const ct = el("text", { x: p.w - chipW / 2 - 6, y: 13.5, class: "chiptext", "text-anchor": "middle" }, row);
      ct.textContent = c.semantic_type;
      el("title", {}, row).textContent = `${c.column}: ${c.semantic_type} (${c.source})\nrule: ${c.rule_type} [${c.rule}]\nmodel_1: ${c.model_type} ${Math.round((c.model_confidence || 0) * 100)}% — ${c.model_rationale}` + (changedCol ? `\nwas: ${prevCols[t.name + "." + c.column]}` : "");
      row.addEventListener("click", () => onSelect?.({ kind: "column_type", table: t.name, column: c.column, semantic_type: c.semantic_type, label: `${t.name}.${c.column} is ${c.semantic_type}` }));
    });
  }
  return svg;
}

// ---------------------------------------------------------------- validation_view
const SQL_KW = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|GROUP|BY|HAVING|ORDER|DESC|AS|COUNT|DISTINCT|CAST|TRY_CAST|VARCHAR|DOUBLE|BIGINT|DATE|TIMESTAMP|BETWEEN|COALESCE|ANY_VALUE|LIMIT|length|lower|regexp_full_match)\b/g;
export function highlightSQL(sql) {
  return esc(sql)
    .replace(/(&#39;.*?&#39;)/g, '<span class="sql-str">$1</span>')
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="sql-id">$1</span>')
    .replace(SQL_KW, '<span class="sql-kw">$1</span>');
}

export function renderRows(res, highlightCols = []) {
  if (!res || !res.rows.length) return '<p class="muted">no rows</p>';
  const cols = res.columns.filter((c) => !c.startsWith("__"));
  return `<div class="tablewrap"><table class="data"><thead><tr>${cols.map((c) => `<th class="${highlightCols.includes(c) ? "hl" : ""}">${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${res.rows.map((r) => `<tr>${cols.map((c) => `<td class="${highlightCols.includes(c) ? "hl" : ""}">${r[c] === null ? '<span class="null">null</span>' : esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderValidationView(v) {
  const sf = v.selected_feature;
  const hl = [sf.column, sf.from_column, sf.lhs, sf.rhs, sf.feature?.column].filter(Boolean);
  const s = v.supporting_samples?.count ?? 0, c = v.counterexamples?.count ?? 0, tot = s + c || 1;
  const verdict = c === 0 ? '<span class="ok">holds on all rows</span>' : `<span class="bad">${c} counterexample${c === 1 ? "" : "s"}</span>`;
  return `
    <h3>${esc(sf.label || sf.kind)}</h3>
    <div class="verdict">${verdict}</div>
    <div class="supportbar" title="${s} supporting vs ${c} counterexamples">
      <div class="sup" style="width:${(100 * s) / tot}%"></div><div class="ctr" style="width:${(100 * c) / tot}%"></div>
    </div>
    <div class="legendrow"><span class="dot sup"></span>${s} supporting <span class="dot ctr"></span>${c} counter</div>
    <h4>Validation queries</h4>
    ${v.validation_queries.map((q) => `<div class="query"><div class="qname">${esc(q.purpose)} · ${esc(q.name)} <b>(${q.count})</b></div><pre class="sql">${highlightSQL(q.sql)}</pre></div>`).join("")}
    <h4>Counterexamples <span class="muted">(first ${v.counterexamples?.rows.length ?? 0})</span></h4>
    ${renderRows(v.counterexamples, hl)}
    <h4>Supporting samples <span class="muted">(first ${v.supporting_samples?.rows.length ?? 0})</span></h4>
    ${renderRows(v.supporting_samples, hl)}`;
}

// ---------------------------------------------------------------- classifier tree (updated_table_classifier)
export function renderTree(tree) {
  // the model may share nodes between branches (a DAG); unfold into a tree of occurrences
  const nodes = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const occ = [], links = [];
  let leafX = 0, maxDepth = 0;
  const place = (id, depth) => {
    const n = nodes[id];
    if (!n || depth > 8) return null;
    maxDepth = Math.max(maxDepth, depth);
    const o = { n, depth, x: 0 };
    occ.push(o);
    if (n.label) { o.x = leafX++; return o; }
    const kids = [[place(n.yes, depth + 1), "yes"], [place(n.no, depth + 1), "no"]].filter(([k]) => k);
    o.x = kids.length ? kids.reduce((s, [k]) => s + k.x, 0) / kids.length : leafX++;
    for (const [k, lab] of kids) links.push([o, k, lab]);
    return o;
  };
  place(tree.root, 0);
  const DX = 170, DY = 80, W = Math.max(1, leafX) * DX + 40, H = (maxDepth + 1) * DY + 20;
  const svg = el("svg", { width: W, height: H, class: "tree" });
  const P = (o) => ({ x: 20 + DX / 2 + o.x * DX, y: 30 + o.depth * DY });
  for (const [from, to, lab] of links) {
    const a = P(from), b = P(to);
    el("line", { x1: a.x, y1: a.y + 14, x2: b.x, y2: b.y - 12, class: "tedge" }, svg);
    const t = el("text", { x: (a.x + b.x) / 2 + (lab === "yes" ? -12 : 12), y: (a.y + b.y) / 2 + 4, class: "tlab", "text-anchor": "middle" }, svg);
    t.textContent = lab;
  }
  for (const o of occ) {
    const n = o.n;
    const { x, y } = P(o);
    if (n.label) {
      el("rect", { x: x - 50, y: y - 12, width: 100, height: 24, rx: 12, fill: TYPE_COLORS[n.label] || "#888" }, svg);
      const t = el("text", { x, y: y + 4, class: "leaf", "text-anchor": "middle" }, svg); t.textContent = n.label;
    } else {
      el("rect", { x: x - 80, y: y - 14, width: 160, height: 28, rx: 4, class: "tnode" }, svg);
      const t = el("text", { x, y: y + 4, class: "tcond", "text-anchor": "middle" }, svg);
      t.textContent = `${n.feature} ${n.op} ${n.threshold}`;
    }
  }
  return svg;
}
