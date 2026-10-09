// HTTP server: static frontend + streaming (NDJSON) endpoints for the three processes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getMemory, getPolicy, saveVersioned, load, putSession, getSession, resetAll } from './store.js';
import { runProcess1 } from './process1.js';
import { runProcess2 } from './process2.js';
import { runProcess3A, runProcess3B } from './process3.js';
import { CATALOG, AXES } from './catalog.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 5173);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
/** Stream each process step as one JSON line; finish with {type:'done'} or {type:'error'}. */
async function stream(res, fn) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
  const emit = (step, data) => res.write(JSON.stringify({ type: 'step', step, data }) + '\n');
  try {
    const result = await fn(emit);
    res.write(JSON.stringify({ type: 'done', data: result }) + '\n');
  } catch (e) {
    console.error(e);
    res.write(JSON.stringify({ type: 'error', message: e.message }) + '\n');
  }
  res.end();
}

const routes = [
  ['GET', /^\/api\/state$/, (req, res) => json(res, 200, {
    preference_memory: getMemory(), retrieval_policy: getPolicy(),
    preference_memory_history: load('preference_memory.history', () => []),
    retrieval_policy_history: load('retrieval_policy.history', () => []),
    catalog: CATALOG, axes: AXES,
  })],
  ['POST', /^\/api\/reset$/, (req, res) => { resetAll(); json(res, 200, { ok: true }); }],

  // Process 1
  ['POST', /^\/api\/generate$/, async (req, res) => {
    const { request } = await readBody(req);
    const id = crypto.randomUUID().slice(0, 8);
    await stream(res, async (emit) => {
      const out = await runProcess1({ sessionId: id, request, memory: getMemory(), policy: getPolicy() }, emit);
      const session = putSession({ id, ...out, scene_history: [], learned: false });
      return { session_id: id, scene: session.scene, retrieval_trace: session.retrieval_trace, interaction_log: session.interaction_log };
    });
  }],

  // Process 2 (one round of the select + speak loop)
  ['POST', /^\/api\/sessions\/([\w-]+)\/edit$/, async (req, res, [, id]) => {
    const session = getSession(id);
    if (!session) return json(res, 404, { error: 'unknown session' });
    const body = await readBody(req);
    await stream(res, async (emit) => {
      const { scene, event } = await runProcess2(session, body, emit);
      session.scene_history.push(session.scene);
      session.scene = scene;
      session.interaction_log.events.push(event);
      putSession(session);
      return { scene, interaction_log: session.interaction_log, can_undo: true };
    });
  }],
  ['POST', /^\/api\/sessions\/([\w-]+)\/undo$/, async (req, res, [, id]) => {
    const session = getSession(id);
    if (!session?.scene_history.length) return json(res, 400, { error: 'nothing to undo' });
    session.scene = session.scene_history.pop();
    session.interaction_log.events.push({ t: Date.now(), type: 'undo' });
    putSession(session);
    json(res, 200, { scene: session.scene, interaction_log: session.interaction_log, can_undo: session.scene_history.length > 0 });
  }],

  // Process 3, part A: payload -> ... -> preference_memory_2
  ['POST', /^\/api\/sessions\/([\w-]+)\/learn$/, async (req, res, [, id]) => {
    const session = getSession(id);
    if (!session) return json(res, 404, { error: 'unknown session' });
    await stream(res, async (emit) => {
      const memory2 = await runProcess3A(session, getMemory(), emit);
      saveVersioned('preference_memory', memory2);
      return { preference_memory: memory2 };
    });
  }],
  // Process 3, part B: topdown_view_1 (rendered by the frontend's tool_2) -> signals -> rewards -> retrieval_policy_2
  ['POST', /^\/api\/sessions\/([\w-]+)\/evaluate$/, async (req, res, [, id]) => {
    const session = getSession(id);
    if (!session) return json(res, 404, { error: 'unknown session' });
    const { topdown_view } = await readBody(req);
    await stream(res, async (emit) => {
      const policy2 = await runProcess3B(session, topdown_view, getPolicy(), emit);
      saveVersioned('retrieval_policy', policy2);
      session.learned = true;
      putSession(session);
      return { retrieval_policy: policy2 };
    });
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const [method, re, handler] of routes) {
    const m = url.pathname.match(re);
    if (m && req.method === method) {
      try { return await handler(req, res, m); } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
    }
  }
  if (req.method !== 'GET') return json(res, 404, { error: 'not found' });
  const p = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

server.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
