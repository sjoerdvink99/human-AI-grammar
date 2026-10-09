// Process 5: region + issue -> model picks repair target -> model suggests change (incl. UI-graph edits)
// -> human approves -> tool_1 applies graph edits (ui_graph_N) -> model regenerates code (simulation_code_chat_N).
import { useEffect, useState } from "react";
import type { RepairTarget, SuggestedChange } from "../../../shared/types";
import { Busy, ErrorBox } from "../../components/Status";
import { post } from "../../lib/api";
import { applyGraphChanges, isEmptyChanges } from "../../lib/graphDiff";
import { useOp } from "../../lib/useOp";
import { currentCode, latest, useProject } from "../../state";
import type { PanelProps } from "../Workspace";
import { ApproveList } from "./ApproveList";
import { RegionSummary } from "./RegionSummary";

export function ChatPanel({ region, commitCode }: PanelProps) {
  const { project: p, update } = useProject();
  const op = useOp();
  const [issue, setIssue] = useState("");
  const [target, setTarget] = useState<RepairTarget | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedChange | null>(null);
  const [history, setHistory] = useState<{ issue: string; summary: string; version: string }[]>([]);
  const code = currentCode(p)!;
  const ui_graph = latest(p.ui_graph)!;

  useEffect(() => {
    setTarget(null);
    setSuggestion(null);
  }, [region]);

  const send = () =>
    op.run("Analysing request", async () => {
      setTarget(null);
      setSuggestion(null);
      const body = { simulation_code: code.html, ui_graph, issue, chat_region: region };
      const repair_target = await post<RepairTarget>("p5/repair-target", body);
      setTarget(repair_target);
      setSuggestion(await post<SuggestedChange>("p5/suggest", { ...body, repair_target }));
    });

  const apply = (approved_change: SuggestedChange) =>
    op.run("Applying change", async () => {
      // tool_1 modify: deterministic UI-graph update from the approved change
      const note = approved_change.changes.join("; ");
      let ui_graph_2 = ui_graph;
      if (!isEmptyChanges(approved_change.ui_graph_changes)) {
        ui_graph_2 = applyGraphChanges(ui_graph, approved_change.ui_graph_changes!, note);
      } else {
        // no structural edit approved: record the approved change on the nodes inside the region
        const ids = new Set(region?.elements.map((e) => e.ui_node).filter(Boolean));
        ui_graph_2 = { ...ui_graph, nodes: ui_graph.nodes.map((n) => ({ ...n, change_note: ids.has(n.id) ? note : undefined })) };
      }
      const html = await post<string>("p5/regenerate", { simulation_code: code.html, ui_graph: ui_graph_2 });
      update((s) => ({ ui_graph: [...s.ui_graph, ui_graph_2] }));
      commitCode("chat", html, `chat: ${approved_change.summary}`);
      setHistory((h) => [...h, { issue, summary: approved_change.summary, version: `ui_graph_${p.ui_graph.length + 1}` }]);
      setSuggestion(null);
      setTarget(null);
      setIssue("");
    });

  return (
    <div className="panel">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />
      <RegionSummary region={region} />
      <textarea
        rows={3}
        placeholder={region ? "Describe what is wrong or what should change here…" : "First drag a region on the simulation"}
        disabled={!region}
        value={issue}
        onChange={(e) => setIssue(e.target.value)}
      />
      <button className="primary" disabled={!region || !issue.trim() || !!op.busy} onClick={send}>
        Send
      </button>
      {op.busy && <Busy label={op.busy} />}
      {target && (
        <p>
          Repair target: <span className="tag">{target}</span>
        </p>
      )}
      {suggestion && <ApproveList suggestion={suggestion} busy={!!op.busy} onApprove={apply} onRegenerate={send} />}
      {history.length > 0 && (
        <>
          <h4>Applied in this session</h4>
          <ul className="small">{history.map((h, i) => <li key={i}>“{h.issue}” → {h.summary} ({h.version})</li>)}</ul>
        </>
      )}
    </div>
  );
}
