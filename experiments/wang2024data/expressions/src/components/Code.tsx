import type { ReactNode } from 'react';

const TOKEN = /(\/\/.*$|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(function|return|const|let|var|if|else|for|while|of|in|new|null|true|false|undefined|typeof|Math|Number|String|Date)\b|\b(\d+(?:\.\d+)?)\b/gm;

/** Formal artifacts (programs, code) with lightweight syntax highlighting. */
export function Code({ code }: { code: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    const cls = m[1] ? 'tok-comment' : m[2] ? 'tok-string' : m[3] ? 'tok-keyword' : 'tok-number';
    parts.push(<span key={k++} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  parts.push(code.slice(last));
  return <pre className="code">{parts}</pre>;
}
