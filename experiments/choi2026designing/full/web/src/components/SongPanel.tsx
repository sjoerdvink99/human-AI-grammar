import { useEffect, useRef, useState } from "react";
import { api, type Session } from "../api.ts";
import { MusicVisualization } from "./MusicVisualization.tsx";

type Act = (fn: () => Promise<Session>) => Promise<void>;

/** song_n + music_visualization_n, version history, and the process-4 review controls. */
export function SongPanel({ session, act }: { session: Session; act: Act }) {
  const latest = session.songs.length;
  const [shown, setShown] = useState(latest);
  const [feedback, setFeedback] = useState("");
  const [vibrate, setVibrate] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => { setShown(latest); }, [latest]);
  const song = session.songs[shown - 1];
  const busy = !!session.busy;
  const reviewing = session.phase === "song_review" && shown === latest;
  if (!song?.musicVisualization) return null;

  return (
    <div className="card song">
      <div className="card-head">
        <h2>Your song{latest > 1 ? ` — version ${song.version}` : ""}</h2>
        {latest > 1 && (
          <div className="versions" role="tablist" aria-label="Song versions">
            {session.songs.map((s) => (
              <button key={s.version} role="tab" aria-selected={s.version === shown} className={s.version === shown ? "active" : ""} onClick={() => setShown(s.version)}>
                v{s.version}
              </button>
            ))}
          </div>
        )}
      </div>

      <MusicVisualization key={song.audioUrl} viz={song.musicVisualization} audioRef={audioRef} vibrate={vibrate} />
      <audio ref={audioRef} src={song.audioUrl} controls preload="auto" className="player" />
      <label className="inline">
        <input type="checkbox" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} /> Vibrate on beats (phones that support it)
      </label>

      <ul className="summary">{song.musicVisualization.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <details>
        <summary>How this version was made</summary>
        <p><strong>Your choices:</strong> {song.attributes.genre}, {song.attributes.mood}, {song.attributes.tempo_bpm} BPM, {song.attributes.instruments.join(", ")}, {song.attributes.vocal}{song.attributes.notes ? ` — ${song.attributes.notes}` : ""}</p>
        <p><strong>Style prompt sent to the music model:</strong> {song.stylePrompt}</p>
        <p className="muted">Lyrics matched to the singing: {Math.round((song.timedLyrics?.matchRate ?? 0) * 100)}% of sung words.</p>
        {song.beatFeatures && <BeatTable rows={song.beatFeatures.rows} tempo={song.beatFeatures.tempo} />}
      </details>
      {song.songFeedback && <p className="feedback-note">Your reaction: {song.songFeedback.satisfied ? "happy with it" : "wanted changes"}{song.songFeedback.text ? ` — “${song.songFeedback.text}”` : ""}</p>}

      {reviewing && (
        <div className="review">
          <label>
            <span>How does it feel? (optional)</span>
            <textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={busy} placeholder="What did you notice or feel?" />
          </label>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => act(() => api.songFeedback(session.id, true, feedback))}>I'm happy with my song</button>
            <button disabled={busy} onClick={() => act(() => api.songFeedback(session.id, false, feedback))}>I'd like to change the music</button>
            <button className="ghost" disabled={busy} onClick={() => act(() => api.songRegenerate(session.id))}>Try another take</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** beat_features (tabular) */
function BeatTable({ rows, tempo }: { rows: { index: number; time: number; strength: number; downbeat: boolean }[]; tempo: number }) {
  return (
    <div className="beat-table">
      <p className="muted">Beat data ({rows.length} beats, about {Math.round(tempo)} BPM)</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>#</th><th>time (s)</th><th>strength</th><th>bar start</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index}>
                <td>{r.index + 1}</td>
                <td>{r.time.toFixed(2)}</td>
                <td><span className="bar" style={{ width: `${Math.round(r.strength * 60)}px` }} /></td>
                <td>{r.downbeat ? "●" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
