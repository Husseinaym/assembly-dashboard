'use strict';
// Daily database backups into the project's Backups/ folder (relative path, keeps the last 30).
const fs = require('fs');
const path = require('path');
const { PATHS } = require('./db');

const KEEP = 30;
function stamp(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

function list() {
  if (!fs.existsSync(PATHS.backups)) return [];
  return fs.readdirSync(PATHS.backups).filter(f => /^production-.*\.db$/.test(f)).sort().reverse()
    .map(f => ({ file: f, size: fs.statSync(path.join(PATHS.backups, f)).size }));
}

function run(db, force = false) {
  fs.mkdirSync(PATHS.backups, { recursive: true });
  const name = force ? `production-${stamp()}_${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.db` : `production-${stamp()}.db`;
  const file = path.join(PATHS.backups, name);
  if (!force && fs.existsSync(file)) return null;
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = list(); for (const old of all.slice(KEEP)) fs.unlinkSync(path.join(PATHS.backups, old.file));
  return name;
}

function schedule(db) {
  const tick = () => { try { const n = run(db); if (n) console.log('Backup written: Backups/' + n); } catch (e) { console.error('Backup failed:', e.message); } };
  tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { run, list, schedule };
