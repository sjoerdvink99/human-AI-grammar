// structure_tree (artifact graph) as an outline.
//  - clicking a row:            process 2, human select → selected_node
//  - the ⋯ menu on a row:       process 4, human select → structure_target, human specify → structure_edit
//  - the ✦ button on a row:     process 5, human select → ai_target
import { useEffect, useState } from 'react';
import type { NodeType, SceneNode } from '../shared/scene';
import { CONTAINER_TYPES, PRIMITIVE_TYPES } from '../shared/scene';
import type { StructureEdit } from '../shared/edits';

const ICON: Record<NodeType, string> = {
  scene: '◎', group: '▤', box: '■', sphere: '●', cylinder: '▮', cone: '▲', torus: '◯', plane: '▭',
};

interface Props {
  tree: SceneNode;
  selectedId: string | null;
  aiTargetId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onStructureEdit: (edit: StructureEdit) => void;
  onAiTarget: (id: string) => void;
}

export function StructureTree(props: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // structure_target: the row whose structure menu is open
  const [structureTarget, setStructureTarget] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setStructureTarget(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function Row({ node, depth }: { node: SceneNode; depth: number }) {
    const isContainer = CONTAINER_TYPES.includes(node.type);
    const open = !collapsed.has(node.id);
    const isRoot = node.id === '0';
    const edit = (e: StructureEdit) => {
      setStructureTarget(null);
      props.onStructureEdit(e);
    };
    return (
      <>
        <div
          className={
            'tree-row' +
            (props.selectedId === node.id ? ' selected' : '') +
            (props.aiTargetId === node.id ? ' ai-target' : '') +
            (structureTarget === node.id ? ' structure-target' : '')
          }
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => props.onSelect(node.id)}
        >
          <span
            className="twisty"
            onClick={(e) => { e.stopPropagation(); if (isContainer) toggle(node.id); }}
          >
            {isContainer && node.children.length ? (open ? '▾' : '▸') : ''}
          </span>
          <span className={`icon t-${node.type}`}>{ICON[node.type]}</span>
          <span className="name">{node.name}</span>
          <span className="type">{node.type}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              title="Edit this part with AI"
              disabled={props.disabled}
              onClick={() => props.onAiTarget(node.id)}
            >✦</button>
            <button
              title="Structure actions"
              disabled={props.disabled}
              onClick={() => setStructureTarget(structureTarget === node.id ? null : node.id)}
            >⋯</button>
          </span>
          {structureTarget === node.id && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              {isContainer && (
                <div className="menu-section">
                  <div className="menu-label">Add child</div>
                  <div className="menu-grid">
                    {(['group', ...PRIMITIVE_TYPES] as NodeType[]).map((t) => (
                      <button key={t} onClick={() => edit({ op: 'add-child', nodeId: node.id, childType: t })}>
                        {ICON[t]} {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!isRoot && (
                <>
                  <button onClick={() => edit({ op: 'duplicate', nodeId: node.id })}>Duplicate</button>
                  <button onClick={() => edit({ op: 'move-up', nodeId: node.id })}>Move up</button>
                  <button onClick={() => edit({ op: 'move-down', nodeId: node.id })}>Move down</button>
                  <button onClick={() => edit({ op: 'wrap-in-group', nodeId: node.id })}>Wrap in group</button>
                  {node.type === 'group' && (
                    <button onClick={() => edit({ op: 'unwrap-group', nodeId: node.id })}>Ungroup</button>
                  )}
                  <button className="danger" onClick={() => edit({ op: 'delete', nodeId: node.id })}>Delete</button>
                </>
              )}
            </div>
          )}
        </div>
        {isContainer && open && node.children.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <div className="tree">
      <Row node={props.tree} depth={0} />
    </div>
  );
}
