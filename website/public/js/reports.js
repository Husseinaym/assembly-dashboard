// Reports: weekly report and a downloads centre for every page.
import { api, esc, el, fmt, dLabel, toast } from './util.js';
import { S, getQ, qs } from './app.js';
import { cardEl } from './views.js';

function weekKeyNow() { const q = getQ(); return Number(q.week) || (S.meta.dataWeek && S.meta.dataWeek.key); }

export async function weekly(main) {
  const wk = weekKeyNow();
  main.innerHTML = '';
  if (!wk) { main.innerHTML = '<div class="empty"><h3>No data yet</h3><p>Upload data first.</p></div>'; return; }
  const page = await api(`/api/page/home${qs({ ...getQ(), mode: null, week: wk })}`);
  const head = el(`<div class="page-head"><div><h1>Weekly report ${esc(page.period.short)}</h1><div class="period-label">${esc(page.period.label)}${page.compare ? ' · compared with ' + esc(page.compare.label) : ''}</div></div>
    <div class="page-actions"><button class="btn primary" id="wr">⬇ Download weekly report (Excel)</button></div></div>`);
  main.append(head);
  main.append(el(`<div class="note">One Excel workbook with all three segments for ${esc(page.period.short)}: summary, defects (overall, critical, CZCF, rework, mislocation and control charts), compliance (overview, team leaders, camera), safety (overview and items), and the raw data of the week. Pick another week with the week picker above.</div>`));
  head.querySelector('#wr').addEventListener('click', async e => {
    e.target.disabled = true;
    try { await (await import('./export.js')).weeklyReport(wk); } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  for (const r of page.rows) {
    const sec = el(`<section class="seg-row" style="margin-top:14px"><h2>${esc(r.title)}</h2><div class="cards"></div></section>`);
    for (const c of r.cards) sec.querySelector('.cards').append(cardEl(c, page));
    main.append(sec);
  }
  if (page.top3 && page.top3.length) main.append(el(`<section class="section"><h2>Top issues</h2><ol>${page.top3.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol></section>`));
}

const PAGES = [
  ['Home', 'home'], ['Defects overview', 'defects'], ['Critical defects', 'defects/critical'], ['CZCF', 'defects/czcf'], ['Rework', 'defects/rework'],
  ['Mislocation: total', 'defects/mislocation'], ['Mislocation: electrical', 'defects/mislocation', { tab: 'electrical' }], ['Mislocation: by facility', 'defects/mislocation', { tab: 'facility' }], ['Mislocation: control charts', 'defects/mislocation', { tab: 'control' }],
  ['Compliance overview', 'compliance'], ['Operators', 'compliance/operators'], ['New operators', 'compliance/new-operators'], ['Team leaders', 'compliance/team-leaders'], ['Camera cases', 'compliance/camera'],
  ['Safety overview', 'safety'], ['Safety areas', 'safety/areas'], ['Safety departments', 'safety/departments'], ['Non-compliance items', 'safety/items'],
];

export async function downloads(main) {
  const q = getQ();
  main.innerHTML = '';
  main.append(el(`<div class="page-head"><div><h1>Downloads</h1><div class="period-label">Every page for the period selected above. Files go to your browser's Downloads folder.</div></div></div>`));
  const wk = weekKeyNow();
  const box = el(`<section class="section"><h2>Weekly report</h2><p>All three segments for one week in one Excel workbook.</p><button class="btn primary" id="wr">⬇ Weekly report WK${wk ? wk % 100 : ''} (Excel)</button></section>`);
  box.querySelector('#wr').addEventListener('click', async e => { e.target.disabled = true; try { await (await import('./export.js')).weeklyReport(wk); } catch (err) { toast(err.message, true); } e.target.disabled = false; });
  main.append(box);
  const tbl = el(`<section class="section"><h2>Pages</h2><div class="tbl-wrap" style="padding:0"><table class="tbl"><thead><tr><th>Page</th><th>Excel (summary, one sheet per chart, raw data)</th><th>Open page (PDF / print from there)</th></tr></thead><tbody>
    ${PAGES.map(([label, id, extra], i) => `<tr><td>${esc(label)}</td><td><button class="btn small" data-i="${i}">⬇ Excel</button></td><td><a href="/${id === 'home' ? '' : id}${qs({ ...q, ...(extra || {}) })}" data-link>Open</a></td></tr>`).join('')}
  </tbody></table></div></section>`);
  tbl.addEventListener('click', async e => {
    const i = e.target.dataset.i; if (i === undefined) return;
    const [, id, extra] = PAGES[+i]; e.target.disabled = true;
    try { const page = await api(`/api/page/${id}${qs({ ...q, ...(extra || {}) })}`); S.lastPage = page; await (await import('./export.js')).pageToExcel(page); } catch (err) { toast(err.message, true); }
    e.target.disabled = false;
  });
  main.append(tbl);
  const raw = el(`<section class="section"><h2>Raw data (CSV)</h2><p>Filtered records of the selected period.</p><div class="frow">
    ${[['defects', 'Defects'], ['compliance', 'Compliance'], ['safety', 'Safety']].map(([s, l]) => `<a class="btn" href="/api/records.csv${qs({ ...q, seg: s, subset: 'all', name: l + '_raw' })}" download>⬇ ${l} CSV</a>`).join('')}</div></section>`);
  main.append(raw);
}
export { fmt, dLabel };
