// Process 6: selected UI-graph node -> model extracts assumptions -> human edits -> model applies
// (simulation_code_assumptions_N).
import { useEffect, useState } from "react";
import type { Assumptions } from "../../../shared/types";
import { Busy, ErrorBox } from "../../components/Status";
import { post } from "../../lib/api";
import { useOp } from "../../lib/useOp";
import { currentCode, latest, useProject } from "../../state";
import type { PanelProps } from "../Workspace";

export function AssumptionsPanel({ commitCode, selectedNode }: PanelProps & { selectedNode: string | null }) {
  const { project: p } = useProject();
  const op = useOp();
  const [assumptions1, setAssumptions1] = useState<Assumptions | null>(null);
  const [assumptions2, setAssumptions2] = useState<Assumptions | null>(null);
  const code = currentCode(p)!;
  const ui_graph = latest(p.ui_graph)!;
  const node = ui_graph.nodes.find((n) => n.id === selectedNode);

  const extract = () =>
    op.run("Extracting assumptions", async () => {
      setAssumptions1(null);
      setAssumptions2(null);
      const a = await post<Assumptions>("p6/assumptions", { simulation_code: code.html, ui_graph, selected_node: selectedNode });
      setAssumptions1(a);
      setAssumptions2(structuredClone(a));
    });

  useEffect(() => {
    if (selectedNode) extract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  const edit = (i: number, field: "name" | "value", v: string) =>
    setAssumptions2((a) => a && { ...a, items: a.items.map((it, j) => (j === i ? { ...it, [field]: v } : it)) });

  const apply = () =>
    op.run("Applying assumptions", async () => {
      const html = await post<string>("p6/apply", { simulation_code: code.html, assumptions: assumptions2 });
      const changed = assumptions2!.items.filter((it, i) => it.value !== assumptions1!.items[i]?.value || it.name !== assumptions1!.items[i]?.name).map((it) => it.name);
      commitCode("assumptions", html, `assumptions of ${selectedNode}: ${changed.join(", ") || "re-applied"}`);
      setAssumptions1(structuredClone(assumptions2));
    });

  if (!node) return <p className="hint">Click a node in the UI graph on the left.</p>;
  const dirty = assumptions1 && assumptions2 && JSON.stringify(assumptions1) !== JSON.stringify(assumptions2);
  return (
    <div className="panel">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />
      <p>
        <b>{node.label}</b> <span className="tag">{node.kind}</span>
        <br />
        <span className="small">{node.description}</span>
      </p>
      {op.busy && <Busy label={op.busy} />}
      {assumptions2 && (
        <>
          <table className="assumptions">
            <thead>
              <tr>
                <th>assumption</th>
                <th>value</th>
              </tr>
            </thead>
            <tbody>
              {assumptions2.items.map((it, i) => {
                const changed = it.value !== assumptions1?.items[i]?.value || it.name !== assumptions1?.items[i]?.name;
                return (
                  <tr key={i} className={changed ? "changed" : ""} title={it.rationale}>
                    <td>
                      <input value={it.name} onChange={(e) => edit(i, "name", e.target.value)} />
                    </td>
                    <td>
                      <input value={it.value} onChange={(e) => edit(i, "value", e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => setAssumptions2((a) => a && { ...a, items: [...a.items, { name: "new assumption", value: "", rationale: "added by teacher" }] })}>+ Add</button>
            <button onClick={() => setAssumptions2(structuredClone(assumptions1))} disabled={!dirty}>
              Undo edits
            </button>
            <button className="primary" disabled={!dirty || !!op.busy} onClick={apply}>
              Apply to simulation
            </button>
          </div>
        </>
      )}
    </div>
  );
}
