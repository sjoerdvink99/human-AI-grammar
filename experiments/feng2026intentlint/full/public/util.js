// Pure helpers shared by the UI and the tests.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Word-level diff between prompt_1 and prompt_2, rendered with <ins>/<del>. */
export function diffWords(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  if (n * m > 400000) return `<ins>${esc(b)}</ins>`;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out += `<del>${esc(A[i++])}</del>`; }
    else { out += `<ins>${esc(B[j++])}</ins>`; }
  }
  while (i < n) out += `<del>${esc(A[i++])}</del>`;
  while (j < m) out += `<ins>${esc(B[j++])}</ins>`;
  return out.replace(/<\/del><del>/g, '').replace(/<\/ins><ins>/g, '');
}

const KW = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));

/** Minimal Python syntax highlighter for code_1. */
export function highlightPython(src) {
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|[rbfu]*"(?:\\.|[^"\\\n])*"|[rbfu]*'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const [t, com, str, num, fn, word] = m;
    if (com) out += `<span class="tok-com">${esc(t)}</span>`;
    else if (str) out += `<span class="tok-str">${esc(t)}</span>`;
    else if (num) out += `<span class="tok-num">${esc(t)}</span>`;
    else if (fn) out += KW.has(fn) ? `<span class="tok-kw">${esc(t)}</span>` : `<span class="tok-fn">${esc(t)}</span>`;
    else out += KW.has(word) ? `<span class="tok-kw">${esc(t)}</span>` : esc(t);
    last = m.index + t.length;
  }
  return out + esc(src.slice(last));
}

/** Highlight quoted spans (from lint messages) inside the original prompt. */
export function markQuotes(text, quotes) {
  let html = esc(text);
  for (const q of quotes.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const eq = esc(q);
    const idx = html.indexOf(eq);
    if (idx >= 0) html = html.slice(0, idx) + `<mark class="q">${eq}</mark>` + html.slice(idx + eq.length);
  }
  return html;
}
