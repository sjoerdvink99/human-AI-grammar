import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);

/** Syntax-highlighted code (formal media: prompts, functions, programs, specs). */
export function Code({ code, lang = 'typescript', maxHeight }: { code: string; lang?: 'typescript' | 'json'; maxHeight?: number }) {
  const html = useMemo(() => hljs.highlight(code, { language: lang }).value, [code, lang]);
  return (
    <pre className="code" style={{ maxHeight }}>
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
