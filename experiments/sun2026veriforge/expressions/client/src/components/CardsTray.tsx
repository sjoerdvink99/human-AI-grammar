// highlight_card (gold) and query_cards* (silver). Process 6 [human select]: check cards / drag them onto the canvas.
import { useEffect, useRef } from 'react';
import type { CanvasGraph, Card, HighlightCard } from '../../../shared/types.ts';

interface Props {
  cards: Card[];
  canvas: CanvasGraph;
  selected: string[];
  activeCardId: string | null;
  explaining: { spanId: string; text: string; cardId?: string } | null;
  explainError: string;
  onToggle: (id: string) => void;
  onAdd: (ids: string[]) => void;
  onActivate: (id: string) => void;
  onRegenerate: (card: HighlightCard) => void;
  onRemove: (id: string) => void;
}

export default function CardsTray(p: Props) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (p.activeCardId) refs.current.get(p.activeCardId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.activeCardId]);

  const onCanvas = new Set(p.canvas.nodes.map((n) => n.cardId));
  const highlight = p.cards.filter((c) => c.kind === 'highlight');
  const query = p.cards.filter((c) => c.kind === 'query');

  const renderCard = (c: Card) => {
    const regenerating = p.explaining?.cardId === c.id;
    return (
      <div
        key={c.id}
        ref={(el) => { if (el) refs.current.set(c.id, el); else refs.current.delete(c.id); }}
        className={`card ${c.kind} ${p.activeCardId === c.id ? 'active' : ''} ${p.selected.includes(c.id) ? 'selected' : ''}`}
        draggable
        onDragStart={(e) => {
          const ids = p.selected.includes(c.id) ? p.selected : [c.id];
          e.dataTransfer.setData('application/x-card', JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => p.onActivate(c.id)}
      >
        <div className="card-head">
          <input type="checkbox" checked={p.selected.includes(c.id)} onChange={() => p.onToggle(c.id)} onClick={(e) => e.stopPropagation()} title="Select for canvas" />
          <span className="card-title">{c.title}</span>
          {onCanvas.has(c.id) && <span className="badge">on canvas</span>}
          <button className="icon" title="Delete card" onClick={(e) => { e.stopPropagation(); p.onRemove(c.id); }}>×</button>
        </div>
        {c.kind === 'highlight' ? (
          <>
            <div className="card-quote">“{c.span.text}”</div>
            <div className={`card-body ${regenerating ? 'loading' : ''}`}>{regenerating ? 'Regenerating explanation…' : c.explanation}</div>
          </>
        ) : null}
        <details className="card-facts" onClick={(e) => e.stopPropagation()}>
          <summary>{c.facts.length} fact{c.facts.length === 1 ? '' : 's'} from the knowledge graph</summary>
          {c.facts.map((f) => (
            <div key={f.id + f.entityId} className="fact">
              <b>{f.entityName}</b> <span className="muted">({f.entityType}, match {f.score})</span>
              {f.description && <div>{f.description}</div>}
              <ul>{f.statements.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          ))}
        </details>
        <div className="card-actions">
          {c.kind === 'highlight' && (
            <button className="link" disabled={!!p.explaining} onClick={(e) => { e.stopPropagation(); p.onRegenerate(c); }}>Regenerate</button>
          )}
          {!onCanvas.has(c.id) && (
            <button className="link" onClick={(e) => { e.stopPropagation(); p.onAdd([c.id]); }}>Add to canvas</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="tray">
      <div className="tray-head">
        <h3>Cards</h3>
        <button disabled={!p.selected.length} onClick={() => p.onAdd(p.selected)}>
          Add selected to canvas{p.selected.length ? ` (${p.selected.length})` : ''}
        </button>
      </div>
      <div className="tray-cols">
        <div className="tray-col">
          <div className="tray-label gold-label">From draft highlights</div>
          {p.explaining && !p.explaining.cardId && (
            <div className="card highlight loading">
              <div className="card-quote">“{p.explaining.text}”</div>
              <div className="card-body">Explaining against the knowledge graph…</div>
            </div>
          )}
          {p.explainError && <div className="error">{p.explainError}</div>}
          {highlight.map(renderCard)}
          {!highlight.length && !p.explaining && <div className="muted small">Click a highlighted phrase in the draft.</div>}
        </div>
        <div className="tray-col">
          <div className="tray-label silver-label">From questions</div>
          {query.map(renderCard)}
          {!query.length && <div className="muted small">Ask the knowledge graph a question.</div>}
        </div>
      </div>
    </div>
  );
}
