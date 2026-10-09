// tool_1 extract: deterministic source-code parser turning notebook_1 into context_1.
// Lightweight line-based Python analysis (no execution).

const IMPORT_RE = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/;
const FROM_RE = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/;
const DEF_RE = /^\s*def\s+(\w+)\s*\(([^)]*)\)/;
const CLASS_RE = /^\s*class\s+(\w+)/;
const ASSIGN_RE = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/;
const FILE_RE = /["']([^"']+\.(?:csv|tsv|xlsx?|json|parquet|feather|txt|pkl|sqlite|db))["']/g;
const DF_SRC_RE = /\b(?:pd|pandas|pl|polars)\.(read_\w+|DataFrame)\s*\(/;

function kindOf(expr) {
  if (DF_SRC_RE.test(expr)) return 'dataframe';
  if (/^\s*[-+]?\d+(\.\d+)?\s*$/.test(expr)) return 'number';
  if (/^\s*["']/.test(expr)) return 'string';
  if (/^\s*\[/.test(expr)) return 'list';
  if (/^\s*\{/.test(expr)) return 'dict';
  if (/^\s*lambda\b/.test(expr)) return 'function';
  if (/\.(merge|groupby|pivot|query|dropna|fillna|assign|copy|filter|agg|sort_values|loc|iloc|drop|rename)\b/.test(expr)) return 'dataframe (derived)';
  return 'value';
}

/** @param {{cells: {id:string,type:string,source:string}[]}} notebook */
export function extractContext(notebook) {
  const imports = new Map();
  const variables = new Map();
  const functions = [];
  const classes = [];
  const files = new Set();
  const columns = new Map(); // variable name -> Set of column names used
  const markdownNotes = [];

  (notebook.cells || []).forEach((cell, idx) => {
    const n = idx + 1;
    if (cell.type === 'markdown') {
      const text = cell.source.trim();
      if (text) markdownNotes.push({ cell: n, text: text.slice(0, 300) });
      return;
    }
    for (const m of cell.source.matchAll(FILE_RE)) files.add(m[1]);
    for (const raw of cell.source.split('\n')) {
      const line = raw.replace(/#.*$/, '');
      if (!line.trim()) continue;
      let m;
      if ((m = line.match(IMPORT_RE))) { imports.set(m[2] || m[1], m[1]); continue; }
      if ((m = line.match(FROM_RE))) {
        for (const part of m[2].replace(/[()]/g, '').split(',')) {
          const [name, alias] = part.trim().split(/\s+as\s+/);
          if (name) imports.set(alias || name, `${m[1]}.${name}`);
        }
        continue;
      }
      if ((m = line.match(DEF_RE))) { functions.push({ name: m[1], params: m[2].trim(), cell: n }); continue; }
      if ((m = line.match(CLASS_RE))) { classes.push({ name: m[1], cell: n }); continue; }
      if (/^\s/.test(raw)) continue; // only top-level assignments define notebook variables
      if ((m = line.match(ASSIGN_RE))) {
        const expr = m[2].trim();
        for (const name of m[1].split(',').map(s => s.trim())) {
          const prev = variables.get(name);
          variables.set(name, {
            name,
            kind: kindOf(expr),
            definedIn: prev ? [...new Set([...prev.definedIn, n])] : [n],
            expression: expr.slice(0, 120),
          });
        }
      }
    }
    // column references like df["col"]
    for (const m of cell.source.matchAll(/([A-Za-z_]\w*)\s*\[\s*["']([^"']+)["']\s*\]/g)) {
      if (!columns.has(m[1])) columns.set(m[1], new Set());
      columns.get(m[1]).add(m[2]);
    }
  });

  const dataframes = [...variables.values()]
    .filter(v => v.kind.startsWith('dataframe'))
    .map(v => ({ name: v.name, source: v.expression, columnsUsed: [...(columns.get(v.name) || [])] }));

  return {
    cellCount: (notebook.cells || []).length,
    imports: [...imports].map(([alias, module]) => ({ alias, module })),
    variables: [...variables.values()],
    dataframes,
    functions,
    classes,
    files: [...files],
    markdownNotes,
  };
}
