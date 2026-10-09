// Process 1: source_documents* → knowledge_graph, plus a node-link view of the knowledge graph.
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { api } from '../api.ts';
import { uid } from '../../../shared/tools.ts';
import type { CanvasGraph, KnowledgeGraph, SourceDocument } from '../../../shared/types.ts';
import { EXAMPLE_SOURCES } from '../examples.ts';

interface Props {
  kg: KnowledgeGraph;
  canvas: CanvasGraph;
  visible: boolean;
  onBuilt: (kg: KnowledgeGraph) => void;
}

export default function SourcesPanel({ kg, canvas, visible, onBuilt }: Props) {
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<SourceDocument[]>('/sources').then(setDocs).catch(() => {});
  }, []);

  const update = (id: string, patch: Partial<SourceDocument>) => setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const upload = async (files: FileList | null) => {
    if (!files) return;
    const added = await Promise.all(
      [...files].map(async (f) => ({ id: uid('doc'), title: f.name.replace(/\.(txt|md|markdown)$/i, ''), text: await f.text() })),
    );
    setDocs((ds) => [...ds, ...added]);
  };

  const build = async () => {
    setBuilding(true);
    setError('');
    try {
      onBuilt(await api<KnowledgeGraph>('/kg/build', { documents: docs }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="sources">
      <div className="sources-docs">
        <div className="row gap wrap">
          <button onClick={() => { const d = { id: uid('doc'), title: `Document ${docs.length + 1}`, text: '' }; setDocs([...docs, d]); setOpen(d.id); }}>+ Paste text</button>
          <label className="button">
            Upload .txt / .md
            <input type="file" accept=".txt,.md,.markdown,text/plain" multiple hidden onChange={(e) => void upload(e.target.files)} />
          </label>
          {!docs.length && <button className="link" onClick={() => setDocs(EXAMPLE_SOURCES.map((d) => ({ ...d, id: uid('doc') })))}>Load example sources</button>}
        </div>
        {docs.map((d) => (
          <div key={d.id} className="doc">
            <div className="doc-head">
              <input value={d.title} onChange={(e) => update(d.id, { title: e.target.value })} />
              <span className="muted small">{d.text.split(/\s+/).filter(Boolean).length} words</span>
              <button className="link" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide' : 'Edit'}</button>
              <button className="icon" onClick={() => setDocs(docs.filter((x) => x.id !== d.id))}>×</button>
            </div>
            {open === d.id && <textarea className="doc-text" value={d.text} onChange={(e) => update(d.id, { text: e.target.value })} placeholder="Paste the document text here" />}
          </div>
        ))}
        <div className="row gap">
          <button className="primary" disabled={building || !docs.some((d) => d.text.trim())} onClick={() => void build()}>
            {building ? 'Extracting entities & relations…' : kg.nodes.length ? 'Rebuild knowledge graph' : 'Build knowledge graph'}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </div>
      {visible && <KgView kg={kg} canvas={canvas} />}
    </div>
  );
}

type SimNode = SimulationNodeDatum & { id: string; name: string; type: string; description: string };

const TYPE_COLORS = ['#4e79a7', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#ff9da7', '#9c755f', '#edc948'];

function KgView({ kg, canvas }: { kg: KnowledgeGraph; canvas: CanvasGraph }) {
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<SimNode | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 520;
  const H = 420;

  const types = useMemo(() => [...new Set(kg.nodes.map((n) => n.type.toLowerCase()))], [kg]);
  const color = (t: string) => TYPE_COLORS[types.indexOf(t.toLowerCase()) % TYPE_COLORS.length];
  const onCanvas = useMemo(() => new Set(canvas.nodes.flatMap((n) => n.entityIds)), [canvas]);

  const sim = useMemo(() => {
    const nodes: SimNode[] = kg.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, description: n.description }));
    const links = kg.links.map((l) => ({ source: l.source, target: l.target, predicate: l.predicate }));
    const s = forceSimulation(nodes)
      .force('link', forceLink<SimNode, (typeof links)[number]>(links).id((d) => d.id).distance(60))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide(14))
      .force('x', forceX(W / 2).strength(0.12))
      .force('y', forceY(H / 2).strength(0.12))
      .stop();
    for (let i = 0; i < 300; i++) s.tick();
    return { nodes, links: links as unknown as { source: SimNode; target: SimNode; predicate: string }[] };
  }, [kg]);

  useEffect(() => setTick((t) => t + 1), [sim]);

  if (!kg.nodes.length) return <div className="muted small pad">The knowledge graph will appear here.</div>;

  const xs = sim.nodes.map((n) => n.x ?? 0);
  const ys = sim.nodes.map((n) => n.y ?? 0);
  const pad = 40;
  const vb = `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + 2 * pad}`;

  return (
    <div className="kg-view">
      <div className="legend">
        {types.map((t) => (
          <span key={t}><i style={{ background: color(t) }} />{t}</span>
        ))}
        <span><i className="ring" />on canvas</span>
      </div>
      <svg ref={svg} viewBox={vb} className="kg-svg">
        {sim.links.map((l, i) => (
          <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} className={hover && (hover === l.source || hover === l.target) ? 'kg-link hot' : 'kg-link'}>
            <title>{`${l.source.name} — ${l.predicate} → ${l.target.name}`}</title>
          </line>
        ))}
        {sim.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
            <circle r={onCanvas.has(n.id) ? 8 : 6} fill={color(n.type)} className={onCanvas.has(n.id) ? 'on-canvas' : ''} />
            <text x={9} y={4}>{n.name}</text>
          </g>
        ))}
      </svg>
      <div className="kg-hover small">
        {hover ? (
          <>
            <b>{hover.name}</b> <span className="muted">({hover.type})</span> — {hover.description || 'no description'}
          </>
        ) : (
          <span className="muted">Hover a node for details.</span>
        )}
      </div>
    </div>
  );
}
