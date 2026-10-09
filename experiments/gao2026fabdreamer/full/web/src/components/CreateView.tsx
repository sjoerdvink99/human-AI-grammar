import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Canvas, Element } from '../../../shared/types';
import { api, fileUrl } from '../api';
import type { WsProps } from '../lib/viewProps';
import LayerCanvas from './LayerCanvas';
import Preview3D from './Preview3D';
import JobStatus from './JobStatus';

/** Stage 2: compose layers with live preview (process 7) + grab (6), repair (8), split (9). */
export default function CreateView(props: WsProps) {
  const { project, ws, jobs, setProject } = props;
  const local = useLocalComposition(props);
  const { canvas, elements } = local;
  const [activeLayerId, setActiveLayerId] = useState<string>(canvas.layers[0]?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dimOthers, setDimOthers] = useState(false);
  const mm = ws.material.sheetWidthMm / canvas.width;
  const selected = selectedId ? elements[selectedId] : null;
  useEffect(() => {
    if (selectedId && !elements[selectedId]) setSelectedId(null);
  }, [elements, selectedId]);

  const undo = async () => setProject(await api('POST', `/api/projects/${project.id}/canvas/undo`).catch(() => project));
  const autoLayout = async () => setProject(await api('POST', `/api/projects/${project.id}/autolayout`));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) local.removeElement(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="create">
      <section className="panel layers-col">
        <div className="row between">
          <h3>Layers</h3>
          <label className="small">
            <input type="checkbox" checked={dimOthers} onChange={(e) => setDimOthers(e.target.checked)} /> focus layer
          </label>
        </div>
        <LayersList
          canvas={canvas}
          elements={elements}
          activeLayerId={activeLayerId}
          selectedId={selectedId}
          onActive={setActiveLayerId}
          onSelect={(id, l) => {
            setSelectedId(id);
            setActiveLayerId(l);
          }}
          onLayerChange={local.updateLayer}
          onAddLayer={local.addLayer}
          project={project}
        />
        <div className="row wrap">
          <button onClick={autoLayout} title="Place elements at their positions in the source image">
            Auto Layout
          </button>
          <button onClick={undo} disabled={!ws.canvasHistory.length} title="Revert to the previous canvas version (Ctrl/Cmd+Z)">
            Undo ({ws.canvasHistory.length})
          </button>
        </div>
        <GrabPanel {...props} activeLayerId={activeLayerId} />
      </section>
      <section className="canvas-col">
        <LayerCanvas
          project={project}
          canvas={canvas}
          elements={elements}
          mmPerPx={mm}
          activeLayerId={activeLayerId}
          selectedId={selectedId}
          dimOthers={dimOthers}
          onSelect={(id, l) => {
            setSelectedId(id);
            if (l) setActiveLayerId(l);
          }}
          onChange={local.patchElement}
          onCommit={local.commit}
        />
        <p className="muted small center">
          Drag to move · square handle scales · round handle rotates (Shift snaps) · Delete removes · sheet {ws.material.sheetWidthMm} × {(canvas.height * mm).toFixed(0)} mm
        </p>
      </section>
      <section className="panel right-col">
        <h3>3D preview</h3>
        <Preview3D project={project} canvas={canvas} elements={elements} material={ws.material} />
        {selected ? (
          <Inspector {...props} el={selected} canvas={canvas} local={local} />
        ) : (
          <p className="muted">Select an element to move it to another layer, repair its edges, or split it.</p>
        )}
        <JobStatus job={jobs.jobs.repair} label="Repair" />
        <JobStatus job={jobs.jobs.split} label="Split" />
      </section>
    </div>
  );
}

// ---------- local editable copy of canvas_1 → canvas_2, saved on commit ----------
function useLocalComposition({ project, ws, setProject }: WsProps) {
  const serverKey = useMemo(() => JSON.stringify([ws.canvas, ws.elements]), [ws.canvas, ws.elements]);
  const [canvas, setCanvas] = useState<Canvas>(ws.canvas!);
  const [elements, setElements] = useState<Record<string, Element>>(ws.elements);
  const dirty = useRef(false);
  const latest = useRef({ canvas, elements });
  latest.current = { canvas, elements };
  useEffect(() => {
    if (dirty.current) return;
    setCanvas(ws.canvas!);
    setElements(ws.elements);
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (c: Canvas, els: Record<string, Element>) => {
    const transforms = Object.fromEntries(Object.values(els).map((e) => [e.id, { x: e.x, y: e.y, scale: e.scale, rotation: e.rotation, layerId: e.layerId }]));
    await api('PUT', `/api/projects/${project.id}/canvas`, { canvas: c, transforms });
    dirty.current = false;
    setProject(await api('GET', `/api/projects/${project.id}`));
  }, [project.id, setProject]);

  return {
    canvas,
    elements,
    patchElement(id: string, patch: Partial<Element>) {
      dirty.current = true;
      setElements((els) => ({ ...els, [id]: { ...els[id], ...patch } }));
    },
    commit() {
      // wait one tick so the last patch is in state
      setTimeout(() => save(latest.current.canvas, latest.current.elements), 0);
    },
    updateLayer(layerId: string, patch: Partial<Canvas['layers'][number]>) {
      const c = { ...canvas, layers: canvas.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) };
      dirty.current = true;
      setCanvas(c);
      save(c, elements);
    },
    moveToLayer(id: string, layerId: string) {
      const c = {
        ...canvas,
        layers: canvas.layers.map((l) => ({
          ...l,
          elementIds: l.id === layerId ? [...l.elementIds.filter((x) => x !== id), id] : l.elementIds.filter((x) => x !== id),
        })),
      };
      const els = { ...elements, [id]: { ...elements[id], layerId } };
      dirty.current = true;
      setCanvas(c);
      setElements(els);
      save(c, els);
    },
    reorder(id: string, dir: -1 | 1) {
      const c = {
        ...canvas,
        layers: canvas.layers.map((l) => {
          const i = l.elementIds.indexOf(id);
          if (i < 0) return l;
          const ids = [...l.elementIds];
          const j = Math.max(0, Math.min(ids.length - 1, i + dir));
          [ids[i], ids[j]] = [ids[j], ids[i]];
          return { ...l, elementIds: ids };
        }),
      };
      setCanvas(c);
      save(c, elements);
    },
    removeElement(id: string) {
      const c = { ...canvas, layers: canvas.layers.map((l) => ({ ...l, elementIds: l.elementIds.filter((x) => x !== id) })) };
      const els = { ...elements };
      delete els[id];
      dirty.current = true;
      setCanvas(c);
      setElements(els);
      save(c, els);
    },
    addLayer() {
      const back = Math.max(...canvas.layers.map((l) => l.depth));
      let n = canvas.layers.length;
      while (canvas.layers.some((l) => l.id === `L${n}`)) n++;
      // new layer goes just in front of the back plate
      const layers = canvas.layers.map((l) => (l.depth === back ? { ...l, depth: back + 1 } : l));
      layers.push({ id: `L${n}`, name: `New layer`, depth: back, frame: false, frameWidthMm: 6, visible: true, elementIds: [] });
      const c = { ...canvas, layers };
      setCanvas(c);
      save(c, elements);
    },
  };
}
type Local = ReturnType<typeof useLocalComposition>;

function LayersList(p: {
  project: WsProps['project'];
  canvas: Canvas;
  elements: Record<string, Element>;
  activeLayerId: string;
  selectedId: string | null;
  onActive: (id: string) => void;
  onSelect: (id: string, layerId: string) => void;
  onLayerChange: Local['updateLayer'];
  onAddLayer: () => void;
}) {
  const layers = [...p.canvas.layers].sort((a, b) => a.depth - b.depth);
  return (
    <div className="layers">
      {layers.map((l) => (
        <div key={l.id} className={'layer' + (l.id === p.activeLayerId ? ' active' : '')} onClick={() => p.onActive(l.id)}>
          <div className="row between">
            <input
              className="bare"
              key={l.name}
              defaultValue={l.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && p.onLayerChange(l.id, { name: e.target.value.trim() })}
            />
            <span className="row">
              <label title="Add a border frame that holds pieces together" className="small">
                <input type="checkbox" checked={l.frame} onChange={(e) => p.onLayerChange(l.id, { frame: e.target.checked })} />
                frame
              </label>
              <button className="icon" title={l.visible ? 'Hide' : 'Show'} onClick={() => p.onLayerChange(l.id, { visible: !l.visible })}>
                {l.visible ? '👁' : '–'}
              </button>
            </span>
          </div>
          <div className="layer-els">
            {l.elementIds.map((id) => {
              const e = p.elements[id];
              if (!e) return null;
              return (
                <button
                  key={id}
                  className={'el-chip' + (id === p.selectedId ? ' sel' : '')}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    p.onSelect(id, l.id);
                  }}
                >
                  <img src={fileUrl(p.project, e.texture)} />
                  {e.name}
                </button>
              );
            })}
            {!l.elementIds.length && <small className="muted">empty</small>}
          </div>
        </div>
      ))}
      <button className="small" onClick={p.onAddLayer}>
        + Add layer
      </button>
    </div>
  );
}

function Inspector({ project, jobs, el, canvas, local }: WsProps & { el: Element; canvas: Canvas; local: Local }) {
  const [splitText, setSplitText] = useState('');
  const num = (k: 'x' | 'y' | 'scale' | 'rotation', step: number) => (
    <label>
      {k}
      <input
        type="number"
        step={step}
        value={+el[k].toFixed(k === 'scale' ? 3 : 1)}
        onChange={(e) => local.patchElement(el.id, { [k]: Number(e.target.value) })}
        onBlur={local.commit}
      />
    </label>
  );
  const busy = jobs.busy('repair') || jobs.busy('split');
  return (
    <div className="inspector">
      <h3>{el.name}</h3>
      <div className="small muted">
        origin: {el.origin}
        {el.quality && ` · mask ${el.quality.stage}, confidence ${el.quality.confidence.toFixed(2)}`}
      </div>
      <div className="grid4">
        {num('x', 1)}
        {num('y', 1)}
        {num('scale', 0.01)}
        {num('rotation', 1)}
      </div>
      <label>
        Layer{' '}
        <select value={el.layerId} onChange={(e) => local.moveToLayer(el.id, e.target.value)}>
          {[...canvas.layers]
            .sort((a, b) => a.depth - b.depth)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.depth}: {l.name}
              </option>
            ))}
        </select>
      </label>
      <div className="row wrap">
        <button onClick={() => local.reorder(el.id, 1)}>Bring forward</button>
        <button onClick={() => local.reorder(el.id, -1)}>Send backward</button>
        <button className="danger" onClick={() => local.removeElement(el.id)}>
          Delete
        </button>
      </div>
      <hr />
      <div>
        <b>Repair edges</b>
        <p className="small muted">Regenerates a clean version from the original image crop and replaces only this element's geometry.</p>
        <button disabled={busy} onClick={() => jobs.run('repair', () => api('POST', `/api/projects/${project.id}/elements/${el.id}/repair`))}>
          Repair “{el.name}”
        </button>
      </div>
      <hr />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!splitText.trim()) return;
          jobs.run('split', () => api('POST', `/api/projects/${project.id}/elements/${el.id}/split`, { request: splitText }));
          setSplitText('');
        }}
      >
        <b>Split into parts</b>
        <div className="chat-input">
          <input value={splitText} onChange={(e) => setSplitText(e.target.value)} placeholder="e.g. separate the roof from the house" disabled={busy} />
          <button disabled={busy || !splitText.trim()}>Split</button>
        </div>
      </form>
    </div>
  );
}

// ---------- process 6 ----------
function GrabPanel({ project, ws, jobs, activeLayerId }: WsProps & { activeLayerId: string }) {
  const [text, setText] = useState('');
  const g = ws.grab;
  const busy = jobs.busy('grab') || jobs.busy('grabSelect');
  return (
    <div className="grab">
      <h3>Grab an element</h3>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          jobs.run('grab', () => api('POST', `/api/projects/${project.id}/grab`, { request: text }));
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. a small owl on a branch" disabled={busy} />
        <button disabled={busy || !text.trim()}>Find</button>
      </form>
      <JobStatus job={jobs.jobs.grab} label="Grab" />
      <JobStatus job={jobs.jobs.grabSelect} label="Extraction" />
      {g && g.candidates.length > 0 && !jobs.busy('grab') && (
        <>
          <p className="small muted">
            Pick one for “{g.request}”; it is added to layer <b>{ws.canvas?.layers.find((l) => l.id === activeLayerId)?.name}</b>.
          </p>
          <div className="candidates small-cands">
            {g.candidates.map((f, i) => (
              <button
                key={f}
                className={'candidate' + (g.chosen === f ? ' chosen' : '')}
                disabled={busy}
                onClick={() => jobs.run('grabSelect', () => api('POST', `/api/projects/${project.id}/grab/select`, { index: i, layerId: activeLayerId }))}
              >
                <img src={fileUrl(project, f)} />
              </button>
            ))}
          </div>
          {g.occlusion && (
            <p className="small">
              Object was judged <b>{g.occlusion}</b>
              {g.occlusion === 'occluded' ? '; hidden parts were completed.' : '.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
