import { useState } from 'react';
import type { View } from './api.ts';
import type { Act } from './App.tsx';
import { SongView } from './SongView.tsx';
import { AttributesForm } from './AttributesForm.tsx';

/** Process 4 (review & reflection) and process 5 (change the music, regenerate). */
export function ReflectStage({ view, act, pending }: { view: View; act: Act; pending: boolean }) {
  const { session } = view;
  const song = session.songs.at(-1);
  const [feedback, setFeedback] = useState('');
  const [reflection, setReflection] = useState('');
  const [compareIdx, setCompareIdx] = useState<number | null>(null);
  if (!song) return <div className="stage-panel">No song yet.</div>;
  const earlier = session.songs.slice(0, -1);
  const compare = compareIdx !== null ? session.songs[compareIdx] : null;

  return (
    <div className="stage-panel reflect">
      <h2>Listen &amp; reflect <small>— Song {song.version}</small></h2>
      <SongView key={song.version} song={song} compact />
      {earlier.length > 0 && (
        <div className="compare">
          Compare with:{' '}
          {earlier.map((s, i) => (
            <button key={s.version} className={compareIdx === i ? 'active' : ''} onClick={() => setCompareIdx(compareIdx === i ? null : i)}>Song {s.version}</button>
          ))}
          {compare && (
            <div className="compare-box">
              <SongView key={`c${compare.version}`} song={compare} compact />
              {compare.song_feedback && <div className="fb-note">Your feedback then: “{compare.song_feedback}”</div>}
            </div>
          )}
        </div>
      )}

      <details className="lyrics-peek"><summary>Lyrics</summary><pre className="lyrics-text">{session.lyrics.at(-1)?.text}</pre></details>

      {!session.review_question && (
        <button className="primary" disabled={pending} onClick={() => act('p4/review-question', {}, 'Preparing…')}>Talk about this song</button>
      )}
      {session.review_question && (
        <div className="dialog">
          <div className="msg companion">{session.review_question}</div>
          {session.song_feedback ? (
            <div className="msg client">{session.song_feedback}</div>
          ) : (
            <div className="composer">
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="How does it sound and feel to you?" disabled={pending} />
              <button disabled={pending || !feedback.trim()} onClick={async () => { if (await act('p4/feedback', { text: feedback }, 'Listening…')) setFeedback(''); }}>Send</button>
            </div>
          )}
          {session.reflection_question && <div className="msg companion">{session.reflection_question}</div>}
          {session.reflection_question && session.song_feedback && !session.supportive_response && (
            session.reflection && pending ? <div className="msg client">{session.reflection}</div> : (
              <div className="composer">
                <textarea value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="Take your time…" disabled={pending} />
                <button disabled={pending || !reflection.trim()} onClick={() => act('p4/reflection', { text: reflection }, 'Reading your reflection…')}>Send</button>
              </div>
            )
          )}
          {session.supportive_response && (
            <>
              <div className="msg client">{session.reflection}</div>
              <div className="msg companion closing">{session.supportive_response}</div>
            </>
          )}
        </div>
      )}

      {session.song_feedback && (
        <details className="change-music" open={!session.reflection_question}>
          <summary>Change the music and make a new version</summary>
          <p className="hint">Your feedback: “{session.song_feedback}”. Adjust the settings below; the lyrics stay the same.</p>
          <AttributesForm key={song.version} initial={song.music_attributes} disabled={pending} submitLabel={`Make song ${session.songs.length + 1}`}
            onSubmit={(attributes) => act('p3/song', { attributes }, 'Re-creating your song…')} />
        </details>
      )}
    </div>
  );
}
