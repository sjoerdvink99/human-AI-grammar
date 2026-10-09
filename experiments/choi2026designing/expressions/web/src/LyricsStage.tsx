import { useEffect, useState } from 'react';
import type { View } from './api.ts';
import type { Act } from './App.tsx';

/** Process 2: lyric questions → song concept + lyric elements → lyrics ↔ feedback loop. */
export function LyricsStage({ view, act, pending }: { view: View; act: Act; pending: boolean }) {
  const { session } = view;
  const qs = session.lyric_questions ?? [];
  const [answers, setAnswers] = useState<string[]>(() => qs.map(() => ''));
  const [feedback, setFeedback] = useState('');
  const [shownVersion, setShownVersion] = useState<number | null>(null);

  useEffect(() => setAnswers((a) => qs.map((_, i) => a[i] ?? '')), [qs.length]);

  if (!session.lyric_questions)
    return <div className="stage-panel"><button className="primary" disabled={pending} onClick={() => act('p2/questions')}>Get songwriting questions</button></div>;

  const latest = session.lyrics.length - 1;
  const idx = shownVersion ?? latest;
  const version = session.lyrics[idx];

  return (
    <div className="stage-panel lyrics">
      <h2>Writing the words</h2>
      {session.lyrics.length === 0 && (
        <>
          <p className="hint">A few questions to find the images and phrases for your song. Skip any you like.</p>
          {qs.map((q, i) => (
            <label key={i} className="qa">
              <span>{q}</span>
              <textarea value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} disabled={pending} />
            </label>
          ))}
          <button className="primary" disabled={pending || !answers.some((a) => a.trim())} onClick={() => act('p2/answers', { answers }, 'Writing lyrics…')}>
            Write my lyrics
          </button>
        </>
      )}

      {session.song_concept && session.lyric_elements && (
        <div className="cards">
          <div className="card">
            <h3>Song concept</h3>
            <dl>
              {Object.entries(session.song_concept).map(([k, v]) => (<div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></div>))}
            </dl>
          </div>
          <div className="card">
            <h3>Lyric elements</h3>
            <dl>
              {Object.entries(session.lyric_elements).map(([k, v]) => (
                <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v.length ? v.map((x) => <span key={x} className="chip">{x}</span>) : '—'}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {version && (
        <div className="lyrics-area">
          <div className="versions">
            {session.lyrics.map((_, i) => (
              <button key={i} className={i === idx ? 'active' : ''} onClick={() => setShownVersion(i === latest ? null : i)}>
                Draft {i + 1}
              </button>
            ))}
          </div>
          <pre className="lyrics-text">{version.text}</pre>
          {version.feedback && <div className="fb-note">Your feedback on this draft: “{version.feedback}”</div>}
          {idx === latest && !session.lyrics_approved && (
            <div className="review">
              <textarea
                placeholder="What would you change? e.g. “make the chorus more hopeful”, “use my words ‘still here’ in the chorus”"
                value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={pending}
              />
              <div className="row">
                <button disabled={pending || !feedback.trim()} onClick={async () => { if (await act('p2/feedback', { feedback }, 'Revising lyrics…')) setFeedback(''); }}>
                  Revise lyrics
                </button>
                <button className="primary" disabled={pending} onClick={() => act('p2/approve', {}, 'Saving…')}>
                  These feel right → choose the music
                </button>
              </div>
            </div>
          )}
          {session.lyrics_approved && <div className="ok">Lyrics approved (draft {latest + 1}).</div>}
        </div>
      )}
    </div>
  );
}
