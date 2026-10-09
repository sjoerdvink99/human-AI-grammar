import { useCallback, useEffect, useState } from "react";
import { api, type Session, type TherapyFramework } from "./api.ts";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { FrameworkProgress } from "./components/FrameworkProgress.tsx";
import { LyricsPanel } from "./components/LyricsPanel.tsx";
import { MusicAttributesForm } from "./components/MusicAttributesForm.tsx";
import { SongPanel } from "./components/SongPanel.tsx";

const STORAGE_KEY = "songwriting-session";

const PHASE_LABEL: Record<Session["phase"], string> = {
  therapy: "1 · Talking together",
  lyric_questions: "2 · Your song idea",
  lyrics_review: "2 · Lyrics",
  music_attributes: "3 · Music",
  song_review: "4 · Your song",
  reflection: "4 · Reflection",
  revision: "5 · Changing the music",
  done: "Finished",
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [framework, setFramework] = useState<TherapyFramework | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    api.framework().then(setFramework).catch(() => {});
    const fromUrl = new URLSearchParams(location.search).get("session");
    if (fromUrl) localStorage.setItem(STORAGE_KEY, fromUrl);
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) api.get(id).then(setSession).catch(() => localStorage.removeItem(STORAGE_KEY));
  }, []);

  // poll while the server works on model/tool steps
  useEffect(() => {
    if (!session?.busy) return;
    const t = setInterval(() => api.get(session.id).then(setSession).catch(() => {}), 1200);
    return () => clearInterval(t);
  }, [session?.id, session?.busy]);

  const act = useCallback(async (fn: () => Promise<Session>) => {
    setActionError(null);
    try {
      setSession(await fn());
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  const startNew = async () => {
    await act(async () => {
      const s = await api.create();
      localStorage.setItem(STORAGE_KEY, s.id);
      return s;
    });
  };

  if (!session) {
    return (
      <main className="welcome">
        <h1>Songwriting companion</h1>
        <p>
          A gentle space to talk about your experiences and turn them into a song of your own. Everything is shown visually:
          you will see your lyrics move with the beat, and can feel the rhythm through vibration on supported phones.
        </p>
        <ol>
          <li>We talk about an experience, your feelings, and the music you like.</li>
          <li>We write lyrics together until you are happy with them.</li>
          <li>You choose the musical style and the song is created and visualized.</li>
          <li>We reflect together on what the song means to you.</li>
        </ol>
        <button className="primary big" onClick={startNew}>Start a session</button>
        {actionError && <p className="error">{actionError}</p>}
      </main>
    );
  }

  const latestSong = session.songs[session.songs.length - 1];
  const showMusicForm = session.phase === "music_attributes" || session.phase === "revision";

  return (
    <div className="app">
      <header className="topbar">
        <strong>Songwriting companion</strong>
        <span className="phase-pill">{PHASE_LABEL[session.phase]}</span>
        <button className="ghost" onClick={() => confirm("Start a new session? This one stays saved on the server.") && startNew()}>
          New session
        </button>
      </header>
      <div className="columns">
        <ChatPanel session={session} act={act} />
        <section className="workspace" aria-label="Workspace">
          {session.error && (
            <div className="card error-card" role="alert">
              <p>Something went wrong: {session.error.message}</p>
              <button className="primary" onClick={() => act(() => api.retry(session.id))}>Retry</button>
            </div>
          )}
          {actionError && <div className="card error-card" role="alert">{actionError}</div>}
          {framework && <FrameworkProgress framework={framework} session={session} />}
          {(session.lyrics.length > 0 || session.songConcept) && <LyricsPanel session={session} act={act} />}
          {showMusicForm && <MusicAttributesForm session={session} act={act} />}
          {latestSong && <SongPanel session={session} act={act} />}
        </section>
      </div>
    </div>
  );
}
