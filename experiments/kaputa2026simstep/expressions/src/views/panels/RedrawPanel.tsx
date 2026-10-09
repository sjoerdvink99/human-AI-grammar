// Process 7: region -> sketch -> model translates sketch to SVG -> model integrates SVG into code
// (simulation_code_redrawn_N) -> tool_1 renders the redrawn simulation.
import { useEffect, useState } from "react";
import { Busy, ErrorBox } from "../../components/Status";
import { post } from "../../lib/api";
import { useOp } from "../../lib/useOp";
import { currentCode, useProject } from "../../state";
import type { PanelProps } from "../Workspace";
import { RegionSummary } from "./RegionSummary";

interface Props extends PanelProps {
  sketch: string | null;
  sketching: boolean;
  startSketch: () => void;
}

export function RedrawPanel({ region, sketch, sketching, startSketch, commitCode }: Props) {
  const { project: p } = useProject();
  const op = useOp();
  const [svg, setSvg] = useState<string | null>(null);
  const code = currentCode(p)!;

  useEffect(() => {
    if (!sketch || !region) return;
    setSvg(null);
    op.run("Redrawing", async () => {
      const replacement_svg = await post<string>("p7/svg", { sketch, redraw_region: region });
      setSvg(replacement_svg);
      const html = await post<string>("p7/integrate", { simulation_code: code.html, replacement_svg, redraw_region: region });
      commitCode("redrawn", html, `redrawn region ${region.w}×${region.h} at (${region.x}, ${region.y})`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch]);

  return (
    <div className="panel">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />
      <RegionSummary region={region} />
      {region && !sketching && !op.busy && (
        <button className="primary" onClick={startSketch}>
          ✎ Sketch a replacement in this region
        </button>
      )}
      {sketching && <p className="hint">Draw in the white box on the simulation, then press “Use sketch”.</p>}
      {op.busy && <Busy label={op.busy} />}
      <div className="grid2">
        {sketch && (
          <figure>
            <img src={sketch} alt="sketch" className="preview" />
            <figcaption>sketch</figcaption>
          </figure>
        )}
        {svg && (
          <figure>
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="replacement svg" className="preview" />
            <figcaption>replacement SVG</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
