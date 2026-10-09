import { useMemo, useState } from 'react';
import type { Guideline, ReferenceVideo, Scene } from '../../shared/types';
import { api } from '../api';
import { ListEditor } from '../components/ListEditor';
import { LiveCanvas } from '../components/LiveCanvas';
import { SceneEditor } from '../components/SceneEditor';
import { Status } from '../components/Status';
import { renderAndVersion } from '../pipeline';
import { useTask, uid, type ProjectStore } from '../state';
import { composeClipRequest } from '../tools/clipRequest';
import { retrieveFocus, type Focus } from '../tools/retrieve';
import { composeVideoRequest } from '../video/compose';
import { drawScene, drawTimeline } from '../video/scene';

export function StoryView({ store }: { store: ProjectStore }) {
  const { project: p, update, replace, flush } = store;
  const task = useTask();
  const clipTask = useTask();
  const [editing, setEditing] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null); // scene_focus_1 -> guideline_focus_1 + reference_focus_1*
  const [clip, setClip] = useState<{ sceneId: string; svg: string; caption: string } | null>(null); // clip_1
  const [clipScene, setClipScene] = useState<string | null>(null); // clip_scene_1
  const [assessDraft, setAssessDraft] = useState<Record<string, string>>({});
  if (!p) return null;

  const current = p.versions.find((v) => v.id === p.currentVersionId) ?? p.versions.at(-1);
  const dirty = !current || JSON.stringify(current.scripts) !== JSON.stringify(p.scripts);
  const setScripts = (scripts: Scene[]) => update({ scripts });

  /* Process 1: [model_1 generate]~ then tool_1 / tool_2 / tool_7 */
  const generate = () =>
    task.run('Writing scene scripts (model_1)…', async (prog) => {
      await flush();
      const facts = p.dataFacts.map((f) => f.trim()).filter(Boolean);
      const { scripts } = await api.generateScripts({ topic: p.topic, dataFacts: facts, guidelines: p.guidelines });
      update({ scripts, dataFacts: facts });
      setFocus(null);
      setClip(null);
      await flush();
      replace(await renderAndVersion(scripts, prog));
    });

  /* Process 3 loop: scripts_2 -> tool_1 -> tool_2 -> tool_7 -> back to video_1 */
  const rerender = () =>
    task.run('Rendering video…', async (prog) => {
      await flush();
      replace(await renderAndVersion(p.scripts, prog));
    });

  /* Process 2: [human select] scene_focus -> [tool_3 select] */
  const focusScene = (s: Scene) => setFocus(retrieveFocus(s, p.guidelines, p.references));

  /* Process 4: [human select] clip_scene -> [tool_1 compose] -> [model_2 generate]~ */
  const makeClip = (s: Scene) => {
    setClipScene(s.id);
    setClip(null);
    clipTask.run(`Generating clip for “${s.title}” (model_2)…`, async () => {
      const req = composeClipRequest(s);
      const out = await api.generateClip(req);
      setClip({ sceneId: s.id, ...out });
    });
  };

  const saveAssessment = async (id: string) => {
    replace(await api.updateVersion(id, { assessment: assessDraft[id] ?? '' }));
  };

  const move = (i: number, d: number) => {
    const s = [...p.scripts];
    const [x] = s.splice(i, 1);
    s.splice(i + d, 0, x);
    setScripts(s);
  };

  return (
    <div className="story">
      {/* ---------- Brief: topic_1 + data_facts_1* + guidelines_1* ---------- */}
      <section className="panel brief">
        <h2>Brief</h2>
        <label className="block">Topic
          <textarea rows={2} value={p.topic} onChange={(e) => update({ topic: e.target.value })} placeholder="What is the video about?" />
        </label>
        <h3>Data facts <span className="muted">({p.dataFacts.length})</span></h3>
        <ListEditor items={p.dataFacts} onChange={(dataFacts) => update({ dataFacts })} placeholder="data fact" />
        <GuidelinesEditor guidelines={p.guidelines} onChange={(guidelines) => update({ guidelines })} />
        <button className="primary wide" disabled={!!task.busy || !p.topic.trim()} onClick={generate}>
          {p.scripts.length ? '↻ Regenerate scripts & render' : '✦ Generate scripts & render'}
        </button>
        <ReferenceLibrary refs={p.references} onChange={(references) => update({ references })} />
      </section>

      {/* ---------- scripts_n* ---------- */}
      <section className="panel scripts">
        <div className="panel-head">
          <h2>Scripts <span className="muted">{p.scripts.length} scenes · {p.scripts.reduce((a, s) => a + s.durationSec, 0)}s</span></h2>
          <button className="ghost small" onClick={() => setScripts([...p.scripts, blankScene(p.scripts.at(-1))])}>+ scene</button>
        </div>
        <Status {...task} onDismiss={task.clearError} />
        {!p.scripts.length && <p className="empty">No scripts yet. Fill in the brief and generate.</p>}
        <div className="scene-list">
          {p.scripts.map((s, i) => (
            <article key={s.id} className={`scene-card ${focus?.sceneId === s.id ? 'focused' : ''}`}>
              <div className="scene-top">
                <LiveCanvas className="thumb" width={320} height={180} duration={s.durationSec} playing={false} draw={(ctx, t, w, h) => drawScene(ctx, s, t, w, h, { subtitles: false })} />
                <div className="scene-meta">
                  <div className="scene-title"><span className="num">{i + 1}</span>{s.title}</div>
                  <div className="muted small">{s.visual.kind.replace('_', ' ')} · {s.durationSec}s{s.factIndexes.length ? ` · facts ${s.factIndexes.join(', ')}` : ''}</div>
                  <p className="narr">{s.narration}</p>
                  <div className="btns">
                    <button className="small" onClick={() => setEditing(editing === s.id ? null : s.id)}>{editing === s.id ? 'Done' : 'Edit'}</button>
                    <button className="small" onClick={() => focusScene(s)}>Guidance</button>
                    <button className="small" disabled={!!clipTask.busy} onClick={() => makeClip(s)}>Generate clip</button>
                    <span className="spacer" />
                    <button className="icon" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button className="icon" disabled={i === p.scripts.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button className="icon" title="Delete scene" onClick={() => setScripts(p.scripts.filter((x) => x.id !== s.id))}>×</button>
                  </div>
                </div>
              </div>
              {editing === s.id && <SceneEditor scene={s} onChange={(ns) => setScripts(p.scripts.map((x) => (x.id === s.id ? ns : x)))} />}
            </article>
          ))}
        </div>
      </section>

      {/* ---------- video_1 + assessment_1, guidance, clip ---------- */}
      <section className="panel videop">
        <h2>Video {current && <span className="muted">version {current.number}</span>}</h2>
        {current ? (
          <video key={current.video.url} className="player" src={current.video.url} controls playsInline />
        ) : (
          <div className="player placeholder">{p.scripts.length ? <LivePreview scripts={p.scripts} /> : 'Video appears here'}</div>
        )}
        {p.scripts.length > 0 && (
          <button className={dirty ? 'primary wide' : 'wide'} disabled={!!task.busy} onClick={rerender}>
            {current ? (dirty ? '▶ Re-render with edited scripts' : 'Re-render') : '▶ Render video'}
          </button>
        )}
        {current && (
          <div className="assessment">
            <h3>Your assessment of version {current.number}</h3>
            <textarea rows={3} placeholder="What works? What should change in the scripts?" value={assessDraft[current.id] ?? current.assessment ?? ''} onChange={(e) => setAssessDraft({ ...assessDraft, [current.id]: e.target.value })} />
            <button className="small" onClick={() => saveAssessment(current.id)}>Save assessment</button>
            {current.assessment && <span className="muted small"> saved</span>}
            <p className="muted small">Then edit the scenes on the left and re-render. Every render is kept under Versions.</p>
          </div>
        )}

        {focus && <GuidancePanel focus={focus} scene={p.scripts.find((s) => s.id === focus.sceneId)} onClose={() => setFocus(null)} />}

        {(clipTask.busy || clipTask.error || clip) && (
          <div className="clip-panel">
            <div className="panel-head">
              <h3>Generated clip {clipScene && <span className="muted">· {p.scripts.find((s) => s.id === clipScene)?.title}</span>}</h3>
              <button className="icon" onClick={() => { setClip(null); clipTask.clearError(); }}>×</button>
            </div>
            <Status {...clipTask} onDismiss={clipTask.clearError} />
            {clip && (
              <>
                <img className="clip" alt={clip.caption} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(clip.svg)}`} />
                <p className="muted small">{clip.caption}</p>
                <div className="btns">
                  <button className="small" onClick={() => { const s = p.scripts.find((x) => x.id === clip.sceneId); if (s) makeClip(s); }}>↻ Regenerate</button>
                  <a className="button small" download={`clip-${clip.sceneId}.svg`} href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(clip.svg)}`}>Download SVG</a>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LivePreview({ scripts }: { scripts: Scene[] }) {
  const req = useMemo(() => composeVideoRequest(scripts), [scripts]);
  return <LiveCanvas className="player" duration={req.totalSec} draw={(ctx, t, w, h) => drawTimeline(ctx, req.scenes, t, w, h)} />;
}

function blankScene(prev?: Scene): Scene {
  return {
    id: uid(),
    title: 'New scene',
    narration: 'Narration for this scene.',
    onScreenText: '',
    visual: { kind: 'headline', label: 'Headline', value: '', items: [] },
    background: prev?.background ?? '#0f172a',
    accent: prev?.accent ?? '#38bdf8',
    durationSec: 5,
    factIndexes: [],
  };
}

function GuidelinesEditor({ guidelines, onChange }: { guidelines: Guideline[]; onChange: (g: Guideline[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible">
      <h3 onClick={() => setOpen(!open)} className="clickable">{open ? '▾' : '▸'} Storytelling guidelines <span className="muted">({guidelines.length})</span></h3>
      {open && (
        <div className="list-editor">
          {guidelines.map((g) => (
            <div key={g.id} className="guideline-row">
              <input value={g.title} onChange={(e) => onChange(guidelines.map((x) => (x.id === g.id ? { ...x, title: e.target.value } : x)))} />
              <textarea rows={2} value={g.text} onChange={(e) => onChange(guidelines.map((x) => (x.id === g.id ? { ...x, text: e.target.value } : x)))} />
              <button className="icon" onClick={() => onChange(guidelines.filter((x) => x.id !== g.id))}>×</button>
            </div>
          ))}
          <button className="ghost small" onClick={() => onChange([...guidelines, { id: uid(), title: 'New guideline', text: '' }])}>+ guideline</button>
        </div>
      )}
    </div>
  );
}

export function ReferencePreview({ r, small }: { r: ReferenceVideo; small?: boolean }) {
  const req = useMemo(() => (r.scenes?.length ? composeVideoRequest(r.scenes) : null), [r.scenes]);
  if (r.url) return <video className={small ? 'ref-thumb' : 'player'} src={r.url} muted loop autoPlay playsInline />;
  if (!req) return null;
  return <LiveCanvas className={small ? 'ref-thumb' : 'player'} width={small ? 320 : 960} height={small ? 180 : 540} duration={req.totalSec} draw={(ctx, t, w, h) => drawTimeline(ctx, req.scenes, t, w, h)} />;
}

function ReferenceLibrary({ refs, onChange }: { refs: ReferenceVideo[]; onChange: (r: ReferenceVideo[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', tags: '' });
  const [file, setFile] = useState<File | null>(null);
  const task = useTask();
  const add = () =>
    task.run('Uploading reference…', async () => {
      if (!file) throw new Error('Choose a video file');
      const up = await api.upload(file);
      onChange([...refs, { id: uid(), title: draft.title || file.name, description: draft.description, tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean), url: up.url }]);
      setDraft({ title: '', description: '', tags: '' });
      setFile(null);
    });
  return (
    <div className="collapsible">
      <h3 onClick={() => setOpen(!open)} className="clickable">{open ? '▾' : '▸'} Reference videos <span className="muted">({refs.length})</span></h3>
      {open && (
        <>
          <div className="ref-grid">
            {refs.map((r) => (
              <div key={r.id} className="ref-card">
                <ReferencePreview r={r} small />
                <strong>{r.title}</strong>
                <span className="muted small">{r.tags.join(' · ')}</span>
                <button className="icon corner" onClick={() => onChange(refs.filter((x) => x.id !== r.id))}>×</button>
              </div>
            ))}
          </div>
          <div className="upload">
            <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea rows={2} placeholder="What technique does it show?" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <input placeholder="tags, comma separated" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            <button className="small" disabled={!file || !!task.busy} onClick={add}>Add reference</button>
            <Status {...task} />
          </div>
        </>
      )}
    </div>
  );
}

function GuidancePanel({ focus, scene, onClose }: { focus: Focus; scene?: Scene; onClose: () => void }) {
  return (
    <div className="guidance">
      <div className="panel-head">
        <h3>Guidance for “{scene?.title}”</h3>
        <button className="icon" onClick={onClose}>×</button>
      </div>
      {focus.guideline && (
        <div className="guideline-focus">
          <span className="tag">Most relevant guideline · match {(focus.guideline.score * 100).toFixed(0)}%</span>
          <strong>{focus.guideline.item.title}</strong>
          <p>{focus.guideline.item.text}</p>
        </div>
      )}
      <span className="tag">Similar reference videos</span>
      <div className="ref-grid">
        {focus.references.map(({ item, score }) => (
          <div key={item.id} className="ref-card">
            <ReferencePreview r={item} small />
            <strong>{item.title}</strong>
            <span className="muted small">{item.description}</span>
            <span className="muted small">match {(score * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
