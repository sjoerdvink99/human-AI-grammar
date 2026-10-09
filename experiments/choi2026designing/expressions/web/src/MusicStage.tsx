import { useEffect, useState } from 'react';
import type { View } from './api.ts';
import type { Act } from './App.tsx';
import { AttributesForm, DEFAULT_ATTRIBUTES } from './AttributesForm.tsx';
import { SongView } from './SongView.tsx';

/** Process 3: music guidance → music attributes → style prompt → song → analysis → visualization. */
export function MusicStage({ view, act, pending }: { view: View; act: Act; pending: boolean }) {
  const { session } = view;
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    if (!session.music_guidance && session.song_concept && !pending) act('p3/guidance', {}, 'Thinking about the music…');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const songs = session.songs;
  const song = songs[sel ?? songs.length - 1];

  return (
    <div className="stage-panel music">
      <h2>Finding the sound</h2>
      {session.music_guidance && <div className="guidance">{session.music_guidance}</div>}
      {songs.length === 0 && (
        <AttributesForm initial={DEFAULT_ATTRIBUTES} disabled={pending || !session.music_guidance} submitLabel="Create my song"
          onSubmit={(attributes) => act('p3/song', { attributes }, 'Creating your song (this can take a minute or two)…')} />
      )}
      {song && (
        <>
          {songs.length > 1 && (
            <div className="versions">
              {songs.map((s, i) => (
                <button key={s.version} className={s === song ? 'active' : ''} onClick={() => setSel(i)}>Song {s.version}</button>
              ))}
            </div>
          )}
          <SongView key={song.version} song={song} />
          <div className="next">
            <span>Take a moment to listen.</span>
            <button className="primary" disabled={pending} onClick={() => act('p4/review-question', {}, 'Preparing…')}>Talk about the song →</button>
          </div>
        </>
      )}
    </div>
  );
}
