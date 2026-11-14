'use strict';
/**
 * calc.js - every calculation used by the website lives here, so it can be unit tested.
 * Dates are ISO strings 'YYYY-MM-DD' and all date math is done in UTC (no time-zone drift).
 */

const DAY = 86400000;

// ---------- dates ----------
function toUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(iso, n) { return fromUTC(toUTC(iso) + n * DAY); }
function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / DAY); }
function dow(iso) { return new Date(toUTC(iso)).getUTCDay(); } // 0=Sun .. 6=Sat
function dateList(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
function pad(n) { return String(n).padStart(2, '0'); }

function excelSerialToISO(n) { return fromUTC(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * DAY); }

/** Parse a cell value into an ISO date. order = 'mdy' (default for text like 11/7/2026) or 'dmy'. */
function parseDate(v, order = 'mdy') {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelSerialToISO(v) : null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    let a = +m[1], b = +m[2];
    if (order === 'dmy' || a > 12) return valid(y, b, a);
    if (b > 12) return valid(y, a, b);
    return valid(y, a, b);
  }
  return null;
  function valid(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    return fromUTC(toUTC(iso)) === iso ? iso : null;
  }
}

/** Parse a time cell: Excel day fraction, '16:18:30PM', '4:05 PM', '10:09:51'. Returns 'HH:MM:SS' or null. */
function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    let secs = Math.round(frac * 86400) % 86400;
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  }
  if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  const s = String(v).trim().toUpperCase();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return null;
  let h = +m[1];
  if (m[4] === 'PM' && h < 12) h += 12;
  if (m[4] === 'AM' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}:${m[3] || '00'}`;
}

// ---------- plant weeks ----------
const DEFAULT_WEEK = { weekStart: 6, numbering: 'jan1', workDays: [6, 0, 1, 2, 3, 4] }; // Saturday start, Friday off

function weekStartOf(iso, ws = 6) { return addDays(iso, -((dow(iso) - ws + 7) % 7)); }
function week1Start(year, cfg = DEFAULT_WEEK) {
  const j1 = `${year}-01-01`;
  const s = weekStartOf(j1, cfg.weekStart);
  if (cfg.numbering === 'first4') return 7 - daysBetween(s, j1) >= 4 ? s : addDays(s, 7);
  if (cfg.numbering === 'firstfull') return s === j1 ? s : addDays(s, 7);
  return s; // 'jan1': week 1 is the week that contains 1 January
}
function weekInfo(iso, cfg = DEFAULT_WEEK) {
  const y = Number(iso.slice(0, 4));
  let year = y - 1;
  if (iso >= week1Start(y + 1, cfg)) year = y + 1; else if (iso >= week1Start(y, cfg)) year = y;
  const start = weekStartOf(iso, cfg.weekStart);
  const week = Math.floor(daysBetween(week1Start(year, cfg), start) / 7) + 1;
  return { year, week, key: year * 100 + week, start, end: addDays(start, 6), label: `WK${week}` };
}
function weekRange(year, week, cfg = DEFAULT_WEEK) {
  const start = addDays(week1Start(year, cfg), (week - 1) * 7);
  return { start, end: addDays(start, 6), key: year * 100 + week, label: `WK${week}` };
}
function weekFromKey(key, cfg = DEFAULT_WEEK) { return weekRange(Math.floor(key / 100), key % 100, cfg); }
function weekLabel(key) { return `WK${key % 100}`; }
function workingDays(from, to, workDays = DEFAULT_WEEK.workDays) {
  if (!from || !to || to < from) return 0;
  let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (workDays.includes(dow(d))) n++;
  return n;
}

// ---------- basic stats ----------
const sum = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
const round = (x, d = 1) => (x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

function pctChange(cur, prev) {
  if (prev === null || prev === undefined) return null;
  const abs = cur - prev;
  return { abs, pct: prev ? (abs / prev) * 100 : null, dir: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat' };
}
/** Defect ratio in percent; null when there is no production quantity. */
function defectRatio(defects, produced) { return produced > 0 ? (defects / produced) * 100 : null; }

/** Status color: 'green' at or better than target, 'red' worse, 'grey' no target. better='lower'|'higher'|'within' */
function status(value, target, better = 'lower') {
  if (value === null || value === undefined) return 'grey';
  if (better === 'within') {
    if (!target || (target.lsl == null && target.usl == null)) return 'grey';
    if (target.lsl != null && value < target.lsl) return 'red';
    if (target.usl != null && value > target.usl) return 'red';
    return 'green';
  }
  if (target === null || target === undefined || target === '') return 'grey';
  return better === 'lower' ? (value <= target ? 'green' : 'red') : (value >= target ? 'green' : 'red');
}

// ---------- grouping, pareto, heatmap ----------
function groupSum(rows, keyFn, valFn = () => 1) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (k === null || k === undefined || k === '') continue; m.set(k, (m.get(k) || 0) + valFn(r)); }
  return m;
}
function sortedEntries(map, n) { const a = [...map.entries()].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0]))); return n ? a.slice(0, n) : a; }

/** Pareto: items [{name,value}] -> sorted with share and cumulative percent; tail grouped into 'Others' after maxItems. */
function pareto(items, maxItems = 0) {
  const sorted = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)));
  let list = sorted;
  if (maxItems && sorted.length > maxItems) {
    const rest = sorted.slice(maxItems - 1);
    list = sorted.slice(0, maxItems - 1).concat([{ name: 'Others', value: sum(rest.map(r => r.value)), others: rest.length }]);
  }
  const total = sum(list.map(i => i.value));
  let cum = 0;
  return list.map(i => { cum += i.value; return { ...i, share: total ? (i.value / total) * 100 : 0, cumPct: total ? (cum / total) * 100 : 0 }; });
}

function heatmap(rows, rowFn, colFn, valFn = () => 1) {
  const cells = new Map(); const rs = new Set(); const cs = new Set();
  for (const r of rows) {
    const a = rowFn(r), b = colFn(r); if (a == null || a === '' || b == null || b === '') continue;
    rs.add(a); cs.add(b); const k = a + '\u0000' + b; cells.set(k, (cells.get(k) || 0) + valFn(r));
  }
  return { rows: [...rs], cols: [...cs].sort(), get: (a, b) => cells.get(a + '\u0000' + b) || 0 };
}

// ---------- control chart (I-MR) ----------
function imr(values) {
  const n = values.length;
  const m = mean(values);
  const mr = values.map((v, i) => (i === 0 ? null : Math.abs(v - values[i - 1])));
  const mrs = mr.filter(x => x !== null);
  const mrBar = mean(mrs);
  return { n, mean: m, mrBar, ucl: m + 2.66 * mrBar, lcl: Math.max(0, m - 2.66 * mrBar), mr, mrUcl: 3.267 * mrBar };
}

/** Rule alerts: 1 point outside limits, 8 in a row on one side of mean, 6 in a row rising or falling. */
function ruleAlerts(values, center, ucl, lcl) {
  const alerts = [];
  values.forEach((v, i) => {
    if (v > ucl) alerts.push({ rule: 'outside', from: i, to: i, text: 'Point above UCL' });
    else if (v < lcl) alerts.push({ rule: 'outside', from: i, to: i, text: 'Point below LCL' });
  });
  let side = 0, start = 0;
  for (let i = 0; i <= values.length; i++) {
    const s = i < values.length ? (values[i] > center ? 1 : values[i] < center ? -1 : 0) : 0;
    if (i < values.length && s !== 0 && s === side) continue;
    if (side !== 0 && i - start >= 8) alerts.push({ rule: 'run8', from: start, to: i - 1, text: `${i - start} points in a row ${side > 0 ? 'above' : 'below'} the mean` });
    side = s; start = i;
  }
  let dir = 0; start = 0;
  for (let i = 1; i <= values.length; i++) {
    const d = i < values.length ? Math.sign(values[i] - values[i - 1]) : 0;
    if (i < values.length && d !== 0 && d === dir) continue;
    if (dir !== 0 && i - start >= 6) alerts.push({ rule: 'trend6', from: start, to: i - 1, text: `${i - start} points in a row ${dir > 0 ? 'rising' : 'falling'}` });
    dir = d; start = i - 1;
  }
  return alerts;
}
function alertPoints(alerts) { const s = new Set(); for (const a of alerts) for (let i = a.from; i <= a.to; i++) s.add(i); return s; }

// ---------- operators ----------
function tenureMonths(startISO, refISO) { return daysBetween(startISO, refISO) / 30.4375; }
function tenureBand(startISO, refISO) {
  if (!startISO) return 'Unknown';
  const m = tenureMonths(startISO, refISO);
  if (m < 1) return '0-1'; if (m < 3) return '1-3'; if (m < 6) return '3-6'; return '6+';
}
const TENURE_BANDS = ['0-1', '1-3', '3-6', '6+'];

/** Facility limits derived from factory limits by the facility's share of the factory average. */
function deriveLimits(factory, facilityAvg, factoryAvg) {
  const share = factoryAvg > 0 ? facilityAvg / factoryAvg : 0;
  return { lsl: factory.lsl != null ? factory.lsl * share : null, usl: factory.usl != null ? factory.usl * share : null, share };
}

// ---------- names ----------
function normText(s) { return s === null || s === undefined ? '' : String(s).replace(/[\s ]+/g, ' ').trim(); }
function normKey(s) { return normText(s).toLowerCase().replace(/[‘’`]/g, "'"); }

/** Facility from a line / facility / area name using ordered rules [{pattern, match:'exact'|'prefix'|'contains', facility}]. */
function facilityFor(name, rules) {
  const k = normKey(name);
  if (!k) return null;
  for (const r of rules) if (r.match === 'exact' && normKey(r.pattern) === k) return r.facility;
  let best = null, bestLen = -1;
  for (const r of rules) {
    const p = normKey(r.pattern);
    if ((r.match === 'prefix' && k.startsWith(p)) || (r.match === 'contains' && k.includes(p))) if (p.length > bestLen) { best = r.facility; bestLen = p.length; }
  }
  return best;
}

/** Critical type for a defect name from the critical list [{type, match:'exact'|'contains', values:[...]}]. */
function criticalType(name, list) {
  const k = normKey(name);
  if (!k) return null;
  for (const c of list) for (const v of c.values) {
    const p = normKey(v);
    if (c.match === 'contains' ? k.includes(p) : k === p) return c.type;
  }
  return null;
}

/** Repeat events: same key within `days` days of an earlier event of the same key. rows: [{date, key}] */
function repeats(rows, days = 7) {
  const byKey = new Map();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  const out = [];
  for (const [key, list] of byKey) {
    let isRepeat = false;
    for (let i = 1; i < list.length; i++) if (daysBetween(list[i - 1].date, list[i].date) <= days) { isRepeat = true; break; }
    if (isRepeat) out.push({ key, count: list.length, dates: [...new Set(list.map(r => r.date))] });
  }
  return out.sort((a, b) => b.count - a.count);
}

function fmt(n, d = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

module.exports = {
  DAY, addDays, daysBetween, dow, dateList, excelSerialToISO, parseDate, parseTime,
  DEFAULT_WEEK, weekStartOf, week1Start, weekInfo, weekRange, weekFromKey, weekLabel, workingDays,
  sum, mean, round, pctChange, defectRatio, status, groupSum, sortedEntries, pareto, heatmap,
  imr, ruleAlerts, alertPoints, tenureMonths, tenureBand, TENURE_BANDS, deriveLimits,
  normText, normKey, facilityFor, criticalType, repeats, fmt,
};
