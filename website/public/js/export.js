// Exports: Excel (page, chart, records, weekly report), PDF, PNG and CSV. Files go to the browser's normal download folder.
import { api, esc, fmt, stamp, safeName, download, loadScript, toast } from './util.js';
import { S, getQ, qs } from './app.js';

const FILTER_LABELS = { fac: 'Facility', line: 'Line / location', shift: 'Shift', tl: 'Team leader / team', defect: 'Defect / violation / item', dept: 'Department', area: 'Area', src: 'Source', op: 'Operator', found: 'Found at', station: 'Station', tab: 'Tab' };
async function excel() { await loadScript('/vendor/exceljs.min.js'); return window.ExcelJS; }
function filterText(f = {}) { const parts = Object.entries(FILTER_LABELS).filter(([k]) => f[k]).map(([k, l]) => `${l}: ${f[k]}`); return parts.length ? parts.join('; ') : 'No filters (all data)'; }
function fileName(page, ext) { const title = page.tab === 'electrical' ? 'Mislocation electrical' : page.title.replace(/:.*$/, ''); return `${safeName(title)}_${safeName(page.period.short)}_${stamp()}.${ext}`; }
const usedNames = new WeakMap();
function sheetName(wb, name) {
  const used = usedNames.get(wb) || new Set(); usedNames.set(wb, used);
  let base = String(name).replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet';
  let n = base, i = 2; while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase()); return n;
}
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D91' } }, alignment: { vertical: 'middle', wrapText: true } };

function topLines(ws, page, title) {
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF0B3D91' } };
  ws.addRow([`Period: ${page.period.label}${page.compare ? '   ·   Compared with: ' + page.compare.label : ''}`]);
  ws.addRow([`Filters: ${filterText(page.filters)}`]);
  ws.addRow([`Exported: ${new Date().toLocaleString('en-GB')}   ·   Data up to: ${S.meta.dataDate || ''}   ·   ${(S.meta.company || {}).name || ''} ${(S.meta.company || {}).site || ''}`]).font = { color: { argb: 'FF666666' }, size: 9 };
}
/** Writes a table (columns, rows) starting at the next row; returns the header row number. */
function writeTable(ws, columns, rows, title) {
  if (title) { ws.addRow([]); ws.addRow([title]).font = { bold: true, size: 12 }; }
  const hr = ws.addRow(columns); hr.eachCell(c => Object.assign(c, { style: { ...c.style, ...HEAD } })); hr.height = 20;
  for (const r of rows) {
    const row = ws.addRow(r.map(v => (v === undefined ? null : v)));
    row.eachCell(c => { if (typeof c.value === 'number') c.numFmt = Number.isInteger(c.value) ? '#,##0' : '#,##0.0'; if (typeof c.value === 'string' && /[؀-ۿ]/.test(c.value)) c.alignment = { horizontal: 'right', readingOrder: 'rtl', wrapText: false }; });
  }
  return hr.number;
}
function widths(ws) {
  ws.columns.forEach(col => { let m = 8; col.eachCell({ includeEmpty: false }, c => { if (c.row <= 4) return; const v = c.value === null || c.value === undefined ? '' : typeof c.value === 'number' ? fmt(c.value, 1) : String(c.value); m = Math.max(m, Math.min(60, v.length + 2)); }); col.width = m; });
}
function cardRows(cards, page) { return cards.map(c => [c.label, c.value === null || c.value === undefined ? null : Math.round(c.value * 100) / 100, c.unit, c.period, c.delta ? Math.round(c.delta.abs * 100) / 100 : null, c.delta && c.delta.pct !== null ? Math.round(c.delta.pct * 10) / 10 : null, c.status === 'green' ? 'At or better than target' : c.status === 'red' ? 'Worse than target' : 'No target', c.sub || '']); }
const CARD_COLS = ['Key number', 'Value', 'Unit', 'Period', 'Change', 'Change %', 'Status', 'Detail'];

async function rawRows(page, seg, subset) {
  const q = { ...getQ(), seg, subset, size: 'all', page: 1 };
  return api('/api/records' + qs(q));
}

function addSummary(wb, page, title) {
  const ws = wb.addWorksheet(sheetName(wb, 'Summary'));
  topLines(ws, page, title);
  ws.addRow([]);
  const cards = page.segment === 'home' ? page.rows.flatMap(r => r.cards.map(c => ({ ...c, label: `${r.title}: ${c.label}` }))) : page.cards;
  const hr = writeTable(ws, CARD_COLS, cardRows(cards, page));
  ws.views = [{ state: 'frozen', ySplit: hr }];
  if (page.top3 && page.top3.length) writeTable(ws, ['Top issues', 'Value', 'Total'], page.top3.map(x => [x.text, x.value, x.total]), 'Top issues of the period');
  if (page.notes && page.notes.length) { ws.addRow([]); ws.addRow(['Notes']).font = { bold: true }; for (const n of page.notes) ws.addRow([n]); }
  const analyses = page.charts.filter(c => c.analysis);
  if (analyses.length) writeTable(ws, ['Chart', 'Auto analysis (calculated from the data)'], analyses.map(c => [c.title, c.analysis]), 'Analysis text');
  widths(ws); ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 34);
  return ws;
}
function addChartSheet(wb, page, s) {
  if (!s.table || !s.table.columns) return;
  const ws = wb.addWorksheet(sheetName(wb, s.title));
  topLines(ws, page, s.title);
  const hr = writeTable(ws, s.table.columns, s.table.rows);
  ws.views = [{ state: 'frozen', ySplit: hr }];
  if (s.analysis) { ws.addRow([]); ws.addRow([s.analysis]).font = { italic: true, color: { argb: 'FF555555' } }; }
  if (s.type === 'imr' && s.alerts) { ws.addRow([]); ws.addRow(['Rule alerts']).font = { bold: true }; if (!s.alerts.length) ws.addRow(['None']); for (const a of s.alerts) ws.addRow([`${a.text}: ${a.fromDate} to ${a.toDate}`]); }
  widths(ws);
}
async function addRaw(wb, page, seg, subset, name = 'Raw Data') {
  const r = await rawRows(page, seg, subset);
  const ws = wb.addWorksheet(sheetName(wb, name));
  topLines(ws, page, `${name} (${fmt(r.total)} records, filtered)`);
  const hr = writeTable(ws, r.columns.map(c => c.label), r.rows.map(row => r.columns.map(c => row[c.key])));
  ws.views = [{ state: 'frozen', ySplit: hr }]; ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: r.columns.length } };
  widths(ws);
}
async function save(wb, name) { const buf = await wb.xlsx.writeBuffer(); download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name); toast('Downloaded ' + name); }

export async function pageToExcel(page) {
  toast('Preparing Excel…');
  const X = await excel(); const wb = new X.Workbook(); wb.creator = 'Production Data Analysis';
  addSummary(wb, page, page.title);
  for (const s of page.charts) { if (s.type === 'multiples') addChartSheet(wb, page, { ...s }); else addChartSheet(wb, page, s); }
  if (page.records) await addRaw(wb, page, page.records.seg, page.records.subset);
  await save(wb, fileName(page, 'xlsx'));
}
export async function chartToExcel(s, ctx) {
  const page = ctx.page || S.lastPage;
  const X = await excel(); const wb = new X.Workbook();
  addChartSheet(wb, page, s);
  await save(wb, `${safeName(s.title)}_${safeName(page.period.short)}_${stamp()}.xlsx`);
}
export async function recordsExcel(page, spec) {
  toast('Preparing Excel…');
  const X = await excel(); const wb = new X.Workbook();
  await addRaw(wb, page, spec.seg, spec.subset, spec.title);
  await save(wb, `${safeName(page.title.replace(/:.*$/, ''))}_records_${safeName(page.period.short)}_${stamp()}.xlsx`);
}
export function recordsCsv(page, route, spec) {
  const r = spec || page.records;
  const name = `${safeName(page.title.replace(/:.*$/, ''))}_raw_${safeName(page.period.short)}_${stamp()}`;
  const a = document.createElement('a'); a.href = '/api/records.csv' + qs({ ...getQ(), seg: r.seg, subset: r.subset, name }); a.download = name + '.csv'; document.body.append(a); a.click(); a.remove();
}
export function printPage() { document.body.classList.add('print-view'); setTimeout(() => { window.print(); document.body.classList.remove('print-view'); }, 300); }

export async function pageToPdf(main, page) {
  toast('Preparing PDF…', false, 8000);
  await Promise.all([loadScript('/vendor/html2canvas.min.js'), loadScript('/vendor/jspdf.umd.min.js')]);
  document.body.classList.add('print-view');
  await new Promise(r => setTimeout(r, 250));
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const canvas = await window.html2canvas(main, { scale: 1.6, backgroundColor: bg, useCORS: true, windowWidth: Math.max(1280, main.scrollWidth) });
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297 - 16, H = 210 - 16; const pxPerMm = canvas.width / W; const pageH = Math.floor(H * pxPerMm);
    for (let y = 0, i = 0; y < canvas.height; y += pageH, i++) {
      const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.min(pageH, canvas.height - y);
      const g = part.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, part.width, part.height); g.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
      if (i) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 8, 8, W, part.height / pxPerMm);
      pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`${page.title} · ${page.period.label} · page ${i + 1}`, 8, 206);
    }
    pdf.save(fileName(page, 'pdf'));
  } finally { document.body.classList.remove('print-view'); }
}

export async function multiplesPng(panelEl, s) {
  await loadScript('/vendor/html2canvas.min.js');
  const c = await window.html2canvas(panelEl, { scale: 2, backgroundColor: getComputedStyle(document.body).backgroundColor });
  c.toBlob(b => download(b, `${safeName(s.title)}.png`));
}

/** Weekly report: one workbook with all three segments for the selected week. */
export async function weeklyReport(weekKey) {
  const X = await excel(); const wb = new X.Workbook(); wb.creator = 'Production Data Analysis';
  const base = { ...getQ(), mode: null, day: null, from: null, to: null, week: weekKey };
  const pages = [['home', 'Summary'], ['defects', 'Defects'], ['defects/critical', 'Critical'], ['defects/czcf', 'CZCF'], ['defects/rework', 'Rework'], ['defects/mislocation', 'Mislocation'], ['defects/mislocation', 'Mislocation control', { tab: 'control' }], ['compliance', 'Compliance'], ['compliance/team-leaders', 'Team leaders'], ['compliance/camera', 'Camera cases'], ['safety', 'Safety'], ['safety/items', 'Safety items']];
  let first = null;
  for (const [id, name, extra] of pages) {
    toast(`Building weekly report: ${name}…`, false, 6000);
    const page = await api(`/api/page/${id}${qs({ ...base, ...(extra || {}) })}`);
    first = first || page;
    const ws = wb.addWorksheet(sheetName(wb, name));
    topLines(ws, page, `Weekly report ${page.period.short}: ${page.title}`);
    ws.addRow([]);
    const cards = page.segment === 'home' ? page.rows.flatMap(r => r.cards.map(c => ({ ...c, label: `${r.title}: ${c.label}` }))) : page.cards;
    const hr = writeTable(ws, CARD_COLS, cardRows(cards, page));
    ws.views = [{ state: 'frozen', ySplit: hr }];
    if (page.top3) writeTable(ws, ['Top issues', 'Value', 'Total'], page.top3.map(x => [x.text, x.value, x.total]), 'Top issues');
    for (const n of page.notes || []) ws.addRow([n]);
    for (const s of page.charts) if (s.table && s.table.columns) { writeTable(ws, s.table.columns, s.table.rows.slice(0, 200), s.title); if (s.analysis) ws.addRow([s.analysis]).font = { italic: true, color: { argb: 'FF555555' } }; }
    widths(ws); ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 30);
  }
  for (const [seg, name] of [['defects', 'Raw defects'], ['compliance', 'Raw compliance'], ['safety', 'Raw safety']]) {
    const r = await api('/api/records' + qs({ ...base, seg, subset: 'all', size: 'all' }));
    const ws = wb.addWorksheet(sheetName(wb, name)); topLines(ws, first, `${name} ${first.period.short} (${fmt(r.total)} records)`);
    const hr = writeTable(ws, r.columns.map(c => c.label), r.rows.map(row => r.columns.map(c => row[c.key])));
    ws.views = [{ state: 'frozen', ySplit: hr }]; widths(ws);
  }
  await save(wb, `Weekly_report_${safeName(first.period.short)}_${stamp()}.xlsx`);
}
export { esc };
