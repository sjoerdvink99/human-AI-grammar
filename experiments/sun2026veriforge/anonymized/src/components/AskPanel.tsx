import { useState } from "react";
import type { AnswerFact, AskResponse, TextSpan } from "../shared/types";
import { MarkedText } from "./MarkedText";
import { ScoreBar } from "./SuggestionsPanel";

interface Props {
  disabled: boolean;
  loading: boolean;
  error: string | null;
  result: (AskResponse & { question: string }) | null;
  onAsk: (q: string) => void; // P5 · [human specify] → r15
  pinnedId: string | null;
  onTogglePin: (f: AnswerFact) => void; // P6 · [human select] → r23
  answerNodeSpans: TextSpan[]; // r28
  selectedMapNodeLabel: string | null;
}

const citations = (s: string) =>
  s.split(/(\[F\d+\])/g).map((part, i) => (/^\[F\d+\]$/.test(part) ? <sup key={i} className="cite">{part.slice(1, -1)}</sup> : part));

/** P5: question (r15), terms (r16), retrieved facts (r18), answer (r19), fact cards (r20) and sources (r21). */
export function AskPanel(p: Props) {
  const [q, setQ] = useState("");
  const r = p.result;
  return (
    <div className="tab-body">
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) p.onAsk(q.trim());
        }}
      >
        <textarea
          rows={2}
          placeholder={p.disabled ? "Build the knowledge graph first" : "Ask the sources, e.g. “Can bleached corals recover?”"}
          value={q}
          disabled={p.disabled}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (q.trim()) p.onAsk(q.trim());
            }
          }}
        />
        <div className="row">
          <button className="primary" disabled={p.disabled || p.loading || !q.trim()}>
            {p.loading ? "Answering…" : "Ask"}
          </button>
          {r && (
            <button type="button" className="ghost" disabled={p.loading} onClick={() => p.onAsk(r.question)}>
              ↻ Regenerate
            </button>
          )}
        </div>
      </form>
      {p.error && <div className="card error">{p.error}</div>}
      {r && (
        <>
          <div className="chips">
            <span className="muted">Looked up:</span>
            {r.questionTerms.map((t) => (
              <span key={t.id} className="chip">
                {t.text}
              </span>
            ))}
          </div>
          <div className={`card answer${p.loading ? " dim" : ""}`}>
            <div className="label">Answer to “{r.question}”</div>
            <p>
              <MarkedText text={r.answer} layers={[{ spans: p.answerNodeSpans, className: "mapnode" }]} decorate={(s) => citations(s)} />
            </p>
            {p.selectedMapNodeLabel && (
              <div className="legend">
                <span>
                  <i className="sw mapnode" /> mentions of “{p.selectedMapNodeLabel}” ({p.answerNodeSpans.length})
                </span>
              </div>
            )}
          </div>
          {r.answerFacts.map((f) => (
            <div key={f.id} className="card fact-card">
              <div className="label">
                <sup className="cite">{f.factId}</sup> {f.label}
              </div>
              <p className="fact">{f.text}</p>
              {r.answerSources
                .filter((s) => s.factId === f.factId)
                .map((s, i) => (
                  <div key={i} className="source">
                    <b>{s.docTitle}:</b> “{s.snippet}”
                  </div>
                ))}
              <button className={p.pinnedId === f.id ? "pin on" : "pin"} onClick={() => p.onTogglePin(f)}>
                {p.pinnedId === f.id ? "📌 Selected for map" : "📌 Select for map"}
              </button>
            </div>
          ))}
          <details>
            <summary>All retrieved facts ({r.retrievedFacts.length})</summary>
            <ul className="matches">
              {r.retrievedFacts.map((f) => (
                <li key={f.id}>
                  <ScoreBar value={f.score} /> <b>{f.id}</b> {f.text}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
