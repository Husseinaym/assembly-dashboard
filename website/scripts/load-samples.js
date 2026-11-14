'use strict';
// Loads the three WK46 sample files into the main database (as normal uploads, so they show in Upload history
// and a copy of each file is kept in the Uploads folder). Re-running it replaces the same dates: no double counting.
//   node scripts/load-samples.js ["folder with the files"]
const fs = require('fs');
const path = require('path');
const DB = require('../server/db');
const IMP = require('../server/importer');
const { FILES, SAMPLE_DIR } = require('./check-samples');

const config = JSON.parse(fs.readFileSync(path.join(DB.PATHS.website, 'config.json'), 'utf8'));
const dir = process.argv[2] ? path.resolve(process.argv[2]) : SAMPLE_DIR;
const db = DB.open(path.resolve(DB.PATHS.website, process.env.PDA_DB || config.db));
for (const f of FILES) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log('Not found:', p); continue; }
  const r = IMP.commit(db, { buf: fs.readFileSync(p), fileName: f, uploader: 'admin' });
  console.log(`${f}: ${r.imported} rows imported, ${r.sheets.reduce((s, x) => s + x.rejected, 0)} rejected. ${r.actions.join(' ')}`);
}
db.close();
console.log('Done. Restart the website if it is running, or simply reload the page.');
