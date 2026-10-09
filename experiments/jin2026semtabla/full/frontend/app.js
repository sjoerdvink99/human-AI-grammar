// Application shell: pipeline controls, state, inspector (selection, evidence, refinement, corrections).
import {
  renderSemanticViews, applyHighlight, renderValidationView, renderClassifierTree, rowsTable,
  categoryColor, TYPE_COLOR,
} from "./views.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ui = { state: null, profile: null, selection: null, hoverCategory: null, tab: "views", busy: false };

const STAGE_LABELS = {
  detect: "1 · Detect features",
  attributes: "2a · Column attributes & taxonomy",
  keys: "2b · Keys & relationships",
  dependencies: "2c · Functional dependencies",
  tables: "2d · Table labels & types",
};

// ------------------------------------------------------------------ API
async function api(path, opts = {}, busyText = "Working…") {
  setBusy(busyText);
  try {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || res.statusText);
    showError(null);
    return body;
  } catch (e) {
    showError(e.message);
    throw e;
  } finally {
    setBusy(null);
  }
}
const post = (path, data, busyText) => api(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? {}),
}, busyText);

function setBusy(text) {
  ui.busy = !!text;
  $("#busy").classList.toggle("hidden", !text);
  $("#busy-text").textContent = text || "";
  document.querySelectorAll("#pipeline button").forEach((b) => { if (text) b.disabled = true; });
  $("#demo").disabled = !!text;
  $("#upload").disabled = !!text;
  if (!text && ui.state) renderPipeline();
}
function showError(msg) {
  $("#error").classList.toggle("hidden", !msg);
  $("#error").textContent = msg ? `Error: ${msg}` : "";
}

// ------------------------------------------------------------------ state
function setState(s) {
  ui.state = s;
  ui.profile = currentProfile(s);
  if (ui.selection && !selectionStillValid()) ui.selection = null;
  render();
}

// Before stage 2d composes semantic_profile_1, show the stage results that exist so far.
function currentProfile(s) {
  if (s.stages_done.includes("tables") && s.semantic_profile) return s.semantic_profile;
  if (!s.column_semantics || !s.stages_done.includes("attributes")) return null;
  const kr = s.stages_done.includes("keys") ? s.key_relations : null;
  return {
    partial: true,
    tables: s.tables.map((t) => ({ name: t.name, rows: t.rows, primary_key: kr?.primary_keys[t.name] || [], labels: [], type: null })),
    columns: s.column_semantics,
    foreign_keys: kr ? kr.foreign_keys : [],
    functional_dependencies: s.stages_done.includes("dependencies") ? s.functional_dependencies : [],
  };
}

function selectionStillValid() {
  const s = ui.selection, p = ui.profile;
  if (!p) return false;
  if (s.kind === "table") return p.tables.some((t) => t.name === s.table);
  if (s.kind === "column") return p.columns.some((c) => c.table === s.table && c.column === s.column);
  return true;
}

// ------------------------------------------------------------------ rendering
function render() {
  renderPipeline();
  renderSidebar();
  renderViewsTab();
  renderDetectionTab();
  renderDataTab();
  renderClassifierTab();
  renderInspector();
}

function renderPipeline() {
  const s = ui.state;
  const nav = $("#pipeline");
  const hasTables = s.tables.length > 0;
  const steps = ["detect", ...s.stages];
  const done = new Set([...(s.detection ? ["detect"] : []), ...s.stages_done]);
  const nextStep = steps.find((st) => !done.has(st));
  nav.innerHTML = "";
  steps.forEach((st, i) => {
    if (i) nav.insertAdjacentHTML("beforeend", '<span class="arrow">›</span>');
    const b = document.createElement("button");
    b.textContent = STAGE_LABELS[st];
    b.className = done.has(st) ? "done" : st === nextStep ? "next" : "";
    const prevDone = i === 0 ? hasTables : done.has(steps[i - 1]);
    b.disabled = ui.busy || !prevDone;
    b.onclick = () => runStep(st);
    nav.appendChild(b);
  });
  const all = document.createElement("button");
  all.textContent = "Run all ▸▸";
  all.className = "next";
  all.style.marginLeft = "8px";
  all.disabled = ui.busy || !hasTables;
  all.onclick = runAll;
  nav.appendChild(all);
}

async function runStep(step) {
  if (step === "detect") {
    const sample_size = +$("#sample-size").value || 200, max_iterations = +$("#max-iter").value || 5;
    setState(await post("/api/detect", { sample_size, max_iterations }, "Sampling and checking features against the full data…"));
    return;
  }
  const text = step === "attributes" ? "Profiling columns; model_1 classifies ambiguous columns (can take ~30 s)…"
    : `Running stage ${STAGE_LABELS[step]}…`;
  setState(await post(`/api/enrich/${step}`, {}, text));
}

async function runAll() {
  const steps = ["detect", ...ui.state.stages];
  try {
    for (const st of steps) await runStep(st);
    switchTab("views");
  } catch { /* error already shown */ }
}

function renderSidebar() {
  const s = ui.state;
  $("#table-list").innerHTML = s.tables.map((t) =>
    `<li data-table="${esc(t.name)}" class="${ui.selection?.kind === "table" && ui.selection.table === t.name ? "selected" : ""}">
      <span>${esc(t.name)}</span><span class="muted">${t.rows} × ${t.columns.length}</span></li>`).join("")
    || '<li class="muted">No tables loaded.</li>';
  document.querySelectorAll("#table-list li[data-table]").forEach((li) => {
    li.onclick = () => (ui.profile ? selectTable(li.dataset.table) : (switchTab("data"), document.getElementById(`data-${li.dataset.table}`)?.scrollIntoView()));
  });
  const d = s.detection;
  $("#detection-summary").innerHTML = d
    ? `${d.converged ? "Converged" : "Stopped at max iterations"} after ${d.iterations} iteration(s): ${d.detected_features.length} verified features, ${d.refuted_features.length} refuted by counterexamples.`
    : "Not run yet.";
  $("#versions").innerHTML = s.profile_versions.map((v) =>
    `<li>semantic_profile v${v.version}${v.edits.length ? `<div class="muted small">${v.edits.map(describeEdit).map(esc).join("<br>")}</div>` : '<div class="muted small">from enrichment</div>'}</li>`).join("")
    || '<li class="muted">none yet</li>';
}

function describeEdit(e) {
  switch (e.op) {
    case "set_taxonomy": return `${e.table}.${e.column} → ${e.category}`;
    case "set_primary_key": return `key of ${e.table} = (${e.columns.join(", ")})`;
    case "add_foreign_key": return `+ FK ${e.from_table}.${e.from_column} → ${e.to_table}`;
    case "remove_foreign_key": return `− FK ${e.from_table}.${e.from_column} → ${e.to_table}`;
    case "add_fd": return `+ FD ${e.table}: ${e.lhs} → ${e.rhs}`;
    case "remove_fd": return `− FD ${e.table}: ${e.lhs} → ${e.rhs}`;
    default: return e.op;
  }
}

function renderViewsTab() {
  const p = ui.profile;
  $("#empty-views").classList.toggle("hidden", !!p);
  $("#views-grid").classList.toggle("hidden", !p);
  if (!p) {
    $("#empty-views").textContent = ui.state.tables.length
      ? "Run feature detection and the enrichment stages (top bar) to build the semantic views."
      : "Upload CSV tables or load the demo database, then run the pipeline above.";
    return;
  }
  if (ui.tab !== "views") return; // rendered when the tab becomes visible (needs layout sizes)
  renderSemanticViews(p, ui, { selectTable, selectColumn, selectForeignKey, selectFd, selectPrimaryKey });
}

function renderDetectionTab() {
  const d = ui.state.detection;
  const el = $("#detection-log");
  if (!d) { el.innerHTML = '<div class="empty">Feature detection has not run yet.</div>'; return; }
  const byKind = d3.group(d.detected_features, (f) => f.kind);
  el.innerHTML = `
    <div class="log-iter"><b>Samples:</b> ${Object.entries(d.initial_sample_sizes).map(([t, n]) => `${esc(t)} ${n} → ${d.sample_sizes[t]}`).join(" · ")}
      <div class="muted small">Initial random sample (plus referenced parent rows) → final size after counterexamples were added.</div></div>
    ${d.log.map((it) => `
      <div class="log-iter">
        <b>Iteration ${it.iteration}</b> — ${it.features} candidate features on the samples;
        ${it.counterexamples.length ? `<span style="color:var(--bad)">${it.counterexamples.length} refuted by the full data</span>` : '<span style="color:var(--good)">no counterexamples — done</span>'}
        ${it.counterexamples.map((c) => `
          <details><summary><code>${esc(c.feature)}</code> — ${c.count} contradicting rows, ${c.added_rows} added to the sample</summary>
          ${rowsTable(c.rows)}</details>`).join("")}
      </div>`).join("")}
    <div class="log-iter"><b>Verified features (${d.detected_features.length})</b>
      ${[...byKind].map(([k, fs]) => `<h4>${esc(k)} (${fs.length})</h4><div class="feature-list">${fs.map((f) => `<div>${esc(f.id)}</div>`).join("")}</div>`).join("")}
    </div>`;
}

function renderDataTab() {
  const el = $("#data-view");
  el.innerHTML = ui.state.tables.map((t) => `
    <div class="panel" style="margin-bottom:10px" id="data-${esc(t.name)}">
      <div class="panel-title">${esc(t.name)} <span class="hint">${t.rows} rows · ${t.columns.map((c) => `${esc(c.name)}: ${esc(c.type)}`).join(", ")}</span>
      ${ui.state.detection ? `<button class="small secondary" data-sample="${esc(t.name)}">Show sample</button>` : ""}</div>
      <div id="sample-${esc(t.name)}"></div>
      ${rowsTable(t.preview)}
    </div>`).join("") || '<div class="empty">No tables loaded.</div>';
  el.querySelectorAll("[data-sample]").forEach((b) => {
    b.onclick = async () => {
      const r = await api(`/api/samples/${encodeURIComponent(b.dataset.sample)}`, {}, "Loading sample…");
      document.getElementById(`sample-${b.dataset.sample}`).innerHTML = `<h4>Sample (first 100 rows of samples_1)</h4>${rowsTable(r.rows, { max: 100 })}<h4>Full table preview</h4>`;
    };
  });
}

function renderClassifierTab() {
  const g = ui.state.classifier;
  const el = $("#classifier-view");
  const t = ui.selection?.kind === "table" ? ui.profile?.tables.find((x) => x.name === ui.selection.table) : null;
  el.innerHTML = `
    <div class="panel" style="margin-bottom:10px">
      <div class="panel-title">Decision-tree table classifier (model_2) · version ${g.version}
        <span class="hint">${g.training_examples} training examples, ${g.corrections.length} from user corrections${t ? ` · path for <b>${esc(t.name)}</b> highlighted` : ""}</span>
        <button class="small danger" id="reset-classifier" style="float:right">Reset corrections</button></div>
      <div id="tree" style="overflow:auto"></div>
      <div class="legend">${Object.entries(TYPE_COLOR).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</div>
    </div>
    <div class="panel"><div class="panel-title">Corrections used for training</div>
      ${g.corrections.length ? rowsTable(g.corrections.map((c) => ({ table: c.table, predicted: c.predicted, corrected: c.type, labels: c.labels.join(", ") }))) : '<div class="muted">None yet. Correct a table type in the inspector to retrain the classifier.</div>'}
    </div>`;
  renderClassifierTree($("#tree"), g, t?.type_path);
  $("#reset-classifier").onclick = async () => {
    if (confirm("Remove all stored corrections and retrain from the seed examples?")) setState(await post("/api/classifier/reset"));
  };
}

function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${tab}`));
  if (tab === "views" && ui.state) renderViewsTab();
}

// ------------------------------------------------------------------ selection ([human select]) & inspector
function selectTable(table) { setSelection({ kind: "table", table }); }
function selectColumn(table, column) { setSelection({ kind: "column", table, column }); }
function selectPrimaryKey(table, columns) { setSelection({ kind: "primary_key", table, columns }); }
function selectForeignKey(fk) { setSelection({ kind: "foreign_key", ...fk, table: fk.from_table }); }
function selectFd(fd) { setSelection({ kind: "fd", ...fd }); }

function setSelection(sel) {
  ui.selection = sel;
  applyHighlight(ui);
  renderSidebar();
  renderInspector();
  if (ui.tab === "classifier") renderClassifierTab();
}

let inspectSeq = 0;
function renderInspector() {
  const el = $("#inspector");
  const sel = ui.selection, p = ui.profile;
  if (!sel || !p) {
    el.innerHTML = '<div class="muted">Select a column, table, relationship or dependency in the semantic views to inspect its evidence and correct it.</div>';
    return;
  }
  if (sel.kind === "table") return renderTableInspector(el, p.tables.find((t) => t.name === sel.table));
  el.innerHTML = `${inspectorHeader(sel)}<div id="edit-area"></div><div id="validation"></div>`;
  renderEditArea($("#edit-area"), sel);
  loadValidation(sel);
}

// process 3: selected_feature -> validation_queries -> execute -> validation_view
async function loadValidation(sel) {
  const box = $("#validation");
  if (ui.profile.partial) {
    box.innerHTML = '<div class="muted small" style="margin-top:10px">Evidence checks become available once stage 2d has composed the semantic profile.</div>';
    return;
  }
  const seq = ++inspectSeq;
  box.innerHTML = '<div class="loading-panel"><span class="spinner"></span>Building and running validation queries…</div>';
  const feature = { ...sel };
  try {
    const res = await fetch("/api/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected_feature: feature }) });
    const body = await res.json();
    if (seq !== inspectSeq) return;
    if (!res.ok) throw new Error(body.detail);
    renderValidationView(box, body);
  } catch (e) {
    if (seq === inspectSeq) box.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

function inspectorHeader(sel) {
  const p = ui.profile;
  if (sel.kind === "column") {
    const c = p.columns.find((x) => x.table === sel.table && x.column === sel.column);
    return `<div class="insp-title">${esc(sel.table)}.${esc(sel.column)}</div>
      <div><span class="badge" style="background:${categoryColor(c.category)}">${esc(c.category)}</span>
        <span class="muted small">assigned by ${c.source === "rule" ? "rule" : c.source === "user" ? "you" : `model_1 (${Math.round((c.confidence || 0) * 100)}% confident)`}</span></div>
      <div class="small" style="margin:4px 0 8px">${esc(c.rationale || "")}</div>
      <div class="kv">
        <div>type</div><div>${esc(c.type)}</div>
        <div>pattern</div><div>${esc(c.pattern || "—")} ${c.pattern ? `(${(c.pattern_ratio * 100).toFixed(1)}% of values)` : ""}${c.verified_pattern ? " ✓ verified" : ""}</div>
        <div>uniqueness</div><div>${(c.uniqueness * 100).toFixed(1)}% (${c.distinct} distinct)${c.verified_unique ? " ✓ verified unique" : ""}</div>
        <div>completeness</div><div>${((1 - c.null_ratio) * 100).toFixed(1)}%${c.verified_not_null ? " ✓ verified not null" : ""}</div>
        ${c.min !== undefined ? `<div>range</div><div>${esc(c.min)} … ${esc(c.max)}${c.mean != null ? ` (mean ${esc(c.mean)})` : ""}</div>` : ""}
        ${c.avg_length != null ? `<div>avg length</div><div>${esc(c.avg_length)}</div>` : ""}
        <div>top values</div><div>${(c.top_values || []).map((v) => `<span class="chip">${esc(v.value)} <span class="muted">${v.count}</span></span>`).join("")}</div>
      </div>`;
  }
  if (sel.kind === "primary_key") {
    return `<div class="insp-title">Primary key of ${esc(sel.table)}</div><div>(${sel.columns.map(esc).join(", ")})</div>`;
  }
  if (sel.kind === "foreign_key") {
    const fk = p.foreign_keys.find((f) => f.from_table === sel.from_table && f.from_column === sel.from_column && f.to_table === sel.to_table);
    return `<div class="insp-title">Relationship</div><div>${esc(sel.from_table)}.<b>${esc(sel.from_column)}</b> → ${esc(sel.to_table)}.<b>${esc(sel.to_column)}</b>
      <span class="badge light">${fk ? (fk.source === "user" ? "added by you" : "detected") : "removed"}</span></div>`;
  }
  if (sel.kind === "fd") {
    const fd = p.functional_dependencies.find((d) => d.table === sel.table && d.lhs === sel.lhs && d.rhs === sel.rhs);
    return `<div class="insp-title">Functional dependency</div><div>${esc(sel.table)}: <b>${esc(sel.lhs)}</b> → <b>${esc(sel.rhs)}</b>
      <span class="badge light">${fd ? (fd.source === "user" ? "added by you" : "detected") : "removed"}</span></div>`;
  }
  return "";
}

// process 4: [human modify] controls for the selected item
function renderEditArea(el, sel) {
  const p = ui.profile;
  if (p.partial) return;
  if (sel.kind === "column") {
    const c = p.columns.find((x) => x.table === sel.table && x.column === sel.column);
    const tax = Object.keys(ui.state.vocab.taxonomy);
    const t = p.tables.find((x) => x.name === sel.table);
    el.innerHTML = `<div class="edit-box"><b>Correct this column</b>
      <div class="edit-row">Category <select id="tax-select">${tax.map((k) => `<option value="${k}" ${k === c.category ? "selected" : ""} title="${esc(ui.state.vocab.taxonomy[k])}">${k}</option>`).join("")}</select>
        <button class="small" id="tax-apply">Apply</button></div>
      <div class="edit-row">${t.primary_key.includes(c.column) ? `<span class="muted small">part of the primary key</span>` : `<button class="small secondary" id="make-pk">Make (${esc(c.column)}) the primary key</button>`}</div>
      <div class="edit-row">References <select id="fk-target">${fkTargets(sel.table).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>
        <button class="small secondary" id="fk-add">Add relationship</button></div>
    </div>`;
    $("#tax-apply").onclick = () => refine([{ op: "set_taxonomy", table: sel.table, column: sel.column, category: $("#tax-select").value }]);
    $("#make-pk")?.addEventListener("click", () => refine([{ op: "set_primary_key", table: sel.table, columns: [sel.column] }]));
    $("#fk-add").onclick = () => {
      const [to_table, to_column] = JSON.parse($("#fk-target").value);
      refine([{ op: "add_foreign_key", from_table: sel.table, from_column: sel.column, to_table, to_column }]);
    };
  } else if (sel.kind === "foreign_key") {
    const exists = p.foreign_keys.some((f) => f.from_table === sel.from_table && f.from_column === sel.from_column && f.to_table === sel.to_table && f.to_column === sel.to_column);
    el.innerHTML = `<div class="edit-box">${exists ? '<button class="small danger" id="fk-remove">Remove this relationship</button>'
      : '<button class="small" id="fk-restore">Restore this relationship</button>'}</div>`;
    const { from_table, from_column, to_table, to_column } = sel;
    $("#fk-remove")?.addEventListener("click", () => refine([{ op: "remove_foreign_key", from_table, from_column, to_table, to_column }]));
    $("#fk-restore")?.addEventListener("click", () => refine([{ op: "add_foreign_key", from_table, from_column, to_table, to_column }]));
  } else if (sel.kind === "fd") {
    const exists = p.functional_dependencies.some((d) => d.table === sel.table && d.lhs === sel.lhs && d.rhs === sel.rhs);
    el.innerHTML = `<div class="edit-box">${exists ? '<button class="small danger" id="fd-remove">Remove this dependency</button>'
      : '<button class="small" id="fd-restore">Restore this dependency</button>'}</div>`;
    $("#fd-remove")?.addEventListener("click", () => refine([{ op: "remove_fd", table: sel.table, lhs: sel.lhs, rhs: sel.rhs }]));
    $("#fd-restore")?.addEventListener("click", () => refine([{ op: "add_fd", table: sel.table, lhs: sel.lhs, rhs: sel.rhs }]));
  }
}

function fkTargets(fromTable) {
  const out = [];
  for (const t of ui.profile.tables) {
    if (t.name === fromTable) continue;
    const keys = new Set([...(t.primary_key.length === 1 ? t.primary_key : []), ...(t.candidate_keys || []).filter((k) => k.length === 1).map((k) => k[0])]);
    for (const c of ui.profile.columns.filter((x) => x.table === t.name)) {
      out.push({ value: JSON.stringify([t.name, c.column]), label: `${t.name}.${c.column}${keys.has(c.column) ? " (key)" : ""}`, key: keys.has(c.column) });
    }
  }
  return out.sort((a, b) => b.key - a.key);
}

function renderTableInspector(el, t) {
  const p = ui.profile;
  const types = ui.state.vocab.table_types;
  const cols = p.columns.filter((c) => c.table === t.name);
  const fksOut = p.foreign_keys.filter((f) => f.from_table === t.name);
  const fksIn = p.foreign_keys.filter((f) => f.to_table === t.name);
  const fds = p.functional_dependencies.filter((d) => d.table === t.name);
  el.innerHTML = `
    <div class="insp-title">${esc(t.name)}</div>
    <div>${t.type ? `<span class="badge" style="background:${TYPE_COLOR[t.type]}">${esc(t.type)}</span>` : '<span class="muted">type not yet classified</span>'}
      <span class="muted small">${t.type ? (t.type_source === "user" ? "corrected by you" : `model_2 decision tree, ${Math.round((t.type_confidence || 0) * 100)}%`) : ""}
      ${t.previous_type && t.previous_type !== t.type ? ` · was ${esc(t.previous_type)}` : ""}</span></div>
    <div class="kv" style="margin-top:8px">
      <div>rows</div><div>${t.rows}</div>
      <div>primary key</div><div>${t.primary_key.length ? `<a href="#" id="pk-link">(${t.primary_key.map(esc).join(", ")})</a> <span class="muted small">click to check</span>` : "none"}</div>
      <div>candidate keys</div><div>${(t.candidate_keys || []).map((k) => `<span class="chip">${k.map(esc).join(", ")}</span>`).join("") || "—"}</div>
      <div>references</div><div>${fksOut.map((f) => `<span class="chip">${esc(f.from_column)} → ${esc(f.to_table)}</span>`).join("") || "—"}</div>
      <div>referenced by</div><div>${fksIn.map((f) => `<span class="chip">${esc(f.from_table)}.${esc(f.from_column)}</span>`).join("") || "—"}</div>
      <div>dependencies</div><div>${fds.map((d) => `<span class="chip">${esc(d.lhs)} → ${esc(d.rhs)}</span>`).join("") || "—"}</div>
      <div>table labels</div><div>${t.labels.map((l) => `<span class="chip" title="${esc(ui.state.vocab.table_labels[l])}">${esc(l)}</span>`).join("") || "—"}</div>
    </div>
    ${t.type_path?.length ? `<h4>Why ${esc(t.type)}? (decision path)</h4>${t.type_path.filter((s) => !s.leaf).map((s) => `<div class="path-step">${s.present ? "✓" : "✗"} ${esc(s.label)}</div>`).join("")}` : ""}
    ${p.partial ? "" : `
    <div class="edit-box"><b>Correct the table type</b> <span class="muted small">retrains the classifier</span>
      <div class="edit-row"><select id="type-select">${Object.entries(types).map(([k, d]) => `<option value="${k}" ${k === t.type ? "selected" : ""} title="${esc(d)}">${k} — ${esc(d)}</option>`).join("")}</select>
      <button class="small" id="type-apply">Correct</button></div>
    </div>
    <div class="edit-box"><b>Set the primary key</b>
      <div class="edit-row">${cols.map((c) => `<label class="small"><input type="checkbox" value="${esc(c.column)}" ${t.primary_key.includes(c.column) ? "checked" : ""}/> ${esc(c.column)}</label>`).join(" ")}</div>
      <button class="small secondary" id="pk-apply">Apply key</button>
    </div>
    <div class="edit-box"><b>Add a functional dependency</b>
      <div class="edit-row"><select id="fd-lhs">${cols.map((c) => `<option>${esc(c.column)}</option>`).join("")}</select> →
        <select id="fd-rhs">${cols.map((c) => `<option>${esc(c.column)}</option>`).join("")}</select>
        <button class="small secondary" id="fd-add">Add</button></div>
    </div>`}`;
  $("#pk-link")?.addEventListener("click", (e) => { e.preventDefault(); selectPrimaryKey(t.name, t.primary_key); });
  if (p.partial) return;
  $("#type-apply").onclick = async () => {
    const v = $("#type-select").value;
    if (v === t.type && t.type_source === "user") return;
    setState(await post("/api/table-type", { table: t.name, table_type: v }, "Retraining the table classifier…"));
  };
  $("#pk-apply").onclick = () => {
    const columns = [...el.querySelectorAll(".edit-box input[type=checkbox]:checked")].map((i) => i.value);
    refine([{ op: "set_primary_key", table: t.name, columns }]);
  };
  $("#fd-add").onclick = () => {
    const lhs = $("#fd-lhs").value, rhs = $("#fd-rhs").value;
    if (lhs !== rhs) refine([{ op: "add_fd", table: t.name, lhs, rhs }]);
  };
}

// process 4: semantic_profile_1 -> semantic_profile_2 -> labels -> types -> updated views
async function refine(edits) {
  try {
    setState(await post("/api/refine", { edits }, "Updating labels and re-classifying tables…"));
  } catch { /* shown */ }
}

// ------------------------------------------------------------------ wiring
document.querySelectorAll(".tabs button").forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
$("#demo").onclick = async () => { ui.selection = null; setState(await post("/api/demo", {}, "Loading demo database…")); };
$("#upload").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  ui.selection = null;
  try { setState(await api("/api/upload", { method: "POST", body: fd }, "Uploading tables…")); } catch { /* shown */ }
  e.target.value = "";
};
window.addEventListener("resize", () => { if (ui.tab === "views" && ui.profile) renderViewsTab(); });

api("/api/state", {}, "Loading…").then(setState);
