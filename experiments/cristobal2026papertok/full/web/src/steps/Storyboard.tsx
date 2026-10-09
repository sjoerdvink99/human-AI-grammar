import { useEffect, useState } from 'react';
import { api, type Scene } from '../api.ts';
import type { StepProps } from '../App.tsx';

/** Processes 4 (generate all / one), 5 (regenerate selected scene) and 6 (revise a scene script). */
export function Storyboard({ project: p, act }: StepProps) {
  const [selected, setSelected] = useState<number | null>(null); // scene_selection
  if (!p.scenes) {
    return (
      <section>
        <h2>Storyboard</h2>
        {p.busy ? <p className="muted">Preparing scenes…</p> : (
          <button className="primary" disabled={!p.voiceStyle} onClick={() => act(() => api.prepareStoryboard(p.id))}>Prepare storyboard</button>
        )}
      </section>
    );
  }
  const done = p.scenes.filter((s) => s.activeClip !== null).length;
  const working = p.scenes.filter((s) => s.status === 'working').length;
  return (
    <section>
      <div className="section-head">
        <h2>Storyboard <span className="muted small">{done}/{p.scenes.length} clips ready{working ? ` · ${working} generating` : ''}</span></h2>
        <button className="primary" disabled={working === p.scenes.length} onClick={() => act(() => api.generateScenes(p.id, 'all'))}>
          {done ? 'Generate all again' : 'Generate all scenes'}
        </button>
      </div>
      <p className="muted small">Voice: {p.voiceStyle}</p>
      <div className="scenes">
        {p.scenes.map((s) => (
          <SceneCard key={s.index} scene={s} selected={selected === s.index} onSelect={() => setSelected(s.index)} {...{ project: p, act }} />
        ))}
      </div>
    </section>
  );
}

function SceneCard({ project: p, act, scene: s, selected, onSelect }: StepProps & { scene: Scene; selected: boolean; onSelect: () => void }) {
  const [text, setText] = useState(s.script);
  useEffect(() => setText(s.script), [s.script]);
  const clip = s.clips.find((c) => c.version === s.activeClip);
  const busy = s.status === 'working';
  const edited = text.trim() !== s.script.trim();

  return (
    <article className={`scene ${selected ? 'selected' : ''} ${busy ? 'is-busy' : ''}`} onClick={onSelect}>
      <div className="scene-head">
        <span className="tag">Scene {s.index + 1}</span>
        {clip && <span className="muted small">{clip.duration.toFixed(1)} s</span>}
      </div>
      <div className="player">
        {clip ? <video key={clip.clipFile} src={clip.clipFile} controls playsInline preload="metadata" /> : <div className="placeholder">{busy ? '' : 'Not generated yet'}</div>}
        {busy && <div className="overlay"><span className="spinner" />{s.stage}…</div>}
      </div>
      {s.status === 'error' && <div className="error small">{s.error}</div>}

      <label className="field compact">
        <span>Narration{clip ? ' — edit and regenerate' : ''}</span>
        <textarea rows={3} value={text} disabled={!clip || busy} onChange={(e) => setText(e.target.value)} />
      </label>
      <details className="small"><summary>Visual prompt</summary><p>{s.visualPrompt}</p></details>

      <div className="row">
        {!clip && <button className="primary" disabled={busy} onClick={() => act(() => api.generateScenes(p.id, s.index))}>Generate scene</button>}
        {clip && !edited && <button disabled={busy} onClick={() => act(() => api.regenerateScene(p.id, s.index))}>↻ Regenerate</button>}
        {clip && edited && (
          <>
            <button className="primary" disabled={busy || !text.trim()} onClick={() => act(() => api.reviseScene(p.id, s.index, text))}>Save &amp; regenerate</button>
            <button className="ghost" onClick={() => setText(s.script)}>Cancel</button>
          </>
        )}
      </div>
      {s.clips.length > 1 && (
        <label className="field compact">
          <span>Versions</span>
          <select value={s.activeClip ?? ''} disabled={busy} onChange={(e) => act(() => api.restoreClip(p.id, s.index, Number(e.target.value)))}>
            {s.clips.map((c) => (
              <option key={c.version} value={c.version}>v{c.version} · {c.origin} · {new Date(c.createdAt).toLocaleTimeString()}</option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}
