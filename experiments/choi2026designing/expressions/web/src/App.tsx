import { useCallback, useEffect, useRef, useState } from 'react';
import { getSession, getStatus, post, type View } from './api.ts';
import { TalkStage } from './TalkStage.tsx';
import { LyricsStage } from './LyricsStage.tsx';
import { MusicStage } from './MusicStage.tsx';
import { ReflectStage } from './ReflectStage.tsx';

export type Act = (path: string, body?: unknown, label?: string) => Promise<boolean>;

const STAGES = [
  { id: 'talk', label: '1 · Talk' },
  { id: 'lyrics', label: '2 · Lyrics' },
  { id: 'music', label: '3 · Music' },
  { id: 'reflect', label: '4 · Listen & reflect' },
] as const;

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => { getSession().then(setView); }, []);

  const act: Act = useCallback(async (path, body, label = 'Thinking…') => {
    setPending(label);
    setError(null);
    poll.current = window.setInterval(async () => setProgress(await getStatus()), 1200);
    try {
      const v = await post(path, body);
      setView(v);
      setTab(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      window.clearInterval(poll.current);
      setPending(null);
      setProgress(null);
    }
  }, []);

  if (!view) return <div className="loading-page">Loading…</div>;
  const { session, framework } = view;
  const reached = STAGES.findIndex((s) => s.id === session.stage);
  const shown = tab ?? session.stage;

  return (
    <div className="app">
      <aside className="rail">
        <h1>Songwriting<br />Companion</h1>
        <nav>
          {STAGES.map((s, i) => (
            <button key={s.id} className={`stage ${shown === s.id ? 'active' : ''}`} disabled={i > reached} onClick={() => setTab(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <section className="framework">
          <h2>{framework.name}</h2>
          {framework.steps.map((step, i) => {
            const st = session.step_status;
            const done = st.status === 'all_complete' || i < st.current_step;
            const current = !done && i === st.current_step;
            return (
              <div key={step.id} className={`fstep ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                <div className="ftitle">{done ? '✓' : current ? '●' : '○'} {step.title}</div>
                {step.required_variables.map((v) => (
                  <div key={v.name} className="fvar" title={v.description}>
                    <span className="vname">{v.name.replace(/_/g, ' ')}</span>
                    <span className="vval">{session.required_variables[v.name] ?? '—'}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className={`status-pill ${session.step_status.status}`}>step status: {session.step_status.status.replace('_', ' ')}</div>
        </section>
        <button className="link" onClick={() => confirm('Start a new session? Everything will be cleared.') && act('reset', {}, 'Resetting…')}>
          New session
        </button>
      </aside>
      <main>
        {error && <div className="error" onClick={() => setError(null)}>{error} <small>(click to dismiss)</small></div>}
        {pending && (
          <div className="busy"><span className="spinner" /> {progress && progress !== 'working…' ? progress : pending}</div>
        )}
        {shown === 'talk' && <TalkStage view={view} act={act} pending={!!pending} />}
        {shown === 'lyrics' && <LyricsStage view={view} act={act} pending={!!pending} />}
        {shown === 'music' && <MusicStage view={view} act={act} pending={!!pending} />}
        {shown === 'reflect' && <ReflectStage view={view} act={act} pending={!!pending} />}
      </main>
    </div>
  );
}
