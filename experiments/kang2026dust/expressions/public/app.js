// Frontend state and interactions. Names follow the design identifiers.
import { renderCard } from './card.js';

const $ = (id) => document.getElementById(id);

const state = {
  highlights: [],        // highlights_1 (collection)
  highlight: null,       // highlight_1 / highlight_2
  highlightOrigin: '',   // 'resurfaced' | interest text
  keywords: [],          // keywords_1 / keywords_2
  response: '',          // response_1
  entry: null,           // { remix (remix_1), alternatives[] (alternative_remix_1…) }
  interest: '',          // interest_1
  archiveFilter: 'All sources',  // archive_filter_1
  filteredHighlights: [],        // filtered_highlights_1
  archiveChoice: null,           // archive_choice_1 { highlightId, entryId, version }
};

let retryStyles = [];
const STYLE_LABEL = {
  shorter: 'Shorter',
  'more-poetic': 'More poetic',
  'more-concrete': 'More concrete',
  'different-angle': 'Different angle',
  'closer-to-my-words': 'Closer to my words',
};

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 5000);
}

async function busy(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- Today: processes 1–3 ----------

function renderHighlight() {
  const h = state.highlight;
  $('highlight').innerHTML = h
    ? `<blockquote>“${esc(h.text)}”</blockquote><cite>— ${esc(h.author || 'Unknown')}, <em>${esc(h.source)}</em>${h.location ? ` · ${esc(h.location)}` : ''}</cite>`
    : '<p class="muted">No highlights in your collection.</p>';
  $('highlight-origin').textContent = state.highlightOrigin
    ? state.highlightOrigin === 'resurfaced'
      ? `Resurfaced · seen ${h.surfacedCount}×${h.entries?.length ? ` · ${h.entries.length} earlier remix(es) in Archive` : ''}`
      : `Picked for your interest: “${state.highlightOrigin}”`
    : '';
}

function renderKeywords(loading) {
  const el = $('keywords');
  if (loading) return (el.innerHTML = '<span class="loading">Finding keywords</span>');
  el.innerHTML = state.keywords.map((k) => `<button class="chip" data-k="${esc(k)}">${esc(k)}</button>`).join('');
}

function renderRemix(loadingWhat) {
  const block = $('remix-block');
  const e = state.entry;
  if (!e && !loadingWhat) return block.classList.add('hidden');
  block.classList.remove('hidden');
  const cards = [];
  if (e) {
    cards.push(`<div class="remix original"><span class="tag">Remix</span>${esc(e.remix)}</div>`);
    for (const a of e.alternatives)
      cards.push(`<div class="remix"><span class="tag">Alternative · ${esc(STYLE_LABEL[a.style] || a.style)}</span>${esc(a.text)}</div>`);
  }
  if (loadingWhat) cards.push(`<div class="remix"><span class="loading">${loadingWhat}</span></div>`);
  $('remixes').innerHTML = cards.join('');
  $('retry-buttons').innerHTML = retryStyles
    .map((s) => `<button class="chip" data-retry="${s}" ${!e || loadingWhat ? 'disabled' : ''}>${STYLE_LABEL[s] || s}</button>`)
    .join('');
  // Processes 3 and 4 continue from remix_1
  $('interest-block').classList.toggle('hidden', !e);
}

function renderStats() {
  const n = state.highlights.length;
  const remixed = state.highlights.filter((h) => h.entries?.length).length;
  $('stats').textContent = `${n} highlights · ${remixed} remixed`;
}

function setHighlight(h, origin) {
  state.highlight = h;
  state.highlightOrigin = origin;
  state.keywords = [];
  state.response = '';
  state.entry = null;
  $('response').value = '';
  updateCount();
  renderHighlight();
  renderRemix();
}

// P1.2 / P3.3 [model generate]~ -> keywords
async function loadKeywords(interest) {
  if (!state.highlight) return;
  const forId = state.highlight.id;
  renderKeywords(true);
  try {
    const { keywords } = await api('POST', '/api/keywords', { highlightId: forId, interest });
    if (state.highlight?.id === forId) state.keywords = keywords;
  } catch (e) {
    toast('Keywords failed: ' + e.message);
  }
  renderKeywords();
}

// P1.1 [tool select] -> highlight_1
async function surface() {
  const h = await api('POST', '/api/surface', { excludeId: state.highlight?.id });
  setHighlight(h, 'resurfaced');
  await loadKeywords();
}

function updateCount() {
  const w = $('response').value.trim().split(/\s+/).filter(Boolean).length;
  $('response-count').textContent = `${w} word${w === 1 ? '' : 's'}`;
}

// P1.3 [human generate] -> response_1 (typing), then P1.4 [model compose]~ -> remix_1
async function remix() {
  state.response = $('response').value.trim();
  if (state.response.length < 3) return toast('Write a response first.');
  state.entry = null;
  renderRemix('Composing remix');
  try {
    state.entry = await api('POST', '/api/remix', {
      highlightId: state.highlight.id,
      keywords: state.keywords,
      response: state.response,
    });
    await refreshHighlights();
  } catch (e) {
    toast('Remix failed: ' + e.message);
  }
  renderRemix();
}

// P2.1 [human specify] -> retry_1, P2.2 [model compose]~ -> alternative_remix_1
async function retry(style) {
  renderRemix(`Composing alternative (${STYLE_LABEL[style]})`);
  try {
    state.entry = await api('POST', '/api/alternative', { entryId: state.entry.id, retry: style });
  } catch (e) {
    toast('Alternative failed: ' + e.message);
  }
  renderRemix();
}

// P3.1 [human specify] -> interest_1, P3.2 [tool select] -> highlight_2, P3.3 -> keywords_2
async function followInterest(ev) {
  ev.preventDefault();
  state.interest = $('interest').value.trim();
  if (!state.interest) return toast('Say what you are interested in.');
  const btn = ev.submitter || $('interest-form').querySelector('button');
  await busy(btn, async () => {
    const { highlight, score } = await api('POST', '/api/select-by-interest', {
      interest: state.interest,
      excludeId: state.entry?.highlightId,
    });
    setHighlight(highlight, state.interest);
    if (!score) toast('Nothing matched closely — resurfaced a highlight instead.');
    await loadKeywords(state.interest);
  });
}

async function refreshHighlights() {
  state.highlights = await api('GET', '/api/highlights');
  renderStats();
}

// ---------- Archive: process 4 ----------

async function loadArchive() {
  const filters = await api('GET', '/api/archive/filters');
  if (!filters.includes(state.archiveFilter)) state.archiveFilter = filters[0];
  $('filters').innerHTML = filters
    .map((f) => `<button class="chip ${f === state.archiveFilter ? 'active' : ''}" data-filter="${esc(f)}">${esc(f)}</button>`)
    .join('');
  // P4.2 [tool select] -> filtered_highlights_1
  state.filteredHighlights = await api('POST', '/api/archive', { filter: state.archiveFilter });
  renderArchiveList();
}

function renderArchiveList() {
  const list = state.filteredHighlights
    .slice()
    .sort((a, b) => (b.entries.at(-1)?.createdAt || '').localeCompare(a.entries.at(-1)?.createdAt || ''));
  $('archive-list').innerHTML = list
    .map(
      (h) => `<li data-id="${h.id}" class="${state.archiveChoice?.highlightId === h.id ? 'selected' : ''}">
        <div>“${esc(h.text)}”</div>
        <div class="meta">${esc(h.author || '')} · ${esc(h.source)}${h.entries.length ? `<span class="badge">${h.entries.length} remix${h.entries.length > 1 ? 'es' : ''}</span>` : ''}</div>
      </li>`
    )
    .join('');
}

// P4.3 [human select] -> archive_choice_1, P4.4 [tool translate] -> archive_view_1
function showArchiveView() {
  const c = state.archiveChoice;
  const h = state.filteredHighlights.find((x) => x.id === c?.highlightId);
  const view = $('archive-view');
  if (!h) return (view.innerHTML = '<p class="muted small">Pick an item to render it as a card.</p>');
  const options = [];
  for (const e of h.entries.slice().reverse()) {
    const d = new Date(e.createdAt).toLocaleString();
    options.push({ entryId: e.id, version: -1, label: `${d} · remix` });
    e.alternatives.forEach((a, i) => options.push({ entryId: e.id, version: i, label: `${d} · ${STYLE_LABEL[a.style] || a.style}` }));
  }
  const entry = h.entries.find((e) => e.id === c.entryId);
  const remixText = entry ? (c.version >= 0 ? entry.alternatives[c.version].text : entry.remix) : null;
  const url = renderCard(h, entry ? { ...entry, remixText } : null);
  view.innerHTML = `
    ${options.length ? `<select id="version">${options
      .map((o) => `<option value="${o.entryId}|${o.version}" ${o.entryId === c.entryId && o.version === c.version ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>` : '<p class="muted small">Not remixed yet — showing the highlight only.</p>'}
    <img alt="Card for highlight" src="${url}" />
    <div class="row"><span></span><a href="${url}" download="highlight-${h.id}.png"><button>Download PNG</button></a></div>`;
  $('version')?.addEventListener('change', (ev) => {
    const [entryId, v] = ev.target.value.split('|');
    state.archiveChoice = { highlightId: h.id, entryId, version: Number(v) };
    showArchiveView();
  });
}

// ---------- wiring ----------

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== t.dataset.view));
    if (t.dataset.view === 'archive') await loadArchive().catch((e) => toast(e.message));
  })
);

$('next-highlight').addEventListener('click', (ev) => busy(ev.currentTarget, surface));
$('regen-keywords').addEventListener('click', (ev) =>
  busy(ev.currentTarget, () => loadKeywords(state.highlightOrigin !== 'resurfaced' ? state.highlightOrigin : undefined))
);
$('keywords').addEventListener('click', (ev) => {
  const k = ev.target.dataset?.k;
  if (!k) return;
  const ta = $('response');
  ta.value = ta.value + (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + k;
  ta.focus();
  updateCount();
});
$('response').addEventListener('input', updateCount);
$('remix-btn').addEventListener('click', (ev) => busy(ev.currentTarget, remix));
$('retry-buttons').addEventListener('click', (ev) => {
  const s = ev.target.dataset?.retry;
  if (s && state.entry) retry(s);
});
$('interest-form').addEventListener('submit', followInterest);
$('filters').addEventListener('click', async (ev) => {
  const f = ev.target.dataset?.filter;
  if (!f) return;
  state.archiveFilter = f; // P4.1 [human select] -> archive_filter_1
  state.archiveChoice = null;
  showArchiveView();
  await loadArchive().catch((e) => toast(e.message));
});
$('archive-list').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  const h = state.filteredHighlights.find((x) => x.id === li.dataset.id);
  const latest = h.entries.at(-1);
  state.archiveChoice = { highlightId: h.id, entryId: latest?.id, version: -1 };
  renderArchiveList();
  showArchiveView();
});

(async function init() {
  try {
    retryStyles = await api('GET', '/api/retry-styles');
    await refreshHighlights();
    await surface();
  } catch (e) {
    toast(e.message);
  }
})();
