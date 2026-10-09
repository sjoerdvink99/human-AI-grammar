// scene (artifact formal): the SceneScript source with syntax highlighting.
// Shows linked_highlight as a highlighted line span; clicking a line selects that node.
import { Fragment, useEffect, useRef } from 'react';
import type { SceneNode } from '../shared/scene';
import { findNode, nodeAtLine } from '../shared/scene';

const TOKEN = /("(?:[^"\\]|\\.)*")|(#[0-9a-fA-F]{6})|(-?\d+\.?\d*)|\b(scene|group|box|sphere|cylinder|cone|torus|plane)\b|([a-z]+)(?==)|(\/\/.*$)/g;

function highlight(line: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index! > last) parts.push(line.slice(last, m.index));
    const cls = m[1] ? 'tk-str' : m[2] ? 'tk-color' : m[3] ? 'tk-num' : m[4] ? 'tk-kw' : m[5] ? 'tk-attr' : 'tk-cmt';
    parts.push(
      <span key={m.index} className={cls}>
        {m[2] && <span className="swatch" style={{ background: m[2] }} />}
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

interface Props {
  code: string;
  tree: SceneNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CodeView({ code, tree, selectedId, onSelect }: Props) {
  const lines = code.replace(/\n$/, '').split('\n');
  const sel = selectedId ? findNode(tree, selectedId) : undefined;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sel || !ref.current) return;
    const el = ref.current.querySelector(`[data-line="${sel.startLine}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel?.startLine, selectedId]);

  return (
    <div className="code-view" ref={ref}>
      {lines.map((l, i) => {
        const n = i + 1;
        const inSel = sel && n >= sel.startLine && n <= sel.endLine;
        return (
          <Fragment key={i}>
            <div
              data-line={n}
              className={'code-line' + (inSel ? ' in-sel' : '')}
              onClick={() => onSelect(nodeAtLine(tree, n)?.id ?? null)}
            >
              <span className="ln">{n}</span>
              <span className="src">{highlight(l)}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
