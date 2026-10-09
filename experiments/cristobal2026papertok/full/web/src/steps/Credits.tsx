import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { StepProps } from '../App.tsx';

/** Process 7: editable credit scene, approve clips, merge into the final MP4. */
export function Credits({ project: p, act }: StepProps) {
  const [text, setText] = useState(p.credits?.creditText ?? '');
  const [approved, setApproved] = useState<number[]>(p.approvedClips ?? p.scenes?.map((s) => s.index) ?? []);
  useEffect(() => setText(p.credits?.creditText ?? ''), [p.credits?.creditText]);
  useEffect(() => { if (p.approvedClips) setApproved(p.approvedClips); }, [p.approvedClips?.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const scenes = p.scenes ?? [];
  const incomplete = scenes.filter((s) => s.activeClip === null).length;
  const merging = p.busy?.task === 'Merging the final video';

  if (!p.credits) {
    return (
      <section>
        <h2>Credits &amp; export</h2>
        <p className="muted">The credit screen is prepared automatically once every scene has a clip{incomplete ? ` (${incomplete} still missing)` : ''}.</p>
        <button onClick={() => act(() => api.prepareCredits(p.id))}>Prepare credits now</button>
      </section>
    );
  }
  return (
    <section>
      <h2>Credits &amp; export</h2>
      <div className="credits">
        <div>
          <h4>Credit screen</h4>
          <img className="credit-preview" src={`${p.credits.creditSceneFile}?v=${p.credits.creditTextVersion}`} alt="Credit scene" />
        </div>
        <div className="grow">
          <label className="field">
            <span>Attribution text</span>
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="muted small">Authors found in the PDF: {p.credits.authors.join(', ') || 'none — please add them above'}</p>
          <button className="primary" disabled={text === p.credits.creditText} onClick={() => act(() => api.saveCredits(p.id, text))}>Update credit screen</button>

          <h4>Approve scenes for the final video</h4>
          <div className="approve">
            {scenes.map((s) => {
              const clip = s.clips.find((c) => c.version === s.activeClip);
              return (
                <label key={s.index} className={!clip ? 'muted' : ''}>
                  <input type="checkbox" disabled={!clip} checked={!!clip && approved.includes(s.index)}
                    onChange={(e) => setApproved(e.target.checked ? [...approved, s.index].sort((a, b) => a - b) : approved.filter((x) => x !== s.index))} />
                  Scene {s.index + 1}: <span className="small">{s.script.slice(0, 70)}{s.script.length > 70 ? '…' : ''}</span>
                </label>
              );
            })}
          </div>
          <button className="primary big" disabled={!!p.busy || approved.length === 0 || scenes.some((s) => s.status === 'working')}
            onClick={() => act(() => api.merge(p.id, approved.filter((i) => scenes[i]?.activeClip !== null)))}>
            {merging ? 'Merging…' : 'Merge final video'}
          </button>
        </div>
      </div>
      {p.finalVideoFile && (
        <div className="final">
          <h4>Final video</h4>
          <video src={p.finalVideoFile} controls playsInline />
          <a className="button primary" href={p.finalVideoFile} download={`${p.script?.title ?? 'video'}.mp4`}>Download MP4</a>
        </div>
      )}
    </section>
  );
}
