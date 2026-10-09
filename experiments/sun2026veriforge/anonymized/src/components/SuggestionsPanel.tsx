import type { Grounding, KnowledgeGraph, SuggestionCard, TextSpan } from "../shared/types";
import { edgeFactText } from "../shared/tools";

interface Props {
  selectedSpan: TextSpan | null;
  grounding: Grounding | null;
  knowledgeGraph: KnowledgeGraph | null;
  cards: SuggestionCard[];
  loading: boolean;
  error: string | null;
  onRegenerate: () => void;
  pinnedId: string | null;
  onTogglePin: (card: SuggestionCard) => void; // P6 · [human select] → r22
  hasGrounding: boolean;
}

export const ScoreBar = ({ value }: { value: number }) => (
  <span className="bar" title={value.toFixed(2)}>
    <span style={{ width: `${Math.round(value * 100)}%` }} />
  </span>
);

/** P4: the selected span (r12), its KG matches (r10), the generated suggestion (r13) and cards (r14). */
export function SuggestionsPanel(p: Props) {
  const current = p.cards[0];
  return (
    <div className="tab-body">
      {!p.selectedSpan && (
        <p className="muted">
          {p.hasGrounding
            ? "Click a highlighted passage in the draft (Review mode) to get a grounded suggestion."
            : "Build the knowledge graph, write a draft and press “Ground draft” to highlight grounded passages."}
        </p>
      )}
      {p.selectedSpan && (
        <div className="card span-card">
          <div className="label">Selected passage</div>
          <blockquote>{p.selectedSpan.text}</blockquote>
          {p.grounding && p.knowledgeGraph && (
            <details open>
              <summary>Matched knowledge ({p.grounding.matches.length} nodes)</summary>
              <ul className="matches">
                {p.grounding.matches.map((m) => (
                  <li key={m.nodeId}>
                    <ScoreBar value={m.score} /> {m.name}
                  </li>
                ))}
                {p.grounding.edgeIds.map((id) => {
                  const e = p.knowledgeGraph!.edges.find((x) => x.id === id);
                  return e ? (
                    <li key={id} className="fact">
                      {edgeFactText(e, p.knowledgeGraph!)}
                    </li>
                  ) : null;
                })}
              </ul>
            </details>
          )}
        </div>
      )}
      {p.loading && <div className="card loading">Generating suggestion…</div>}
      {p.error && <div className="card error">{p.error}</div>}
      {p.cards.map((c) => (
        <div key={c.id} className={`card suggestion${c === current && !p.loading ? " current" : ""}`}>
          <div className="label">
            Suggestion for “{c.spanText.length > 60 ? c.spanText.slice(0, 60) + "…" : c.spanText}”
          </div>
          <p>{c.suggestion}</p>
          <div className="row">
            <button className={p.pinnedId === c.id ? "pin on" : "pin"} onClick={() => p.onTogglePin(c)}>
              {p.pinnedId === c.id ? "📌 Selected for map" : "📌 Select for map"}
            </button>
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(c.suggestion)}>
              Copy
            </button>
            {c === current && p.selectedSpan && (
              <button className="ghost" disabled={p.loading} onClick={p.onRegenerate}>
                ↻ Regenerate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
