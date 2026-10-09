import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { op } from './api';
import { Ctx, type AppCtx } from './context';
import { GRAPH_LEVELS, currentCode, emptyProject, latest, loadProject, saveProject, type Project } from './project';
import { GeneratePanel } from './components/GeneratePanel';
import { GraphEditor } from './components/GraphEditor';
import { SimulationView, type MarkMode } from './components/SimulationView';
import { AssumptionsPanel, ChatPanel, GuidedTestPanel, InspectPanel, RedrawPanel, TestsPanel } from './components/ToolPanels';
import { CodeView } from './components/CodeView';
import { SIM_WIDTH, type Graph, type GraphLevel, type Region, type Subgraph, type TestAssessment, type TestCase, type TestResult } from '../shared/types';

type ToolTab = 'tests' | 'guided' | 'chat' | 'assumptions' | 'redraw' | 'inspect' | 'code';
const TOOL_TABS: { key: ToolTab; title: string }[] = [
  { key: 'tests', title: 'Auto tests' },
  { key: 'guided', title: 'Guided test' },
  { key: 'chat', title: 'Chat' },
  { key: 'assumptions', title: 'Assumptions' },
  { key: 'redraw', title: 'Redraw' },
  { key: 'inspect', title: 'Inspect' },
  { key: 'code', title: 'Code' },
];

export default function App() {
  const [project, setProjectState] = useState<Project>(loadProject);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphTab, setGraphTab] = useState<GraphLevel>('concept_graph');
  const [graphVersionView, setGraphVersionView] = useState<number | null>(null);
  const [toolTab, setToolTab] = useState<ToolTab>('tests');
  const [markMode, setMarkMode] = useState<MarkMode>(null);
  const [regions, setRegions] = useState<Record<'chat' | 'redraw' | 'inspect', Region | null>>({ chat: null, redraw: null, inspect: null });
  const [subgraph, setSubgraph] = useState<Subgraph | null>(null);
  const [selectedUiNode, setSelectedUiNode] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null) as React.RefObject<HTMLIFrameElement>;
  const simColRef = useRef<HTMLDivElement>(null);
  const [simScale, setSimScale] = useState(0.65);

  const setProject = useCallback((fn: (p: Project) => Project) => setProjectState(fn), []);
  useEffect(() => saveProject(project), [project]);

  useLayoutEffect(() => {
    const el = simColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSimScale(Math.min(1, (el.clientWidth - 2) / SIM_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const log = useCallback((msg: string) => setProjectState((p) => ({ ...p, log: [...p.log.slice(-200), { t: Date.now(), msg }] })), []);

  const busyRef = useRef<string | null>(null);
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = label;
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`${label}: ${(e as Error).message}`);
      log(`error — ${label}: ${(e as Error).message}`);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, [log]);

  const addCode = useCallback((labelBase: string, html: string, note: string) => {
    const id = `code_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setProjectState((p) => {
      const label = `${labelBase}_${p.simulation_code.length + 1}`;
      return {
        ...p,
        simulation_code: [...p.simulation_code, { id, label, html, note, createdAt: Date.now() }],
        current_code_id: id,
        log: [...p.log, { t: Date.now(), msg: `${label}: ${note}` }],
      };
    });
    setReloadKey((k) => k + 1);
  }, []);

  const addGraphVersion = useCallback((level: GraphLevel, g: Graph) => {
    setProjectState((p) => ({ ...p, [level]: [...p[level], g], log: [...p.log, { t: Date.now(), msg: `${level}_${p[level].length + 1} saved` }] }));
    setGraphVersionView(null);
  }, []);

  const showGraph = useCallback((level: GraphLevel) => {
    setGraphTab(level);
    setGraphVersionView(null);
  }, []);

  /** Process 3 — Automated Simulation Testing and Repair (runs after code generation). */
  const runAutomatedTesting = useCallback(async (code_1: string, ui_graph: Graph, learning_goal: string) => {
    setToolTab('tests');
    setProjectState((p) => ({ ...p, javascript_errors: [], test_cases: [], test_results: [], test_screenshots: [], test_assessment: null }));
    let code = code_1;
    // [tool_2 execute] -> javascript_errors*; [model modify]~ -> simulation_code_2 (up to 2 rounds)
    for (let round = 0; round < 3; round++) {
      setBusy('Running code in headless browser');
      const { javascript_errors } = await op<{ javascript_errors: string[] }>('runForErrors', { simulation_code: code });
      setProjectState((p) => ({ ...p, javascript_errors }));
      if (!javascript_errors.length || round === 2) break;
      setBusy(`Fixing ${javascript_errors.length} JavaScript error(s)`);
      const { simulation_code } = await op<{ simulation_code: string }>('fixJavascriptErrors', { simulation_code: code, ui_graph, learning_goal, javascript_errors });
      addCode('simulation_code', simulation_code, 'JavaScript errors fixed');
      code = simulation_code;
    }
    // [model generate]~ -> test_cases*
    setBusy('Generating interaction tests');
    const { test_cases } = await op<{ test_cases: TestCase[] }>('generateTestCases', { simulation_code: code, ui_graph, learning_goal });
    setProjectState((p) => ({ ...p, test_cases }));
    // [tool_2 execute] -> test_results* + test_screenshots*
    setBusy(`Running ${test_cases.length} tests in headless browser`);
    const run = await op<{ test_results: TestResult[]; test_screenshots: { test_id: string; dataUrl: string }[] }>('runTests', { simulation_code: code, test_cases });
    setProjectState((p) => ({ ...p, ...run }));
    // [model evaluate]~ -> test_assessment
    setBusy('Checking results against the learning goal');
    const { test_assessment } = await op<{ test_assessment: TestAssessment }>('evaluateTestResults', { simulation_code: code, ui_graph, learning_goal, test_cases, ...run });
    setProjectState((p) => ({ ...p, test_assessment }));
    // [model modify]~ -> simulation_code_3 (only when necessary)
    if (!test_assessment.meets_goal) {
      setBusy('Correcting the code');
      const { simulation_code } = await op<{ simulation_code: string }>('repairFromAssessment', { simulation_code: code, ui_graph, test_cases, test_assessment });
      addCode('simulation_code', simulation_code, 'corrected after test assessment');
    } else {
      log('assessment: learning goal met, no correction needed');
    }
    // [tool_1 execute] -> simulation
    setReloadKey((k) => k + 1);
  }, [addCode, log]);

  const onRegion = (r: Region) => {
    if (!markMode) return;
    const mode = markMode;
    setRegions((x) => ({ ...x, [mode]: r }));
    setMarkMode(null);
    if (mode === 'inspect') {
      // P8: [human select] subgraph_region -> [model match] subgraph
      setSubgraph(null);
      void run('Matching region to UI Graph', async () => {
        const { subgraph: s } = await op<{ subgraph: Subgraph }>('matchSubgraph', {
          subgraph_region: r, ui_graph: latest(project.ui_graph), simulation_code: currentCode(project)!.html,
        });
        setSubgraph(s);
        showGraph('ui_graph');
      });
    }
  };

  const ctx: AppCtx = {
    project, setProject, busy, run, log, addCode, addGraphVersion, frameRef,
    reloadSimulation: () => setReloadKey((k) => k + 1),
    markMode, setMarkMode, selectedUiNode, setSubgraph, showGraph, runAutomatedTesting,
  };

  const versions = project[graphTab];
  const viewIndex = graphVersionView ?? versions.length - 1;
  const graph = versions[viewIndex];
  const code = currentCode(project);
  const activeRegion = toolTab === 'chat' ? regions.chat : toolTab === 'redraw' ? regions.redraw : toolTab === 'inspect' ? regions.inspect : null;

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'simulation-project.json';
    a.click();
  };
  const importProject = (f: File) => f.text().then((t) => setProjectState({ ...emptyProject(), ...JSON.parse(t) }));

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header>
          <h1>System X <span>simulation authoring</span></h1>
          <div className="status">{busy ? <><span className="spinner" /> {busy}…</> : 'Ready'}</div>
          <div className="row">
            <button onClick={() => { if (confirm('Start a new project? The current one will be discarded.')) { setProjectState(emptyProject()); setSubgraph(null); setRegions({ chat: null, redraw: null, inspect: null }); } }}>New</button>
            <button onClick={exportProject}>Export</button>
            <label className="button">Import<input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importProject(e.target.files[0])} /></label>
          </div>
        </header>
        {error && <div className="error" onClick={() => setError(null)}>{error} <span className="hint">(click to dismiss)</span></div>}
        <main>
          <div className="col left"><GeneratePanel /></div>

          <div className="col center">
            <nav className="tabs">
              {GRAPH_LEVELS.map((l) => (
                <button key={l.key} className={graphTab === l.key ? 'on' : ''} disabled={!project[l.key].length} onClick={() => showGraph(l.key)}>
                  {l.title}{project[l.key].length > 1 ? ` (v${project[l.key].length})` : ''}
                </button>
              ))}
              {versions.length > 1 && (
                <select value={viewIndex} onChange={(e) => setGraphVersionView(Number(e.target.value))}>
                  {versions.map((_, i) => <option key={i} value={i}>{graphTab}_{i + 1}{i === versions.length - 1 ? ' (current)' : ''}</option>)}
                </select>
              )}
            </nav>
            {graph ? (
              <GraphEditor
                key={`${graphTab}-${viewIndex}`}
                graph={graph}
                version={viewIndex + 1}
                idPrefix={graphTab === 'ui_graph' ? 'ui' : 'n'}
                readOnly={viewIndex !== versions.length - 1}
                highlight={graphTab === 'ui_graph' ? subgraph : null}
                onSave={(g) => addGraphVersion(graphTab, g)}
                onSelectNode={graphTab === 'ui_graph' ? (id) => { setSelectedUiNode(id); if (id && toolTab !== 'assumptions') setToolTab('assumptions'); } : undefined}
              />
            ) : (
              <div className="empty">Graphs appear here as they are generated. Start by entering learning content on the left.</div>
            )}
            <div className="log">
              {project.log.slice(-6).map((l, i) => <div key={i}>{new Date(l.t).toLocaleTimeString()} — {l.msg}</div>)}
            </div>
          </div>

          <div className="col right" ref={simColRef}>
            <div className="code-bar">
              <b>Simulation</b>
              {project.simulation_code.length > 0 && (
                <select value={code?.id} onChange={(e) => { setProjectState((p) => ({ ...p, current_code_id: e.target.value })); setReloadKey((k) => k + 1); }}>
                  {project.simulation_code.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.note}</option>)}
                </select>
              )}
              {code && <button onClick={() => setReloadKey((k) => k + 1)}>Reload</button>}
            </div>
            {code ? (
              <SimulationView ref={frameRef} html={code.html} reloadKey={reloadKey} mode={markMode} region={activeRegion} onRegion={onRegion} scale={simScale} />
            ) : (
              <div className="empty sim-empty">The simulation appears here once code is generated.</div>
            )}
            <nav className="tabs">
              {TOOL_TABS.map((t) => (
                <button key={t.key} className={toolTab === t.key ? 'on' : ''} onClick={() => { setToolTab(t.key); setMarkMode(null); }}>{t.title}</button>
              ))}
            </nav>
            <div className="tool-body">
              {!code && toolTab !== 'tests' ? <p className="hint">Available after the simulation is generated.</p> : (
                <>
                  {toolTab === 'tests' && <TestsPanel />}
                  {toolTab === 'guided' && <GuidedTestPanel />}
                  {toolTab === 'chat' && <ChatPanel region={regions.chat} clearRegion={() => setRegions((x) => ({ ...x, chat: null }))} />}
                  {toolTab === 'assumptions' && <AssumptionsPanel />}
                  {toolTab === 'redraw' && <RedrawPanel region={regions.redraw} />}
                  {toolTab === 'inspect' && <InspectPanel region={regions.inspect} subgraph={subgraph} />}
                  {toolTab === 'code' && code && <CodeView html={code.html} label={code.label} />}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </Ctx.Provider>
  );
}
