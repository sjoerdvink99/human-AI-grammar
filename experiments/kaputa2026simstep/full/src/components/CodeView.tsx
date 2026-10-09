// simulation_code (artifact formal): read-only source with light syntax highlighting.
function highlight(src: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w-]*)|("[^"\n]*"|'[^'\n]*')|\b(const|let|var|function|return|if|else|for|while|new|class|this)\b/g;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'hl-c' : m[2] ? 'hl-t' : m[3] ? 'hl-s' : 'hl-k';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + esc(src.slice(last));
}

export function CodeView({ html, label }: { html: string; label: string }) {
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `${label}.html`;
    a.click();
  };
  return (
    <div className="panel">
      <div className="row"><b>{label}</b><span className="hint">{html.length.toLocaleString()} chars</span><button onClick={download}>Download HTML</button></div>
      <pre className="code" dangerouslySetInnerHTML={{ __html: highlight(html) }} />
    </div>
  );
}
