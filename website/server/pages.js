'use strict';
// Builds every analysis page as JSON: cards, charts (each with its data table and analysis text) and notes.
const C = require('./calc');
const DB = require('./db');
const { SEG, Q, where, resolvePeriod, dataBounds, dLabel, dShort, list } = require('./query');
const K = require('./charts');
const TR = require('./translate');
const { f0, f1, pct } = K;

// ---------- context ----------
function makeCtx(db, q) {
  const settings = DB.getSettings(db);
  const cfg = settings.week;
  const bounds = dataBounds(db);
  const { period, compare } = resolvePeriod(q, bounds, cfg);
  const facilities = db.prepare('SELECT * FROM facilities ORDER BY sort, name').all();
  const colors = Object.fromEntries(facilities.map(x => [x.name, x.color]));
  const f = { ...q, _lineOnly: !settings.complianceIncludeCamera };
  const asOf = bounds.max && bounds.max < period.to ? bounds.max : period.to;
  return { db, q, f, settings, cfg, bounds, period: P0(period), compare, colors, facilities, notes: [], asOf };
}
/** The comparison period only counts when the segment has data in it. */
function cmpFor(ctx, Qr) { return ctx.compare && Qr.dataDays(ctx.compare).length ? ctx.compare : null; }
function P0(p) { return p; }

function target(ctx, kpi, fac = '*') {
  const t = (ctx.settings.targets || {})[kpi] || {};
  const facs = list(ctx.f.fac);
  const wk = ctx.period.weekKey && ((ctx.settings.targetWeeks || {})[kpi] || {})[ctx.period.weekKey];
  if (wk !== undefined && wk !== null && wk !== '' && !facs.length) return Number(wk);
  if (facs.length === 1 && t[facs[0]] !== undefined && t[facs[0]] !== '') return Number(t[facs[0]]);
  if (facs.length) return null; // factory target does not apply to a single facility
  return t[fac] === undefined || t[fac] === '' || t[fac] === null ? null : Number(t[fac]);
}

function delta(cur, prev, better = 'lower') {
  if (prev === null || prev === undefined) return null;
  const d = C.pctChange(cur, prev);
  return { ...d, good: d.dir === 'flat' ? null : better === 'lower' ? d.dir === 'down' : d.dir === 'up' };
}

function card(id, label, value, opts = {}) {
  const d = opts.digits ?? 0;
  return { id, label, value, display: value === null || value === undefined ? '–' : (opts.prefix || '') + C.fmt(value, d) + (opts.suffix || ''), unit: opts.unit || '', period: opts.period || '', delta: opts.delta || null, status: opts.status || 'grey', sub: opts.sub || '', open: opts.open || [], note: opts.note, link: opts.link };
}

function weekWindow(ctx, n = 12, seg = null) {
  const end = C.weekInfo(ctx.period.to, ctx.cfg);
  let start = C.weekInfo(C.addDays(end.start, -7 * (n - 1)), ctx.cfg);
  const pStart = C.weekInfo(ctx.period.from, ctx.cfg);
  if (pStart.start < start.start) start = pStart;
  const min = seg && ctx.bounds.seg[seg] && ctx.bounds.seg[seg].a ? ctx.bounds.seg[seg].a : ctx.bounds.min;
  if (min && start.start < C.weekInfo(min, ctx.cfg).start) start = C.weekInfo(min, ctx.cfg);
  if (start.start > end.start) start = end;
  const weeks = []; for (let d = start.start; d <= end.start; d = C.addDays(d, 7)) weeks.push(C.weekInfo(d, ctx.cfg));
  return { range: { from: start.start, to: end.end }, weeks };
}
function dayWindow(ctx, Qr, minDays = 5, back = 13) {
  const P = ctx.period;
  const range = P.days >= minDays ? { from: P.from, to: P.to } : { from: C.addDays(P.to, -back), to: P.to };
  let dates = Qr.dataDays(range);
  if (!dates.length) dates = C.dateList(range.from, range.to).filter(d => ctx.cfg.workDays.includes(C.dow(d)));
  return { range, dates };
}
const toMap = items => new Map(items.map(i => [i.name, i.value]));
const fullLabel = s => s;

// ---------- standard section (every segment section gets these) ----------
/**
 * opts: seg, subset, extra, subject ('defects'), unit, nameDim, nameLabel, targetKpi, spec {lsl,usl}, weeks, dims [{dim,label,drill,limit}], prefix
 */
function standard(ctx, o) {
  const P = ctx.period;
  const Qr = new Q(ctx.db, o.seg, ctx.f, o.subset || 'all');
  const CP = cmpFor(ctx, Qr);
  if (ctx.compare && !CP && !ctx.notes.some(n => n.startsWith('No data for the comparison'))) ctx.notes.push(`No data for the comparison period (${ctx.compare.label}) in this segment, so changes are not shown.`);
  const ex = o.extra || null;
  const id = s => (o.prefix ? o.prefix + '-' : '') + s;
  const cur = Qr.total(P, ex);
  const prev = CP ? Qr.total(CP, ex) : null;
  const days = Qr.dataDays(P);
  const charts = [];
  const tgt = o.targetKpi ? target(ctx, o.targetKpi) : null;
  const subj = o.subject;
  const nameLabel = o.nameLabel || 'Name';

  // daily trend
  const dw = dayWindow(ctx, Qr);
  const ds = Qr.series(dw.range, ex);
  const dv = dw.dates.map(d => ds.get(d) || 0);
  const marks = [];
  if (tgt !== null) marks.push({ name: 'Target', value: tgt, color: '#16a34a' });
  if (o.spec && o.spec.lsl != null) marks.push({ name: 'LSL', value: o.spec.lsl, color: '#dc2626' });
  if (o.spec && o.spec.usl != null) marks.push({ name: 'USL', value: o.spec.usl, color: '#dc2626' });
  let dText = K.trendText(dw.dates, dv, `${subj}`);
  if (dText && tgt !== null) { const over = dv.filter(v => v > tgt).length; dText += ` ${over} of ${dv.length} days above the target of ${f0(tgt)} per day.`; }
  if (dText && o.spec && o.spec.usl != null) { const out = dv.filter(v => v > o.spec.usl || (o.spec.lsl != null && v < o.spec.lsl)).length; dText += ` ${out} of ${dv.length} days outside the spec limits ${f0(o.spec.lsl)}–${f0(o.spec.usl)}.`; }
  charts.push(K.lineChart({ id: id('daily'), title: `Daily ${subj}`, x: dw.dates.map(dShort), keys: dw.dates, series: [{ name: o.unitLabel || cap(subj), data: dv }], marks, yName: `${cap(subj)} per day`, xName: 'Date', analysis: dText, drill: { param: 'day' } }));

  // weekly trend
  const ww = weekWindow(ctx, o.weeks || 12, o.seg);
  const wsr = Qr.weekly(ww.range, ex);
  const wv = ww.weeks.map(w => wsr.get(w.key) || 0);
  const wmarks = [];
  if (tgt !== null) wmarks.push({ name: 'Target', value: ww.weeks.map(w => tgt * C.workingDays(w.start, w.end, ctx.cfg.workDays)), color: '#16a34a' });
  let wText = K.trendText(ww.weeks.map(w => w.label), wv, `${subj}`, x => x);
  if (wText && wv.length >= 2) { const a = wv[wv.length - 1], b = wv[wv.length - 2]; const ch = C.pctChange(a, b); wText += ` Last week ${ww.weeks[wv.length - 1].label}: ${f0(a)} vs ${f0(b)} the week before (${ch.pct === null ? 'n/a' : (ch.pct >= 0 ? '+' : '') + f1(ch.pct) + '%'}).`; }
  charts.push(K.lineChart({ id: id('weekly'), title: `Weekly ${subj}`, x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: [{ name: cap(subj), data: wv, type: 'bar' }], marks: wmarks, yName: `${cap(subj)} per week`, xName: 'Week', analysis: wText, drill: { param: 'week' } }));

  // by facility
  const byFac = Qr.by('facility', P, ex);
  const prevFac = CP ? toMap(Qr.by('facility', CP, ex)) : null;
  charts.push(K.barChart({ id: id('by-facility'), title: `${cap(subj)} by facility`, items: byFac, yName: cap(subj), xName: 'Facility', colorBy: 'facility', drill: { param: 'fac' }, horizontal: false, analysis: K.rankText(byFac, prevFac, subj, 'facilities', P.short, CP && CP.label) }));
  // by line
  const byLine = Qr.by(SEG[o.seg].line, P, ex);
  const prevLine = CP ? toMap(Qr.by(SEG[o.seg].line, CP, ex)) : null;
  charts.push(K.barChart({ id: id('by-line'), title: `${cap(subj)} by ${o.seg === 'safety' ? 'location' : 'line'}`, items: byLine, limit: 25, yName: cap(subj), xName: o.seg === 'safety' ? 'Location' : 'Line', drill: { param: 'line' }, analysis: K.rankText(byLine, prevLine, subj, o.seg === 'safety' ? 'locations' : 'lines', P.short, CP && CP.label) }));
  // pareto of main driver
  const byName = Qr.by(o.nameDim || SEG[o.seg].name, P, ex);
  charts.push(K.paretoChart({ id: id('pareto'), title: `Pareto of ${subj} by ${nameLabel.toLowerCase()}`, items: byName, yName: cap(subj), xName: nameLabel, drill: { param: 'defect' }, alt: o.alt, subject: subj, period: P.short }));
  // shift and team leader
  const byShift = Qr.by('shift', P, ex); const prevShift = CP ? toMap(Qr.by('shift', CP, ex)) : null;
  byShift.sort((a, b) => a.name.localeCompare(b.name));
  charts.push(K.barChart({ id: id('by-shift'), title: `${cap(subj)} by shift`, items: byShift, yName: cap(subj), xName: 'Shift', drill: { param: 'shift' }, horizontal: false, analysis: K.rankText([...byShift].sort((a, b) => b.value - a.value), prevShift, subj, 'shifts', P.short, CP && CP.label) }));
  const tlDim = SEG[o.seg].tl;
  const byTl = Qr.by(tlDim, P, ex); const prevTl = CP ? toMap(Qr.by(tlDim, CP, ex)) : null;
  byTl.sort((a, b) => a.name.localeCompare(b.name));
  charts.push(K.barChart({ id: id('by-tl'), title: `${cap(subj)} by ${o.seg === 'safety' ? 'team' : 'team leader'}`, items: byTl, yName: cap(subj), xName: o.seg === 'safety' ? 'Team' : 'Team leader', drill: { param: 'tl' }, horizontal: false, analysis: K.rankText([...byTl].sort((a, b) => b.value - a.value), prevTl, subj, o.seg === 'safety' ? 'teams' : 'team leaders', P.short, CP && CP.label) }));

  // heatmap facility x day (weeks when the period is long)
  const long = dw.dates.length > 45;
  const hmRows = Qr.by2('facility', long ? 'week_key' : 'date', long ? ww.range : dw.range, ex);
  const hm = new Map(hmRows.map(r => [r.a + '|' + r.b, r.v]));
  const facOrder = byFac.map(x => x.name).concat([...new Set(hmRows.map(r => r.a))].filter(x => !byFac.find(y => y.name === x)));
  const cols = long ? ww.weeks.map(w => String(w.key)) : dw.dates;
  let hmText = null;
  if (hmRows.length) { const mx = hmRows.reduce((a, b) => (b.v > a.v ? b : a)); hmText = `Highest cell: ${mx.a} on ${long ? C.weekLabel(mx.b) : dLabel(mx.b)} with ${f0(mx.v)} ${subj}.`; }
  charts.push(K.heatmapChart({ id: id('heatmap'), title: `${cap(subj)}: facility by ${long ? 'week' : 'day'}`, rows: facOrder, cols, colLabels: long ? ww.weeks.map(w => w.label) : dw.dates.map(dShort), get: (r, c) => hm.get(r + '|' + c) || 0, yName: 'Facility', xName: long ? 'Week' : 'Date', drill: { param: 'fac' }, analysis: hmText }));

  // week-over-week change table
  if (CP) {
    const names = [...new Set([...byFac.map(x => x.name), ...prevFac.keys()])];
    const rows = names.map(n => { const a = (byFac.find(x => x.name === n) || {}).value || 0, b = prevFac.get(n) || 0; const ch = C.pctChange(a, b); return { name: n, cur: a, prev: b, change: ch.abs, pct: ch.pct === null ? null : C.round(ch.pct, 1), dir: ch.dir }; }).sort((a, b) => b.cur - a.cur);
    const totalRow = { name: 'Total', cur: cur.value, prev: prev.value, change: cur.value - prev.value, pct: prev.value ? C.round((cur.value - prev.value) / prev.value * 100, 1) : null, dir: cur.value > prev.value ? 'up' : cur.value < prev.value ? 'down' : 'flat', total: true };
    const rises = rows.filter(r => r.dir === 'up').length, drops = rows.filter(r => r.dir === 'down').length;
    charts.push(K.tableChart({ id: id('wow'), title: `Change per facility: ${P.short} vs ${CP.label}`, wide: false, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'cur', label: P.short, type: 'num' }, { key: 'prev', label: CP.label, type: 'num' }, { key: 'change', label: 'Change', type: 'delta' }, { key: 'pct', label: 'Change %', type: 'deltapct' }], rows: [...rows, totalRow], analysis: `${drops} facilit${drops === 1 ? 'y' : 'ies'} dropped (green) and ${rises} rose (red). Total ${f0(prev.value)} → ${f0(cur.value)}${totalRow.pct !== null ? ` (${totalRow.pct >= 0 ? '+' : ''}${f1(totalRow.pct)}%)` : ''}.` }));
  }

  // top 10 combinations with drill-down to the records
  const lineDim = SEG[o.seg].line, nDim = o.nameDim || SEG[o.seg].name;
  const combo = Qr.by2(lineDim, nDim, P, ex).sort((a, b) => b.v - a.v).slice(0, 10);
  charts.push(K.tableChart({ id: id('top10'), title: `Top 10: ${o.seg === 'safety' ? 'location' : 'line'} and ${nameLabel.toLowerCase()}`, wide: false,
    columns: [{ key: 'rank', label: '#' }, { key: 'line', label: o.seg === 'safety' ? 'Location' : 'Line' }, { key: 'name', label: nameLabel }, { key: 'v', label: cap(subj), type: 'num' }, { key: 'share', label: 'Share %', type: 'num1' }],
    rows: combo.map((r, i) => ({ rank: i + 1, line: r.a, name: r.b, v: r.v, share: cur.value ? C.round(r.v / cur.value * 100, 1) : null, _drill: { line: r.a, defect: r.b } })),
    drill: { records: true },
    analysis: combo.length ? `${combo[0].a} / ${combo[0].b} is the largest combination with ${f0(combo[0].v)} ${subj} (${pct(combo[0].v / (cur.value || 1) * 100)} of ${f0(cur.value)}). Click a row to see its records.` : null }));

  // extra breakdowns
  for (const d of o.dims || []) {
    const items = Qr.by(d.dim, P, ex);
    if (!items.length) { charts.push({ id: id('by-' + d.key), type: 'empty', title: `${cap(subj)} by ${d.label.toLowerCase()}`, note: `No ${d.label.toLowerCase()} values in the data for this period.` }); continue; }
    const pm = CP ? toMap(Qr.by(d.dim, CP, ex)) : null;
    charts.push(K.barChart({ id: id('by-' + d.key), title: `${cap(subj)} by ${d.label.toLowerCase()}`, items, limit: d.limit || 20, yName: cap(subj), xName: d.label, drill: d.drill ? { param: d.drill } : null, analysis: K.rankText(items, pm, subj, d.plural || d.label.toLowerCase() + ' values', P.short, CP && CP.label) }));
  }

  return { charts, cur, prev, days, byFac, byLine, byName, dw, dv, ww, wv, tgt, Qr, CP };
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function stdCards(ctx, s, o) {
  const P = ctx.period, CP = s.CP;
  const subj = o.subject; const nd = s.days.length;
  const avg = nd ? s.cur.value / nd : null;
  const tgt = s.tgt;
  const cards = [
    card(o.prefix + 'total', o.totalLabel || `Total ${subj}`, s.cur.value, { unit: subj, period: P.short, delta: delta(s.cur.value, s.prev && s.prev.value), status: tgt !== null ? C.status(avg, tgt) : 'grey', sub: `${f0(s.cur.records)} records`, open: [o.prefix + 'daily', o.prefix + 'by-facility'] }),
    card(o.prefix + 'avg', 'Average per day', avg, { digits: 1, unit: `${subj} per day`, period: `${P.short}, ${nd} data day${nd === 1 ? '' : 's'}`, status: tgt !== null ? C.status(avg, tgt) : 'grey', sub: tgt !== null ? `Target ${f0(tgt)} per day` : 'No target set', delta: delta(avg, s.prev && CP ? s.prev.value / Math.max(1, new Q(ctx.db, o.seg, ctx.f).dataDays(CP).length) : null), open: [o.prefix + 'daily', o.prefix + 'weekly'] }),
  ];
  if (CP) cards.push(card(o.prefix + 'change', `Change vs ${CP.label}`, s.prev ? s.cur.value - s.prev.value : null, { prefix: s.prev && s.cur.value - s.prev.value > 0 ? '+' : '', unit: subj, period: `${P.short} vs ${CP.label}`, delta: delta(s.cur.value, s.prev && s.prev.value), status: !s.prev ? 'grey' : s.cur.value <= s.prev.value ? 'green' : 'red', sub: `${f0(s.prev ? s.prev.value : 0)} → ${f0(s.cur.value)}`, open: [o.prefix + 'weekly', o.prefix + 'wow'] }));
  const wf = s.byFac[0], wl = s.byLine[0];
  cards.push(card(o.prefix + 'worst-fac', 'Worst facility', wf ? wf.value : null, { unit: subj, period: P.short, sub: wf ? `${wf.name} (${pct(wf.value / (s.cur.value || 1) * 100)})` : '', status: 'grey', open: [o.prefix + 'by-facility', o.prefix + 'heatmap'] }));
  cards.push(card(o.prefix + 'worst-line', `Worst ${o.seg === 'safety' ? 'location' : 'line'}`, wl ? wl.value : null, { unit: subj, period: P.short, sub: wl ? `${wl.name}` : '', status: 'grey', open: [o.prefix + 'by-line', o.prefix + 'top10'] }));
  for (const c of cards) if (c.label === 'Worst facility' && wf) c.text = wf.name;
  for (const c of cards) if (c.id.endsWith('worst-line') && wl) c.text = wl.name;
  return cards;
}

function recordsSpec(seg, subset, title, extra) { return { id: 'records', type: 'records', title: title || 'Detailed records', seg, subset, extra: extra || null, wide: true }; }

// ---------- production / DR% ----------
function production(ctx, range) {
  const f = ctx.f; const parts = ['date BETWEEN ? AND ?']; const params = [range.from, range.to];
  if (list(f.fac).length) { parts.push(`facility IN (${list(f.fac).map(() => '?').join(',')})`); params.push(...list(f.fac)); }
  if (list(f.line).length) { parts.push(`line IN (${list(f.line).map(() => '?').join(',')})`); params.push(...list(f.line)); }
  return ctx.db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM production WHERE ${parts.join(' AND ')}`).get(...params).q;
}

function daysSince(ctx, seg, subset, by = 'facility') {
  const w = where(seg, { from: '0000-01-01', to: ctx.asOf }, ctx.f, subset);
  const rows = ctx.db.prepare(`SELECT ${by} k, MAX(date) last, COUNT(*) n FROM ${SEG[seg].table} WHERE ${w.sql} GROUP BY ${by}`).all(...w.params);
  const known = new Set(rows.map(r => r.k));
  const all = ctx.facilities.filter(x => x.production).map(x => x.name).filter(n => !known.has(n) && !list(ctx.f.fac).length);
  return rows.map(r => ({ name: r.k, last: r.last, days: C.daysBetween(r.last, ctx.asOf) }))
    .concat(all.map(n => ({ name: n, last: null, days: null })))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
}

// ---------- DEFECTS ----------
const DEF_DIMS = [
  { key: 'found', dim: 'found_at', label: 'Defect found at', drill: 'found', plural: 'places' },
  { key: 'station', dim: 'produced_at', label: 'Defect produced at (station)', drill: 'station', limit: 25, plural: 'stations' },
  { key: 'code', dim: 'defect_code', label: 'Defect code', plural: 'codes' },
  { key: 'operator', dim: 'operator', label: 'Operator', drill: 'op', limit: 20, plural: 'operators' },
];
const FOURM = [{ key: 'man', dim: 'man', label: 'Man' }, { key: 'machine', dim: 'machine', label: 'Machine' }, { key: 'method', dim: 'method', label: 'Method' }, { key: 'material', dim: 'material', label: 'Material' }];

function defectsPage(ctx, sub) {
  const P = ctx.period, CP = cmpFor(ctx, new Q(ctx.db, 'defects', ctx.f));
  const titles = { all: 'Defects overview', critical: 'Critical defects', czcf: 'CZCF: past concern defects', rework: 'Rework analysis' };
  const subjects = { all: 'defects', critical: 'critical defects', czcf: 'CZCF defects', rework: 'rework defects' };
  const kpi = { all: 'defects_per_day', critical: 'critical_per_day', czcf: 'czcf_per_day', rework: 'rework_per_day' }[sub];
  const subj = subjects[sub];
  const s = standard(ctx, { seg: 'defects', subset: sub, subject: subj, nameLabel: 'Defect name', targetKpi: kpi, dims: [...DEF_DIMS, ...FOURM.map(x => ({ ...x, plural: x.label + ' values' }))] });
  // 4M: collapse empty ones into one note
  const empty4m = s.charts.filter(c => c.type === 'empty' && FOURM.some(m => c.id === 'by-' + m.key));
  if (empty4m.length) { s.charts = s.charts.filter(c => !empty4m.includes(c)); ctx.notes.push(`4M (${empty4m.map(c => c.title.split(' by ')[1]).join(', ')}): the data has no values (only "NA") in this period, so no 4M chart is shown.`); }
  const cards = stdCards(ctx, s, { seg: 'defects', subject: subj, prefix: '', totalLabel: `Total ${subj}` });
  const allQ = new Q(ctx.db, 'defects', ctx.f);
  const allCur = allQ.total(P);
  const extra = [];

  if (sub === 'all') {
    const prod = production(ctx, P);
    const filtered = list(ctx.f.shift).length || list(ctx.f.tl).length || list(ctx.f.defect).length;
    if (prod > 0 && !filtered) {
      const dr = C.defectRatio(s.cur.value, prod); const prodPrev = CP ? production(ctx, CP) : 0;
      cards.splice(2, 0, card('dr', 'DR%', dr, { digits: 2, suffix: '%', unit: 'defects / produced x 100', period: P.short, sub: `${f0(s.cur.value)} defects / ${f0(prod)} produced`, delta: prodPrev ? delta(dr, C.defectRatio(s.prev.value, prodPrev)) : null, open: ['daily', 'by-facility'] }));
    } else ctx.notes.push(prod > 0 ? 'DR% is not shown when a shift, team leader or defect filter is set (production quantities are per day and line only).' : 'No production data uploaded for this period, so counts are shown and DR% (defect ratio) is not calculated. Upload production quantities in Admin › Upload to see DR%.');
    // stacked bar by facility per day
    const rows = s.Qr.by2('date', 'facility', s.dw.range);
    const facs = s.byFac.map(x => x.name);
    extra.push(K.stackedChart({ id: 'stacked-facility', title: 'Daily defects stacked by facility', x: s.dw.dates.map(dShort), keys: s.dw.dates, stacks: facs.map(fn => ({ name: fn, data: s.dw.dates.map(d => rows.get(d, fn)) })), yName: 'Defects', xName: 'Date', colorBy: 'facility', wide: true, analysis: facs.length ? `${facs[0]} is the largest part of every stack on average (${f0(s.byFac[0].value)} defects in ${P.short}).` : null }));
  }
  if (sub === 'critical') {
    const share = allCur.value ? s.cur.value / allCur.value * 100 : null;
    cards.splice(1, 0, card('share', 'Share of all defects', share, { digits: 1, suffix: '%', unit: 'critical / total', period: P.short, sub: `${f0(s.cur.value)} of ${f0(allCur.value)} defects`, open: ['by-type', 'daily'] }));
    const ds = daysSince(ctx, 'defects', 'critical');
    const minD = ds.filter(x => x.days !== null)[0];
    cards.push(card('days-since', 'Days since last critical', minD ? minD.days : null, { unit: 'days', period: `as of ${dLabel(P.to)}`, sub: minD ? `Most recent: ${minD.name} (${dLabel(minD.last)})` : 'None recorded', status: minD && minD.days === 0 ? 'red' : 'grey', open: ['days-since'] }));
    const rep = repeatCritical(ctx);
    cards.push(card('repeats', 'Repeat critical defects', rep.length, { unit: 'line + defect pairs', period: `${P.short}, within ${ctx.settings.repeatDays || 7} days`, status: rep.length ? 'red' : 'green', sub: rep.length ? `${rep[0].line}: ${rep[0].defect} (${rep[0].count}x)` : 'No repeats', open: ['repeats'] }));
    // by type
    const types = (ctx.settings.critical || []).map(c => c.type);
    const byType = s.Qr.by('critical_type', P);
    for (const t of types) if (!byType.find(x => x.name === t)) byType.push({ name: t, value: 0, records: 0 });
    const prevType = CP ? toMap(s.Qr.by('critical_type', CP)) : null;
    extra.push(K.barChart({ id: 'by-type', title: 'Critical defects by type', items: byType, yName: 'Critical defects', xName: 'Critical type', horizontal: false, analysis: K.rankText(byType.filter(x => x.value), prevType, 'critical defects', 'types with records', P.short, CP && CP.label) }));
    // small trend per type + combined stacked
    const rows = s.Qr.by2('date', 'critical_type', s.dw.range);
    const per = t => s.dw.dates.map(d => rows.get(d, t));
    extra.push({ id: 'multiples', type: 'multiples', title: 'Daily trend per critical defect type', wide: true, charts: types.map(t => { const v = per(t); return K.lineChart({ id: 'type-' + t, title: t, x: s.dw.dates.map(dShort), keys: s.dw.dates, series: [{ name: t, data: v }], yName: 'Defects', analysis: C.sum(v) ? `${f0(C.sum(v))} in the window, max ${f0(Math.max(...v))} per day.` : 'No records in this window.' }); }), table: { columns: ['Date', ...types], rows: s.dw.dates.map((d, i) => [d, ...types.map(t => per(t)[i])]) } });
    extra.push(K.stackedChart({ id: 'stacked-type', title: 'Daily critical defects stacked by type', x: s.dw.dates.map(dShort), keys: s.dw.dates, stacks: types.map(t => ({ name: t, data: per(t) })), yName: 'Critical defects', xName: 'Date', wide: true }));
    extra.push(K.tableChart({ id: 'days-since', title: 'Days since last critical defect per facility', wide: false, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'last', label: 'Last critical' }, { key: 'days', label: 'Days since', type: 'num' }], rows: ds.map(x => ({ ...x, last: x.last ? dLabel(x.last, true) : 'None' })), analysis: minD ? `${minD.name} had the most recent critical defect (${dLabel(minD.last)}).` : null }));
    extra.push(K.tableChart({ id: 'repeats', title: `Repeat critical defects (same defect, same line, within ${ctx.settings.repeatDays || 7} days)`, wide: true, columns: [{ key: 'line', label: 'Line' }, { key: 'defect', label: 'Defect' }, { key: 'count', label: 'Records', type: 'num' }, { key: 'dates', label: 'Dates' }], rows: rep.map(r => ({ ...r, dates: r.dates.map(d => dLabel(d)).join(', '), _drill: { line: r.line, defect: r.defect } })), drill: { records: true }, empty: 'No repeat critical defects in this period.', analysis: rep.length ? `${rep.length} line/defect pairs repeated; the most frequent is ${rep[0].line} / ${rep[0].defect} with ${rep[0].count} records.` : null }));
  }
  if (sub === 'czcf') {
    const share = allCur.value ? s.cur.value / allCur.value * 100 : null;
    cards[0].status = s.cur.value > 0 ? 'red' : 'green';
    cards[0].sub += ' · target 0 repeats';
    cards.splice(1, 0, card('share', 'Share of all defects', share, { digits: 2, suffix: '%', unit: 'CZCF / total', period: P.short, sub: `${f0(s.cur.value)} of ${f0(allCur.value)} defects`, open: ['daily', 'pareto'] }));
    cards.push(card('lines', 'Lines with a CZCF', s.byLine.length, { unit: 'lines', period: P.short, status: s.byLine.length ? 'red' : 'green', sub: s.byLine.slice(0, 3).map(x => x.name).join(', '), open: ['by-line'] }));
    const ds = daysSince(ctx, 'defects', 'czcf');
    const minD = ds.filter(x => x.days !== null)[0];
    cards.push(card('days-since', 'Days since last CZCF', minD ? minD.days : null, { unit: 'days', period: `as of ${dLabel(P.to)}`, sub: minD ? `${minD.name} (${dLabel(minD.last)})` : 'None recorded', status: minD && minD.days <= 7 ? 'red' : 'green', open: ['days-since'] }));
    extra.push(K.tableChart({ id: 'days-since', title: 'Days since last CZCF per facility', wide: false, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'last', label: 'Last CZCF' }, { key: 'days', label: 'Days since', type: 'num' }], rows: ds.map(x => ({ ...x, last: x.last ? dLabel(x.last, true) : 'None' })) }));
  }
  if (sub === 'rework') {
    const rate = allCur.value ? s.cur.value / allCur.value * 100 : null;
    const prevAll = CP ? allQ.total(CP).value : null;
    cards.splice(1, 0, card('rate', 'Rework rate', rate, { digits: 1, suffix: '%', unit: 'rework / all defects', period: P.short, sub: `${f0(s.cur.value)} of ${f0(allCur.value)} defects`, delta: CP && prevAll ? delta(rate, s.prev.value / prevAll * 100) : null, open: ['daily', 'by-facility'] }));
    const w = where('defects', P, ctx.f, 'rework');
    const t = ctx.db.prepare(`SELECT SUM(rework_min) m, COUNT(rework_min) n FROM defects WHERE ${w.sql}`).get(...w.params);
    if (t.n) {
      cards.push(card('time', 'Total rework time', t.m, { digits: 0, unit: 'minutes', period: P.short, open: ['drivers-time'] }));
      cards.push(card('avg-time', 'Average rework time', t.m / t.n, { digits: 1, unit: 'minutes per defect', period: P.short, open: ['drivers-time'] }));
      const dr = ctx.db.prepare(`SELECT defect_name k, SUM(rework_min) v FROM defects WHERE ${w.sql} GROUP BY defect_name ORDER BY v DESC LIMIT 10`).all(...w.params).map(r => ({ name: r.k, value: C.round(r.v, 1) }));
      extra.push(K.barChart({ id: 'drivers-time', title: 'Top 10 rework drivers by time', items: dr, yName: 'Minutes', xName: 'Defect name', drill: { param: 'defect' } }));
    } else {
      ctx.notes.push('Rework time is not in the uploaded data, so rework time metrics (total time, average time per defect, drivers by time) are hidden. Top 10 rework drivers are ranked by count instead.');
      extra.push(K.barChart({ id: 'drivers-count', title: 'Top 10 rework drivers by count (no rework time in the data)', items: s.byName.slice(0, 10), yName: 'Rework defects', xName: 'Defect name', drill: { param: 'defect' } }));
    }
  }
  return { title: titles[sub], segment: 'defects', subset: sub, cards, charts: [...s.charts.slice(0, 2), ...extra, ...s.charts.slice(2)], records: recordsSpec('defects', sub, sub === 'czcf' ? 'Every CZCF record' : null) };
}

function repeatCritical(ctx) {
  const days = ctx.settings.repeatDays || 7;
  const w = where('defects', { from: C.addDays(ctx.period.from, -days), to: ctx.period.to }, ctx.f, 'critical');
  const rows = ctx.db.prepare(`SELECT date, line, defect_name FROM defects WHERE ${w.sql}`).all(...w.params);
  return C.repeats(rows.map(r => ({ date: r.date, key: r.line + '\u0000' + r.defect_name })), days)
    .filter(r => r.dates.some(d => d >= ctx.period.from))
    .map(r => { const [line, defect] = r.key.split('\u0000'); return { line, defect, count: r.count, dates: r.dates }; });
}

// ---------- MISLOCATION ----------
function facilitySpec(ctx, factorySpec, fac, facAvg, factoryAvg) {
  const m = (ctx.settings.facilitySpec || {})[fac];
  if (m && m.mode === 'manual') return { lsl: m.lsl === '' ? null : Number(m.lsl), usl: m.usl === '' ? null : Number(m.usl), mode: 'manual' };
  return { ...C.deriveLimits(factorySpec, facAvg, factoryAvg), mode: 'derived' };
}

function mislocationPage(ctx, tab = 'total') {
  const P = ctx.period, CP = cmpFor(ctx, new Q(ctx.db, 'defects', ctx.f));
  const spec = (ctx.settings.spec || {}).mislocation || {};
  const especRaw = (ctx.settings.spec || {}).electrical || {};
  const facFilter = list(ctx.f.fac);
  const Qt = new Q(ctx.db, 'defects', ctx.f, 'mislocation'), Qe = new Q(ctx.db, 'defects', ctx.f, 'electrical');
  const days = Qt.dataDays(P); const nd = days.length || 1;
  const t = Qt.total(P), e = Qe.total(P);
  const tp = CP ? Qt.total(CP) : null, ep = CP ? Qe.total(CP) : null;
  const cpDays = CP ? Math.max(1, Qt.dataDays(CP).length) : 1;
  const avgT = days.length ? t.value / nd : null, avgE = days.length ? e.value / nd : null;
  const specApplies = !facFilter.length;
  const cards = [
    card('total-day', 'Total mislocations per day', avgT, { digits: 1, unit: 'per day (average)', period: `${P.short}, ${days.length} days`, sub: `${f0(t.value)} in the period`, delta: tp ? delta(avgT, tp.value / cpDays) : null, status: specApplies ? C.status(avgT, spec, 'within') : 'grey', open: ['mis-daily', 'mis-by-facility'] }),
    card('elec-day', 'Electrical mislocations per day', avgE, { digits: 1, unit: 'per day (average)', period: P.short, sub: `${f0(e.value)} found at Electrical Test`, delta: ep ? delta(avgE, ep.value / cpDays) : null, open: ['ele-daily', 'ele-by-facility'] }),
    card('elec-share', 'Electrical share', t.value ? e.value / t.value * 100 : null, { digits: 1, suffix: '%', unit: 'electrical / total', period: P.short, sub: `${f0(e.value)} of ${f0(t.value)}`, open: ['side-by-side'] }),
    card('status', 'Factory status vs spec', avgT, { digits: 1, unit: 'per day', period: P.short, status: specApplies ? C.status(avgT, spec, 'within') : 'grey', sub: specApplies ? `LSL ${f0(spec.lsl)} · USL ${f0(spec.usl)}: ${avgT === null ? 'no data' : avgT < spec.lsl ? 'below LSL' : avgT > spec.usl ? 'above USL' : 'within limits'}` : 'Factory limits apply to the whole factory', open: ['imr-factory', 'weekly-avg'] }),
  ];
  let charts = [], title = 'Mislocation';
  if (tab === 'total' || tab === 'electrical') {
    const isE = tab === 'electrical';
    const s = standard(ctx, { seg: 'defects', subset: isE ? 'electrical' : 'mislocation', subject: isE ? 'electrical mislocations' : 'mislocations', nameDim: 'facility', nameLabel: 'Facility', spec: specApplies ? (isE ? especRaw : spec) : null, prefix: isE ? 'ele' : 'mis', dims: [{ key: 'station', dim: 'produced_at', label: 'Defect produced at (station)', drill: 'station', limit: 25, plural: 'stations' }, { key: 'found', dim: 'found_at', label: 'Defect found at', drill: 'found', plural: 'places' }, { key: 'operator', dim: 'operator', label: 'Operator', limit: 20, drill: 'op', plural: 'operators' }] });
    // pareto by line in addition to pareto by facility
    s.charts.splice(5, 0, K.paretoChart({ id: (isE ? 'ele' : 'mis') + '-pareto-line', title: `Pareto of ${isE ? 'electrical ' : ''}mislocations by line`, items: s.byLine, yName: 'Mislocations', xName: 'Line', drill: { param: 'line' }, subject: isE ? 'electrical mislocations' : 'mislocations', period: P.short }));
    charts = s.charts; title = isE ? 'Mislocation: electrical' : 'Mislocation: total';
  }
  if (tab === 'facility') {
    title = 'Mislocation by facility';
    const bt = Qt.by('facility', P), be = toMap(Qe.by('facility', P));
    charts.push(K.stackedChart({ id: 'side-by-side', title: 'Total and electrical mislocations by facility', x: bt.map(x => x.name), keys: bt.map(x => x.name), stacks: [{ name: 'Total', data: bt.map(x => x.value), nostack: true }, { name: 'Electrical', data: bt.map(x => be.get(x.name) || 0), nostack: true }], yName: 'Mislocations', xName: 'Facility', drill: { param: 'fac' }, wide: true, analysis: bt.length ? `${bt[0].name}: ${f0(bt[0].value)} total, ${f0(be.get(bt[0].name) || 0)} electrical (${pct((be.get(bt[0].name) || 0) / bt[0].value * 100)}).` : null }));
    const dw = dayWindow(ctx, Qt); const st = Qt.series(dw.range), se = Qe.series(dw.range);
    charts.push(K.lineChart({ id: 'mis-daily', title: 'Daily total and electrical mislocations', x: dw.dates.map(dShort), keys: dw.dates, series: [{ name: 'Total', data: dw.dates.map(d => st.get(d) || 0) }, { name: 'Electrical', data: dw.dates.map(d => se.get(d) || 0) }], marks: specApplies ? [{ name: 'LSL', value: spec.lsl, color: '#dc2626' }, { name: 'USL', value: spec.usl, color: '#dc2626' }] : [], yName: 'Mislocations per day', xName: 'Date', wide: true, drill: { param: 'day' } }));
    charts.push(K.paretoChart({ id: 'pareto-fac', title: 'Pareto of mislocations by facility', items: bt, yName: 'Mislocations', xName: 'Facility', drill: { param: 'fac' }, subject: 'mislocations', period: P.short }));
    charts.push(K.paretoChart({ id: 'pareto-line', title: 'Pareto of mislocations by line', items: Qt.by('line', P), yName: 'Mislocations', xName: 'Line', drill: { param: 'line' }, subject: 'mislocations', period: P.short }));
    if (CP) {
      const pt = toMap(Qt.by('facility', CP)), pe = toMap(Qe.by('facility', CP));
      const names = [...new Set([...bt.map(x => x.name), ...pt.keys()])];
      const rows = names.map(n => { const a = (bt.find(x => x.name === n) || {}).value || 0, b = pt.get(n) || 0, ae = be.get(n) || 0, bep = pe.get(n) || 0; const c1 = C.pctChange(a, b), c2 = C.pctChange(ae, bep); return { name: n, cur: a, prev: b, pct: c1.pct === null ? null : C.round(c1.pct, 1), dir: c1.dir, ecur: ae, eprev: bep, epct: c2.pct === null ? null : C.round(c2.pct, 1) }; }).sort((a, b) => b.cur - a.cur);
      charts.push(K.tableChart({ id: 'wow', title: `Week-over-week change per facility: ${P.short} vs ${CP.label}`, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'cur', label: `Total ${P.short}`, type: 'num' }, { key: 'prev', label: `Total ${CP.label}`, type: 'num' }, { key: 'pct', label: 'Total change %', type: 'deltapct' }, { key: 'ecur', label: `Electrical ${P.short}`, type: 'num' }, { key: 'eprev', label: `Electrical ${CP.label}`, type: 'num' }, { key: 'epct', label: 'Electrical change %', type: 'deltapct' }], rows, analysis: `${rows.filter(r => r.dir === 'down').length} facilities dropped (green), ${rows.filter(r => r.dir === 'up').length} rose (red).` }));
    }
  }
  if (tab === 'control') {
    title = 'Mislocation control charts';
    const range = P.days >= 28 ? { from: P.from, to: P.to } : { from: C.addDays(P.to, -55), to: P.to };
    const fNoFac = { ...ctx.f, fac: '' };
    const Qf = new Q(ctx.db, 'defects', fNoFac, 'mislocation');
    const dates = Qf.dataDays(range);
    const sf = Qf.series(range);
    const fv = dates.map(d => sf.get(d) || 0);
    const factoryAvg = C.mean(fv);
    charts.push(K.imrChart({ id: 'imr-factory', title: 'Factory daily mislocations: I-MR control chart', dates, values: fv, spec, yName: 'Mislocations per day', note: `Window: ${dLabel(range.from)} – ${dLabel(range.to, true)} (${dates.length} data days). Spec limits LSL ${f0(spec.lsl)}, USL ${f0(spec.usl)}.` }));
    // weekly averages
    const ww = weekWindow(ctx, 12);
    const wk = new Map();
    const allDates = Qf.dataDays(ww.range); const allSeries = Qf.series(ww.range);
    for (const d of allDates) { const k = C.weekInfo(d, ctx.cfg).key; const o = wk.get(k) || { s: 0, n: 0 }; o.s += allSeries.get(d) || 0; o.n++; wk.set(k, o); }
    const weeks = ww.weeks.filter(w => wk.has(w.key));
    const wv = weeks.map(w => C.round(wk.get(w.key).s / wk.get(w.key).n, 1));
    charts.push(K.lineChart({ id: 'weekly-avg', title: 'Weekly average mislocations per day', x: weeks.map(w => w.label), keys: weeks.map(w => w.key), series: [{ name: 'Average per day', data: wv }], marks: [{ name: 'LSL', value: spec.lsl, color: '#dc2626' }, { name: 'USL', value: spec.usl, color: '#dc2626' }], yName: 'Mislocations per day', xName: 'Week', drill: { param: 'week' }, analysis: wv.length ? `${wv.filter(v => v > spec.usl || v < spec.lsl).length} of ${wv.length} weeks outside ${f0(spec.lsl)}–${f0(spec.usl)}. Latest ${weeks[weeks.length - 1].label}: ${f1(wv[wv.length - 1])} per day.` : null }));
    // per facility
    const facs = (facFilter.length ? facFilter : Qf.by('facility', range).map(x => x.name));
    const rows = Qf.by2('facility', 'date', range);
    const specRows = [];
    for (const fac of facs) {
      const v = dates.map(d => rows.get(fac, d));
      const fs = facilitySpec(ctx, spec, fac, C.mean(v), factoryAvg);
      specRows.push({ name: fac, avg: C.round(C.mean(v), 1), share: C.round(fs.share * 100, 1), lsl: C.round(fs.lsl, 1), usl: C.round(fs.usl, 1), mode: fs.mode });
      charts.push(K.imrChart({ id: 'imr-' + fac, title: `${fac}: daily mislocations I-MR`, dates, values: v, spec: { lsl: fs.lsl, usl: fs.usl }, yName: 'Mislocations per day', note: fs.mode === 'manual' ? 'Facility spec limits entered in Settings.' : `Facility spec limits derived from the factory limits by its share of the average (${pct(fs.share * 100)}).` }));
    }
    charts.splice(2, 0, K.tableChart({ id: 'facility-limits', title: 'Facility spec limits', wide: false, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'avg', label: 'Average per day', type: 'num1' }, { key: 'share', label: 'Share %', type: 'num1' }, { key: 'lsl', label: 'LSL', type: 'num1' }, { key: 'usl', label: 'USL', type: 'num1' }, { key: 'mode', label: 'Source' }], rows: specRows }));
  }
  return { title, segment: 'defects', subset: tab === 'electrical' ? 'electrical' : 'mislocation', tabs: [{ id: 'total', label: 'Total' }, { id: 'electrical', label: 'Electrical' }, { id: 'facility', label: 'By facility' }, { id: 'control', label: 'Control chart' }], tab, cards, charts, records: recordsSpec('defects', tab === 'electrical' ? 'electrical' : 'mislocation') };
}

// ---------- COMPLIANCE ----------
function operatorStarts(ctx) {
  const m = new Map(ctx.db.prepare('SELECT operator, start_date FROM operators').all().map(r => [r.operator, r.start_date]));
  return m;
}
function complianceCases(ctx, range, subset = 'all') {
  const w = where('compliance', range, ctx.f, subset);
  return ctx.db.prepare(`SELECT date, operator, qty, violation, line, facility, team_leader, operator_start, report_no FROM compliance WHERE ${w.sql}`).all(...w.params);
}
function withTenure(ctx, rows) {
  const starts = operatorStarts(ctx);
  let known = 0;
  for (const r of rows) { const sd = r.operator_start || (r.operator ? starts.get(r.operator) : null); r.band = C.tenureBand(sd, r.date); r.isNew = sd ? C.tenureMonths(sd, r.date) < (ctx.settings.newOperatorMonths || 3) : null; if (sd) known++; }
  return { rows, known, starts };
}
function repeatOperators(rows) {
  const m = new Map();
  for (const r of rows) { if (!r.operator) continue; const o = m.get(r.operator) || { operator: r.operator, cases: 0, dates: new Set(), violations: new Map(), lines: new Set(), tl: new Set() }; o.cases += r.qty || 1; o.dates.add(r.date); o.violations.set(r.violation, (o.violations.get(r.violation) || 0) + 1); if (r.line) o.lines.add(r.line); if (r.team_leader) o.tl.add(r.team_leader); m.set(r.operator, o); }
  return [...m.values()].filter(o => o.cases >= 2).sort((a, b) => b.cases - a.cases).map(o => ({ operator: o.operator, cases: o.cases, dates: [...o.dates].sort().map(d => dLabel(d)).join(', '), violations: [...o.violations.entries()].map(([k, v]) => `${k}${v > 1 ? ' x' + v : ''}`).join('; '), lines: [...o.lines].join(', '), tl: [...o.tl].join(', '), _drill: { op: o.operator } }));
}

function compliancePage(ctx, sub) {
  const P = ctx.period, CP = cmpFor(ctx, new Q(ctx.db, 'compliance', ctx.f));
  const subset = sub === 'camera' ? 'camera' : 'all';
  const subj = sub === 'camera' ? 'camera cases' : 'cases';
  const dims = [
    { key: 'found', dim: 'found_at', label: 'Defect found at', plural: 'places' },
    { key: 'station', dim: 'station_no', label: 'Station NO', plural: 'stations' },
    { key: 'jig', dim: 'jig', label: 'JIG number', plural: 'JIG values' },
    { key: 'patroller', dim: 'patroller', label: 'Patroller', plural: 'patrollers' },
    { key: 'source', dim: 'source', label: 'Source (line or camera)', drill: 'src', plural: 'sources' },
    { key: 'operator', dim: 'operator', label: 'Operator', drill: 'op', limit: 20, plural: 'operators' },
  ];
  const s = standard(ctx, { seg: 'compliance', subset, subject: subj, nameLabel: 'Violation', targetKpi: sub === 'camera' ? null : 'compliance_per_day', dims });
  const cards = stdCards(ctx, s, { seg: 'compliance', subject: subj, prefix: '', totalLabel: sub === 'camera' ? 'Camera cases' : 'Cases in period' });
  const extra = [];
  const tgtDay = s.tgt;
  if (tgtDay !== null && sub !== 'camera') {
    const segLast = ctx.bounds.seg.compliance.b || P.to;
    const to = segLast < P.to ? segLast : P.to;
    const wd = C.workingDays(P.from, to, ctx.cfg.workDays);
    const tg = tgtDay * wd; const gap = tg - s.cur.value;
    cards.splice(1, 0, card('target', 'Target and gap', tg, { unit: 'cases', period: `${P.short}, ${wd} working days x ${f0(tgtDay)}`, status: C.status(s.cur.value, tg), sub: gap >= 0 ? `${f0(gap)} cases under target (within target)` : `${f0(-gap)} cases over target`, open: ['daily', 'weekly'] }));
    cards[0].status = C.status(s.cur.value, tg);
  }
  const rows = complianceCases(ctx, P, subset);
  const ten = withTenure(ctx, rows);
  const rep = repeatOperators(rows);
  if (ten.known) {
    const nNew = C.sum(rows.filter(r => r.isNew).map(r => r.qty || 1));
    cards.push(card('new-ops', 'Cases from new operators', nNew, { unit: `cases (under ${ctx.settings.newOperatorMonths || 3} months)`, period: P.short, sub: `${pct(nNew / (s.cur.value || 1) * 100)} of cases · tenure known for ${f0(ten.known)} of ${f0(rows.length)}`, open: ['tenure'] }));
  } else ctx.notes.push('Operator start dates are not uploaded yet, so new-operator (under 3 months) and tenure analysis cannot be calculated. Upload an operator list (Operator ID, Start date) in Admin › Upload.');
  cards.push(card('repeat-ops', 'Repeat operators', rep.length, { unit: 'operators with 2+ cases', period: P.short, status: rep.length ? 'red' : 'green', sub: rep.length ? `${rep[0].operator}: ${rep[0].cases} cases` : 'No repeats', open: ['repeat-table'] }));

  // I-MR on daily cases
  const range = P.days >= 28 ? { from: P.from, to: P.to } : { from: C.addDays(P.to, -55), to: P.to };
  const dates = s.Qr.dataDays(range); const ser = s.Qr.series(range);
  extra.push(K.imrChart({ id: 'imr', title: `Daily ${subj}: I-MR control chart`, dates, values: dates.map(d => ser.get(d) || 0), spec: tgtDay !== null ? { lsl: null, usl: tgtDay } : null, yName: `${cap(subj)} per day`, note: `Window: ${dLabel(range.from)} – ${dLabel(range.to, true)} (${dates.length} data days).${tgtDay !== null ? ` Target ${f0(tgtDay)} per day drawn as the upper spec.` : ''}` }));
  // source donut
  const bySrc = new Q(ctx.db, 'compliance', { ...ctx.f, _lineOnly: false }).by('source', P);
  if (sub !== 'camera' && ctx.f._lineOnly) {
    const camN = (bySrc.find(x => x.name === 'Camera') || {}).value || 0;
    cards[0].sub = `${cards[0].sub} · plus ${f0(camN)} camera case${camN === 1 ? '' : 's'} (see Camera cases)`;
  }
  if (bySrc.length >= 1 && sub !== 'camera') extra.push(K.donutChart({ id: 'source-donut', title: 'Cases by source', items: bySrc, analysis: bySrc.map(x => `${x.name}: ${f0(x.value)}`).join(', ') + '.' }));
  // tenure
  if (ten.known) {
    const bands = [...C.TENURE_BANDS, 'Unknown'];
    const items = bands.map(b => ({ name: b + (b === 'Unknown' ? '' : ' months'), key: b, value: C.sum(rows.filter(r => r.band === b).map(r => r.qty || 1)) }));
    const hc = new Map(); for (const sd of ten.starts.values()) { const b = C.tenureBand(sd, P.to); hc.set(b, (hc.get(b) || 0) + 1); }
    const hcTotal = C.sum([...hc.values()]); const caseTotal = C.sum(items.filter(i => i.key !== 'Unknown').map(i => i.value));
    extra.push(K.stackedChart({ id: 'tenure', title: 'Share of cases vs share of headcount by tenure band', x: C.TENURE_BANDS.map(b => b + ' months'), keys: C.TENURE_BANDS, stacks: [{ name: 'Share of cases %', data: C.TENURE_BANDS.map(b => C.round((items.find(i => i.key === b).value / (caseTotal || 1)) * 100, 1)), nostack: true }, { name: 'Share of headcount %', data: C.TENURE_BANDS.map(b => C.round(((hc.get(b) || 0) / (hcTotal || 1)) * 100, 1)), nostack: true }], yName: '%', xName: 'Tenure band', analysis: `Cases by band: ${items.map(i => `${i.name} ${f0(i.value)}`).join(', ')}. Headcount from the operator list: ${f0(hcTotal)}.` }));
  }
  extra.push(K.tableChart({ id: 'repeat-table', title: 'Repeat operators (2 or more cases in the period)', columns: [{ key: 'operator', label: 'Operator ID' }, { key: 'cases', label: 'Cases', type: 'num' }, { key: 'dates', label: 'Dates' }, { key: 'violations', label: 'Violations' }, { key: 'lines', label: 'Lines' }, { key: 'tl', label: 'Team leader' }], rows: rep, drill: { records: true }, empty: 'No operator has 2 or more cases in this period.', analysis: rep.length ? `${rep.length} operators have 2+ cases, together ${f0(C.sum(rep.map(r => r.cases)))} of ${f0(s.cur.value)} cases (${pct(C.sum(rep.map(r => r.cases)) / (s.cur.value || 1) * 100)}).` : null }));
  const title = sub === 'camera' ? 'Camera cases' : 'Compliance overview';
  return { title, segment: 'compliance', subset, cards, charts: [...s.charts.slice(0, 2), extra[0], ...s.charts.slice(2), ...extra.slice(1)], records: recordsSpec('compliance', subset) };
}

function complianceOperators(ctx, onlyNew) {
  const P = ctx.period;
  const rows = complianceCases(ctx, P);
  const ten = withTenure(ctx, rows);
  const total = C.sum(rows.map(r => r.qty || 1));
  const rep = repeatOperators(rows);
  const Qr = new Q(ctx.db, 'compliance', ctx.f);
  const cards = [], charts = [];
  if (!onlyNew) {
    const ops = Qr.by('operator', P);
    cards.push(card('ops', 'Operators with cases', ops.length, { unit: 'operators', period: P.short, sub: `${f0(total)} cases`, open: ['top-ops'] }));
    cards.push(card('repeat', 'Repeat operators', rep.length, { unit: 'operators with 2+ cases', period: P.short, status: rep.length ? 'red' : 'green', open: ['repeat-table'] }));
    cards.push(card('repeat-share', 'Cases from repeat operators', C.sum(rep.map(r => r.cases)), { unit: 'cases', period: P.short, sub: `${pct(C.sum(rep.map(r => r.cases)) / (total || 1) * 100)} of ${f0(total)}`, open: ['repeat-table'] }));
    if (ten.known) { const n = C.sum(rows.filter(r => r.isNew).map(r => r.qty || 1)); cards.push(card('new', 'Cases from new operators', n, { unit: 'cases', period: P.short, sub: `${pct(n / (total || 1) * 100)} of cases`, open: ['tenure-bands'] })); }
    charts.push(K.tableChart({ id: 'repeat-table', title: 'Repeat offenders: operators with 2 or more cases', columns: [{ key: 'operator', label: 'Operator ID' }, { key: 'cases', label: 'Cases', type: 'num' }, { key: 'dates', label: 'Dates' }, { key: 'violations', label: 'Violations' }, { key: 'lines', label: 'Lines' }, { key: 'tl', label: 'Team leader' }], rows: rep, drill: { records: true }, empty: 'No operator has 2 or more cases in this period.' }));
    charts.push(K.barChart({ id: 'top-ops', title: 'Cases per operator (top 25)', items: ops, limit: 25, yName: 'Cases', xName: 'Operator', drill: { param: 'op' }, analysis: K.rankText(ops, null, 'cases', 'operators', P.short) }));
    const top = ops.slice(0, 15).map(x => x.name);
    const m = Qr.by2('operator', 'violation', P);
    const vio = [...new Set(m.filter(r => top.includes(String(r.a))).map(r => r.b))];
    charts.push(K.heatmapChart({ id: 'op-violation', title: 'Top operators by violation', rows: top, cols: vio, get: (a, b) => m.get(a, b), yName: 'Operator', xName: 'Violation', drill: { param: 'op' } }));
  }
  if (ten.known) {
    const bands = C.TENURE_BANDS;
    const items = bands.map(b => ({ name: b + ' months', key: b, value: C.sum(rows.filter(r => r.band === b).map(r => r.qty || 1)) }));
    const hc = new Map(); for (const sd of ten.starts.values()) { const b = C.tenureBand(sd, P.to); hc.set(b, (hc.get(b) || 0) + 1); }
    const hcTotal = C.sum([...hc.values()]); const caseTotal = C.sum(items.map(i => i.value));
    const newCases = C.sum(rows.filter(r => r.isNew).map(r => r.qty || 1));
    const newHc = C.sum(['0-1', '1-3'].map(b => hc.get(b) || 0));
    if (onlyNew) {
      cards.push(card('new', 'Cases from new operators', newCases, { unit: `cases (under ${ctx.settings.newOperatorMonths || 3} months)`, period: P.short, sub: `${pct(newCases / (total || 1) * 100)} of ${f0(total)} cases`, open: ['tenure-bands'] }));
      cards.push(card('new-hc', 'New operators in headcount', newHc, { unit: 'operators', period: `as of ${dLabel(P.to)}`, sub: `${pct(newHc / (hcTotal || 1) * 100)} of ${f0(hcTotal)}`, open: ['tenure-share'] }));
      cards.push(card('unknown', 'Cases with unknown tenure', C.sum(rows.filter(r => r.band === 'Unknown').map(r => r.qty || 1)), { unit: 'cases', period: P.short, sub: 'operator not in the operator list' }));
    }
    charts.push(K.barChart({ id: 'tenure-bands', title: 'Cases by tenure band', items, yName: 'Cases', xName: 'Tenure band', horizontal: false, analysis: `${f0(newCases)} of ${f0(total)} cases (${pct(newCases / (total || 1) * 100)}) come from operators under ${ctx.settings.newOperatorMonths || 3} months.` }));
    charts.push(K.stackedChart({ id: 'tenure-share', title: 'Share of cases vs share of headcount', x: items.map(i => i.name), keys: bands, stacks: [{ name: 'Share of cases %', data: items.map(i => C.round(i.value / (caseTotal || 1) * 100, 1)), nostack: true }, { name: 'Share of headcount %', data: bands.map(b => C.round((hc.get(b) || 0) / (hcTotal || 1) * 100, 1)), nostack: true }], yName: '%', xName: 'Tenure band' }));
    const newRows = rows.filter(r => r.isNew);
    const byV = new Map(); for (const r of newRows) byV.set(r.violation, (byV.get(r.violation) || 0) + (r.qty || 1));
    charts.push(K.paretoChart({ id: 'new-pareto', title: 'Violations of new operators', items: [...byV].map(([name, value]) => ({ name, value })), yName: 'Cases', xName: 'Violation', drill: { param: 'defect' }, subject: 'new-operator cases', period: P.short }));
  } else {
    charts.push({ id: 'tenure-empty', type: 'empty', title: 'New operator analysis', wide: true, note: 'Upload an operator list with start dates (columns: Operator ID, Start date) in Admin › Upload. The website then flags operators with under 3 months in assembly and shows cases by tenure band (0-1, 1-3, 3-6, 6+ months) with the share of cases versus the share of headcount.' });
  }
  return { title: onlyNew ? 'New operators' : 'Operators', segment: 'compliance', subset: 'all', cards, charts, records: recordsSpec('compliance', 'all') };
}

function complianceTeamLeaders(ctx) {
  const P = ctx.period, CP = cmpFor(ctx, new Q(ctx.db, 'compliance', ctx.f));
  const Qr = new Q(ctx.db, 'compliance', ctx.f);
  const by = Qr.by('team_leader', P).sort((a, b) => a.name.localeCompare(b.name));
  const prev = CP ? toMap(Qr.by('team_leader', CP)) : null;
  const total = C.sum(by.map(x => x.value));
  const cards = by.map(x => card('tl-' + x.name, `Team leader ${x.name}`, x.value, { unit: 'cases', period: P.short, delta: prev ? delta(x.value, prev.get(x.name) || 0) : null, sub: `${pct(x.value / (total || 1) * 100)} of ${f0(total)}`, open: ['by-tl', 'tl-daily'] }));
  const charts = [];
  charts.push(K.barChart({ id: 'by-tl', title: 'Cases per team leader', items: by, yName: 'Cases', xName: 'Team leader', drill: { param: 'tl' }, horizontal: false, analysis: K.rankText([...by].sort((a, b) => b.value - a.value), prev, 'cases', 'team leaders', P.short, CP && CP.label) }));
  const dw = dayWindow(ctx, Qr);
  const rows = Qr.by2('date', 'team_leader', dw.range);
  charts.push(K.lineChart({ id: 'tl-daily', title: 'Daily cases per team leader', x: dw.dates.map(dShort), keys: dw.dates, series: by.map(t => ({ name: t.name, data: dw.dates.map(d => rows.get(d, t.name)) })), yName: 'Cases per day', xName: 'Date', wide: true }));
  const ww = weekWindow(ctx, 12); const wr = Qr.by2('week_key', 'team_leader', ww.range);
  charts.push(K.lineChart({ id: 'tl-weekly', title: 'Weekly cases per team leader', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: by.map(t => ({ name: t.name, data: ww.weeks.map(w => wr.get(w.key, t.name)) })), yName: 'Cases per week', xName: 'Week', wide: true, drill: { param: 'week' } }));
  const tv = Qr.by2('team_leader', 'violation', P);
  const vio = [...new Set(tv.map(r => r.b))].sort((a, b) => C.sum(tv.filter(r => r.b === b).map(r => r.v)) - C.sum(tv.filter(r => r.b === a).map(r => r.v)));
  charts.push(K.stackedChart({ id: 'tl-violation', title: 'Top violations per team leader', x: by.map(t => t.name), keys: by.map(t => t.name), stacks: vio.map(v => ({ name: v, data: by.map(t => tv.get(t.name, v)) })), yName: 'Cases', xName: 'Team leader', drill: { param: 'tl' }, wide: true, analysis: by.map(t => { const top = tv.filter(r => r.a === t.name).sort((a, b) => b.v - a.v)[0]; return top ? `${t.name}: top violation ${top.b} (${f0(top.v)} of ${f0(t.value)})` : null; }).filter(Boolean).join('. ') + '.' }));
  const tf = Qr.by2('team_leader', 'facility', P);
  const facs = [...new Set(tf.map(r => r.b))];
  charts.push(K.heatmapChart({ id: 'tl-facility', title: 'Team leader by facility', rows: by.map(t => t.name), cols: facs, get: (a, b) => tf.get(a, b), yName: 'Team leader', xName: 'Facility', drill: { param: 'tl' } }));
  const ts = Qr.by2('team_leader', 'shift', P); const shifts = [...new Set(ts.map(r => r.b))].sort();
  charts.push(K.heatmapChart({ id: 'tl-shift', title: 'Team leader by shift', rows: by.map(t => t.name), cols: shifts, get: (a, b) => ts.get(a, b), yName: 'Team leader', xName: 'Shift', drill: { param: 'tl' } }));
  if (CP) charts.push(K.tableChart({ id: 'wow', title: `Change per team leader: ${P.short} vs ${CP.label}`, wide: false, columns: [{ key: 'name', label: 'Team leader', drill: 'tl' }, { key: 'cur', label: P.short, type: 'num' }, { key: 'prev', label: CP.label, type: 'num' }, { key: 'change', label: 'Change', type: 'delta' }, { key: 'pct', label: 'Change %', type: 'deltapct' }], rows: by.map(t => { const p = prev.get(t.name) || 0; const c = C.pctChange(t.value, p); return { name: t.name, cur: t.value, prev: p, change: c.abs, pct: c.pct === null ? null : C.round(c.pct, 1) }; }) }));
  return { title: 'Team leaders', segment: 'compliance', subset: 'all', cards, charts, records: recordsSpec('compliance', 'all') };
}

// ---------- SAFETY ----------
function safetyAlt(ctx) { return Object.fromEntries(ctx.db.prepare('SELECT english, arabic FROM safety_items').all().map(r => [r.english, r.arabic])); }

function safetyPage(ctx, sub) {
  const P = ctx.period, CP = cmpFor(ctx, new Q(ctx.db, 'safety', ctx.f));
  const alt = safetyAlt(ctx);
  const Qr = new Q(ctx.db, 'safety', ctx.f);
  const cards = []; let charts = [];
  const cur = Qr.total(P), prev = CP ? Qr.total(CP) : null;
  const days = Qr.dataDays(P);
  const asm = Qr.total(P, { sql: "department='Assembly'" });
  const byArea = Qr.by('area', P), prevArea = CP ? toMap(Qr.by('area', CP)) : null;
  const byItem = Qr.by('item', P);
  const ww = weekWindow(ctx, 30);
  if (sub === 'overview') {
    const s = standard(ctx, { seg: 'safety', subject: 'cases', nameLabel: 'Non-compliance item', alt, weeks: 30, targetKpi: 'safety_per_day', dims: [{ key: 'dept', dim: 'department', label: 'Department', drill: 'dept', plural: 'departments' }, { key: 'area', dim: 'area', label: 'Area', drill: 'area', limit: 35, plural: 'areas' }, { key: 'operator', dim: 'operator', label: 'Operator', drill: 'op', limit: 20, plural: 'operators' }] });
    cards.push(...stdCards(ctx, s, { seg: 'safety', subject: 'cases', prefix: '', totalLabel: 'Cases in period' }).filter(c => !c.id.endsWith('worst-line') && !c.id.endsWith('worst-fac')));
    cards.push(card('assembly', 'Assembly cases', asm.value, { unit: 'cases', period: P.short, sub: `${pct(asm.value / (cur.value || 1) * 100)} of all departments`, open: ['weekly-asm', 'by-dept'] }));
    cards.push(card('worst-area', 'Worst area', byArea[0] ? byArea[0].value : null, { unit: 'cases', period: P.short, sub: byArea[0] ? byArea[0].name : '', open: ['by-area'] }));
    cards.push(card('top-item', 'Top non-compliance item', byItem[0] ? byItem[0].value : null, { unit: 'cases', period: P.short, sub: byItem[0] ? byItem[0].name : '', open: ['pareto'] }));
    // weekly all vs assembly
    const all = Qr.weekly(ww.range), as = Qr.weekly(ww.range, { sql: "department='Assembly'" });
    const wl = ww.weeks.map(w => all.get(w.key) || 0), wa = ww.weeks.map(w => as.get(w.key) || 0);
    charts.push(K.lineChart({ id: 'weekly-asm', title: `Weekly safety cases ${ww.weeks[0].label} to ${ww.weeks[ww.weeks.length - 1].label}: all departments and Assembly`, x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: [{ name: 'All departments', data: wl }, { name: 'Assembly', data: wa }], yName: 'Cases per week', xName: 'Week', wide: true, drill: { param: 'week' }, analysis: K.trendText(ww.weeks.map(w => w.label), wl, 'cases', x => x) + ` Assembly: ${f0(C.sum(wa))} of ${f0(C.sum(wl))} (${pct(C.sum(wa) / (C.sum(wl) || 1) * 100)}).` }));
    charts.push(...s.charts.filter(c => c.id !== 'weekly'));
    // heatmaps
    const top = byArea.slice(0, 20).map(x => x.name);
    const aw = Qr.by2('area', 'week_key', weekWindow(ctx, 12).range); const w12 = weekWindow(ctx, 12).weeks;
    charts.push(K.heatmapChart({ id: 'area-week', title: 'Area by week (last 12 weeks)', rows: top, cols: w12.map(w => w.key), colLabels: w12.map(w => w.label), get: (a, b) => aw.get(a, b), yName: 'Area', xName: 'Week', drill: { param: 'area' } }));
    const ia = Qr.by2('item', 'area', P);
    charts.push(K.heatmapChart({ id: 'item-area', title: 'Non-compliance item by area', rows: byItem.map(x => x.name), cols: top.filter(a => ia.some(r => r.b === a)), get: (a, b) => ia.get(a, b), yName: 'Item', xName: 'Area', drill: { param: 'defect' } }));
    charts.push(...safetyRepeats(ctx));
  }
  if (sub === 'areas') {
    cards.push(card('areas', 'Areas with cases', byArea.length, { unit: 'areas', period: P.short, sub: `${f0(cur.value)} cases`, open: ['by-area'] }));
    cards.push(card('worst-area', 'Worst area', byArea[0] ? byArea[0].value : null, { unit: 'cases', period: P.short, sub: byArea[0] ? byArea[0].name : '', open: ['by-area'] }));
    cards.push(card('total', 'Cases in period', cur.value, { unit: 'cases', period: P.short, delta: delta(cur.value, prev && prev.value), open: ['by-area'] }));
    charts.push(K.barChart({ id: 'by-area', title: 'Cases by area (sorted)', items: byArea, yName: 'Cases', xName: 'Area', drill: { param: 'area' }, analysis: K.rankText(byArea, prevArea, 'cases', 'areas', P.short, CP && CP.label) }));
    const byLoc = Qr.by('location', P);
    charts.push(K.barChart({ id: 'by-location', title: list(ctx.f.area).length ? `Cases by location in ${list(ctx.f.area).join(', ')}` : 'Cases by location (click an area to drill down)', items: byLoc, limit: 30, yName: 'Cases', xName: 'Location', drill: { param: 'line' }, analysis: K.rankText(byLoc, null, 'cases', 'locations', P.short) }));
    const w12 = weekWindow(ctx, 12); const aw = Qr.by2('area', 'week_key', w12.range);
    const areas = [...new Set(aw.map(r => r.a))].sort((a, b) => C.sum(aw.filter(r => r.a === b).map(r => r.v)) - C.sum(aw.filter(r => r.a === a).map(r => r.v)));
    charts.push(K.heatmapChart({ id: 'area-week', title: 'Area by week', rows: areas, cols: w12.weeks.map(w => w.key), colLabels: w12.weeks.map(w => w.label), get: (a, b) => aw.get(a, b), yName: 'Area', xName: 'Week', drill: { param: 'area' } }));
    charts.push(wowTable(ctx, 'Area', byArea, prevArea, cur, prev, 'area'));
    const top5 = byArea.slice(0, 5).map(x => x.name); const wr = Qr.by2('week_key', 'area', ww.range);
    charts.push(K.lineChart({ id: 'area-trend', title: 'Weekly trend of the top 5 areas', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: top5.map(a => ({ name: a, data: ww.weeks.map(w => wr.get(w.key, a)) })), yName: 'Cases per week', xName: 'Week', wide: true }));
  }
  if (sub === 'departments') {
    const byDept = Qr.by('department', P), prevDept = CP ? toMap(Qr.by('department', CP)) : null;
    cards.push(card('total', 'Cases in period', cur.value, { unit: 'cases', period: P.short, delta: delta(cur.value, prev && prev.value), open: ['by-dept'] }));
    for (const d of byDept.slice(0, 4)) cards.push(card('d-' + d.name, d.name, d.value, { unit: 'cases', period: P.short, delta: prevDept ? delta(d.value, prevDept.get(d.name) || 0) : null, sub: `${pct(d.value / (cur.value || 1) * 100)} of all`, open: ['by-dept', 'dept-weekly'] }));
    charts.push(K.barChart({ id: 'by-dept', title: 'Cases by department', items: byDept, yName: 'Cases', xName: 'Department', drill: { param: 'dept' }, horizontal: false, analysis: K.rankText(byDept, prevDept, 'cases', 'departments', P.short, CP && CP.label) }));
    const wr = Qr.by2('week_key', 'department', ww.range);
    charts.push(K.lineChart({ id: 'dept-weekly', title: 'Weekly cases per department', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: byDept.map(d => ({ name: d.name, data: ww.weeks.map(w => wr.get(w.key, d.name)) })), yName: 'Cases per week', xName: 'Week', wide: true }));
    const di = Qr.by2('department', 'item', P);
    charts.push(K.heatmapChart({ id: 'dept-item', title: 'Department by non-compliance item', rows: byDept.map(d => d.name), cols: byItem.map(i => i.name), get: (a, b) => di.get(a, b), yName: 'Department', xName: 'Item', drill: { param: 'dept' } }));
    const da = Qr.by2('department', 'area', P);
    charts.push(K.heatmapChart({ id: 'dept-area', title: 'Department by area', rows: byDept.map(d => d.name), cols: byArea.map(a => a.name), get: (a, b) => da.get(a, b), yName: 'Department', xName: 'Area', drill: { param: 'dept' } }));
    charts.push(wowTable(ctx, 'Department', byDept, prevDept, cur, prev, 'dept'));
  }
  if (sub === 'items') {
    cards.push(card('items', 'Items with cases', byItem.length, { unit: 'of 27 items', period: P.short, open: ['pareto'] }));
    cards.push(card('top-item', 'Top item', byItem[0] ? byItem[0].value : null, { unit: 'cases', period: P.short, sub: byItem[0] ? byItem[0].name : '', open: ['pareto'] }));
    cards.push(card('total', 'Cases in period', cur.value, { unit: 'cases', period: P.short, delta: delta(cur.value, prev && prev.value), open: ['pareto'] }));
    charts.push(K.paretoChart({ id: 'pareto', title: 'Pareto of non-compliance items', items: byItem, yName: 'Cases', xName: 'Item', drill: { param: 'defect' }, alt, max: 28, subject: 'safety cases', period: P.short }));
    const ia = Qr.by2('item', 'area', P);
    charts.push(K.heatmapChart({ id: 'item-area', title: 'Item by area', rows: byItem.map(x => x.name), cols: byArea.slice(0, 20).map(a => a.name), get: (a, b) => ia.get(a, b), yName: 'Item', xName: 'Area', drill: { param: 'defect' } }));
    const top5 = byItem.slice(0, 5).map(x => x.name); const wr = Qr.by2('week_key', 'item', ww.range);
    charts.push(K.lineChart({ id: 'item-trend', title: 'Weekly trend of the top 5 items', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: top5.map(a => ({ name: a, data: ww.weeks.map(w => wr.get(w.key, a)) })), yName: 'Cases per week', xName: 'Week', wide: true }));
    const idp = Qr.by2('item', 'department', P); const depts = [...new Set(idp.map(r => r.b))];
    charts.push(K.heatmapChart({ id: 'item-dept', title: 'Item by department', rows: byItem.map(x => x.name), cols: depts, get: (a, b) => idp.get(a, b), yName: 'Item', xName: 'Department', drill: { param: 'defect' } }));
    charts.push(wowTable(ctx, 'Item', byItem, CP ? toMap(Qr.by('item', CP)) : null, cur, prev, 'defect'));
    charts.push(K.tableChart({ id: 'item-list', title: 'Non-compliance items: English short name and original text', columns: [{ key: 'name', label: 'Short name (English)', drill: 'defect' }, { key: 'ar', label: 'Original (Arabic)', rtl: true }, { key: 'v', label: 'Cases', type: 'num' }], rows: ctx.db.prepare('SELECT english, arabic FROM safety_items ORDER BY english').all().map(r => ({ name: r.english, ar: r.arabic, v: (byItem.find(i => i.name === r.english) || {}).value || 0 })).sort((a, b) => b.v - a.v) }));
  }
  if (!days.length) ctx.notes.push('No safety data in this period.');
  const titles = { overview: 'Safety overview', areas: 'Safety by area', departments: 'Safety by department', items: 'Non-compliance items' };
  return { title: titles[sub], segment: 'safety', subset: 'all', cards, charts: charts.filter(Boolean), records: recordsSpec('safety', 'all') };
}

function wowTable(ctx, label, cur, prevMap, tot, totPrev, drill) {
  const CP = ctx.compare; if (!CP || !prevMap || !totPrev) return null;
  const names = [...new Set([...cur.map(x => x.name), ...prevMap.keys()])];
  const rows = names.map(n => { const a = (cur.find(x => x.name === n) || {}).value || 0, b = prevMap.get(n) || 0; const c = C.pctChange(a, b); return { name: n, cur: a, prev: b, change: c.abs, pct: c.pct === null ? null : C.round(c.pct, 1) }; }).sort((a, b) => b.cur - a.cur);
  rows.push({ name: 'Total', cur: tot.value, prev: totPrev.value, change: tot.value - totPrev.value, pct: totPrev.value ? C.round((tot.value - totPrev.value) / totPrev.value * 100, 1) : null, total: true });
  return K.tableChart({ id: 'wow', title: `Change per ${label.toLowerCase()}: ${ctx.period.short} vs ${CP.label}`, wide: false, columns: [{ key: 'name', label, drill }, { key: 'cur', label: ctx.period.short, type: 'num' }, { key: 'prev', label: CP.label, type: 'num' }, { key: 'change', label: 'Change', type: 'delta' }, { key: 'pct', label: 'Change %', type: 'deltapct' }], rows, analysis: `${rows.filter(r => !r.total && r.change < 0).length} dropped (green), ${rows.filter(r => !r.total && r.change > 0).length} rose (red).` });
}

function safetyRepeats(ctx) {
  const w = where('safety', ctx.period, ctx.f);
  const rows = ctx.db.prepare(`SELECT date, operator, item, area, location FROM safety WHERE ${w.sql}`).all(...w.params);
  const ops = new Map();
  for (const r of rows) if (r.operator) { const o = ops.get(r.operator) || { operator: r.operator, cases: 0, dates: new Set(), items: new Set(), areas: new Set() }; o.cases++; o.dates.add(r.date); o.items.add(r.item); o.areas.add(r.area); ops.set(r.operator, o); }
  const repOps = [...ops.values()].filter(o => o.cases >= 2).sort((a, b) => b.cases - a.cases).map(o => ({ operator: o.operator, cases: o.cases, dates: [...o.dates].sort().map(d => dLabel(d)).join(', '), items: [...o.items].join('; '), areas: [...o.areas].join(', '), _drill: { op: o.operator } }));
  const locs = new Map();
  for (const r of rows) { const k = (r.location || r.area) + '\u0000' + r.item; const o = locs.get(k) || { location: r.location || r.area, area: r.area, item: r.item, cases: 0, dates: new Set() }; o.cases++; o.dates.add(r.date); locs.set(k, o); }
  const repLoc = [...locs.values()].filter(o => o.cases >= 2).sort((a, b) => b.cases - a.cases).slice(0, 50).map(o => ({ ...o, dates: [...o.dates].sort().map(d => dLabel(d)).join(', '), _drill: { line: o.location, defect: o.item } }));
  return [
    K.tableChart({ id: 'repeat-ops', title: 'Repeat cases: operators with 2 or more cases', columns: [{ key: 'operator', label: 'Operator ID' }, { key: 'cases', label: 'Cases', type: 'num' }, { key: 'dates', label: 'Dates' }, { key: 'items', label: 'Items' }, { key: 'areas', label: 'Areas' }], rows: repOps, drill: { records: true }, empty: 'No operator ID with 2 or more cases (OP .ID is often empty in the safety file).' }),
    K.tableChart({ id: 'repeat-locations', title: 'Locations with the same item repeated', columns: [{ key: 'location', label: 'Location' }, { key: 'area', label: 'Area' }, { key: 'item', label: 'Item' }, { key: 'cases', label: 'Cases', type: 'num' }, { key: 'dates', label: 'Dates' }], rows: repLoc, drill: { records: true }, empty: 'No location has the same item twice in this period.', analysis: repLoc.length ? `${repLoc.length} location/item pairs repeat; top: ${repLoc[0].location} – ${repLoc[0].item} (${repLoc[0].cases} cases).` : null }),
  ];
}

// ---------- HOME ----------
function homePage(ctx) {
  const P = ctx.period; const CPd = cmpFor(ctx, new Q(ctx.db, 'defects', ctx.f)), CPc = cmpFor(ctx, new Q(ctx.db, 'compliance', ctx.f)), CPs = cmpFor(ctx, new Q(ctx.db, 'safety', ctx.f));
  const qd = new Q(ctx.db, 'defects', ctx.f), qc = new Q(ctx.db, 'compliance', ctx.f), qs = new Q(ctx.db, 'safety', ctx.f);
  const spec = (ctx.settings.spec || {}).mislocation || {};
  const rows = [];
  // defects
  const d = qd.total(P), dp = CPd ? qd.total(CPd) : null; const dd = qd.dataDays(P).length;
  const crit = qd.total(P, { sql: 'is_critical=1' }), critp = CPd ? qd.total(CPd, { sql: 'is_critical=1' }) : null;
  const czcf = qd.total(P, { sql: 'cpg=1' }), czcfp = CPd ? qd.total(CPd, { sql: 'cpg=1' }) : null;
  const mis = qd.total(P, { sql: 'is_mislocation=1' }); const misp = CPd ? qd.total(CPd, { sql: 'is_mislocation=1' }) : null;
  const rw = qd.total(P, { sql: 'is_rework=1' }), rwp = CPd ? qd.total(CPd, { sql: 'is_rework=1' }) : null;
  const cpd = CPd ? Math.max(1, qd.dataDays(CPd).length) : 1;
  const dTarget = target(ctx, 'defects_per_day');
  rows.push({ segment: 'defects', title: 'Defects', link: '/defects', cards: [
    card('d-total', 'Total defects', d.value, { unit: 'defects', period: P.short, delta: delta(d.value, dp && dp.value), status: dTarget !== null && dd ? C.status(d.value / dd, dTarget) : 'grey', sub: dd ? `${f1(d.value / dd)} per day` : '', link: '/defects' }),
    card('d-crit', 'Critical defects', crit.value, { unit: 'defects', period: P.short, delta: delta(crit.value, critp && critp.value), sub: `${pct(crit.value / (d.value || 1) * 100)} of defects`, link: '/defects/critical' }),
    card('d-czcf', 'CZCF', czcf.value, { unit: 'past concern repeats', period: P.short, delta: delta(czcf.value, czcfp && czcfp.value), status: czcf.value > 0 ? 'red' : 'green', sub: 'Target 0 repeats', link: '/defects/czcf' }),
    card('d-mis', 'Mislocations per day', dd ? mis.value / dd : null, { digits: 1, unit: 'per day', period: P.short, delta: misp ? delta(mis.value / dd, misp.value / cpd) : null, status: list(ctx.f.fac).length ? 'grey' : C.status(dd ? mis.value / dd : null, spec, 'within'), sub: `Spec ${f0(spec.lsl)}–${f0(spec.usl)}`, link: '/defects/mislocation' }),
    card('d-rw', 'Rework', rw.value, { unit: 'defects', period: P.short, delta: delta(rw.value, rwp && rwp.value), sub: `${pct(rw.value / (d.value || 1) * 100)} rework rate`, link: '/defects/rework' }),
  ] });
  // compliance
  const c = qc.total(P), cp = CPc ? qc.total(CPc) : null; const cdays = qc.dataDays(P).length;
  const ct = target(ctx, 'compliance_per_day');
  const segLast = ctx.bounds.seg.compliance.b || P.to; const wd = C.workingDays(P.from, segLast < P.to ? segLast : P.to, ctx.cfg.workDays);
  const ctg = ct !== null ? ct * wd : null;
  const cam = new Q(ctx.db, 'compliance', { ...ctx.f, _lineOnly: false }).total(P, { sql: "source='Camera'" });
  const ccases = complianceCases(ctx, P); const rep = repeatOperators(ccases);
  rows.push({ segment: 'compliance', title: 'Compliance', link: '/compliance', cards: [
    card('c-total', 'Compliance cases', c.value, { unit: 'cases', period: P.short, delta: delta(c.value, cp && cp.value), status: ctg !== null ? C.status(c.value, ctg) : 'grey', sub: ctg !== null ? `Target ${f0(ctg)} (${f0(ct)} x ${wd} days)` : 'No target set', link: '/compliance' }),
    card('c-gap', 'Gap to target', ctg !== null ? ctg - c.value : null, { unit: 'cases', period: P.short, status: ctg !== null ? C.status(c.value, ctg) : 'grey', sub: ctg === null ? '' : ctg - c.value >= 0 ? 'Within target' : 'Over target', link: '/compliance' }),
    card('c-avg', 'Cases per day', cdays ? c.value / cdays : null, { digits: 1, unit: 'per day', period: P.short, status: ct !== null && cdays ? C.status(c.value / cdays, ct) : 'grey', sub: `${cdays} data days`, link: '/compliance' }),
    card('c-cam', 'Camera cases', cam.value, { unit: 'cases', period: P.short, link: '/compliance/camera' }),
    card('c-rep', 'Repeat operators', rep.length, { unit: 'operators', period: P.short, status: rep.length ? 'red' : 'green', link: '/compliance/operators' }),
  ] });
  // safety
  const s = qs.total(P), sp = CPs ? qs.total(CPs) : null; const sdays = qs.dataDays(P).length;
  const sa = qs.total(P, { sql: "department='Assembly'" }); const sap = CPs ? qs.total(CPs, { sql: "department='Assembly'" }) : null;
  const items = qs.by('item', P);
  const st = target(ctx, 'safety_per_day');
  rows.push({ segment: 'safety', title: 'Safety', link: '/safety', cards: [
    card('s-total', 'Safety cases', s.value, { unit: 'cases', period: P.short, delta: delta(s.value, sp && sp.value), status: st !== null && sdays ? C.status(s.value / sdays, st) : 'grey', link: '/safety' }),
    card('s-avg', 'Cases per day', sdays ? s.value / sdays : null, { digits: 1, unit: 'per day', period: P.short, sub: `${sdays} data days`, link: '/safety' }),
    card('s-asm', 'Assembly cases', sa.value, { unit: 'cases', period: P.short, delta: delta(sa.value, sap && sap.value), sub: `${pct(sa.value / (s.value || 1) * 100)} of all`, link: '/safety/departments?dept=Assembly' }),
    card('s-top', 'Top item', items[0] ? items[0].value : null, { unit: 'cases', period: P.short, sub: items[0] ? items[0].name : '', link: '/safety/items' }),
  ] });
  for (const r of rows) for (const cd of r.cards) cd.link = cd.link || r.link;
  // small trends
  const ww = weekWindow(ctx, 12);
  const trend = (q, extra) => { const m = q.weekly(ww.range, extra); return ww.weeks.map(w => m.get(w.key) || 0); };
  const charts = [
    K.lineChart({ id: 'trend-defects', title: 'Defects per week', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: [{ name: 'Defects', data: trend(qd), type: 'bar' }], yName: 'Defects', xName: 'Week', drill: { param: 'week' } }),
    K.lineChart({ id: 'trend-compliance', title: 'Compliance cases per week', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: [{ name: 'Cases', data: trend(qc), type: 'bar' }], marks: ct !== null ? [{ name: 'Target', value: ww.weeks.map(w => ct * C.workingDays(w.start, w.end, ctx.cfg.workDays)), color: '#16a34a' }] : [], yName: 'Cases', xName: 'Week', drill: { param: 'week' } }),
    K.lineChart({ id: 'trend-safety', title: 'Safety cases per week', x: ww.weeks.map(w => w.label), keys: ww.weeks.map(w => w.key), series: [{ name: 'All', data: trend(qs), type: 'bar' }, { name: 'Assembly', data: trend(qs, { sql: "department='Assembly'" }) }], yName: 'Cases', xName: 'Week', drill: { param: 'week' } }),
  ];
  // top 3 issues: largest Pareto items across segments
  const cand = [];
  const dn = qd.by('defect_name', P); if (dn[0]) dn.slice(0, 2).forEach(x => cand.push({ seg: 'Defects', name: x.name, value: x.value, total: d.value, link: `/defects?defect=${encodeURIComponent(x.name)}` }));
  const cv = qc.by('violation', P); if (cv[0]) cv.slice(0, 2).forEach(x => cand.push({ seg: 'Compliance', name: x.name, value: x.value, total: c.value, link: `/compliance?defect=${encodeURIComponent(x.name)}` }));
  items.slice(0, 2).forEach(x => cand.push({ seg: 'Safety', name: x.name, value: x.value, total: s.value, link: `/safety/items?defect=${encodeURIComponent(x.name)}` }));
  const top3 = cand.map(x => ({ ...x, share: x.total ? x.value / x.total * 100 : 0 })).sort((a, b) => b.share - a.share).slice(0, 3)
    .map(x => ({ ...x, text: `${x.seg}: ${x.name} is ${pct(x.share)} of ${x.seg.toLowerCase() === 'defects' ? 'defects' : x.seg.toLowerCase() + ' cases'} in ${P.short} (${f0(x.value)} of ${f0(x.total)}).` }));
  if (czcf.value > 0) top3.unshift({ seg: 'Defects', name: 'CZCF', value: czcf.value, total: d.value, share: null, red: true, link: '/defects/czcf', text: `CZCF: ${f0(czcf.value)} past concern defect${czcf.value > 1 ? 's' : ''} repeated in ${P.short} (target 0).` });
  // cross-segment by facility
  const fd = toMap(qd.by('facility', P)), fc = toMap(qc.by('facility', P)), fs = toMap(qs.by('facility', P));
  const fm = toMap(qd.by('facility', P, { sql: 'is_mislocation=1' })), fcr = toMap(qd.by('facility', P, { sql: 'is_critical=1' })), fz = toMap(qd.by('facility', P, { sql: 'cpg=1' }));
  const facs = ctx.facilities.map(x => x.name).filter(n => fd.has(n) || fc.has(n) || fs.has(n));
  for (const n of [...fd.keys(), ...fc.keys()]) if (!facs.includes(n)) facs.push(n);
  const tD = C.sum([...fd.values()]) || 1, tC = C.sum([...fc.values()]) || 1, tS = C.sum([...fs.values()]) || 1;
  const cross = facs.map(n => { const a = (fd.get(n) || 0) / tD * 100, b = (fc.get(n) || 0) / tC * 100, cc = (fs.get(n) || 0) / tS * 100; return { name: n, defects: fd.get(n) || 0, mis: fm.get(n) || 0, critical: fcr.get(n) || 0, czcf: fz.get(n) || 0, compliance: fc.get(n) || 0, safety: fs.get(n) || 0, sd: C.round(a, 1), sc: C.round(b, 1), ss: C.round(cc, 1), score: C.round((a + b + cc) / 3, 1) }; }).sort((x, y) => y.score - x.score);
  if (cross[0]) cross[0].worst = true;
  const missing = ['defects', 'compliance', 'safety'].map(k => [k, cross.filter(x => !x[k]).map(x => x.name)]).filter(([, l]) => l.length);
  charts.push(K.stackedChart({ id: 'cross', title: `Share of each segment per facility, ${P.short}`, x: cross.map(x => x.name), keys: cross.map(x => x.name), stacks: [{ name: 'Defects %', data: cross.map(x => x.sd), nostack: true }, { name: 'Compliance %', data: cross.map(x => x.sc), nostack: true }, { name: 'Safety %', data: cross.map(x => x.ss), nostack: true }], yName: '% of segment total', xName: 'Facility', drill: { param: 'fac' }, wide: true, analysis: cross[0] ? `Weakest facility in ${P.short}: ${cross[0].name}, with ${pct(cross[0].sd)} of defects, ${pct(cross[0].sc)} of compliance cases and ${pct(cross[0].ss)} of safety cases (average share ${pct(cross[0].score)}).${missing.length ? ' No records: ' + missing.map(([k, l]) => `${k} for ${l.join(', ')}`).join('; ') + '.' : ''}` : null }));
  charts.push(K.tableChart({ id: 'cross-table', title: `Defects, compliance and safety per facility, ${P.short}`, columns: [{ key: 'name', label: 'Facility', drill: 'fac' }, { key: 'defects', label: 'Defects', type: 'num' }, { key: 'mis', label: 'Mislocation', type: 'num' }, { key: 'critical', label: 'Critical', type: 'num' }, { key: 'czcf', label: 'CZCF', type: 'num', redIfPositive: true }, { key: 'compliance', label: 'Compliance cases', type: 'num' }, { key: 'safety', label: 'Safety cases', type: 'num' }, { key: 'score', label: 'Average share %', type: 'num1' }], rows: cross, note: 'Safety cases are counted only for the production areas that map to a facility. Average share = mean of the facility share in each of the three segments.' }));
  return { title: 'Management summary', segment: 'home', rows, top3, cards: rows.flatMap(r => r.cards), charts };
}

// ---------- dispatcher ----------
const PAGES = {
  'home': ctx => homePage(ctx),
  'defects': ctx => defectsPage(ctx, 'all'),
  'defects/critical': ctx => defectsPage(ctx, 'critical'),
  'defects/czcf': ctx => defectsPage(ctx, 'czcf'),
  'defects/rework': ctx => defectsPage(ctx, 'rework'),
  'defects/mislocation': ctx => mislocationPage(ctx, ctx.q.tab || 'total'),
  'compliance': ctx => compliancePage(ctx, 'overview'),
  'compliance/operators': ctx => complianceOperators(ctx, false),
  'compliance/new-operators': ctx => complianceOperators(ctx, true),
  'compliance/team-leaders': ctx => complianceTeamLeaders(ctx),
  'compliance/camera': ctx => compliancePage(ctx, 'camera'),
  'safety': ctx => safetyPage(ctx, 'overview'),
  'safety/areas': ctx => safetyPage(ctx, 'areas'),
  'safety/departments': ctx => safetyPage(ctx, 'departments'),
  'safety/items': ctx => safetyPage(ctx, 'items'),
};

function buildPage(db, id, q) {
  const fn = PAGES[id];
  if (!fn) return null;
  const ctx = makeCtx(db, q);
  const page = fn(ctx);
  const seg = page.segment === 'home' ? null : page.segment;
  const hasData = seg ? !!ctx.bounds.seg[seg].b : !!ctx.bounds.max;
  page.charts = (page.charts || []).filter(Boolean);
  return { id, ...page, period: ctx.period, compare: ctx.compare, filters: q, notes: ctx.notes, hasData, colors: ctx.colors, generated: new Date().toISOString() };
}

// ---------- records ----------
const REC_COLS = {
  defects: [['date', 'Date'], ['week_key', 'Week'], ['shift', 'Shift'], ['team_leader', 'Team leader'], ['facility', 'Facility'], ['line', 'Assembly line'], ['found_at', 'Defect found at'], ['audit', 'Audit'], ['defect_name', 'Defect name'], ['defect_code', 'Code'], ['produced_at', 'Produced at'], ['qty', 'Qty'], ['operator', 'Operator'], ['cpg', 'CZCF'], ['critical_type', 'Critical type'], ['is_rework', 'Rework'], ['connector_no', 'Connector'], ['circuit_no', 'Circuit'], ['yellow_card', 'Yellow card'], ['defect_name_raw', 'Defect name (file)']],
  compliance: [['date', 'Date'], ['week_key', 'Week'], ['shift', 'Shift'], ['source', 'Source'], ['facility', 'Facility'], ['line', 'Assembly line'], ['team_leader', 'Team leader'], ['violation', 'Violation'], ['operator', 'Operator'], ['qty', 'Cases'], ['report_no', 'Report No.'], ['time', 'Time'], ['found_at', 'Found at'], ['station_no', 'Station NO'], ['jig', 'JIG'], ['patroller', 'Patroller'], ['comment_en', 'Comment (English)'], ['justification2_en', 'Justification2 (English)'], ['justification_en', 'Justification (English)'], ['comment', 'Comment (original)'], ['justification2', 'Justification2 (original)'], ['justification', 'Justification (original)']],
  safety: [['date', 'Date'], ['week_key', 'Week'], ['shift', 'Shift'], ['department', 'Department'], ['area', 'Area'], ['facility', 'Facility'], ['location', 'Location'], ['team', 'Team'], ['item', 'Non-compliance item (English)'], ['operator', 'Operator'], ['notes_en', 'Notes (English)'], ['item_raw', 'Item (Arabic original)'], ['notes', 'Notes (Arabic original)']],
};
const RTL_COLS = new Set(['item_raw', 'notes', 'comment', 'justification', 'justification2']);
const EN_COLS = { notes_en: 'notes', comment_en: 'comment', justification_en: 'justification', justification2_en: 'justification2' };

function records(db, q) {
  const seg = SEG[q.seg] ? q.seg : 'defects';
  const settings = DB.getSettings(db);
  const { period } = resolvePeriod(q, dataBounds(db), settings.week);
  const w = where(seg, period, { ...q, _lineOnly: !settings.complianceIncludeCamera }, q.subset || 'all');
  const cols = REC_COLS[seg];
  const keys = cols.map(c => c[0]).filter(k => !EN_COLS[k]);
  let sql = `FROM ${SEG[seg].table} WHERE ${w.sql}`; const params = [...w.params];
  if (q.q) { const t = `%${q.q}%`; sql += ` AND (${keys.map(k => `CAST(${k} AS TEXT) LIKE ?`).join(' OR ')})`; params.push(...keys.map(() => t)); }
  if (q.day) { /* period already single day */ }
  const total = db.prepare(`SELECT COUNT(*) n, COALESCE(${SEG[seg].measure},0) v ${sql}`).get(...params);
  const sort = keys.includes(q.sort) ? q.sort : 'date';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const size = q.size === 'all' ? 200000 : Math.min(500, Number(q.size) || 50);
  const page = Math.max(1, Number(q.page) || 1);
  const rows = db.prepare(`SELECT ${keys.join(',')} ${sql} ORDER BY ${sort} ${dir}, id LIMIT ${size} OFFSET ${(page - 1) * size}`).all(...params);
  for (const r of rows) {
    if (r.week_key) r.week_key = 'WK' + (r.week_key % 100); if ('cpg' in r) r.cpg = r.cpg ? 'Yes' : 'No'; if ('is_rework' in r) r.is_rework = r.is_rework ? 'Yes' : 'No';
    for (const [en, src] of Object.entries(EN_COLS)) if (src in r) r[en] = TR.hasArabic(r[src]) ? TR.english(db, r[src]) : r[src];
  }
  return { seg, period, total: total.n, quantity: total.v, page, size, columns: cols.map(([key, label]) => ({ key, label, rtl: RTL_COLS.has(key) })), rows };
}

module.exports = { buildPage, records, PAGES, makeCtx, REC_COLS };
