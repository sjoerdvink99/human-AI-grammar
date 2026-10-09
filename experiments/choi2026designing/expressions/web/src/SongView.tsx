import { useEffect, useRef, useState } from 'react';
import type { SongVersion } from '../../server/types.ts';

/** song (audio) + music_visualization (visual) with a playhead and the current timed lyric. */
export function SongView({ song, compact = false }: { song: SongVersion; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  const dur = song.audio_features.duration;

  useEffect(() => {
    let raf = 0;
    const tick = () => { if (audio.current) setT(audio.current.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = song.timed_lyrics.lines.find((l) => l.start !== null && l.end !== null && t >= l.start - 0.2 && t <= l.end + 0.4);
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (audio.current) audio.current.currentTime = Math.max(0, Math.min(dur, (((e.clientX - r.left) / r.width - 0.01) / 0.98) * dur));
  };
  const f = song.audio_features;

  return (
    <div className="song-view">
      <audio ref={audio} controls src={song.audio_url} preload="auto" />
      <div className="viz" onClick={seek} title="Click to jump">
        <div dangerouslySetInnerHTML={{ __html: song.music_visualization }} />
        <div className="playhead" style={{ left: `${(1 + (t / dur) * 98)}%` }} />
      </div>
      <div className="now-singing">{current ? <><small>{current.section}</small> {current.line}</> : <small>♪</small>}</div>
      {!compact && (
        <details>
          <summary>Style prompt, audio features, beats and transcript</summary>
          <p><b>Style prompt:</b> {song.style_prompt}</p>
          <p className="features">
            <span>Duration {Math.round(f.duration)} s</span><span>Tempo ≈ {f.tempo_bpm} bpm</span><span>Key ≈ {f.key}</span>
            <span>Loudness {f.loudness_db} dB</span><span>Brightness {f.spectral_centroid_hz} Hz</span>
          </p>
          <div className="tables">
            <table>
              <thead><tr><th>line</th><th>section</th><th>start</th><th>end</th><th>match</th></tr></thead>
              <tbody>{song.timed_lyrics.lines.map((l, i) => (
                <tr key={i}><td>{l.line}</td><td>{l.section}</td><td>{l.start?.toFixed(2) ?? '—'}</td><td>{l.end?.toFixed(2) ?? '—'}</td><td>{Math.round(l.match_score * 100)}%</td></tr>
              ))}</tbody>
            </table>
            <table className="beats">
              <thead><tr><th>beat</th><th>time</th><th>strength</th><th>energy</th><th>downbeat</th></tr></thead>
              <tbody>{song.beat_features.map((b) => (
                <tr key={b.beat}><td>{b.beat}</td><td>{b.time.toFixed(2)}</td><td>{b.strength.toFixed(2)}</td><td>{b.energy.toFixed(2)}</td><td>{b.downbeat ? '●' : ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="hint">Transcript engine: {song.predicted_transcript.engine}</p>
        </details>
      )}
    </div>
  );
}
