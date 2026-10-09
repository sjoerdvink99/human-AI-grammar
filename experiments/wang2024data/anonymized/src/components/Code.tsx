import type { ReactNode } from "react";
/** Minimal JS syntax highlighting for formal representations (r8, r12, r13, r16). */
const TOKEN = /(\/\/.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(function|return|const|let|var|if|else|for|while|of|in|new|null|true|false|undefined)\b|\b(\d+(?:\.\d+)?)\b/gm;

export function Code({ code, maxHeight }: { code: string; maxHeight?: number }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) parts.push(<span key={i++}>{code.slice(last, m.index)}</span>);
    const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-kw' : 'tok-num';
    parts.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  parts.push(<span key={i++}>{code.slice(last)}</span>);
  return (
    <pre className="code" style={maxHeight ? { maxHeight } : undefined}>
      {parts}
    </pre>
  );
}
