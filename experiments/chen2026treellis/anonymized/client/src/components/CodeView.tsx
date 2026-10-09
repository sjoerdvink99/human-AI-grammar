// r3 (artifact formal), read-only with syntax highlighting; selected lines are part of r8.
import { useEffect, useRef, type ReactElement } from 'react';
import { tokenizeLine } from '../../../shared/dsl';

const KEYWORDS = new Set(['canvas', 'param', 'group', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text']);

function highlight(line: string) {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) return <><span>{indent}</span><span className="tk-comment">{trimmed}</span></>;
  const parts: ReactElement[] = [<span key="i">{indent}</span>];
  let last = 0;
  tokenizeLine(trimmed).forEach((t, i) => {
    parts.push(<span key={`w${i}`}>{trimmed.slice(last, t.start)}</span>);
    last = t.end;
    const eq = t.text.indexOf('=');
    if (i === 0 && KEYWORDS.has(t.text)) parts.push(<span key={i} className="tk-kw">{t.text}</span>);
    else if (eq > 0) {
      const val = t.text.slice(eq + 1);
      parts.push(
        <span key={i}>
          <span className="tk-attr">{t.text.slice(0, eq)}</span>=
          <span className={val.startsWith('"') ? 'tk-str' : /^[\d.-]+$/.test(val) ? 'tk-num' : 'tk-expr'}>{val}</span>
        </span>,
      );
    } else if (i === 1) parts.push(<span key={i} className="tk-name">{t.text}</span>);
    else if (t.text.startsWith('"')) parts.push(<span key={i} className="tk-str">{t.text}</span>);
    else if (/^[\d.[\],-]+$/.test(t.text)) parts.push(<span key={i} className="tk-num">{t.text}</span>);
    else parts.push(<span key={i}>{t.text}</span>);
  });
  return <>{parts}</>;
}

export function CodeView({ code, highlight: range }: { code: string; highlight: [number, number] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!range || !ref.current) return;
    ref.current.querySelector(`[data-line="${range[0]}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [range?.[0], range?.[1]]);
  return (
    <div className="code" ref={ref}>
      {code.split('\n').map((l, i) => {
        const n = i + 1;
        const on = range && n >= range[0] && n <= range[1];
        return (
          <div key={i} data-line={n} className={`code-line${on ? ' hl' : ''}`}>
            <span className="ln">{n}</span>
            <span className="src">{highlight(l)}</span>
          </div>
        );
      })}
    </div>
  );
}
