// HTTP server: static frontend + JSON API. Each endpoint is named after the design step it implements.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { selectHighlight, selectByInterest, filterHighlights, filterOptions } from './tools.js';
import * as ops from './operations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(root, 'public');
const store = createStore(
  process.env.STORE_FILE || path.join(root, 'data', 'store.json'),
  path.join(root, 'data', 'seed.json')
);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

const withEntries = (h) => h && { ...h, entries: store.entriesFor(h.id) };

const routes = {
  // highlights_1 collection
  'GET /api/highlights': () => store.highlights().map(withEntries),

  // P1.1 [tool select] -> highlight_1
  'POST /api/surface': ({ excludeId }) => {
    const h = selectHighlight(store.highlights(), { excludeId });
    if (!h) throw Object.assign(new Error('No highlights'), { status: 404 });
    return withEntries(store.markSurfaced(h.id));
  },

  // P1.2 / P3.3 [model generate]~ -> keywords
  'POST /api/keywords': async ({ highlightId, interest }) => {
    const h = need(store.highlight(highlightId), 'highlight');
    return { keywords: await ops.generateKeywords(h, interest && String(interest).trim()) };
  },

  // P1.4 [model compose]~ -> remix_1 (stored with response_1 as an entry)
  'POST /api/remix': async ({ highlightId, keywords, response }) => {
    const h = need(store.highlight(highlightId), 'highlight');
    const resp = String(response || '').trim();
    if (resp.length < 3) throw Object.assign(new Error('Write a response first'), { status: 400 });
    const kw = Array.isArray(keywords) ? keywords.map(String) : [];
    const remix = await ops.composeRemix(h, kw, resp);
    return store.addEntry({ highlightId: h.id, keywords: kw, response: resp, remix });
  },

  // P2.2 [model compose]~ -> alternative_remix_1
  'POST /api/alternative': async ({ entryId, retry }) => {
    const e = need(store.entry(entryId), 'entry');
    if (!ops.RETRY_STYLES[retry]) throw Object.assign(new Error('Unknown retry style'), { status: 400 });
    const h = need(store.highlight(e.highlightId), 'highlight');
    const text = await ops.composeAlternative(h, e.response, e.remix, retry);
    return store.addAlternative(e.id, { style: retry, text });
  },

  // P3.2 [tool select] -> highlight_2
  'POST /api/select-by-interest': ({ interest, excludeId }) => {
    const i = String(interest || '').trim();
    if (!i) throw Object.assign(new Error('Say what you are interested in'), { status: 400 });
    const { highlight, score } = selectByInterest(store.highlights(), i, { excludeId });
    if (!highlight) throw Object.assign(new Error('No highlights'), { status: 404 });
    return { highlight: withEntries(store.markSurfaced(highlight.id)), score };
  },

  // P4.1 options for archive_filter_1, P4.2 [tool select] -> filtered_highlights_1
  'GET /api/archive/filters': () => filterOptions(store.highlights()),
  'POST /api/archive': ({ filter }) => filterHighlights(store.highlights(), filter).map(withEntries),

  'GET /api/retry-styles': () => Object.keys(ops.RETRY_STYLES),
};

function need(x, what) {
  if (!x) throw Object.assign(new Error(`Unknown ${what}`), { status: 404 });
  return x;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      send(res, 200, await handler(req.method === 'POST' ? await readBody(req) : {}));
    } catch (e) {
      console.error(e);
      send(res, e.status || 502, { error: e.message });
    }
    return;
  }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => console.log(`System X running at http://localhost:${PORT}`));
