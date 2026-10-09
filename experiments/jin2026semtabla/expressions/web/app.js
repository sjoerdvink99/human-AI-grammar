// System X frontend. Names follow design.json: tables, samples, detected_features, semantic_profile,
// semantic_views, selected_feature, validation_view, table_types_2, updated_table_classifier.
import { TYPE_COLORS, SOURCE_COLORS, esc, renderSchemaGraph, renderValidationView, renderRows, renderTree } from "./views.js";

let S = null;                 // server state (all representations)
let tab = ["features", "profile", "training"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "profile";
let selected_feature = null;  // process 3 selection
let validation = null;        // process 3 result
let editing = false;          // process 4 edit mode
let draft = null;             // semantic_profile_2 being edited
let compareParent = true;
let corrections = {};         // process 5: table -> corrected type (table_types_2)
let p1Table = null;

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- server calls
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, info = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = info ? "info" : "";
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), info ? 2500 : 7000);
}

// long operations: show the progress log of the running process (generative steps are marked ~)
async function withProgress(promise) {
  $("#overlay").classList.remove("hidden");
  const log = $("#overlay-log");
  log.innerHTML = "<div>starting…</div>";
  const timer = setInterval(async () => {
    try {
      const p = await api("/api/progress");
      if (p.log.length) log.innerHTML = p.log.map((l) => `<div>${esc(l)}</div>`).join("");
    } catch { /* ignore */ }
  }, 600);
  try { return await promise; }
  catch (e) { toast(e.message); return null; }
  finally { clearInterval(timer); $("#overlay").classList.add("hidden"); }
}

async function refresh() { S = await api("/api/state"); render(); }

// ---------------------------------------------------------------- actions
const actions = {
  async loadSample() { S = await api("/api/tables/sample", {}); resetUi(); render(); },
  async upload(files) {
    for (const f of files) S = await api("/api/tables/upload", { name: f.name, csv: await f.text() });
    resetUi(); render();
  },
  async remove(name) { S = await api("/api/tables/remove", { name }); resetUi(); render(); },
  async clear() { S = await api("/api/tables/clear", {}); resetUi(); render(); },
  async preview(name) {
    const p = await api(`/api/tables/preview?name=${encodeURIComponent(name)}&limit=100`);
    openDrawer(`<h3>${esc(name)} <span class="muted">first ${p.rows.length} rows</span></h3>${renderRows(p)}`);
  },
  async profile() {   // process 1 (+ process 2 continues from it)
    const s = await withProgress(api("/api/process1", { continue: true }));
    if (s) { S = s; resetUi(); tab = "profile"; render(); }
  },
  async rerunProcess2() {
    const s = await withProgress(api("/api/process2", {}));
    if (s) { S = s; resetUi(); tab = "profile"; render(); }
  },
  async select(sel) {   // [human select] -> [tool_1 translate] -> [tool_1 execute] -> [tool_2 translate]
    if (editing) return;
    selected_feature = sel;
    render();
    try {
      validation = await api("/api/process3", { selected_feature: sel });
      openDrawer(renderValidationView(validation));
    } catch (e) { toast(e.message); }
  },
  startEdit() { draft = structuredClone(S.semantic_profile); editing = true; closeDrawer(); render(); },
  cancelEdit() { draft = null; editing = false; render(); },
  async applyEdits() {  // process 4
    const s = await withProgress(api("/api/process4", { semantic_profile: draft }));
    if (s) { S = s; editing = false; draft = null; render(); toast(`semantic profile v${S.semantic_profile.version} created`, true); }
  },
  async selectVersion(v) { S = await api("/api/profile/select", { version: v }); selected_feature = null; closeDrawer(); render(); },
  async train() {       // process 5
    const corr = S.p2.table_types.map((t) => ({ table: t.table, table_type: corrections[t.table] ?? t.table_type }));
    const s = await withProgress(api("/api/process5/train", { corrections: corr }));
    if (s) { S = s; render(); toast(`classifier v${S.classifier.version} trained`, true); }
  },
  async resetClassifier() {
    if (!confirm("Delete the trained table classifier and all its labelled examples?")) return;
    S = await api("/api/classifier/reset", {}); render();
  },
};

function resetUi() { selected_feature = null; validation = null; editing = false; draft = null; corrections = {}; closeDrawer(); }
function openDrawer(html) {
  const d = $("#drawer");
  d.innerHTML = `<button class="btn close">✕</button>` + html;
  d.classList.remove("hidden");
  d.querySelector(".close").onclick = () => { closeDrawer(); selected_feature = null; render(); };
}
function closeDrawer() { $("#drawer").classList.add("hidden"); }

// ---------------------------------------------------------------- sidebar
const PIPELINE = [
  ["Process 1 · sampling", [["[tool_1 select] samples", (s) => s.p1], ["[tool_1 extract] detected_features", (s) => s.p1],
    ["[tool_1 evaluate] counterexamples", (s) => s.p1], ["[tool_1 expand] ↺ samples", (s) => s.p1 && s.p1.rounds.length > 1]]],
  ["Process 2 · semantic profile", [["[tool_1 extract] column_attributes", (s) => s.p2], ["[tool_1 assign] rule_taxonomies", (s) => s.p2],
    ["[model_1 assign]~ predicted_taxonomies", (s) => s.p2], ["[tool_1 compose] column_semantics", (s) => s.p2],
    ["[tool_1 extract] key_relations", (s) => s.p2], ["[tool_1 extract] functional_dependencies", (s) => s.p2],
    ["[tool_1 assign] table_labels", (s) => s.p2], ["[model_2 assign]~ table_types", (s) => s.p2],
    ["[tool_1 compose] semantic_profile", (s) => s.p2], ["[tool_2 translate] semantic_views", (s) => s.p2]]],
  ["Process 3 · validation", [["[human select] selected_feature", () => selected_feature], ["[tool_1 translate] validation_queries", () => validation],
    ["[tool_1 execute] samples + counterexamples", () => validation], ["[tool_2 translate] validation_view", () => validation]]],
  ["Process 4 · refinement", [["[human modify] semantic_profile_2", (s) => s.p4], ["[tool_1 assign] refined_table_labels", (s) => s.p4],
    ["[model_2 assign]~ refined_table_types", (s) => s.p4], ["[tool_2 translate] updated_semantic_views", (s) => s.p4]]],
  ["Process 5 · training", [["[human modify] table_types_2", (s) => s.table_types_2], ["[model_2 train] updated_table_classifier", (s) => s.classifier]]],
];

function renderSidebar() {
  const sb = $("#sidebar");
  const tables = S.tables;
  const profile = S.semantic_profile;
  sb.innerHTML = `
    <div class="section">
      <h3>Tables <span class="muted">(${tables.length})</span></h3>
      <div class="row">
        <button class="btn" id="b-sample">Load sample lake</button>
        <button class="btn" id="b-upload">Upload CSV…</button>
        <input type="file" id="f-upload" accept=".csv,text/csv" multiple hidden />
      </div>
      <ul class="tlist">${tables.map((t) => `<li data-t="${esc(t.name)}"><span>${esc(t.name)} <span class="muted">${t.n_rows} × ${t.columns.length}</span></span><span class="x" data-rm="${esc(t.name)}" title="remove">✕</span></li>`).join("")}</ul>
      ${tables.length ? `<div class="row"><button class="btn primary" id="b-profile">Profile tables</button><button class="btn" id="b-clear">Clear</button></div>` : '<p class="muted">Load the sample data or upload CSV files.</p>'}
    </div>
    ${S.profiles.length ? `<div class="section versions"><h3>Profile versions</h3>
      ${S.profiles.map((p) => `<label><input type="radio" name="ver" value="${p.version}" ${p.version === profile.version ? "checked" : ""}/> v${p.version} <span class="muted">${esc(p.note)}${p.parent ? ` (from v${p.parent})` : ""}</span></label>`).join("")}
    </div>` : ""}
    <div class="section"><h3>Pipeline</h3><ul class="steps">
      ${PIPELINE.map(([name, steps]) => `<li class="proc">${name}</li>` + steps.map(([s, f]) => `<li class="${S && f(S) ? "done" : ""}">${esc(s)}</li>`).join("")).join("")}
    </ul></div>`;
  sb.querySelector("#b-sample").onclick = () => actions.loadSample().catch((e) => toast(e.message));
  sb.querySelector("#b-upload").onclick = () => sb.querySelector("#f-upload").click();
  sb.querySelector("#f-upload").onchange = (e) => actions.upload([...e.target.files]).catch((er) => toast(er.message));
  sb.querySelector("#b-profile")?.addEventListener("click", actions.profile);
  sb.querySelector("#b-clear")?.addEventListener("click", () => actions.clear());
  sb.querySelectorAll("[data-t]").forEach((li) => li.addEventListener("click", (e) => {
    if (e.target.dataset.rm) actions.remove(e.target.dataset.rm); else actions.preview(li.dataset.t);
  }));
  sb.querySelectorAll('input[name="ver"]').forEach((r) => r.addEventListener("change", () => actions.selectVersion(+r.value)));
}

// ---------------------------------------------------------------- process 1 view
function renderFeaturesTab(main) {
  const p1 = S.p1;
  if (!p1) { main.innerHTML = `<div class="empty">Run “Profile tables” to sample the tables and detect features.</div>`; return; }
  const names = Object.keys(p1.samples);
  if (!p1Table || !names.includes(p1Table)) p1Table = names[0];
  const feats = p1.detected_features.filter((f) => f.table === p1Table);
  const ces = p1.rounds.flatMap((r) => r.counterexamples).filter((c) => c.table === p1Table);
  const sample = p1.samples[p1Table];
  const cols = S.tables.find((t) => t.name === p1Table).columns.map((c) => c.name);
  main.innerHTML = `
    <h2>Sampling loop <span class="muted">— features detected on samples, checked on the full tables; counterexamples are added to the samples until the features hold</span></h2>
    <div class="rounds">${p1.rounds.map((r) => `<div class="round"><div>Round ${r.round}</div>
      <b>${Object.values(r.sample_sizes).reduce((a, b) => a + b, 0)}</b> sampled rows<br/>
      ${r.n_features} features · <span class="${r.n_violated ? "bad" : "ok"}">${r.n_violated} violated</span><br/>
      ${r.counterexamples.length} counterexamples ${r.counterexamples.length ? "→ expand" : "→ stop"}</div>`).join("")}</div>
    <div class="toolbar">${names.map((n) => `<button class="btn ${n === p1Table ? "primary" : ""}" data-p1="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    <div class="cards">
      <div class="card"><h3>detected_features <span class="muted">(final round)</span></h3>
        <div class="tablewrap"><table class="data"><thead><tr><th>column</th><th>kind</th><th>feature</th><th>status</th></tr></thead><tbody>
        ${feats.map((f) => `<tr><td>${esc(f.column)}</td><td>${esc(f.kind)}</td><td title="${esc(f.description)}">${esc(f.description)}</td><td><span class="pill ${f.status}">${f.status}${f.violations ? ` (${f.violations})` : ""}</span></td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><h3>counterexamples <span class="muted">(all rounds)</span></h3>
        ${ces.length ? `<div class="tablewrap"><table class="data"><thead><tr><th>round</th><th>feature</th><th>value</th><th>row</th></tr></thead><tbody>
        ${ces.map((c) => `<tr><td>${c.round}</td><td>${esc(c.feature)}</td><td class="hl">${c.value === null ? '<span class="null">null</span>' : esc(c.value)}</td><td>#${c.row.__rowid}</td></tr>`).join("")}
        </tbody></table></div>` : '<p class="muted">none — the first sample was representative</p>'}</div>
    </div>
    <div class="card"><h3>samples <span class="muted">(${sample.length} rows; green rows were added from counterexamples)</span></h3>
      <div class="tablewrap"><table class="data"><thead><tr><th>row</th><th>round</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${sample.map((r) => `<tr class="${r.__round > 1 ? "added" : ""}"><td>#${r.__rowid}</td><td>${r.__round}</td>${cols.map((c) => `<td>${r[c] === null ? '<span class="null">null</span>' : esc(r[c])}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div>`;
  main.querySelectorAll("[data-p1]").forEach((b) => b.onclick = () => { p1Table = b.dataset.p1; render(); });
}

// ---------------------------------------------------------------- processes 2-4 view
function legendHtml() {
  return `<div class="legend">${Object.entries(TYPE_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}
    <span style="margin-left:10px">column type source:</span>${Object.entries(SOURCE_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</div>`;
}

function renderProfileTab(main) {
  const base = S.semantic_profile;
  if (!base) { main.innerHTML = `<div class="empty">No semantic profile yet. Load tables and click “Profile tables”.</div>`; return; }
  const profile = editing ? draft : base;
  const parent = !editing && compareParent && base.parent ? S.profiles.find((p) => p.version === base.parent) : null;
  const tax = S.taxonomy;
  const allCols = profile.tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.column}`));

  main.innerHTML = `
    <div class="toolbar">
      <h2 style="margin:0">semantic_profile v${profile.version}${editing ? " → draft v" + (S.profiles.length + 1) : ""}</h2>
      ${editing ? `<span class="editing-banner">Editing: change column types and primary keys, add or remove foreign keys and FDs.</span>
          <button class="btn primary" id="b-apply">Apply edits (re-label tables)</button><button class="btn" id="b-cancel">Cancel</button>`
        : `<button class="btn" id="b-edit">Edit profile</button>
           ${base.parent ? `<label><input type="checkbox" id="c-compare" ${compareParent ? "checked" : ""}/> mark changes vs v${base.parent}</label>` : ""}
           <span class="muted">Click a column, PK, foreign-key edge, FD or feature to validate it.</span>`}
    </div>
    ${legendHtml()}
    ${editing ? `<div class="card row">Add foreign key:
        <select id="fk-from">${allCols.map((c) => `<option>${esc(c)}</option>`).join("")}</select> →
        <select id="fk-to">${allCols.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
        <button class="btn" id="b-addfk">Add</button>
        &nbsp; Add FD in <select id="fd-t">${profile.tables.map((t) => `<option>${esc(t.name)}</option>`).join("")}</select>:
        <input id="fd-l" placeholder="lhs column" size="10"/> → <input id="fd-r" placeholder="rhs column" size="10"/>
        <button class="btn" id="b-addfd">Add</button></div>` : ""}
    <div class="graphwrap" id="graph"></div>
    <div class="cards">${profile.tables.map((t) => tableCard(t, profile, parent, tax)).join("")}</div>`;

  main.querySelector("#graph").appendChild(renderSchemaGraph(profile, {
    onSelect: actions.select, selected: selected_feature, compare: parent }));

  if (editing) {
    main.querySelector("#b-apply").onclick = actions.applyEdits;
    main.querySelector("#b-cancel").onclick = actions.cancelEdit;
    main.querySelector("#b-addfk").onclick = () => {
      const [ft, fc] = main.querySelector("#fk-from").value.split(".");
      const [tt, tc] = main.querySelector("#fk-to").value.split(".");
      if (ft === tt) return toast("a foreign key must connect two tables");
      draft.key_relations.edges.push({ id: `fk:${ft}.${fc}->${tt}.${tc}`, kind: "foreign_key", from_table: ft, from_column: fc,
        to_table: tt, to_column: tc, source: "human", exact: null });
      render();
    };
    main.querySelector("#b-addfd").onclick = () => {
      const t = main.querySelector("#fd-t").value, l = main.querySelector("#fd-l").value.trim(), r = main.querySelector("#fd-r").value.trim();
      const cols = draft.tables.find((x) => x.name === t).columns.map((c) => c.column);
      if (!cols.includes(l) || !cols.includes(r) || l === r) return toast(`columns must be two different columns of ${t}`);
      draft.functional_dependencies.edges.push({ id: `fd:${t}.${l}->${r}`, kind: "fd", table: t, lhs: l, rhs: r, source: "human" });
      render();
    };
    main.querySelectorAll("select[data-col]").forEach((s) => s.onchange = () => {
      const [t, c] = s.dataset.col.split("|");
      draft.tables.find((x) => x.name === t).columns.find((x) => x.column === c).semantic_type = s.value;
      render();
    });
    main.querySelectorAll("select[data-pk]").forEach((s) => s.onchange = () => {
      draft.tables.find((x) => x.name === s.dataset.pk).primary_key = s.value || null; render();
    });
    main.querySelectorAll("[data-rmfk]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation(); draft.key_relations.edges = draft.key_relations.edges.filter((x) => x.id !== b.dataset.rmfk); render();
    });
    main.querySelectorAll("[data-rmfd]").forEach((b) => b.onclick = (e) => {
      e.stopPropagation(); draft.functional_dependencies.edges = draft.functional_dependencies.edges.filter((x) => x.id !== b.dataset.rmfd); render();
    });
  } else {
    main.querySelector("#b-edit").onclick = actions.startEdit;
    main.querySelector("#c-compare")?.addEventListener("change", (e) => { compareParent = e.target.checked; render(); });
    main.querySelectorAll("[data-fd]").forEach((b) => b.onclick = () => {
      const e = profile.functional_dependencies.edges.find((x) => x.id === b.dataset.fd);
      actions.select({ kind: "fd", id: e.id, table: e.table, lhs: e.lhs, rhs: e.rhs, label: `${e.table}: ${e.lhs} → ${e.rhs}` });
    });
    main.querySelectorAll("[data-fk]").forEach((b) => b.onclick = () => {
      const e = profile.key_relations.edges.find((x) => x.id === b.dataset.fk);
      actions.select({ kind: "foreign_key", id: e.id, from_table: e.from_table, from_column: e.from_column, to_table: e.to_table, to_column: e.to_column, label: `${e.from_table}.${e.from_column} → ${e.to_table}.${e.to_column}` });
    });
    main.querySelectorAll("[data-feat]").forEach((b) => b.onclick = () => {
      const [t, c, i] = b.dataset.feat.split("|");
      const f = profile.tables.find((x) => x.name === t).columns.find((x) => x.column === c).features[+i];
      actions.select({ kind: "feature", feature: { ...f, table: t, column: c }, label: `${t}: ${f.description}` });
    });
    main.querySelectorAll("[data-coltype]").forEach((b) => b.onclick = () => {
      const [t, c] = b.dataset.coltype.split("|");
      const col = profile.tables.find((x) => x.name === t).columns.find((x) => x.column === c);
      actions.select({ kind: "column_type", table: t, column: c, semantic_type: col.semantic_type, label: `${t}.${c} is ${col.semantic_type}` });
    });
  }
}

function tableCard(t, profile, parent, tax) {
  const prevT = parent?.tables.find((x) => x.name === t.name);
  const fks = profile.key_relations.edges.filter((e) => e.from_table === t.name);
  const fds = profile.functional_dependencies.edges.filter((e) => e.table === t.name);
  return `<div class="card">
    <h3>${esc(t.name)} <span class="badge" style="background:${TYPE_COLORS[t.table_type]}">${esc(t.table_type)}</span>
      <span class="muted">${Math.round((t.type_confidence || 0) * 100)}% · ${t.n_rows} rows</span>
      ${prevT && prevT.table_type !== t.table_type ? `<span class="muted">(was ${esc(prevT.table_type)})</span>` : ""}</h3>
    <div class="muted">model_2: ${esc(t.type_rationale)}</div>
    <div class="muted">rule label: <b>${esc(t.rule_label)}</b> — ${esc(t.rule)}</div>
    <div style="margin-top:4px">PK: ${editing
      ? `<select data-pk="${esc(t.name)}"><option value="">(none)</option>${t.columns.map((c) => `<option ${c.column === t.primary_key ? "selected" : ""}>${esc(c.column)}</option>`).join("")}</select>`
      : `<b>${esc(t.primary_key ?? "none")}</b>`}
      &nbsp; FKs: ${fks.map((e) => `<span class="chipbtn" data-fk="${esc(e.id)}">${esc(e.from_column)}→${esc(e.to_table)}.${esc(e.to_column)}${editing ? `<span class="x" data-rmfk="${esc(e.id)}">✕</span>` : ""}</span>`).join("") || '<span class="muted">none</span>'}</div>
    <div>FDs: ${fds.map((e) => `<span class="chipbtn" data-fd="${esc(e.id)}">${esc(e.lhs)} → ${esc(e.rhs)}${editing ? `<span class="x" data-rmfd="${esc(e.id)}">✕</span>` : ""}</span>`).join("") || '<span class="muted">none</span>'}</div>
    <table class="data" style="margin-top:6px"><thead><tr><th>column</th><th>semantic type</th><th>rule</th><th>model_1</th><th>features</th></tr></thead><tbody>
    ${t.columns.map((c) => {
      const prevC = prevT?.columns.find((x) => x.column === c.column);
      return `<tr><td>${esc(c.column)}</td>
      <td>${editing ? `<select data-col="${esc(t.name)}|${esc(c.column)}">${tax.semantic_types.map((s) => `<option ${s === c.semantic_type ? "selected" : ""}>${s}</option>`).join("")}</select>`
        : `<span class="chipbtn" data-coltype="${esc(t.name)}|${esc(c.column)}">${esc(c.semantic_type)}</span> <span class="pill ${c.source}">${c.source}</span>${prevC && prevC.semantic_type !== c.semantic_type ? ` <span class="muted">was ${esc(prevC.semantic_type)}</span>` : ""}`}</td>
      <td title="${esc(c.rule)}">${esc(c.rule_type)}</td>
      <td title="${esc(c.model_rationale)}">${esc(c.model_type)} <span class="muted">${Math.round((c.model_confidence || 0) * 100)}%</span></td>
      <td>${c.features.filter((f) => f.kind !== "type").map((f, i) => `<span class="chipbtn" ${editing ? "" : `data-feat="${esc(t.name)}|${esc(c.column)}|${c.features.indexOf(f)}"`} title="${esc(f.description)}">${esc(f.kind)}</span>`).join("")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- process 5 view
function renderTrainingTab(main) {
  if (!S.p2) { main.innerHTML = `<div class="empty">Profile the tables first; then correct table types here to retrain model_2.</div>`; return; }
  const c = S.classifier;
  const types = S.taxonomy.table_types;
  const labels = Object.fromEntries(S.p2.table_labels.map((l) => [l.table, l]));
  const t2 = Object.fromEntries((S.table_types_2 || []).map((t) => [t.table, t.table_type]));
  main.innerHTML = `
    <h2>Correct table types <span class="muted">— your labels (table_types_2) become training examples for model_2</span></h2>
    <div class="card"><table class="data"><thead><tr><th>table</th><th>columns</th><th>rule label</th><th>model_2 type</th><th>your label</th><th></th></tr></thead><tbody>
    ${S.p2.table_types.map((t) => {
      const cur = corrections[t.table] ?? t2[t.table] ?? t.table_type;
      const changed = cur !== t.table_type;
      return `<tr><td><b>${esc(t.table)}</b></td>
        <td class="muted">${S.p2.column_semantics.filter((x) => x.table === t.table).map((x) => esc(x.column + ":" + x.semantic_type)).join(", ")}</td>
        <td>${esc(labels[t.table]?.label)}</td>
        <td><span class="badge" style="background:${TYPE_COLORS[t.table_type]}">${esc(t.table_type)}</span> <span class="muted" title="${esc(t.rationale)}">${Math.round(t.confidence * 100)}%</span></td>
        <td><select data-corr="${esc(t.table)}">${types.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("")}</select></td>
        <td>${changed ? '<span class="pill human">corrected</span>' : '<span class="pill">confirmed</span>'}</td></tr>`;
    }).join("")}</tbody></table>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="b-train">Train classifier on these labels</button>
      ${c ? `<button class="btn" id="b-rerun">Re-profile with updated classifier</button><button class="btn warn" id="b-reset">Reset classifier</button>` : ""}</div></div>
    ${c ? `<h2>updated_table_classifier v${c.version} <span class="muted">— trained ${new Date(c.trained_at * 1000).toLocaleString()}, ${c.examples.length} examples, training accuracy ${Math.round(c.training_accuracy * 100)}%</span></h2>
      <div class="card"><p>${esc(c.summary)}</p><div class="graphwrap" id="tree"></div></div>
      <div class="card"><h3>Training examples</h3><div class="tablewrap"><table class="data"><thead><tr><th>table</th><th>label</th><th>tree predicts</th>${S.taxonomy.table_features.map((f) => `<th>${f}</th>`).join("")}</tr></thead><tbody>
      ${c.examples.map((e, i) => `<tr><td>${esc(e.table)}</td><td>${esc(e.table_type)}</td><td class="${c.predictions[i]?.predicted === e.table_type ? "" : "hl"}">${esc(c.predictions[i]?.predicted)}</td>${S.taxonomy.table_features.map((f) => `<td>${esc(e.features[f])}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div>` : '<p class="muted">No trained classifier yet — model_2 currently classifies from its instructions alone.</p>'}`;
  main.querySelectorAll("[data-corr]").forEach((s) => s.onchange = () => { corrections[s.dataset.corr] = s.value; render(); });
  main.querySelector("#b-train").onclick = actions.train;
  main.querySelector("#b-rerun")?.addEventListener("click", actions.rerunProcess2);
  main.querySelector("#b-reset")?.addEventListener("click", actions.resetClassifier);
  if (c) main.querySelector("#tree").appendChild(renderTree(c.tree));
}

// ---------------------------------------------------------------- render
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderSidebar();
  const main = $("#main");
  ({ features: renderFeaturesTab, profile: renderProfileTab, training: renderTrainingTab })[tab](main);
}

document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", "#" + tab); render(); });
refresh().catch((e) => toast(e.message));
