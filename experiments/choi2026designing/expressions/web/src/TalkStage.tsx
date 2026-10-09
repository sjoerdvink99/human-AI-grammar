import { useEffect, useRef, useState } from 'react';
import type { View } from './api.ts';
import type { Act } from './App.tsx';

/** Process 1: framework-guided conversation. */
export function TalkStage({ view, act, pending }: { view: View; act: Act; pending: boolean }) {
  const { session } = view;
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (session.chat_history.length === 0 && !pending) act('p1/start', {}, 'Getting ready…');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [session.chat_history.length]);

  const send = async () => {
    if (!text.trim()) return;
    const t = text;
    setText('');
    if (!(await act('p1/answer', { text: t }, 'Listening…'))) setText(t);
  };
  const complete = session.step_status.status === 'all_complete';

  return (
    <div className="stage-panel talk">
      <h2>Let’s talk first</h2>
      <p className="hint">Share as much or as little as you like. What you say here becomes the raw material of your song.</p>
      <div className="chat">
        {session.chat_history.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.text}</div>
        ))}
        <div ref={end} />
      </div>
      <div className="composer">
        <textarea
          value={text}
          placeholder={complete ? 'You can keep talking, or move on to the song…' : 'Type your answer…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={pending}
        />
        <button onClick={send} disabled={pending || !text.trim()}>Send</button>
      </div>
      {complete && (
        <div className="next">
          <span>We have what we need to start writing.</span>
          <button className="primary" disabled={pending} onClick={() => act('p2/questions', {}, 'Preparing songwriting questions…')}>
            Start writing the song →
          </button>
        </div>
      )}
    </div>
  );
}
