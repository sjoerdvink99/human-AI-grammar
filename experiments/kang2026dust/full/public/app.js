// Frontend: the human steps of the design.
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const fmtWeek = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const ui = { state: null, busy: null, error: null, archiveFilter: 'all', archiveChoice: null, archive: [] };

// ---------------- tabs ----------------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${name}`));
  if (name === 'archive') loadArchive();
  if (name === 'library') loadLibrary();
  if (name === 'week') loadWeek();
}

// ---------------- process 1–3: this week ----------------
async function loadWeek() {
  ui.busy = 'keywords';
  ui.error = null;
  renderWeek();
  try { ui.state = await api('GET', '/api/state'); } catch (e) { ui.error = e.message; }
  ui.busy = null;
  renderWeek();
  renderClock();
}

function renderClock() {
  if (!ui.state) return;
  $('#clock-label').textContent = `Today: ${new Date(ui.state.today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`;
}

function renderWeek() {
  const el = $('#tab-week');
  const s = ui.state;
  if (ui.busy === 'keywords' && !s?.week?.keywords?.length) {
    el.innerHTML = `<div class="loading">Choosing this week's highlight and finding three keywords…</div>`;
    return;
  }
  if (!s) { el.innerHTML = ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''; return; }
  if (!s.highlightCount) {
    el.innerHTML = `<div class="empty card"><h2>No highlights yet</h2><p>Upload the passages you highlighted in your e-books. Every Monday one of them comes back to you as three keywords.</p><button class="primary" id="go-library">Upload highlights</button></div>`;
    $('#go-library').onclick = () => showTab('library');
    return;
  }
  const w = s.week;
  if (!w || w.keywords.length !== 3) {
    el.innerHTML = `<div class="card"><p class="error">Couldn't generate this week's keywords${w?.keywordError ? `: ${esc(w.keywordError)}` : ''}.</p><button id="kw-retry" class="primary">Try again</button></div>`;
    $('#kw-retry').onclick = loadWeek;
    return;
  }

  const kwHtml = `<div class="keywords">${w.keywords.map((k) => `<span class="kw${w.interest && k === w.interest ? ' kw-interest' : ''}">${esc(k)}</span>`).join('')}</div>`;
  const quoteHtml = w.highlight
    ? `<blockquote class="quote revealed">${para(w.highlight.text)}<cite>— ${esc(w.highlight.author || 'Unknown')}, <em>${esc(w.highlight.book)}</em>${w.highlight.location ? ` · ${esc(w.highlight.location)}` : ''}</cite></blockquote>`
    : `<div class="quote hidden-quote" aria-label="Hidden passage"><span>A passage you once highlighted is hidden here.</span><span class="muted">It is revealed after you reflect.</span></div>`;

  let body = '';
  if (!w.remix) {
    // [human generate] response_1
    body = `
      <form id="response-form" class="card">
        <label for="response">What do these three words bring up for you right now?</label>
        <textarea id="response" rows="6" maxlength="3000" placeholder="Write a short reflection…" ${ui.busy ? 'disabled' : ''}>${esc(w.response || ui.draft || '')}</textarea>
        <div class="row"><button class="primary" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'remix' ? 'Remixing…' : 'Reflect & reveal'}</button>
        ${ui.error ? `<span class="error">${esc(ui.error)}</span>` : ''}</div>
      </form>`;
  } else {
    const remixes = w.alternativeRemix
      ? `<div class="compare"><div class="remix"><h3>Remix</h3>${para(w.remix)}</div><div class="remix"><h3>Alternative remix</h3>${para(w.alternativeRemix)}</div></div>`
      : `<div class="remix single"><h3>Your remix</h3>${para(w.remix)}</div>`;
    const retry = w.retryUsed ? '' : `<button id="retry" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'retry' ? 'Writing another…' : 'Try again'}</button><span class="muted small">You can request one alternative.</span>`;
    const next = s.nextWeek?.interest
      ? `<p>Next week's keywords will include <span class="kw kw-interest">${esc(s.nextWeek.interest)}</span>. ${s.nextWeek.ready ? '' : '<span class="error">(keywords still pending)</span>'}</p>`
      : '';
    body = `
      <div class="card reflection"><h3>Your reflection</h3>${para(w.response)}</div>
      ${remixes}
      <div class="row">${retry}${ui.error ? `<span class="error">${esc(ui.error)}</span>` : ''}</div>
      <form id="interest-form" class="card interest">
        <label for="interest">Optional: one word for what you're interested in now. Next week's keywords will include it.</label>
        <div class="row"><input id="interest" maxlength="30" placeholder="e.g. patience" value="${esc(s.nextWeek?.interest || '')}" ${ui.busy ? 'disabled' : ''}>
        <button type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'interest' ? 'Preparing next week…' : 'Set for next week'}</button></div>
        ${next}
      </form>`;
  }

  el.innerHTML = `
    <p class="eyebrow">Week of ${fmtWeek(w.week)}</p>
    ${kwHtml}
    ${quoteHtml}
    ${body}`;

  $('#response-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = $('#response').value;
    ui.draft = text; ui.busy = 'remix'; ui.error = null; renderWeek();
    try { ui.state.week = await api('POST', '/api/week/response', { response: text }); ui.draft = ''; } catch (e) { ui.error = e.message; }
    ui.busy = null; renderWeek();
  });
  $('#retry')?.addEventListener('click', async () => {
    ui.busy = 'retry'; ui.error = null; renderWeek();
    try { ui.state.week = await api('POST', '/api/week/retry'); } catch (e) { ui.error = e.message; }
    ui.busy = null; renderWeek();
  });
  $('#interest-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const interest = $('#interest').value;
    ui.busy = 'interest'; ui.error = null; renderWeek();
    try { ui.state.nextWeek = await api('POST', '/api/next-week/interest', { interest }); } catch (e) { ui.error = e.message; }
    ui.busy = null; renderWeek();
  });
}

// ---------------- process 4: archive ----------------
document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  ui.archiveFilter = b.dataset.filter; // [human select] archive_filter_1
  document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
  loadArchive();
}));

async function loadArchive() {
  try { ui.archive = await api('GET', `/api/archive?filter=${ui.archiveFilter}`); } // [tool select] filtered_highlights_1
  catch (e) { $('#archive-items').innerHTML = `<li class="error">${esc(e.message)}</li>`; return; }
  const list = $('#archive-items');
  list.innerHTML = ui.archive.length ? '' : '<li class="muted">Nothing here yet.</li>';
  for (const h of ui.archive) {
    const li = document.createElement('li');
    li.className = `archive-item${h.id === ui.archiveChoice ? ' active' : ''}`;
    li.innerHTML = `<div class="snippet">${h.hidden ? '<em class="muted">This week’s hidden highlight</em>' : esc(h.text.length > 110 ? `${h.text.slice(0, 110)}…` : h.text)}</div>
      <div class="meta">${esc(h.book)}${h.remixed ? ' · <span class="badge">remixed</span>' : ''}</div>`;
    li.onclick = () => { ui.archiveChoice = h.id; loadArchiveSelection(); }; // [human select] archive_choice_1
    list.appendChild(li);
  }
  loadArchiveSelection();
}

function loadArchiveSelection() {
  document.querySelectorAll('.archive-item').forEach((li, i) => li.classList.toggle('active', ui.archive[i]?.id === ui.archiveChoice));
  const h = ui.archive.find((x) => x.id === ui.archiveChoice);
  $('#archive-view').innerHTML = h ? renderArchiveView(h) : '<p class="muted">Select a highlight to revisit it.</p>';
}

/** [tool translate] archive_choice_1 -> archive_view_1 */
function renderArchiveView(h) {
  const head = h.hidden
    ? '<div class="quote hidden-quote"><span>This is this week’s highlight. Reflect on it first to reveal it.</span></div>'
    : `<blockquote class="quote revealed">${para(h.text)}<cite>— ${esc(h.author || 'Unknown')}, <em>${esc(h.book)}</em>${h.location ? ` · ${esc(h.location)}` : ''}</cite></blockquote>`;
  const meta = `<p class="muted small">Added ${new Date(h.addedAt).toLocaleDateString()} · resurfaced ${h.weeks.length} time${h.weeks.length === 1 ? '' : 's'}</p>`;
  const weeks = h.weeks.map((w) => `
    <section class="archive-week">
      <p class="eyebrow">Week of ${fmtWeek(w.week)}</p>
      ${w.keywords.length ? `<div class="keywords small">${w.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join('')}</div>` : ''}
      ${w.response ? `<h4>Reflection</h4>${para(w.response)}` : '<p class="muted">No reflection written.</p>'}
      ${w.remix ? `<h4>Remix</h4><div class="remix">${para(w.remix)}</div>` : ''}
      ${w.alternativeRemix ? `<h4>Alternative remix</h4><div class="remix">${para(w.alternativeRemix)}</div>` : ''}
    </section>`).join('');
  return head + meta + (weeks || '<p class="muted">Not resurfaced yet.</p>');
}

// ---------------- library (upload: highlights_1) ----------------
async function loadLibrary() {
  const lib = await api('GET', '/api/library');
  const byBook = new Map();
  for (const h of lib) {
    const key = `${h.book}|${h.author}`;
    byBook.set(key, { book: h.book, author: h.author, n: (byBook.get(key)?.n || 0) + 1 });
  }
  $('#library-summary').textContent = `${lib.length} highlight${lib.length === 1 ? '' : 's'} from ${byBook.size} book${byBook.size === 1 ? '' : 's'}.`;
  $('#library-books').innerHTML = [...byBook.values()].sort((a, b) => b.n - a.n)
    .map((b) => `<li><em>${esc(b.book)}</em>${b.author ? ` — ${esc(b.author)}` : ''} <span class="muted">(${b.n})</span></li>`).join('');
}

async function upload(content, filename) {
  $('#upload-status').textContent = 'Uploading…';
  try {
    const r = await api('POST', '/api/highlights', { content, filename });
    $('#upload-status').textContent = `Added ${r.added} highlight${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} duplicates skipped)` : ''}.`;
    $('#upload-text').value = '';
    $('#upload-file').value = '';
    loadLibrary();
  } catch (e) { $('#upload-status').textContent = e.message; }
}

$('#upload-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const file = $('#upload-file').files[0];
  if (file) return upload(await file.text(), file.name);
  if ($('#upload-text').value.trim()) return upload($('#upload-text').value, 'pasted.txt');
  $('#upload-status').textContent = 'Choose a file or paste some highlights.';
});
$('#load-sample').addEventListener('click', async () => upload(await (await fetch('/sample-highlights.txt')).text(), 'sample-highlights.txt'));

// ---------------- demo clock ----------------
$('#next-monday').addEventListener('click', async () => { await api('POST', '/api/demo/next-monday'); showTab('week'); });
$('#reset-clock').addEventListener('click', async () => { await api('POST', '/api/demo/reset-clock'); showTab('week'); });

loadWeek();
