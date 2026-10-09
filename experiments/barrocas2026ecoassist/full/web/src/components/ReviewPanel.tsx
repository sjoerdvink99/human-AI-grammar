import type { EnergyEstimate, OptimizeResponse } from "../../../shared/types.ts";
import { FILE_NAMES } from "../../../shared/types.ts";

/**
 * Process 3 review: savings_1 + diff_1 shown together;
 * [human select] → selected_edits_1 (hunk checkboxes); Apply triggers [tool_5 modify].
 */
export function ReviewPanel({
  result,
  selected,
  onToggle,
  onSetAll,
  onApply,
  onDiscard,
}: {
  result: OptimizeResponse;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (on: boolean) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { energyBefore, energyAfter, savings, diff } = result;
  const n = diff.hunks.length;
  return (
    <div className="review">
      <EnergyComparison before={energyBefore} after={energyAfter} percent={savings.percent} joules={savings.joules} />
      {n === 0 && <div className="warn small">The code is unchanged, so this energy difference is measurement noise.</div>}

      <div className="shots">
        <figure>
          <img src={`data:image/png;base64,${result.baselineRendering.screenshot}`} alt="Original rendering" />
          <figcaption>Original</figcaption>
        </figure>
        <figure>
          <img src={`data:image/png;base64,${result.optimizedRendering.screenshot}`} alt="Optimized rendering" />
          <figcaption>Optimized {result.optimizedRendering.consoleErrors.length > 0 && <span className="error-inline">· {result.optimizedRendering.consoleErrors.length} console errors</span>}</figcaption>
        </figure>
      </div>

      {result.explanation.length > 0 && (
        <details className="explain" open>
          <summary>Optimizer's changes</summary>
          <ul>
            {result.explanation.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="review-bar">
        <b>
          {selected.size}/{n}
        </b>{" "}
        changes accepted
        <span className="spacer" />
        <button onClick={() => onSetAll(true)}>Accept all</button>
        <button onClick={() => onSetAll(false)}>Reject all</button>
        <button onClick={onDiscard}>Discard</button>
        <button className="primary" disabled={n === 0} onClick={onApply}>
          Apply {selected.size} selected
        </button>
      </div>

      {n === 0 && <p className="muted">The optimizer returned identical code — nothing to review.</p>}
      <div className="hunks">
        {diff.hunks.map((h) => {
          const on = selected.has(h.id);
          return (
            <div key={h.id} className={`hunk ${on ? "accepted" : "rejected"}`}>
              <div className="hunk-head">
                <label>
                  <input type="checkbox" checked={on} onChange={() => onToggle(h.id)} /> {FILE_NAMES[h.file]} · line {h.oldStart}
                </label>
                <span className="muted small">
                  −{h.removed.length} +{h.added.length}
                </span>
              </div>
              <pre className="diff">
                {h.contextBefore.map((l, i) => (
                  <div key={`b${i}`} className="ctx"> {l}</div>
                ))}
                {h.removed.map((l, i) => (
                  <div key={`r${i}`} className="del">-{l}</div>
                ))}
                {h.added.map((l, i) => (
                  <div key={`a${i}`} className="add">+{l}</div>
                ))}
                {h.contextAfter.map((l, i) => (
                  <div key={`c${i}`} className="ctx"> {l}</div>
                ))}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EnergyComparison({ before, after, percent, joules }: { before: EnergyEstimate; after: EnergyEstimate; percent: number; joules: number }) {
  const max = Math.max(before.joules, after.joules, 1e-9);
  const row = (label: string, e: EnergyEstimate) => (
    <div className="energy-row">
      <span className="energy-label">{label}</span>
      <span className="energy-bar" title={`CPU ${e.cpuJoules.toFixed(2)} J · GPU ${e.gpuJoules.toFixed(2)} J · network ${e.networkJoules.toFixed(3)} J`}>
        <span className="seg cpu" style={{ width: `${(100 * e.cpuJoules) / max}%` }} />
        <span className="seg gpu" style={{ width: `${(100 * e.gpuJoules) / max}%` }} />
        <span className="seg net" style={{ width: `${(100 * e.networkJoules) / max}%` }} />
      </span>
      <span className="energy-val">{e.joules.toFixed(2)} J</span>
    </div>
  );
  const good = percent > 0;
  return (
    <div className="energy">
      <div className="energy-head">
        <span>Estimated energy (load + {before.windowMs / 1000}s, median of {before.runs})</span>
        <span className={good ? "saving good" : "saving bad"}>
          {good ? "−" : "+"}
          {Math.abs(percent).toFixed(1)}% ({Math.abs(joules).toFixed(2)} J)
        </span>
      </div>
      {row("Original", before)}
      {row("Optimized", after)}
      <div className="legend small muted">
        <span className="dot cpu" /> CPU <span className="dot gpu" /> GPU <span className="dot net" /> network · savings assume all changes are accepted
      </div>
    </div>
  );
}
