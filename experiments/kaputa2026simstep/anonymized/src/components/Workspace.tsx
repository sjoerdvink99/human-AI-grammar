// Workspace: r18 rendering + region tools (processes 5, 7, 8), component graph + parameters
// (process 6), code versions, and tests/review (processes 3, 4).
import { useEffect, useState } from 'react';
import { useCurrentCode, useStore } from '../store';
import type { Region, Stroke } from '../shared/types';
import { CodeView } from './CodeView';
import { GraphView } from './GraphView';
import { TestsPanel } from './TestsPanel';
import { LocatePanel, ParamsPanel, RegionEditPanel, SketchPanel } from './ToolPanels';
import { VisualView, type OverlayMode } from './VisualView';

type Tool = 'view' | 'region' | 'sketch' | 'locate';
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'view', label: 'Interact', hint: 'use the visualization' },
  { id: 'region', label: 'Edit region', hint: 'select a region and describe a change' },
  { id: 'sketch', label: 'Sketch', hint: 'select a region and draw what you want' },
  { id: 'locate', label: 'Locate in graph', hint: 'select a region to find its components' },
];

export function Workspace() {
  const s = useStore();
  const code = useCurrentCode();
  const [tool, setTool] = useState<Tool>('view');
  const [region, setRegion] = useState<Region | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [node, setNode] = useState<string | null>(null); // r31
  const [graphIdx, setGraphIdx] = useState<number>(-1);
  const [rightTab, setRightTab] = useState<'graph' | 'code'>('graph');

  useEffect(() => {
    setRegion(null);
    setStrokes([]);
    if (tool !== 'locate') s.setHighlight([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  useEffect(() => setGraphIdx(-1), [s.componentGraphs.length]);

  if (!code) {
    return (
      <div className="empty">
        <p>No program yet. Complete the Design steps first.</p>
      </div>
    );
  }
  const graphs = s.componentGraphs;
  const shownGraph = graphs[graphIdx < 0 ? graphs.length - 1 : graphIdx];

  // Selecting a region in sketch mode first, then drawing inside it.
  const overlay: OverlayMode = tool === 'view' ? 'none' : tool === 'sketch' && region ? 'sketch' : 'region';

  return (
    <div className="workspace">
      <div className="ws-left">
        <div className="toolbar">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'active' : ''} title={t.hint} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
          {tool === 'sketch' && region && (
            <button className="link" onClick={() => { setRegion(null); setStrokes([]); }}>
              reselect region
            </button>
          )}
        </div>
        <div className="panel-title">
          <span className="rid">r18</span> Rendering of <strong>{code.id}</strong> <span className="muted">({code.label})</span>
        </div>
        <VisualView
          code={code.code}
          mode={overlay}
          region={region}
          onRegion={(r) => {
            setRegion(r);
            setStrokes([]);
          }}
          strokes={strokes}
          onStrokes={setStrokes}
        />
        {tool === 'view' && <p className="hint">Choose a tool above to edit the visualization from the rendering.</p>}
        {tool === 'region' && <RegionEditPanel region={region} />}
        {tool === 'sketch' && <SketchPanel region={region} strokes={strokes} onClear={() => setStrokes([])} />}
        {tool === 'locate' && <LocatePanel region={region} />}
      </div>

      <div className="ws-right">
        <div className="tabs">
          <button className={rightTab === 'graph' ? 'active' : ''} onClick={() => setRightTab('graph')}>
            Component graph
          </button>
          <button className={rightTab === 'code' ? 'active' : ''} onClick={() => setRightTab('code')}>
            Code ({s.codeVersions.length} versions)
          </button>
        </div>
        {rightTab === 'graph' && shownGraph && (
          <>
            <div className="row">
              <span className="rid">{shownGraph.id}</span>
              {graphs.length > 1 && (
                <select value={graphIdx < 0 ? graphs.length - 1 : graphIdx} onChange={(e) => setGraphIdx(Number(e.target.value))}>
                  {graphs.map((g, i) => (
                    <option key={g.id} value={i}>
                      {g.id}
                    </option>
                  ))}
                </select>
              )}
              <span className="muted small">click a node to tune its parameters</span>
            </div>
            <GraphView graph={shownGraph.value} highlight={s.highlightNodes} selected={node} onNodeClick={(id) => setNode(id)} maxHeight={340} />
            <h4>Parameters (process 6)</h4>
            <ParamsPanel nodeId={node} onNode={setNode} />
          </>
        )}
        {rightTab === 'code' && <CodeView />}
      </div>

      <div className="ws-bottom">
        <TestsPanel />
      </div>
    </div>
  );
}
