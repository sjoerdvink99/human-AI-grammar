// Process 8: region on the simulation -> model match -> subgraph of the UI graph (highlighted on the left).
import { useEffect } from "react";
import { Busy, ErrorBox } from "../../components/Status";
import { post } from "../../lib/api";
import { useOp } from "../../lib/useOp";
import { currentCode, latest, useProject } from "../../state";
import type { PanelProps } from "../Workspace";
import { RegionSummary } from "./RegionSummary";

export function FindPanel({ region, onMatch, highlight }: PanelProps & { onMatch: (ids: string[]) => void; highlight: string[] }) {
  const { project: p } = useProject();
  const op = useOp();
  const ui_graph = latest(p.ui_graph)!;

  useEffect(() => {
    if (!region) return;
    onMatch([]);
    op.run("Matching region to UI graph", async () => {
      onMatch(await post<string[]>("p8/match", { ui_graph, subgraph_region: region, simulation_code: currentCode(p)!.html }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  return (
    <div className="panel">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />
      <RegionSummary region={region} />
      {op.busy && <Busy label={op.busy} />}
      {highlight.length > 0 && (
        <>
          <h4>Matching UI-graph nodes</h4>
          <ul>
            {highlight.map((id) => {
              const n = ui_graph.nodes.find((x) => x.id === id);
              return (
                <li key={id}>
                  <b>{n?.label ?? id}</b> <span className="tag">{n?.kind}</span>
                  <div className="small">{n?.description}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
