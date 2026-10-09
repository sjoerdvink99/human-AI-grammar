// r4 (artifact graph) as an outline; clicking a row is human select → r7.
import type { SceneNode } from '../../../shared/dsl';

const ICON: Record<string, string> = {
  group: '▣', rect: '▭', circle: '○', ellipse: '⬭', line: '╱', polygon: '△', polyline: '⌇', path: '∿', text: 'T',
};

export function TreeView({ nodes, selected, onSelect }: {
  nodes: SceneNode[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (!nodes.length) return <p className="muted">Empty scene.</p>;
  return <ul className="tree">{nodes.map((n) => <Row key={n.id} node={n} selected={selected} onSelect={onSelect} />)}</ul>;
}

function Row({ node, selected, onSelect }: { node: SceneNode; selected: string | null; onSelect: (id: string) => void }) {
  const fill = node.attrs.fill?.value;
  return (
    <li>
      <div
        className={`tree-row${selected === node.id ? ' selected' : ''}`}
        onClick={() => onSelect(node.id)}
        title={`lines ${node.startLine}–${node.endLine}`}
      >
        <span className="icon">{ICON[node.kind]}</span>
        <span>{node.name}</span>
        <span className="muted kind">{node.kind}</span>
        {typeof fill === 'string' && fill !== 'none' && <span className="swatch" style={{ background: fill }} />}
      </div>
      {node.children.length > 0 && (
        <ul>{node.children.map((c) => <Row key={c.id} node={c} selected={selected} onSelect={onSelect} />)}</ul>
      )}
    </li>
  );
}
