import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractContext, composeRules } from './tools.js';
import { matchRules, modifyPrompt, generateCode, proposeRules } from './models.js';
import { RulesStore } from './rulesStore.js';
import { SAMPLE_NOTEBOOK } from './sample.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5173);
const store = new RulesStore(process.env.RULES_FILE || path.join(root, 'data', 'rules.json'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const routes = {
  'GET /api/rules': () => store.state(),
  'GET /api/sample-notebook': () => SAMPLE_NOTEBOOK,
  // Process 3: human modify rules_2 -> rules_3
  'PUT /api/rules': (b) => store.commit(b.rules, 'edited by user', b.newIds || []),
  // Process 4: human select rules_2 -> active_rules_1
  'PUT /api/rules/active': (b) => store.setActive(b.ids || []),
  'POST /api/rules/revert': (b) => store.revert(b.version),
  // Process 1
  'POST /api/extract': (b) => ({ context: extractContext(b.notebook) }), // tool_1 extract
  'POST /api/match': async (b) => {
    // model_1 match against the active rules (rules_1 snapshot is returned so later steps use the same rules)
    const rules = store.activeRules();
    const triggered = await matchRules({ context: b.context, rules, prompt: requireText(b.prompt) });
    return { rules, rules_version: store.current().version, triggered };
  },
  'POST /api/modify': async (b) => {
    // model_2 modify~
    if (!b.triggered?.length) return { prompt: b.prompt, lint_messages: [], skipped: true };
    return modifyPrompt({ context: b.context, rules: b.rules, prompt: requireText(b.prompt), triggered: b.triggered });
  },
  'POST /api/generate-code': async (b) => ({ code: await generateCode({ prompt: requireText(b.prompt) }) }), // model_4 generate~
  // Process 2
  'POST /api/propose-rules': async (b) => ({
    proposals: await proposeRules({ prompt: requireText(b.prompt), context: b.context, triggered: b.triggered || [], rules: b.rules || [] }),
  }), // model_3 generate~
  'POST /api/compose-rules': (b) => {
    // tool_2 compose: accepted_rules_1 + rules -> rules_2 (newly added rules become active)
    const { rules, added } = composeRules(store.current().rules, b.accepted || []);
    return store.commit(rules, `added ${added.length} proposed rule(s)`, added);
  },
};

function requireText(s) {
  const t = String(s || '').trim();
  if (!t) throw Object.assign(new Error('Prompt is empty'), { status: 400 });
  return t;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    const t0 = Date.now();
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const result = await routes[key](body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      console.log(`${key} ${Date.now() - t0}ms`);
    } catch (e) {
      console.error(`${key} failed:`, e.message);
      res.writeHead(e.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
