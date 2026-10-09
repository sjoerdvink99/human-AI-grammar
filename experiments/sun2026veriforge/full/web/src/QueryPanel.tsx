// Process 5 (human specify, answer + cards + color-coded links) and
// process 8 (scroll to the conversation turn behind a silver node).
import { useEffect, useRef, useState } from "react";
import { KnowledgeCardView } from "./KnowledgeCard.tsx";
import type { KnowledgeCard, QueryTurn } from "../../shared/types.ts";

interface Props {
  turns: QueryTurn[];
  pending: string | null;
  error: string | null;
  focusTurn: { id: string; nonce: number } | null;
  canvasCardIds: Set<string>;
  onAsk(q: string): void;
  onAdd(card: KnowledgeCard): void;
}

function AnswerText({ turn, hover, setHover }: { turn: QueryTurn; hover: string | null; setHover(id: string | null): void }) {
  const parts: React.ReactElement[] = [];
  let pos = 0;
  turn.links.forEach((l, i) => {
    if (l.start > pos) parts.push(<span key={`t${i}`}>{turn.answer.slice(pos, l.start)}</span>);
    parts.push(
      <mark
        key={`l${i}`}
        className={`link-mark ${hover === l.cardId ? "hl" : ""}`}
        style={{ background: `${l.color}2a`, borderBottomColor: l.color }}
        onMouseEnter={() => setHover(l.cardId)}
        onMouseLeave={() => setHover(null)}
        onClick={() => document.getElementById(`card-${l.cardId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
      >
        {turn.answer.slice(l.start, l.end)}
      </mark>,
    );
    pos = l.end;
  });
  parts.push(<span key="end">{turn.answer.slice(pos)}</span>);
  return <p className="answer">{parts}</p>;
}

export function QueryPanel({ turns, pending, error, focusTurn, canvasCardIds, onAsk, onAdd }: Props) {
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusTurn) return;
    document.getElementById(`turn-${focusTurn.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlash(focusTurn.id);
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [focusTurn]);

  useEffect(() => {
    if (pending) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [pending, turns.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || pending) return;
    onAsk(q.trim());
    setQ("");
  };

  return (
    <section className="pane query-pane">
      <header className="pane-head"><h2>Query Panel</h2></header>
      <div className="turns" ref={listRef}>
        {!turns.length && !pending && <p className="muted empty">Ask about anything in your sources — e.g. “How was a ship's position found at sea?”</p>}
        {turns.map((t) => (
          <div key={t.id} id={`turn-${t.id}`} className={`turn ${flash === t.id ? "flash" : ""}`}>
            <div className="bubble user">{t.query}</div>
            <div className="bubble bot"><AnswerText turn={t} hover={hover} setHover={setHover} /></div>
            <div className="turn-cards">
              {t.cards.map((c) => (
                <div id={`card-${c.id}`} key={c.id}>
                  <KnowledgeCardView card={c} compact onCanvas={canvasCardIds.has(c.id)} onAdd={onAdd} highlighted={hover === c.id} onHover={setHover} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {pending && (
          <div className="turn">
            <div className="bubble user">{pending}</div>
            <div className="bubble bot muted"><span className="spinner" /> Retrieving source-backed facts…</div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      <form className="ask" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about an unfamiliar concept…" disabled={!!pending} />
        <button className="primary" disabled={!q.trim() || !!pending}>Ask</button>
      </form>
    </section>
  );
}
