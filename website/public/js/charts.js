// Renders the chart specs sent by the server with ECharts, plus tables, alerts and the panel frame (PNG / data / Excel).
import { esc, fmt, fmtAuto, el, modal, t } from './util.js';

// SEWS-E indigo and teal first, then distinct supporting colours
const PALETTE = ['#1C1D96', '#00808C', '#f59e0b', '#e11d48', '#7c3aed', '#16a34a', '#0ea5e9', '#a16207', '#db2777', '#64748b', '#84cc16', '#2E008B'];
const live = new Set();
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

window.addEventListener('resize', () => { for (const c of live) if (!c.isDisposed()) c.resize(); });
export function disposeAll() { for (const c of live) if (!c.isDisposed()) c.dispose(); live.clear(); }
export function redrawAll() { for (const c of live) if (!c.isDisposed() && c.__spec) { const s = c.__spec, ctx = c.__ctx; c.setOption(option(s, ctx), true); } }

function base() {
  const text = css('--text'), muted = css('--muted'), border = css('--border');
  return {
    textStyle: { fontFamily: 'Segoe UI, system-ui, Arial', color: text },
    grid: { left: 12, right: 18, top: 36, bottom: 12, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: v => (typeof v === 'number' ? fmtAuto(v) : v) },
    legend: { top: 4, textStyle: { color: muted }, type: 'scroll' },
    _axis: { axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: border, type: 'dashed' } }, nameTextStyle: { color: muted } },
  };
}
const ax = (b, o) => ({ ...b._axis, ...o, axisLabel: { ...b._axis.axisLabel, ...(o.axisLabel || {}) } });

function colorFor(name, i, ctx, colorBy) { if (colorBy === 'facility' && ctx.colors && ctx.colors[name]) return ctx.colors[name]; return colorBy === 'facility' ? '#94a3b8' : PALETTE[i % PALETTE.length]; }
function shortLabel(s, n = 22) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function markSeries(marks, n) {
  return (marks || []).filter(m => m.value !== null && m.value !== undefined).map(m => ({
    name: m.name, type: 'line', data: Array.isArray(m.value) ? m.value : Array(n).fill(m.value), symbol: 'none', lineStyle: { type: 'dashed', width: 2, color: m.color }, itemStyle: { color: m.color }, z: 5,
    endLabel: { show: true, formatter: `${m.name}`, color: m.color, fontSize: 11 },
  }));
}

export function option(s, ctx = {}) {
  const b = base();
  const n = (s.x || []).length;
  const showLabels = n <= 16;
  const rotate = n > 8 ? 35 : 0;
  if (s.type === 'line') {
    const series = s.series.map((sr, i) => ({ name: sr.name, type: sr.type || 'line', data: sr.data, smooth: false, symbolSize: 6, itemStyle: { color: sr.color || PALETTE[i % PALETTE.length] }, label: { show: showLabels && s.series.length <= 2 && s.labels !== false, position: 'top', fontSize: 11, formatter: p => fmtAuto(p.value) }, barMaxWidth: 46 }));
    return { ...b, xAxis: ax(b, { type: 'category', data: s.x, name: '', axisLabel: { rotate, interval: 'auto' } }), yAxis: ax(b, { type: 'value', name: s.yName, nameLocation: 'end' }), series: [...series, ...markSeries(s.marks, n)], legend: { ...b.legend, show: series.length + (s.marks || []).length > 1 } };
  }
  if (s.type === 'bar' || s.type === 'stacked') {
    const horiz = s.horizontal;
    const cat = { type: 'category', data: s.x, axisLabel: { rotate: horiz ? 0 : rotate, formatter: v => shortLabel(v, horiz ? 28 : 16), interval: 0 }, inverse: horiz };
    const val = { type: 'value', name: s.yName };
    const series = s.series.map((sr, i) => ({
      name: sr.name, type: 'bar', stack: s.type === 'stacked' && !sr.nostack ? 'a' : undefined, barMaxWidth: 46,
      data: s.type === 'bar' && s.colorBy ? sr.data.map((v, j) => ({ value: v, itemStyle: { color: colorFor(s.x[j], j, ctx, s.colorBy) } })) : sr.data,
      itemStyle: { color: s.type === 'stacked' ? colorFor(sr.name, i, ctx, s.colorBy) : (s.colorBy ? undefined : PALETTE[0]) },
      label: { show: (s.type === 'bar' && n <= 30) || (s.type === 'stacked' && n <= 12 && s.series.length <= 4), position: s.type === 'stacked' && !sr.nostack ? 'inside' : horiz ? 'right' : 'top', fontSize: 11, formatter: p => (p.value ? fmtAuto(typeof p.value === 'object' ? p.value.value : p.value) : '') },
    }));
    const h = horiz ? { yAxis: ax(b, cat), xAxis: ax(b, val) } : { xAxis: ax(b, cat), yAxis: ax(b, val) };
    return { ...b, ...h, series, legend: { ...b.legend, show: s.series.length > 1 }, tooltip: { ...b.tooltip, axisPointer: { type: 'shadow' } } };
  }
  if (s.type === 'pareto') {
    return {
      ...b, legend: { ...b.legend, show: true },
      tooltip: { ...b.tooltip, formatter: ps => { const i = ps[0].dataIndex; const alt = s.alt && s.alt[s.x[i]]; return `<b>${esc(s.x[i])}</b>${alt ? `<div dir="rtl" style="max-width:320px;white-space:normal">${esc(alt)}</div>` : ''}<br>${esc(s.yName || 'Value')}: ${fmt(s.values[i])}<br>Cumulative: ${fmt(s.cum[i], 1)}%`; } },
      xAxis: ax(b, { type: 'category', data: s.x, axisLabel: { rotate: n > 6 ? 35 : 0, interval: 0, formatter: v => shortLabel(v, 18) } }),
      yAxis: [ax(b, { type: 'value', name: s.yName }), ax(b, { type: 'value', name: 'Cumulative %', min: 0, max: 100, splitLine: { show: false }, axisLabel: { formatter: '{value}%' } })],
      series: [
        { name: s.yName || 'Value', type: 'bar', data: s.values, itemStyle: { color: PALETTE[0] }, barMaxWidth: 46, label: { show: n <= 20, position: 'top', fontSize: 11, formatter: p => fmt(p.value) } },
        { name: 'Cumulative %', type: 'line', yAxisIndex: 1, data: s.cum, itemStyle: { color: PALETTE[1] }, symbolSize: 6, label: { show: n <= 10, formatter: p => fmt(p.value, 0) + '%', fontSize: 10, position: 'top' } },
        { name: '80%', type: 'line', yAxisIndex: 1, data: Array(n).fill(80), symbol: 'none', lineStyle: { type: 'dotted', color: '#94a3b8' }, tooltip: { show: false } },
      ],
    };
  }
  if (s.type === 'heatmap') {
    return {
      ...b, grid: { ...b.grid, top: 10, bottom: 50 }, legend: { show: false },
      tooltip: { trigger: 'item', formatter: p => `${esc(s.y[p.value[1]])} · ${esc(s.x[p.value[0]])}: <b>${fmt(p.value[2])}</b>` },
      xAxis: ax(b, { type: 'category', data: s.x, splitArea: { show: true }, axisLabel: { rotate: s.x.length > 7 ? 40 : 0, interval: 0, formatter: v => shortLabel(v, 16) } }),
      yAxis: ax(b, { type: 'category', data: s.y, inverse: true, axisLabel: { formatter: v => shortLabel(v, 30), interval: 0 } }),
      visualMap: { min: 0, max: Math.max(1, s.max), calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, inRange: { color: ['#eef6ff', '#93c5fd', '#2563eb', '#1e3a8a'] }, textStyle: { color: css('--muted') } },
      series: [{ type: 'heatmap', data: s.data, label: { show: s.x.length * s.y.length <= 400, fontSize: 10, formatter: p => fmt(p.value[2]) }, emphasis: { itemStyle: { borderColor: '#000', borderWidth: 1 } } }],
    };
  }
  if (s.type === 'donut') {
    return { ...b, tooltip: { trigger: 'item', formatter: p => `${esc(p.name)}: <b>${fmt(p.value)}</b> (${fmt(p.percent, 1)}%)` }, legend: { ...b.legend, show: true }, series: [{ type: 'pie', radius: ['45%', '70%'], center: ['50%', '56%'], data: s.data.map((d, i) => ({ ...d, itemStyle: { color: PALETTE[i % PALETTE.length] } })), label: { formatter: p => `${p.name}\n${fmt(p.value)} (${fmt(p.percent, 1)}%)`, color: css('--text') } }] };
  }
  if (s.type === 'imr') {
    const flagged = new Set(s.flagged || []);
    const lines = [['Mean', s.mean, '#16a34a', 'solid'], ['UCL', s.ucl, '#dc2626', 'dashed'], ['LCL', s.lcl, '#dc2626', 'dashed']];
    if (s.spec && s.spec.lsl !== null && s.spec.lsl !== undefined) lines.push(['LSL', s.spec.lsl, '#7c3aed', 'dotted']);
    if (s.spec && s.spec.usl !== null && s.spec.usl !== undefined) lines.push(['USL', s.spec.usl, '#7c3aed', 'dotted']);
    const nn = s.values.length;
    return {
      ...b, legend: { ...b.legend, show: true },
      grid: [{ left: 12, right: 60, top: 34, height: '52%', containLabel: true }, { left: 12, right: 60, top: '72%', bottom: 10, containLabel: true }],
      xAxis: [ax(b, { type: 'category', data: s.x, gridIndex: 0, axisLabel: { show: false } }), ax(b, { type: 'category', data: s.x, gridIndex: 1, axisLabel: { rotate: nn > 8 ? 35 : 0 } })],
      yAxis: [ax(b, { type: 'value', name: s.yName || 'Individual values', gridIndex: 0, scale: true }), ax(b, { type: 'value', name: 'Moving range', gridIndex: 1 })],
      series: [
        { name: 'Daily value', type: 'line', data: s.values.map((v, i) => ({ value: v, itemStyle: { color: flagged.has(i) ? '#dc2626' : '#2563eb' }, symbolSize: flagged.has(i) ? 11 : 6 })), lineStyle: { color: '#2563eb' }, label: { show: nn <= 20, position: 'top', fontSize: 10, formatter: p => fmt(p.value) } },
        ...lines.map(([nm, v, c, ty]) => ({ name: `${nm} ${fmt(v, 1)}`, type: 'line', data: Array(nn).fill(Math.round(v * 10) / 10), symbol: 'none', lineStyle: { color: c, type: ty, width: 1.6 }, itemStyle: { color: c } })),
        { name: 'Moving range', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: s.mr, itemStyle: { color: '#94a3b8' }, barMaxWidth: 20 },
        { name: `MR UCL ${fmt(s.mrUcl, 1)}`, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: Array(nn).fill(Math.round(s.mrUcl * 10) / 10), symbol: 'none', lineStyle: { color: '#dc2626', type: 'dashed' }, itemStyle: { color: '#dc2626' } },
      ],
    };
  }
  return b;
}

/** Draws one chart and wires drill-down clicks. */
export function draw(div, s, ctx) {
  const c = echarts.init(div, null, { renderer: 'canvas' });
  c.__spec = s; c.__ctx = ctx;
  c.setOption(option(s, ctx));
  live.add(c);
  c.on('click', p => {
    if (!ctx.onDrill) return;
    if (s.type === 'heatmap') { const yv = s.y[p.value[1]]; if (s.drill && s.drill.param) ctx.onDrill(s.drill.param, yv); return; }
    if (s.type === 'imr') { ctx.onDrill('day', s.keys[p.dataIndex]); return; }
    if (!s.drill || !s.drill.param) return;
    const key = s.keys ? s.keys[p.dataIndex] : s.x[p.dataIndex];
    if (key === null || key === undefined) return;
    ctx.onDrill(s.drill.param, key);
  });
  if (s.drill || s.type === 'heatmap' || s.type === 'imr') div.style.cursor = 'pointer';
  return c;
}

// ---------- tables ----------
export function tableHTML(s) {
  const cols = s.columns;
  const head = cols.map(c => `<th class="${/num|delta/.test(c.type || '') ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = s.rows.map((r, i) => {
    const click = r._drill || cols.some(c => c.drill) ? ' clickable' : '';
    const cls = `${click}${r.total ? ' total' : ''}${r.worst ? ' worst' : ''}`;
    return `<tr class="${cls}" data-i="${i}">` + cols.map(c => {
      const v = r[c.key];
      if (c.type === 'num') return `<td class="num${c.redIfPositive && v > 0 ? ' pos-red' : ''}">${fmt(v)}</td>`;
      if (c.type === 'num1') return `<td class="num">${fmt(v, 1)}</td>`;
      if (c.type === 'delta') return `<td class="num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '▲ +' : v < 0 ? '▼ ' : ''}${fmt(v)}</td>`;
      if (c.type === 'deltapct') return `<td class="num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v === null || v === undefined ? 'new' : (v > 0 ? '▲ +' : v < 0 ? '▼ ' : '') + fmt(v, 1) + '%'}</td>`;
      return `<td class="${c.rtl ? 'rtl' : ''}" ${c.rtl ? 'dir="rtl"' : ''}>${esc(v ?? '')}</td>`;
    }).join('') + '</tr>';
  }).join('');
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
export function plainTableHTML(table) {
  const isNum = table.rows.length ? table.columns.map((_, j) => table.rows.every(r => r[j] === null || r[j] === '' || typeof r[j] === 'number')) : [];
  return `<table class="tbl"><thead><tr>${table.columns.map((c, j) => `<th class="${isNum[j] ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r => `<tr>${r.map((v, j) => `<td class="${isNum[j] ? 'num' : ''}" ${typeof v === 'string' && /[؀-ۿ]/.test(v) ? 'dir="rtl"' : ''}>${typeof v === 'number' ? fmtAuto(v) : esc(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------- panel ----------
/** ctx: { colors, period, onDrill(param,value), onRecords(filters), exportChart(spec) } */
export function panel(s, ctx, opts = {}) {
  const wide = s.wide || s.type === 'imr' || s.type === 'multiples' || opts.wide;
  const p = el(`<section class="panel${wide ? ' wide' : ''}" id="chart-${esc(s.id)}" aria-label="${esc(s.title)}">
    <div class="panel-head"><div><h3>${esc(s.title)}</h3><div class="sub">${esc(ctx.period || '')}</div></div>
      <div class="panel-actions">
        ${['table', 'empty'].includes(s.type) ? '' : `<button data-act="png" title="Download PNG">${t('png')}</button>`}
        ${s.table && s.type !== 'table' ? `<button data-act="data" title="View the data behind the chart">${t('viewData')}</button>` : ''}
        ${s.table ? `<button data-act="xlsx" title="Export this data to Excel">${t('excel')}</button>` : ''}
        ${opts.noEnlarge || s.type === 'empty' ? '' : `<button data-act="big" title="${t('enlarge')}">⤢</button>`}
      </div></div></section>`);
  const body = document.createElement('div');
  p.append(body);
  let chart = null;
  if (s.type === 'empty') body.innerHTML = `<div class="empty">${esc(s.note || 'No data')}</div>`;
  else if (s.type === 'table') {
    if (!s.rows.length) body.innerHTML = `<div class="empty">${esc(s.empty || 'No rows for this period.')}</div>`;
    else {
      body.className = 'tbl-wrap'; body.innerHTML = tableHTML(s);
      body.querySelector('tbody').addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr) return; const r = s.rows[+tr.dataset.i]; if (!r || r.total) return;
        if (r._drill && ctx.onRecords) return ctx.onRecords(r._drill);
        const c = s.columns.find(c => c.drill); if (c && ctx.onDrill) ctx.onDrill(c.drill, r[c.key]);
      });
    }
  } else if (s.type === 'multiples') {
    body.className = 'multiples';
    for (const m of s.charts) {
      const box = el(`<div class="mini"><h4>${esc(m.title)}</h4><div class="chart"></div><p>${esc(m.analysis || '')}</p></div>`);
      body.append(box);
      setTimeout(() => draw(box.querySelector('.chart'), { ...m, labels: false }, ctx), 0);
    }
  } else {
    const div = document.createElement('div');
    div.className = 'chart' + (s.type === 'imr' ? ' imr' : s.type === 'heatmap' && (s.y || []).length > 10 ? ' tall' : '');
    if (s.type === 'heatmap') div.style.height = Math.max(280, Math.min(900, 60 + (s.y.length * 26))) + 'px';
    if (s.type === 'bar' && s.horizontal) div.style.height = Math.max(280, Math.min(900, 50 + s.x.length * 24)) + 'px';
    body.append(div);
    setTimeout(() => { if (div.isConnected) chart = draw(div, s, ctx); }, 0);
  }
  if (s.type === 'imr') {
    const ul = document.createElement('ul'); ul.className = 'alerts';
    ul.innerHTML = s.alerts.length ? s.alerts.map(a => `<li>${esc(a.text)}: ${esc(a.fromDate === a.toDate ? a.fromDate : a.fromDate + ' to ' + a.toDate)}</li>`).join('') : '<li class="ok">No rule alerts (outside limits, 8 in a row on one side, 6 rising or falling).</li>';
    p.append(ul);
  }
  if (s.note) { const n = document.createElement('div'); n.className = 'panel-note'; n.textContent = s.note; p.append(n); }
  if (s.analysis) { const a = document.createElement('p'); a.className = 'analysis'; a.textContent = s.analysis; p.append(a); }
  if (s.type === 'bar' && s.more) { const n = document.createElement('div'); n.className = 'panel-note'; n.textContent = `Showing the top ${s.x.length}; ${s.more} more in the data table.`; p.append(n); }
  p.querySelector('.panel-actions').addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act; if (!act) return;
    if (act === 'png') {
      const c = chart || (p.querySelector('.chart') && echarts.getInstanceByDom(p.querySelector('.chart')));
      if (s.type === 'multiples') { import('./export.js').then(x => x.multiplesPng(p, s)); return; }
      if (!c) return;
      const a = document.createElement('a'); a.href = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: css('--surface') || '#fff' }); a.download = `${s.title.replace(/[^\w-]+/g, '_')}.png`; a.click();
    }
    if (act === 'data') {
      let v = p.querySelector('.view-data');
      if (v) { v.remove(); return; }
      v = el(`<div class="view-data tbl-wrap"></div>`); v.innerHTML = plainTableHTML(s.table); p.append(v);
    }
    if (act === 'xlsx') import('./export.js').then(x => x.chartToExcel(s, ctx));
    if (act === 'big') { const b = modal(s.title, null); const big = panel({ ...s, wide: true }, ctx, { noEnlarge: true }); b.append(big); const ch = big.querySelector('.chart'); if (ch) ch.style.height = '62vh'; }
  });
  return p;
}
