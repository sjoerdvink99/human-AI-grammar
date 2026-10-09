// [tool_2 translate] — semantic_profile -> semantic_views (linked D3 visualizations),
// and validation result -> validation_view.
/* global d3 */

export const FAMILY = {
  identifier: "key",
  person_name: "contact", organization: "contact", email: "contact", phone: "contact", url: "contact",
  address: "geo", city: "geo", country: "geo", postal_code: "geo",
  temporal: "time",
  monetary: "measure", quantity: "measure", measurement: "measure", percentage: "measure", currency: "measure",
  categorical_code: "category", boolean_flag: "category",
  title_or_label: "text", free_text: "text",
  other: "other",
};
const FAMILY_COLOR = {
  key: "#55657f", contact: "#8a5cc2", geo: "#2e9a6a", time: "#d9822b", measure: "#2f6fdb",
  category: "#159a9c", text: "#a0704a", other: "#9aa0ab",
};
export const TYPE_COLOR = { entity: "#2f6fdb", event: "#d9822b", bridge: "#8a5cc2", lookup: "#2e9a6a" };

export function categoryColor(cat) {
  const base = d3.color(FAMILY_COLOR[FAMILY[cat] || "other"]);
  // vary lightness a little inside a family so members stay distinguishable
  const members = Object.keys(FAMILY).filter((k) => FAMILY[k] === FAMILY[cat]);
  const i = Math.max(0, members.indexOf(cat));
  return base.darker(i * 0.18 - 0.2).formatHex();
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ linked semantic views
export function renderSemanticViews(profile, ui, handlers) {
  renderSchema(profile, ui, handlers);
  renderTaxonomyBars(profile, ui, handlers);
  renderColumnsGrid(profile, ui, handlers);
  renderFdView(profile, ui, handlers);
  applyHighlight(ui);
}

let simCache = {};

// collision force for axis-aligned rectangles of size w × h
function rectCollide(w, h) {
  let nodes;
  const force = () => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01;
        const ox = w - Math.abs(dx), oy = h - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          if (ox / w < oy / h) { const s = Math.sign(dx) * ox / 2; a.x -= s; b.x += s; }
          else { const s = Math.sign(dy) * oy / 2; a.y -= s; b.y += s; }
        }
      }
    }
  };
  force.initialize = (n) => { nodes = n; };
  return force;
}

function renderSchema(profile, ui, h) {
  const svg = d3.select("#schema");
  const { width } = svg.node().getBoundingClientRect();
  const height = 360;
  svg.selectAll("*").remove();
  svg.attr("viewBox", [0, 0, width, height]);
  svg.append("defs").append("marker").attr("id", "arrow").attr("viewBox", "0 -5 10 10").attr("refX", 10)
    .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#9aa3b5");

  const nodes = profile.tables.map((t) => ({ ...t, id: t.name, ...(simCache[t.name] || {}) }));
  const links = profile.foreign_keys.map((f) => ({ ...f, origin: f.source, source: f.from_table, target: f.to_table }));
  const W = 128, H = 44;
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(170).strength(0.4))
    .force("charge", d3.forceManyBody().strength(-900))
    .force("x", d3.forceX(width / 2).strength(0.06))
    .force("y", d3.forceY(height / 2).strength(0.12))
    .force("collide", rectCollide(W + 16, H + 26))
    .stop();
  const fresh = nodes.some((n) => n.x === undefined);
  const clamp = () => nodes.forEach((n) => {
    n.x = Math.max(W / 2 + 4, Math.min(width - W / 2 - 4, n.x));
    n.y = Math.max(H / 2 + 4, Math.min(height - H / 2 - 4, n.y));
  });
  for (let i = 0; i < (fresh ? 400 : 80); i++) { sim.tick(); clamp(); }
  nodes.forEach((n) => { simCache[n.id] = { x: n.x, y: n.y }; });

  const edgePoint = (a, b) => { // point on rect border of b toward a
    const dx = a.x - b.x, dy = a.y - b.y;
    const s = Math.min(Math.abs((W / 2 + 3) / (dx || 1e-6)), Math.abs((H / 2 + 3) / (dy || 1e-6)));
    return [b.x + dx * s, b.y + dy * s];
  };
  const linkG = svg.append("g");
  linkG.selectAll("path").data(links).join("path")
    .attr("class", (d) => `link ${d.origin === "user" ? "user" : ""}`)
    .attr("marker-end", "url(#arrow)")
    .attr("d", (d) => {
      const [x1, y1] = edgePoint(d.target, d.source);
      const [x2, y2] = edgePoint(d.source, d.target);
      return `M${x1},${y1}L${x2},${y2}`;
    })
    .attr("data-fk", (d) => fkId(d))
    .on("click", (ev, d) => h.selectForeignKey({ from_table: d.from_table, from_column: d.from_column, to_table: d.to_table, to_column: d.to_column }))
    .append("title").text((d) => `${d.from_table}.${d.from_column} → ${d.to_table}.${d.to_column}`);
  linkG.selectAll("text").data(links).join("text").attr("class", "link-label")
    .attr("x", (d) => (d.source.x + d.target.x) / 2).attr("y", (d) => (d.source.y + d.target.y) / 2 - 4)
    .attr("text-anchor", "middle").text((d) => d.from_column);

  const node = svg.append("g").selectAll("g").data(nodes).join("g")
    .attr("class", (d) => `node ${d.previous_type && d.previous_type !== d.type ? "changed" : ""}`)
    .attr("data-table", (d) => d.name)
    .attr("transform", (d) => `translate(${d.x - W / 2},${d.y - H / 2})`)
    .on("click", (ev, d) => h.selectTable(d.name));
  node.append("rect").attr("width", W).attr("height", H).attr("rx", 7).attr("fill", (d) => TYPE_COLOR[d.type] || "#9aa0ab");
  node.append("text").attr("x", 8).attr("y", 17).attr("font-weight", 700).text((d) => d.name);
  node.append("text").attr("x", 8).attr("y", 33).attr("opacity", 0.9)
    .text((d) => `${d.type || "?"}${d.type_source === "user" ? " ✎" : ""} · ${d.rows} rows`);
  node.append("title").text((d) => `${d.name}\nkey: ${d.primary_key.join(", ") || "none"}\nlabels: ${d.labels.join(", ")}`);

  d3.select("#type-legend").html(Object.entries(TYPE_COLOR).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")
    + `<span>— detected FK</span><span style="color:var(--accent)">- - user FK</span><span style="color:var(--warn)">▭ type changed by refinement</span>`);
}

function renderTaxonomyBars(profile, ui, h) {
  const svg = d3.select("#taxonomy-bars");
  const { width } = svg.node().getBoundingClientRect();
  svg.selectAll("*").remove();
  const counts = d3.rollups(profile.columns, (v) => v.length, (d) => d.category).sort((a, b) => b[1] - a[1]);
  const height = Math.max(120, counts.length * 22 + 20);
  svg.attr("viewBox", [0, 0, width, height]).style("height", `${Math.min(360, height)}px`);
  const left = 120;
  const x = d3.scaleLinear().domain([0, d3.max(counts, (d) => d[1]) || 1]).range([0, width - left - 30]);
  const g = svg.selectAll("g").data(counts).join("g").attr("transform", (d, i) => `translate(0,${10 + i * 22})`)
    .attr("class", "tax-bar").style("cursor", "pointer")
    .on("mouseenter", (ev, d) => { ui.hoverCategory = d[0]; applyHighlight(ui); })
    .on("mouseleave", () => { ui.hoverCategory = null; applyHighlight(ui); });
  g.append("text").attr("x", left - 6).attr("y", 13).attr("text-anchor", "end").attr("font-size", 11).text((d) => d[0]);
  g.append("rect").attr("x", left).attr("y", 2).attr("height", 15).attr("rx", 3)
    .attr("width", (d) => x(d[1])).attr("fill", (d) => categoryColor(d[0]));
  g.append("text").attr("x", (d) => left + x(d[1]) + 4).attr("y", 14).attr("font-size", 11).attr("fill", "#6b7385").text((d) => d[1]);
}

function renderColumnsGrid(profile, ui, h) {
  const root = d3.select("#columns-grid").html("");
  for (const t of profile.tables) {
    const row = root.append("div").attr("class", "col-table").attr("data-table", t.name);
    row.append("div").attr("class", "tname").html(`${esc(t.name)}<small>${t.rows} rows</small>`)
      .on("click", () => h.selectTable(t.name));
    const cells = row.append("div").attr("class", "col-cells");
    const fkCols = new Set(profile.foreign_keys.filter((f) => f.from_table === t.name).map((f) => f.from_column));
    for (const c of profile.columns.filter((c) => c.table === t.name)) {
      const inPk = t.primary_key.includes(c.column);
      const cell = cells.append("div").attr("class", "col-cell")
        .attr("data-key", c.key).attr("data-category", c.category).attr("data-table", t.name)
        .style("background", categoryColor(c.category))
        .style("opacity", c.source === "model" ? 0.55 + 0.45 * (c.confidence ?? 0) : 1)
        .on("click", () => h.selectColumn(t.name, c.column));
      cell.append("div").attr("class", "cname").text(c.column);
      cell.append("div").attr("class", "ccat").text(c.category + (fkCols.has(c.column) ? " · FK" : ""));
      const bars = cell.append("div").attr("class", "bars");
      bars.append("div").attr("class", "bar").attr("title", `uniqueness ${(c.uniqueness * 100).toFixed(1)}%`)
        .append("div").style("width", `${c.uniqueness * 100}%`);
      bars.append("div").attr("class", "bar").attr("title", `completeness ${((1 - c.null_ratio) * 100).toFixed(1)}%`)
        .append("div").style("width", `${(1 - c.null_ratio) * 100}%`);
      cell.append("div").attr("class", "src").attr("title", `assigned by ${c.source}`)
        .text(c.source === "rule" ? "R" : c.source === "user" ? "✎" : c.model_error ? "!" : "M");
      if (inPk) {
        cell.append("div").attr("class", "key").attr("title", "part of the primary key — click to check the key")
          .text("PK").on("click", (ev) => { ev.stopPropagation(); h.selectPrimaryKey(t.name, t.primary_key); });
      }
      cell.append("title").text(`${c.table}.${c.column}\n${c.category} (${c.source}${c.source === "model" ? `, ${(c.confidence * 100).toFixed(0)}%` : ""})\n${c.rationale || ""}`);
    }
  }
}

function renderFdView(profile, ui, h) {
  const root = d3.select("#fd-view").html("");
  const byTable = d3.group(profile.functional_dependencies, (d) => d.table);
  if (!byTable.size) { root.append("div").attr("class", "muted").text("No non-trivial functional dependencies."); return; }
  for (const t of profile.tables) {
    const fds = byTable.get(t.name);
    if (!fds) continue;
    const cols = profile.columns.filter((c) => c.table === t.name).map((c) => c.column);
    const width = Math.max(500, cols.length * 100), height = 96, step = width / cols.length;
    const xOf = (c) => step * cols.indexOf(c) + step / 2;
    const wrap = root.append("div").attr("class", "fd-table col-table").attr("data-table", t.name);
    wrap.append("div").attr("class", "tname").text(t.name).on("click", () => h.selectTable(t.name));
    const svg = wrap.append("svg").attr("width", width).attr("height", height);
    svg.append("defs").append("marker").attr("id", `fdarrow-${t.name}`).attr("viewBox", "0 -5 10 10").attr("refX", 8)
      .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#7d5fb8");
    const base = height - 22;
    svg.selectAll("path.fd-arc").data(fds).join("path")
      .attr("class", (d) => `fd-arc ${d.source === "user" ? "user" : ""}`)
      .attr("data-fd", (d) => `${d.table}|${d.lhs}|${d.rhs}`)
      .attr("marker-end", `url(#fdarrow-${t.name})`)
      .attr("d", (d) => {
        const x1 = xOf(d.lhs), x2 = xOf(d.rhs), r = Math.abs(x2 - x1) / 2;
        const up = x2 > x1 ? 1 : 0;
        return `M${x1},${base - 4} A${r},${Math.min(r, base - 6)} 0 0 ${up} ${x2},${base - 4}`;
      })
      .on("click", (ev, d) => h.selectFd({ table: d.table, lhs: d.lhs, rhs: d.rhs }))
      .append("title").text((d) => `${d.lhs} → ${d.rhs}`);
    svg.selectAll("text").data(cols).join("text").attr("x", xOf).attr("y", base + 14).attr("text-anchor", "middle")
      .attr("font-size", 11).attr("fill", (c) => fds.some((d) => d.lhs === c || d.rhs === c) ? "#1d2433" : "#a3a9b5").text((c) => c);
  }
}

// linked highlighting across the views
export function applyHighlight(ui) {
  const sel = ui.selection || {};
  const table = sel.table || sel.from_table || null;
  const relatedTables = new Set([table, sel.to_table].filter(Boolean));
  d3.selectAll("#schema .node").classed("selected", (d) => relatedTables.has(d.name))
    .classed("dim", (d) => ui.hoverCategory ? !ui.profile.columns.some((c) => c.table === d.name && c.category === ui.hoverCategory) : false);
  d3.selectAll("#columns-grid .col-cell")
    .classed("selected", function () { return sel.kind === "column" && this.dataset.key === `${sel.table}.${sel.column}`; })
    .classed("dim", function () {
      if (ui.hoverCategory) return this.dataset.category !== ui.hoverCategory;
      if (sel.kind === "table") return this.dataset.table !== sel.table;
      return false;
    });
  d3.selectAll("#columns-grid .col-table").classed("dim", function () {
    return sel.kind === "table" && !ui.hoverCategory ? this.dataset.table !== sel.table : false;
  });
  d3.selectAll("#schema .link").classed("selected", (d) => sel.kind === "foreign_key" && fkId(d) === fkId(sel))
    .classed("dim", (d) => sel.kind === "table" ? !(d.from_table === sel.table || d.to_table === sel.table) : false);
  d3.selectAll("#fd-view .fd-arc").classed("selected", function () {
    return sel.kind === "fd" && this.dataset.fd === `${sel.table}|${sel.lhs}|${sel.rhs}`;
  });
  d3.selectAll("#fd-view .fd-table").classed("dim", function () {
    return (sel.kind === "table" || sel.kind === "fd") ? this.dataset.table !== sel.table : false;
  });
}

function fkId(d) { return `${d.from_table}.${d.from_column}->${d.to_table}.${d.to_column}`; }

// ------------------------------------------------------------------ helpers shared by views
export function sqlHighlight(sql) {
  const KW = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|GROUP|BY|HAVING|ORDER|JOIN|ON|AS|DESC|COUNT|DISTINCT|FILTER|CAST|VARCHAR|ANY_VALUE|regexp_full_match|count|any_value)\b/g;
  return esc(sql)
    .replace(/'([^']*)'/g, '<span class="str">\'$1\'</span>')
    .replace(KW, '<span class="kw">$1</span>')
    .replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
}

export function rowsTable(rows, { reasonCol = false, highlight = null, max = 25 } = {}) {
  if (!rows || !rows.length) return '<div class="muted small">No rows.</div>';
  const cols = Object.keys(rows[0]).filter((c) => c !== "__reason");
  const head = (reasonCol ? "<th>reason</th>" : "") + cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.slice(0, max).map((r) => {
    const cells = cols.map((c) => {
      const strong = highlight && highlight.includes(c);
      const v = r[c] === null ? '<span class="muted">∅</span>' : esc(r[c]);
      return `<td title="${esc(r[c])}">${strong ? `<b>${v}</b>` : v}</td>`;
    }).join("");
    return `<tr class="${reasonCol ? "counter" : ""}">${reasonCol ? `<td>${esc(r.__reason)}</td>` : ""}${cells}</tr>`;
  }).join("");
  return `<div class="scroll"><table class="rows"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ------------------------------------------------------------------ validation_view (process 3)
export function renderValidationView(el, result) {
  const sel = result.selected_feature;
  const hl = sel.kind === "column" ? [sel.column] : sel.kind === "primary_key" ? sel.columns
    : sel.kind === "foreign_key" ? [sel.from_column] : [sel.lhs, sel.rhs];
  const ok = result.counterexamples.total === 0;
  el.innerHTML = `
    <div class="verdict ${ok ? "ok" : "bad"}">
      <b>${ok ? "✓ Supported" : `✗ ${result.counterexamples.total} contradicting record(s)`}</b><br/>${esc(result.explanation)}
    </div>
    <h4>Validation queries (${result.validation_queries.length})</h4>
    ${result.validation_queries.map((qd) => `
      <details ${qd.purpose === "counter" && qd.result_rows ? "open" : ""}>
        <summary>${qd.purpose === "support" ? "✓" : qd.purpose === "counter" ? "✗" : "Σ"} ${esc(qd.title)}
          <span class="muted small">${qd.error ? "error" : `${qd.result_rows} row(s)`}</span></summary>
        <pre class="sql">${sqlHighlight(qd.sql)}</pre>
        ${qd.error ? `<div class="error">${esc(qd.error)}</div>` : ""}
      </details>`).join("")}
    <h4>Contradicting records <span class="muted small">${result.counterexamples.total} total</span></h4>
    ${rowsTable(result.counterexamples.rows, { reasonCol: true, highlight: hl })}
    <h4>Supporting records <span class="muted small">${result.supporting_samples.total} total, first ${result.supporting_samples.rows.length} shown</span></h4>
    ${rowsTable(result.supporting_samples.rows, { highlight: hl })}
  `;
}

// ------------------------------------------------------------------ updated_table_classifier (process 5)
export function renderClassifierTree(el, graph, path) {
  el.innerHTML = "";
  const byId = new Map(graph.nodes.map((n) => [n.id, { ...n, children: [] }]));
  for (const l of graph.links) byId.get(l.source).children[l.branch === "no" ? 0 : 1] = byId.get(l.target);
  const root = d3.hierarchy(byId.get(0), (d) => d.children.filter(Boolean));
  const leaves = root.leaves().length;
  const width = Math.max(700, leaves * 80), height = (root.height + 1) * 80 + 40;
  d3.tree().size([width - 80, height - 80])(root);
  const onPath = new Set((path || []).map((p) => p.node));
  const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", "translate(40,30)");
  g.selectAll("path").data(root.links()).join("path")
    .attr("class", (d) => `tree-link ${onPath.has(d.source.data.id) && onPath.has(d.target.data.id) ? "on" : ""}`)
    .attr("d", d3.linkVertical().x((d) => d.x).y((d) => d.y));
  g.selectAll("text.branch").data(root.links()).join("text").attr("class", "branch")
    .attr("x", (d) => (d.source.x + d.target.x) / 2).attr("y", (d) => (d.source.y + d.target.y) / 2)
    .attr("font-size", 10).attr("fill", "#6b7385").attr("text-anchor", "middle")
    .text((d) => (d.source.children.indexOf(d.target) === 0 ? "no" : "yes"));
  const node = g.selectAll("g.tree-node").data(root.descendants()).join("g")
    .attr("class", (d) => `tree-node ${onPath.has(d.data.id) ? "on" : ""}`)
    .attr("transform", (d) => `translate(${d.x},${d.y})`);
  node.append("circle").attr("r", (d) => (d.data.leaf ? 9 : 6))
    .attr("fill", (d) => (d.data.leaf ? TYPE_COLOR[d.data.class] : "#55657f"));
  node.append("text").attr("dy", (d) => (d.data.leaf ? 22 : -10)).attr("text-anchor", "middle")
    .text((d) => (d.data.leaf ? d.data.class : `${d.data.label}?`));
  node.append("title").text((d) => `${d.data.leaf ? "leaf → " + d.data.class : d.data.label}\n${Object.entries(d.data.distribution).map(([k, v]) => `${k}: ${v}`).join("\n")}`);
}
