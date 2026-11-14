'use strict';
// Chart specifications sent to the browser. Every chart carries the table behind it (for "view data" and Excel).
const C = require('./calc');
const { dShort, dLabel } = require('./query');

const f0 = n => C.fmt(n, 0);
const f1 = n => C.fmt(n, 1);
const pct = n => (n === null || n === undefined ? '–' : `${C.fmt(n, 1)}%`);

function lineChart({ id, title, x, keys, series, marks = [], yName, xName = '', type = 'line', analysis, drill, wide, note, labels = true }) {
  const table = { columns: [xName || 'Period', ...series.map(s => s.name), ...marks.map(m => m.name)], rows: x.map((lab, i) => [keys ? keys[i] : lab, ...series.map(s => s.data[i]), ...marks.map(m => (Array.isArray(m.value) ? m.value[i] : m.value))]) };
  return { id, type, title, x, keys, series, marks, yName, xName, analysis, drill, wide, note, labels, table };
}

function barChart({ id, title, items, yName, xName = '', colorBy, drill, analysis, horizontal, limit = 0, note, extraCols }) {
  const list = limit ? items.slice(0, limit) : items;
  const table = { columns: [xName || 'Name', yName || 'Value', ...(extraCols ? extraCols.map(c => c.label) : [])], rows: items.map(i => [i.name, i.value, ...(extraCols ? extraCols.map(c => i[c.key]) : [])]) };
  return { id, type: 'bar', title, x: list.map(i => i.name), keys: list.map(i => i.key || i.name), series: [{ name: yName, data: list.map(i => i.value) }], colorBy, drill, analysis, horizontal: horizontal ?? list.length > 8, yName, xName, note, table, more: limit && items.length > limit ? items.length - limit : 0 };
}

function stackedChart({ id, title, x, keys, stacks, yName, xName = '', analysis, drill, colorBy, wide, horizontal }) {
  const table = { columns: [xName || 'Period', ...stacks.map(s => s.name), 'Total'], rows: x.map((lab, i) => [keys ? keys[i] : lab, ...stacks.map(s => s.data[i]), C.sum(stacks.map(s => s.data[i]))]) };
  return { id, type: 'stacked', title, x, keys, series: stacks, yName, xName, analysis, drill, colorBy, wide, horizontal, table };
}

function paretoChart({ id, title, items, yName, xName, drill, alt, max = 20, subject, period }) {
  const p = C.pareto(items, max);
  const total = C.sum(items.map(i => i.value));
  let analysis = null;
  if (p.length) {
    const top = p[0]; const n80 = p.findIndex(i => i.cumPct >= 80) + 1;
    analysis = `${top.name} is ${pct(top.share)} of ${subject} in ${period} (${f0(top.value)} of ${f0(total)}).` + (n80 > 0 ? ` The top ${n80} item${n80 > 1 ? 's' : ''} make ${pct(p[n80 - 1].cumPct)} of the total.` : '');
  }
  const table = { columns: [xName || 'Name', yName || 'Value', 'Share %', 'Cumulative %', ...(alt ? ['Original text'] : [])], rows: p.map(i => [i.name, i.value, C.round(i.share, 1), C.round(i.cumPct, 1), ...(alt ? [alt[i.name] || ''] : [])]) };
  return { id, type: 'pareto', title, x: p.map(i => i.name), keys: p.map(i => (i.name === 'Others' ? null : i.name)), values: p.map(i => i.value), cum: p.map(i => C.round(i.cumPct, 1)), alt, yName, xName, drill, analysis, wide: true, table };
}

function heatmapChart({ id, title, rows, cols, colLabels, get, yName, xName, drill, analysis, rowDrill }) {
  const data = []; let max = 0;
  rows.forEach((r, yi) => cols.forEach((c, xi) => { const v = get(r, c); if (v) data.push([xi, yi, v]); if (v > max) max = v; }));
  const table = { columns: [yName || '', ...(colLabels || cols), 'Total'], rows: rows.map(r => [r, ...cols.map(c => get(r, c)), C.sum(cols.map(c => get(r, c)))]) };
  return { id, type: 'heatmap', title, x: colLabels || cols, xKeys: cols, y: rows, data, max, yName, xName, drill, rowDrill, analysis, wide: true, table };
}

function imrChart({ id, title, dates, values, spec, analysis, yName, note }) {
  const st = C.imr(values);
  const alerts = values.length >= 2 ? C.ruleAlerts(values, st.mean, st.ucl, st.lcl) : [];
  const flagged = [...C.alertPoints(alerts)];
  const x = dates.map(dShort);
  const table = { columns: ['Date', 'Value', 'Moving range', 'Mean', 'UCL', 'LCL', 'LSL', 'USL', 'Alert'], rows: dates.map((d, i) => [d, values[i], st.mr[i], C.round(st.mean, 2), C.round(st.ucl, 2), C.round(st.lcl, 2), spec && spec.lsl != null ? C.round(spec.lsl, 1) : null, spec && spec.usl != null ? C.round(spec.usl, 1) : null, alerts.filter(a => i >= a.from && i <= a.to).map(a => a.text).join('; ')]) };
  return {
    id, type: 'imr', title, x, keys: dates, values, mr: st.mr, mean: st.mean, ucl: st.ucl, lcl: st.lcl, mrBar: st.mrBar, mrUcl: st.mrUcl, spec, yName,
    alerts: alerts.map(a => ({ ...a, fromDate: dates[a.from], toDate: dates[a.to] })), flagged, wide: true, note,
    analysis: analysis || (values.length ? `Mean ${f1(st.mean)} per day, UCL ${f1(st.ucl)}, LCL ${f1(st.lcl)} (average moving range ${f1(st.mrBar)}, ${values.length} days). ${alerts.length ? alerts.length + ' rule alert' + (alerts.length > 1 ? 's' : '') + ' found.' : 'No rule alerts: the process is in statistical control.'}` : null),
    table,
  };
}

function tableChart({ id, title, columns, rows, analysis, drill, wide = true, note, empty }) {
  return { id, type: 'table', title, columns, rows, analysis, drill, wide, note, empty, table: { columns: columns.map(c => c.label), rows: rows.map(r => columns.map(c => r[c.key])) } };
}

function donutChart({ id, title, items, analysis }) {
  return { id, type: 'donut', title, data: items.map(i => ({ name: i.name, value: i.value })), analysis, table: { columns: ['Name', 'Value', 'Share %'], rows: items.map(i => [i.name, i.value, C.round(i.value / (C.sum(items.map(x => x.value)) || 1) * 100, 1)]) } };
}

/** Analysis text for a ranked breakdown, with change versus the comparison period. */
function rankText(items, prevMap, subject, what, period, cmpLabel) {
  if (!items.length) return null;
  const total = C.sum(items.map(i => i.value));
  const top = items[0];
  let s = `${top.name} has the most ${subject} in ${period}: ${f0(top.value)} of ${f0(total)} (${pct(top.value / total * 100)}).`;
  if (prevMap && cmpLabel) {
    const pv = prevMap.get(top.name) || 0; const ch = C.pctChange(top.value, pv);
    s += ` Versus ${cmpLabel}: ${pv ? `${f0(pv)} → ${f0(top.value)} (${ch.pct >= 0 ? '+' : ''}${f1(ch.pct)}%)` : `0 → ${f0(top.value)}`}.`;
    let bestRise = null;
    for (const i of items) { const p2 = prevMap.get(i.name) || 0; const d = i.value - p2; if (!bestRise || d > bestRise.d) bestRise = { name: i.name, d, p2, v: i.value }; }
    if (bestRise && bestRise.d > 0 && bestRise.name !== top.name) s += ` Largest rise: ${bestRise.name} (${f0(bestRise.p2)} → ${f0(bestRise.v)}).`;
  }
  if (items.length > 1) s += ` ${items.length} ${what} in total.`;
  return s;
}

function trendText(dates, values, unit, labelFn = dLabel) {
  if (!values.length) return null;
  let hi = 0, lo = 0;
  values.forEach((v, i) => { if (v > values[hi]) hi = i; if (v < values[lo]) lo = i; });
  return `Average ${f1(C.mean(values))} ${unit} per point over ${values.length} points. Highest: ${labelFn(dates[hi])} (${f0(values[hi])}); lowest: ${labelFn(dates[lo])} (${f0(values[lo])}).`;
}

module.exports = { lineChart, barChart, stackedChart, paretoChart, heatmapChart, imrChart, tableChart, donutChart, rankText, trendText, f0, f1, pct };
