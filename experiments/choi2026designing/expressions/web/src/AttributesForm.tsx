import { useState } from 'react';
import { GENRES, INSTRUMENTS, VOICES } from '../../server/types.ts';
import type { MusicAttributes } from './api.ts';

export const DEFAULT_ATTRIBUTES: MusicAttributes = {
  genre: 'acoustic folk', mood: 'hopeful', tempo_bpm: 84, mode: 'major',
  instruments: ['guitar', 'piano', 'bass'], voice: 'warm female', energy: 'calm',
};

/** music_attributes: instruction record — specified (P3) or modified (P5) by the client. */
export function AttributesForm({ initial, onSubmit, disabled, submitLabel }: {
  initial: MusicAttributes; onSubmit: (a: MusicAttributes) => void; disabled: boolean; submitLabel: string;
}) {
  const [a, setA] = useState<MusicAttributes>(initial);
  const set = <K extends keyof MusicAttributes>(k: K, v: MusicAttributes[K]) => setA({ ...a, [k]: v });
  const toggle = (i: (typeof INSTRUMENTS)[number]) =>
    set('instruments', a.instruments.includes(i) ? a.instruments.filter((x) => x !== i) : [...a.instruments, i]);

  return (
    <form className="attrs" onSubmit={(e) => { e.preventDefault(); onSubmit(a); }}>
      <label>Genre
        <select value={a.genre} onChange={(e) => set('genre', e.target.value as MusicAttributes['genre'])} disabled={disabled}>
          {GENRES.map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>
      <label>Mood
        <input value={a.mood} onChange={(e) => set('mood', e.target.value)} disabled={disabled} placeholder="e.g. tender, defiant, peaceful" />
      </label>
      <label>Tempo: {a.tempo_bpm} bpm
        <input type="range" min={50} max={160} value={a.tempo_bpm} onChange={(e) => set('tempo_bpm', +e.target.value)} disabled={disabled} />
      </label>
      <fieldset>
        <legend>Feel</legend>
        {(['major', 'minor'] as const).map((m) => (
          <button type="button" key={m} className={a.mode === m ? 'toggle on' : 'toggle'} onClick={() => set('mode', m)} disabled={disabled}>
            {m === 'major' ? 'major (brighter)' : 'minor (darker)'}
          </button>
        ))}
      </fieldset>
      <fieldset>
        <legend>Energy</legend>
        {(['calm', 'moderate', 'driving'] as const).map((m) => (
          <button type="button" key={m} className={a.energy === m ? 'toggle on' : 'toggle'} onClick={() => set('energy', m)} disabled={disabled}>{m}</button>
        ))}
      </fieldset>
      <fieldset>
        <legend>Instruments</legend>
        {INSTRUMENTS.map((i) => (
          <button type="button" key={i} className={a.instruments.includes(i) ? 'toggle on' : 'toggle'} onClick={() => toggle(i)} disabled={disabled}>{i}</button>
        ))}
      </fieldset>
      <label>Voice
        <select value={a.voice} onChange={(e) => set('voice', e.target.value as MusicAttributes['voice'])} disabled={disabled}>
          {VOICES.map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      <button className="primary" type="submit" disabled={disabled || a.instruments.length === 0 || !a.mood.trim()}>{submitLabel}</button>
    </form>
  );
}
