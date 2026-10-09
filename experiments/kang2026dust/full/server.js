// HTTP server: JSON API + static frontend. No dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { Service, HttpError } from './lib/service.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const service = new Service(new Store(process.env.STORE_FILE || path.join(ROOT, 'data', 'store.json')));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000_000) throw new HttpError(413, 'Upload too large');
  }
  return raw ? JSON.parse(raw) : {};
}

const routes = {
  'GET /api/state': () => service.state(),
  'GET /api/library': () => service.library(),
  'POST /api/highlights': (b) => service.upload(b.content, b.filename, { book: b.book, author: b.author }),
  'POST /api/week/response': (b) => service.respond(b.response),
  'POST /api/week/retry': () => service.retry(),
  'POST /api/next-week/interest': (b) => service.setInterest(b.interest),
  'GET /api/archive': (_b, url) => service.archive(url.searchParams.get('filter') || 'all'),
  'POST /api/demo/next-monday': () => { service.advanceToNextMonday(); return service.state(); },
  'POST /api/demo/reset-clock': () => { service.resetClock(); return service.state(); },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(res, 200, await handler(body, url));
    } catch (e) {
      console.error(e);
      send(res, e.status || 500, { error: e.message });
    }
    return;
  }
  if (req.method !== 'GET') return send(res, 404, { error: 'Not found' });
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
