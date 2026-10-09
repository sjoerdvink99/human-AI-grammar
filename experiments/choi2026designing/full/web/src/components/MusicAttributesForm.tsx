import { useState } from "react";
import { api, type MusicAttributes, type Session } from "../api.ts";
import { GENRES, INSTRUMENTS, MOODS, VOCALS } from "../../../server/types.ts";

type Act = (fn: () => Promise<Session>) => Promise<void>;

const DEFAULTS: MusicAttributes = { genre: "pop", mood: "hopeful", tempo_bpm: 90, instruments: ["piano", "bass", "drums"], vocal: "soft high voice", notes: "" };

/** renders **bold** spans from the model's guidance text */
function withBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

function tempoWord(bpm: number) {
  if (bpm < 75) return "slow, like a resting heartbeat";
  if (bpm < 100) return "relaxed, like walking";
  if (bpm < 125) return "lively, like a brisk walk";
  return "fast, like jogging";
}

/**
 * Process 3 — human specify (music_attributes), with music_guidance alongside.
 * Process 5 — human modify: prefilled with the previous attributes, song_feedback shown.
 */
export function MusicAttributesForm({ session, act }: { session: Session; act: Act }) {
  const revision = session.phase === "revision";
  const previous = session.musicAttributes[session.musicAttributes.length - 1];
  const [a, setA] = useState<MusicAttributes>(previous ?? DEFAULTS);
  const busy = !!session.busy;
  const lastFeedback = session.songs[session.songs.length - 1]?.songFeedback;
  const set = <K extends keyof MusicAttributes>(k: K, v: MusicAttributes[K]) => setA({ ...a, [k]: v });
  const toggle = (i: MusicAttributes["instruments"][number]) =>
    set("instruments", a.instruments.includes(i) ? a.instruments.filter((x) => x !== i) : [...a.instruments, i]);

  // beat preview: a pulsing dot at the chosen tempo, so tempo can be seen, not only heard
  const pulse = { animationDuration: `${60 / a.tempo_bpm}s` };

  return (
    <div className="card music-form">
      <h2>{revision ? "Change the music" : "Choose the music"}</h2>
      {revision && lastFeedback && <p className="feedback-note">What you said about the last version: “{lastFeedback.text || "I'd like changes."}”</p>}
      {!revision && session.musicGuidance && (
        <div className="guidance">{session.musicGuidance.split("\n").filter(Boolean).map((p, i) => <p key={i}>{withBold(p)}</p>)}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(() => api.musicAttributes(session.id, a));
        }}
      >
        <fieldset>
          <legend>Genre</legend>
          <div className="chips selectable">
            {GENRES.map((g) => (
              <button type="button" key={g} aria-pressed={a.genre === g} className={a.genre === g ? "chip on" : "chip"} onClick={() => set("genre", g)}>{g}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Mood</legend>
          <div className="chips selectable">
            {MOODS.map((m) => (
              <button type="button" key={m} aria-pressed={a.mood === m} className={a.mood === m ? "chip on" : "chip"} onClick={() => set("mood", m)}>{m}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Tempo</legend>
          <div className="tempo">
            <input type="range" min={60} max={160} value={a.tempo_bpm} onChange={(e) => set("tempo_bpm", Number(e.target.value))} aria-label="Tempo in beats per minute" />
            <span className="tempo-dot" style={pulse} aria-hidden />
            <span><strong>{a.tempo_bpm} BPM</strong> — {tempoWord(a.tempo_bpm)}</span>
          </div>
        </fieldset>
        <fieldset>
          <legend>Instruments</legend>
          <div className="chips selectable">
            {INSTRUMENTS.map((i) => (
              <button type="button" key={i} aria-pressed={a.instruments.includes(i)} className={a.instruments.includes(i) ? "chip on" : "chip"} onClick={() => toggle(i)}>{i}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Voice</legend>
          <div className="chips selectable">
            {VOCALS.map((v) => (
              <button type="button" key={v} aria-pressed={a.vocal === v} className={a.vocal === v ? "chip on" : "chip"} onClick={() => set("vocal", v)}>{v}</button>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Anything else? (optional)</span>
          <input value={a.notes} maxLength={400} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. strong bass I can feel, builds up at the end" />
        </label>
        <button className="primary big" disabled={busy || a.instruments.length === 0}>
          {revision ? "Make a new version" : "Create my song"}
        </button>
      </form>
    </div>
  );
}
