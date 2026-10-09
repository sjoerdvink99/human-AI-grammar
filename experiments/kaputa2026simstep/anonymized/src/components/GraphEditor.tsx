// Process 2: r2_1 -> [human modify] -> r2_2. Direct editing of the intent graph.
import { useEffect, useState } from 'react';
import type { Graph } from '../shared/types';
import { validateGraph } from '../shared/validate';

interface Props {
  graph: Graph;
  onSave: (g: Graph) => void;
  onCancel: () => void;
}

export function GraphEditor({ graph, onSave, onCancel }: Props) {
  const [g, setG] = useState<Graph>(() => structuredClone(graph));
  const [newEdge, setNewEdge] = useState({ source: '', target: '', label: '' });
  const [err, setErr] = useState('');
  useEffect(() => setG(structuredClone(graph)), [graph]);

  const updateNode = (i: number, patch: Partial<Graph['nodes'][number]>) =>
    setG((x) => ({ ...x, nodes: x.nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));
  const removeNode = (id: string) =>
    setG((x) => ({ nodes: x.nodes.filter((n) => n.id !== id), edges: x.edges.filter((e) => e.source !== id && e.target !== id) }));
  const addNode = () => {
    let k = g.nodes.length + 1;
    while (g.nodes.some((n) => n.id === `node_${k}`)) k++;
    setG((x) => ({ ...x, nodes: [...x.nodes, { id: `node_${k}`, label: 'New intent', kind: 'style', description: '' }] }));
  };
  const save = () => {
    try {
      onSave(validateGraph(structuredClone(g), 'intent graph', 1));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="graph-editor">
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>label</th>
            <th>kind</th>
            <th>description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {g.nodes.map((n, i) => (
            <tr key={n.id}>
              <td className="mono">{n.id}</td>
              <td>
                <input value={n.label} onChange={(e) => updateNode(i, { label: e.target.value })} />
              </td>
              <td>
                <select value={n.kind} onChange={(e) => updateNode(i, { kind: e.target.value })}>
                  {['goal', 'data', 'encoding', 'interaction', 'style', 'audience', n.kind]
                    .filter((v, j, a) => a.indexOf(v) === j)
                    .map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                </select>
              </td>
              <td>
                <input value={n.description} onChange={(e) => updateNode(i, { description: e.target.value })} />
              </td>
              <td>
                <button className="link danger" onClick={() => removeNode(n.id)}>
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" onClick={addNode}>
        + node
      </button>
      <h4>Links</h4>
      <ul className="edge-list">
        {g.edges.map((e, i) => (
          <li key={i}>
            <span className="mono">{e.source}</span> → <span className="mono">{e.target}</span> {e.label && <em>({e.label})</em>}{' '}
            <button className="link danger" onClick={() => setG((x) => ({ ...x, edges: x.edges.filter((_, j) => j !== i) }))}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <select value={newEdge.source} onChange={(e) => setNewEdge({ ...newEdge, source: e.target.value })}>
          <option value="">from…</option>
          {g.nodes.map((n) => (
            <option key={n.id}>{n.id}</option>
          ))}
        </select>
        <select value={newEdge.target} onChange={(e) => setNewEdge({ ...newEdge, target: e.target.value })}>
          <option value="">to…</option>
          {g.nodes.map((n) => (
            <option key={n.id}>{n.id}</option>
          ))}
        </select>
        <input placeholder="relation" value={newEdge.label} onChange={(e) => setNewEdge({ ...newEdge, label: e.target.value })} />
        <button
          className="small"
          disabled={!newEdge.source || !newEdge.target}
          onClick={() => {
            setG((x) => ({ ...x, edges: [...x.edges, { ...newEdge }] }));
            setNewEdge({ source: '', target: '', label: '' });
          }}
        >
          + link
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button className="primary" onClick={save}>
          Save as new version
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
