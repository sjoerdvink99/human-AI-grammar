import type { AnswerFact, SuggestionCard, WritingMap } from "../shared/types";
import { GraphView } from "./GraphView";

interface Props {
  writingMap: WritingMap;
  pinnedSuggestion: SuggestionCard | null; // r22
  pinnedFact: AnswerFact | null; // r23
  onClearPins: () => void;
  onAddToMap: () => void; // P6 trigger
  selectedId: string | null;
  onSelectNode: (id: string | null) => void; // P7/P8 · [human select] → r25/r27
}

const COLORS = { suggestion: "#e15759", fact: "#4e79a7", concept: "#59a14f" };

/** r6 — the user's writing map, as a node-link view. */
export function WritingMapPanel(p: Props) {
  const sel = p.writingMap.nodes.find((n) => n.id === p.selectedId) ?? null;
  return (
    <section className="panel map">
      <header>
        <h2>Writing map</h2>
        <span className="muted">
          {p.writingMap.nodes.length} nodes · {p.writingMap.edges.length} links · v{p.writingMap.version}
        </span>
      </header>
      <div className="pin-tray">
        <span className={p.pinnedSuggestion ? "pinned" : "empty"}>
          {p.pinnedSuggestion ? `Suggestion: ${p.pinnedSuggestion.spanText.slice(0, 40)}…` : "No suggestion selected"}
        </span>
        <span className={p.pinnedFact ? "pinned" : "empty"}>{p.pinnedFact ? `Fact: ${p.pinnedFact.label}` : "No answer fact selected"}</span>
        <button className="primary" disabled={!p.pinnedSuggestion && !p.pinnedFact} onClick={p.onAddToMap}>
          Add to map
        </button>
        {(p.pinnedSuggestion || p.pinnedFact) && (
          <button className="ghost" onClick={p.onClearPins}>
            Clear
          </button>
        )}
      </div>
      <div className="graph-box">
        {p.writingMap.nodes.length ? (
          <GraphView
            width={420}
            height={250}
            nodes={p.writingMap.nodes.map((n) => ({ id: n.id, label: n.label, group: n.kind, title: n.text }))}
            edges={p.writingMap.edges.map((e) => ({ ...e, dashed: e.origin === "kg" }))}
            colors={COLORS}
            selectedId={p.selectedId}
            onSelect={p.onSelectNode}
            showEdgeLabels
          />
        ) : (
          <p className="muted pad">
            Select a suggestion card and/or an answer fact with 📌, then “Add to map”. Linked through the knowledge graph, the map shows how your
            material connects. Click a node to find it in the draft and the answer.
          </p>
        )}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: COLORS.suggestion }} /> suggestion
        </span>
        <span>
          <i style={{ background: COLORS.fact }} /> answer fact
        </span>
        <span>— pinned together · - - linked via knowledge graph</span>
      </div>
      {sel && (
        <div className="card node-detail">
          <div className="label">{sel.label}</div>
          <p>{sel.text}</p>
        </div>
      )}
    </section>
  );
}
