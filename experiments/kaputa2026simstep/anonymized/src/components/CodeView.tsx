// r12 and its later versions (formal medium): syntax-highlighted code with version list.
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import 'highlight.js/styles/github.css';
import { useMemo, useState } from 'react';
import { useStore } from '../store';

hljs.registerLanguage('javascript', javascript);

export function Code({ code, maxHeight = 480 }: { code: string; maxHeight?: number }) {
  const html = useMemo(() => hljs.highlight(code, { language: 'javascript' }).value, [code]);
  return (
    <pre className="code" style={{ maxHeight }}>
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

/** Line diff summary between two code versions (simple LCS-free count). */
function changedLines(a: string, b: string) {
  const A = new Set(a.split('\n'));
  const B = new Set(b.split('\n'));
  let add = 0, del = 0;
  B.forEach((l) => !A.has(l) && add++);
  A.forEach((l) => !B.has(l) && del++);
  return { add, del };
}

export function CodeView() {
  const { codeVersions, currentCodeIndex, setCurrentCode } = useStore();
  const [copied, setCopied] = useState(false);
  const cur = codeVersions[currentCodeIndex];
  if (!cur) return <p className="muted">No code yet.</p>;
  const prev = codeVersions[currentCodeIndex - 1];
  const d = prev ? changedLines(prev.code, cur.code) : null;
  return (
    <div className="code-view">
      <div className="row">
        <select value={currentCodeIndex} onChange={(e) => setCurrentCode(Number(e.target.value))}>
          {codeVersions.map((v, i) => (
            <option key={i} value={i}>
              {v.id} — {v.label}
            </option>
          ))}
        </select>
        {d && (
          <span className="muted">
            <span className="add">+{d.add}</span> <span className="del">−{d.del}</span> lines vs {prev.id}
          </span>
        )}
        <span className="spacer" />
        <button
          className="small"
          onClick={() => {
            navigator.clipboard.writeText(cur.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      {currentCodeIndex !== codeVersions.length - 1 && (
        <p className="note">
          Viewing an earlier version. Edits you make now start from this version.
        </p>
      )}
      <Code code={cur.code} />
    </div>
  );
}
