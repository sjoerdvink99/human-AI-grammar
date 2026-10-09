// System X frontend. State names follow the design identifiers (r10, r11, r12_1 …).
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || res.statusText);
  return data;
};
const png = (b64) => b64 ? `data:image/png;base64,${b64}` : "";

const state = { meta: null, r11: null, session: null, r19: new Set() };

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === b));
  document.querySelectorAll(".tab-panel").forEach((p) => p.hidden = p.id !== `tab-${b.dataset.tab}`);
});

// ---------- job polling with stage display ----------
async function pollJob(jobId, progressEl) {
  while (true) {
    const job = await api(`/api/jobs/${jobId}`);
    progressEl.replaceChildren(...job.stages.map((s, i) =>
      el("span", { class: !job.done && i === job.stages.length - 1 ? "cur" : "" },
        s.stage + (s.info ? ` · ${s.info}` : ""))));
    if (job.done) { if (job.error) throw new Error(job.error); return job.result; }
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ---------- metrics display (evaluation shown next to the visual it judges) ----------
function renderMetrics(target, ev) {
  target.replaceChildren(...state.meta.metrics.map((m) => {
    const v = ev.metrics[m.key];
    return el("div", { class: "metric" }, m.label,
      el("div", { class: "bar" }, el("div", { style: `width:${Math.round(v * 100)}%` })),
      v.toFixed(2));
  }));
}

async function refreshModelStatus() {
  const { r9 } = await api("/api/model");
  const pill = $("#model-status");
  pill.textContent = r9 ? `Repair model trained · ${r9.n_records} records · ${r9.trained_at}` : "Repair model not trained";
  pill.classList.toggle("ok", !!r9);
  if (r9) renderWeights(r9);
  return r9;
}

// ================= Process 2 → 3 =================
function renderChartTypes() {
  $("#r11").replaceChildren(...state.meta.chart_types.map((c) => el("button", {
    class: state.r11 === c.value ? "on" : "",
    onclick: () => { state.r11 = c.value; renderChartTypes(); },
  }, c.label)));
}

$("#btn-create").onclick = async () => {
  const btn = $("#btn-create");
  $("#create-error").textContent = "";
  const r10 = $("#r10").value.trim();
  if (!r10) return ($("#create-error").textContent = "Describe the chart first.");
  if (!state.r11) return ($("#create-error").textContent = "Pick a chart type.");
  btn.disabled = true;
  $("#repair-view").hidden = true;
  try {
    const { job_id } = await api("/api/create", { method: "POST", body: { request: r10, chart_type: state.r11 } });
    const res = await pollJob(job_id, $("#create-progress"));
    showRepair(res);
  } catch (e) {
    $("#create-error").textContent = e.message;
  } finally { btn.disabled = false; }
};

function showRepair(res) {
  state.session = res;
  $("#repair-view").hidden = false;
  $("#final-view").hidden = true;
  $("#r13").src = png(res.r13_png);
  $("#r15").src = png(res.r15_png);
  $("#r14-score").textContent = res.r14.score.toFixed(1);
  $("#r16-score").textContent = res.r16.ok ? res.r16.score.toFixed(1) : "failed to render";
  renderMetrics($("#r14"), res.r14);
  renderMetrics($("#r16"), res.r16);
  const d = res.r17.score_delta;
  $("#r17").textContent = `${d >= 0 ? "+" : ""}${d.toFixed(1)} points`;
  $("#r17").className = `delta ${d >= 0 ? "pos" : "neg"}`;
  $("#rationale").textContent = res.rationale;
  $("#gains").replaceChildren(...res.gains.map((g) => el("div", { class: "gain" },
    el("b", {}, g.operator), el("span", { class: g.predicted_gain > 0 ? "dpos" : "dneg" },
      `${g.predicted_gain >= 0 ? "+" : ""}${g.predicted_gain.toFixed(1)}`), g.description)));
  // default: all hunks selected; the human deselects what they do not want
  state.r19 = new Set(res.r18.map((h) => h.id));
  renderHunks();
  if (!res.r18.length) $("#r18").replaceChildren(el("p", { class: "muted" }, "The model made no changes."));
}

function renderHunks() {
  const hunks = state.session.r18;
  $("#r18").replaceChildren(...hunks.map((h) => {
    const on = state.r19.has(h.id);
    const toggle = () => { on ? state.r19.delete(h.id) : state.r19.add(h.id); renderHunks(); };
    const box = el("input", { type: "checkbox" }); box.checked = on; box.onclick = (e) => { e.stopPropagation(); toggle(); };
    const head = el("div", { class: "hunk-head", onclick: toggle }, box,
      `Change ${h.id + 1} · line ${h.old_start} · ${h.tag === "insert" ? "added" : h.tag === "delete" ? "removed" : "changed"}`);
    const lines = [
      ...h.context_before.map((l) => el("span", { class: "ln ctx" }, "  " + l)),
      ...h.old_lines.map((l) => el("span", { class: "ln del" }, "- " + l)),
      ...h.new_lines.map((l) => el("span", { class: "ln add" }, "+ " + l)),
      ...h.context_after.map((l) => el("span", { class: "ln ctx" }, "  " + l)),
    ];
    return el("div", { class: `hunk ${on ? "" : "off"}` }, head, el("pre", {}, lines));
  }));
  $("#sel-count").textContent = `${state.r19.size} of ${hunks.length} changes selected`;
}
$("#sel-all").onclick = () => { state.r19 = new Set(state.session.r18.map((h) => h.id)); renderHunks(); };
$("#sel-none").onclick = () => { state.r19 = new Set(); renderHunks(); };

// ================= Process 3 (tool_5 modify) → Process 4 =================
$("#btn-apply").onclick = async () => {
  $("#apply-error").textContent = "";
  $("#btn-apply").disabled = true;
  try {
    const res = await api("/api/apply", { method: "POST",
      body: { session_id: state.session.session_id, hunk_ids: [...state.r19] } });
    $("#final-view").hidden = false;
    const svgUrl = URL.createObjectURL(new Blob([res.r20_svg], { type: "image/svg+xml" }));
    $("#r20").replaceChildren(el("img", { src: svgUrl, alt: "final chart", style: "width:100%" }));
    $("#r12_3").textContent = res.r12_3;
    $("#dl-svg").href = svgUrl;
    $("#dl-py").href = URL.createObjectURL(new Blob([res.r12_3], { type: "text/x-python" }));
    $("#final-view").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    $("#apply-error").textContent = e.message;
  } finally { $("#btn-apply").disabled = false; }
};

// ================= Process 1 =================
async function loadCorpus() {
  const items = await api("/api/corpus");
  $("#corpus-list").replaceChildren(...items.map((s) => el("div", { class: "corpus-item", title: s.code },
    el("span", {}, s.title),
    s.origin === "user" ? el("button", { onclick: async () => {
      await api(`/api/corpus?id=${encodeURIComponent(s.id)}`, { method: "DELETE" }); loadCorpus();
    } }, "remove") : el("span", { class: "muted" }, "seed"))));
}

$("#btn-add").onclick = async () => {
  $("#add-error").textContent = "";
  try {
    await api("/api/corpus", { method: "POST", body: { title: $("#new-title").value || "Untitled", code: $("#new-code").value } });
    $("#new-title").value = ""; $("#new-code").value = "";
    loadCorpus();
  } catch (e) { $("#add-error").textContent = e.message; }
};

$("#btn-train").onclick = async () => {
  $("#train-error").textContent = "";
  $("#btn-train").disabled = true;
  try {
    const { job_id } = await api("/api/train", { method: "POST" });
    const res = await pollJob(job_id, $("#train-progress"));
    renderTraining(res);
    await refreshModelStatus();
  } catch (e) { $("#train-error").textContent = e.message; }
  finally { $("#btn-train").disabled = false; }
};

function fmtDelta(d) { return el("span", { class: d > 0.5 ? "dpos" : d < 0 ? "dneg" : "muted" }, `${d >= 0 ? "+" : ""}${d.toFixed(1)}`); }

function renderTraining(res) {
  $("#train-results").hidden = false;
  $("#train-counts").textContent = `· ${res.n_r7} records composed (r7), ${res.n_r8} selected (r8, green)`;
  const rows = res.corpus.map((c) => el("tr", {},
    el("td", {}, el("b", {}, c.title), el("br"), el("img", { src: png(c.r2_png) }),
      c.r3.ok ? `score ${c.r3.score.toFixed(1)}` : el("span", { class: "error" }, "failed: " + (c.r3.error || ""))),
    el("td", {}, el("div", { class: "variants" }, c.variants.map((v) => el("div", { class: `variant ${v.selected ? "sel" : ""}` },
      el("img", { src: png(v.r4_png), style: "width:150px" }),
      el("div", {}, v.operator, " ", fmtDelta(v.r6), ` → ${v.r5.score.toFixed(1)}`)))))));
  $("#train-table").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "Original r1_1 → r2 · r3"), el("th", {}, "Variants r1_2 → r4 · r5, Δ r6"))),
    el("tbody", {}, rows)));
}

function renderWeights(r9) {
  $("#weights-card").hidden = false;
  const cols = r9.feature_names.length + 2;
  const max = Math.max(1e-6, ...Object.values(r9.weights).flat().map(Math.abs));
  const cells = [el("div", { class: "h" }, "edit"), ...r9.feature_names.map((f) => el("div", { class: "h" }, f)), el("div", { class: "h" }, "n")];
  for (const op of r9.operators) {
    cells.push(el("div", { class: "h", style: "text-align:left" }, op));
    r9.weights[op].forEach((w) => {
      const a = Math.min(1, Math.abs(w) / max);
      const color = w >= 0 ? `rgba(37,99,235,${a})` : `rgba(194,65,12,${a})`;
      cells.push(el("div", { style: `background:${color};color:${a > 0.5 ? "#fff" : "inherit"}`, title: w }, w.toFixed(1)));
    });
    cells.push(el("div", { class: "muted" }, r9.support[op]));
  }
  $("#weights").replaceChildren(el("div", { class: "wgrid", style: `grid-template-columns:120px repeat(${cols - 1}, 1fr)` }, cells));
}

// ---------- init ----------
(async () => {
  state.meta = await api("/api/meta");
  renderChartTypes();
  loadCorpus();
  const r9 = await refreshModelStatus();
  const { last_training } = await api("/api/model");
  if (last_training) renderTraining(last_training);
  if (!r9) document.querySelector('[data-tab="train"]').click();
})();
