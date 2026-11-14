'use strict';
/**
 * Seed script: generates realistic sample data for all 3 segments in the SAME layouts as the real files
 * and imports it through the normal importer, so the website can be demonstrated before real data is uploaded.
 *
 *   node scripts/seed.js                      -> loads 12 weeks into data/demo.db (start it with: npm run demo)
 *   node scripts/seed.js --weeks 20 --db data/production.db --force   -> into the main database
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const DB = require('../server/db');
const IMP = require('../server/importer');
const C = require('../server/calc');
const D = require('../server/defaults');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const R = rng(46);
const pick = a => a[Math.floor(R() * a.length)];
const wpick = list => { const t = list.reduce((s, x) => s + x[1], 0); let r = R() * t; for (const [v, w] of list) { if ((r -= w) <= 0) return v; } return list[0][0]; };
const usDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${y}`; };
const serial = iso => (Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(1899, 11, 30)) / 864e5;

const LINES = [['346D FLOOR 1', 12], ['346D FLOOR 3', 7], ['130D Floor 1 HEV', 10], ['130D Floor 2 HEV', 10], ['130D Small Front Door', 5], ['130D Small Front Door 2', 4], ['412B Floor 4', 9], ['412B Floor 5', 6], ['537D Aygo Floor 1', 6], ['PSA - EB TURBO 7', 2], ['PSA - EB TURBO 8', 2.5], ['PSA - EB TURBO 10', 3], ['PSA - EB TURBO 4', 2], ['PSA - Front door', 2], ['PSA - Rear door', 1]];
const NAMES = [['Mislocation', 30], ['Twist Lead', 12], ['Damage connector', 12], ['Bent terminal', 10], ['Damage Connector', 3], ['Damage fitment', 4], ['Damage insulation', 3.5], ['Too short branch', 2.4], ['Wrong wire', 1.7], ['Winged ABO not closed', 2.5], ['Missing Component', 0.6], ['Backout terminal', 0.5], ['Missing Tape', 0.4], ['Wrong Dimension', 1.6], ['Out Seal', 1.4], ['Extra Material', 0.6], ['Cut Wire', 0.5]];
const CODES = { Mislocation: 'M', 'Twist Lead': 'TL', 'Damage connector': 'DB', 'Damage Connector': 'DB', 'Bent terminal': 'BT', 'Winged ABO not closed': 'WA', 'Backout terminal': 'BO' };
const FOUND = [['Station', 16], ['Rework Area', 15], ['Preblock', 14], ['Electrical Test', 13], ['Tape station', 10], ['Ip', 10], ['Lay-up station', 9], ['Audit 2', 6], ['Audit 1', 3], ['Clip station', 2]];

function defectsBook(days) {
  const H = ['Week', 'Date', 'Team Leader name', 'Shift', 'WH code', 'Defect found at', 'Audit', 'Defect name', 'Defect code', 'Defect rank', 'Yellow card', 'Defect produced at', 'Breakdown', 'Connector no', 'Clip no', 'Standard dimension', 'Actual dimension', 'Tolerance min', 'Tolerance max', 'Deviation dimension', 'Circuit number', 'No of defect', 'Op name', 'Terminal', 'CPG', 'Man', 'Machine', 'Method', 'Material', 'Assembly line', 'Production qty shifts', 'Defect ratio', 'Site'];
  const rows = [H];
  days.forEach((d, di) => {
    const n = 760 + Math.floor(R() * 140) + Math.round(40 * Math.sin(di / 3));
    for (let i = 0; i < n; i++) {
      const name = wpick(NAMES); const found = name === 'Mislocation' && R() < 0.3 ? 'Electrical Test' : wpick(FOUND);
      const audit = found === 'Rework Area' ? (R() < 0.8 ? 'Rework' : 'Deblocker') : found.startsWith('Audit') ? 'Inspection ' + found.slice(-1) : 'Deblocker';
      const sh = wpick([['Shift 1', 4], ['Shift 2', 3.5], ['Shift 3', 2.5]]);
      rows.push([C.weekInfo(d).week, usDate(d), { 'Shift 1': 'A', 'Shift 2': 'C', 'Shift 3': 'B' }[sh], sh, '', found, audit, name + (R() < 0.02 ? ' ' : ''), (CODES[name] || 'XX') + '        ', 'S', '0', wpick([['Station / ' + (1 + Math.floor(R() * 9)), 6], ['Pre-Block / ' + 10 * (1 + Math.floor(R() * 6)), 3], ['Rework / 0', 1], ['Other / 0', 1]]), 'ON CON', String(500 + Math.floor(R() * 80)), 'NA', '0', '0', '0', '0', '0', '0', R() < 0.99 ? 1 : 2, R() < 0.25 ? '0' : String(2000 + Math.floor(R() * 16000)), 'No', R() < 0.004 ? 'Yes' : 'No', 'NA', 'NA', 'NA', 'NA', wpick(LINES) + (R() < 0.05 ? ' ' : ''), 1, 100, '6th of October']);
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'pivot'], ['Sum of No of defect', 'Column Labels']]), 'Sheet1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Report_List_between_dates');
  return wb;
}

const VIOL = [['Using JIG', 40], ['Operator didn’t follow work instruction', 17], ['Using skirt', 9], ['Mix component', 6], ['Correct using of Rubber', 6], ['Interruption card', 6], ['Dealing with harness during assembly', 5], ['Using CPWP', 5], ['Over kitting with Cups', 3]];
const CLINES = [['369D Floor 4  ', '369D', 15], ['369D Floor 5', '369D', 8], ['369D Floor 6', '369D', 6], ['346D FLOOR 1 ', '346D', 11], ['346D FLOOR 3', '346D', 4], ['130D Floor 2 HEV', '130D', 6], ['130D Floor 1 HEV', '130D', 6], ['130D Small Front Doors ', '130D', 2], ['537D Aygo Floor 1', 'Aygo', 6], ['PSA - EB TURBO 8', 'PSA - EB TURBO', 3], ['PSA - EB TURBO 6', 'PSA - EB TURBO', 2], ['F1H Rear Door', 'F1H', 1]];
function complianceBook(days) {
  const H = ['Date', 'Month', 'Week', 'Shift', 'Facility ', 'Assembly line', 'Team Leader', 'Defect name', 'OP .ID', 'Number of defects', 'Patroller', 'Data Entry', 'Time ', 'Report No.', 'Defect found at', 'NO', 'JIG NUMBER', 'Justification2', 'Comment', 'Justification'];
  const rows = [H]; const seq = {}; const ops = Array.from({ length: 160 }, () => String(1000 + Math.floor(R() * 17000)));
  for (const d of days) {
    const n = 9 + Math.floor(R() * 9);
    for (let i = 0; i < n; i++) {
      const tl = pick(['A', 'B', 'C']); const wk = C.weekInfo(d).week; const k = tl + wk; seq[k] = (seq[k] || 0) + 1;
      const [line, fac] = wpick(CLINES.map(x => [[x[0], x[1]], x[2]]));
      rows.push([serial(d), serial(d.slice(0, 8) + '01'), wk, pick(['1st', '2nd', '3rd']), fac, line, tl, wpick(VIOL), R() < 0.15 ? pick(ops.slice(0, 10)) : pick(ops), 1, '10635 Mohamed Younis', '17551 Data Entry', R(), `${tl}-${wk}-${seq[k]}`, pick(['L.U', 'ST', 'Tape', 'P.B', 'kitter', 'E.T']), 1 + Math.floor(R() * 15), pick([null, null, 'Fork', 'CON']), null, 'انعدام المسؤولية', null]);
    }
  }
  const cam = [['Date', 'Month', 'Week', 'Shift', 'Facility ', 'Team Leader', 'Assembly line', 'Defect name', 'OP .ID', '\tNumber of defects', 'Patroller', 'Time ', 'Report No.', 'Defect found at', 'NO', 'Comment', 'OP-Signature', 'Defect found at2', 'Station NO']];
  for (const d of days) if (R() < 0.5) cam.push([serial(d), serial(d.slice(0, 8) + '01'), C.weekInfo(d).week, '2nd', '369D', 'C', '369D Floor 5', 'Dealing with harness during assembly', Number(pick(ops)), 1, '396 Camera', `${10 + Math.floor(R() * 8)}:${String(Math.floor(R() * 60)).padStart(2, '0')}:00PM`, null, null, null, 'شد البرانش بقوه', null, 'P.B', 15]);
  const wb = XLSX.utils.book_new();
  const last = days[days.length - 1];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows.slice(1).filter(r => r[0] === serial(last))]), 'Line');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cam), 'Cam');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `WK ${C.weekInfo(last).week - 1}`);
  return wb;
}

const AREAS = [['CST Machines', 'CST Machines', 'Lead Prep', 30], ['Yaris SUV 709D', 'Yaris SUV Floor 4', 'Assembly', 12], ['CHR Floor', 'CHR Floor 1', 'Assembly', 8], ['PSA - EB TURBO', 'PSA - EB TURBO 11', 'Assembly', 8], ['Yaris 708D', 'Yaris Floor 1', 'Engineering', 6], ['Sub Area', 'Sub Area', 'Lead Prep', 2], ['Aygo', 'Aygo Floor 1', 'Assembly', 2], ['Stores', 'Stores', 'Logistics', 2], ['Maintenance Workshop', 'Workshop', 'Engineering', 2], ['F1H', 'F1H Rear Door', 'Assembly', 1], ['CHR Smalls (LFD,RFD,Roof)', 'CHR Smalls', 'Assembly', 1]];
function safetyBook(days) {
  const H = ['Date', 'Month', 'Week', 'Shift', 'Area', 'Location', 'Team ', 'Non-Compliance item', 'OP .ID', 'Department', 'Notes'];
  const rows = [H]; const items = D.SAFETY_ITEMS.map(([ar], i) => [ar, Math.max(0.3, 30 / (i + 1))]);
  for (const d of days) {
    const n = 45 + Math.floor(R() * 25);
    for (let i = 0; i < n; i++) { const [area, loc, dept] = wpick(AREAS.map(a => [a, a[3]])); rows.push([serial(d), serial(d.slice(0, 8) + '01'), C.weekInfo(d).week, pick(['1st', '2nd', '3rd']), area, loc, pick(['A', 'B', 'C', 'c']), wpick(items), R() < 0.3 ? 1000 + Math.floor(R() * 16000) : null, dept, 'ملاحظة السلامة']); }
  }
  const wb = XLSX.utils.book_new();
  const last = days[days.length - 1];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows.slice(1).filter(r => r[0] === serial(last))]), 'Compliance');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Area', 'Assembly'], ['CHR Floor', 1]]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'All Record');
  return wb;
}

function workDaysBack(endISO, weeks) {
  const cfg = C.DEFAULT_WEEK; const end = C.weekInfo(endISO).end; const start = C.addDays(C.weekInfo(endISO).start, -7 * (weeks - 1));
  return C.dateList(start, end).filter(d => cfg.workDays.includes(C.dow(d)) && d <= endISO);
}

function seed(db, { weeks = 12, end } = {}) {
  end = end || C.addDays(new Date().toISOString().slice(0, 10), -1);
  const days = workDaysBack(end, weeks);
  const out = [];
  const books = [];
  for (let i = 0; i < days.length; i += 60) { const part = days.slice(i, i + 60); books.push([defectsBook(part), `${part[part.length - 1].split('-').reverse().join('-')}.xlsx`]); }
  books.push([complianceBook(days.slice(-6)), 'Complaince Data.xlsx'], [complianceBook(days.slice(0, -6)), 'Complaince Data (history).xlsx'], [safetyBook(days), 'Safety_Compliance_Daily_Report.xlsx']);
  for (const [wb, name] of books) {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = IMP.commit(db, { buf, fileName: name, uploader: 'seed', keepFile: false, decisions: {} });
    out.push({ file: name, imported: r.imported });
  }
  // production quantities (optional upload type) so DR% can be demonstrated
  const prod = [['Date', 'Assembly line', 'Produced']];
  for (const d of days) for (const [line, w] of LINES) prod.push([usDate(d), line, Math.round(w * 120 + R() * 60)]);
  const pwb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(pwb, XLSX.utils.aoa_to_sheet(prod), 'Production');
  out.push({ file: 'Production.xlsx', imported: IMP.commit(db, { buf: XLSX.write(pwb, { type: 'buffer', bookType: 'xlsx' }), fileName: 'Production.xlsx', uploader: 'seed', keepFile: false }).imported });
  // operator list with start dates (new operator analysis)
  const ops = [['Operator ID', 'Start date', 'Name']]; const seen = new Set(db.prepare('SELECT DISTINCT operator FROM compliance').all().map(r => r.operator));
  for (const op of seen) if (op) ops.push([op, usDate(C.addDays(end, -Math.floor(R() * 900))), 'Operator ' + op]);
  const owb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(owb, XLSX.utils.aoa_to_sheet(ops), 'Operators');
  out.push({ file: 'Operators.xlsx', imported: IMP.commit(db, { buf: XLSX.write(owb, { type: 'buffer', bookType: 'xlsx' }), fileName: 'Operators.xlsx', uploader: 'seed', keepFile: false }).imported });
  return out;
}

if (require.main === module) {
  const a = process.argv.slice(2); const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const file = path.resolve(DB.PATHS.website, arg('--db', 'data/demo.db'));
  if (fs.existsSync(file) && !a.includes('--force')) {
    const db0 = DB.open(file); const n = db0.prepare('SELECT COUNT(*) n FROM uploads').get().n; db0.close();
    if (n) { console.log(`${path.relative(DB.PATHS.website, file)} already has ${n} uploads. Add --force to add demo data anyway.`); process.exit(1); }
  }
  const db = DB.open(file);
  const r = seed(db, { weeks: Number(arg('--weeks', 12)), end: arg('--end') });
  for (const x of r) console.log(`Seeded ${x.file}: ${x.imported} rows`);
  console.log(`Demo data is in ${path.relative(DB.PATHS.website, file)}.`);
}
module.exports = { seed };
