import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProjectStore } from '../state';

/** Process 8: video_versions_1* -> [human select] reviewed_video_1 -> [human evaluate] video_assessment_1 */
export function VersionsView({ store }: { store: ProjectStore }) {
  const { project: p, replace } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const reviewed = p?.versions.find((v) => v.id === selected);
  useEffect(() => { setDraft(reviewed?.review ?? ''); setSaved(false); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  if (!p.versions.length) return <div className="panel empty">No versions yet. Each render on the Story tab adds one.</div>;

  const save = async () => {
    replace(await api.updateVersion(reviewed!.id, { review: draft }));
    setSaved(true);
  };

  return (
    <div className="versions">
      <section className="panel">
        <h2>Versions <span className="muted">({p.versions.length})</span></h2>
        <div className="version-grid">
          {[...p.versions].reverse().map((v) => (
            <button key={v.id} className={`version-card ${selected === v.id ? 'selected' : ''}`} onClick={() => setSelected(v.id)}>
              <video src={`${v.video.url}#t=1`} preload="metadata" muted />
              <span><strong>v{v.number}</strong> · {v.scripts.length} scenes · {Math.round(v.video.request.totalSec)}s</span>
              <span className="muted small">{new Date(v.createdAt).toLocaleString()}</span>
              {v.review && <span className="tag">reviewed</span>}
            </button>
          ))}
        </div>
      </section>
      <section className="panel review">
        {reviewed ? (
          <>
            <h2>Reviewing version {reviewed.number}</h2>
            <video key={reviewed.id} className="player" src={reviewed.video.url} controls playsInline />
            <ol className="scene-summary">
              {reviewed.scripts.map((s) => <li key={s.id}><strong>{s.title}</strong> — {s.onScreenText || s.visual.label} <span className="muted">({s.durationSec}s)</span></li>)}
            </ol>
            {reviewed.assessment && <p className="muted small">Assessment written while editing: “{reviewed.assessment}”</p>}
            <h3>Your review</h3>
            <textarea rows={4} value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} placeholder="How well does this version tell the story? What would you keep or change?" />
            <button className="primary" onClick={save}>Save review</button> {saved && <span className="muted small">saved</span>}
          </>
        ) : <p className="empty">Select a version to review it.</p>}
      </section>
    </div>
  );
}
