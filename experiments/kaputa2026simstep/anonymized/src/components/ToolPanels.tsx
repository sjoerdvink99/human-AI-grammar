// Processes 5, 6, 7 and 8 — edits that start from the rendered view or the component graph.
import { useEffect, useState } from 'react';
import { op } from '../api';
import { latest, useComponentGraph, useCurrentCode, useStore } from '../store';
import type { GraphEditOption, Param, Region, Stroke } from '../shared/types';
import { applyGraphEdit, diffGraphs } from '../tools/graphEdit';
import { Code } from './CodeView';

const fmtRegion = (r: Region) => `(${Math.round(r.x)}, ${Math.round(r.y)}) ${Math.round(r.width)}×${Math.round(r.height)}`;

// ---------- Process 5: region + text → category → graph-edit options → tool modify graph → code ----------
export function RegionEditPanel({ region }: { region: Region | null }) {
  const s = useStore();
  const code = useCurrentCode();
  const cg = useComponentGraph();
  const [request, setRequest] = useState(''); // r27
  const [category, setCategory] = useState<{ category: string; reason: string } | null>(null); // r22_2
  const [options, setOptions] = useState<GraphEditOption[] | null>(null); // r28
  const [chosen, setChosen] = useState<GraphEditOption | null>(null); // r29
  const [done, setDone] = useState('');
  useEffect(() => {
    setCategory(null);
    setOptions(null);
    setChosen(null);
    setDone('');
  }, [region]);

  const propose = async () => {
    if (!region || !code || !cg) return;
    setOptions(null);
    setChosen(null);
    setDone('');
    try {
      const input = { region, request, componentGraph: cg.value, code: code.code };
      const c = await s.run('model select: change category (r22_2)', () => op<{ category: string; reason: string }>('regionCategory', input));
      setCategory(c);
      const o = await s.run('model generate: graph edit options (r28)', () =>
        op<GraphEditOption[]>('graphEditOptions', { category: c.category, request, componentGraph: cg.value, code: code.code }),
      );
      setOptions(o);
    } catch {
      /* shown in status bar */
    }
  };

  const choose = async (o: GraphEditOption) => {
    if (!cg || !code) return;
    setChosen(o);
    // [tool_1 modify] r11_1 → r11_2
    const g2 = applyGraphEdit(cg.value, o.edit);
    const gid = s.addComponentGraph(g2);
    try {
      const newCode = await s.run('model modify: code from updated graph (r30_4)', () => op<string>('codeFromGraph', { componentGraph: g2, code: code.code }));
      s.addCode('r30_4', `region edit: ${o.summary}`, newCode);
      setDone(`Component graph updated to ${gid}; code updated as r30_4.`);
    } catch {
      /* shown */
    }
  };

  if (!region) return <p className="hint">Drag a rectangle on the rendering to select a region (r26).</p>;
  return (
    <div className="tool-panel">
      <p className="muted">r26 region {fmtRegion(region)}</p>
      <textarea rows={2} placeholder="What should change here? e.g. 'show values on top of these bars'" value={request} onChange={(e) => setRequest(e.target.value)} />
      <button className="primary" disabled={!!s.busy || !request.trim()} onClick={propose}>
        Propose changes
      </button>
      {category && (
        <p>
          <span className="tag">r22 {category.category}</span> <span className="muted">{category.reason}</span>
        </p>
      )}
      {options && (
        <div className="cards">
          {options.map((o, i) => {
            const d = cg ? diffGraphs(cg.value, applyGraphEdit(cg.value, o.edit)) : null;
            return (
              <button key={i} className={`card ${chosen === o ? 'chosen' : ''}`} disabled={!!s.busy} onClick={() => choose(o)}>
                <strong>{o.summary}</strong>
                {d && (
                  <div className="tiny muted">
                    {d.added.length > 0 && <>+ {d.added.join(', ')} </>}
                    {d.changed.length > 0 && <>~ {d.changed.join(', ')} </>}
                    {d.removed.length > 0 && <>− {d.removed.join(', ')}</>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}

// ---------- Process 6: select component → extract params → edit → modify code ----------
export function ParamsPanel({ nodeId, onNode }: { nodeId: string | null; onNode: (id: string | null) => void }) {
  const s = useStore();
  const code = useCurrentCode();
  const cg = useComponentGraph();
  const [params, setParams] = useState<Param[] | null>(null); // r32_1
  const [edited, setEdited] = useState<Param[] | null>(null); // r32_2
  const [done, setDone] = useState('');

  // [human select] r31 triggers [model extract] r32
  useEffect(() => {
    setParams(null);
    setEdited(null);
    setDone('');
    if (!nodeId || !cg || !code) return;
    let alive = true;
    s.run(`model extract: parameters of ${nodeId} (r32)`, () => op<Param[]>('extractParams', { nodeId, componentGraph: cg.value, code: code.code }))
      .then((p) => {
        if (!alive) return;
        setParams(p);
        setEdited(structuredClone(p));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const apply = async () => {
    if (!params || !edited || !code) return;
    const changed = edited.map((p, i) => ({ ...p, original: params[i].value })).filter((p) => p.value !== p.original);
    if (!changed.length) return;
    try {
      const newCode = await s.run('model modify: apply parameters (r33_4)', () => op<string>('applyParams', { params: changed, code: code.code }));
      s.addCode('r33_4', `parameters of ${nodeId}: ${changed.map((p) => p.name).join(', ')}`, newCode);
      setParams(edited.map((p) => ({ ...p })));
      setDone('Applied as code version r33_4.');
    } catch {
      /* shown */
    }
  };

  const update = (i: number, value: string) => setEdited((e) => e && e.map((p, j) => (j === i ? { ...p, value } : p)));
  const dirty = !!params && !!edited && edited.some((p, i) => p.value !== params[i].value);

  return (
    <div className="tool-panel">
      <div className="row">
        <label>r31 component:</label>
        <select value={nodeId ?? ''} onChange={(e) => onNode(e.target.value || null)}>
          <option value="">— pick a component (or click a node) —</option>
          {cg?.value.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} ({n.kind})
            </option>
          ))}
        </select>
      </div>
      {nodeId && cg && <p className="muted small">{cg.value.nodes.find((n) => n.id === nodeId)?.description}</p>}
      {edited && (
        <table className="params">
          <tbody>
            {edited.map((p, i) => (
              <tr key={p.name} className={params && p.value !== params[i].value ? 'dirty' : ''}>
                <td title={p.description}>
                  {p.name}
                  <div className="tiny muted">{p.description}</div>
                </td>
                <td>
                  {p.kind === 'color' ? (
                    <span className="row">
                      <input type="color" value={/^#[0-9a-f]{6}$/i.test(p.value) ? p.value : '#000000'} onChange={(e) => update(i, e.target.value)} />
                      <input value={p.value} onChange={(e) => update(i, e.target.value)} size={9} />
                    </span>
                  ) : p.kind === 'boolean' ? (
                    <input type="checkbox" checked={p.value === 'true'} onChange={(e) => update(i, String(e.target.checked))} />
                  ) : (
                    <input type={p.kind === 'number' ? 'number' : 'text'} value={p.value} onChange={(e) => update(i, e.target.value)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edited && (
        <button className="primary" disabled={!!s.busy || !dirty} onClick={apply}>
          Apply parameter changes
        </button>
      )}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}

// ---------- Process 7: region + sketch → code fragment → merged code → render ----------
export function SketchPanel({
  region,
  strokes,
  onClear,
}: {
  region: Region | null;
  strokes: Stroke[];
  onClear: () => void;
}) {
  const s = useStore();
  const code = useCurrentCode();
  const [fragment, setFragment] = useState<{ description: string; fragment: string } | null>(null); // r36
  const [done, setDone] = useState('');
  useEffect(() => {
    setFragment(null);
    setDone('');
  }, [region]);

  const translate = async () => {
    if (!region || !code || !strokes.length) return;
    setDone('');
    try {
      const f = await s.run('model translate: sketch → code fragment (r36)', () => op<{ description: string; fragment: string }>('sketchToCode', { region, strokes, code: code.code }));
      setFragment(f);
      const merged = await s.run('model modify: merge fragment (r37_4)', () => op<string>('mergeFragment', { fragment: f.fragment, region, code: code.code }));
      s.addCode('r37_4', `sketch: ${f.description}`, merged);
      onClear();
      setDone('Merged as code version r37_4 — the rendering (r38) shows the result.');
    } catch {
      /* shown */
    }
  };

  if (!region) return <p className="hint">Drag a rectangle on the rendering to select where to sketch (r34).</p>;
  return (
    <div className="tool-panel">
      <p className="muted">
        r34 region {fmtRegion(region)} — draw inside the dashed box (r35). {strokes.length} stroke(s).
      </p>
      <div className="row">
        <button className="primary" disabled={!!s.busy || !strokes.length} onClick={translate}>
          Turn sketch into code
        </button>
        <button disabled={!strokes.length} onClick={onClear}>
          Clear sketch
        </button>
      </div>
      {fragment && (
        <>
          <p>
            <strong>r36</strong> {fragment.description}
          </p>
          <Code code={fragment.fragment} maxHeight={180} />
        </>
      )}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}

// ---------- Process 8: region → model match → highlighted graph nodes ----------
export function LocatePanel({ region }: { region: Region | null }) {
  const s = useStore();
  const code = useCurrentCode();
  const cg = useComponentGraph();

  // [human select] r39 triggers [model match] r40
  useEffect(() => {
    if (!region || !cg || !code) return;
    s.setHighlight([]);
    s.run('model match: region → components (r40)', () =>
      op<{ nodeIds: string[]; reason: string }>('matchRegion', { region, componentGraph: cg.value, code: code.code }),
    )
      .then((r) => s.setHighlight(r.nodeIds, r.reason))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  if (!region) return <p className="hint">Drag a rectangle on the rendering (r39) to find the components that draw it.</p>;
  const g = latest(s.componentGraphs);
  return (
    <div className="tool-panel">
      <p className="muted">r39 region {fmtRegion(region)}</p>
      {s.highlightNodes.length > 0 && (
        <p>
          <strong>r40</strong> {s.highlightNodes.map((id) => g?.nodes.find((n) => n.id === id)?.label ?? id).join(', ')} — highlighted in the component graph.
          <br />
          <span className="muted">{s.highlightReason}</span>
        </p>
      )}
    </div>
  );
}
