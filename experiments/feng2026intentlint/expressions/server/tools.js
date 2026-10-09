// Deterministic tool steps: tool_1 extract, tool_2 compose.

const RECENT_CELLS = 6;
const MAX_SOURCE = 1200;

/** tool_1 extract: notebook_1 -> context_1 */
export function extractContext(notebook) {
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
  const imports = new Set();
  const variables = new Map(); // name -> {name, kind, cell}
  const functions = new Set();
  const dataframes = new Map(); // name -> columns[]
  const headings = [];

  cells.forEach((cell, idx) => {
    const src = String(cell.source || '');
    if (cell.type === 'markdown') {
      for (const line of src.split('\n')) {
        const h = line.match(/^#{1,6}\s+(.*)/);
        if (h) headings.push(h[1].trim());
      }
      return;
    }
    for (const line of src.split('\n')) {
      const t = line.trim();
      let m;
      if ((m = t.match(/^import\s+(.+)/))) imports.add(t);
      else if ((m = t.match(/^from\s+\S+\s+import\s+.+/))) imports.add(t);
      if ((m = t.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/))) functions.add(`${m[1]}(${m[2]})`);
      if ((m = line.match(/^([A-Za-z_]\w*)\[['"]([^'"]+)['"]\]\s*=(?!=)/))) {
        const cols = dataframes.get(m[1]) || [];
        if (!cols.includes(m[2])) cols.push(m[2]);
        dataframes.set(m[1], cols);
      }
      if ((m = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*=(?!=)\s*(.+)/))) {
        const rhs = m[2];
        for (const name of m[1].split(',').map((s) => s.trim())) {
          const isDf = /\bpd\.(read_\w+|DataFrame|merge|concat)\b|\.(groupby|merge|pivot_table|dropna|fillna|query|assign|copy|reset_index|sort_values)\(|\[\[/.test(rhs);
          variables.set(name, { name, kind: isDf ? 'DataFrame' : guessKind(rhs), cell: idx + 1 });
          if (isDf && !dataframes.has(name)) dataframes.set(name, []);
        }
      }
    }
    // Columns from outputs: `df.head()`-style tables or `Index([...])`.
    const out = String(cell.output || '');
    const lastLine = src.trim().split('\n').pop() || '';
    const target = lastLine.match(/^([A-Za-z_]\w*)(?:\.(head|tail|sample|describe|columns)\b.*)?$/);
    if (out && target) {
      const name = target[1];
      const cols = parseColumns(out);
      if (cols.length) {
        dataframes.set(name, cols);
        const v = variables.get(name);
        if (v) v.kind = 'DataFrame';
      }
    }
    // Columns from DataFrame({...}) literal
    const lit = src.match(/([A-Za-z_]\w*)\s*=\s*pd\.DataFrame\(\s*\{([\s\S]*?)\}\s*\)/);
    if (lit && !(dataframes.get(lit[1]) || []).length) {
      const keys = [...lit[2].matchAll(/['"]([^'"]+)['"]\s*:/g)].map((k) => k[1]);
      dataframes.set(lit[1], keys);
    }
  });

  return {
    imports: [...imports],
    variables: [...variables.values()],
    functions: [...functions],
    dataframes: [...dataframes.entries()].map(([name, columns]) => ({ name, columns })),
    headings,
    recent_cells: cells.slice(-RECENT_CELLS).map((c) => ({
      type: c.type,
      source: String(c.source || '').slice(0, MAX_SOURCE),
      output: String(c.output || '').slice(0, 400),
    })),
  };
}

function guessKind(rhs) {
  const r = rhs.trim();
  if (/^['"f]/.test(r)) return 'str';
  if (/^-?\d+(\.\d+)?$/.test(r)) return 'number';
  if (r.startsWith('[')) return 'list';
  if (r.startsWith('{')) return 'dict';
  if (/^(plt|sns)\./.test(r)) return 'figure';
  return 'object';
}

export function parseColumns(output) {
  const idx = output.match(/Index\(\[([^\]]*)\]/);
  if (idx) return [...idx[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const lines = output.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].trim().split(/\s{2,}|\t|\s+/).filter(Boolean);
  // A df.head() header row is followed by rows starting with an index value.
  if (header.length && /^\s*\S+\s+/.test(lines[1]) && /^\s*\d+/.test(lines[1])) return header;
  return [];
}

/** tool_2 compose: rules_1 + accepted_rules_1 -> rules_2 */
export function composeRules(rules, accepted) {
  const out = rules.map((r) => ({ ...r }));
  const byName = new Map(out.map((r) => [normalize(r.name), r]));
  let next = nextIdNumber(out);
  const added = [];
  for (const raw of accepted || []) {
    const rule = validateRule(raw);
    const existing = byName.get(normalize(rule.name));
    if (existing) {
      Object.assign(existing, { condition: rule.condition, guidance: rule.guidance, severity: rule.severity });
      added.push(existing.id);
      continue;
    }
    const r = { id: `r${next++}`, ...rule };
    out.push(r);
    byName.set(normalize(r.name), r);
    added.push(r.id);
  }
  return { rules: out, added };
}

export function validateRule(raw) {
  const name = String(raw?.name || '').trim();
  const condition = String(raw?.condition || '').trim();
  const guidance = String(raw?.guidance || '').trim();
  if (!name || !condition || !guidance) throw new Error('A rule needs a name, a condition, and guidance');
  const severity = raw.severity === 'warning' ? 'warning' : 'info';
  return { name: name.slice(0, 120), condition: condition.slice(0, 1000), guidance: guidance.slice(0, 1000), severity };
}

function normalize(s) { return String(s).trim().toLowerCase(); }
function nextIdNumber(rules) {
  return rules.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/\D/g, '')) || 0), 0) + 1;
}
