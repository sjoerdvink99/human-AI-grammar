import { useState } from "react";
import type { StepProps } from "../App.tsx";
import { ErrorNote, Panel, Spinner, SvgView } from "../components.tsx";
import { runProcess1, runProcess2, retryIllustration } from "../pipelines.ts";
import { conceptTitle } from "../tools/concepts.ts";

export default function IllustrateStep({ state, update, go }: StepProps) {
  const rounds = state.r8Rounds;
  const [viewRound, setViewRound] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [count, setCount] = useState(4);
  const round = rounds.find((r) => r.version === viewRound) ?? rounds.at(-1);
  const busy = state.r4Status === "pending" || rounds.some((r) => r.items.some((i) => i.status === "pending"));
  const pickedItem = rounds.flatMap((r) => r.items).find((i) => i.id === picked);

  const steer = () => {
    if (!state.r9.trim() || !state.r6) return;
    setViewRound(null);
    void runProcess2(state.r9, state.r5, state.r6, update, count);
  };

  // Process 3: human select r8_2* -> r11 (resets everything derived from a previous r11)
  const useIllustration = () => {
    if (!pickedItem?.svg) return;
    update((s) => ({
      ...s,
      r11: { svg: pickedItem.svg!, from: pickedItem.id },
      r12: [],
      r13: [],
      r13Version: 0,
      segStatus: undefined,
      r14: [],
      crops: [],
      r19: [],
      r21: undefined,
      r25: undefined,
      step: 2,
    }));
  };

  return (
    <div className="step">
      <h2>2 · Illustrate</h2>
      <div className="grid-side">
        <div>
          <Panel
            title="Candidate illustrations"
            tag={round ? `r8_${round.version} · visual*` : "r8 · visual*"}
            actions={
              rounds.length > 1 && (
                <div className="tabs">
                  {rounds.map((r) => (
                    <button key={r.version} className={r === round ? "active" : ""} onClick={() => setViewRound(r.version)}>
                      Round {r.version}
                    </button>
                  ))}
                </div>
              )
            }
          >
            {state.r4Status === "pending" && <Spinner label="Brainstorming themes (model_1)…" />}
            {state.r4Status === "error" && (
              <ErrorNote msg={state.r4Error ?? "Brainstorm failed"} onRetry={() => state.r1 && runProcess1(state.r1, update)} />
            )}
            {round?.steer && <p className="muted small">Direction: “{round.steer}”</p>}
            <div className="gallery">
              {round?.items.map((it) => (
                <div
                  key={it.id}
                  className={`card ${picked === it.id ? "picked" : ""} ${it.svg ? "clickable" : ""}`}
                  onClick={() => it.svg && setPicked(it.id)}
                  title={it.prompt}
                >
                  {it.status === "pending" && <Spinner label="Drawing (model_2)…" />}
                  {it.status === "error" && <ErrorNote msg={it.error ?? "failed"} onRetry={() => retryIllustration(update, round.id, it)} />}
                  {it.svg && <SvgView svg={it.svg} />}
                  <p className="caption">{it.prompt.split("\n")[0].replace(/^Create an illustration (for this concept|following the user's direction): /, "")}</p>
                </div>
              ))}
            </div>
            <div className="cta">
              <span className="muted">{pickedItem ? "Selected one illustration." : "Click an illustration to select it."}</span>
              <button className="primary" disabled={!pickedItem?.svg} onClick={useIllustration}>
                Use this illustration →
              </button>
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Steer the next round" tag="r9 · instruction">
            <textarea
              rows={4}
              placeholder="e.g. a market stall at dawn, crates of fruit, warm watercolour palette"
              value={state.r9}
              onChange={(e) => update((s) => ({ ...s, r9: e.target.value }))}
            />
            <div className="row gap">
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} images
                  </option>
                ))}
              </select>
              <button className="primary" disabled={!state.r9.trim() || !state.r6 || busy} onClick={steer}>
                {rounds.length > 1 ? "Generate again" : "Generate with my direction"}
              </button>
            </div>
            {state.r10 && (
              <details>
                <summary className="muted small">Composed prompt r10</summary>
                <pre className="prompt">{state.r10}</pre>
              </details>
            )}
          </Panel>
          <Panel title="Visual concepts" tag="r5 · language*">
            {state.r5.length === 0 && state.r4Status !== "error" && <Spinner label="waiting for model_1" />}
            <ol className="concepts">
              {state.r5.map((c) => (
                <li key={c}>
                  <b>{conceptTitle(c)}</b>
                  <span className="muted"> {c.slice(conceptTitle(c).length).replace(/^\s*[—–-]\s*/, "— ")}</span>
                </li>
              ))}
            </ol>
            {state.r4 && (
              <details>
                <summary className="muted small">Raw brainstorm r4</summary>
                <pre className="prompt">{state.r4}</pre>
              </details>
            )}
          </Panel>
          {state.r6 && (
            <Panel title="Data shape" tag="r6 · visual">
              <SvgView svg={state.r6.svg} />
            </Panel>
          )}
          {state.r3 && (
            <details className="panel">
              <summary className="muted small">Data description r3</summary>
              <pre className="prompt">{state.r3}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
