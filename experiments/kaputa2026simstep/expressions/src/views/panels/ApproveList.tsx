// [human select] over a suggested change: approve individual changes (approved_repair / approved_change).
import { useEffect, useState } from "react";
import type { SuggestedChange } from "../../../shared/types";
import { isEmptyChanges } from "../../lib/graphDiff";

interface Props {
  suggestion: SuggestedChange;
  busy: boolean;
  onApprove: (approved: SuggestedChange) => void;
  onRegenerate: () => void;
}

export function ApproveList({ suggestion, busy, onApprove, onRegenerate }: Props) {
  const [keep, setKeep] = useState<boolean[]>([]);
  const [graphOk, setGraphOk] = useState(true);
  useEffect(() => {
    setKeep(suggestion.changes.map(() => true));
    setGraphOk(true);
  }, [suggestion]);
  const g = suggestion.ui_graph_changes;
  const approved: SuggestedChange = {
    ...suggestion,
    changes: suggestion.changes.filter((_, i) => keep[i]),
    ui_graph_changes: graphOk ? g : undefined,
  };
  return (
    <div className="suggestion">
      <h4>Suggested change</h4>
      <p>
        <b>{suggestion.summary}</b>
      </p>
      {suggestion.rationale && <p className="small">{suggestion.rationale}</p>}
      {suggestion.changes.map((c, i) => (
        <label key={i} className="check">
          <input type="checkbox" checked={keep[i] ?? true} onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))} /> {c}
        </label>
      ))}
      {!isEmptyChanges(g) && (
        <label className="check graph-changes">
          <input type="checkbox" checked={graphOk} onChange={(e) => setGraphOk(e.target.checked)} /> UI-graph edits:{" "}
          {[
            ...g!.add_nodes.map((n) => `+ ${n.label}`),
            ...g!.update_nodes.map((n) => `~ ${n.id}`),
            ...g!.remove_node_ids.map((id) => `− ${id}`),
            ...g!.add_edges.map((e) => `+ ${e.source}→${e.target}`),
            ...g!.remove_edges.map((e) => `− ${e.source}→${e.target}`),
          ].join(", ")}
        </label>
      )}
      <div className="row">
        <button className="primary" disabled={busy || !approved.changes.length} onClick={() => onApprove(approved)}>
          Apply {approved.changes.length} approved change(s)
        </button>
        <button disabled={busy} onClick={onRegenerate}>
          Suggest again
        </button>
      </div>
    </div>
  );
}
