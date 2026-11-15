'use strict';
// Period resolution, filters and SQL aggregation helpers shared by all pages.
const C = require('./calc');

const SEG = {
  defects: { table: 'defects', measure: 'SUM(qty)', unit: 'defects', name: 'defect_name', tl: 'team_leader', line: 'line', label: 'Defects' },
  compliance: { table: 'compliance', measure: 'SUM(qty)', unit: 'cases', name: 'violation', tl: 'team_leader', line: 'line', label: 'Compliance' },
  safety: { table: 'safety', measure: 'COUNT(*)', unit: 'cases', name: 'item', tl: 'team', line: 'location', label: 'Safety' },
};
const SUBSET = {
  defects: { all: '1=1', critical: 'is_critical=1', czcf: 'cpg=1', rework: 'is_rework=1', mislocation: 'is_mislocation=1', electrical: 'is_electrical=1' },
  compliance: { all: '1=1', camera: "source='Camera'", line: "source='Line'" },
  safety: { all: '1=1', assembly: "department='Assembly'" },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dLabel(iso, withYear = false) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`; }
function dShort(iso) { return `${DOW[C.dow(iso)]} ${dLabel(iso)}`; }

function list(v) { if (v === undefined || v === null || v === '') return []; return String(v).split(',').map(s => s.trim()).filter(Boolean); }

function dataBounds(db) {
  const r = {};
  for (const s of Object.keys(SEG)) r[s] = db.prepare(`SELECT MIN(date) a, MAX(date) b FROM ${SEG[s].table}`).get();
  const all = Object.values(r).filter(x => x.b);
  return { seg: r, min: all.length ? all.map(x => x.a).sort()[0] : null, max: all.length ? all.map(x => x.b).sort().pop() : null };
}

/** Resolve the period and comparison period from URL query values. */
function resolvePeriod(q, bounds, cfg) {
  const latest = bounds.max || new Date().toISOString().slice(0, 10);
  let mode = q.mode || (q.day ? 'day' : q.from ? 'range' : 'week');
  let from, to, label, weekKey = null;
  if (mode === 'day') { from = to = q.day || latest; label = `${dLabel(from, true)} (${C.weekInfo(from, cfg).label})`; }
  else if (mode === 'range') { from = q.from || latest; to = q.to || from; if (to < from) [from, to] = [to, from]; label = `${dLabel(from)} – ${dLabel(to, true)}`; }
  else if (mode === 'mtd') { to = q.to || latest; from = to.slice(0, 8) + '01'; label = `${MONTHS[+to.slice(5, 7) - 1]} ${to.slice(0, 4)} to date`; }
  else if (mode === 'ytd') { to = q.to || latest; from = to.slice(0, 4) + '-01-01'; label = `${to.slice(0, 4)} to date`; }
  else if (mode === 'all') { from = bounds.min || latest; to = latest; label = 'All data to date'; }
  else {
    mode = 'week';
    let wk;
    if (q.week) { const k = Number(q.week); wk = k > 1000 ? C.weekFromKey(k, cfg) : C.weekRange(Number(q.year) || Number(latest.slice(0, 4)), k, cfg); }
    else wk = C.weekInfo(latest, cfg);
    from = wk.start; to = wk.end; weekKey = wk.key;
    label = `WK${wk.key % 100} (${dLabel(from)} – ${dLabel(to, true)})`;
  }
  const short = mode === 'week' ? `WK${weekKey % 100}` : mode === 'day' ? dLabel(from) : label;
  const period = { mode, from, to, label, short, weekKey, days: C.daysBetween(from, to) + 1 };
  // comparison
  const cmp = q.cmp || (mode === 'all' ? 'none' : 'prev');
  let compare = null;
  if (cmp === 'custom' && q.cfrom) compare = { from: q.cfrom, to: q.cto || q.cfrom };
  else if (cmp === 'month') compare = { from: C.addDays(from, -28), to: C.addDays(to, -28) };
  else if (cmp === 'prev') {
    if (mode === 'day') { let d = C.addDays(from, -1); for (let i = 0; i < 6 && !cfg.workDays.includes(C.dow(d)); i++) d = C.addDays(d, -1); compare = { from: d, to: d }; }
    else if (mode === 'mtd') { const pm = C.addDays(from, -1).slice(0, 8) + '01'; compare = { from: pm, to: C.addDays(pm, C.daysBetween(from, to)) }; }
    else if (mode === 'ytd') { compare = { from: `${+from.slice(0, 4) - 1}-01-01`, to: `${+to.slice(0, 4) - 1}${to.slice(4)}` }; }
    else { const n = C.daysBetween(from, to) + 1; compare = { from: C.addDays(from, -n), to: C.addDays(from, -1) }; }
  }
  // A period that is still running (data ends before its last day) is "partial". Comparing it with a full
  // previous period would show a fake drop (e.g. 1 day vs 6 days = -83%), so the comparison is cut to the same days.
  if (bounds.max && from <= bounds.max && to > bounds.max && (mode === 'week' || mode === 'range')) {
    period.partial = true;
    period.dataTo = bounds.max;
    period.elapsedDays = C.daysBetween(from, bounds.max) + 1;
    period.workDays = C.workingDays(from, to, cfg.workDays);
    period.elapsedWorkDays = C.workingDays(from, bounds.max, cfg.workDays);
    if (compare && (cmp === 'prev' || cmp === 'month')) {
      compare.to = C.addDays(compare.from, period.elapsedDays - 1);
      compare.sameDays = true;
    }
  }
  if (compare) {
    const wf = C.weekInfo(compare.from, cfg), wt = C.weekInfo(compare.to, cfg);
    compare.label = mode === 'week' && wf.key === wt.key ? `WK${wf.key % 100}` : mode === 'day' ? dLabel(compare.from) : `${dLabel(compare.from)} – ${dLabel(compare.to)}`;
    if (compare.sameDays && mode === 'week') compare.label += compare.from === compare.to ? ` (${dLabel(compare.from)})` : ` (${dLabel(compare.from)} – ${dLabel(compare.to)})`;
    compare.short = compare.label.replace(/ \(.*\)$/, ''); // "WK46" for card deltas; the page note explains same-days
    compare.kind = cmp;
  }
  return { period, compare };
}

/** Builds a WHERE clause for one segment. */
function where(segKey, range, f = {}, subset = 'all', extra = null) {
  const s = SEG[segKey];
  const parts = ['date BETWEEN ? AND ?']; const params = [range.from, range.to];
  parts.push(SUBSET[segKey][subset] || '1=1');
  const add = (col, vals) => { if (vals.length) { parts.push(`${col} IN (${vals.map(() => '?').join(',')})`); params.push(...vals); } };
  add('facility', list(f.fac));
  add(s.line, list(f.line));
  add('shift', list(f.shift));
  add(s.tl, list(f.tl));
  add(s.name, list(f.defect));
  if (segKey === 'safety') { add('department', list(f.dept)); add('area', list(f.area)); }
  if (segKey === 'compliance') add('source', list(f.src));
  if (segKey === 'compliance' && subset === 'all' && f._lineOnly && !list(f.src).length) parts.push("source='Line'");
  if (segKey === 'defects') { add('found_at', list(f.found)); add('produced_at', list(f.station)); add('operator', list(f.op)); }
  if (segKey === 'compliance') add('operator', list(f.op));
  if (segKey === 'safety') add('operator', list(f.op));
  if (extra) { parts.push(extra.sql); params.push(...(extra.params || [])); }
  return { sql: parts.join(' AND '), params };
}

class Q {
  constructor(db, segKey, f, subset = 'all') { this.db = db; this.key = segKey; this.s = SEG[segKey]; this.f = f; this.subset = subset; }
  w(range, extra) { return where(this.key, range, this.f, this.subset, extra); }
  total(range, extra) {
    const w = this.w(range, extra);
    const r = this.db.prepare(`SELECT COALESCE(${this.s.measure},0) v, COUNT(*) n FROM ${this.s.table} WHERE ${w.sql}`).get(...w.params);
    return { value: r.v || 0, records: r.n || 0 };
  }
  by(dim, range, extra, limit = 0) {
    const w = this.w(range, extra);
    const rows = this.db.prepare(`SELECT ${dim} k, COALESCE(${this.s.measure},0) v, COUNT(*) n FROM ${this.s.table} WHERE ${w.sql} AND ${dim} IS NOT NULL AND ${dim} <> '' GROUP BY ${dim} ORDER BY v DESC, k ${limit ? 'LIMIT ' + limit : ''}`).all(...w.params);
    return rows.map(r => ({ name: String(r.k), value: r.v, records: r.n }));
  }
  by2(dimA, dimB, range, extra) {
    const w = this.w(range, extra);
    const rows = this.db.prepare(`SELECT ${dimA} a, ${dimB} b, COALESCE(${this.s.measure},0) v FROM ${this.s.table} WHERE ${w.sql} AND ${dimA} IS NOT NULL AND ${dimB} IS NOT NULL GROUP BY ${dimA}, ${dimB}`).all(...w.params);
    const m = new Map(rows.map(r => [String(r.a) + '\u0000' + String(r.b), r.v]));
    rows.get = (a, b) => m.get(String(a) + '\u0000' + String(b)) || 0; // fast cell lookup
    return rows;
  }
  /** distinct dates with data for the whole segment (no filters) - the "working days with data" */
  dataDays(range) {
    return this.db.prepare(`SELECT DISTINCT date FROM ${this.s.table} WHERE date BETWEEN ? AND ? ORDER BY date`).all(range.from, range.to).map(r => r.date);
  }
  series(range, extra) { // date -> value
    const m = new Map(); for (const r of this.by('date', range, extra)) m.set(r.name, r.value); return m;
  }
  weekly(range, extra) { const m = new Map(); for (const r of this.by('week_key', range, extra)) m.set(Number(r.name), r.value); return m; }
}

module.exports = { SEG, SUBSET, Q, where, resolvePeriod, dataBounds, dLabel, dShort, list, MONTHS };
