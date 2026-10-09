// Workspace: live simulation (tool_1 execute) + UI graph + refinement processes 4–8.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Region } from "../../shared/types";
import { GraphView } from "../components/GraphView";
import { RegionOverlay, type Rect } from "../components/RegionOverlay";
import { SimulationFrame, type FrameHandle } from "../components/SimulationFrame";
import { SketchCanvas } from "../components/SketchCanvas";
import { currentCode, latest, nextCodeId, useProject } from "../state";
import { TestsPanel } from "./panels/TestsPanel";
import { ChatPanel } from "./panels/ChatPanel";
import { AssumptionsPanel } from "./panels/AssumptionsPanel";
import { RedrawPanel } from "./panels/RedrawPanel";
import { FindPanel } from "./panels/FindPanel";
import { InfoPanel } from "./panels/InfoPanel";

export type Tab = "tests" | "chat" | "assumptions" | "redraw" | "find" | "info";
const TABS: [Tab, string, string][] = [
  ["tests", "Tests", "Process 4 · run a test, judge it, approve a repair"],
  ["chat", "Region chat", "Process 5 · select a region and describe a change"],
  ["assumptions", "Assumptions", "Process 6 · click a UI-graph node, edit its assumptions"],
  ["redraw", "Redraw", "Process 7 · select a region and sketch a replacement"],
  ["find", "Find in graph", "Process 8 · select a region to find its UI-graph nodes"],
  ["info", "Design", "Learning goal, procedure and factors"],
];
const REGION_COLORS: Partial<Record<Tab, string>> = { chat: "#2563eb", redraw: "#db2777", find: "#f59e0b" };

export interface PanelProps {
  frame: React.RefObject<FrameHandle | null>;
  region: Region | null;
  commitCode: (kind: string, html: string, note: string) => void;
}

export function Workspace() {
  const { project: p, update } = useProject();
  const frame = useRef<FrameHandle>(null);
  const [tab, setTab] = useState<Tab>("tests");
  const [rect, setRect] = useState<Rect | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [sketching, setSketching] = useState(false);
  const [sketch, setSketch] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [uiGraphIdx, setUiGraphIdx] = useState<number | null>(null);
  const code = currentCode(p);
  const downloadUrl = useMemo(() => (code ? URL.createObjectURL(new Blob([code.html], { type: "text/html" })) : ""), [code]);
  const uiGraph = uiGraphIdx != null ? p.ui_graph[uiGraphIdx] : latest(p.ui_graph);

  useEffect(() => {
    setRect(null);
    setRegion(null);
    setSketching(false);
    setSketch(null);
    if (tab !== "find") setHighlight([]);
  }, [tab]);

  const onRect = async (r: Rect) => {
    setRect(r);
    setSketch(null);
    const elements = await frame.current?.elementsInRect(r).catch(() => []);
    setRegion({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), elements: elements ?? [] });
  };

  const commitCode = useCallback(
    (kind: string, html: string, note: string) =>
      update((s) => {
        const id = nextCodeId(s, kind);
        return { simulation_code: [...s.simulation_code, { id, html, note, createdAt: Date.now() }], current_code_id: id };
      }),
    [update],
  );

  if (!code || !uiGraph) return <div className="card">No simulation yet — finish authoring first.</div>;

  const regionTab = REGION_COLORS[tab];
  const overlay = regionTab ? (
    <>
      {!sketching && <RegionOverlay rect={rect} onRect={onRect} color={regionTab} label={tab === "chat" ? "chat region" : tab === "redraw" ? "redraw region" : "find"} />}
      {sketching && rect && (
        <SketchCanvas
          region={rect}
          onCancel={() => setSketching(false)}
          onDone={(png) => {
            setSketch(png);
            setSketching(false);
          }}
        />
      )}
    </>
  ) : null;

  const panelProps: PanelProps = { frame, region, commitCode };

  return (
    <div className="workspace">
      <aside className="pane left">
        <h3>
          UI graph{" "}
          <select value={uiGraphIdx ?? p.ui_graph.length - 1} onChange={(e) => setUiGraphIdx(Number(e.target.value) === p.ui_graph.length - 1 ? null : Number(e.target.value))}>
            {p.ui_graph.map((_, i) => (
              <option key={i} value={i}>
                ui_graph_{i + 1}
              </option>
            ))}
          </select>
        </h3>
        <GraphView
          graph={uiGraph}
          direction="TB"
          height={560}
          selected={selectedNode ? [selectedNode] : []}
          highlighted={highlight}
          onNodeClick={(id) => {
            setSelectedNode(id);
            setTab("assumptions");
          }}
        />
        <p className="small">Click a node to inspect and edit its assumptions. Green outline = changed in the last region-chat edit.</p>
      </aside>

      <main className="pane center">
        <div className="versions">
          <span className="small">Code versions:</span>
          {p.simulation_code.map((c) => (
            <button key={c.id} className={`chip ${c.id === code.id ? "on" : ""}`} title={c.note} onClick={() => update({ current_code_id: c.id })}>
              {c.id.replace("simulation_code_", "")}
            </button>
          ))}
          <a className="chip" download={`${code.id}.html`} href={downloadUrl}>
            ⬇ HTML
          </a>
        </div>
        <SimulationFrame ref={frame} html={code.html} overlay={overlay} />
        <div className="small">
          Showing <code>{code.id}</code> — {code.note}
        </div>
      </main>

      <aside className="pane right">
        <nav className="tabs">
          {TABS.map(([k, label, tip]) => (
            <button key={k} className={tab === k ? "on" : ""} title={tip} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <p className="small tabtip">{TABS.find((t) => t[0] === tab)![2]}</p>
        {tab === "tests" && <TestsPanel {...panelProps} />}
        {tab === "chat" && <ChatPanel {...panelProps} />}
        {tab === "assumptions" && <AssumptionsPanel {...panelProps} selectedNode={selectedNode} />}
        {tab === "redraw" && (
          <RedrawPanel {...panelProps} sketch={sketch} startSketch={() => setSketching(true)} sketching={sketching} />
        )}
        {tab === "find" && <FindPanel {...panelProps} onMatch={setHighlight} highlight={highlight} />}
        {tab === "info" && <InfoPanel />}
      </aside>
    </div>
  );
}
