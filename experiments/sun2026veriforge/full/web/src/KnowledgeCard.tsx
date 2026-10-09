// Presentation of a KnowledgeCard (highlight_card / query_cards): explanation paired
// with exact source passages. "Add to canvas" is process 6's human select.
import { useState } from "react";
import { api } from "./api.ts";
import type { KnowledgeCard, Passage } from "../../shared/types.ts";

interface Props {
  card: KnowledgeCard;
  onCanvas: boolean;
  onAdd(card: KnowledgeCard): void;
  onRegenerate?(): void;
  onClose?(): void;
  highlighted?: boolean;
  onHover?(id: string | null): void;
  compact?: boolean;
}

export function KnowledgeCardView({ card, onCanvas, onAdd, onRegenerate, onClose, highlighted, onHover, compact }: Props) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const tone = card.origin.kind === "highlight" ? "gold" : "silver";
  const showPassage = async (id: string) => {
    if (passage?.id === id) return setPassage(null);
    setPassage(await api.passage(id).catch(() => null));
  };
  return (
    <article
      className={`kcard ${tone} ${highlighted ? "hl" : ""} ${compact ? "compact" : ""}`}
      style={card.color ? { borderLeftColor: card.color } : undefined}
      onMouseEnter={() => onHover?.(card.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <header>
        <h3>{card.concept}</h3>
        {onClose && <button className="icon" onClick={onClose} title="Close">×</button>}
      </header>
      <p className="explanation">{card.explanation}</p>
      {card.facts.map((f, i) => (
        <div key={i} className="source">
          <blockquote>“{f.quote}”</blockquote>
          <div className="cite">
            <span>— {f.docTitle}</span>
            <button className="link" onClick={() => showPassage(f.passageId)}>
              {passage?.id === f.passageId ? "hide passage" : "full passage"}
            </button>
          </div>
          {passage?.id === f.passageId && <pre className="passage">{passage.text}</pre>}
        </div>
      ))}
      <footer>
        <button className="primary" disabled={onCanvas} onClick={() => onAdd(card)}>
          {onCanvas ? "On canvas ✓" : "Add to canvas"}
        </button>
        {onRegenerate && <button onClick={onRegenerate}>Regenerate explanation</button>}
      </footer>
    </article>
  );
}
