// HTTP server: static frontend + JSON API + Server-Sent Events for shared-state sync.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleStore } from './rules.js';
import { extractContext } from './extract.js';
import { matchRules, lintPrompt, generateCode, proposeRules } from './pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SYSTEMX_DATA || join(ROOT, 'data');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 5173);

// Seed shared state on first run.
mkdirSync(DATA, { recursive: true });
for (const f of ['rules.json', 'notebook.json']) {
  if (!existsSync(join(DATA, f))) copyFileSync(join(ROOT, 'seed', f), join(DATA, f));
}

const rules = new RuleStore(join(DATA, 'rules.json'));
const notebookFile = join(DATA, 'notebook.json');
let notebook = JSON.parse(readFileSync(notebookFile, 'utf8'));

// ---- SSE: tool_2 synchronization ----
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
rules.onChange(e => broadcast('rules', e));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}
/** Resolve the rule set a request may use: the locally active subset of the shared rules. */
function activeRules(ids) {
  const all = rules.list();
  return Array.isArray(ids) ? all.filter(r => ids.includes(r.id)) : all;
}

const routes = {
  'GET /api/rules': () => rules.list(),
  'PUT /api/rules/:id': (b, id) => rules.update(id, b.patch || {}, b.author),
  // Process 2, tool_2 compose: accepted_rules_1 + rules_1 -> rules_2
  'POST /api/rules/compose': b => ({ added: rules.compose(b.accepted || [], b.author), rules: rules.list() }),

  'GET /api/notebook': () => notebook,
  'PUT /api/notebook': b => {
    if (!Array.isArray(b.notebook?.cells)) throw new Error('notebook.cells required');
    notebook = { cells: b.notebook.cells.map(c => ({ id: String(c.id), type: c.type === 'markdown' ? 'markdown' : 'code', source: String(c.source ?? '') })) };
    writeFileSync(notebookFile, JSON.stringify(notebook, null, 2));
    broadcast('notebook', { notebook, author: b.author, clientId: b.clientId });
    return { ok: true };
  },

  // Process 1
  'POST /api/extract': b => extractContext(b.notebook || notebook),                                    // tool_1 extract
  'POST /api/match': b => matchRules({ prompt: b.prompt, context: b.context, rules: activeRules(b.activeRuleIds) }), // model_1 match
  'POST /api/lint': b => lintPrompt({ prompt: b.prompt, context: b.context, rules: activeRules(b.activeRuleIds), triggered: b.triggered || [] }), // model_2 modify
  'POST /api/generate': b => generateCode({ prompt: b.prompt }),                                         // model_4 generate
  // Process 2
  'POST /api/propose': b => proposeRules({ prompt: b.prompt, context: b.context, rules: activeRules(b.activeRuleIds), triggered: b.triggered || [] }), // model_3 generate
};

function route(method, path) {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const re = new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$');
    const match = path.match(re);
    if (match) return { fn: routes[key], params: match.slice(1).map(decodeURIComponent) };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    const r = route(req.method, url.pathname);
    if (!r) return send(res, 404, { error: 'not found' });
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      if (['POST /api/match', 'POST /api/lint', 'POST /api/propose', 'POST /api/generate'].some(k => k === `${req.method} ${url.pathname}`)) {
        if (!String(body.prompt || '').trim()) throw new Error('prompt is required');
      }
      send(res, 200, await r.fn(body, ...r.params));
    } catch (e) {
      send(res, 400, { error: e.message });
    }
    return;
  }
  const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

server.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
