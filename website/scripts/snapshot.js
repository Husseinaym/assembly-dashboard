'use strict';
/**
 * Builds ONE self-contained HTML file with the dashboards of a week (cards, charts, analysis text, SEWS-E logo).
 * It opens offline in any browser and can be e-mailed or shared; no server needed.
 *   node scripts/snapshot.js                 -> latest week, saved in ../Exports/
 *   node scripts/snapshot.js --week 202646
 */
const fs = require('fs');
const path = require('path');
const DB = require('../server/db');
const PG = require('../server/pages');

const W = DB.PATHS.website;
const args = process.argv.slice(2); const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const config = JSON.parse(fs.readFileSync(path.join(W, 'config.json'), 'utf8'));
const db = DB.open(path.resolve(W, process.env.PDA_DB || config.db));
const q = arg('--week') ? { week: arg('--week') } : {};

// [page id, label, extra query, menu group] - grouped like the website's menus
const PAGES = [
  ['home', 'Home', {}, 'Home'],
  ['defects', 'Overview', {}, 'Defects'], ['defects/critical', 'Critical defects', {}, 'Defects'], ['defects/czcf', 'CZCF', {}, 'Defects'],
  ['defects/rework', 'Rework', {}, 'Defects'], ['defects/mislocation', 'Mislocation', {}, 'Defects'], ['defects/mislocation', 'Mislocation control chart', { tab: 'control' }, 'Defects'],
  ['compliance', 'Overview', {}, 'Compliance'], ['compliance/team-leaders', 'Team leaders', {}, 'Compliance'], ['compliance/operators', 'Operators', {}, 'Compliance'],
  ['safety', 'Overview', {}, 'Safety'], ['safety/areas', 'Areas', {}, 'Safety'], ['safety/items', 'Non-compliance items', {}, 'Safety'],
];
const pages = PAGES.map(([id, label, extra, group]) => ({ label, group, page: PG.buildPage(db, id, { ...q, ...extra }) }));
const company = DB.getSettings(db).company || {};
db.close();

const read = p => fs.readFileSync(path.join(W, p), 'utf8');
const b64 = p => fs.readFileSync(path.join(W, p)).toString('base64');
const util = read('public/js/util.js').replace(/^import .*$/m, '').replace("export const t = k => L[k] ?? k;", 'const t = k => ({ png: "PNG", viewData: "Data", excel: "Excel", enlarge: "Enlarge" })[k] ?? k;').replace(/^export /gm, '');
const charts = read('public/js/charts.js').replace(/^import .*$/m, '').replace(/^export /gm, '');
const css = read('public/css/app.css');
const echarts = fs.readFileSync(path.join(W, 'node_modules/echarts/dist/echarts.min.js'), 'utf8');
const P0 = pages[0].page.period;
const stamp = new Date();
const p2 = n => String(n).padStart(2, '0');
const title = `${company.department || 'Assembly Production Department'} – ${P0.short} snapshot`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:image/png;base64,${b64('public/img/sews-e-icon.png')}">
<style>${css}
.snap-note{background:#fff8e1;border:1px solid #f5d77a;color:#5c4400;border-radius:8px;padding:6px 12px;font-size:12.5px;margin-bottom:12px}
.panel-actions [data-act=xlsx], .panel-actions [data-act=big]{display:none}
.topnav button.nav-link{cursor:pointer}
</style></head>
<body>
<header class="topbar"><div class="topbar-main">
 <span class="brand"><img src="data:image/png;base64,${b64('public/img/sews-e-logo-wide-white.png')}" alt="Sumitomo Electric Wiring Systems (Europe) Ltd" class="brand-logo"><span class="brand-divider"></span>
 <span class="brand-text"><strong>${company.department || 'Assembly Production Department'}</strong><span>Production Data Analysis · ${company.site || ''}</span></span></span>
 <div class="top-tools"><span style="font-size:13px;opacity:.9">${P0.label}</span></div></div>
 <nav id="topnav" class="topnav" aria-label="Pages"></nav></header>
<div class="subbar"><span class="breadcrumbs" id="crumb"></span></div>
<div class="layout"><aside id="sidemenu" class="sidemenu"></aside><main id="main" class="main"></main></div>
<footer class="footer"><span><b>Snapshot:</b> ${P0.label}${pages[0].page.compare ? ' · compared with ' + pages[0].page.compare.label : ''}</span><span>Created ${stamp.getDate()}/${p2(stamp.getMonth() + 1)}/${stamp.getFullYear()} ${p2(stamp.getHours())}:${p2(stamp.getMinutes())} from the Production Data Analysis website</span><span>${company.name || 'SEWS-E'} ${company.site || ''} · ${company.department || ''}</span></footer>
<div id="modal" class="modal" hidden><div class="modal-box"><div class="modal-head"><h2 id="modal-title"></h2><button class="icon-btn" id="modal-close">✕</button></div><div id="modal-body" class="modal-body"></div></div></div>
<div id="toast" class="toast" hidden></div>
<script>${echarts}</script>
<script>window.SNAP = ${JSON.stringify(pages).replace(/</g, '\\u003c')};</script>
<script type="module">
${util}
${charts}
const esc2 = esc;
function deltaHTML(d, cmp) {
  if (!d) return '';
  const cls = d.good === null || d.dir === 'flat' ? 'flat' : d.good ? 'good' : 'bad';
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■';
  return '<div class="delta ' + cls + '">' + arrow + ' ' + (d.dir === 'down' ? '−' : d.dir === 'up' ? '+' : '') + fmt(Math.abs(d.abs), Number.isInteger(d.abs) ? 0 : 1) + (d.pct !== null && d.pct !== undefined ? ' (' + (d.pct >= 0 ? '+' : '') + fmt(d.pct, 1) + '%)' : '') + (cmp ? ' vs ' + esc2(cmp) : '') + '</div>';
}
function cardHTML(c, page) {
  return '<div class="card status-' + c.status + '" style="cursor:default"><span class="card-label">' + esc2(c.label) + '</span><span class="card-value">' + esc2(c.display) + '<span class="unit">' + esc2(c.unit) + '</span></span><span class="card-period">' + esc2(c.period) + '</span>' + deltaHTML(c.delta, page.compare && page.compare.label) + (c.sub ? '<span class="card-sub">' + esc2(c.sub) + '</span>' : '') + '</div>';
}
function show(i) {
  disposeAll();
  const { label, page, group } = SNAP[i];
  document.querySelectorAll('#topnav .nav-item').forEach(n => n.classList.toggle('active', n.dataset.g === group));
  document.querySelectorAll('#topnav .nav-item.open').forEach(n => n.classList.remove('open'));
  const side = document.getElementById('sidemenu');
  const items = SNAP.map((p, j) => [p, j]).filter(([p]) => p.group === group && group !== 'Home');
  side.innerHTML = items.length ? '<h3>' + esc2(group) + '</h3>' + items.map(([p, j]) => '<a href="#" data-i="' + j + '" class="' + (j === i ? 'active' : '') + '"><span class="ico">' + esc2(p.label.slice(0, 2).toUpperCase()) + '</span><span class="lbl">' + esc2(p.label) + '</span></a>').join('') : '';
  document.getElementById('crumb').innerHTML = 'Home' + (group !== 'Home' ? ' <span class="sep">›</span> ' + esc2(group) + ' <span class="sep">›</span> <span class="current">' + esc2(label) + '</span>' : '');
  const main = document.getElementById('main'); main.innerHTML = '';
  main.append(el('<div class="page-head"><div><h1>' + esc2(page.title) + '</h1><div class="period-label">' + esc2(page.period.label) + (page.compare ? ' · compared with ' + esc2(page.compare.label) : '') + '</div></div></div>'));
  main.append(el('<div class="snap-note">Offline snapshot. The live website (with filters, drill-down, records and Excel export) is on the plant network.</div>'));
  if (page.notes && page.notes.length) main.append(el('<div class="notes">' + page.notes.map(n => '<div class="note warn">' + esc2(n) + '</div>').join('') + '</div>'));
  if (page.segment === 'home') {
    for (const r of page.rows) main.append(el('<section class="seg-row"><h2>' + esc2(r.title) + '</h2><div class="cards">' + r.cards.map(c => cardHTML(c, page)).join('') + '</div></section>'));
    if (page.top3 && page.top3.length) main.append(el('<section class="seg-row"><h2>Top issues of ' + esc2(page.period.short) + '</h2><div class="top3">' + page.top3.map((x, k) => '<div class="issue' + (x.red ? ' red' : '') + '"><span class="n">' + (x.red ? '!' : k + 1 - (page.top3[0].red ? 1 : 0)) + '</span><span>' + esc2(x.text) + '</span></div>').join('') + '</div></section>'));
  } else if (page.cards.length) main.append(el('<div class="cards">' + page.cards.map(c => cardHTML(c, page)).join('') + '</div>'));
  const grid = el('<div class="grid"></div>');
  const ctx = { colors: page.colors, period: page.period.label, page };
  for (const s of page.charts) grid.append(panel(s, ctx, { noEnlarge: true }));
  main.append(grid);
  scrollTo(0, 0);
}
const nav = document.getElementById('topnav');
for (const g of ['Home', 'Defects', 'Compliance', 'Safety']) {
  const list = SNAP.map((p, j) => [p, j]).filter(([p]) => p.group === g);
  if (g === 'Home') { const it = el('<div class="nav-item" data-g="Home"><button class="nav-link" type="button">Home</button></div>'); it.querySelector('button').onclick = () => show(list[0][1]); nav.append(it); continue; }
  const it = el('<div class="nav-item" data-g="' + g + '"><button class="nav-btn" type="button" aria-haspopup="true">' + g + ' ▾</button><div class="dropdown">' + list.map(([p, j]) => '<a href="#" data-i="' + j + '">' + esc2(p.label) + '</a>').join('') + '</div></div>');
  it.querySelector('.nav-btn').onclick = e => { e.stopPropagation(); const o = !it.classList.contains('open'); document.querySelectorAll('#topnav .nav-item.open').forEach(n => n.classList.remove('open')); it.classList.toggle('open', o); };
  nav.append(it);
}
document.addEventListener('click', e => { const a = e.target.closest('a[data-i]'); if (a) { e.preventDefault(); show(+a.dataset.i); return; } if (!e.target.closest('.nav-item')) document.querySelectorAll('#topnav .nav-item.open').forEach(n => n.classList.remove('open')); });
document.getElementById('modal-close').onclick = closeModal;
show(0);
</script></body></html>`;

const outDir = path.join(DB.PATHS.project, 'Exports');
fs.mkdirSync(outDir, { recursive: true });
if (args.includes('--artifact')) {
  // claude.ai page: no document wrapper, short stable title, phone-safe gutter, no file downloads (blocked there)
  const page = html
    .replace(/^<!doctype html>\s*<html[^>]*><head><meta charset="utf-8"><meta name="viewport"[^>]*>\s*/, '')
    .replace(/<title>[^<]*<\/title>/, '<title>Assembly Production Dashboard</title>')
    .replace('</head>\n<body>', '')
    .replace('</body></html>', '')
    .replace('.panel-actions [data-act=xlsx], .panel-actions [data-act=big]{display:none}', '.panel-actions [data-act=xlsx], .panel-actions [data-act=big], .panel-actions [data-act=png]{display:none}\n.main{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}');
  const file = path.join(outDir, 'Assembly_Production_Dashboard.html');
  fs.writeFileSync(file, page, 'utf8');
  console.log(`Artifact page written: Exports/Assembly_Production_Dashboard.html (${(page.length / 1024 / 1024).toFixed(1)} MB)`);
  process.exit(0);
}
const name = `Production_Analysis_${P0.short}_snapshot_${stamp.getFullYear()}-${p2(stamp.getMonth() + 1)}-${p2(stamp.getDate())}.html`;
fs.writeFileSync(path.join(outDir, name), html, 'utf8');
console.log(`Snapshot written: Exports/${name} (${(html.length / 1024 / 1024).toFixed(1)} MB, ${pages.length} pages)`);
