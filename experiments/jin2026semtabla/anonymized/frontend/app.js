import { renderDiagram, renderChart, renderTree, defaultLayout, ROLE_BADGE } from "./render.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KEY_ROLES = ["primary_key", "foreign_key", "attribute"];

// Application state, named after the design's identifiers.
const S = {
  r1_tables: null,
  p1: null,               // r2 sample sizes, r3 profiles, r4 quality, rounds
  p2: null,               // r6..r12, model_1 info
  r13: null,              // current data model version
  r13_versions: 0,
  draft: null,            // working copy for the human modify step (process 4)
  r15_selection: null,
  positions: {},
  showDisagreement: false,
  r12_edits: {},          // human corrections (process 5)
  r22_tree: null,
};

async function api(path, body, isForm = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: isForm ? {} : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

function status(msg, kind = "") {
  $("#status").className = kind;
  $("#status").innerHTML = kind === "busy" ? `<span class="spinner"></span>${esc(msg)}` : esc(msg);
}

// ------------------------------------------------------------------ tabs
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(id) {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === id));
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.id === id));
}
document.querySelectorAll(".subtabs button").forEach((b) => b.addEventListener("click", () => showSub(b.dataset.sub)));
function showSub(id) {
  document.querySelectorAll(".subtabs button").forEach((x) => x.classList.toggle("active", x.dataset.sub === id));
  document.querySelectorAll(".sub").forEach((x) => x.classList.toggle("active", x.id === id));
}

// ------------------------------------------------------------------ r1 input
$("#btn-sample").addEventListener("click", async () => {
  status("Loading sample tables…", "busy");
  try { onTables(await api("/api/sample")); } catch (e) { status(e.message, "error"); }
});
$("#file-input").addEventListener("change", async (ev) => {
  const fd = new FormData();
  for (const f of ev.target.files) fd.append("files", f);
  if (!ev.target.files.length) return;
  status("Uploading…", "busy");
  try { onTables(await api("/api/tables", fd, true)); } catch (e) { status(e.message, "error"); }
  ev.target.value = "";
});

function onTables(data) {
  Object.assign(S, { r1_tables: data.r1_tables, p1: null, p2: null, r13: null, positions: {}, r15_selection: null, r12_edits: {}, r22_tree: null });
  renderTables(data);
  $("#rounds").innerHTML = ""; $("#profiles").innerHTML = "";
  $("#btn-run").disabled = false;
  showTab("tab-profile");
  runPipeline();
}

function renderTables(data) {
  $("#tables-list").innerHTML = data.r1_tables.map((t) => `
    <div class="card"><h3>${esc(t.name)} <small>${t.rows} rows · ${t.columns.length} columns</small></h3>
      <div class="table-scroll"><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.preview.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`).join("");
}

// ------------------------------------------------------------------ process 1 then process 2 (no human step between them)
$("#btn-run").addEventListener("click", runPipeline);
async function runPipeline() {
  $("#btn-run").disabled = true;
  try {
    status("Process 1: sampling and profiling tables…", "busy");
    S.p1 = await api("/api/process1", { initial_sample: Number($("#initial-sample").value) || 50 });
    renderProcess1();
    status("Process 2: extracting features; asking the language model for semantic column types…", "busy");
    const p2 = await api("/api/process2");
    onProcess2(p2);
    const m1 = p2.model_1;
    const note = m1.error ? ` (language model unavailable: rule fallback used — ${m1.error})`
      : m1.fallback_used.length ? ` (${m1.fallback_used.length} invalid model labels replaced by rules)` : "";
    status(`Data model built: ${p2.r13_data_model.entities.length} entities, ${p2.r13_data_model.relationships.length} relationships${note}`, m1.error ? "warn" : "ok");
    showTab("tab-model");
  } catch (e) { status(e.message, "error"); }
  $("#btn-run").disabled = false;
}

function renderProcess1() {
  const { rounds, r3_profiles, r4_quality } = S.p1;
  const tables = Object.keys(rounds[0].sample_sizes);
  $("#rounds").innerHTML = `<table class="compact"><thead><tr><th>round</th>${tables.map((t) => `<th>${esc(t)} sample</th>`).join("")}<th>undecided columns</th></tr></thead>
    <tbody>${rounds.map((r) => `<tr><td>${r.round}</td>${tables.map((t) => `<td>${r.sample_sizes[t]}</td>`).join("")}
    <td>${r.undecided ? `<span class="pill warn">${r.undecided} → expand</span>` : `<span class="pill ok">0 · settled</span>`}</td></tr>`).join("")}</tbody></table>`;
  const q = Object.fromEntries(r4_quality.map((x) => [x.column, x]));
  $("#profiles").innerHTML = `<div class="table-scroll"><table class="compact"><thead><tr>
    <th>column</th><th>type</th><th>sample / table</th><th>nulls</th><th>distinct</th><th>examples</th><th>adequacy (r4)</th></tr></thead><tbody>
    ${r3_profiles.map((p) => `<tr><td><b>${esc(p.table)}</b>.${esc(p.column)}</td><td>${p.dtype}</td>
      <td>${p.sample_size} / ${p.table_size}</td><td>${pct(p.null_ratio)}</td>
      <td><div class="bar"><i style="width:${p.distinct_ratio * 100}%"></i></div>${pct(p.distinct_ratio)}</td>
      <td class="ex">${p.examples.map(esc).join(", ")}</td>
      <td>${q[p.id].unique_in_sample ? "unique" : "has duplicates"} · <span class="pill ${q[p.id].stable ? "ok" : "warn"}">${esc(q[p.id].verdict)}</span></td></tr>`).join("")}
    </tbody></table></div>`;
}
const pct = (v) => `${Math.round(v * 1000) / 10}%`;

// ------------------------------------------------------------------ process 2 results
function onProcess2(p2) {
  S.p2 = p2;
  S.r22_tree = p2.r22_tree;
  S.r12_edits = {};
  S.showDisagreement = false;
  setModel(p2.r13_data_model, p2.r13_versions);
  renderGraphs();
  renderColumns();
  renderTreeView();
  $("#btn-train").disabled = false;
  const m1 = p2.model_1;
  $("#model1-info").textContent = m1.error ? "semantic types: rule fallback" : `semantic types: language model${m1.reused ? " (reused)" : ""}`;
}

function setModel(dm, versions) {
  S.r13 = dm;
  S.r13_versions = versions;
  S.draft = structuredClone(dm);
  S.positions = defaultLayout(dm, S.positions);
  $("#model-version").textContent = `data model v${dm.version ?? versions}`;
  drawDiagram();
  renderEditor();
}

// tool_2 translate: r13 -> r14 (or r21 after edits)
function drawDiagram() {
  renderDiagram($("#diagram"), S.r13, {
    positions: S.positions,
    selection: S.r15_selection,
    showModelDisagreement: S.showDisagreement,
    onSelect: select,
    onMove: () => {},
  });
}

function renderGraphs() {
  const { r9_inclusion_graph: r9, r10_table_graph: r10 } = S.p2;
  $("#graphs").innerHTML = `<div class="two">
    <div><h4>r9 · column inclusion dependencies</h4><ul>${r9.links.map((l) =>
      `<li class="${l.name_link ? "" : "muted"}">${esc(l.source)} ⊆ ${esc(l.target)} <small>${pct(l.coverage)}${l.name_link ? " · names match" : " · values only"}</small></li>`).join("") || "<li>none</li>"}</ul></div>
    <div><h4>r10 · table graph</h4><ul>${r10.links.map((l) =>
      `<li>${esc(l.source)} → ${esc(l.target)} <small>${l.via.length} column link(s), ${l.named} name-supported</small></li>`).join("") || "<li>none</li>"}</ul></div></div>`;
}

// ------------------------------------------------------------------ process 3: human select -> queries -> result + checks -> chart
async function select(sel) {
  S.r15_selection = sel;
  drawDiagram();
  renderEditor();
  showSub("sub-explore");
  const box = $("#sub-explore");
  box.innerHTML = `<p><span class="spinner"></span>Running queries…</p>`;
  try {
    const r = await api("/api/process3", { r15_selection: sel });
    const title = sel.kind === "entity" ? `Entity <b>${esc(sel.id)}</b>${sel.column ? ` · column <b>${esc(sel.column)}</b>` : ""}` : `Relationship <b>${esc(sel.id)}</b>`;
    box.innerHTML = `<h3>${title}</h3>
      <svg id="chart"></svg>
      <h4>Checks (r4)</h4>
      <table class="compact">${r.r4_quality.map((c) => `<tr><td>${esc(c.check)}</td><td class="num ${flag(c)}">${esc(c.value)}</td></tr>`).join("")}</table>
      <details><summary>Generated SQL (r16 · ${r.r16_queries.length} queries)</summary>
        ${r.r16_queries.map((q) => `<div class="sql"><small>${esc(q.purpose)} · ${esc(q.title)}</small><pre><code>${highlightSql(q.sql)}</code></pre></div>`).join("")}</details>
      <details><summary>Result table (r17 · ${r.r17_result.rows.length} rows)</summary>
        <table class="compact"><tr>${r.r17_result.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
        ${r.r17_result.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></details>`;
    if (r.r17_result.rows.length) renderChart($("#chart"), r.r17_result);  // tool_2 translate: r17 -> r18
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
const flag = (c) => (/orphan|duplicate|null/.test(c.check) && c.value > 0 ? "bad" : "");
function highlightSql(sql) {
  return esc(sql)
    .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|LEFT JOIN|JOIN|ON|AS|AND|IS|NOT|NULL|EXISTS|COUNT|DISTINCT|MAX|COALESCE|CAST|DESC|TEXT)\b/g, '<span class="kw">$1</span>')
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="id">$1</span>');
}

// ------------------------------------------------------------------ process 4: human modify r13 -> r13_2 -> labels -> diagram
function renderEditor() {
  const box = $("#sub-edit");
  if (!S.draft) { box.innerHTML = `<p class="empty">Build a data model first.</p>`; return; }
  const d = S.draft;
  const colsOf = (t) => d.entities.find((e) => e.name === t).columns.map((c) => c.name);
  const sel = S.r15_selection?.kind === "entity" ? S.r15_selection.id : null;
  box.innerHTML = `
    <h3>Entities</h3>
    ${d.entities.map((e, i) => `<div class="ent-edit ${sel === e.name ? "hl" : ""}">
      <div><b>${esc(e.name)}</b></div>
      <label>label <input data-i="${i}" class="e-label" value="${esc(e.label)}" /></label>
      <label>primary key <select data-i="${i}" class="e-pk"><option value="">(none)</option>
        ${e.columns.map((c) => `<option ${c.name === e.primary_key ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    </div>`).join("")}
    <h3>Relationships</h3>
    <ul class="rel-list">${d.relationships.map((r, i) => `<li>${esc(r.from_table)}.${esc(r.from_column)} → ${esc(r.to_table)}.${esc(r.to_column)}
      <small>${esc(r.cardinality || "")}</small> <button data-i="${i}" class="r-del" title="remove">✕</button></li>`).join("") || "<li class='muted'>none</li>"}</ul>
    <div class="add-rel">
      <select id="ar-ft">${d.entities.map((e) => `<option>${esc(e.name)}</option>`).join("")}</select>
      <select id="ar-fc"></select> →
      <select id="ar-tt">${d.entities.map((e) => `<option>${esc(e.name)}</option>`).join("")}</select>
      <select id="ar-tc"></select>
      <button id="ar-add">Add</button>
    </div>
    <div class="edit-actions">
      <button id="btn-apply" class="primary">Apply edits</button>
      <button id="btn-reset">Discard</button>
    </div>
    <div id="edit-result"></div>
    <h3>Versions</h3>
    <div class="versions">${Array.from({ length: S.r13_versions }, (_, k) => k + 1).map((v) =>
      `<button class="ver ${v === (S.r13.version ?? S.r13_versions) ? "cur" : ""}" data-v="${v}">v${v}</button>`).join(" ")}
      <small>click to restore a version as a new one</small></div>`;

  const fillCols = (tSel, cSel) => { cSel.innerHTML = colsOf(tSel.value).map((c) => `<option>${esc(c)}</option>`).join(""); };
  const ft = $("#ar-ft"), fc = $("#ar-fc"), tt = $("#ar-tt"), tc = $("#ar-tc");
  if (sel) ft.value = sel;
  fillCols(ft, fc); fillCols(tt, tc);
  ft.onchange = () => fillCols(ft, fc);
  tt.onchange = () => { fillCols(tt, tc); const pk = d.entities.find((e) => e.name === tt.value).primary_key; if (pk) tc.value = pk; };
  tt.onchange();
  box.querySelectorAll(".e-label").forEach((x) => (x.oninput = () => (d.entities[x.dataset.i].label = x.value)));
  box.querySelectorAll(".e-pk").forEach((x) => (x.onchange = () => (d.entities[x.dataset.i].primary_key = x.value || null)));
  box.querySelectorAll(".r-del").forEach((x) => (x.onclick = () => { d.relationships.splice(Number(x.dataset.i), 1); renderEditor(); }));
  $("#ar-add").onclick = () => {
    d.relationships.push({ from_table: ft.value, from_column: fc.value, to_table: tt.value, to_column: tc.value, cardinality: "?" });
    renderEditor();
  };
  $("#btn-reset").onclick = () => { S.draft = structuredClone(S.r13); renderEditor(); };
  $("#btn-apply").onclick = applyEdits;
  box.querySelectorAll(".ver").forEach((x) => (x.onclick = async () => {
    try {
      const r = await api(`/api/process4/revert/${x.dataset.v}`);
      S.showDisagreement = !!r.r13_data_model.entities[0]?.columns[0]?.model_role;
      setModel(r.r13_data_model, r.r13_versions);
    } catch (e) { status(e.message, "error"); }
  }));
}

async function applyEdits() {
  const out = $("#edit-result");
  out.innerHTML = `<p><span class="spinner"></span>Re-labelling columns…</p>`;
  try {
    const r = await api("/api/process4", { r13_data_model: S.draft });
    S.showDisagreement = true;
    // the edited relationship ids may change; drop a stale selection
    if (S.r15_selection?.kind === "relationship" && !r.r13_data_model.relationships.some((x) => x.id === S.r15_selection.id)) S.r15_selection = null;
    setModel(r.r13_data_model, r.r13_versions);
    $("#edit-result").innerHTML = r.disagreements.length
      ? `<div class="notice warn"><b>The classifier disagrees with your model on ${r.disagreements.length} column(s)</b> (⚠ in the diagram):
         <ul>${r.disagreements.map((c) => `<li>${esc(c)}: model says <b>${esc(r.r20_model_keys[c].label.replace("_", " "))}</b> (${r.r20_model_keys[c].confidence}), your model implies <b>${esc(r.r19_rule_keys[c].replace("_", " "))}</b></li>`).join("")}</ul></div>`
      : `<div class="notice ok">Saved as v${r.r13_versions}. The classifier agrees with every key in the edited model.</div>`;
  } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------------ process 5: human corrects r12 -> retrain model_2 -> r22
function renderColumns() {
  const p = S.p2;
  const rows = p.r8_columns.map((c) => {
    const cur = S.r12_edits[c.id] ?? p.r12_model_keys[c.id].label;
    const changed = c.id in S.r12_edits && S.r12_edits[c.id] !== p.r12_model_keys[c.id].label;
    return `<tr class="${changed ? "changed" : ""}">
      <td><b>${esc(c.table)}</b>.${esc(c.column)}</td><td>${esc(p.r6_data_types[c.id])}</td>
      <td><span class="pill sem">${esc(p.r7_semantic_types[c.id])}</span></td>
      <td>${pct(c.distinct_ratio)}${c.is_unique ? " · unique" : ""}</td><td>${c.out_degree} / ${c.in_degree}</td>
      <td>${roleTag(p.r11_rule_keys[c.id])}</td>
      <td><select data-id="${esc(c.id)}" class="r12">${KEY_ROLES.map((k) => `<option value="${k}" ${k === cur ? "selected" : ""}>${k.replace("_", " ")}</option>`).join("")}</select>
        <small>${p.r12_model_keys[c.id].confidence < 1 ? `conf ${p.r12_model_keys[c.id].confidence}` : ""}</small></td></tr>`;
  }).join("");
  $("#columns-table").innerHTML = `<div class="table-scroll"><table class="compact"><thead><tr><th>column</th><th>data type (r6)</th>
    <th>semantic type (r7)</th><th>distinct</th><th>refs out / in</th><th>rule label (r11)</th><th>classifier label (r12) — editable</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  document.querySelectorAll("select.r12").forEach((s) => (s.onchange = () => { S.r12_edits[s.dataset.id] = s.value; renderColumns(); }));
  const n = Object.entries(S.r12_edits).filter(([k, v]) => v !== p.r12_model_keys[k].label).length;
  $("#train-info").textContent = n ? `${n} correction(s) pending` : "No corrections yet";
}
const roleTag = (r) => `<span class="badge-html ${r}">${ROLE_BADGE[r] || "—"}</span> ${r.replace("_", " ")}`;

$("#btn-train").addEventListener("click", async () => {
  const labels = Object.fromEntries(S.p2.r8_columns.map((c) => [c.id, S.r12_edits[c.id] ?? S.p2.r12_model_keys[c.id].label]));
  $("#train-info").innerHTML = `<span class="spinner"></span>Training…`;
  try {
    const r = await api("/api/process5", { r12_labels: labels });
    S.p2.r12_model_keys = r.r12_model_keys;
    S.r12_edits = {};
    S.r22_tree = r.r22_tree;
    renderColumns();
    renderTreeView();
    $("#train-info").textContent = `Retrained (tree v${r.r22_tree.version}); fits ${pct(r.training_fit)} of the labels. Later edits in “Edit model” use this classifier.`;
  } catch (e) { $("#train-info").textContent = e.message; }
});

function renderTreeView() {
  const t = S.r22_tree;
  $("#tree-info").textContent = t ? `v${t.version} · trained on ${t.trained_on} · ${t.nodes.length} nodes` : "";
  renderTree($("#tree"), t);
}

// restore state after a page reload
(async () => {
  try {
    const s = await (await fetch("/api/state")).json();
    if (s.tables) {
      S.r1_tables = s.tables.r1_tables;
      $("#btn-run").disabled = false;
      renderTables(s.tables);
    }
    if (s.p1) { S.p1 = s.p1; renderProcess1(); }
    if (s.p2) { onProcess2(s.p2); status("Restored previous session."); }
  } catch { /* fresh start */ }
})();
