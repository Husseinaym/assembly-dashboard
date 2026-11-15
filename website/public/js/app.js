// App shell: routing (every page has its own URL), navigation, breadcrumbs, global filter bar, search, presentation mode.
import { t, api, esc, el, fmt, dLabel, dtLabel, addDays, toast, closeModal, icon } from './util.js';
import { disposeAll, redrawAll } from './charts.js';

export const S = { meta: null, options: null, present: null, lastPage: null };

const NAV = [
  { id: 'home', label: t('home'), path: '/' },
  { id: 'defects', label: t('defects'), items: [['/defects', t('overview'), 'OV'], ['/defects/critical', t('critical'), 'CR'], ['/defects/czcf', t('czcf'), 'CZ'], ['/defects/rework', t('rework'), 'RW'], ['/defects/mislocation', t('mislocation'), 'ML']] },
  { id: 'compliance', label: t('compliance'), items: [['/compliance', t('overview'), 'OV'], ['/compliance/operators', t('operators'), 'OP'], ['/compliance/new-operators', t('newOperators'), 'NO'], ['/compliance/team-leaders', t('teamLeaders'), 'TL'], ['/compliance/camera', t('camera'), 'CA']] },
  { id: 'safety', label: t('safety'), items: [['/safety', t('overview'), 'OV'], ['/safety/areas', t('areas'), 'AR'], ['/safety/departments', t('departments'), 'DP'], ['/safety/items', t('items'), 'IT']] },
  { id: 'reports', label: t('reports'), items: [['/reports/weekly', t('weekly'), 'WR'], ['/reports/downloads', t('downloads'), 'DL']] },
  { id: 'admin', label: t('admin'), admin: true, items: [['/admin/upload', t('upload'), 'UP'], ['/admin/history', t('history'), 'HI'], ['/admin/settings', t('settings'), 'ST']] },
];
export const ROUTES = {
  '/': { page: 'home', seg: 'home', title: t('home') },
  '/defects': { page: 'defects', seg: 'defects', title: t('overview') },
  '/defects/critical': { page: 'defects/critical', seg: 'defects', title: t('critical') },
  '/defects/czcf': { page: 'defects/czcf', seg: 'defects', title: t('czcf') },
  '/defects/rework': { page: 'defects/rework', seg: 'defects', title: t('rework') },
  '/defects/mislocation': { page: 'defects/mislocation', seg: 'defects', title: 'Mislocation' },
  '/compliance': { page: 'compliance', seg: 'compliance', title: t('overview') },
  '/compliance/operators': { page: 'compliance/operators', seg: 'compliance', title: t('operators') },
  '/compliance/new-operators': { page: 'compliance/new-operators', seg: 'compliance', title: t('newOperators') },
  '/compliance/team-leaders': { page: 'compliance/team-leaders', seg: 'compliance', title: t('teamLeaders') },
  '/compliance/camera': { page: 'compliance/camera', seg: 'compliance', title: t('camera') },
  '/safety': { page: 'safety', seg: 'safety', title: t('overview') },
  '/safety/areas': { page: 'safety/areas', seg: 'safety', title: t('areas') },
  '/safety/departments': { page: 'safety/departments', seg: 'safety', title: t('departments') },
  '/safety/items': { page: 'safety/items', seg: 'safety', title: t('items') },
  '/reports/weekly': { view: 'weekly', seg: 'reports', title: t('weekly') },
  '/reports/downloads': { view: 'downloads', seg: 'reports', title: t('downloads') },
  '/admin/upload': { view: 'upload', seg: 'admin', title: t('upload'), admin: true },
  '/admin/history': { view: 'history', seg: 'admin', title: t('history'), admin: true },
  '/admin/settings': { view: 'settings', seg: 'admin', title: t('settings'), admin: true },
  '/login': { view: 'login', seg: null, title: t('login') },
};
const SEG_LABEL = { defects: t('defects'), compliance: t('compliance'), safety: t('safety'), reports: t('reports'), admin: t('admin') };
const PERIOD_KEYS = ['mode', 'week', 'day', 'from', 'to', 'cmp', 'cfrom', 'cto'];
const CROSS_KEYS = ['fac', 'shift', 'tl'];
const SEG_KEYS = ['line', 'defect', 'op', 'found', 'station', 'dept', 'area', 'src'];
const LIST_KEYS = ['fac', 'line', 'shift', 'tl', 'defect', 'dept', 'area', 'src', 'op', 'found', 'station'];

// ---------- URL state ----------
export const getQ = () => Object.fromEntries(new URLSearchParams(location.search));
export const qs = q => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
export function routeOf(path) { return ROUTES[(path.replace(/\/+$/, '') || '/')] || null; }
/** Link to another page keeping the period and the filters that make sense there. */
export function linkFor(path, extra = {}) {
  const q = getQ(); const cur = routeOf(location.pathname); const target = routeOf(path.split('?')[0]);
  const keep = {};
  for (const k of [...PERIOD_KEYS, ...CROSS_KEYS]) if (q[k]) keep[k] = q[k];
  if (cur && target && cur.seg === target.seg) for (const k of SEG_KEYS) if (q[k]) keep[k] = q[k];
  return path + qs({ ...keep, ...extra });
}
export function go(url, { replace = false, state = null } = {}) {
  if (replace) history.replaceState(state, '', url); else history.pushState(state, '', url);
  render();
}
export function setParams(obj, opts = {}) {
  const q = { ...getQ(), ...obj };
  for (const [k, v] of Object.entries(obj)) if (v === null || v === '' || v === undefined) delete q[k];
  delete q.page;
  go(location.pathname + qs(q) + (opts.hash || ''), { state: opts.drill ? { drill: true } : null });
}
export function drill(param, value) {
  if (param === 'day') return setParams({ mode: 'day', day: value, week: null, from: null, to: null }, { drill: true });
  if (param === 'week') return setParams({ mode: 'week', week: value, day: null, from: null, to: null }, { drill: true });
  const r = routeOf(location.pathname);
  if (r && r.seg === 'home' && param === 'fac') return go(linkFor('/defects', { fac: value }), { state: { drill: true } });
  setParams({ [param]: value }, { drill: true });
}
export function showRecords(filters) { setParams(filters, { drill: true, hash: '#records' }); }

// ---------- data ----------
export async function loadMeta() {
  S.meta = await api('/api/meta');
  try { S.options = await api('/api/options'); } catch { S.options = {}; }
  const c = S.meta.company || {};
  document.getElementById('brand-company').textContent = c.department || 'Assembly Production Department';
  document.getElementById('brand-sub').textContent = `${t('appName')}${c.site ? ' · ' + c.site : ''}`;
}
export const isAdmin = () => S.meta && S.meta.user && S.meta.user.role === 'admin';

// ---------- nav ----------
function renderNav(path) {
  const nav = document.getElementById('topnav');
  nav.innerHTML = NAV.filter(n => !n.admin || isAdmin()).map(n => {
    if (n.path) return `<div class="nav-item"><a class="nav-link${path === n.path ? ' active' : ''}" href="${linkFor(n.path)}" data-link>${esc(n.label)}</a></div>`;
    const active = n.items.some(i => path === i[0] || path.startsWith(i[0] + '/'));
    return `<div class="nav-item${active ? ' active' : ''}"><button class="nav-btn" aria-haspopup="true" aria-expanded="false">${esc(n.label)} ${icon('chevron', 14)}</button>
      <div class="dropdown" role="menu">${n.items.map(i => `<a role="menuitem" href="${linkFor(i[0])}" data-link class="${path === i[0] ? 'active' : ''}">${esc(i[1])}</a>`).join('')}</div></div>`;
  }).join('');
}
function closeMenus(except) { document.querySelectorAll('.nav-item.open').forEach(n => { if (n !== except) { n.classList.remove('open'); n.querySelector('.nav-btn')?.setAttribute('aria-expanded', 'false'); } }); }
function wireNav() {
  const nav = document.getElementById('topnav');
  nav.addEventListener('click', e => {
    const b = e.target.closest('.nav-btn'); if (!b) return;
    const item = b.parentElement; const open = !item.classList.contains('open');
    closeMenus(item); item.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('keydown', e => {
    const item = e.target.closest('.nav-item'); if (!item) return;
    const links = [...item.querySelectorAll('.dropdown a')];
    if (e.key === 'Escape') { closeMenus(); item.querySelector('.nav-btn, .nav-link')?.focus(); }
    if (e.target.classList.contains('nav-btn') && e.key === 'ArrowDown') { e.preventDefault(); item.classList.add('open'); e.target.setAttribute('aria-expanded', 'true'); links[0]?.focus(); }
    if (e.target.closest('.dropdown') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const i = links.indexOf(e.target); links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { if (e.target.closest('.dropdown')) return; const tops = [...nav.querySelectorAll('.nav-btn, .nav-link')]; const i = tops.indexOf(e.target); if (i >= 0) { e.preventDefault(); tops[(i + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length].focus(); } }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.nav-item')) closeMenus(); if (!e.target.closest('.search')) document.getElementById('search-results').hidden = true; if (!e.target.closest('.msel')) document.querySelectorAll('.msel .pop').forEach(p => p.remove()); });
  const hb = document.getElementById('hamburger');
  hb.addEventListener('click', () => { const open = nav.classList.toggle('open'); hb.setAttribute('aria-expanded', String(open)); });
}

function renderSide(route) {
  const side = document.getElementById('sidemenu');
  const n = route && NAV.find(x => x.id === route.seg && x.items);
  if (!n || (n.admin && !isAdmin())) { side.innerHTML = ''; return; }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  side.innerHTML = `<h3>${esc(n.label)}</h3>` + n.items.map(i => `<a href="${linkFor(i[0])}" data-link class="${path === i[0] ? 'active' : ''}" title="${esc(i[1])}" ${path === i[0] ? 'aria-current="page"' : ''}><span class="ico">${i[2]}</span><span class="lbl">${esc(i[1])}</span></a>`).join('');
}

function renderCrumbs(route, pageTitle) {
  const bc = document.getElementById('breadcrumbs');
  const q = getQ(); const parts = [`<a href="${linkFor('/')}" data-link>${t('home')}</a>`];
  if (route && route.seg && SEG_LABEL[route.seg]) { const first = NAV.find(n => n.id === route.seg); parts.push(`<a href="${linkFor(first.items[0][0])}" data-link>${esc(SEG_LABEL[route.seg])}</a>`); }
  if (route && route.seg !== 'home') parts.push(`<a href="${location.pathname}${qs(Object.fromEntries(PERIOD_KEYS.filter(k => q[k]).map(k => [k, q[k]])))}" data-link>${esc(pageTitle || route.title)}</a>`);
  const levels = [['fac', 'Facility'], ['area', 'Area'], ['dept', 'Department'], ['line', 'Line'], ['defect', 'Defect'], ['op', 'Operator']];
  const acc = Object.fromEntries([...PERIOD_KEYS, 'tab'].filter(k => q[k]).map(k => [k, q[k]]));
  for (const [k] of levels) if (q[k]) { acc[k] = q[k]; parts.push(`<a href="${location.pathname}${qs(acc)}" data-link>${esc(q[k])}</a>`); }
  const last = parts.length - 1;
  bc.innerHTML = parts.map((p, i) => (i === last ? p.replace('<a ', '<a class="current" aria-current="page" ') : p)).join('<span class="sep">›</span>');
}

// ---------- filter bar ----------
function msel(key, label, options, values) {
  const sel = (values || '').split(',').filter(Boolean);
  const box = el(`<div class="msel"><button class="btn" type="button" aria-haspopup="listbox" aria-expanded="false">${esc(label)}: <b>${sel.length ? (sel.length === 1 ? esc(sel[0].length > 18 ? sel[0].slice(0, 17) + '…' : sel[0]) : sel.length + ' selected') : t('all_')}</b> ${icon('chevron', 14)}</button></div>`);
  const btn = box.querySelector('button');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const ex = box.querySelector('.pop'); document.querySelectorAll('.msel .pop').forEach(p => p.remove());
    if (ex) { btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    const pop = el(`<div class="pop" role="listbox" aria-multiselectable="true"><input type="search" placeholder="Search ${esc(label.toLowerCase())}…" aria-label="Search"><div class="opts"></div><div class="frow" style="justify-content:space-between;margin-top:4px"><button class="btn small" data-a="clear">${t('all_')}</button><button class="btn small primary" data-a="ok">Apply</button></div></div>`);
    const opts = pop.querySelector('.opts'); const chosen = new Set(sel);
    const draw = f => { opts.innerHTML = options.filter(o => !f || String(o).toLowerCase().includes(f.toLowerCase())).slice(0, 300).map(o => `<label><input type="checkbox" value="${esc(o)}" ${chosen.has(String(o)) ? 'checked' : ''}> <span>${esc(o)}</span></label>`).join('') || '<div class="muted" style="padding:6px">No values</div>'; };
    draw('');
    pop.querySelector('input[type=search]').addEventListener('input', e2 => draw(e2.target.value));
    opts.addEventListener('change', e2 => { if (e2.target.checked) chosen.add(e2.target.value); else chosen.delete(e2.target.value); });
    pop.addEventListener('click', e2 => { e2.stopPropagation(); const a = e2.target.dataset.a; if (a === 'clear') setParams({ [key]: null }); if (a === 'ok') setParams({ [key]: [...chosen].join(',') }); });
    pop.addEventListener('keydown', e2 => { if (e2.key === 'Escape') { pop.remove(); btn.focus(); } if (e2.key === 'Enter' && e2.target.type !== 'checkbox') setParams({ [key]: [...chosen].join(',') }); });
    box.append(pop); pop.querySelector('input').focus();
  });
  return box;
}

function weekObj(key) { return (S.meta.weeks || []).find(w => w.key === Number(key)); }
function stepWeek(key, dir) {
  const list = (S.meta.weeks || []).map(w => w.key).sort((a, b) => a - b);
  const i = list.indexOf(Number(key));
  if (i >= 0 && list[i + dir] !== undefined) return list[i + dir];
  let y = Math.floor(key / 100), w = (key % 100) + dir; if (w < 1) { y--; w = 52; } if (w > 53) { y++; w = 1; }
  return y * 100 + w;
}

function renderFilters(route) {
  const fb = document.getElementById('filterbar');
  if (!route || (!route.page && route.view !== 'weekly' && route.view !== 'downloads')) { fb.hidden = true; fb.innerHTML = ''; return; }
  fb.hidden = false;
  const q = getQ(); const seg = route.seg; const o = S.options || {};
  const mode = q.mode || (q.day ? 'day' : q.from ? 'range' : 'week');
  const curWeek = Number(q.week) || (S.meta.dataWeek && S.meta.dataWeek.key) || null;
  const row1 = el('<div class="frow"></div>');
  const modeSel = el(`<div class="fgroup"><label for="f-mode">${t('period')}</label><select id="f-mode">${[['week', t('week')], ['day', t('day')], ['range', t('range')], ['mtd', t('mtd')], ['ytd', t('ytd')], ['all', t('all')]].map(([v, l]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`);
  modeSel.querySelector('select').addEventListener('change', e => {
    const m = e.target.value; const latest = S.meta.dataDate;
    if (m === 'week') setParams({ mode: null, day: null, from: null, to: null });
    else if (m === 'day') setParams({ mode: 'day', day: q.day || latest, week: null, from: null, to: null });
    else if (m === 'range') setParams({ mode: 'range', from: q.from || (latest ? addDays(latest, -13) : ''), to: q.to || latest, week: null, day: null });
    else setParams({ mode: m, week: null, day: null, from: null, to: null });
  });
  row1.append(modeSel);
  if (mode === 'week') {
    const weeks = S.meta.weeks || [];
    const opts = weeks.map(w => `<option value="${w.key}" ${w.key === curWeek ? 'selected' : ''}>${w.label} (${dLabel(w.start, false)} – ${dLabel(w.end)})</option>`).join('');
    const g = el(`<div class="fgroup week-nav"><button class="btn" title="${t('prevWeek')}" aria-label="${t('prevWeek')}" data-d="-1">‹</button><select aria-label="${t('week')}">${!weekObj(curWeek) && curWeek ? `<option selected value="${curWeek}">WK${curWeek % 100}</option>` : ''}${opts}</select><button class="btn" title="${t('nextWeek')}" aria-label="${t('nextWeek')}" data-d="1">›</button></div>`);
    g.querySelector('select').addEventListener('change', e => setParams({ week: e.target.value }));
    g.addEventListener('click', e => { const d = e.target.dataset.d; if (d && curWeek) setParams({ week: stepWeek(curWeek, Number(d)) }); });
    row1.append(g);
  } else if (mode === 'day') {
    const day = q.day || S.meta.dataDate || '';
    const g = el(`<div class="fgroup week-nav"><button class="btn" data-d="-1" aria-label="${t('prevDay')}">‹</button><input type="date" value="${day}" aria-label="${t('day')}"><button class="btn" data-d="1" aria-label="${t('nextDay')}">›</button></div>`);
    g.querySelector('input').addEventListener('change', e => setParams({ day: e.target.value }));
    g.addEventListener('click', e => { const d = e.target.dataset.d; if (d && day) setParams({ day: addDays(day, Number(d)) }); });
    row1.append(g);
  } else if (mode === 'range') {
    const g = el(`<div class="fgroup"><input type="date" value="${q.from || ''}" aria-label="From"> – <input type="date" value="${q.to || ''}" aria-label="To"></div>`);
    const [a, b] = g.querySelectorAll('input'); a.addEventListener('change', () => setParams({ from: a.value })); b.addEventListener('change', () => setParams({ to: b.value }));
    row1.append(g);
  }
  if (route.page) {
    const cmp = q.cmp || (mode === 'all' ? 'none' : 'prev');
    const g = el(`<div class="fgroup"><label for="f-cmp">${t('compareWith')}</label><select id="f-cmp">${[['prev', t('cmpPrev')], ['month', t('cmpMonth')], ['custom', t('cmpCustom')], ['none', t('cmpNone')]].map(([v, l]) => `<option value="${v}" ${cmp === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${cmp === 'custom' ? `<input type="date" value="${q.cfrom || ''}" aria-label="Compare from" data-k="cfrom"> – <input type="date" value="${q.cto || ''}" aria-label="Compare to" data-k="cto">` : ''}</div>`);
    g.querySelector('select').addEventListener('change', e => setParams({ cmp: e.target.value === 'prev' ? null : e.target.value }));
    g.querySelectorAll('input').forEach(i => i.addEventListener('change', () => setParams({ [i.dataset.k]: i.value })));
    row1.append(g);
    const row2 = row1;
    row2.append(msel('fac', t('facility'), o.facility || [], q.fac));
    if (seg === 'defects' || seg === 'compliance') row2.append(msel('line', t('line'), o.line || [], q.line));
    if (seg === 'safety') { row2.append(msel('dept', t('dept'), o.dept || [], q.dept)); row2.append(msel('area', t('area'), o.area || [], q.area)); row2.append(msel('line', t('location'), o.location || [], q.line)); }
    if (seg !== 'reports') { row2.append(msel('shift', t('shift'), o.shift || [], q.shift)); row2.append(msel('tl', seg === 'safety' ? t('team') : t('tl'), o.tl || [], q.tl)); }
    if (seg === 'defects') row2.append(msel('defect', t('defect'), o.defect || [], q.defect));
    if (seg === 'compliance') { row2.append(msel('defect', t('violation'), o.violation || [], q.defect)); row2.append(msel('src', t('src'), ['Line', 'Camera'], q.src)); }
    if (seg === 'safety') row2.append(msel('defect', t('item'), o.item || [], q.defect));
    if (seg === 'safety') { const b = el(`<button class="btn" title="Focus on the Assembly department">${q.dept === 'Assembly' ? '✓ ' : ''}Assembly only</button>`); b.addEventListener('click', () => setParams({ dept: q.dept === 'Assembly' ? null : 'Assembly' })); row2.append(b); }
  }
  // chips
  const chips = el('<div class="chips" role="group" aria-label="Active filters"><span class="chip period" id="period-chip"></span></div>');
  const labels = { fac: t('facility'), line: seg === 'safety' ? t('location') : t('line'), shift: t('shift'), tl: seg === 'safety' ? t('team') : t('tl'), defect: seg === 'compliance' ? t('violation') : seg === 'safety' ? t('item') : t('defect'), dept: t('dept'), area: t('area'), src: t('src'), op: t('op'), found: t('found'), station: t('station') };
  let any = false;
  for (const k of LIST_KEYS) for (const v of (q[k] || '').split(',').filter(Boolean)) {
    any = true;
    const c = el(`<span class="chip">${esc(labels[k] || k)}: <b>${esc(v)}</b> <button aria-label="Remove ${esc(labels[k] || k)} ${esc(v)}">×</button></span>`);
    c.querySelector('button').addEventListener('click', () => setParams({ [k]: (q[k] || '').split(',').filter(x => x !== v).join(',') }));
    chips.append(c);
  }
  if (any) { const c = el(`<button class="btn small">${t('clearAll')}</button>`); c.addEventListener('click', () => { const p = {}; for (const k of LIST_KEYS) p[k] = null; setParams(p); }); chips.append(c); }
  // On phones the controls fold into one "Filters" button so the data is visible without scrolling.
  const active = LIST_KEYS.reduce((n, k) => n + (q[k] || '').split(',').filter(Boolean).length, 0);
  const toggle = el(`<button class="btn filter-toggle" type="button" aria-expanded="${filtersOpen}" aria-controls="f-controls">${icon('filter')} ${t('filters')}${active ? ` <span class="count">${active}</span>` : ''}</button>`);
  toggle.addEventListener('click', () => { filtersOpen = !filtersOpen; row1.classList.toggle('open', filtersOpen); toggle.setAttribute('aria-expanded', String(filtersOpen)); });
  row1.id = 'f-controls'; row1.classList.add('fcontrols'); row1.classList.toggle('open', filtersOpen);
  chips.prepend(toggle);
  fb.innerHTML = ''; fb.append(row1, chips);
}
let filtersOpen = false;
export function setPeriodChip(page) {
  const c = document.getElementById('period-chip'); if (!c || !page.period) return;
  c.textContent = `${page.period.label}${page.compare ? ' · compared with ' + page.compare.label : ''}`;
}

// ---------- header tools ----------
function renderUser() {
  const box = document.getElementById('user-box'); const u = S.meta.user;
  if (!u || u.guest) { box.innerHTML = `<span class="muted" style="color:#dbe6ff">${u ? t('guest') : ''}</span><a class="btn small" href="/login?next=${encodeURIComponent(location.pathname + location.search)}" data-link>${t('login')}</a>`; return; }
  box.innerHTML = `<span title="${esc(u.role)}">${esc(u.username)} <small>(${esc(u.role)})</small></span><button class="btn small" id="btn-logout">${t('logout')}</button>`;
  box.querySelector('#btn-logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); await loadMeta(); go('/'); });
}
function renderFooter() {
  const m = S.meta; const f = document.getElementById('footer');
  const dw = m.dataWeek ? `, WK${m.dataWeek.week}` : '';
  f.innerHTML = `<span><b>${t('dataUpTo')}:</b> ${m.dataDate ? dLabel(m.dataDate) + dw : t('noData')}</span><span><b>${t('lastUpload')}:</b> ${m.lastUpload ? dtLabel(m.lastUpload.uploaded_at) + ' · ' + esc(m.lastUpload.file_name) : '–'}</span><span>${esc((m.company || {}).name || '')} ${esc((m.company || {}).site || '')} · ${esc((m.company || {}).department || '')}</span>`;
}
function wireSearch() {
  const inp = document.getElementById('search'), res = document.getElementById('search-results'); let timer;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = inp.value.trim(); if (!q) { res.hidden = true; return; }
    const list = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => []);
    res.innerHTML = list.length ? list.map(r => `<a href="${esc(r.url)}" data-link role="option"><span>${esc(r.label)}</span><span class="type">${esc(r.type)}</span></a>`).join('') : '<div class="muted" style="padding:8px">No match</div>';
    res.hidden = false;
  }, 200); });
  inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); res.querySelector('a')?.focus(); } if (e.key === 'Escape') res.hidden = true; if (e.key === 'Enter') { const a = res.querySelector('a'); if (a) a.click(); } });
  res.addEventListener('keydown', e => { const links = [...res.querySelectorAll('a')]; const i = links.indexOf(e.target); if (e.key === 'ArrowDown') { e.preventDefault(); links[Math.min(i + 1, links.length - 1)].focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) inp.focus(); else links[i - 1].focus(); } if (e.key === 'Escape') { res.hidden = true; inp.focus(); } });
  res.addEventListener('click', () => { res.hidden = true; inp.value = ''; });
}

// ---------- presentation mode ----------
function startPresentation() {
  const pages = (S.meta.presentation && S.meta.presentation.pages) || ['/'];
  const secs = Math.max(5, Number((S.meta.presentation || {}).seconds) || 30);
  const keep = {}; const q = getQ(); for (const k of [...PERIOD_KEYS, ...CROSS_KEYS]) if (q[k]) keep[k] = q[k];
  S.present = { pages, secs, i: 0, keep, left: secs, paused: false };
  document.body.classList.add('present');
  document.documentElement.requestFullscreen?.().catch(() => {});
  go(pages[0] + qs(keep), { replace: true });
  S.present.timer = setInterval(() => {
    const p = S.present; if (!p || p.paused) return;
    p.left--; if (p.left <= 0) { p.i = (p.i + 1) % p.pages.length; p.left = p.secs; go(p.pages[p.i] + qs(p.keep), { replace: true }); }
    presentBar();
  }, 1000);
  presentBar();
}
function stopPresentation() {
  if (!S.present) return; clearInterval(S.present.timer); S.present = null;
  document.body.classList.remove('present'); document.getElementById('present-bar').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(redrawAll, 300);
}
function presentBar() {
  const p = S.present; const b = document.getElementById('present-bar'); if (!p) return;
  b.hidden = false;
  b.innerHTML = `<span>▶ ${t('presentation')} · page ${p.i + 1} of ${p.pages.length} · next in ${p.left}s</span><button class="btn small" data-a="pause">${p.paused ? 'Resume' : 'Pause'}</button><button class="btn small" data-a="next">Next</button><button class="btn small" data-a="exit">${t('exitPresentation')}</button>`;
  b.onclick = e => { const a = e.target.dataset.a; if (a === 'pause') { p.paused = !p.paused; presentBar(); } if (a === 'next') { p.left = 1; } if (a === 'exit') stopPresentation(); };
}

// ---------- render ----------
let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  disposeAll(); closeModal();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = routeOf(path);
  const main = document.getElementById('main');
  renderNav(path); renderUser(); renderFooter(); renderSide(route); renderCrumbs(route); renderFilters(route);
  document.getElementById('topnav').classList.remove('open');
  main.innerHTML = `<div class="loading"><div class="spinner"></div>${t('loading')}</div>`;
  const V = await import('./views.js');
  if (seq !== renderSeq) return;
  try {
    if (!S.meta.user && route?.view !== 'login') return V.loginView(main, location.pathname + location.search);
    if (!route) { main.innerHTML = `<div class="empty"><h3>Page not found</h3><p><a href="/" data-link>Go to the home page</a></p></div>`; return; }
    document.title = `${route.title} · ${t('appName')}`;
    if (route.admin && !isAdmin()) { main.innerHTML = `<div class="empty"><h3>Admin login required</h3><p>Upload, upload history and settings are for admins.</p><p><a class="btn primary" href="/login?next=${encodeURIComponent(location.pathname)}" data-link>${t('login')}</a></p></div>`; return; }
    if (route.page) {
      const page = await V.analysisPage(main, route, () => seq === renderSeq);
      if (page && seq === renderSeq) { renderCrumbs(route, page.title); setPeriodChip(page); document.title = `${page.title} · ${t('appName')}`; }
    } else if (route.view === 'login') V.loginView(main, getQ().next || '/');
    else if (route.view === 'weekly' || route.view === 'downloads') (await import('./reports.js'))[route.view](main);
    else (await import('./admin.js'))[route.view](main);
    if (location.hash === '#records') setTimeout(() => document.getElementById('records')?.scrollIntoView({ behavior: 'smooth' }), 400);
  } catch (e) {
    console.error(e);
    if (e.status === 401) { await loadMeta(); return V.loginView(main, location.pathname + location.search); }
    main.innerHTML = `<div class="note err">Could not load this page: ${esc(e.message)}</div>`;
  }
}

async function start() {
  try { await loadMeta(); } catch (e) { document.getElementById('main').innerHTML = `<div class="note err">The website server is not reachable: ${esc(e.message)}</div>`; return; }
  wireNav(); wireSearch();
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]'); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
    const u = new URL(a.href, location.href); if (u.origin !== location.origin) return;
    e.preventDefault(); go(u.pathname + u.search + u.hash);
  });
  window.addEventListener('popstate', render);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!document.getElementById('modal').hidden) closeModal(); else if (S.present) stopPresentation(); } });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.present) stopPresentation(); });
  document.getElementById('btn-present').addEventListener('click', () => (S.present ? stopPresentation() : startPresentation()));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('pda-theme', next); } catch {}
    redrawAll();
  });
  const q = getQ();
  if (q.present === '1') { history.replaceState(null, '', location.pathname + qs({ ...q, present: null })); startPresentation(); return; }
  render();
}
window.addEventListener('DOMContentLoaded', start);
export { toast, fmt };
