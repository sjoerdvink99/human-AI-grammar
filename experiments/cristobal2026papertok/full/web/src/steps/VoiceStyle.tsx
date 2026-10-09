import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { StepProps } from '../App.tsx';

/** Process 2: tone suggestion -> human specify tone preference -> composed voice style. */
export function VoiceStyle({ project: p, act, onEdit }: StepProps & { onEdit: () => void }) {
  const [custom, setCustom] = useState(p.tonePreference ?? '');
  useEffect(() => { if (!custom && p.toneSuggestion) setCustom(p.toneSuggestion); }, [p.toneSuggestion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <h2>Voiceover style</h2>
      <p className="muted">Script: <b>{p.script?.title}</b> — <a href="#" onClick={(e) => { e.preventDefault(); onEdit(); }}>edit wording</a> (optional)</p>

      <div className="card">
        <h4>Default style</h4>
        <p>{p.baselineVoiceStyle}</p>
      </div>

      <div className="card">
        <div className="section-head">
          <h4>Suggested tone</h4>
          <button className="ghost" disabled={!!p.busy} onClick={() => act(() => api.suggestTone(p.id))}>↻ Suggest another</button>
        </div>
        {p.toneSuggestion ? <p className="suggestion">{p.toneSuggestion}</p> : <p className="muted"><span className="spinner" /> Thinking about the tone…</p>}
        <label className="field">
          <span>Tone for the narration — accept the suggestion or write your own</span>
          <textarea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Warm and curious, like explaining to a friend" />
        </label>
        <div className="row">
          <button disabled={!p.toneSuggestion || !!p.busy} onClick={() => { setCustom(p.toneSuggestion!); act(() => api.setVoiceStyle(p.id, p.toneSuggestion!)); }}>Accept suggestion</button>
          <button className="primary" disabled={!custom.trim() || !!p.busy} onClick={() => act(() => api.setVoiceStyle(p.id, custom))}>Use this tone</button>
        </div>
      </div>

      {p.voiceStyle && (
        <div className="card ok">
          <h4>Final voice style</h4>
          <p>{p.voiceStyle}</p>
          {p.tonePreference && <p className="muted small">From your tone: “{p.tonePreference}”</p>}
        </div>
      )}
    </section>
  );
}
