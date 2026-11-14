'use strict';
// Restore a database backup. STOP THE WEBSITE FIRST.
//   node scripts/restore.js                     -> lists the backups
//   node scripts/restore.js production-2026-11-14.db
// The current database is saved first as Backups/before-restore-<time>.db, so a restore can be undone.
const fs = require('fs');
const path = require('path');
const { PATHS } = require('../server/db');
const backup = require('../server/backup');

const config = JSON.parse(fs.readFileSync(path.join(PATHS.website, 'config.json'), 'utf8'));
const target = path.resolve(PATHS.website, config.db);
const name = process.argv[2];
if (!name) {
  console.log('Backups in ' + path.relative(PATHS.project, PATHS.backups) + ':');
  for (const b of backup.list()) console.log('  ' + b.file);
  console.log('\nUsage: npm run restore -- <file name>');
  process.exit(0);
}
const src = path.isAbsolute(name) ? name : path.join(PATHS.backups, path.basename(name));
if (!fs.existsSync(src)) { console.error('Backup not found: ' + src); process.exit(1); }
if (fs.existsSync(target)) {
  const keep = path.join(PATHS.backups, `before-restore-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.db`);
  fs.mkdirSync(PATHS.backups, { recursive: true });
  fs.copyFileSync(target, keep);
  console.log('Current database saved as ' + path.relative(PATHS.project, keep));
}
for (const ext of ['-wal', '-shm']) if (fs.existsSync(target + ext)) fs.unlinkSync(target + ext);
fs.copyFileSync(src, target);
console.log(`Restored ${path.basename(src)} -> ${path.relative(PATHS.project, target)}. Start the website again.`);
