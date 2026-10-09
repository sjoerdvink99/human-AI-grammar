import { useEffect, useState } from 'react';
import { api, type ScriptRecord } from '../api.ts';
import type { StepProps } from '../App.tsx';

/** Process 3: human modify script_1 (edit again any time, or keep the original). */
export function ScriptEditor({ project: p, act }: StepProps) {
  const [draft, setDraft] = useState<ScriptRecord>(p.script!);
  useEffect(() => setDraft(p.script!), [p.script]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.script);
  const edited = JSON.stringify(p.script) !== JSON.stringify(p.originalScript);
  const storyboardStale = !!p.scenes && p.storyboardFromScript !== JSON.stringify(p.script);
  const set = (patch: Partial<ScriptRecord>) => setDraft({ ...draft, ...patch });

  return (
    <section>
      <div className="section-head">
        <h2>Script editor</h2>
        <div className="row">
          <button disabled={!edited && !dirty} onClick={() => act(() => api.revertScript(p.id))}>Use original script</button>
          <button className="primary" disabled={!dirty || draft.scenes.some((s) => !s.trim())} onClick={() => act(() => api.saveScript(p.id, draft))}>Save changes</button>
        </div>
      </div>
      {storyboardStale && (
        <div className="notice">
          The storyboard was made from an earlier version of this script.
          <button disabled={!!p.busy || dirty} onClick={() => confirm('Rebuild the storyboard? Existing scene clips will be discarded.') && act(() => api.prepareStoryboard(p.id))}>Rebuild storyboard</button>
        </div>
      )}
      <label className="field"><span>Title</span><input value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="field"><span>Hook</span><textarea rows={2} value={draft.hook} onChange={(e) => set({ hook: e.target.value })} /></label>
      {draft.scenes.map((s, i) => (
        <label key={i} className="field">
          <span>Scene {i + 1} <em className="muted small">{s.trim().split(/\s+/).filter(Boolean).length} words</em></span>
          <textarea rows={2} value={s} onChange={(e) => set({ scenes: draft.scenes.map((x, j) => (j === i ? e.target.value : x)) })} />
        </label>
      ))}
    </section>
  );
}
