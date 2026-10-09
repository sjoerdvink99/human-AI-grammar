// Process 1 (authoring wizard), with process 2 (concept graph editing) and process 3 (verify & repair).
import { useState } from "react";
import type { Graph } from "../../shared/types";
import { GraphEditor } from "../components/GraphEditor";
import { GraphView } from "../components/GraphView";
import { post } from "../lib/api";
import { runGoalChain, runVerify } from "../lib/pipeline";
import { useOp } from "../lib/useOp";
import { latest, useProject } from "../state";
import { Busy, ErrorBox } from "../components/Status";

const CHAIN_STEPS: [string, string][] = [
  ["learning_goal_graph", "model select → learning-goal graph"],
  ["experiment_factors", "model extract → experiment factors"],
  ["procedure", "model generate → procedure"],
  ["ui_graph", "model generate → UI graph"],
  ["simulation_code_1", "model translate → simulation code 1"],
];
const VERIFY_STEPS: [string, string][] = [
  ["javascript_errors", "headless run → JavaScript errors"],
  ["simulation_code_2", "model modify → fix errors (code 2)"],
  ["test_cases", "model generate → test cases"],
  ["test_results", "headless run → test results + screenshots"],
  ["test_assessment", "model evaluate → assessment"],
  ["simulation_code_3", "model modify → repair (code 3)"],
  ["simulation", "render simulation"],
];

const SAMPLE = `Buoyancy. When an object is placed in a fluid, the fluid exerts an upward force on it called the buoyant force. Archimedes' principle states that the buoyant force equals the weight of the fluid displaced by the object. Whether an object floats or sinks depends on its density compared to the density of the fluid: objects denser than the fluid sink, less dense objects float. A floating object sinks until it displaces its own weight of fluid. Density is mass divided by volume. Salt water is denser than fresh water, so objects float higher in it.`;

function Steps({ steps, current, done }: { steps: [string, string][]; current: string | null; done: (k: string) => boolean }) {
  return (
    <ol className="steps">
      {steps.map(([k, label]) => (
        <li key={k} className={current === k ? "running" : done(k) ? "done" : ""}>
          {current === k ? "⏳" : done(k) ? "✓" : "○"} {label}
        </li>
      ))}
    </ol>
  );
}

export function Authoring({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { project: p, update } = useProject();
  const op = useOp();
  const [step, setStep] = useState<string | null>(null);
  const concept_graph = latest(p.concept_graph);

  // ---- model translate: learning_content_1 -> concept_graph_1
  const buildConceptGraph = () =>
    op.run("Building concept graph", async () => {
      const g = await post<Graph>("p1/concept-graph", { learning_content: p.learning_content });
      update({ concept_graph: [g], scenarios: undefined, scenario: undefined, scenario_graph: undefined, learning_goals: undefined, learning_goal: undefined });
    });

  // ---- process 2: human modify concept_graph_1 -> concept_graph_2 (edits keep v1 for reset)
  const editConceptGraph = (g: Graph) => update((s) => ({ concept_graph: [s.concept_graph[0], g] }));

  // ---- model generate: concept_graph -> scenarios_1*
  const genScenarios = () =>
    op.run("Generating scenarios", async () => {
      const scenarios = await post<string[]>("p1/scenarios", { concept_graph });
      update({ scenarios, scenario: undefined, scenario_graph: undefined, learning_goals: undefined, learning_goal: undefined });
    });

  // ---- human select scenario -> model translate (scenario_graph) -> model generate (learning_goals*)
  const pickScenario = (scenario: string) =>
    op.run("Building scenario graph", async () => {
      update({ scenario, scenario_graph: undefined, learning_goals: undefined, learning_goal: undefined, learning_goal_graph: undefined });
      const scenario_graph = await post<Graph>("p1/scenario-graph", { concept_graph, scenario });
      update({ scenario_graph });
      const learning_goals = await post<string[]>("p1/learning-goals", { scenario_graph });
      update({ learning_goals });
    });
  const regenGoals = () =>
    op.run("Generating learning goals", async () => {
      update({ learning_goals: await post<string[]>("p1/learning-goals", { scenario_graph: p.scenario_graph }), learning_goal: undefined });
    });

  // ---- human select learning goal -> rest of process 1 -> process 3 (automatic)
  const pickGoal = (learning_goal: string) =>
    op.run("Designing the simulation", async () => {
      update({
        learning_goal,
        learning_goal_graph: undefined,
        experiment_factors: undefined,
        procedure: undefined,
        ui_graph: [],
        simulation_code: [],
        current_code_id: undefined,
        test_cases: undefined,
        test_assessment: undefined,
        javascript_errors: undefined,
        test_results: undefined,
        test_screenshots: undefined,
      });
      const { ui_graph, simulation_code } = await runGoalChain(p.scenario_graph!, learning_goal, update, setStep);
      await runVerify(simulation_code, ui_graph, learning_goal, update, setStep);
      setStep(null);
    });

  const rerunVerify = () =>
    op.run("Verifying the simulation", async () => {
      const c1 = p.simulation_code.find((c) => c.id === "simulation_code_1")!;
      await runVerify(c1.html, p.ui_graph[0], p.learning_goal!, update, setStep);
      setStep(null);
    });

  const has = (k: string) => {
    if (k === "simulation" || k === "simulation_code_3") return p.verified;
    if (k === "ui_graph") return p.ui_graph.length > 0;
    if (k.startsWith("simulation_code_")) return p.simulation_code.some((c) => c.id === k);
    return (p as unknown as Record<string, unknown>)[k] !== undefined;
  };

  return (
    <div className="authoring">
      <ErrorBox error={op.error} onRetry={op.retry ?? undefined} />

      <section className="card">
        <h2>1 · Learning content</h2>
        <textarea rows={7} value={p.learning_content} placeholder="Paste a lesson, textbook passage or curriculum text…" onChange={(e) => update({ learning_content: e.target.value })} />
        <div className="row">
          <button className="primary" disabled={!p.learning_content.trim() || !!op.busy} onClick={buildConceptGraph}>
            {concept_graph ? "Rebuild concept graph" : "Build concept graph"}
          </button>
          {!p.learning_content && <button onClick={() => update({ learning_content: SAMPLE })}>Use sample (buoyancy)</button>}
        </div>
        {op.busy === "Building concept graph" && <Busy label={op.busy} />}
      </section>

      {concept_graph && (
        <section className="card">
          <h2>
            2 · Concept graph <small>{p.concept_graph.length > 1 ? "concept_graph_2 (edited)" : "concept_graph_1"}</small>
          </h2>
          <GraphEditor graph={concept_graph} onChange={editConceptGraph} />
          <div className="row">
            {p.concept_graph.length > 1 && <button onClick={() => update((s) => ({ concept_graph: [s.concept_graph[0]] }))}>Revert to generated graph</button>}
            <button className="primary" disabled={!!op.busy} onClick={genScenarios}>
              {p.scenarios ? "Regenerate scenarios" : "Generate scenarios"}
            </button>
          </div>
          {op.busy === "Generating scenarios" && <Busy label={op.busy} />}
        </section>
      )}

      {p.scenarios && (
        <section className="card">
          <h2>3 · Choose a scenario</h2>
          <div className="choices">
            {p.scenarios.map((s, i) => (
              <button key={i} className={`choice ${p.scenario === s ? "on" : ""}`} disabled={!!op.busy} onClick={() => pickScenario(s)}>
                {s}
              </button>
            ))}
          </div>
          {op.busy === "Building scenario graph" && <Busy label={op.busy} />}
        </section>
      )}

      {p.scenario_graph && (
        <section className="card">
          <h2>4 · Scenario graph &amp; learning goal</h2>
          <GraphView graph={p.scenario_graph} highlighted={p.learning_goal_graph?.nodes.map((n) => n.id)} />
          {p.learning_goals && (
            <>
              <h3>Choose a learning goal</h3>
              <div className="choices">
                {p.learning_goals.map((g, i) => (
                  <button key={i} className={`choice ${p.learning_goal === g ? "on" : ""}`} disabled={!!op.busy} onClick={() => pickGoal(g)}>
                    {g}
                  </button>
                ))}
              </div>
              <button disabled={!!op.busy} onClick={regenGoals}>
                Regenerate learning goals
              </button>
            </>
          )}
          {op.busy === "Generating learning goals" && <Busy label={op.busy} />}
        </section>
      )}

      {p.learning_goal && (
        <section className="card">
          <h2>5 · Simulation design</h2>
          <Steps steps={CHAIN_STEPS} current={step} done={has} />
          <div className="grid2">
            {p.experiment_factors && (
              <div>
                <h3>Experiment factors</h3>
                <table className="factors">
                  <thead>
                    <tr>
                      <th>role</th>
                      <th>variable</th>
                      <th>unit</th>
                      <th>range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["independent_variables", "dependent_variables", "controlled_variables"] as const).flatMap((k) =>
                      p.experiment_factors![k].map((v, i) => (
                        <tr key={k + i} title={v.description}>
                          <td>{k.split("_")[0]}</td>
                          <td>{v.name}</td>
                          <td>{v.unit}</td>
                          <td>{v.min != null || v.max != null ? `${v.min ?? ""}–${v.max ?? ""} (${v.default ?? ""})` : v.default ?? ""}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {p.procedure && (
              <div>
                <h3>Procedure</h3>
                <pre className="prose">{p.procedure}</pre>
              </div>
            )}
          </div>
          {p.ui_graph[0] && (
            <>
              <h3>UI graph</h3>
              <GraphView graph={p.ui_graph[0]} direction="TB" height={320} />
            </>
          )}
        </section>
      )}

      {p.simulation_code.length > 0 && (
        <section className="card">
          <h2>6 · Verify &amp; repair</h2>
          <Steps steps={VERIFY_STEPS} current={step} done={has} />
          {p.javascript_errors && (
            <details open={p.javascript_errors.length > 0}>
              <summary>JavaScript errors ({p.javascript_errors.length})</summary>
              <ul className="errors">{p.javascript_errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
          {p.test_cases && (
            <div className="tests-grid">
              {p.test_cases.map((t, i) => {
                const r = p.test_results?.find((x) => x.test_id === t.id);
                const shot = p.test_screenshots?.[i];
                return (
                  <div key={t.id} className="test-card">
                    <b>{t.title}</b>
                    <div className="small">{t.expected}</div>
                    {r && (r.step_errors.length || r.console_errors.length ? <div className="error small">{[...r.step_errors, ...r.console_errors].join(" · ")}</div> : <div className="ok small">ran without errors</div>)}
                    {shot && <img src={shot} alt={`screenshot ${t.id}`} />}
                  </div>
                );
              })}
            </div>
          )}
          {p.test_assessment && (
            <details open>
              <summary>Model assessment</summary>
              <pre className="prose">{p.test_assessment}</pre>
            </details>
          )}
          <div className="row">
            {p.verified && (
              <button className="primary" onClick={onOpenWorkspace}>
                Open simulation workspace →
              </button>
            )}
            {!op.busy && p.simulation_code.some((c) => c.id === "simulation_code_1") && <button onClick={rerunVerify}>Re-run verification</button>}
          </div>
        </section>
      )}
      {op.busy && <div className="busy-bar">⏳ {op.busy}{step ? ` — ${step}` : ""}…</div>}
    </div>
  );
}
