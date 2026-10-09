// scene (formal medium): the textual scene description, syntax-highlighted; the selected subtree is marked.
import { useEffect, useMemo, useRef } from 'react';
import { serializeScene, type Scene } from '../shared/scene';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|(true|false|null)/gi;

function highlight(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) {
      const isKey = !!m[2];
      const isColor = /^"#[0-9a-f]{6}"$/i.test(m[1]);
      out.push(
        <span key={m.index} className={isKey ? 'tk-key' : 'tk-str'}>
          {isColor && <span className="tk-swatch" style={{ background: m[1].slice(1, -1) }} />}
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3]) out.push(<span key={m.index} className="tk-num">{m[3]}</span>);
    else out.push(<span key={m.index} className="tk-lit">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function SceneText({ scene, selectedId }: { scene: Scene; selectedId: string | null }) {
  const text = useMemo(() => serializeScene(scene), [scene]);
  const lines = useMemo(() => text.split('\n'), [text]);
  // find the line range of the selected node's object
  const range = useMemo(() => {
    if (!selectedId) return null;
    const idLine = lines.findIndex((l) => l.trim() === `"id": ${JSON.stringify(selectedId)},`);
    if (idLine < 0) return null;
    const indent = lines[idLine].search(/\S/) - 2;
    let start = idLine;
    while (start > 0 && lines[start].search(/\S/) !== indent) start--;
    let end = idLine;
    while (end < lines.length - 1 && !(lines[end].search(/\S/) === indent && /^\s*}/.test(lines[end]))) end++;
    return [start, end] as const;
  }, [lines, selectedId]);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (range) ref.current?.querySelector(`[data-line="${range[0]}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [range]);
  return (
    <pre className="scene-text" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} data-line={i} className={range && i >= range[0] && i <= range[1] ? 'sel-line' : undefined}>
          <span className="ln">{i + 1}</span>
          {highlight(l)}
        </div>
      ))}
    </pre>
  );
}
