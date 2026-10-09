// Process 5: query (instruction language) → query_answer with text_card_links to query_cards.
// Process 8: a silver node flashes its query_turn here.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Card, ChatTurn } from '../../../shared/types.ts';

interface Props {
  turns: ChatTurn[];
  cards: Card[];
  disabled: boolean;
  activeCardId: string | null;
  flashTurn: { id: string; nonce: number } | null;
  onAsk: (q: string) => void;
  onActivateCard: (id: string) => void;
  onClear: () => void;
}

function AnswerText({ turn, activeCardId, onActivateCard }: { turn: ChatTurn; activeCardId: string | null; onActivateCard: (id: string) => void }) {
  const answer = turn.answer ?? '';
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const l of turn.links ?? []) {
    if (l.start < pos) continue;
    parts.push(answer.slice(pos, l.start));
    const text = answer.slice(l.start, l.end);
    const isCitation = /^\[F\d+\]$/.test(text);
    parts.push(
      <span
        key={`${l.start}-${l.cardId}`}
        className={`${isCitation ? 'cite' : 'alink'} ${activeCardId === l.cardId ? 'active' : ''}`}
        onMouseEnter={() => onActivateCard(l.cardId)}
        onClick={() => onActivateCard(l.cardId)}
        title="Linked query card"
      >
        {isCitation ? text.slice(1, -1) : text}
      </span>,
    );
    pos = l.end;
  }
  parts.push(answer.slice(pos));
  return <div className="answer">{parts}</div>;
}

export default function ChatPanel({ turns, cards, disabled, activeCardId, flashTurn, onAsk, onActivateCard, onClear }: Props) {
  const [q, setQ] = useState('');
  const refs = useRef(new Map<string, HTMLDivElement>());
  const list = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  useEffect(() => {
    if (!flashTurn) return;
    refs.current.get(flashTurn.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(flashTurn.id);
    const t = setTimeout(() => setFlashId(null), 2000);
    return () => clearTimeout(t);
  }, [flashTurn]);

  const submit = () => {
    const v = q.trim();
    if (!v) return;
    onAsk(v);
    setQ('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={list}>
        {!turns.length && (
          <div className="muted small pad">
            Ask a question about your sources. The answer cites knowledge-graph facts; each matched entity becomes a silver query card.
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} ref={(el) => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id); }} className={`turn ${flashId === t.id ? 'flash' : ''}`}>
            <div className="q">{t.query}</div>
            {t.status === 'pending' && <div className="answer loading">Looking up the knowledge graph…</div>}
            {t.status === 'error' && <div className="error">{t.error}</div>}
            {t.status === 'done' && (
              <>
                <AnswerText turn={t} activeCardId={activeCardId} onActivateCard={onActivateCard} />
                <div className="turn-cards">
                  {(t.cardIds ?? []).map((id) => {
                    const c = cards.find((x) => x.id === id);
                    return c ? (
                      <span key={id} className={`mini-card ${activeCardId === id ? 'active' : ''}`} onMouseEnter={() => onActivateCard(id)} onClick={() => onActivateCard(id)}>
                        {c.title}
                      </span>
                    ) : null;
                  })}
                  {!t.cardIds?.length && <span className="muted small">No matching facts.</span>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea
          value={q}
          disabled={disabled}
          placeholder={disabled ? 'Build the knowledge graph first (Sources & graph tab).' : 'Ask about your sources…'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="row gap">
          <button onClick={submit} disabled={disabled || !q.trim()}>Ask</button>
          {turns.length > 0 && <button className="link" onClick={onClear}>Clear</button>}
        </div>
      </div>
    </div>
  );
}
