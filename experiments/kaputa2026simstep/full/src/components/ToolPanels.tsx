// Panels for processes 3–8. All of them start from the current simulation code version.
import { useEffect, useState } from 'react';
import { op } from '../api';
import { useApp } from '../context';
import { currentCode, latest } from '../project';
import { applyGraphOps } from '../lib/graph';
import { playTestInIframe } from '../lib/runner';
import { SketchPad } from './SketchPad';
import {
  UI_TEST_FEEDBACK,
  type GraphChange,
  type GraphOp,
  type Region,
  type Repair,
  type RepairTarget,
  type Subgraph,
  type TestCase,
  type UiTestFeedback,
} from '../../shared/types';

const FEEDBACK_LABEL: Record<UiTestFeedback, string> = {
  as_expected: '✓ Works as expected',
  no_response: 'Nothing happened',
  wrong_behavior: 'Wrong behaviour / values',
  wrong_visual: 'Looks wrong',
  layout_problem: 'Layout problem',
};
const TARGET_LABEL: Record<RepairTarget, string> = {
  concept_graph: 'Concept Graph',
  scenario_graph: 'Scenario Graph',
  learning_goal_graph: 'Learning Goal Graph',
  ui_graph: 'UI Graph',
  code: 'Code only',
};

// ---------------------------------------------------------------- P3

export function TestsPanel() {
  const { project: p, busy, run, runAutomatedTesting } = useApp();
  const code = currentCode(p);
  const shot = (id: string) => p.test_screenshots.find((s) => s.test_id === id)?.dataUrl;
  return (
    <div className="panel">
      <div className="row">
        <button disabled={!!busy || !code || !p.ui_graph.length} onClick={() => run('Automated testing', () => runAutomatedTesting(code!.html, latest(p.ui_graph)!, p.learning_goal!))}>
          Re-run automated testing on current code
        </button>
      </div>
      {p.javascript_errors.length > 0 && (
        <div className="box warn"><b>JavaScript errors found</b><ul>{p.javascript_errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      {p.test_assessment && (
        <div className={`box ${p.test_assessment.meets_goal ? 'ok' : 'warn'}`}>
          <b>{p.test_assessment.meets_goal ? 'Meets the learning goal' : 'Does not yet meet the learning goal'}</b>
          <p>{p.test_assessment.summary}</p>
          {p.test_assessment.problems.length > 0 && <ul>{p.test_assessment.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
      {p.test_cases.map((t) => {
        const r = p.test_results.find((x) => x.test_id === t.id);
        const s = shot(t.id);
        return (
          <details key={t.id} className="test">
            <summary>
              <span className={`dot ${r ? (r.completed && !r.errors.length ? 'ok' : 'bad') : ''}`} />
              {t.id}: {t.title} {t.needs_human_check && <span className="tag">needs human check</span>}
            </summary>
            <p className="hint">{t.purpose}</p>
            <ol className="steps">{t.steps.map((st, i) => <li key={i}><code>{st.action}</code> {st.selector} {st.value}</li>)}</ol>
            <p><b>Expected:</b> {t.expected}</p>
            {r && <ul className="obs">{[...r.observations, ...r.errors].map((o, i) => <li key={i}>{o}</li>)}</ul>}
            {s && <img src={s} alt={`screenshot ${t.id}`} className="shot" />}
          </details>
        );
      })}
      {!p.test_cases.length && <p className="hint">Tests are generated and run automatically after the simulation code is generated.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- P4

export function GuidedTestPanel() {
  const { project: p, busy, run, frameRef, reloadSimulation, addCode } = useApp();
  const tests = p.test_cases.filter((t) => t.needs_human_check);
  const others = p.test_cases.filter((t) => !t.needs_human_check);
  const [ui_test, setUiTest] = useState<TestCase | null>(null);
  const [ui_test_result, setResult] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [ui_test_feedback, setFeedback] = useState<UiTestFeedback | null>(null);
  const [repair_target, setTarget] = useState<{ repair_target: RepairTarget; reason: string } | null>(null);
  const [suggested_repair, setRepair] = useState<Repair | null>(null);

  const reset = () => { setResult([]); setFeedback(null); setTarget(null); setRepair(null); };

  // [human select] ui_test -> [tool_1 execute]
  const play = async (t: TestCase) => {
    setUiTest(t);
    reset();
    setPlaying(true);
    reloadSimulation();
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await playTestInIframe(frameRef.current!, t, (line) => setResult((xs) => [...xs, line]));
    } catch (e) {
      setResult((xs) => [...xs, `✗ ${(e as Error).message}`]);
    }
    setPlaying(false);
  };

  // [human evaluate] -> [model select] repair_target -> [model generate]~ suggested_repair
  const report = (value: UiTestFeedback) => {
    setFeedback(value);
    if (value === 'as_expected') return;
    run('Locating the problem', async () => {
      const code = currentCode(p)!.html;
      const feedback = { value, ui_test: ui_test! };
      const target = await op<{ repair_target: RepairTarget; reason: string }>('selectRepairTarget', { ui_test_feedback: feedback, simulation_code: code });
      setTarget(target);
      const { suggested_repair } = await op<{ suggested_repair: Repair }>('generateSuggestedRepair', {
        repair_target: target.repair_target, ui_test_feedback: feedback, simulation_code: code,
      });
      setRepair(suggested_repair);
    });
  };

  // [human select] approve -> [model modify]~ simulation_code_guided
  const approve = () =>
    run('Applying approved repair', async () => {
      const { simulation_code } = await op<{ simulation_code: string }>('applyRepairToCode', { approved_repair: suggested_repair, simulation_code: currentCode(p)!.html });
      addCode('simulation_code_guided', simulation_code, `guided repair: ${suggested_repair!.summary}`);
      reset();
    });

  const list = (xs: TestCase[]) => xs.map((t) => (
    <button key={t.id} className={`test-pick ${ui_test?.id === t.id ? 'on' : ''}`} disabled={playing || !!busy} onClick={() => play(t)}>
      ▶ {t.title}
    </button>
  ));

  return (
    <div className="panel">
      <p className="hint">Play a test and watch the simulation respond. Tests marked as needing human verification are listed first.</p>
      <div className="test-list">{list(tests)}{others.length > 0 && <details><summary>Other tests ({others.length})</summary>{list(others)}</details>}</div>
      {!p.test_cases.length && <p className="hint">No tests yet.</p>}
      {ui_test && (
        <div className="box">
          <b>{ui_test.title}</b>
          <p><b>Expected:</b> {ui_test.expected}</p>
          <ul className="obs">{ui_test_result.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {!playing && (
            <>
              <div className="hint">Did the simulation behave as expected?</div>
              <div className="row wrap">
                {UI_TEST_FEEDBACK.map((f) => (
                  <button key={f} className={ui_test_feedback === f ? 'on' : ''} disabled={!!busy} onClick={() => report(f)}>{FEEDBACK_LABEL[f]}</button>
                ))}
              </div>
            </>
          )}
          {ui_test_feedback === 'as_expected' && <p className="ok-text">Great — no repair needed.</p>}
          {repair_target && <p><b>Problem level:</b> {TARGET_LABEL[repair_target.repair_target]} — <span className="hint">{repair_target.reason}</span></p>}
          {suggested_repair && (
            <div className="box suggestion">
              <b>Suggested repair</b>
              <p>{suggested_repair.summary}</p>
              <p className="hint">{suggested_repair.details}</p>
              <div className="row">
                <button className="primary" disabled={!!busy} onClick={approve}>Approve &amp; update code</button>
                <button disabled={!!busy} onClick={() => setRepair(null)}>Reject</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- P5

export function ChatPanel({ region, clearRegion }: { region: Region | null; clearRegion: () => void }) {
  const { project: p, busy, run, markMode, setMarkMode, addCode, addGraphVersion, log } = useApp();
  const [issue, setIssue] = useState('');
  const [messages, setMessages] = useState<{ who: 'teacher' | 'model'; text: string }[]>([]);
  const [suggested_change, setChange] = useState<GraphChange | null>(null);

  // [human specify] issue -> [model select] repair_target -> [model generate]~ suggested_change
  const send = () =>
    run('Analysing the issue', async () => {
      const code = currentCode(p)!.html;
      const ui_graph = latest(p.ui_graph)!;
      setMessages((m) => [...m, { who: 'teacher', text: issue }]);
      const target = await op<{ repair_target: RepairTarget; reason: string }>('selectRepairTargetForIssue', {
        chat_region: region, issue, ui_graph, simulation_code: code,
      });
      setMessages((m) => [...m, { who: 'model', text: `This looks like a ${TARGET_LABEL[target.repair_target]} issue: ${target.reason}` }]);
      const { suggested_change } = await op<{ suggested_change: GraphChange }>('generateSuggestedChange', {
        repair_target: target.repair_target, issue, ui_graph, simulation_code: code,
      });
      setChange(suggested_change);
      setIssue('');
    });

  // [human select] accept -> [tool_1 modify] ui_graph_2 -> [model modify]~ simulation_code_chat
  const accept = () =>
    run('Updating graph and code', async () => {
      const { graph, warnings } = applyGraphOps(latest(p.ui_graph)!, suggested_change!.operations);
      if (warnings.length) log(`graph update warnings: ${warnings.join('; ')}`);
      addGraphVersion('ui_graph', graph);
      const { simulation_code } = await op<{ simulation_code: string }>('reviseCodeForGraph', { ui_graph: graph, simulation_code: currentCode(p)!.html });
      addCode('simulation_code_chat', simulation_code, `chat change: ${suggested_change!.summary}`);
      setMessages((m) => [...m, { who: 'model', text: 'Change applied to the UI Graph and the simulation.' }]);
      setChange(null);
      clearRegion();
    });

  const setOp = (i: number, patch: Partial<GraphOp>) =>
    setChange((c) => c && { ...c, operations: c.operations.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <div className="panel">
      <div className="row">
        <button className={markMode === 'chat' ? 'on' : ''} onClick={() => setMarkMode(markMode === 'chat' ? null : 'chat')}>✎ Circle problem area</button>
        {region && <span className="hint">area marked ({region.elements.length} elements)</span>}
      </div>
      <div className="chat">
        {messages.map((m, i) => <div key={i} className={`msg ${m.who}`}>{m.text}</div>)}
      </div>
      {suggested_change && (
        <div className="box suggestion">
          <b>Suggested change ({TARGET_LABEL[suggested_change.level]})</b>
          <textarea rows={2} value={suggested_change.summary} onChange={(e) => setChange({ ...suggested_change, summary: e.target.value })} />
          {suggested_change.operations.map((o, i) => (
            <div key={i} className="op-row">
              <select value={o.op} onChange={(e) => setOp(i, { op: e.target.value as GraphOp['op'] })}>
                {['add_node', 'remove_node', 'update_node', 'add_edge', 'remove_edge'].map((k) => <option key={k}>{k}</option>)}
              </select>
              <input placeholder="id" value={o.id ?? ''} onChange={(e) => setOp(i, { id: e.target.value })} />
              {o.op.endsWith('edge') && o.op === 'add_edge' && (
                <>
                  <input placeholder="source" value={o.source ?? ''} onChange={(e) => setOp(i, { source: e.target.value })} />
                  <input placeholder="target" value={o.target ?? ''} onChange={(e) => setOp(i, { target: e.target.value })} />
                </>
              )}
              {o.op !== 'remove_node' && o.op !== 'remove_edge' && <input placeholder="label" value={o.label ?? ''} onChange={(e) => setOp(i, { label: e.target.value })} />}
              {(o.op === 'add_node' || o.op === 'update_node') && (
                <textarea rows={2} placeholder="description" value={o.description ?? ''} onChange={(e) => setOp(i, { description: e.target.value })} />
              )}
              <button className="danger" title="drop this operation" onClick={() => setChange({ ...suggested_change, operations: suggested_change.operations.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="primary" disabled={!!busy || !suggested_change.operations.length} onClick={accept}>Accept change</button>
            <button disabled={!!busy} onClick={() => setChange(null)}>Dismiss</button>
          </div>
        </div>
      )}
      <textarea rows={3} placeholder={region ? 'Describe the problem in the marked area…' : 'First circle the problem area in the simulation'} value={issue} onChange={(e) => setIssue(e.target.value)} />
      <button className="primary" disabled={!!busy || !region || !issue.trim()} onClick={send}>Send</button>
    </div>
  );
}

// ---------------------------------------------------------------- P6

export function AssumptionsPanel() {
  const { project: p, busy, run, selectedUiNode, addCode, showGraph } = useApp();
  const [assumptions, setAssumptions] = useState<{ node_id: string; node_label: string; items: { id: string; text: string }[] } | null>(null);
  const [text, setText] = useState('');
  const node = latest(p.ui_graph)?.nodes.find((n) => n.id === selectedUiNode);

  useEffect(() => { setAssumptions(null); setText(''); }, [selectedUiNode]);

  // [human select] node (UI graph view) -> [model extract] assumptions_1
  const extract = () =>
    run('Extracting assumptions', async () => {
      const r = await op<{ assumptions: NonNullable<typeof assumptions> }>('extractAssumptions', {
        selected_node: selectedUiNode, ui_graph: latest(p.ui_graph), simulation_code: currentCode(p)!.html,
      });
      setAssumptions(r.assumptions);
      setText(r.assumptions.items.map((a) => a.text).join('\n'));
    });

  // [human modify] assumptions_2 -> [model modify]~ simulation_code_assumptions
  const apply = () =>
    run('Revising code to match assumptions', async () => {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean).map((t, i) => ({ id: `a${i + 1}`, text: t }));
      const assumptions_2 = { ...assumptions!, items };
      const { simulation_code } = await op<{ simulation_code: string }>('reviseCodeForAssumptions', { assumptions: assumptions_2, simulation_code: currentCode(p)!.html });
      addCode('simulation_code_assumptions', simulation_code, `assumptions edited for ${assumptions!.node_label}`);
      setAssumptions(assumptions_2);
    });

  const original = assumptions?.items.map((a) => a.text).join('\n');
  return (
    <div className="panel">
      {!node ? (
        <p className="hint">Select a node in the <a href="#" onClick={(e) => { e.preventDefault(); showGraph('ui_graph'); }}>UI Graph</a> to inspect the assumptions the code makes about it.</p>
      ) : (
        <>
          <p><b>{node.label}</b> <span className="tag">{node.type}</span></p>
          <button disabled={!!busy} onClick={extract}>{assumptions ? 'Re-extract assumptions' : 'Show code assumptions'}</button>
          {assumptions && (
            <>
              <p className="hint">One assumption per line. Edit, add or delete lines, then apply.</p>
              <textarea className="assumptions" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
              <button className="primary" disabled={!!busy || text === original} onClick={apply}>Apply edited assumptions</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- P7

export function RedrawPanel({ region }: { region: Region | null }) {
  const { project: p, busy, run, markMode, setMarkMode, addCode } = useApp();
  const [sketch, setSketch] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  // [human specify] sketch -> [model translate]~ svg -> [model modify]~ code -> [tool_1 execute]
  const redraw = () =>
    run('Redrawing graphic', async () => {
      const code = currentCode(p)!.html;
      setSvg(null);
      const { replacement_svg } = await op<{ replacement_svg: string }>('translateSketchToSvg', { redraw_region: region, sketch, simulation_code: code });
      setSvg(replacement_svg);
      const { simulation_code } = await op<{ simulation_code: string }>('replaceGraphic', { replacement_svg, redraw_region: region, simulation_code: code });
      addCode('simulation_code_redrawn', simulation_code, 'graphic redrawn from sketch');
    });

  return (
    <div className="panel">
      <div className="row">
        <button className={markMode === 'redraw' ? 'on' : ''} onClick={() => setMarkMode(markMode === 'redraw' ? null : 'redraw')}>✎ Circle graphic to replace</button>
        {region && <span className="hint">graphic marked</span>}
      </div>
      <p className="hint">Sketch the replacement:</p>
      <SketchPad onChange={setSketch} />
      <button className="primary" disabled={!!busy || !region || !sketch} onClick={redraw}>Turn sketch into graphic</button>
      {svg && (
        <div className="box">
          <b>Replacement SVG</b>
          <img className="svg-preview" alt="replacement svg" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- P8

export function InspectPanel({ region, subgraph }: { region: Region | null; subgraph: Subgraph | null }) {
  const { markMode, setMarkMode, setSubgraph, project: p } = useApp();
  const g = latest(p.ui_graph);
  return (
    <div className="panel">
      <div className="row">
        <button className={markMode === 'inspect' ? 'on' : ''} onClick={() => setMarkMode(markMode === 'inspect' ? null : 'inspect')}>✎ Subgraph selector</button>
        {subgraph && <button onClick={() => setSubgraph(null)}>Clear highlight</button>}
      </div>
      <p className="hint">Circle part of the simulation; the matching UI Graph nodes and links are highlighted.</p>
      {region && !subgraph && <p className="hint">Matching…</p>}
      {subgraph && (
        <div className="box">
          <b>{subgraph.nodeIds.length} nodes, {subgraph.edgeIds.length} links</b>
          <ul>{subgraph.nodeIds.map((id) => <li key={id}>{g?.nodes.find((n) => n.id === id)?.label ?? id} <code>{id}</code></li>)}</ul>
          <p className="hint">{subgraph.explanation}</p>
        </div>
      )}
    </div>
  );
}
