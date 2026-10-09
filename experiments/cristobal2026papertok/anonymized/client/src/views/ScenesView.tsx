import { useEffect, useState } from "react";
import { api, type Project, type Scene } from "../api.ts";
import type { Act } from "../App.tsx";

/** Process 4 (r13…r19), process 5 (select + re-voice one clip), process 6 (edit one clip's narration). */
export default function ScenesView({ project, act, voices, next }: { project: Project; act: Act; voices: string[]; next: () => void }) {
  const p = project;
  const [voiceChoice, setVoice] = useState(p.voice); // r15
  const voice = voices.includes(voiceChoice) ? voiceChoice : voices[0] ?? "";
  const [selected, setSelected] = useState<string | null>(null); // r20
  const produced = p.scenes.some((s) => s.audio && s.image);
  const planned = p.scenes.length > 0 && p.scenes.every((s) => s.visualPrompt);
  const total = p.scenes.reduce((t, s) => t + (s.duration ?? 0), 0);

  return (
    <section>
      <header>
        <h2>Scenes</h2>
        <p className="muted">
          The script is split into scenes, each with a visual description. Choose a narrator voice to produce a narrated, illustrated clip per scene.
          Afterwards, click a clip to re-voice it, or edit its narration to regenerate it.
        </p>
      </header>

      {!p.scenes.length && p.busy?.step !== "Plan scenes" && (
        <button disabled={!!p.busy} onClick={() => act(api.planScenes)}>
          Plan scenes
        </button>
      )}

      {planned && (
        <div className="row panel inline">
          <label>
            Narrator voice{" "}
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <button disabled={!!p.busy} onClick={() => (!produced || confirm("Re-produce all clips? Current clips move to each scene's history.")) && act(() => api.produce(voice))}>
            {produced ? "Re-produce all clips" : "Produce clips"}
          </button>
          {produced && (
            <>
              <span className="muted">
                {p.scenes.length} clips · {total.toFixed(1)}s
              </span>
              <button className="secondary" onClick={next}>
                Continue to export →
              </button>
            </>
          )}
        </div>
      )}

      <div className="scenes">
        {p.scenes.map((s, i) => (
          <SceneCard
            key={s.id}
            scene={s}
            index={i}
            selected={selected === s.id}
            onSelect={() => setSelected(selected === s.id ? null : s.id)}
            project={p}
            act={act}
            voices={voices}
          />
        ))}
      </div>
    </section>
  );
}

function SceneCard(props: {
  scene: Scene;
  index: number;
  selected: boolean;
  onSelect: () => void;
  project: Project;
  act: Act;
  voices: string[];
}) {
  const { scene: s, index, selected, onSelect, project, act, voices } = props;
  const [text, setText] = useState(s.text); // r13 item being modified (process 6)
  const [voice, setVoice] = useState(s.voice); // r21
  useEffect(() => setText(s.text), [s.text]);
  useEffect(() => setVoice(s.voice), [s.voice]);
  const hasClip = !!(s.audio && s.image);
  const dirty = text.trim() !== s.text;
  const busy = !!project.busy;

  return (
    <article className={`card scene ${selected ? "selected" : ""}`} onClick={(e) => hasClip && !(e.target as HTMLElement).closest("textarea,button,select,audio,details") && onSelect()}>
      <div className="scene-head">
        <strong>Scene {index + 1}</strong>
        {s.duration != null && <span className="muted">{s.duration.toFixed(1)}s · {s.voice}</span>}
      </div>
      <div className="frame">
        {s.image ? <img src={s.image} alt={s.visualPrompt} /> : <div className="placeholder">{project.busy?.step === "Produce clips" ? "Drawing…" : "No image yet"}</div>}
      </div>
      {s.audio && <audio controls src={s.audio} preload="none" />}
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} disabled={!hasClip || busy} title={hasClip ? "Edit to regenerate this clip" : ""} />
      {dirty && (
        <div className="row">
          <button disabled={busy} onClick={() => act(() => api.editScene(s.id, text))}>
            Apply edit &amp; regenerate
          </button>
          <button className="secondary" onClick={() => setText(s.text)}>
            Undo
          </button>
        </div>
      )}
      <p className="muted small visual">🎨 {s.visualPrompt || "…"}</p>

      {selected && (
        <div className="row selected-actions">
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            {voices.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <button disabled={busy} onClick={() => act(() => api.revoice(s.id, voice))}>
            Regenerate with this voice
          </button>
        </div>
      )}

      {s.history.length > 0 && (
        <details className="history">
          <summary>Earlier versions ({s.history.length})</summary>
          {[...s.history].reverse().map((h, j) => (
            <div key={j} className="version">
              {h.image && <img src={h.image} alt="" />}
              <div>
                <div className="small muted">
                  {new Date(h.at).toLocaleTimeString()} · {h.voice} · {h.duration?.toFixed(1)}s
                </div>
                <div className="small">{h.text}</div>
                {h.audio && <audio controls src={h.audio} preload="none" />}
              </div>
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
