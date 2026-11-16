'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const D = require('./defaults');

// All paths are relative to the project folder, so the folder can be moved to any drive or PC.
const WEBSITE_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(WEBSITE_DIR, '..');
const PATHS = {
  website: WEBSITE_DIR,
  project: PROJECT_DIR,
  data: path.join(WEBSITE_DIR, 'data'),
  uploads: process.env.PDA_UPLOADS || path.join(PROJECT_DIR, 'Uploads'),
  backups: process.env.PDA_BACKUPS || path.join(PROJECT_DIR, 'Backups'),
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT, stored_path TEXT, uploader TEXT, uploaded_at TEXT,
  segments TEXT, rows_imported INTEGER DEFAULT 0, rows_rejected INTEGER DEFAULT 0, date_from TEXT, date_to TEXT, report TEXT
);
CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY, upload_id INTEGER, date TEXT NOT NULL, week_key INTEGER, src_week INTEGER, shift TEXT, team_leader TEXT,
  found_at TEXT, audit TEXT, defect_name TEXT, defect_name_raw TEXT, defect_code TEXT, yellow_card TEXT, produced_at TEXT,
  breakdown TEXT, connector_no TEXT, clip_no TEXT, circuit_no TEXT, std_dim TEXT, act_dim TEXT, tol_min TEXT, tol_max TEXT, dev_dim TEXT,
  qty REAL DEFAULT 1, operator TEXT, terminal TEXT, cpg INTEGER DEFAULT 0, man TEXT, machine TEXT, method TEXT, material TEXT,
  line TEXT, facility TEXT, site TEXT, category TEXT, part_number TEXT, rework_min REAL, critical_src INTEGER,
  is_critical INTEGER DEFAULT 0, critical_type TEXT, is_mislocation INTEGER DEFAULT 0, is_electrical INTEGER DEFAULT 0, is_rework INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_def_date ON defects(date);
CREATE INDEX IF NOT EXISTS ix_def_upload ON defects(upload_id);
CREATE INDEX IF NOT EXISTS ix_def_fac ON defects(facility, date);
CREATE INDEX IF NOT EXISTS ix_def_cover ON defects(date, qty, facility, line, shift, team_leader, defect_name, week_key, is_critical, cpg, is_rework, is_mislocation, is_electrical, critical_type);
CREATE INDEX IF NOT EXISTS ix_def_cover2 ON defects(date, qty, found_at, produced_at, defect_code, operator, is_critical, cpg, is_rework, is_mislocation, is_electrical, man, machine, method, material);
CREATE TABLE IF NOT EXISTS compliance (
  id INTEGER PRIMARY KEY, upload_id INTEGER, ukey TEXT UNIQUE, date TEXT NOT NULL, week_key INTEGER, src_week INTEGER, shift TEXT,
  facility_raw TEXT, facility TEXT, line TEXT, team_leader TEXT, violation TEXT, violation_raw TEXT, operator TEXT, qty REAL DEFAULT 1,
  patroller TEXT, data_entry TEXT, time TEXT, report_no TEXT, found_at TEXT, station_no TEXT, jig TEXT, justification2 TEXT,
  comment TEXT, justification TEXT, signature TEXT, source TEXT, operator_start TEXT
);
CREATE INDEX IF NOT EXISTS ix_com_date ON compliance(date);
CREATE INDEX IF NOT EXISTS ix_com_upload ON compliance(upload_id);
CREATE TABLE IF NOT EXISTS safety (
  id INTEGER PRIMARY KEY, upload_id INTEGER, date TEXT NOT NULL, week_key INTEGER, src_week INTEGER, shift TEXT, area TEXT, facility TEXT,
  location TEXT, team TEXT, item_raw TEXT, item TEXT, operator TEXT, department TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_saf_date ON safety(date);
CREATE INDEX IF NOT EXISTS ix_saf_upload ON safety(upload_id);
CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY, upload_id INTEGER, date TEXT NOT NULL, week_key INTEGER, facility TEXT, line TEXT, qty REAL
);
CREATE INDEX IF NOT EXISTS ix_prod_date ON production(date);
CREATE TABLE IF NOT EXISTS operators (operator TEXT PRIMARY KEY, start_date TEXT, name TEXT, facility TEXT, upload_id INTEGER);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS facilities (name TEXT PRIMARY KEY, color TEXT, confirmed INTEGER, production INTEGER, sort INTEGER);
CREATE TABLE IF NOT EXISTS facility_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT, match TEXT, facility TEXT, sort INTEGER);
CREATE TABLE IF NOT EXISTS defect_alias (raw_key TEXT PRIMARY KEY, canonical TEXT);
CREATE TABLE IF NOT EXISTS violation_alias (raw_key TEXT PRIMARY KEY, canonical TEXT);
CREATE TABLE IF NOT EXISTS safety_items (raw_key TEXT PRIMARY KEY, arabic TEXT, english TEXT);
CREATE TABLE IF NOT EXISTS translations (raw_key TEXT PRIMARY KEY, arabic TEXT, english TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data_type TEXT, source TEXT, sheet_hint TEXT, priority INTEGER, exclusive TEXT,
  required TEXT, field_map TEXT, builtin INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT, hash TEXT, role TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT, created_at TEXT);
`;

const { hashPassword } = require('./auth');
/** Private translation table (never in the repository): PDA_TRANSLATIONS, else data/translations-ar.json, else the small public sample. */
function translationsFile() {
  const priv = process.env.PDA_TRANSLATIONS || path.join(PATHS.data, 'translations-ar.json');
  return fs.existsSync(priv) ? priv : path.join(__dirname, 'translations-sample.json');
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF; PRAGMA cache_size = -262144; PRAGMA mmap_size = 1073741824; PRAGMA temp_store = MEMORY;');
  db.exec(SCHEMA);
  seedMaster(db);
  require('./translate').seed(db, translationsFile());
  return db;
}

function seedMaster(db) {
  const has = db.prepare('SELECT COUNT(*) n FROM settings').get().n;
  if (has) return;
  const ins = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(D.SETTINGS)) ins.run(k, JSON.stringify(v));
  ins.run('critical', JSON.stringify(D.CRITICAL_LIST));
  const f = db.prepare('INSERT OR REPLACE INTO facilities(name,color,confirmed,production,sort) VALUES(?,?,?,?,?)');
  D.FACILITIES.forEach((x, i) => f.run(x.name, x.color, x.confirmed ? 1 : 0, x.production ? 1 : 0, i));
  const r = db.prepare('INSERT INTO facility_rules(pattern,match,facility,sort) VALUES(?,?,?,?)');
  for (const x of D.FACILITY_RULES) r.run(x.pattern, x.match, x.facility, x.sort);
  const { normKey } = require('./calc');
  const s = db.prepare('INSERT OR REPLACE INTO safety_items(raw_key,arabic,english) VALUES(?,?,?)');
  for (const [ar, en] of D.SAFETY_ITEMS) s.run(normKey(ar), ar, en);
  const t = db.prepare('INSERT INTO templates(name,data_type,source,sheet_hint,priority,exclusive,required,field_map,builtin,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)');
  for (const x of D.TEMPLATES) t.run(x.name, x.data_type, x.source || null, x.sheet_hint || '', x.priority || 0, x.exclusive || null, JSON.stringify(x.required), JSON.stringify(x.field_map), new Date().toISOString());
  // No user accounts are created here: there are no built-in passwords. The administrator comes from the
  // PDA_ADMIN_USER / PDA_ADMIN_PIN secrets when the server starts (see auth.js, ensureAdmin).
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  for (const [k, v] of Object.entries(D.SETTINGS)) if (out[k] === undefined) out[k] = v;
  if (!out.critical) out.critical = D.CRITICAL_LIST;
  return out;
}
function setSetting(db, key, value) { db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, JSON.stringify(value)); }

function master(db) {
  return {
    settings: getSettings(db),
    facilities: db.prepare('SELECT * FROM facilities ORDER BY sort, name').all(),
    rules: db.prepare('SELECT * FROM facility_rules ORDER BY sort, id').all(),
    defectAlias: new Map(db.prepare('SELECT raw_key, canonical FROM defect_alias').all().map(r => [r.raw_key, r.canonical])),
    violationAlias: new Map(db.prepare('SELECT raw_key, canonical FROM violation_alias').all().map(r => [r.raw_key, r.canonical])),
    safetyItems: new Map(db.prepare('SELECT raw_key, arabic, english FROM safety_items').all().map(r => [r.raw_key, r])),
  };
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { PATHS, open, getSettings, setSetting, master, tx, hashPassword, translationsFile };
