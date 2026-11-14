'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const C = require('./calc');
const DB = require('./db');
const T = require('./translate');

const TABLE = { defects: 'defects', compliance: 'compliance', safety: 'safety', production: 'production' };

// ---------- reading ----------
function readWorkbook(buf, fileName) {
  const isCsv = /\.csv$/i.test(fileName);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: isCsv, dense: true });
  return wb.SheetNames.map(name => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true });
    // header row = first row (within 10) that has at least 3 text cells
    let hr = 0;
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      if ((aoa[i] || []).filter(v => typeof v === 'string' && v.trim()).length >= 3) { hr = i; break; }
    }
    const headers = (aoa[hr] || []).map(h => C.normText(h));
    return { name, headerRow: hr, headers, rows: aoa.slice(hr + 1) };
  });
}

function headerIndex(headers) { const m = new Map(); headers.forEach((h, i) => { const k = C.normKey(h); if (k && !m.has(k)) m.set(k, i); }); return m; }

// ---------- template detection ----------
function loadTemplates(db) {
  return db.prepare('SELECT * FROM templates ORDER BY priority DESC, id').all().map(t => ({ ...t, required: JSON.parse(t.required || '[]'), field_map: JSON.parse(t.field_map || '{}') }));
}

function matchSheet(sheet, templates) {
  const idx = headerIndex(sheet.headers);
  let best = null;
  for (const t of templates) {
    const hintOk = t.sheet_hint ? new RegExp(t.sheet_hint, 'i').test(sheet.name.trim()) : true;
    if (!hintOk) continue;
    if (t.data_type === 'ignore') { if (t.sheet_hint) { best = best || t; } continue; }
    if (!t.required.length) continue;
    if (!t.required.every(h => idx.has(C.normKey(h)))) continue;
    const score = (t.sheet_hint ? 100 : 0) + (t.priority || 0) + t.required.length;
    if (!best || best.data_type === 'ignore' || score > best._score) best = { ...t, _score: score };
  }
  return best;
}

function detect(sheets, templates) {
  const roles = sheets.map(s => {
    const nonBlank = s.rows.filter(r => r && r.some(v => v !== null && v !== '')).length;
    const t = matchSheet(s, templates);
    if (!t) return { sheet: s.name, role: nonBlank ? 'unmapped' : 'ignore', reason: nonBlank ? 'New layout: map the columns' : 'Empty sheet', rows: nonBlank };
    if (t.data_type === 'ignore' && sheets.length === 1) return { sheet: s.name, role: nonBlank ? 'unmapped' : 'ignore', reason: 'New layout: map the columns', rows: nonBlank };
    if (t.data_type === 'ignore') return { sheet: s.name, role: 'ignore', templateId: t.id, template: t.name, reason: 'Pivot / summary sheet (rebuilt by the website)', rows: nonBlank };
    return { sheet: s.name, role: 'import', templateId: t.id, template: t.name, data_type: t.data_type, source: t.source, exclusive: t.exclusive, priority: t._score, rows: nonBlank };
  });
  // exclusive groups: keep only the strongest sheet (e.g. safety "All Record" already holds the daily "Compliance" rows)
  const groups = {};
  for (const r of roles) if (r.role === 'import' && r.exclusive) (groups[r.exclusive] = groups[r.exclusive] || []).push(r);
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.priority - a.priority);
    for (const r of list.slice(1)) { r.role = 'ignore'; r.reason = `Its rows are already inside sheet "${list[0].sheet}"`; }
  }
  return roles;
}

// ---------- normalisation ----------
const txt = v => { const s = C.normText(v); return s === '' ? null : s; };
function num(v, dflt = null) {
  if (v === null || v === undefined || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : NaN;
}
function yes(v) { const k = C.normKey(v); return ['yes', 'y', '1', 'true', 'x'].includes(k) ? 1 : 0; }
function shiftName(v) {
  const s = txt(v); if (!s) return null;
  const m = s.match(/^(?:shift\s*)?([123])\s*(?:st|nd|rd)?$/i);
  return m ? `Shift ${m[1]}` : s;
}
const nz = v => { const s = txt(v); return !s || s === '0' || C.normKey(s) === 'na' ? null : s; };

function makeCtx(db) {
  const m = DB.master(db);
  return { ...m, week: m.settings.week, critical: m.settings.critical, newNames: { lines: new Map(), facilities: new Map(), defects: new Map(), violations: new Map(), items: new Map(), areas: new Map() } };
}

function canonical(aliasMap, raw, bucket) {
  const k = C.normKey(raw);
  if (!k) return null;
  if (aliasMap.has(k)) return aliasMap.get(k);
  // first spelling seen becomes the canonical name; other capitalisations follow it
  const name = C.normText(raw);
  aliasMap.set(k, name);
  bucket.set(name, (bucket.get(name) || 0) + 1);
  return name;
}

function facilityOf(ctx, ...names) {
  for (const n of names) { const f = C.facilityFor(n, ctx.rules); if (f) return f; }
  const fallback = names.map(txt).find(Boolean) || null;
  if (fallback) ctx.newNames.facilities.set(fallback, (ctx.newNames.facilities.get(fallback) || 0) + 1);
  return fallback;
}

function deriveDefect(rec, critical) {
  const name = C.normKey(rec.defect_name), found = C.normKey(rec.found_at), audit = C.normKey(rec.audit);
  rec.is_mislocation = name === 'mislocation' ? 1 : 0;
  rec.is_electrical = rec.is_mislocation && found === 'electrical test' ? 1 : 0;
  rec.is_rework = audit === 'rework' || found === 'rework area' ? 1 : 0;
  rec.critical_type = C.criticalType(rec.defect_name, critical) || (rec.critical_src ? 'Flagged in data' : null);
  rec.is_critical = rec.critical_type ? 1 : 0;
  return rec;
}

function normalize(type, get, ctx, source) {
  const date = C.parseDate(get('date'), 'mdy');
  if (!date) return { error: txt(get('date')) == null ? 'Missing date' : `Bad date "${get('date')}"` };
  const wk = C.weekInfo(date, ctx.week);
  const srcWeek = num(get('week'));
  const base = { date, week_key: wk.key, src_week: isFinite(srcWeek) ? srcWeek : null };
  if (type === 'defects') {
    const qty = num(get('qty'), 1);
    if (isNaN(qty) || qty < 0) return { error: `Bad number in quantity "${get('qty')}"` };
    const line = txt(get('line')); const facCol = txt(get('facility'));
    if (!line && !facCol) return { error: 'Missing area / assembly line' };
    const rawName = txt(get('defect_name'));
    if (!rawName) return { error: 'Missing defect name' };
    const rec = {
      ...base, shift: shiftName(get('shift')), team_leader: txt(get('team_leader')), found_at: txt(get('found_at')), audit: txt(get('audit')),
      defect_name_raw: rawName, defect_name: canonical(ctx.defectAlias, rawName, ctx.newNames.defects), defect_code: txt(get('defect_code')),
      yellow_card: nz(get('yellow_card')), produced_at: txt(get('produced_at')), breakdown: txt(get('breakdown')), connector_no: txt(get('connector_no')),
      clip_no: txt(get('clip_no')), circuit_no: txt(get('circuit_no')), std_dim: txt(get('std_dim')), act_dim: txt(get('act_dim')),
      tol_min: txt(get('tol_min')), tol_max: txt(get('tol_max')), dev_dim: txt(get('dev_dim')), qty, operator: nz(get('operator')),
      terminal: txt(get('terminal')), cpg: yes(get('cpg')), man: nz(get('man')), machine: nz(get('machine')), method: nz(get('method')),
      material: nz(get('material')), line: line || facCol, facility: facilityOf(ctx, line, facCol), site: txt(get('site')),
      category: txt(get('category')), part_number: txt(get('part_number')), critical_src: get('critical') == null ? null : yes(get('critical')),
    };
    const rm = num(get('rework_min')); rec.rework_min = isFinite(rm) ? rm : null;
    return { rec: deriveDefect(rec, ctx.critical) };
  }
  if (type === 'compliance') {
    const qty = num(get('qty'), 1);
    if (isNaN(qty) || qty < 0) return { error: `Bad number in cases "${get('qty')}"` };
    const rawV = txt(get('violation'));
    if (!rawV) return { error: 'Missing violation (defect name)' };
    const line = txt(get('line')), facRaw = txt(get('facility'));
    if (!line && !facRaw) return { error: 'Missing facility / line' };
    const violation = canonical(ctx.violationAlias, rawV, ctx.newNames.violations);
    const time = C.parseTime(get('time')); const op = nz(get('operator')); const rep = txt(get('report_no'));
    const rec = {
      ...base, shift: shiftName(get('shift')), facility_raw: facRaw, facility: facilityOf(ctx, line, facRaw), line, team_leader: txt(get('team_leader')),
      violation_raw: rawV, violation, operator: op, qty, patroller: txt(get('patroller')), data_entry: txt(get('data_entry')), time, report_no: rep,
      found_at: txt(get('found_at')), station_no: txt(get('station_no')), jig: txt(get('jig')), justification2: txt(get('justification2')),
      comment: txt(get('comment')), justification: txt(get('justification')), signature: txt(get('signature')), source: source || 'Line',
      operator_start: C.parseDate(get('operator_start')),
    };
    rec.ukey = rep ? `R|${C.normKey(rep)}` : `C|${date}|${time || ''}|${op || ''}|${C.normKey(violation)}`;
    return { rec };
  }
  if (type === 'safety') {
    const area = txt(get('area')); const raw = txt(get('item'));
    if (!area) return { error: 'Missing area' };
    if (!raw) return { error: 'Missing non-compliance item' };
    const k = C.normKey(raw); let item = ctx.safetyItems.get(k);
    if (!item) { item = { raw_key: k, arabic: raw, english: raw }; ctx.safetyItems.set(k, item); ctx.newNames.items.set(raw, (ctx.newNames.items.get(raw) || 0) + 1); }
    const team = txt(get('team'));
    return { rec: {
      ...base, shift: shiftName(get('shift')), area, facility: C.facilityFor(area, ctx.rules), location: txt(get('location')),
      team: team ? team.toUpperCase() : null, item_raw: item.arabic, item: item.english, operator: nz(get('operator')),
      department: txt(get('department')), notes: txt(get('notes')),
    } };
  }
  if (type === 'production') {
    const qty = num(get('qty'));
    if (qty === null || isNaN(qty)) return { error: `Bad number in produced quantity "${get('qty')}"` };
    const line = txt(get('line')), facCol = txt(get('facility'));
    if (!line && !facCol) return { error: 'Missing area / line' };
    return { rec: { date, week_key: wk.key, line, facility: facilityOf(ctx, line, facCol), qty } };
  }
  return { error: 'Unknown data type' };
}

function normalizeOperators(get) {
  const op = nz(get('operator')); const sd = C.parseDate(get('start_date'));
  if (!op) return { error: 'Missing operator ID' };
  if (!sd) return { error: 'Missing / bad start date' };
  return { rec: { operator: op, start_date: sd, name: txt(get('name')), facility: txt(get('facility')) } };
}

/** Turn one sheet into normalised records using a field map {target: header}. */
function processSheet(sheet, plan, ctx) {
  const idx = headerIndex(sheet.headers);
  const col = {};
  for (const [target, header] of Object.entries(plan.field_map || {})) if (header && idx.has(C.normKey(header))) col[target] = idx.get(C.normKey(header));
  const out = { sheet: sheet.name, data_type: plan.data_type, template: plan.template, records: [], rejects: [], blank: 0, read: 0, dupInFile: 0 };
  const seen = new Set();
  sheet.rows.forEach((row, i) => {
    if (!row || !row.some(v => v !== null && C.normText(v) !== '')) { out.blank++; return; }
    out.read++;
    const get = f => (col[f] === undefined ? null : row[col[f]]);
    const r = plan.data_type === 'operators' ? normalizeOperators(get) : normalize(plan.data_type, get, ctx, plan.source);
    if (r.error) { out.rejects.push({ row: i + sheet.headerRow + 2, reason: r.error }); return; }
    if (r.rec.ukey) { if (seen.has(r.rec.ukey)) { out.dupInFile++; return; } seen.add(r.rec.ukey); }
    out.records.push(r.rec);
  });
  return out;
}

// ---------- analyse (dry run) and commit ----------
const pending = new Map(); // token -> {buf, fileName, sheets, created}

function sheetPlans(roles, templates, overrides = []) {
  const byId = new Map(templates.map(t => [t.id, t]));
  return roles.map(r => {
    const o = overrides.find(x => x.sheet === r.sheet);
    if (o) {
      if (o.role === 'ignore') return { sheet: r.sheet, role: 'ignore' };
      if (o.templateId) { const t = byId.get(Number(o.templateId)); if (t) return { sheet: r.sheet, role: t.data_type === 'ignore' ? 'ignore' : 'import', data_type: t.data_type, field_map: t.field_map, source: t.source, template: t.name }; }
      if (o.mapping) return { sheet: r.sheet, role: 'import', data_type: o.mapping.data_type, field_map: o.mapping.field_map, source: o.mapping.source || (o.mapping.data_type === 'compliance' ? 'Line' : null), template: o.mapping.saveAs || 'Custom mapping', saveAs: o.mapping.saveAs };
    }
    if (r.role !== 'import') return { sheet: r.sheet, role: r.role };
    const t = byId.get(r.templateId);
    return { sheet: r.sheet, role: 'import', data_type: t.data_type, field_map: t.field_map, source: t.source, template: t.name };
  });
}

function run(db, buf, fileName, overrides) {
  const sheets = readWorkbook(buf, fileName);
  const templates = loadTemplates(db);
  const roles = detect(sheets, templates);
  const plans = sheetPlans(roles, templates, overrides);
  const ctx = makeCtx(db);
  const results = [];
  for (const p of plans) {
    if (p.role !== 'import') continue;
    results.push(processSheet(sheets.find(s => s.name === p.sheet), p, ctx));
  }
  // cross-sheet de-duplication (compliance: week sheet + Line sheet repeat the same report numbers)
  const keys = new Set();
  for (const r of results) {
    if (r.data_type !== 'compliance') continue;
    r.records = r.records.filter(x => { if (keys.has(x.ukey)) { r.dupInFile++; return false; } keys.add(x.ukey); return true; });
  }
  return { sheets, roles, plans, results, ctx };
}

function summarize(db, run) {
  const bySeg = {};
  for (const r of run.results) {
    const s = (bySeg[r.data_type] = bySeg[r.data_type] || { data_type: r.data_type, records: 0, quantity: 0, dates: new Set() });
    s.records += r.records.length;
    for (const x of r.records) { s.quantity += x.qty === undefined ? 1 : Number(x.qty) || 0; if (x.date) s.dates.add(x.date); }
  }
  const segments = Object.values(bySeg).map(s => {
    const dates = [...s.dates].sort();
    let existing = [];
    if (TABLE[s.data_type] && dates.length) {
      const rows = db.prepare(`SELECT date, COUNT(*) n FROM ${TABLE[s.data_type]} WHERE date BETWEEN ? AND ? GROUP BY date`).all(dates[0], dates[dates.length - 1]);
      const set = new Set(dates); existing = rows.filter(r => set.has(r.date));
    }
    return { data_type: s.data_type, records: s.records, quantity: s.quantity, date_from: dates[0] || null, date_to: dates[dates.length - 1] || null, days: dates.length, existing };
  });
  // new names (not known before this file)
  const knownLines = new Set(db.prepare('SELECT DISTINCT line FROM defects UNION SELECT DISTINCT line FROM compliance').all().map(r => C.normKey(r.line)));
  const knownAreas = new Set(db.prepare('SELECT DISTINCT area FROM safety').all().map(r => C.normKey(r.area)));
  const facNames = new Set(db.prepare('SELECT name FROM facilities').all().map(r => r.name));
  const lines = new Map(), areas = new Map();
  for (const r of run.results) for (const x of r.records) {
    if (x.line && !knownLines.has(C.normKey(x.line))) lines.set(x.line, (lines.get(x.line) || 0) + 1);
    if (x.area && !knownAreas.has(C.normKey(x.area))) areas.set(x.area, (areas.get(x.area) || 0) + 1);
  }
  const nn = run.ctx.newNames;
  const list = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const warnings = [];
  for (const r of run.results) {
    const mism = r.records.filter(x => x.src_week && x.week_key % 100 !== x.src_week).length;
    if (mism) warnings.push(`${r.sheet}: ${mism} rows have a Week value that differs from the plant week of their date (the date is used).`);
    const sw = run.roles.find(x => x.sheet === r.sheet);
    const m = r.sheet.match(/WK\s*(\d+)/i);
    if (m && r.records.length && r.records.every(x => x.week_key % 100 !== Number(m[1]))) warnings.push(`Sheet "${r.sheet}" is named WK${m[1]} but its rows are ${[...new Set(r.records.map(x => 'WK' + (x.week_key % 100)))].join(', ')}; the Week column / date is used, not the sheet name.`);
    void sw;
  }
  return {
    sheets: run.results.map(r => {
      const reasons = {}; for (const x of r.rejects) reasons[x.reason.replace(/".*"/, '"…"')] = (reasons[x.reason.replace(/".*"/, '"…"')] || 0) + 1;
      const dates = r.records.map(x => x.date).filter(Boolean).sort();
      return { sheet: r.sheet, data_type: r.data_type, template: r.template, rows_read: r.read, valid: r.records.length, rejected: r.rejects.length, blank: r.blank, duplicates_in_file: r.dupInFile, reasons, rejects: r.rejects.slice(0, 200), date_from: dates[0] || null, date_to: dates[dates.length - 1] || null, quantity: r.records.reduce((s, x) => s + (x.qty === undefined ? 1 : Number(x.qty) || 0), 0) };
    }),
    roles: run.roles.map(r => ({ ...r, plan: run.plans.find(p => p.sheet === r.sheet) })),
    segments,
    newNames: {
      lines: list(lines), areas: list(areas),
      unmappedFacilities: list(nn.facilities).filter(x => !facNames.has(x.name)),
      defects: list(nn.defects), violations: list(nn.violations), safetyItems: list(nn.items),
    },
    warnings,
  };
}

function analyze(db, buf, fileName, overrides) {
  const r = run(db, buf, fileName, overrides);
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { buf, fileName, created: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.created > 3600e3) pending.delete(k);
  return {
    token, fileName,
    book: r.sheets.map(s => ({ name: s.name, headers: s.headers.filter(Boolean), rowCount: s.rows.length, preview: s.rows.filter(x => x && x.some(v => v !== null)).slice(0, 5).map(row => s.headers.map((_, i) => (row[i] === undefined ? null : row[i]))) })),
    ...summarize(db, r),
  };
}

const INSERT_COLS = {
  defects: ['upload_id', 'date', 'week_key', 'src_week', 'shift', 'team_leader', 'found_at', 'audit', 'defect_name', 'defect_name_raw', 'defect_code', 'yellow_card', 'produced_at', 'breakdown', 'connector_no', 'clip_no', 'circuit_no', 'std_dim', 'act_dim', 'tol_min', 'tol_max', 'dev_dim', 'qty', 'operator', 'terminal', 'cpg', 'man', 'machine', 'method', 'material', 'line', 'facility', 'site', 'category', 'part_number', 'rework_min', 'critical_src', 'is_critical', 'critical_type', 'is_mislocation', 'is_electrical', 'is_rework'],
  compliance: ['upload_id', 'ukey', 'date', 'week_key', 'src_week', 'shift', 'facility_raw', 'facility', 'line', 'team_leader', 'violation', 'violation_raw', 'operator', 'qty', 'patroller', 'data_entry', 'time', 'report_no', 'found_at', 'station_no', 'jig', 'justification2', 'comment', 'justification', 'signature', 'source', 'operator_start'],
  safety: ['upload_id', 'date', 'week_key', 'src_week', 'shift', 'area', 'facility', 'location', 'team', 'item_raw', 'item', 'operator', 'department', 'notes'],
  production: ['upload_id', 'date', 'week_key', 'facility', 'line', 'qty'],
};

/**
 * Commit an analysed file. decisions: { defects:'replace'|'skip', compliance:..., safety:..., production:... } for dates already in the database.
 */
function commit(db, { token, buf, fileName, overrides, decisions = {}, uploader = 'admin', keepFile = true }) {
  if (token) { const p = pending.get(token); if (!p) throw new Error('Upload expired, please upload the file again'); buf = p.buf; fileName = p.fileName; pending.delete(token); }
  const r = run(db, buf, fileName, overrides);
  const summary = summarize(db, r);
  const now = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  let rel = null;
  if (keepFile) {
    const dir = path.join(DB.PATHS.uploads, day);
    fs.mkdirSync(dir, { recursive: true });
    const safe = fileName.replace(/[^\w.\- ()]/g, '_');
    const fname = `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}_${safe}`;
    fs.writeFileSync(path.join(dir, fname), buf);
    rel = `Uploads/${day}/${fname}`;
  }
  const actions = [];
  const result = DB.tx(db, () => {
    const up = db.prepare('INSERT INTO uploads(file_name,stored_path,uploader,uploaded_at,segments) VALUES(?,?,?,?,?)')
      .run(fileName, rel, uploader, now.toISOString(), [...new Set(r.results.map(x => x.data_type))].join(', '));
    const uploadId = Number(up.lastInsertRowid);
    let imported = 0, skipped = 0;
    const byType = {};
    for (const res of r.results) (byType[res.data_type] = byType[res.data_type] || []).push(...res.records);
    for (const [type, recs] of Object.entries(byType)) {
      if (type === 'operators') {
        const st = db.prepare('INSERT OR REPLACE INTO operators(operator,start_date,name,facility,upload_id) VALUES(?,?,?,?,?)');
        for (const x of recs) st.run(x.operator, x.start_date, x.name, x.facility, uploadId);
        imported += recs.length; actions.push(`Operators: ${recs.length} saved`); continue;
      }
      const table = TABLE[type];
      const dates = [...new Set(recs.map(x => x.date))];
      const seg = summary.segments.find(s => s.data_type === type);
      const existingDates = new Set((seg ? seg.existing : []).map(e => e.date));
      let list = recs;
      if (existingDates.size) {
        const mode = decisions[type] || 'replace';
        if (mode === 'skip') { list = recs.filter(x => !existingDates.has(x.date)); skipped += recs.length - list.length; actions.push(`${type}: ${existingDates.size} dates already loaded were skipped (${recs.length - list.length} rows)`); }
        else {
          const del = db.prepare(`DELETE FROM ${table} WHERE date = ?`);
          let n = 0; for (const d of existingDates) n += Number(del.run(d).changes);
          actions.push(`${type}: ${existingDates.size} dates already loaded were replaced (${n} old rows removed)`);
        }
      }
      const cols = INSERT_COLS[type];
      const verb = type === 'compliance' ? 'INSERT OR REPLACE' : 'INSERT';
      const st = db.prepare(`${verb} INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
      for (const x of list) { x.upload_id = uploadId; st.run(...cols.map(c => (x[c] === undefined ? null : x[c]))); }
      imported += list.length;
      void dates;
    }
    // remember new aliases and new safety items
    const da = db.prepare('INSERT OR IGNORE INTO defect_alias(raw_key, canonical) VALUES(?,?)');
    for (const [k, v] of r.ctx.defectAlias) da.run(k, v);
    const va = db.prepare('INSERT OR IGNORE INTO violation_alias(raw_key, canonical) VALUES(?,?)');
    for (const [k, v] of r.ctx.violationAlias) va.run(k, v);
    const si = db.prepare('INSERT OR IGNORE INTO safety_items(raw_key, arabic, english) VALUES(?,?,?)');
    for (const v of r.ctx.safetyItems.values()) si.run(v.raw_key, v.arabic, v.english);
    // save custom mappings as templates for next time
    for (const p of r.plans) if (p.saveAs) {
      const sh = r.sheets.find(s => s.name === p.sheet);
      const required = Object.entries(p.field_map).filter(([, h]) => h).map(([, h]) => h).slice(0, 6);
      db.prepare('INSERT INTO templates(name,data_type,source,sheet_hint,priority,exclusive,required,field_map,builtin,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)')
        .run(p.saveAs, p.data_type, p.source || null, '', 8, null, JSON.stringify(required), JSON.stringify(p.field_map), now.toISOString());
      void sh;
    }
    // translate new Arabic notes / comments into English (offline) and remember them
    const texts = new Set();
    for (const res of r.results) for (const x of res.records) for (const f of ['notes', 'comment', 'justification', 'justification2']) if (x[f]) texts.add(x[f]);
    const learned = T.learn(db, texts);
    if (learned.count) actions.push(`${learned.count} new Arabic text${learned.count > 1 ? 's were' : ' was'} translated into English automatically (marked [auto]; review in Settings › Arabic translations).`);
    const allDates = r.results.flatMap(x => x.records.map(y => y.date)).filter(Boolean).sort();
    const rejected = summary.sheets.reduce((s, x) => s + x.rejected, 0);
    const report = { ...summary, actions, imported, skipped, translated: learned };
    db.prepare('UPDATE uploads SET rows_imported=?, rows_rejected=?, date_from=?, date_to=?, report=? WHERE id=?')
      .run(imported, rejected, allDates[0] || null, allDates[allDates.length - 1] || null, JSON.stringify(report), uploadId);
    return { uploadId, ...report };
  });
  return result;
}

/** Re-apply mappings / aliases / critical list to all stored rows (after a Settings change). */
function rederive(db) {
  const ctx = makeCtx(db);
  DB.tx(db, () => {
    const fac = n => C.facilityFor(n, ctx.rules);
    for (const { line } of db.prepare('SELECT DISTINCT line FROM defects').all()) db.prepare('UPDATE defects SET facility=? WHERE line IS ?').run(fac(line) || line, line);
    for (const r of db.prepare('SELECT DISTINCT line, facility_raw FROM compliance').all()) db.prepare('UPDATE compliance SET facility=? WHERE line IS ? AND facility_raw IS ?').run(fac(r.line) || fac(r.facility_raw) || r.facility_raw || r.line, r.line, r.facility_raw);
    for (const { area } of db.prepare('SELECT DISTINCT area FROM safety').all()) db.prepare('UPDATE safety SET facility=? WHERE area IS ?').run(fac(area), area);
    for (const { line } of db.prepare('SELECT DISTINCT line FROM production').all()) db.prepare('UPDATE production SET facility=? WHERE line IS ?').run(fac(line) || line, line);
    for (const r of db.prepare('SELECT DISTINCT defect_name_raw, found_at, audit, critical_src FROM defects').all()) {
      const name = ctx.defectAlias.get(C.normKey(r.defect_name_raw)) || r.defect_name_raw;
      const d = deriveDefect({ defect_name: name, found_at: r.found_at, audit: r.audit, critical_src: r.critical_src }, ctx.critical);
      db.prepare('UPDATE defects SET defect_name=?, is_mislocation=?, is_electrical=?, is_rework=?, critical_type=?, is_critical=? WHERE defect_name_raw IS ? AND found_at IS ? AND audit IS ? AND critical_src IS ?')
        .run(name, d.is_mislocation, d.is_electrical, d.is_rework, d.critical_type, d.is_critical, r.defect_name_raw, r.found_at, r.audit, r.critical_src);
    }
    for (const { violation_raw } of db.prepare('SELECT DISTINCT violation_raw FROM compliance').all()) db.prepare('UPDATE compliance SET violation=? WHERE violation_raw IS ?').run(ctx.violationAlias.get(C.normKey(violation_raw)) || violation_raw, violation_raw);
    for (const it of ctx.safetyItems.values()) db.prepare('UPDATE safety SET item=?, item_raw=? WHERE item_raw IS ?').run(it.english, it.arabic, it.arabic);
    // week numbering may have changed
    const wk = ctx.week;
    for (const t of ['defects', 'compliance', 'safety', 'production']) for (const { date } of db.prepare(`SELECT DISTINCT date FROM ${t}`).all()) db.prepare(`UPDATE ${t} SET week_key=? WHERE date=?`).run(C.weekInfo(date, wk).key, date);
  });
}

function deleteUpload(db, id) {
  return DB.tx(db, () => {
    let n = 0;
    for (const t of ['defects', 'compliance', 'safety', 'production']) n += Number(db.prepare(`DELETE FROM ${t} WHERE upload_id=?`).run(id).changes);
    n += Number(db.prepare('DELETE FROM operators WHERE upload_id=?').run(id).changes);
    db.prepare('DELETE FROM uploads WHERE id=?').run(id);
    return n;
  });
}

function reanalyze(db, token, overrides) {
  const p = pending.get(token);
  if (!p) throw new Error('Upload expired, please upload the file again');
  return analyze(db, p.buf, p.fileName, overrides);
}

module.exports = { reanalyze, readWorkbook, detect, loadTemplates, analyze, commit, rederive, deleteUpload, deriveDefect, normalize, processSheet };
