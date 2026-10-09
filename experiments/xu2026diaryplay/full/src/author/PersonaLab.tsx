/** Process 2 — Refine a character through simulated dialogue. */
import { useState } from 'react';
import { api } from '../api';
import { useTask } from '../store';
import type { Project } from '../../shared/types';

type Props = { project: Project; update: (p: Partial<Project> | ((p: Project) => Partial<Project>)) => void };
interface Round { message: string; reply: string; corrected: boolean; applied: string[] }

export default function PersonaLab({ project: p, update }: Props) {
  const [charId, setCharId] = useState(p.characters.find((c) => !c.isPlayer)?.id ?? p.characters[0]?.id);
  const c = p.characters.find((x) => x.id === charId);
  const [message, setMessage] = useState('');          // message_1
  const [sent, setSent] = useState('');                // message_1 as sent
  const [modelReply, setModelReply] = useState('');    // reply_1
  const [reply, setReply] = useState('');              // reply_2 (editable)
  const [traits, setTraits] = useState<string[]>([]);  // traits_1
  const [choice, setChoice] = useState<string[]>([]);  // trait_choice_1
  const [personality, setPersonality] = useState('');  // draft of characters_3 personality
  const [history, setHistory] = useState<Record<string, Round[]>>({});
  const { busy, error, run } = useTask();

  const resetRound = () => { setSent(''); setModelReply(''); setReply(''); setTraits([]); setChoice([]); };

  // P2.1 specify + P2.2 generate~
  const send = () => run('Character is replying…', async () => {
    resetRound();
    const r = await api.personaReply({ story: p.story, characters: p.characters, characterId: charId, message });
    setSent(message); setModelReply(r.reply); setReply(r.reply); setMessage('');
  });
  // P2.4 generate~ (from message_1 + reply_2)
  const suggest = () => run('Suggesting traits…', async () => {
    const r = await api.suggestTraits({ story: p.story, characters: p.characters, characterId: charId, message: sent, reply });
    setTraits(r.traits); setChoice([]); setPersonality(c?.personality ?? '');
  });
  // P2.6 modify -> characters_3
  const apply = () => {
    if (!c) return;
    update((q) => ({
      characters: q.characters.map((x) => x.id === c.id ? { ...x, personality, traits: [...new Set([...x.traits, ...choice])] } : x),
    }));
    setHistory((h) => ({ ...h, [c.id]: [...(h[c.id] ?? []), { message: sent, reply, corrected: reply !== modelReply, applied: choice }] }));
    resetRound();
  };

  if (!c) return <p>No characters yet.</p>;
  return (
    <div className="cols">
      <section className="col">
        <div className="card">
          <h2>Characters</h2>
          {p.characters.map((x) => (
            <button key={x.id} className={`charpick ${x.id === charId ? 'on' : ''}`} onClick={() => { setCharId(x.id); resetRound(); }}>
              <span className="dot" style={{ background: x.color }} /> {x.name} {x.isPlayer && <span className="tag">player</span>}
            </button>
          ))}
        </div>
        <div className="card">
          <h3>{c.name}'s persona</h3>
          <p className="small"><b>Personality:</b> {c.personality}</p>
          <p className="small"><b>Traits:</b> {c.traits.join(', ') || '—'}</p>
          <p className="small"><b>Speaking style:</b> {c.speakingStyle}</p>
          <p className="small"><b>Goals:</b> {c.goals}</p>
        </div>
      </section>
      <section className="col wide">
        <div className="card">
          <h2>Talk to {c.name}</h2>
          <p className="muted">Say something to test how {c.name} responds. Correct the reply if it is off, then ask for traits that capture your correction.</p>
          {(history[c.id] ?? []).map((r, i) => (
            <div key={i} className="round past">
              <div className="me">You: {r.message}</div>
              <div className="them">{c.name}: {r.reply} {r.corrected && <span className="tag">corrected</span>}</div>
              {r.applied.length > 0 && <div className="small muted">added traits: {r.applied.join(', ')}</div>}
            </div>
          ))}
          {sent && (
            <div className="round">
              <div className="me">You: {sent}</div>
              <label className="them">{c.name} replies (edit to correct):
                <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
              </label>
              {reply !== modelReply && <button className="link small" onClick={() => setReply(modelReply)}>revert to original reply</button>}
              <div className="row">
                <button className="primary" disabled={!!busy || !reply.trim()} onClick={suggest}>{traits.length ? 'Suggest again' : 'Suggest traits'}</button>
              </div>
              {traits.length > 0 && (
                <div className="traits">
                  <p className="small">Select the traits to keep:</p>
                  {traits.map((t) => (
                    <button key={t} className={`chip ${choice.includes(t) ? 'on' : ''}`} onClick={() => setChoice((ch) => ch.includes(t) ? ch.filter((x) => x !== t) : [...ch, t])}>{t}</button>
                  ))}
                  <label>Personality (edit before applying)
                    <textarea rows={3} value={personality} onChange={(e) => setPersonality(e.target.value)} />
                  </label>
                  <div className="row">
                    <button className="primary" onClick={apply}>Apply to {c.name}'s persona</button>
                    <button className="ghost" onClick={resetRound}>Discard</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {busy && <p className="busy">⏳ {busy}</p>}
          {error && <p className="error">⚠ {error}</p>}
          <div className="row">
            <input className="grow" placeholder={`Say something to ${c.name}…`} value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && message.trim() && !busy) send(); }} />
            <button className="primary" disabled={!message.trim() || !!busy} onClick={send}>Send</button>
          </div>
        </div>
      </section>
    </div>
  );
}
