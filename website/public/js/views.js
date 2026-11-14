// Generic renderer for every analysis page (the server sends cards + charts + notes as JSON).
import { t, api, esc, el, fmt, modal, toast } from './util.js';
import { panel } from './charts.js';
import { S, getQ, qs, drill, showRecords, go, loadMeta, setParams } from './app.js';

const EMPTY = { defects: 'emptyDefects', compliance: 'emptyCompliance', safety: 'emptySafety', home: 'emptyHome' };

function chartCtx(page) {
  return { colors: page.colors, period: page.period ? page.period.label : '', onDrill: drill, onRecords: f => showRecords(f), page };
}

export function deltaHTML(d, cmpLabel) {
  if (!d) return '';
  const cls = d.good === null || d.dir === 'flat' ? 'flat' : d.good ? 'good' : 'bad';
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■';
  const abs = Math.abs(d.abs) < 10 && !Number.isInteger(d.abs) ? fmt(Math.abs(d.abs), 1) : fmt(Math.abs(d.abs), Number.isInteger(d.abs) ? 0 : 1);
  return `<div class="delta ${cls}">${arrow} ${d.dir === 'down' ? '−' : d.dir === 'up' ? '+' : ''}${abs}${d.pct !== null && d.pct !== undefined ? ` (${d.pct >= 0 ? '+' : ''}${fmt(d.pct, 1)}%)` : ''}${cmpLabel ? ` vs ${esc(cmpLabel)}` : ''}</div>`;
}

export function cardEl(c, page) {
  const tag = c.link ? 'a' : 'button';
  const pq = qs(periodQ()).slice(1);
  const href = c.link ? ` href="${esc(c.link + (pq ? (c.link.includes('?') ? '&' : '?') + pq : ''))}" data-link` : ' type="button"';
  const e = el(`<${tag} class="card status-${c.status}"${href} aria-label="${esc(c.label)}: ${esc(c.display)} ${esc(c.unit)}">
    <span class="card-label">${esc(c.label)}</span>
    <span class="card-value">${esc(c.display)}<span class="unit">${esc(c.unit)}</span></span>
    <span class="card-period">${esc(c.period)}</span>
    ${deltaHTML(c.delta, page.compare && page.compare.label)}
    ${c.sub ? `<span class="card-sub" title="${esc(c.sub)}">${esc(c.sub)}</span>` : ''}
  </${tag}>`);
  if (!c.link) e.addEventListener('click', () => openCard(c, page));
  return e;
}
function periodQ() { const q = getQ(); return Object.fromEntries(['mode', 'week', 'day', 'from', 'to', 'cmp', 'cfrom', 'cto', 'fac', 'shift', 'tl'].filter(k => q[k]).map(k => [k, q[k]])); }

/** "No number without a chart": a card opens its trend and breakdown charts. */
function openCard(c, page) {
  const specs = (c.open || []).map(id => page.charts.find(x => x.id === id)).filter(Boolean);
  const body = modal(`${c.label}: ${c.display} ${c.unit}`, null);
  body.append(el(`<div class="kv"><span class="muted">Period</span><span>${esc(c.period)}</span>${c.sub ? `<span class="muted">Detail</span><span>${esc(c.sub)}</span>` : ''}${c.delta ? `<span class="muted">Change</span><span>${deltaHTML(c.delta, page.compare && page.compare.label)}</span>` : ''}</div>`));
  if (!specs.length) body.append(el('<div class="empty">No chart for this number.</div>'));
  const ctx = chartCtx(page);
  ctx.onDrill = (p, v) => { drill(p, v); };
  for (const s of specs) body.append(panel({ ...s, wide: true }, ctx, { noEnlarge: true }));
}

function emptyState(main, page, seg) {
  main.append(el(`<div class="section empty"><h3>No data for ${esc(page.period ? page.period.label : 'this period')}</h3><p>${esc(t(EMPTY[seg] || 'emptyHome'))}</p>
    ${S.meta.user && S.meta.user.role === 'admin' ? '<p><a class="btn primary" href="/admin/upload" data-link>Go to Upload</a></p>' : ''}
    ${S.meta.dataDate ? `<p class="muted">Latest data: ${esc(S.meta.dataDate)}. <a href="${location.pathname}" data-link>Show the most recent week</a></p>` : ''}</div>`));
}

export async function analysisPage(main, route, alive) {
  const q = getQ();
  const page = await api(`/api/page/${route.page}${qs(q)}`);
  if (!alive()) return null;
  S.lastPage = page;
  main.innerHTML = '';
  const back = history.state && history.state.drill ? `<a class="back-link" href="#" id="back-link">← ${t('back')}</a>` : '';
  const head = el(`<div><div class="print-head"><img src="/img/sews-e-logo-wide-indigo.png" height="40" alt="SEWS-E logo" style="height:40px;width:auto"><div><b>${esc((S.meta.company || {}).name || '')} · ${esc(page.title)}</b><div class="muted">${esc(page.period.label)}${page.compare ? ' · compared with ' + esc(page.compare.label) : ''} · ${t('dataUpTo')} ${esc(S.meta.dataDate || '')}</div></div></div>${back}
    <div class="page-head"><div><h1>${esc(page.title)}</h1><div class="period-label">${esc(page.period.label)}${page.compare ? ` · compared with ${esc(page.compare.label)}` : ''}</div></div>
    <div class="page-actions">
      <button class="btn" data-x="xlsx" title="Download this page as an Excel workbook">⬇ ${t('excel')}</button>
      <button class="btn" data-x="pdf" title="Download this page as PDF">⬇ ${t('pdf')}</button>
      ${page.records ? `<button class="btn" data-x="csv" title="Download the filtered raw data as CSV">⬇ ${t('csv')}</button>` : ''}
      <button class="btn" data-x="print" title="Print view (A4 landscape)">🖶 ${t('print')}</button>
    </div></div></div>`);
  main.append(head);
  head.querySelector('#back-link')?.addEventListener('click', e => { e.preventDefault(); history.back(); });
  head.querySelector('.page-actions').addEventListener('click', async e => {
    const x = e.target.closest('button')?.dataset.x; if (!x) return;
    const X = await import('./export.js');
    if (x === 'xlsx') X.pageToExcel(page, route);
    if (x === 'pdf') X.pageToPdf(main, page, route);
    if (x === 'csv') X.recordsCsv(page, route);
    if (x === 'print') X.printPage();
  });
  if (page.tabs) {
    const tabs = el(`<nav class="tabs" role="tablist">${page.tabs.map(tb => `<a role="tab" href="${location.pathname}${qs({ ...q, tab: tb.id === 'total' ? null : tb.id })}" data-link class="${page.tab === tb.id ? 'active' : ''}" aria-selected="${page.tab === tb.id}">${esc(tb.label)}</a>`).join('')}</nav>`);
    main.append(tabs);
  }
  if (!page.hasData) { emptyState(main, page, page.segment); return page; }
  const totalCards = page.segment === 'home' ? 0 : (page.cards || []).length;
  if (page.notes && page.notes.length) main.append(el(`<div class="notes">${page.notes.map(n => `<div class="note warn">${esc(n)}</div>`).join('')}</div>`));
  if (page.segment === 'home') renderHome(main, page);
  else {
    const cards = el('<div class="cards"></div>');
    for (const c of page.cards) cards.append(cardEl(c, page));
    if (totalCards) main.append(cards);
    const grid = el('<div class="grid"></div>');
    const ctx = chartCtx(page);
    for (const s of page.charts) grid.append(panel(s, ctx));
    main.append(grid);
  }
  if (page.records) main.append(recordsPanel(page.records, page));
  return page;
}

function renderHome(main, page) {
  for (const r of page.rows) {
    const sec = el(`<section class="seg-row"><h2>${esc(r.title)} <a href="${esc(r.link)}${qs(periodQ())}" data-link>Open ${esc(r.title.toLowerCase())} ›</a></h2><div class="cards"></div></section>`);
    const cards = sec.querySelector('.cards');
    for (const c of r.cards) cards.append(cardEl(c, page));
    main.append(sec);
  }
  if (page.top3 && page.top3.length) {
    const box = el(`<section class="seg-row"><h2>Top issues of ${esc(page.period.short)}</h2><div class="top3"></div></section>`);
    const pq = qs(periodQ()).slice(1);
    page.top3.forEach((x, i) => box.querySelector('.top3').append(el(`<a class="issue${x.red ? ' red' : ''}" href="${esc(x.link + (pq ? (x.link.includes('?') ? '&' : '?') + pq : ''))}" data-link><span class="n">${x.red ? '!' : i + 1 - (page.top3[0].red ? 1 : 0)}</span><span>${esc(x.text)}</span></a>`)));
    main.append(box);
  }
  const grid = el('<div class="grid"></div>');
  const ctx = chartCtx(page);
  for (const s of page.charts) grid.append(panel(s, ctx));
  main.append(grid);
}

// ---------- records table (server-side paging, sorting and search) ----------
export function recordsPanel(spec, page) {
  const p = el(`<section class="panel wide records-panel" id="records" style="margin-top:14px"><div class="panel-head"><div><h3>${esc(spec.title)}</h3><div class="sub">${esc(page.period.label)} · all filters applied</div></div>
    <div class="panel-actions"><button data-a="csv">${t('csv')}</button><button data-a="xlsx">${t('excel')}</button></div></div>
    <div class="tbl-tools"><input type="search" placeholder="Search in records…" aria-label="Search in records"><span class="muted info"></span></div>
    <div class="tbl-wrap"></div><div class="pager"></div></section>`);
  const st = { page: 1, size: 50, sort: 'date', dir: 'desc', q: '' };
  const wrap = p.querySelector('.tbl-wrap'), pager = p.querySelector('.pager'), info = p.querySelector('.info');
  const baseQ = () => ({ ...getQ(), seg: spec.seg, subset: spec.subset });
  async function load() {
    wrap.innerHTML = '<div class="loading">Loading…</div>';
    const r = await api('/api/records' + qs({ ...baseQ(), page: st.page, size: st.size, sort: st.sort, dir: st.dir, q: st.q }));
    info.textContent = `${fmt(r.total)} records · total ${fmt(r.quantity)} ${spec.seg === 'defects' ? 'defects' : 'cases'}`;
    if (!r.rows.length) { wrap.innerHTML = '<div class="empty">No records match the filters.</div>'; pager.innerHTML = ''; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr>${r.columns.map(c => `<th class="sortable${c.key === 'qty' ? ' num' : ''}" data-k="${c.key}" aria-sort="${st.sort === c.key ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}${st.sort === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row => `<tr>${r.columns.map(c => `<td class="${c.rtl ? 'rtl' : ''}${c.key === 'qty' ? ' num' : ''}" ${c.rtl ? 'dir="rtl"' : ''}>${esc(row[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const pages = Math.max(1, Math.ceil(r.total / st.size));
    pager.innerHTML = `<button class="btn small" data-p="prev" ${st.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${st.page} of ${pages}</span><button class="btn small" data-p="next" ${st.page >= pages ? 'disabled' : ''}>Next ›</button>
      <select aria-label="Rows per page">${[25, 50, 100, 250].map(n => `<option ${n === st.size ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  }
  wrap.addEventListener('click', e => { const th = e.target.closest('th[data-k]'); if (!th) return; const k = th.dataset.k; if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = k; st.dir = 'asc'; } st.page = 1; load(); });
  pager.addEventListener('click', e => { const a = e.target.dataset.p; if (a === 'prev') st.page--; if (a === 'next') st.page++; if (a) load(); });
  pager.addEventListener('change', e => { st.size = Number(e.target.value); st.page = 1; load(); });
  let tm; p.querySelector('input').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 300); });
  p.querySelector('.panel-actions').addEventListener('click', async e => {
    const a = e.target.dataset.a; if (!a) return;
    const X = await import('./export.js');
    if (a === 'csv') X.recordsCsv(page, { page: spec.seg }, spec);
    if (a === 'xlsx') X.recordsExcel(page, spec);
  });
  load().catch(err => { wrap.innerHTML = `<div class="note err">${esc(err.message)}</div>`; });
  return p;
}

// ---------- login ----------
export function loginView(main, next) {
  main.innerHTML = '';
  const f = el(`<form class="section login-box"><h2>${t('login')}</h2>
    <label class="field"><span>${t('username')}</span><input type="text" name="u" autocomplete="username" required></label>
    <label class="field" style="margin-top:8px"><span>PIN</span><input type="password" name="p" inputmode="numeric" autocomplete="current-password" required></label>
    <div class="frow" style="margin-top:12px"><button class="btn primary" type="submit">${t('login')}</button></div>
    <p class="muted" style="font-size:12px">Admins can upload files and change settings. Viewers can view and download.</p></form>`);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: { username: f.u.value, password: f.p.value } }); await loadMeta(); toast('Logged in'); go(next && next !== '/login' ? next : '/'); }
    catch (err) { toast(err.message, true); }
  });
  main.append(f); f.u.focus();
}
export { setParams };
