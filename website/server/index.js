'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const DB = require('./db');
const IMP = require('./importer');
const PG = require('./pages');
const C = require('./calc');
const { dataBounds } = require('./query');
const backup = require('./backup');

const CONFIG_FILE = path.join(DB.PATHS.website, 'config.json');
const config = Object.assign({ port: 8080, host: '0.0.0.0', db: 'data/production.db' }, fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {});
if (process.env.PDA_DB) config.db = process.env.PDA_DB;
if (process.env.PORT) config.port = Number(process.env.PORT);
const db = DB.open(path.resolve(DB.PATHS.website, config.db));
console.log('Database: ' + path.relative(DB.PATHS.project, path.resolve(DB.PATHS.website, config.db)));

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '5mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// ---------- cache (cleared after every upload / settings change) ----------
let version = 1; const cache = new Map();
function bump() { version++; cache.clear(); try { db.exec('PRAGMA optimize'); } catch {} warm(); require('./hfsync').schedule(db); }
// Pre-build the most used views in idle moments after a data change, so the first viewer does not wait.
let warmTimer = null;
function warm() {
  clearTimeout(warmTimer);
  const ids = Object.keys(PG.PAGES); const queue = [];
  for (const q of [{}, { mode: 'ytd' }, { mode: 'all' }]) for (const id of ids) queue.push([id, q]);
  const v = version;
  const step = () => {
    if (v !== version || !queue.length) return;
    const [id, q] = queue.shift();
    const key = id + '?' + JSON.stringify(Object.keys(q).sort().map(k => [k, q[k]]));
    try { cached(key, () => PG.buildPage(db, id, q)); } catch (e) { console.error('warm', id, e.message); }
    warmTimer = setTimeout(step, 50);
  };
  warmTimer = setTimeout(step, 500);
}
function cached(key, fn) {
  const k = version + '|' + key;
  if (cache.has(k)) return cache.get(k);
  const v = fn(); if (cache.size > 400) cache.clear(); cache.set(k, v); return v;
}

// ---------- auth ----------
function parseCookies(req) { const o = {}; for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
app.use((req, res, next) => {
  const t = parseCookies(req).pda_session;
  req.user = null;
  if (t) { const s = db.prepare('SELECT s.username, u.role FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=?').get(t); if (s) req.user = { username: s.username, role: s.role }; }
  next();
});
function settings() { return DB.getSettings(db); }
function canView(req, res, next) { if (!req.user && settings().requireLogin) return res.status(401).json({ error: 'Please log in' }); next(); }
function admin(req, res, next) { if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin login required' }); next(); }
const wrap = fn => (req, res) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { console.error(e); res.status(400).json({ error: e.message }); } };

app.post('/api/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(String(username || '').trim());
  if (!u || DB.hashPassword(String(password || '').trim(), u.salt).hash !== u.hash) { res.status(401).json({ error: 'Wrong user name or PIN' }); return; }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token,username,created_at) VALUES(?,?,?)').run(token, u.username, new Date().toISOString());
  res.setHeader('Set-Cookie', `pda_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  return { username: u.username, role: u.role };
}));
app.post('/api/logout', wrap((req, res) => {
  const t = parseCookies(req).pda_session; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  res.setHeader('Set-Cookie', 'pda_session=; Path=/; Max-Age=0'); return { ok: true };
}));

// ---------- meta / pages ----------
app.get('/api/meta', wrap(req => {
  const s = settings();
  const b = dataBounds(db);
  const last = db.prepare('SELECT uploaded_at, file_name FROM uploads ORDER BY id DESC LIMIT 1').get();
  const weeks = db.prepare('SELECT DISTINCT week_key k FROM defects UNION SELECT DISTINCT week_key FROM compliance UNION SELECT DISTINCT week_key FROM safety ORDER BY k DESC').all().map(r => r.k);
  return {
    user: req.user || (s.requireLogin ? null : { username: 'guest', role: 'viewer', guest: true }), requireLogin: s.requireLogin,
    company: s.company, week: s.week, presentation: s.presentation,
    facilities: db.prepare('SELECT name, color, confirmed FROM facilities ORDER BY sort, name').all(),
    dataDate: b.max, dataWeek: b.max ? C.weekInfo(b.max, s.week) : null, bounds: b.seg, lastUpload: last || null,
    weeks: weeks.map(k => ({ key: k, label: 'WK' + (k % 100), ...C.weekFromKey(k, s.week) })), version,
  };
}));
app.get('/api/options', canView, wrap(() => cached('options', () => {
  const d = (sql) => db.prepare(sql).all().map(r => r.v).filter(v => v !== null && v !== '');
  return {
    facility: [...new Set([...d('SELECT name v FROM facilities ORDER BY sort'), ...d('SELECT DISTINCT facility v FROM defects UNION SELECT DISTINCT facility FROM compliance ORDER BY 1')])],
    line: d('SELECT DISTINCT line v FROM defects UNION SELECT DISTINCT line FROM compliance ORDER BY 1'),
    location: d('SELECT DISTINCT location v FROM safety ORDER BY 1'),
    shift: d('SELECT DISTINCT shift v FROM defects UNION SELECT DISTINCT shift FROM compliance UNION SELECT DISTINCT shift FROM safety ORDER BY 1'),
    tl: d('SELECT DISTINCT team_leader v FROM defects UNION SELECT DISTINCT team_leader FROM compliance UNION SELECT DISTINCT team FROM safety ORDER BY 1'),
    defect: d('SELECT DISTINCT defect_name v FROM defects ORDER BY 1'),
    violation: d('SELECT DISTINCT violation v FROM compliance ORDER BY 1'),
    item: d('SELECT DISTINCT item v FROM safety ORDER BY 1'),
    dept: d('SELECT DISTINCT department v FROM safety ORDER BY 1'),
    area: d('SELECT DISTINCT area v FROM safety ORDER BY 1'),
  };
})));
app.get(/^\/api\/page\/(.+)$/, canView, wrap(req => {
  const id = req.params[0];
  const key = id + '?' + JSON.stringify(Object.keys(req.query).sort().map(k => [k, req.query[k]]));
  const page = cached(key, () => PG.buildPage(db, id, req.query));
  if (!page) throw new Error('Unknown page ' + id);
  return page;
}));
app.get('/api/records', canView, wrap(req => PG.records(db, req.query)));
app.get('/api/records.csv', canView, (req, res) => {
  try {
    const r = PG.records(db, { ...req.query, size: 'all', page: 1 });
    const esc = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [r.columns.map(c => esc(c.label)).join(','), ...r.rows.map(row => r.columns.map(c => esc(row[c.key])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${(req.query.name || 'records').replace(/[^\w.-]/g, '_')}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (e) { res.status(400).send(e.message); }
});
app.get('/api/search', canView, wrap(req => {
  const q = String(req.query.q || '').trim(); if (q.length < 1) return [];
  const like = `%${q}%`; const out = [];
  const add = (type, label, url) => { if (out.length < 25) out.push({ type, label, url }); };
  for (const r of db.prepare('SELECT name FROM facilities WHERE name LIKE ? LIMIT 5').all(like)) add('Facility', r.name, `/defects?fac=${encodeURIComponent(r.name)}`);
  for (const r of db.prepare('SELECT DISTINCT line FROM defects WHERE line LIKE ? LIMIT 6').all(like)) add('Line', r.line, `/defects?line=${encodeURIComponent(r.line)}`);
  for (const r of db.prepare('SELECT DISTINCT defect_name FROM defects WHERE defect_name LIKE ? LIMIT 6').all(like)) add('Defect', r.defect_name, `/defects?defect=${encodeURIComponent(r.defect_name)}`);
  for (const r of db.prepare('SELECT DISTINCT violation FROM compliance WHERE violation LIKE ? LIMIT 4').all(like)) add('Violation', r.violation, `/compliance?defect=${encodeURIComponent(r.violation)}`);
  for (const r of db.prepare('SELECT DISTINCT item FROM safety WHERE item LIKE ? OR item_raw LIKE ? LIMIT 4').all(like, like)) add('Safety item', r.item, `/safety/items?defect=${encodeURIComponent(r.item)}`);
  for (const r of db.prepare('SELECT DISTINCT area FROM safety WHERE area LIKE ? LIMIT 4').all(like)) add('Safety area', r.area, `/safety/areas?area=${encodeURIComponent(r.area)}`);
  if (/^\d+$/.test(q)) {
    for (const r of db.prepare('SELECT DISTINCT operator FROM defects WHERE operator LIKE ? LIMIT 3').all(q + '%')) add('Operator (defects)', r.operator, `/defects?op=${r.operator}&mode=all`);
    for (const r of db.prepare('SELECT DISTINCT operator FROM compliance WHERE operator LIKE ? LIMIT 3').all(q + '%')) add('Operator (compliance)', r.operator, `/compliance/operators?op=${r.operator}&mode=all`);
    for (const r of db.prepare('SELECT DISTINCT operator FROM safety WHERE operator LIKE ? LIMIT 3').all(q + '%')) add('Operator (safety)', r.operator, `/safety?op=${r.operator}&mode=all`);
  }
  return out;
}));

// ---------- uploads ----------
function overridesOf(req) { try { return JSON.parse(req.body.overrides || '[]'); } catch { return []; } }
app.post('/api/upload/analyze', admin, upload.single('file'), wrap(req => {
  if (!req.file) throw new Error('No file received');
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(req.file.originalname)) throw new Error('Please upload an .xlsx, .xls or .csv file');
  return IMP.analyze(db, req.file.buffer, req.file.originalname, overridesOf(req));
}));
app.post('/api/upload/reanalyze', admin, wrap(req => {
  const { token, overrides } = req.body;
  return IMP.reanalyze(db, token, overrides || []);
}));
app.post('/api/upload/commit', admin, wrap(req => {
  const { token, overrides, decisions } = req.body;
  const r = IMP.commit(db, { token, overrides: overrides || [], decisions: decisions || {}, uploader: req.user.username });
  bump(); return r;
}));
app.get('/api/uploads', admin, wrap(() => db.prepare('SELECT id, file_name, stored_path, uploader, uploaded_at, segments, rows_imported, rows_rejected, date_from, date_to FROM uploads ORDER BY id DESC').all().map(u => {
  let active = 0; for (const t of ['defects', 'compliance', 'safety', 'production']) active += db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE upload_id=?`).get(u.id).n;
  active += db.prepare('SELECT COUNT(*) n FROM operators WHERE upload_id=?').get(u.id).n;
  return { ...u, rows_active: active };
})));
app.get('/api/uploads/:id', admin, wrap(req => { const u = db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id); if (!u) throw new Error('Not found'); return { ...u, report: JSON.parse(u.report || '{}') }; }));
app.get('/api/uploads/:id/file', admin, (req, res) => {
  const u = db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id);
  if (!u || !u.stored_path) return res.status(404).send('File not kept');
  res.download(path.join(DB.PATHS.project, u.stored_path), u.file_name);
});
app.delete('/api/uploads/:id', admin, wrap(req => { const n = IMP.deleteUpload(db, Number(req.params.id)); bump(); return { removed: n }; }));

// ---------- settings / master data ----------
app.get('/api/settings', admin, wrap(() => ({
  settings: settings(),
  facilities: db.prepare('SELECT * FROM facilities ORDER BY sort, name').all(),
  rules: db.prepare('SELECT * FROM facility_rules ORDER BY sort, id').all(),
  defectAlias: db.prepare('SELECT a.raw_key, a.canonical, (SELECT COUNT(*) FROM defects d WHERE lower(trim(d.defect_name_raw))=a.raw_key) n FROM defect_alias a ORDER BY a.canonical').all(),
  violationAlias: db.prepare('SELECT raw_key, canonical FROM violation_alias ORDER BY canonical').all(),
  safetyItems: db.prepare('SELECT raw_key, arabic, english FROM safety_items ORDER BY english').all(),
  templates: IMP.loadTemplates(db),
  users: db.prepare('SELECT username, role FROM users ORDER BY username').all(),
  names: {
    lines: db.prepare('SELECT line name, facility, COUNT(*) n FROM defects GROUP BY line UNION ALL SELECT line, facility, COUNT(*) FROM compliance GROUP BY line ORDER BY 1').all(),
    areas: db.prepare('SELECT area name, facility, COUNT(*) n FROM safety GROUP BY area ORDER BY 1').all(),
    facilityRaw: db.prepare('SELECT facility_raw name, facility, COUNT(*) n FROM compliance GROUP BY facility_raw ORDER BY 1').all(),
  },
  backups: backup.list(),
})));
const SETTING_KEYS = ['week', 'targets', 'targetWeeks', 'spec', 'facilitySpec', 'newOperatorMonths', 'presentation', 'requireLogin', 'company', 'repeatDays', 'critical', 'complianceIncludeCamera'];
app.put('/api/settings/:key', admin, wrap(req => {
  if (!SETTING_KEYS.includes(req.params.key)) throw new Error('Unknown setting');
  DB.setSetting(db, req.params.key, req.body.value);
  if (['week', 'critical'].includes(req.params.key)) IMP.rederive(db);
  bump(); return { ok: true };
}));
app.put('/api/master/facilities', admin, wrap(req => {
  DB.tx(db, () => { db.prepare('DELETE FROM facilities').run(); const s = db.prepare('INSERT INTO facilities(name,color,confirmed,production,sort) VALUES(?,?,?,?,?)'); (req.body.list || []).forEach((f, i) => f.name && s.run(String(f.name).trim(), f.color || '#64748b', f.confirmed ? 1 : 0, f.production === false ? 0 : 1, i)); });
  bump(); return { ok: true };
}));
app.put('/api/master/rules', admin, wrap(req => {
  DB.tx(db, () => { db.prepare('DELETE FROM facility_rules').run(); const s = db.prepare('INSERT INTO facility_rules(pattern,match,facility,sort) VALUES(?,?,?,?)'); (req.body.list || []).forEach((r, i) => r.pattern && r.facility && s.run(String(r.pattern).trim(), r.match || 'exact', String(r.facility).trim(), i)); });
  IMP.rederive(db); bump(); return { ok: true };
}));
app.put('/api/master/alias/:kind', admin, wrap(req => {
  const table = { defect: 'defect_alias', violation: 'violation_alias' }[req.params.kind]; if (!table) throw new Error('Unknown alias kind');
  DB.tx(db, () => { const s = db.prepare(`INSERT OR REPLACE INTO ${table}(raw_key, canonical) VALUES(?,?)`); for (const a of req.body.list || []) if (a.raw_key && a.canonical) s.run(C.normKey(a.raw_key), C.normText(a.canonical)); });
  IMP.rederive(db); bump(); return { ok: true };
}));
app.put('/api/master/safety-items', admin, wrap(req => {
  DB.tx(db, () => { const s = db.prepare('UPDATE safety_items SET english=? WHERE raw_key=?'); for (const a of req.body.list || []) s.run(C.normText(a.english), a.raw_key); });
  IMP.rederive(db); bump(); return { ok: true };
}));
/** Map one new name from the validation report to an existing one. */
app.post('/api/master/map', admin, wrap(req => {
  const { kind, raw, target } = req.body;
  if (kind === 'facility') { const n = db.prepare('SELECT COALESCE(MAX(sort),0)+1 m FROM facility_rules').get().m; db.prepare('INSERT INTO facility_rules(pattern,match,facility,sort) VALUES(?,?,?,?)').run(raw, 'exact', target, n); if (!db.prepare('SELECT 1 FROM facilities WHERE name=?').get(target)) db.prepare('INSERT INTO facilities(name,color,confirmed,production,sort) VALUES(?,?,?,?,?)').run(target, '#64748b', 1, 1, 99); }
  else if (kind === 'defect') db.prepare('INSERT OR REPLACE INTO defect_alias(raw_key, canonical) VALUES(?,?)').run(C.normKey(raw), target);
  else if (kind === 'violation') db.prepare('INSERT OR REPLACE INTO violation_alias(raw_key, canonical) VALUES(?,?)').run(C.normKey(raw), target);
  else if (kind === 'item') db.prepare('UPDATE safety_items SET english=? WHERE raw_key=?').run(target, C.normKey(raw));
  else throw new Error('Unknown kind');
  IMP.rederive(db); bump(); return { ok: true };
}));
app.get('/api/translations', admin, wrap(req => {
  const q = String(req.query.q || '').trim(); const filter = req.query.filter === 'auto' ? "source='auto'" : '1=1';
  const page = Math.max(1, Number(req.query.page) || 1); const size = 100;
  const w = q ? `AND (arabic LIKE ? OR english LIKE ?)` : ''; const p = q ? [`%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) n FROM translations WHERE ${filter} ${w}`).get(...p).n;
  const autoN = db.prepare("SELECT COUNT(*) n FROM translations WHERE source='auto'").get().n;
  const rows = db.prepare(`SELECT raw_key, arabic, english, source FROM translations WHERE ${filter} ${w} ORDER BY source='auto' DESC, arabic LIMIT ${size} OFFSET ${(page - 1) * size}`).all(...p);
  return { total, auto: autoN, page, size, rows };
}));
app.put('/api/translations', admin, wrap(req => {
  const st = db.prepare("UPDATE translations SET english=?, source='manual' WHERE raw_key=?");
  DB.tx(db, () => { for (const r of req.body.list || []) if (r.raw_key && String(r.english || '').trim()) st.run(String(r.english).trim(), r.raw_key); });
  require('./translate').invalidate(); bump(); return { ok: true };
}));
app.put('/api/templates/:id', admin, wrap(req => {
  const t = req.body;
  db.prepare('UPDATE templates SET name=?, data_type=?, source=?, sheet_hint=?, priority=?, required=?, field_map=? WHERE id=?').run(t.name, t.data_type, t.source || null, t.sheet_hint || '', Number(t.priority) || 0, JSON.stringify(t.required || []), JSON.stringify(t.field_map || {}), req.params.id);
  return { ok: true };
}));
app.delete('/api/templates/:id', admin, wrap(req => { db.prepare('DELETE FROM templates WHERE id=?').run(req.params.id); return { ok: true }; }));
app.get('/api/fields', admin, wrap(() => require('./defaults').FIELDS));
app.post('/api/users', admin, wrap(req => {
  const { username, password, role } = req.body; if (!username || !password) throw new Error('User name and password are required');
  const h = DB.hashPassword(password); db.prepare('INSERT OR REPLACE INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run(String(username).trim(), h.salt, h.hash, role === 'admin' ? 'admin' : 'viewer'); return { ok: true };
}));
app.delete('/api/users/:u', admin, wrap(req => {
  if (req.params.u === req.user.username) throw new Error('You cannot delete yourself');
  db.prepare('DELETE FROM users WHERE username=?').run(req.params.u); db.prepare('DELETE FROM sessions WHERE username=?').run(req.params.u); return { ok: true };
}));
app.post('/api/backup', admin, wrap(() => ({ file: backup.run(db, true) })));

// ---------- static website ----------
const NM = path.join(DB.PATHS.website, 'node_modules');
const vendor = { 'echarts.min.js': 'echarts/dist/echarts.min.js', 'exceljs.min.js': 'exceljs/dist/exceljs.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js' };
app.get('/vendor/:f', (req, res) => { const p = vendor[req.params.f]; if (!p) return res.status(404).end(); res.setHeader('Cache-Control', 'public, max-age=604800'); res.sendFile(path.join(NM, p)); });
app.use(express.static(path.join(DB.PATHS.website, 'public'), { index: false, maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(DB.PATHS.website, 'public', 'index.html')));

// ---------- start ----------
backup.schedule(db);
db.exec('PRAGMA optimize');
warm();
app.listen(config.port, config.host, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Production Data Analysis website is running.`);
  console.log(`  On this PC:        http://localhost:${config.port}`);
  for (const ip of ips) console.log(`  On the network:    http://${ip}:${config.port}`);
});
