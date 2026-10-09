// (end_screen: artifact visual) — shown when tool_2 reports that every plot event is complete.
import type { RuntimeState, Vignette } from "../shared/types";

export default function EndScreen({ vignette: v, runtime, onRestart }: { vignette: Vignette; runtime: RuntimeState; onRestart: () => void }) {
  const dialogue = runtime.log.filter((l) => l.kind === "dialogue").length;
  const voices = runtime.log.filter((l) => l.kind === "inner_voice").length;
  return (
    <div className="end-screen">
      <h2>The End</h2>
      <h3>{v.title}</h3>
      <p className="muted">
        {runtime.tick} turns · {dialogue} lines of dialogue · {voices} inner-voice nudges
      </p>
      <ol>
        {v.events.map((e) => (
          <li key={e.id}>✓ {e.description}</li>
        ))}
      </ol>
      <details>
        <summary>Full transcript</summary>
        <div className="log">
          {runtime.log.map((l, i) => (
            <div key={i} className={`log-${l.kind}`}>
              <span className="tick">{l.tick}</span> {l.speaker && <b>{l.speaker}: </b>}
              {l.text}
            </div>
          ))}
        </div>
      </details>
      <button className="primary" onClick={onRestart}>
        Play again
      </button>
    </div>
  );
}
