// structure_tree: the assembly hierarchy. Supports [human select] (process 2, structure_target in process 4)
// and [human specify] structure_edit through the toolbar and drag-and-drop (process 4).
import { useEffect, useRef, useState } from 'react';
import { pathTo, SHAPES, type Scene, type SceneNode, type Shape, type StructureEdit } from '../shared/scene';

interface Props {
  scene: Scene;
  selectedId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string | null) => void;
  onEdit: (edit: StructureEdit) => void;
  disabled: boolean;
}

const SHAPE_ICON: Record<Shape, string> = { box: '▣', sphere: '●', cylinder: '▮', cone: '▲', torus: '◎', capsule: '⬮' };

export function StructureTree({ scene, selectedId, highlightIds, onSelect, onEdit, disabled }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [newShape, setNewShape] = useState<Shape>('box');
  const listRef = useRef<HTMLDivElement>(null);

  // expand ancestors of the selection and scroll it into view (linked highlight)
  useEffect(() => {
    if (!selectedId) return;
    const ancestors = pathTo(scene, selectedId).slice(0, -1).map((n) => n.id);
    setCollapsed((c) => {
      if (!ancestors.some((a) => c.has(a))) return c;
      const n = new Set(c);
      ancestors.forEach((a) => n.delete(a));
      return n;
    });
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [selectedId, scene]);

  const isRoot = selectedId === scene.root.id;
  const sel = selectedId;
  const act = (e: StructureEdit) => !disabled && onEdit(e);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const row = (n: SceneNode, depth: number): React.ReactNode => {
    const hasKids = n.children.length > 0;
    const open = !collapsed.has(n.id);
    const cls = ['tree-row', n.id === selectedId ? 'selected' : '', highlightIds.has(n.id) && n.id !== selectedId ? 'in-subtree' : '', dropId === n.id ? 'drop' : '']
      .filter(Boolean)
      .join(' ');
    return (
      <div key={n.id}>
        <div
          className={cls}
          data-id={n.id}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => onSelect(n.id)}
          draggable={!disabled && n.id !== scene.root.id}
          onDragStart={(e) => {
            setDragId(n.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropId(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === n.id) return;
            e.preventDefault();
            setDropId(n.id);
          }}
          onDragLeave={() => setDropId((d) => (d === n.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== n.id) act({ op: 'reparent', nodeId: dragId, newParentId: n.id });
            setDragId(null);
            setDropId(null);
          }}
          title={n.kind === 'group' ? 'Subassembly — drop a node here to move it inside' : `${n.geometry?.shape} part — drop a node here to attach it`}
        >
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              if (hasKids) toggle(n.id);
            }}
          >
            {hasKids ? (open ? '▾' : '▸') : ''}
          </span>
          <span className="node-icon">{n.kind === 'group' ? '❒' : SHAPE_ICON[n.geometry!.shape]}</span>
          {n.kind === 'part' && <span className="swatch" style={{ background: n.color }} />}
          <span className="node-name">{n.name}</span>
          {hasKids && <span className="node-count">{n.children.length}</span>}
        </div>
        {hasKids && open && n.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="panel tree-panel">
      <div className="panel-title">Structure Tree</div>
      <div className="tree-toolbar" aria-disabled={disabled}>
        <div className="btn-row">
          <select value={newShape} onChange={(e) => setNewShape(e.target.value as Shape)} disabled={disabled} title="Shape for new part">
            {SHAPES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button disabled={disabled} onClick={() => act({ op: 'addPart', parentId: sel ?? scene.root.id, shape: newShape })} title="Add a part as a child of the selected node">
            + Part
          </button>
          <button disabled={disabled} onClick={() => act({ op: 'addGroup', parentId: sel ?? scene.root.id })} title="Add an empty subassembly">
            + Group
          </button>
        </div>
        <div className="btn-row">
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'moveUp', nodeId: sel! })} title="Move up among siblings">↑</button>
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'moveDown', nodeId: sel! })} title="Move down among siblings">↓</button>
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'indent', nodeId: sel! })} title="Nest under previous sibling">→</button>
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'outdent', nodeId: sel! })} title="Move out of its subassembly">←</button>
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'wrapInGroup', nodeId: sel! })} title="Wrap in a new group">⧉ Group</button>
          <button disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'duplicate', nodeId: sel! })} title="Duplicate">⎘</button>
          <button className="danger" disabled={disabled || !sel || isRoot} onClick={() => act({ op: 'delete', nodeId: sel! })} title="Delete node and its children">
            ✕
          </button>
        </div>
      </div>
      <div className="tree-list" ref={listRef} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        {row(scene.root, 0)}
      </div>
      <div className="hint">Drag a node onto another to re-parent it.</div>
    </div>
  );
}
