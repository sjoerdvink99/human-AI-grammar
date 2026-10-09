// System X frontend. Identifiers follow the design (topic, data_facts, scripts, video, ...).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let S = null;              // server state
let G = { guidelines: [], reference_videos: [] };
let draft = [];            // scripts being edited (scripts_2 before rendering)
let draftVersion = -1;
let selectedScene = null;  // scene_focus
let focus = null;          // {guideline_focus, reference_focus}
let chartType = "bar";     // chart_type
let mode = "full";         // replacement process: full (P6) or shape (P7)
let region = null;         // chart_region (P7)
let reviewId = null;       // reviewed_video (P8)
const busy = { generate: false, render: false, clips: new Set(), chart: false, replace: false };

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
  return data;
}

function toast(msg, error = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (error ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), error ? 7000 : 3000);
}
function status(el, msg, kind) {
  el.className = "status" + (kind === "error" ? " error" : "");
  el.innerHTML = kind === "busy" ? `<span class="spin"></span>${esc(msg)}` : esc(msg || "");
}
const gname = (id) => (G.guidelines.find((g) => g.id === id) || { name: id }).name;
const currentVideo = () => S.video_versions.find((v) => v.id === S.video_id) || null;
function setVideo(container, url, opts = "controls") {
  const v = container.querySelector("video");
  if (v && v.dataset.src === url) return v;
  container.innerHTML = url ? `<video ${opts} playsinline preload="metadata" data-src="${esc(url)}" src="${esc(url)}"></video>` : "";
  return container.querySelector("video");
}

// ----------------------------------------------------------------- tabs
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    renderAll();
  })
);
$("#reset").addEventListener("click", async () => {
  if (!confirm("Start a new project? The current scripts, videos and charts will be cleared.")) return;
  S = await api("/api/reset", {});
  selectedScene = null; focus = null; reviewId = null; region = null; draftVersion = -1;
  $("#topic").value = ""; renderFacts([""]); renderAll();
});

// ----------------------------------------------------------------- P1 inputs
function renderFacts(facts) {
  const ul = $("#facts");
  ul.innerHTML = "";
  (facts.length ? facts : [""]).forEach((f) => addFactRow(f));
}
function addFactRow(value = "") {
  const li = document.createElement("li");
  li.innerHTML = `<input placeholder="e.g. Office occupancy is still 50% of 2019 levels" value="${esc(value)}" /><button title="Remove">×</button>`;
  li.querySelector("button").onclick = () => { li.remove(); if (!$("#facts li")) addFactRow(); };
  $("#facts").appendChild(li);
}
$("#add-fact").onclick = () => addFactRow();
const readFacts = () => [...document.querySelectorAll("#facts input")].map((i) => i.value.trim()).filter(Boolean);

$("#generate").onclick = async () => {
  const topic = $("#topic").value.trim();
  if (!topic) return toast("Enter a story topic first.", true);
  busy.generate = true; renderButtons();
  status($("#gen-status"), "Writing scene scripts with the screenwriting model…", "busy");
  try {
    S = await api("/api/scripts/generate", { topic, data_facts: readFacts() });   // [model_1 generate]~
    selectedScene = null; focus = null;
    renderAll();
    status($("#gen-status"), "Scripts ready. Rendering the video demo…", "busy");
    await renderDemo(null);                                                       // tool_1 → tool_2 → tool_7
    status($("#gen-status"), "Done — scripts and video demo generated.");
  } catch (e) {
    status($("#gen-status"), e.message, "error");
  } finally {
    busy.generate = false; renderButtons();
  }
};

async function renderDemo(scripts) {
  busy.render = true; renderButtons();
  status($("#render-status"), "Rendering the full video demo (voiceover + scenes)…", "busy");
  try {
    S = await api("/api/video/render", scripts ? { scripts } : {});
    status($("#render-status"), `Version ${S.video_versions.length} added to the gallery.`);
    renderAll();
  } catch (e) {
    status($("#render-status"), e.message, "error");
    throw e;
  } finally {
    busy.render = false; renderButtons();
  }
}

// ----------------------------------------------------------------- scenes (P2 select, P3 modify, P4 select)
function isDirty() { return JSON.stringify(draft) !== JSON.stringify(S.scripts); }

function renderScenes() {
  if (draftVersion !== S.scripts_version) {
    draft = JSON.parse(JSON.stringify(S.scripts));
    draftVersion = S.scripts_version;
  }
  $("#scripts-version").textContent = S.scripts.length ? `scripts v${S.scripts_version}` : "";
  const box = $("#scenes");
  if (!draft.length) { box.innerHTML = `<p class="empty">Enter a topic and data facts, then generate.</p>`; return; }
  const opts = (sel) => G.guidelines.map((g) => `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  box.innerHTML = draft.map((sc, i) => {
    const clip = S.clips[String(i)];
    const clipBusy = busy.clips.has(i);
    return `<article class="scene ${selectedScene === i ? "selected" : ""}" data-i="${i}">
      <div class="scene-head"><span class="scene-num">Scene ${i + 1}</span>
        <input data-f="title" value="${esc(sc.title)}" />
        <span class="chip" title="Guideline this scene follows">${esc(gname(sc.guideline_id))}</span></div>
      <div class="scene-grid">
        <label>Voiceover<textarea data-f="voiceover" rows="3">${esc(sc.voiceover)}</textarea></label>
        <label>Visuals<textarea data-f="visuals" rows="3">${esc(sc.visuals)}</textarea></label>
      </div>
      <div class="scene-meta">
        <label style="flex:1">Guideline<select data-f="guideline_id">${opts(sc.guideline_id)}</select></label>
        <label class="dur">Seconds<input data-f="duration_s" type="number" min="3" max="10" step="0.5" value="${sc.duration_s}" /></label>
        <button class="small clip-btn" data-i="${i}" ${clipBusy ? "disabled" : ""}>${clipBusy ? '<span class="spin"></span>Generating…' : clip ? "Regenerate 5-s clip" : "5-s clip"}</button>
      </div>
      ${sc.rationale ? `<div class="rationale"><b>Why this guideline:</b> ${esc(sc.rationale)}</div>` : ""}
      ${clip ? `<div class="clip"><video src="${esc(clip.url)}" controls muted loop playsinline></video>
        <div class="hint">Five-second clip from the video model.<br/>Prompt: ${esc(clip.request.prompt).slice(0, 180)}…
        ${clip.scene.visuals !== sc.visuals ? "<br/><b>Made from an earlier version of this scene.</b>" : ""}</div></div>` : ""}
    </article>`;
  }).join("");

  box.querySelectorAll(".scene").forEach((card) => {
    const i = +card.dataset.i;
    card.addEventListener("click", (e) => { if (!e.target.closest(".clip-btn")) selectScene(i); });
    card.querySelectorAll("[data-f]").forEach((inp) =>
      inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
        const f = inp.dataset.f;
        draft[i][f] = f === "duration_s" ? Number(inp.value) : inp.value;
        if (f === "guideline_id") { card.querySelector(".chip").textContent = gname(inp.value); selectScene(i, true); }
        renderDirty();
      })
    );
  });
  box.querySelectorAll(".clip-btn").forEach((b) => b.addEventListener("click", () => makeClip(+b.dataset.i)));
  renderDirty();
}

function renderDirty() {
  const dirty = S.scripts.length && isDirty();
  $("#dirty").classList.toggle("hidden", !dirty);
}

async function selectScene(i, force = false) {   // P2 [human select] → [tool_3 select]
  if (selectedScene === i && !force) return;
  selectedScene = i;
  document.querySelectorAll(".scene").forEach((c) => c.classList.toggle("selected", +c.dataset.i === i));
  try {
    focus = await api(`/api/scenes/${i}/focus?guideline_id=${encodeURIComponent(draft[i].guideline_id)}`);
  } catch (e) { focus = null; toast(e.message, true); }
  renderGuidelines();
}

async function makeClip(i) {   // P4 [human select] → tool_1 → [model_2 generate]~
  if (isDirty()) toast("The clip uses the last rendered script of this scene; render the demo to include your edits.");
  busy.clips.add(i); renderScenes();
  try { S = await api("/api/clip", { scene_index: i }); }
  catch (e) { toast("Clip generation failed: " + e.message, true); }
  finally { busy.clips.delete(i); renderScenes(); }
}

// ----------------------------------------------------------------- guidelines panel (P2)
function renderGuidelines() {
  const used = new Set(draft.map((s) => s.guideline_id));
  const fid = focus?.guideline_focus?.id;
  $("#guidelines").innerHTML = G.guidelines.map((g) =>
    `<li class="${g.id === fid ? "focus" : ""}"><b>${esc(g.name)}</b>${used.has(g.id) ? '<span class="used">● used</span>' : ""}
      <div>${esc(g.principle)}</div><span class="how">How: ${esc(g.how)}</span></li>`).join("");
  $("#focus-hint").textContent = fid
    ? `Scene ${selectedScene + 1} follows “${focus.guideline_focus.name}”. Reference examples:`
    : "Select a scene to see the guideline it follows and reference examples.";
  $("#references").innerHTML = (focus?.reference_focus || []).map((r) =>
    `<figure><video src="${esc(r.url)}" muted loop playsinline autoplay></video><figcaption>${esc(r.caption)}</figcaption></figure>`).join("");
}

// ----------------------------------------------------------------- video panel (P1 output, P3 evaluate + regenerate)
function renderVideoPanel() {
  const v = currentVideo();
  $("#video-version").textContent = v ? `version ${v.number} of ${S.video_versions.length}` : "";
  if (v) setVideo($("#video-wrap"), v.url);
  else $("#video-wrap").innerHTML = `<p class="empty">No video yet.</p>`;
  $("#assessments").innerHTML = (v?.assessments || []).map((a) =>
    `<li>${esc(a.text)}<small>${a.kind === "review" ? "gallery review" : "design assessment"} · ${esc(a.at)}</small></li>`).join("");
}

$("#save-assessment").onclick = () => saveAssessment();
async function saveAssessment() {   // P3 [human evaluate] → assessment
  const v = currentVideo(); const text = $("#assessment").value.trim();
  if (!v || !text) return false;
  S = await api("/api/assessment", { version_id: v.id, text, kind: "design" });
  $("#assessment").value = "";
  renderVideoPanel();
  return true;
}
$("#regenerate").onclick = async () => {   // P3 [human modify] → tool_1 → tool_2 → tool_7, loops back
  try {
    await saveAssessment();
    await renderDemo(draft);
  } catch (e) { /* status shown */ }
};

function renderButtons() {
  $("#generate").disabled = busy.generate || busy.render;
  $("#regenerate").disabled = busy.generate || busy.render || !S?.scripts.length;
  $("#regenerate").textContent = S?.video_versions.length ? "Regenerate full demo" : "Render video demo";
  $("#make-chart").disabled = busy.chart;
}

// ----------------------------------------------------------------- P5 chart
document.querySelectorAll("#chart-type button").forEach((b) => b.addEventListener("click", () => {
  chartType = b.dataset.type;
  document.querySelectorAll("#chart-type button").forEach((x) => x.classList.toggle("active", x === b));
}));
$("#make-chart").onclick = async () => {   // [human specify] → [tool_4 translate]
  busy.chart = true; renderButtons();
  status($("#chart-status"), "Animating chart…", "busy");
  try {
    S = await api("/api/chart", { text: $("#chart-text").value, chart_type: chartType, title: $("#chart-title").value });
    region = null;
    status($("#chart-status"), "Animated chart ready.");
    renderAll();
  } catch (e) { status($("#chart-status"), e.message, "error"); }
  finally { busy.chart = false; renderButtons(); }
};
function renderChart() {
  const c = S.chart;
  if (!c) { $("#chart-preview").innerHTML = ""; $("#chart-table").innerHTML = ""; return; }
  setVideo($("#chart-preview"), c.url, "controls autoplay muted loop");
  const d = c.chart_data;
  $("#chart-table").innerHTML = `<table><tr>${d.columns.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${d.rows.slice(0, 12)
    .map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</table>
    ${d.rows.length > 12 ? `<p class="hint">…${d.rows.length - 12} more rows</p>` : ""}`;
}

// ----------------------------------------------------------------- P6 / P7 replacement
document.querySelectorAll("#replace-mode button").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode; region = null;
  document.querySelectorAll("#replace-mode button").forEach((x) => x.classList.toggle("active", x === b));
  renderReplace();
}));

function renderReplace() {
  const v = currentVideo();
  const r = S.replace[mode];
  const ready = v && S.chart;
  $("#mode-hint").textContent = !v ? "Generate a video demo first (tab 1)." : !S.chart ? "Create an animated chart first (left)."
    : mode === "full" ? "The complete chart, with axes and labels, replaces the object you click — accurate data in the scene."
    : "Only the chart region you select is merged where the object was — a stylised alternative.";
  $("#step-keyframe").classList.toggle("disabled", !ready || busy.replace);
  if (v) setVideo($("#replace-video"), v.url); else $("#replace-video").innerHTML = "";
  const stale = r && v && r.video_id !== v.id;

  $("#step-point").classList.toggle("disabled", !r?.keyframe || busy.replace);
  const kv = $("#keyframe-view");
  if (r?.keyframe) {
    const img = r.mask ? r.mask.url : r.keyframe.url;
    kv.innerHTML = `<img src="${esc(img)}" draggable="false" />` +
      (r.point ? `<div class="dot" style="left:${(r.point.x / 640) * 100}%;top:${(r.point.y / 360) * 100}%"></div>` : "");
    kv.querySelector("img").onclick = onKeyframeClick;
  } else kv.innerHTML = `<p class="empty">Pause the video and press “Use this frame”.</p>`;
  const mi = $("#mask-info");
  if (r?.mask && !busy.replace) {
    status(mi, `${r.mask.source === "model_3" ? "Segmented" : "Fallback colour segmentation"}: “${r.mask.label}”` +
      (r.mask.error ? ` (model: ${r.mask.error})` : "") + ` · frame at ${r.keyframe.time.toFixed(2)} s; replaced until ${r.keyframe.scene_end.toFixed(1)} s. Click again to re-select.` +
      (stale ? " (from an older video version)" : ""));
  } else if (!busy.replace) status(mi, r?.keyframe ? `Frame at ${r.keyframe.time.toFixed(2)} s — click the object.` : "");

  $("#step-clean").classList.toggle("disabled", !r?.cleaned);
  if (r?.cleaned) setVideo($("#cleaned-view"), r.cleaned.url); else $("#cleaned-view").innerHTML = `<p class="empty">—</p>`;

  $("#step-region").classList.toggle("hidden", mode !== "shape");
  $("#step-region").classList.toggle("disabled", !r?.cleaned || busy.replace);
  $("#result-num").textContent = mode === "shape" ? "5" : "4";
  if (mode === "shape" && S.chart) renderRegion(r);

  $("#step-result").classList.toggle("disabled", !r?.result);
  if (r?.result) setVideo($("#result-view"), r.result.url); else $("#result-view").innerHTML = `<p class="empty">—</p>`;
}

$("#use-frame").onclick = async () => {   // [human select] keyframe
  const vid = $("#replace-video video");
  if (!vid) return;
  vid.pause();
  await runReplace("Capturing frame…", () => api("/api/replace/keyframe", { mode, time: vid.currentTime }));
};

async function onKeyframeClick(e) {   // [human select] object_point → [model_3 extract] → [tool_5 modify] (→ [tool_6 compose])
  const rect = e.target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 640, y = ((e.clientY - rect.top) / rect.height) * 360;
  const ok = await runReplace("Segmenting the object (segmentation model)…", () => api("/api/replace/segment", { mode, x, y }));
  if (!ok) return;
  if (!(await runReplace("Removing the object and inpainting the scene…", () => api("/api/replace/inpaint", { mode })))) return;
  if (mode === "full") await runReplace("Overlaying the complete chart…", () => api("/api/replace/compose", { mode }));
  else status($("#replace-status"), "Now select the part of the chart to use as a shape (step 4).");
}

async function runReplace(msg, fn) {
  busy.replace = true; renderReplace();
  status($("#replace-status"), msg, "busy");
  try { S = await fn(); status($("#replace-status"), ""); return true; }
  catch (e) { status($("#replace-status"), e.message, "error"); return false; }
  finally { busy.replace = false; renderReplace(); }
}

function renderRegion(r) {
  const box = $("#region-view");
  if (box.dataset.src !== S.chart.shape_url) {
    box.dataset.src = S.chart.shape_url;
    box.innerHTML = `<img src="${esc(S.chart.shape_url)}" draggable="false" /><div class="box hidden"></div>`;
    let start = null;
    const pos = (e) => { const b = box.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
    box.onmousedown = (e) => { start = pos(e); region = null; };
    window.addEventListener("mousemove", (e) => {
      if (!start) return;
      const [x, y] = pos(e);
      region = { x0: Math.min(start[0], x), y0: Math.min(start[1], y), x1: Math.max(start[0], x), y1: Math.max(start[1], y) };
      drawRegion();
    });
    window.addEventListener("mouseup", () => { start = null; });
  }
  if (!region && r?.region) region = r.region;
  drawRegion();
  $("#merge-shape").disabled = !region;
}
function drawRegion() {
  const b = $("#region-view .box");
  if (!b) return;
  b.classList.toggle("hidden", !region);
  if (region) Object.assign(b.style, { left: region.x0 * 100 + "%", top: region.y0 * 100 + "%", width: (region.x1 - region.x0) * 100 + "%", height: (region.y1 - region.y0) * 100 + "%" });
  $("#merge-shape").disabled = !region;
}
$("#merge-shape").onclick = () =>   // [human select] chart_region → [tool_6 compose]
  runReplace("Merging the chart shape into the scene…", () => api("/api/replace/compose", { mode: "shape", region }));

// ----------------------------------------------------------------- P8 gallery
function renderGallery() {
  $("#gallery-count").textContent = S.video_versions.length || "";
  const g = $("#gallery");
  if (!S.video_versions.length) { g.innerHTML = `<p class="empty">Videos appear here after generation.</p>`; $("#review").innerHTML = `<p class="empty">Choose a previous video to compare it with the current one.</p>`; return; }
  g.innerHTML = [...S.video_versions].reverse().map((v) =>
    `<div class="gcard ${v.id === S.video_id ? "current" : ""} ${v.id === reviewId ? "selected" : ""}" data-id="${v.id}">
      <video src="${esc(v.url)}#t=1.5" muted preload="metadata"></video>
      <div class="meta"><b>Version ${v.number}${v.id === S.video_id ? " · current" : ""}</b><span>${v.duration.toFixed(0)} s · ${v.scripts.length} scenes</span></div>
      <div class="meta"><span>${esc(v.created)}</span><span>${v.assessments.length ? v.assessments.length + " note(s)" : ""}</span></div></div>`).join("");
  g.querySelectorAll(".gcard").forEach((c) => c.addEventListener("click", () => { reviewId = c.dataset.id; renderGallery(); }));
  renderReview();
}
function snapshot(v) {
  return `<ol class="snap">${v.scripts.map((s) => `<li><b>${esc(s.title)}</b> <span class="chip">${esc(gname(s.guideline_id))}</span><br/>${esc(s.voiceover)}</li>`).join("")}</ol>`;
}
function renderReview() {
  const r = S.video_versions.find((v) => v.id === reviewId);
  const cur = currentVideo();
  const el = $("#review");
  if (!r) { el.innerHTML = `<p class="empty">Choose a previous video to compare it with the current one.</p>`; return; }
  if (el.dataset.rid === r.id && el.dataset.n === String(r.assessments.length)) return;
  el.dataset.rid = r.id; el.dataset.n = String(r.assessments.length);
  el.innerHTML = `<div><h3>Version ${r.number} (reviewed)</h3><video src="${esc(r.url)}" controls></video>${snapshot(r)}
      <label>Your judgement of this video <small>(video_assessment)</small><textarea id="review-text" rows="3" placeholder="How does this alternative compare?"></textarea></label>
      <button id="save-review" class="primary small">Save judgement</button>
      <ul class="assessments">${r.assessments.map((a) => `<li>${esc(a.text)}<small>${a.kind === "review" ? "gallery review" : "design assessment"} · ${esc(a.at)}</small></li>`).join("")}</ul></div>
    <div><h3>Current — version ${cur?.number ?? "–"}</h3>${cur ? `<video src="${esc(cur.url)}" controls></video>${snapshot(cur)}` : ""}</div>`;
  $("#save-review").onclick = async () => {   // P8 [human evaluate]
    const text = $("#review-text").value.trim();
    if (!text) return toast("Write a judgement first.", true);
    S = await api("/api/assessment", { version_id: r.id, text, kind: "review" });
    renderGallery(); renderVideoPanel();
  };
}

// ----------------------------------------------------------------- boot
function renderAll() {
  renderScenes(); renderGuidelines(); renderVideoPanel(); renderButtons();
  renderChart(); renderReplace(); renderGallery();
}
(async function boot() {
  [S, G] = await Promise.all([api("/api/state"), api("/api/guidelines")]);
  $("#topic").value = S.topic;
  renderFacts(S.data_facts);
  if (S.chart) { $("#chart-text").value = S.chart.text; chartType = S.chart.chart_type;
    document.querySelectorAll("#chart-type button").forEach((x) => x.classList.toggle("active", x.dataset.type === chartType)); }
  renderAll();
})();
