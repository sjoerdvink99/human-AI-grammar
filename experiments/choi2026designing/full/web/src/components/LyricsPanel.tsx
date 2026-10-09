import { useEffect, useState } from "react";
import { api, type Session } from "../api.ts";

type Act = (fn: () => Promise<Session>) => Promise<void>;

export function LyricsBlock({ text }: { text: string }) {
  const sections: { label: string; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) sections.push({ label: header[1], lines: [] });
    else if (line) {
      if (!sections.length) sections.push({ label: "", lines: [] });
      sections[sections.length - 1].lines.push(line);
    }
  }
  return (
    <div className="lyrics">
      {sections.map((sec, i) => (
        <div key={i} className="lyric-section">
          {sec.label && <h4 className="section-label">{sec.label}</h4>}
          {sec.lines.map((l, k) => <p key={k}>{l}</p>)}
        </div>
      ))}
    </div>
  );
}

/** song_concept + lyric_elements + lyrics (versions) + human evaluate controls (process 2). */
export function LyricsPanel({ session, act }: { session: Session; act: Act }) {
  const latest = session.lyrics.length;
  const [shown, setShown] = useState(latest);
  const [feedback, setFeedback] = useState("");
  useEffect(() => { setShown(latest); }, [latest]);

  const reviewing = session.phase === "lyrics_review" && !session.lyricsAccepted;
  const busy = !!session.busy;
  const version = session.lyrics[shown - 1];

  return (
    <div className="card">
      <div className="card-head">
        <h2>{session.songConcept ? `“${session.songConcept.title}”` : "Your song"}</h2>
        {session.lyricsAccepted && <span className="badge ok">Lyrics accepted</span>}
      </div>

      {session.songConcept && (
        <details className="concept">
          <summary>Song concept and ingredients</summary>
          <dl className="kv">
            <dt>Theme</dt><dd>{session.songConcept.theme}</dd>
            <dt>Message</dt><dd>{session.songConcept.message}</dd>
            <dt>Perspective</dt><dd>{session.songConcept.perspective}</dd>
            <dt>Story</dt><dd>{session.songConcept.narrative}</dd>
          </dl>
          {session.lyricElements && (
            <div className="chips-groups">
              {(["emotions", "scenes", "keywords", "lyric_ideas"] as const).map((k) => (
                <div key={k}>
                  <h5>{k.replace("_", " ")}</h5>
                  <div className="chips">{session.lyricElements![k].map((c, i) => <span key={i} className="chip">{c}</span>)}</div>
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      {session.lyrics.length > 1 && (
        <div className="versions" role="tablist" aria-label="Lyrics versions">
          {session.lyrics.map((l) => (
            <button key={l.version} role="tab" aria-selected={l.version === shown} className={l.version === shown ? "active" : ""} onClick={() => setShown(l.version)}>
              v{l.version}
            </button>
          ))}
        </div>
      )}

      {version && <LyricsBlock text={version.text} />}
      {version?.feedback && shown < latest && <p className="muted feedback-note">Your comments on this version: “{version.feedback}”</p>}

      {reviewing && shown === latest && (
        <div className="review">
          <label>
            <span>What would you like to change? (optional)</span>
            <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. make the chorus more hopeful, mention my grandmother's hands…" disabled={busy} />
          </label>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => act(() => api.lyricsAccept(session.id))}>I'm happy with these lyrics</button>
            <button disabled={busy || !feedback.trim()} onClick={() => act(() => api.lyricsFeedback(session.id, feedback)).then(() => setFeedback(""))}>Request changes</button>
            <button className="ghost" disabled={busy} onClick={() => act(() => api.lyricsRegenerate(session.id))}>Write a fresh version</button>
          </div>
        </div>
      )}
    </div>
  );
}
