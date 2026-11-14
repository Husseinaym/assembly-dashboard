'use strict';
/**
 * Imports the three WK46 sample files into a fresh in-memory database and compares
 * the results with the "Check numbers" table of PROMPT.md. Also re-imports them to prove
 * that a second upload does not change any number.
 *   node scripts/check-samples.js            (exit code 1 when a number does not match)
 */
const fs = require('fs');
const path = require('path');
const DB = require('../server/db');
const IMP = require('../server/importer');

const SAMPLE_DIR = path.resolve(__dirname, '..', '..', 'Inputs', 'Uploads', 'samples - WK46');
const FILES = ['12-11-2026.xlsx', 'Complaince Data.xlsx', 'Safety_Compliance_Daily_Report.xlsx'];

function measure(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const def = "date BETWEEN '2026-11-07' AND '2026-11-12'";
  return [
    ['Defect records, Report_List_between_dates, 7 to 12 Nov 2026', '4,861 rows', one(`SELECT COUNT(*) n FROM defects WHERE ${def}`).n, 4861],
    ['Total defects (sum of No of defect)', '4,899', one(`SELECT SUM(qty) n FROM defects WHERE ${def}`).n, 4899],
    ['Mislocation records', '1,496', one(`SELECT COUNT(*) n FROM defects WHERE is_mislocation=1 AND ${def}`).n, 1496],
    ['Rework records (Audit = Rework or found at Rework Area)', '790 records', one(`SELECT COUNT(*) n FROM defects WHERE is_rework=1 AND ${def}`).n, 790],
    ['Rework defects', '796 defects', one(`SELECT SUM(qty) n FROM defects WHERE is_rework=1 AND ${def}`).n, 796],
    ['Electrical mislocation', '447', one(`SELECT COUNT(*) n FROM defects WHERE is_electrical=1 AND ${def}`).n, 447],
    ['Critical defects (records)', '714 records', one(`SELECT COUNT(*) n FROM defects WHERE is_critical=1 AND ${def}`).n, 714],
    ['Critical defects (defects)', '715 defects', one(`SELECT SUM(qty) n FROM defects WHERE is_critical=1 AND ${def}`).n, 715],
    ['CZCF (CPG = Yes)', '17', one(`SELECT COUNT(*) n FROM defects WHERE cpg=1 AND ${def}`).n, 17],
    ['Compliance cases WK46 (all sources, de-duplicated)', '77 + 4 camera', one("SELECT SUM(qty) n FROM compliance WHERE week_key=202646 AND source='Line'").n, 77],
    ['Line sheet rows inside the 77 (not added again)', '13', one("SELECT COUNT(*) n FROM compliance WHERE date='2026-11-12' AND source='Line'").n, 13],
    ['Cam sheet camera cases', '4', one("SELECT COUNT(*) n FROM compliance WHERE source='Camera'").n, 4],
    ['Safety cases on 11 Nov 2026', '69', one("SELECT COUNT(*) n FROM safety WHERE date='2026-11-11'").n, 69],
  ];
}

function main() {
  const db = DB.open(':memory:');
  const reports = [];
  for (const f of FILES) {
    const buf = fs.readFileSync(path.join(SAMPLE_DIR, f));
    reports.push(IMP.commit(db, { buf, fileName: f, uploader: 'check', keepFile: false }));
  }
  const first = measure(db);
  // second upload of the same files must not change anything
  for (const f of FILES) IMP.commit(db, { buf: fs.readFileSync(path.join(SAMPLE_DIR, f)), fileName: f, uploader: 'check', decisions: {}, keepFile: false });
  const second = measure(db);
  let ok = true;
  console.log('\nCheck numbers (WK46 sample files)\n');
  console.log('Check'.padEnd(58), 'Expected'.padEnd(16), 'Result', ' Re-upload', ' OK');
  first.forEach(([name, label, got, want], i) => {
    const again = second[i][2];
    const pass = got === want && again === want;
    if (!pass) ok = false;
    console.log(name.padEnd(58), label.padEnd(16), String(got).padStart(6), String(again).padStart(10), pass ? '  yes' : '  NO');
  });
  const lineSheet = db.prepare("SELECT COUNT(*) n FROM compliance WHERE week_key=202646").get().n;
  console.log(`\nCompliance rows stored for WK46: ${lineSheet} (77 line/patrol cases + 4 camera cases).`);
  console.log('Upload sheets:');
  for (const r of reports) for (const s of r.sheets) console.log(`  ${s.sheet.padEnd(28)} ${s.data_type.padEnd(11)} read ${String(s.rows_read).padStart(5)}  valid ${String(s.valid).padStart(5)}  rejected ${s.rejected}  dup-in-file ${s.duplicates_in_file}  ${s.date_from} .. ${s.date_to}`);
  for (const r of reports) for (const x of r.roles.filter(x => x.role !== 'import')) console.log(`  (ignored) ${x.sheet}: ${x.reason}`);
  for (const r of reports) for (const w of r.warnings) console.log('  warning:', w);
  console.log(ok ? '\nALL CHECK NUMBERS MATCH' : '\nSOME CHECK NUMBERS DO NOT MATCH');
  return ok;
}

if (require.main === module) process.exit(main() ? 0 : 1);
module.exports = { main, measure, FILES, SAMPLE_DIR };
