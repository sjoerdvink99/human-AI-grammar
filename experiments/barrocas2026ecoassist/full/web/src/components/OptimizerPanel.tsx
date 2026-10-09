import { useEffect, useState } from "react";
import type { OptimizerWeights } from "../../../shared/types.ts";
import { getOptimizer, startTraining, type TrainingStatus } from "../api.ts";

/** Process 1 status: optimizer_weights_1 and the offline training pipeline. */
export function OptimizerPanel() {
  const [weights, setWeights] = useState<OptimizerWeights | null>(null);
  const [training, setTraining] = useState<TrainingStatus | null>(null);
  const [pages, setPages] = useState(500);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await getOptimizer().catch(() => null);
      if (stop || !r) return;
      setWeights(r.weights);
      setTraining(r.training);
    };
    tick();
    const t = setInterval(tick, training?.running ? 1500 : 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [training?.running]);

  const ranked = weights ? Object.entries(weights.patternWeights).sort((a, b) => b[1].weight - a[1].weight) : [];
  const max = Math.max(0.0001, ...ranked.map(([, w]) => w.weight));

  return (
    <section className="panel">
      <h2>
        Energy optimizer <span className="muted small">model_2</span>
      </h2>
      {weights ? (
        <p className="small">
          Trained {new Date(weights.trainedAt).toLocaleString()} on <b>{weights.pagesProfiled}</b> profiled pages, <b>{weights.pairsUsed}</b> validated pairs.
        </p>
      ) : (
        <p className="small warn">Not trained yet. Run the offline pipeline below or <code>npm run train</code>.</p>
      )}
      {ranked.length > 0 && (
        <div className="weights">
          <div className="small muted">Learned pattern weights (measured energy cost)</div>
          {ranked.map(([id, w]) => (
            <div key={id} className="weight-row" title={`${w.description}\n≈${w.costJoules} J extra per page · n=${w.count} · toolchain saving ${w.ruleSavingsPercent}%`}>
              <span className="weight-name">{id}</span>
              <span className="weight-bar">
                <span style={{ width: `${(100 * w.weight) / max}%` }} />
              </span>
              <span className="weight-val">{w.weight.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Offline training pipeline
      </button>
      {open && (
        <div className="train-box">
          <p className="small muted">
            Profiles synthetic webpages in Chromium, applies the rule-based toolchain, measures energy before/after, keeps pairs that saved energy and still render the same, then
            refits the optimizer.
          </p>
          <label className="small">
            Pages{" "}
            <input type="number" min={1} max={2000} value={pages} onChange={(e) => setPages(Number(e.target.value))} style={{ width: 80 }} />
          </label>{" "}
          <button disabled={training?.running} onClick={() => startTraining(pages).then(() => setTraining({ running: true, message: "starting", done: 0, total: pages }))}>
            Run pipeline
          </button>
        </div>
      )}
      {training?.running && (
        <div className="small">
          <progress max={training.total} value={training.done} /> {training.done}/{training.total} — {training.message}
        </div>
      )}
      {training?.error && <div className="error">{training.error}</div>}
    </section>
  );
}
