// Process 1 — Generate Interactive Simulation.
import { useState } from 'react';
import { op } from '../api';
import { useApp } from '../context';
import { latest, type Project } from '../project';
import type { ExperimentFactors, Graph } from '../../shared/types';

const EXAMPLE =
  "Newton's second law: the acceleration of an object depends on the net force acting on it and on its mass (F = m·a). " +
  'Friction opposes motion. Grade 9 physics.';

export function GeneratePanel() {
  const { project: p, setProject, run, log, busy, showGraph, addCode, runAutomatedTesting } = useApp();
  const [content, setContent] = useState(p.learning_content);
  const [scenarioPick, setScenarioPick] = useState<string | null>(p.scenario);
  const [goalPick, setGoalPick] = useState<string | null>(p.learning_goal);

  // P1: [model translate]~ learning_content -> concept_graph, then [model generate]~ -> scenarios*
  const startFromContent = () =>
    run('Building concept graph', async () => {
      const learning_content = content.trim();
      if (!learning_content) throw new Error('Enter some learning content first.');
      const { concept_graph } = await op<{ concept_graph: Graph }>('translateConceptGraph', { learning_content });
      setProject(() => ({ ...emptyAfterContent(), learning_content, concept_graph: [concept_graph] }));
      showGraph('concept_graph');
      log('concept_graph_1 generated');
      await suggestScenarios(concept_graph);
    });

  const suggestScenarios = async (concept_graph: Graph) => {
    const { scenarios } = await op<{ scenarios: string[] }>('generateScenarios', { concept_graph });
    setProject((x) => ({ ...x, scenarios }));
    log(`${scenarios.length} scenarios suggested`);
  };

  // P1: [human select] scenario, then [model translate]~ -> scenario_graph, [model generate]~ -> learning_goals*
  const chooseScenario = (scenario: string) =>
    run('Building scenario graph', async () => {
      const concept_graph = latest(p.concept_graph)!;
      setProject((x) => ({ ...x, scenario, scenario_graph: [], learning_goals: [], learning_goal: null, ...clearAfterGoal() }));
      const { scenario_graph } = await op<{ scenario_graph: Graph }>('translateScenarioGraph', { concept_graph, scenario });
      setProject((x) => ({ ...x, scenario_graph: [scenario_graph] }));
      showGraph('scenario_graph');
      log('scenario_graph_1 generated');
      const { learning_goals } = await op<{ learning_goals: string[] }>('generateLearningGoals', { scenario_graph });
      setProject((x) => ({ ...x, learning_goals }));
    });

  // P1: [human select] learning_goal, then the model chain up to simulation_code_1, then process 3.
  const chooseGoal = (learning_goal: string, from = 0) =>
    run('Designing simulation', async () => {
      let cur: Project = p;
      const set = (patch: Partial<Project>) => {
        cur = { ...cur, ...patch };
        setProject((x) => ({ ...x, ...patch }));
      };
      if (from === 0) set({ learning_goal, ...clearAfterGoal() });
      const scenario_graph = latest(cur.scenario_graph)!;
      if (from <= 0) {
        const { learning_goal_graph } = await op<{ learning_goal_graph: Graph }>('selectLearningGoalGraph', { scenario_graph, learning_goal });
        set({ learning_goal_graph: [learning_goal_graph] });
        showGraph('learning_goal_graph');
      }
      const learning_goal_graph = latest(cur.learning_goal_graph)!;
      if (from <= 1) {
        const { experiment_factors } = await op<{ experiment_factors: ExperimentFactors }>('extractExperimentFactors', { learning_goal_graph, learning_goal });
        set({ experiment_factors });
      }
      if (from <= 2) {
        const { procedure } = await op<{ procedure: string }>('generateProcedure', { learning_goal_graph, learning_goal, experiment_factors: cur.experiment_factors });
        set({ procedure });
      }
      if (from <= 3) {
        const { ui_graph } = await op<{ ui_graph: Graph }>('generateUiGraph', { learning_goal_graph, learning_goal, procedure: cur.procedure });
        set({ ui_graph: [ui_graph] });
        showGraph('ui_graph');
      }
      const ui_graph = latest(cur.ui_graph)!;
      const { simulation_code } = await op<{ simulation_code: string }>('translateSimulationCode', { ui_graph, learning_goal });
      addCode('simulation_code', simulation_code, 'generated from UI graph');
      log('simulation_code_1 generated — starting automated testing');
      await runAutomatedTesting(simulation_code, ui_graph, learning_goal);
    });

  const step = (n: number, title: string, done: boolean, body: React.ReactNode) => (
    <section className={`step ${done ? 'done' : ''}`}>
      <h3><span className="badge">{n}</span>{title}</h3>
      {body}
    </section>
  );

  return (
    <div className="pipeline">
      {step(1, 'Learning content', p.concept_graph.length > 0, (
        <>
          <textarea rows={5} value={content} placeholder="Paste the topic or text you want to teach…" onChange={(e) => setContent(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={startFromContent}>Generate concept graph</button>
            {!content && <button onClick={() => setContent(EXAMPLE)}>Use example</button>}
          </div>
        </>
      ))}

      {p.concept_graph.length > 0 && step(2, 'Teaching scenario', !!p.scenario, (
        <>
          <p className="hint">Review and edit the Concept Graph (centre) before choosing a scenario.</p>
          <ChoiceList items={p.scenarios} value={scenarioPick} onChange={setScenarioPick} />
          <div className="row">
            <button className="primary" disabled={!!busy || !scenarioPick} onClick={() => chooseScenario(scenarioPick!)}>Use scenario</button>
            <button disabled={!!busy} onClick={() => run('Suggesting scenarios', () => suggestScenarios(latest(p.concept_graph)!))}>Regenerate suggestions</button>
          </div>
        </>
      ))}

      {p.scenario_graph.length > 0 && step(3, 'Learning goal', !!p.learning_goal, (
        <>
          <ChoiceList items={p.learning_goals} value={goalPick} onChange={setGoalPick} />
          <div className="row">
            <button className="primary" disabled={!!busy || !goalPick} onClick={() => chooseGoal(goalPick!)}>Use goal &amp; build simulation</button>
            <button disabled={!!busy} onClick={() => run('Suggesting goals', async () => {
              const { learning_goals } = await op<{ learning_goals: string[] }>('generateLearningGoals', { scenario_graph: latest(p.scenario_graph) });
              setProject((x) => ({ ...x, learning_goals }));
            })}>Regenerate goals</button>
          </div>
        </>
      ))}

      {p.learning_goal && step(4, 'Experiment design', !!p.procedure, (
        <>
          {p.experiment_factors ? <FactorsView f={p.experiment_factors} /> : <p className="hint">Waiting for experiment factors…</p>}
          {p.procedure && <><h4>Procedure</h4><pre className="procedure">{p.procedure}</pre></>}
          {p.ui_graph.length > 0 && (
            <div className="row">
              <button disabled={!!busy} onClick={() => chooseGoal(p.learning_goal!, 1)} title="re-run from experiment factors using the current Learning Goal Graph">Regenerate design</button>
              <button disabled={!!busy} onClick={() => chooseGoal(p.learning_goal!, 4)} title="regenerate code from the current (edited) UI Graph">Regenerate code from UI Graph</button>
            </div>
          )}
        </>
      ))}
    </div>
  );

  function emptyAfterContent(): Partial<Project> & Project {
    return { ...p, scenarios: [], scenario: null, scenario_graph: [], learning_goals: [], learning_goal: null, ...clearAfterGoal() } as Project;
  }
}

function clearAfterGoal(): Partial<Project> {
  return {
    learning_goal_graph: [], experiment_factors: null, procedure: null, ui_graph: [], simulation_code: [], current_code_id: null,
    javascript_errors: [], test_cases: [], test_results: [], test_screenshots: [], test_assessment: null,
  };
}

function ChoiceList({ items, value, onChange }: { items: string[]; value: string | null; onChange: (v: string) => void }) {
  if (!items.length) return <p className="hint">Generating suggestions…</p>;
  return (
    <div className="choices">
      {items.map((it) => (
        <label key={it} className={`choice ${value === it ? 'on' : ''}`}>
          <input type="radio" checked={value === it} onChange={() => onChange(it)} />
          <span>{it}</span>
        </label>
      ))}
    </div>
  );
}

function FactorsView({ f }: { f: ExperimentFactors }) {
  const group = (title: string, xs: ExperimentFactors['independent']) => (
    <div className="factor-group">
      <h4>{title}</h4>
      {xs.length === 0 ? <span className="hint">none</span> : (
        <ul>{xs.map((x) => <li key={x.name} title={x.description}><b>{x.name}</b>{x.range ? ` — ${x.range}` : ''}{x.unit ? ` ${x.unit}` : ''}</li>)}</ul>
      )}
    </div>
  );
  return (
    <div className="factors">
      {group('Change (independent)', f.independent)}
      {group('Observe (dependent)', f.dependent)}
      {group('Keep constant', f.controlled)}
    </div>
  );
}
