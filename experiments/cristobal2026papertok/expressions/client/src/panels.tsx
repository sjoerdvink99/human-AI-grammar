import { useEffect, useState } from "react";
import { api, type ProjectView } from "./api.ts";
import type { Ctx } from "./App.tsx";
import type { ScriptRecord } from "../../server/types.ts";

// ======================= Process 1: paper → script options =======================

/** model_1 steps of process 1, run in order without human steps in between. */
const P1_STEPS = [
  { step: "findings", label: "Extracting findings", has: (p: ProjectView) => !!p.findings },
  { step: "story-ideas", label: "Generating story ideas", has: (p: ProjectView) => !!p.storyIdeas },
  { step: "hooks", label: "Generating hooks", has: (p: ProjectView) => !!p.hooks },
  { step: "hook-ratings", label: "Rating hooks", has: (p: ProjectView) => !!p.hookRatings },
  { step: "shortlist", label: "Shortlisting hooks", has: (p: ProjectView) => !!p.shortlistedHooks },
  { step: "script-options", label: "Writing script options", has: (p: ProjectView) => !!p.scriptOptions },
];

export function PaperPanel({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  /** Run the process-1 chain from `from` onwards; each step replaces what follows it. */
  const analyse = async (from = 0) => {
    for (const s of P1_STEPS.slice(from)) {
      const ok = await run(s.label, () => api.step(p.id, s.step));
      if (!ok) return;
    }
  };

  const submitPaper = async () => {
    const ok = await run("Reading paper", () => {
      if (mode === "pdf") {
        const f = new FormData();
        if (!file) throw new Error("Choose a PDF first");
        f.append("pdf", file);
        if (title) f.append("title", title);
        return api.uploadPaper(p.id, f);
      }
      return api.pastePaper(p.id, title, text);
    });
    if (ok) await analyse(0);
  };

  const shortlisted = new Set(p.shortlistedHooks ?? []);
  const nextMissing = P1_STEPS.findIndex((s) => !s.has(p));

  return (
    <section>
      <h2><span className="num">1</span> Paper &amp; story</h2>
      {!p.paper ? (
        <div className="card">
          <div className="seg">
            <button className={mode === "pdf" ? "on" : ""} onClick={() => setMode("pdf")}>Upload PDF</button>
            <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Paste text</button>
          </div>
          <label>Title (optional — detected automatically)<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          {mode === "pdf" ? (
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          ) : (
            <textarea rows={10} placeholder="Paste the full paper text" value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <button className="primary" disabled={!!busy} onClick={submitPaper}>Analyse paper</button>
        </div>
      ) : (
        <>
          <div className="paper-head">
            <div>
              <div className="eyebrow">Paper</div>
              <strong>{p.paper.title}</strong>
              <span className="muted"> · {Math.round(p.paper.text.length / 1000)}k characters</span>
              {p.paper.pdfFile && <> · <a href={p.paper.pdfFile} target="_blank">PDF</a></>}
            </div>
            {nextMissing >= 0 && !busy && <button className="primary" onClick={() => analyse(nextMissing)}>Continue analysis</button>}
          </div>
          <div className="pipeline">
            {P1_STEPS.map((s) => (
              <span key={s.step} className={`pill ${s.has(p) ? "done" : busy === s.label ? "active" : ""}`}>{s.label.replace(/^\w+ing /, "")}</span>
            ))}
          </div>
          <div className="grid3">
            <ListCard title="Findings" items={p.findings} onRedo={() => analyse(0)} busy={!!busy} />
            <ListCard title="Story ideas" items={p.storyIdeas} onRedo={() => analyse(1)} busy={!!busy} />
            <div className="card">
              <div className="card-head"><h3>Hooks</h3>{p.hooks && <button className="link" disabled={!!busy} onClick={() => analyse(2)}>Regenerate</button>}</div>
              {!p.hooks ? <p className="muted">—</p> : (
                <ol className="hooks">
                  {p.hooks.map((h, i) => (
                    <li key={i} className={shortlisted.has(h) ? "short" : ""}>
                      <span>{h}</span>
                      {p.hookRatings && (
                        <span className="rating" title={`${p.hookRatings[i]}/10`}>
                          <span className="bar" style={{ width: `${p.hookRatings[i] * 10}%` }} />
                          <b>{p.hookRatings[i]}</b>
                        </span>
                      )}
                      {shortlisted.has(h) && <span className="tag">shortlisted</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          {p.scriptOptions && <ScriptOptions ctx={ctx} />}
        </>
      )}
    </section>
  );
}

function ListCard({ title, items, onRedo, busy }: { title: string; items?: string[]; onRedo: () => void; busy: boolean }) {
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3>{items && <button className="link" disabled={busy} onClick={onRedo}>Regenerate</button>}</div>
      {items ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">—</p>}
    </div>
  );
}

// ======================= Process 2: select script, voice style =======================

function ScriptOptions({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const select = async (index: number) => {
    // [human select] → [tool_1 compose] baseline (server) → [model_1 generate] tone suggestion
    const ok = await run("Selecting script", () => api.step(p.id, "script/select", { index }));
    if (ok) await run("Suggesting a tone", () => api.step(p.id, "tone-suggestion"));
  };
  return (
    <>
      <h3 className="sub-h">Script options — pick one</h3>
      <div className="grid3">
        {p.scriptOptions!.map((s, i) => {
          const chosen = p.script && p.script.hook === s.hook && p.script.title === s.title;
          return (
            <div key={i} className={`card option ${chosen ? "chosen" : ""}`}>
              <h4>{s.title}</h4>
              <p className="hook">“{s.hook}”</p>
              <p className="body">{s.body}</p>
              <p className="closing">{s.closing}</p>
              <div className="card-foot">
                <span className="muted">~{s.target_seconds}s</span>
                <button className={chosen ? "" : "primary"} disabled={!!busy} onClick={() => select(i)}>{chosen ? "Selected" : "Use this script"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ======================= Process 3: human modify script =======================

export function ScriptPanel({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const [draft, setDraft] = useState<ScriptRecord>(p.script!);
  useEffect(() => setDraft(p.script!), [p.script]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.script);
  const field = (k: keyof ScriptRecord, rows: number) => (
    <label>
      {k.replace("_", " ")}
      {k === "target_seconds" ? (
        <input type="number" min={20} max={180} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
      ) : rows === 1 ? (
        <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      ) : (
        <textarea rows={rows} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      )}
    </label>
  );
  return (
    <section>
      <h2><span className="num">2</span> Script</h2>
      <div className="card">
        <div className="form2">
          {field("title", 1)}
          {field("target_seconds", 1)}
        </div>
        {field("hook", 2)}
        {field("body", 8)}
        {field("closing", 2)}
        <div className="card-foot">
          {p.scenes && dirty && <span className="muted">After saving, split into scenes again to use the edited script.</span>}
          <button disabled={!dirty} onClick={() => setDraft(p.script!)}>Discard</button>
          <button className="primary" disabled={!dirty || !!busy} onClick={() => run("Saving script", () => api.saveScript(p.id, draft))}>Save script</button>
        </div>
      </div>
    </section>
  );
}

export function VoicePanel({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const [pref, setPref] = useState(p.tonePreference ?? p.toneSuggestion ?? "");
  useEffect(() => setPref(p.tonePreference ?? p.toneSuggestion ?? ""), [p.tonePreference, p.toneSuggestion]);
  return (
    <section>
      <h2><span className="num">3</span> Voice style</h2>
      <div className="grid2">
        <div className="card">
          <h3>Baseline style</h3>
          <p>{p.baselineVoiceStyle}</p>
          <h3>Suggested tone</h3>
          {p.toneSuggestion ? <p className="suggestion">{p.toneSuggestion}</p> : <p className="muted">—</p>}
          <button className="link" disabled={!!busy} onClick={() => run("Suggesting a tone", () => api.step(p.id, "tone-suggestion"))}>
            {p.toneSuggestion ? "Suggest another tone" : "Suggest a tone"}
          </button>
        </div>
        <div className="card">
          <label>
            Your tone preference
            <textarea rows={4} value={pref} placeholder="e.g. warm female voice, energetic but not rushed, playful on the hook" onChange={(e) => setPref(e.target.value)} />
          </label>
          <div className="card-foot">
            <button className="primary" disabled={!pref.trim() || !!busy} onClick={() => run("Composing voice style", () => api.step(p.id, "voice-style", { tonePreference: pref }))}>
              {p.voiceStyle ? "Recompose voice style" : "Compose voice style"}
            </button>
          </div>
          {p.voiceStyle && (
            <>
              <h3>Voice style</h3>
              <p className="voice">{p.voiceStyle}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ======================= Processes 4–6: scenes, clips, regeneration, revision =======================

const REGEN_LABELS: Record<string, string> = { new_take: "New take", more_energetic: "More energetic", calmer: "Calmer" };

export function ScenesPanel({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const [selected, setSelected] = useState<number | null>(null); // scene_selection_1
  const scenes = p.scenes ?? [];
  const status = p.sceneStatus;
  const promptsReady = scenes.length > 0 && scenes.every((s) => s.visualPrompt.text);
  const anyRendering = Object.values(status).includes("rendering");

  const split = async () => {
    // [model_1 decompose] then [model_1 generate] visual prompts
    if (scenes.some((s) => s.clip) && !confirm("Re-splitting discards the current scenes and clips. Continue?")) return;
    const ok = await run("Splitting script into scenes", () => api.step(p.id, "scenes"));
    if (ok) await run("Writing visual prompts", () => api.step(p.id, "visual-prompts"));
  };
  const render = (sceneRequest: "all" | number) => run("Starting render", () => api.step(p.id, "render", { sceneRequest }));

  return (
    <section>
      <h2><span className="num">4</span> Scenes</h2>
      <div className="toolbar">
        <button className={scenes.length ? "" : "primary"} disabled={!!busy || anyRendering} onClick={split}>
          {scenes.length ? "Re-split script" : "Split script into scenes"}
        </button>
        {scenes.length > 0 && !promptsReady && (
          <button className="primary" disabled={!!busy} onClick={() => run("Writing visual prompts", () => api.step(p.id, "visual-prompts"))}>Write visual prompts</button>
        )}
        {promptsReady && (
          <button className="primary" disabled={!!busy || anyRendering} onClick={() => render("all")}>
            {scenes.some((s) => s.clip) ? "Re-render all scenes" : "Render all scenes"}
          </button>
        )}
        {anyRendering && <span className="muted"><span className="spinner" /> rendering narration and visuals… (≈1 min per scene)</span>}
      </div>
      <div className="scenes">
        {scenes.map((s, i) => (
          <SceneCard key={i} ctx={ctx} index={i} selected={selected === i} onSelect={() => setSelected(selected === i ? null : i)} onRender={() => render(i)} />
        ))}
      </div>
    </section>
  );
}

function SceneCard({ ctx, index, selected, onSelect, onRender }: { ctx: Ctx; index: number; selected: boolean; onSelect: () => void; onRender: () => void }) {
  const { project: p, run, busy } = ctx;
  const scene = p.scenes![index];
  const st = p.sceneStatus[index];
  const rendering = st === "rendering";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene.script.text);
  useEffect(() => setDraft(scene.script.text), [scene.script.text]);

  return (
    <div className={`card scene ${selected ? "selected" : ""}`}>
      <div className="clip" onClick={onSelect} title="Select this scene">
        {rendering ? (
          <div className="placeholder"><span className="spinner" /> rendering</div>
        ) : scene.clip ? (
          <video src={scene.clip.clip} controls preload="metadata" poster={scene.clip.still} onClick={(e) => e.stopPropagation()} />
        ) : (
          <div className="placeholder">not rendered</div>
        )}
      </div>
      <div className="scene-meta">
        <div className="card-head">
          <h4 onClick={onSelect} className="clickable">Scene {index + 1}{scene.clip && <span className="muted"> · {scene.clip.duration.toFixed(1)}s</span>}</h4>
          {!scene.clip && !rendering && scene.visualPrompt.text && <button className="link" disabled={!!busy} onClick={onRender}>Render</button>}
        </div>
        {st && !rendering && <p className={st.startsWith("error") ? "err" : "warn"}>{st}</p>}
        {editing ? (
          <>
            <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="card-foot">
              <button onClick={() => { setEditing(false); setDraft(scene.script.text); }}>Cancel</button>
              <button
                className="primary"
                disabled={!draft.trim() || draft === scene.script.text || rendering || !scene.visualPrompt.text}
                onClick={async () => { if (await run("Revising scene", () => api.revise(p.id, index, draft))) setEditing(false); }}
              >
                Save &amp; re-render
              </button>
            </div>
          </>
        ) : (
          <p className="narration">{scene.script.text}</p>
        )}
        <p className="vprompt"><span className="eyebrow">Visual</span> {scene.visualPrompt.text || "—"}</p>

        {selected && (
          <div className="scene-actions">
            {scene.clip && (
              <div>
                <span className="eyebrow">Regenerate</span>
                {Object.entries(REGEN_LABELS).map(([k, label]) => (
                  <button key={k} disabled={rendering || !!busy} onClick={() => run("Starting regeneration", () => api.regenerate(p.id, index, k))}>{label}</button>
                ))}
              </div>
            )}
            {!editing && <button disabled={rendering} onClick={() => setEditing(true)}>Edit narration</button>}
            {(scene.script.history.length > 0 || scene.visualPrompt.history.length > 0) && (
              <details>
                <summary>Earlier versions</summary>
                {scene.script.history.map((t, i) => <p key={`s${i}`} className="muted">Narration v{i + 1}: {t}</p>)}
                {scene.visualPrompt.history.map((t, i) => <p key={`v${i}`} className="muted">Visual v{i + 1}: {t}</p>)}
              </details>
            )}
            {scene.clipHistory.length > 0 && (
              <details>
                <summary>Earlier clips ({scene.clipHistory.length})</summary>
                <div className="history">
                  {scene.clipHistory.map((c, hi) => (
                    <div key={c.clip}>
                      <video src={c.clip} controls preload="none" poster={c.still} />
                      <button className="link" disabled={rendering || !!busy} onClick={() => run("Restoring clip", () => api.revert(p.id, index, hi))}>Restore</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ======================= Process 7: credits and final video =======================

export function CreditsPanel({ ctx }: { ctx: Ctx }) {
  const { project: p, run, busy } = ctx;
  const scenes = p.scenes ?? [];
  const [credit, setCredit] = useState(p.creditText ?? "");
  useEffect(() => setCredit(p.creditText ?? ""), [p.creditText]);
  const withClips = scenes.map((s, i) => (s.clip ? i : -1)).filter((i) => i >= 0);
  // approved_clips_1 = rendered clips minus the ones the user unticked (new clips start approved)
  const [excluded, setExcluded] = useState<Set<number>>(
    new Set(p.approvedClips ? withClips.filter((i) => !p.approvedClips!.includes(i)) : []),
  );
  const approved = new Set(withClips.filter((i) => !excluded.has(i)));
  const toggle = (i: number) => setExcluded((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const rendering = Object.values(p.sceneStatus).includes("rendering");

  const merge = (mergeRequest: "credit_end" | "credit_start") =>
    run("Merging final video", () => api.step(p.id, "final", { approvedClips: [...approved], mergeRequest }));

  return (
    <section>
      <h2><span className="num">5</span> Credits &amp; final video</h2>
      <div className="grid2">
        <div className="card">
          <div className="card-head">
            <h3>Credit scene</h3>
            <button className={p.paperScreenshot ? "link" : "primary"} disabled={!!busy} onClick={() => run("Extracting authors and screenshot", () => api.step(p.id, "credits/extract"))}>
              {p.paperScreenshot ? "Re-extract" : "Extract authors & screenshot"}
            </button>
          </div>
          {p.paperScreenshot && (
            <>
              <p className="muted">Authors found: {p.paperAuthors?.length ? p.paperAuthors.join(", ") : "none — edit the credit text"}</p>
              <label>Credit text<textarea rows={3} value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
              <div className="card-foot">
                <button className="primary" disabled={!credit.trim() || !!busy} onClick={() => run("Composing credit scene", () => api.step(p.id, "credits/scene", { creditText: credit }))}>
                  {p.creditScene ? "Update credit scene" : "Compose credit scene"}
                </button>
              </div>
              <div className="thumbs">
                <figure><img src={p.paperScreenshot} /><figcaption>Paper</figcaption></figure>
                {p.creditScene && <figure><img src={p.creditScene} /><figcaption>Credit scene</figcaption></figure>}
              </div>
            </>
          )}
        </div>
        <div className="card">
          <h3>Approve clips</h3>
          <div className="approve">
            {scenes.map((s, i) => (
              <label key={i} className={s.clip ? "" : "disabled"}>
                <input type="checkbox" disabled={!s.clip} checked={approved.has(i) && !!s.clip} onChange={() => toggle(i)} />
                {s.clip ? <img src={s.clip.still} /> : <span className="noimg" />}
                <span>Scene {i + 1}</span>
              </label>
            ))}
          </div>
          <div className="card-foot">
            <span className="muted">{!p.creditScene ? "Compose the credit scene first." : rendering ? "Wait for rendering to finish." : ""}</span>
            <button disabled={!p.creditScene || rendering || approved.size === 0 || !!busy} onClick={() => merge("credit_start")}>Merge · credits first</button>
            <button className="primary" disabled={!p.creditScene || rendering || approved.size === 0 || !!busy} onClick={() => merge("credit_end")}>Merge · credits last</button>
          </div>
          {p.finalVideo && (
            <div className="final">
              <video src={p.finalVideo} controls />
              <a href={p.finalVideo} download="explainer.mp4">Download MP4</a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
