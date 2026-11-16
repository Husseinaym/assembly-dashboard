// Admin pages: Upload (with validation report and column mapping wizard), Upload history, Settings.
import { api, esc, el, fmt, dLabel, dtLabel, toast, modal, closeModal } from './util.js';
import { S, loadMeta, go } from './app.js';

const TYPE_LABEL = { defects: 'Defects', compliance: 'Compliance', safety: 'Safety', production: 'Production quantities', operators: 'Operator list', ignore: 'Ignore' };
let master = null, fields = null;
async function loadMaster() { master = await api('/api/settings'); fields = fields || await api('/api/fields'); return master; }

// =====================================================================================
// UPLOAD
// =====================================================================================
export async function upload(main) {
  await loadMaster();
  main.innerHTML = '';
  main.append(el(`<div class="page-head"><div><h1>Upload data</h1><div class="period-label">Excel (.xlsx, .xls) or CSV, one or many sheets, any period (daily, weekly, multi-week).</div></div></div>`));
  const dz = el(`<div class="dropzone" tabindex="0" role="button" aria-label="Choose files to upload"><p><b>Drop files here</b> or <button class="btn primary" type="button">Choose files</button></p>
    <p class="muted">Defects file (e.g. 12-11-2026.xlsx), Complaince Data.xlsx, Safety_Compliance_Daily_Report.xlsx, production quantities, operator list with start dates.</p>
    <input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" hidden></div>`);
  const input = dz.querySelector('input'); const list = el('<div style="margin-top:14px"></div>');
  dz.querySelector('button').addEventListener('click', () => input.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); handle([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { handle([...input.files]); input.value = ''; });
  main.append(dz, list);
  async function handle(files) { for (const f of files) { const box = el(`<section class="section"><h2>${esc(f.name)}</h2><div class="loading"><div class="spinner"></div>Reading and checking the file…</div></section>`); list.prepend(box); await analyzeFile(f, box); } }
}

async function analyzeFile(file, box) {
  const fd = new FormData(); fd.append('file', file); fd.append('overrides', '[]');
  try { const a = await api('/api/upload/analyze', { method: 'POST', body: fd }); renderAnalysis(box, a, []); }
  catch (e) { box.innerHTML = `<h2>${esc(file.name)}</h2><div class="note err">${esc(e.message)}</div>`; }
}

function renderAnalysis(box, a, overrides) {
  box.innerHTML = '';
  box.append(el(`<h2>${esc(a.fileName)} <span class="badge">Check before import</span></h2>`));
  // sheets and their roles
  const tpl = master.templates;
  const sheetRows = a.roles.map(r => {
    const o = overrides.find(x => x.sheet === r.sheet);
    const cur = o ? (o.role === 'ignore' ? 'ignore' : o.templateId ? 't' + o.templateId : 'map') : r.role === 'import' ? 't' + r.templateId : r.role === 'unmapped' ? 'map' : 'ignore';
    const opts = `<option value="ignore" ${cur === 'ignore' ? 'selected' : ''}>Ignore this sheet</option>` + tpl.filter(x => x.data_type !== 'ignore').map(x => `<option value="t${x.id}" ${cur === 't' + x.id ? 'selected' : ''}>${esc(TYPE_LABEL[x.data_type] || x.data_type)}: ${esc(x.name)}</option>`).join('') + `<option value="map" ${cur === 'map' ? 'selected' : ''}>Map the columns myself…</option>`;
    const sh = a.book.find(s => s.name === r.sheet);
    return `<tr><td><b>${esc(r.sheet)}</b></td><td class="num">${fmt(r.rows)}</td><td><select data-sheet="${esc(r.sheet)}">${opts}</select></td><td class="muted">${esc(r.reason || (r.template ? 'Recognised layout: ' + r.template : ''))}</td><td class="muted" style="max-width:380px;font-size:11.5px">${esc((sh ? sh.headers : []).slice(0, 14).join(' · '))}</td></tr>`;
  }).join('');
  const sheets = el(`<div><h3>Sheets in the file</h3><div class="tbl-wrap" style="padding:0"><table class="tbl"><thead><tr><th>Sheet</th><th class="num">Rows</th><th>Use as</th><th>Why</th><th>Columns</th></tr></thead><tbody>${sheetRows}</tbody></table></div><div class="wizard"></div></div>`);
  box.append(sheets);
  const wizard = sheets.querySelector('.wizard');
  sheets.querySelectorAll('select[data-sheet]').forEach(sel => sel.addEventListener('change', async () => {
    const sheet = sel.dataset.sheet; const v = sel.value;
    const rest = overrides.filter(x => x.sheet !== sheet);
    if (v === 'map') { mappingWizard(wizard, a, sheet, async mapping => { const ov = [...rest, { sheet, mapping }]; renderAnalysis(box, await api('/api/upload/reanalyze', { method: 'POST', body: { token: a.token, overrides: ov } }), ov); }); return; }
    const ov = [...rest, v === 'ignore' ? { sheet, role: 'ignore' } : { sheet, templateId: Number(v.slice(1)) }];
    box.querySelector('.import-area')?.replaceChildren(el('<div class="loading"><div class="spinner"></div>Checking…</div>'));
    renderAnalysis(box, await api('/api/upload/reanalyze', { method: 'POST', body: { token: a.token, overrides: ov } }), ov);
  }));
  const unmapped = a.roles.filter(r => r.role === 'unmapped' && !overrides.find(o => o.sheet === r.sheet));
  if (unmapped.length) { box.append(el(`<div class="note warn">Sheet ${unmapped.map(u => `"${esc(u.sheet)}"`).join(', ')} has a new layout. Choose a layout in "Use as" or map its columns (the mapping is saved as a template for next time), or ignore it.</div>`)); mappingWizard(wizard, a, unmapped[0].sheet, async mapping => { const ov = [...overrides, { sheet: unmapped[0].sheet, mapping }]; renderAnalysis(box, await api('/api/upload/reanalyze', { method: 'POST', body: { token: a.token, overrides: ov } }), ov); }); }

  const area = el('<div class="import-area"></div>'); box.append(area);
  area.append(validationHTML(a, false));
  // duplicates
  const decisions = {};
  const dup = a.segments.filter(s => s.existing && s.existing.length);
  if (dup.length) {
    const d = el(`<div><h3>Dates already in the database</h3>${dup.map(s => `<div class="note warn"><b>${esc(TYPE_LABEL[s.data_type])}</b>: ${s.existing.length} date${s.existing.length > 1 ? 's' : ''} already loaded (${s.existing.slice(0, 8).map(e => `${dLabel(e.date, false)}: ${fmt(e.n)} rows`).join(', ')}${s.existing.length > 8 ? ', …' : ''}).
      <div class="frow" style="margin-top:6px"><label><input type="radio" name="d-${s.data_type}-${esc(a.token)}" value="replace" checked> Replace those dates with this file (recommended for an updated or re-sent file)</label>
      <label><input type="radio" name="d-${s.data_type}-${esc(a.token)}" value="skip"> Skip those dates (keep what is loaded)</label></div></div>`).join('')}<p class="muted">Either way nothing is counted twice.</p></div>`);
    d.addEventListener('change', e => { const [, type] = e.target.name.split('-'); decisions[type] = e.target.value; });
    area.append(d);
  }
  const canImport = a.book.length && a.segments.some(s => s.records > 0);
  const btns = el(`<div class="frow" style="margin-top:12px"><button class="btn primary" ${canImport ? '' : 'disabled'}>Import</button><button class="btn">Cancel</button>${canImport ? '' : '<span class="muted">Nothing to import: choose what each sheet holds.</span>'}</div>`);
  const [imp, cancel] = btns.querySelectorAll('button');
  cancel.addEventListener('click', () => box.remove());
  imp.addEventListener('click', async () => {
    imp.disabled = true; imp.textContent = 'Importing…';
    try {
      const r = await api('/api/upload/commit', { method: 'POST', body: { token: a.token, overrides, decisions } });
      await loadMeta(); toast(`Imported ${fmt(r.imported)} rows from ${a.fileName}`);
      if (r.fileStored === false) toast('The data was imported, but the original file could not be saved to the private store. Keep your own copy of the file.', true);
      box.innerHTML = ''; box.append(el(`<h2>${esc(a.fileName)} <span class="badge green">Imported</span></h2>`)); box.append(validationHTML(r, true)); box.append(newNamesMapper(r));
      box.append(el(`<div class="frow" style="margin-top:10px"><a class="btn" href="/admin/history" data-link>Upload history</a><a class="btn primary" href="/" data-link>Open the home page</a></div>`));
    } catch (e) { toast(e.message, true); imp.disabled = false; imp.textContent = 'Import'; }
  });
  area.append(btns);
}

function validationHTML(r, done) {
  const sheets = r.sheets.map(s => `<tr><td>${esc(s.sheet)}</td><td>${esc(TYPE_LABEL[s.data_type] || s.data_type)}</td><td class="num">${fmt(s.rows_read)}</td><td class="num">${fmt(s.valid)}</td><td class="num">${fmt(s.quantity)}</td><td class="num ${s.rejected ? 'up' : ''}">${fmt(s.rejected)}</td><td class="num">${fmt(s.duplicates_in_file)}</td><td>${s.date_from ? `${dLabel(s.date_from)} – ${dLabel(s.date_to)}` : '–'}</td><td>${Object.entries(s.reasons || {}).map(([k, v]) => `${esc(k)}: ${v}`).join('<br>') || '–'}</td></tr>`).join('');
  const rej = r.sheets.flatMap(s => (s.rejects || []).map(x => ({ ...x, sheet: s.sheet })));
  const nn = r.newNames || {};
  const nnList = [['New lines', nn.lines], ['New safety areas', nn.areas], ['Names not mapped to a facility', nn.unmappedFacilities], ['New defect names', nn.defects], ['New violations', nn.violations], ['New safety items (no English name yet)', nn.safetyItems]].filter(([, l]) => l && l.length);
  return el(`<div>
    <h3>${done ? 'Validation report' : 'What will be imported'}</h3>
    ${done ? `<div class="kv"><span class="muted">Rows imported</span><b>${fmt(r.imported)}</b><span class="muted">Rows rejected</span><b>${fmt(r.sheets.reduce((s, x) => s + x.rejected, 0))}</b><span class="muted">Rows skipped (dates already loaded)</span><b>${fmt(r.skipped || 0)}</b><span class="muted">Date range covered</span><b>${r.segments.map(s => `${esc(TYPE_LABEL[s.data_type])}: ${s.date_from ? dLabel(s.date_from) + ' – ' + dLabel(s.date_to) : '–'}`).join(' · ')}</b></div>` : ''}
    ${(r.actions || []).map(x => `<div class="note ok">${esc(x)}</div>`).join('')}
    <div class="tbl-wrap" style="padding:0;margin-top:8px"><table class="tbl"><thead><tr><th>Sheet</th><th>Data</th><th class="num">Rows read</th><th class="num">Valid</th><th class="num">Quantity</th><th class="num">Rejected</th><th class="num">Duplicates in file</th><th>Dates</th><th>Rejected because</th></tr></thead><tbody>${sheets || '<tr><td colspan="9" class="muted">No sheet selected for import</td></tr>'}</tbody></table></div>
    ${rej.length ? `<details style="margin-top:6px"><summary>Rejected rows (${rej.length}${rej.length >= 200 ? '+' : ''}) with Excel row numbers</summary><div class="tbl-wrap" style="padding:0;max-height:240px"><table class="tbl"><thead><tr><th>Sheet</th><th class="num">Excel row</th><th>Reason</th></tr></thead><tbody>${rej.map(x => `<tr><td>${esc(x.sheet)}</td><td class="num">${x.row}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    ${(r.warnings || []).map(w => `<div class="note warn" style="margin-top:6px">${esc(w)}</div>`).join('')}
    ${nnList.length ? `<h3>New names found</h3>${nnList.map(([l, list]) => `<div style="margin-bottom:6px"><b>${esc(l)}:</b> ${list.slice(0, 40).map(x => `<span class="chip" style="padding-right:10px;margin:2px">${esc(x.name)} (${fmt(x.count)})</span>`).join('')}</div>`).join('')}` : ''}
  </div>`);
}

/** After import: map new names to existing ones (alias table). */
function newNamesMapper(r) {
  const nn = r.newNames || {}; const box = el('<div></div>');
  const facNames = master.facilities.map(f => f.name);
  const rows = [];
  for (const x of nn.unmappedFacilities || []) rows.push({ kind: 'facility', raw: x.name, count: x.count, options: facNames, label: 'Line / area → facility' });
  for (const x of nn.defects || []) rows.push({ kind: 'defect', raw: x.name, count: x.count, options: [...new Set(master.defectAlias.map(a => a.canonical))].filter(n => n !== x.name), label: 'Defect name → same as' });
  for (const x of nn.violations || []) rows.push({ kind: 'violation', raw: x.name, count: x.count, options: [...new Set(master.violationAlias.map(a => a.canonical))].filter(n => n !== x.name), label: 'Violation → same as' });
  for (const x of nn.safetyItems || []) rows.push({ kind: 'item', raw: x.name, count: x.count, options: null, label: 'Safety item → English name' });
  if (!rows.length) { box.append(el('<div class="note ok">All names are known. Nothing to map.</div>')); return box; }
  box.append(el(`<h3>Map new names (optional)</h3>`));
  const t = el(`<table class="tbl"><thead><tr><th>What</th><th>Name in the file</th><th class="num">Rows</th><th>Map to</th><th></th></tr></thead><tbody>${rows.map((x, i) => `<tr><td class="muted">${esc(x.label)}</td><td ${/[؀-ۿ]/.test(x.raw) ? 'dir="rtl" class="rtl"' : ''}>${esc(x.raw)}</td><td class="num">${fmt(x.count)}</td><td>${x.options ? `<select data-i="${i}"><option value="">Keep as its own name</option>${x.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>` : `<input type="text" data-i="${i}" placeholder="English short name">`}</td><td><button class="btn small" data-b="${i}">Save</button></td></tr>`).join('')}</tbody></table>`);
  t.addEventListener('click', async e => {
    const i = e.target.dataset.b; if (i === undefined) return; const x = rows[+i];
    const v = t.querySelector(`[data-i="${i}"]`).value.trim(); if (!v) return toast('Choose a name first', true);
    try { await api('/api/master/map', { method: 'POST', body: { kind: x.kind, raw: x.raw, target: v } }); toast(`Mapped "${x.raw}" to "${v}"`); e.target.textContent = '✓ Saved'; e.target.disabled = true; } catch (err) { toast(err.message, true); }
  });
  const wrapT = el('<div class="tbl-wrap" style="padding:0"></div>'); wrapT.append(t); box.append(wrapT);
  return box;
}

function guess(target, label, headers) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cands = [label.replace(/\*|\(.*\)/g, ''), target.replace(/_/g, ' ')];
  for (const c of cands) { const h = headers.find(x => norm(x) === norm(c)); if (h) return h; }
  for (const c of cands) { const h = headers.find(x => norm(x).includes(norm(c)) || norm(c).includes(norm(x))); if (h && norm(h).length > 2) return h; }
  return '';
}
function mappingWizard(box, a, sheet, onApply) {
  const sh = a.book.find(s => s.name === sheet); const headers = sh ? sh.headers : [];
  box.innerHTML = '';
  const w = el(`<div class="section" style="margin-top:10px;background:var(--surface-2)"><h3 style="margin-top:0">Column mapping wizard: sheet "${esc(sheet)}"</h3>
    <div class="form-grid"><label class="field"><span>This sheet holds</span><select name="type">${Object.keys(fields).map(k => `<option value="${k}">${TYPE_LABEL[k]}</option>`).join('')}</select></label>
    <label class="field src"><span>Source (compliance)</span><select name="source"><option>Line</option><option>Camera</option></select></label>
    <label class="field"><span>Save as template (name)</span><input type="text" name="save" value="${esc(a.fileName.replace(/\.\w+$/, ''))} - ${esc(sheet)}"></label></div>
    <div class="fields form-grid" style="margin-top:10px"></div>
    <details style="margin-top:8px"><summary>Preview of the first rows</summary><div class="tbl-wrap" style="padding:0"><table class="tbl"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(sh ? sh.preview : []).map(r => `<tr>${r.slice(0, headers.length).map(v => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>
    <div class="frow" style="margin-top:10px"><button class="btn primary" data-a="apply">Apply mapping and check again</button><span class="muted">Fields marked * are required.</span></div></div>`);
  const typeSel = w.querySelector('[name=type]'); const fl = w.querySelector('.fields');
  const drawFields = () => {
    const f = fields[typeSel.value]; w.querySelector('.src').style.display = typeSel.value === 'compliance' ? '' : 'none';
    fl.innerHTML = Object.entries(f).map(([k, label]) => { const g = guess(k, label, headers); return `<label class="field"><span>${esc(label)}</span><select data-f="${k}"><option value="">(not in this file)</option>${headers.map(h => `<option ${h === g ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`; }).join('');
  };
  typeSel.addEventListener('change', drawFields); drawFields();
  w.querySelector('[data-a=apply]').addEventListener('click', () => {
    const f = fields[typeSel.value]; const field_map = {};
    fl.querySelectorAll('select[data-f]').forEach(s => { if (s.value) field_map[s.dataset.f] = s.value; });
    const missing = Object.entries(f).filter(([k, l]) => l.includes('*') && !field_map[k]).map(([, l]) => l.replace('*', ''));
    if (missing.length) return toast('Map the required fields: ' + missing.join(', '), true);
    onApply({ data_type: typeSel.value, field_map, source: typeSel.value === 'compliance' ? w.querySelector('[name=source]').value : null, saveAs: w.querySelector('[name=save]').value.trim() || null });
  });
  box.append(w);
}

// =====================================================================================
// HISTORY
// =====================================================================================
export async function history(main) {
  const list = await api('/api/uploads');
  main.innerHTML = '';
  main.append(el(`<div class="page-head"><div><h1>Upload history</h1><div class="period-label">Every upload, newest first. Source files are kept in the project's Uploads folder, so any number can be traced back to its file.</div></div></div>`));
  if (!list.length) { main.append(el('<div class="empty"><h3>No uploads yet</h3><p><a class="btn primary" href="/admin/upload" data-link>Upload a file</a></p></div>')); return; }
  const t = el(`<div class="section" style="padding:0"><div class="tbl-wrap" style="padding:0;max-height:none"><table class="tbl"><thead><tr><th>#</th><th>File name</th><th>Uploader</th><th>Uploaded</th><th>Segment</th><th class="num">Rows imported</th><th class="num">Rows still active</th><th class="num">Rejected</th><th>Dates covered</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${u.id}</td><td>${esc(u.file_name)}<div class="muted" style="font-size:11px">${esc(u.stored_path || '')}</div></td><td>${esc(u.uploader)}</td><td>${dtLabel(u.uploaded_at)}</td><td>${esc(u.segments)}</td><td class="num">${fmt(u.rows_imported)}</td><td class="num">${fmt(u.rows_active)}${u.rows_active < u.rows_imported ? ' <span class="muted" title="Some dates were replaced by a later upload">(replaced)</span>' : ''}</td><td class="num">${fmt(u.rows_rejected)}</td><td>${u.date_from ? dLabel(u.date_from) + ' – ' + dLabel(u.date_to) : '–'}</td>
      <td style="white-space:nowrap"><button class="btn small" data-r="${u.id}">Report</button> ${u.stored_path ? `<a class="btn small" href="/api/uploads/${u.id}/file">File</a>` : ''} <button class="btn small danger" data-d="${u.id}" data-n="${esc(u.file_name)}" data-c="${u.rows_active}">Delete</button></td></tr>`).join('')}
  </tbody></table></div></div>`);
  t.addEventListener('click', async e => {
    const r = e.target.dataset.r, d = e.target.dataset.d;
    if (r) { const u = await api('/api/uploads/' + r); const b = modal(`Validation report: ${u.file_name}`, null); b.append(validationHTML(u.report, true)); }
    if (d) {
      if (!confirm(`Delete upload #${d} "${e.target.dataset.n}"?\n\nThis removes its ${e.target.dataset.c} rows from the website. The source file stays in the Uploads folder.`)) return;
      try { const x = await api('/api/uploads/' + d, { method: 'DELETE' }); toast(`Deleted: ${fmt(x.removed)} rows removed`); await loadMeta(); history(main); } catch (err) { toast(err.message, true); }
    }
  });
  main.append(t);
}

// =====================================================================================
// SETTINGS
// =====================================================================================
const TABS = [['targets', 'Targets and limits'], ['facilities', 'Areas, lines and mapping'], ['defects', 'Defect names and critical list'], ['names', 'Compliance and safety names'], ['translations', 'Arabic translations'], ['week', 'Week settings'], ['templates', 'Column mapping templates'], ['users', 'Users and access'], ['presentation', 'Presentation'], ['backups', 'Backups']];
const KPIS = [['compliance_per_day', 'Compliance cases per working day'], ['defects_per_day', 'Defects per day'], ['critical_per_day', 'Critical defects per day'], ['czcf_per_day', 'CZCF per day'], ['rework_per_day', 'Rework defects per day'], ['safety_per_day', 'Safety cases per day']];
async function put(url, body, msg = 'Saved') { await api(url, { method: 'PUT', body }); toast(msg); await loadMeta(); await loadMaster(); }

export async function settings(main, tab) {
  await loadMaster();
  tab = tab || new URLSearchParams(location.search).get('tab') || 'targets';
  main.innerHTML = '';
  main.append(el(`<div class="page-head"><div><h1>Settings</h1><div class="period-label">Targets, limits and mapping tables. Changes apply to all stored data at once.</div></div></div>`));
  const tabs = el(`<div class="settings-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" class="${k === tab ? 'active' : ''}" data-t="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>`);
  tabs.addEventListener('click', e => { const k = e.target.dataset.t; if (k) { window.history.replaceState(null, '', '/admin/settings?tab=' + k); settings(main, k); } });
  main.append(tabs);
  const body = el('<div></div>'); main.append(body);
  ({ targets, facilities, defects: defectNames, names, translations, week: weekTab, templates, users, presentation, backups })[tab](body);
}

async function translations(body, st = { q: '', filter: '', page: 1 }) {
  const r = await api(`/api/translations?q=${encodeURIComponent(st.q)}&filter=${st.filter}&page=${st.page}`);
  body.innerHTML = '';
  const sec = el(`<section class="section"><h2>Arabic translations</h2>
    <p class="muted">Every Arabic note and comment is shown in English on the website and in exports, with the Arabic original beside it. The ${fmt(r.total)} texts from your files are translated; new texts in future uploads are translated automatically (offline, using these translations and plant vocabulary) and marked <b>[auto]</b> until you check them here. Saving a row marks it as checked.</p>
    <div class="frow"><input type="search" placeholder="Search Arabic or English…" value="${esc(st.q)}" style="width:280px"><label><input type="checkbox" ${st.filter === 'auto' ? 'checked' : ''}> Only automatic translations to check (${fmt(r.auto)})</label></div>
    <div class="tbl-wrap" style="padding:0;margin-top:8px;max-height:560px"><table class="tbl edit-table"><thead><tr><th>Arabic (from the file)</th><th>English</th><th>Status</th></tr></thead><tbody>
    ${r.rows.map((x, i) => `<tr><td class="rtl" dir="rtl" style="min-width:260px">${esc(x.arabic)}</td><td style="min-width:320px"><input type="text" data-i="${i}" value="${esc(x.english || '')}"></td><td>${x.source === 'auto' ? '<span class="badge red">auto</span>' : '<span class="badge green">checked</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No rows</td></tr>'}
    </tbody></table></div>
    <div class="pager"><button class="btn small" data-p="-1" ${r.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${r.page} of ${Math.max(1, Math.ceil(r.total / r.size))}</span><button class="btn small" data-p="1" ${r.page * r.size >= r.total ? 'disabled' : ''}>Next ›</button>
    <button class="btn primary" data-save>Save changes on this page</button></div></section>`);
  const changed = new Set();
  sec.querySelectorAll('input[data-i]').forEach(i => i.addEventListener('input', () => changed.add(+i.dataset.i)));
  let tm; sec.querySelector('input[type=search]').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => translations(body, { ...st, q: e.target.value, page: 1 }), 350); });
  sec.querySelector('input[type=checkbox]').addEventListener('change', e => translations(body, { ...st, filter: e.target.checked ? 'auto' : '', page: 1 }));
  sec.querySelector('.pager').addEventListener('click', async e => {
    if (e.target.dataset.p) return translations(body, { ...st, page: st.page + Number(e.target.dataset.p) });
    if (e.target.dataset.save !== undefined) {
      const list = [...sec.querySelectorAll('input[data-i]')].filter(i => changed.has(+i.dataset.i) || r.rows[+i.dataset.i].source === 'auto').map(i => ({ raw_key: r.rows[+i.dataset.i].raw_key, english: i.value }));
      await put('/api/translations', { list }, `Saved ${list.length} translation${list.length === 1 ? '' : 's'}`); translations(body, st);
    }
  });
  body.append(sec);
}
const s = () => master.settings;

function targets(body) {
  const facs = master.facilities.map(f => f.name); const T = s().targets || {};
  const tbl = el(`<section class="section"><h2>Targets per KPI and per area</h2><p class="muted">Per working day. Leave empty for "no target" (shown grey). The weekly target is the daily target x working days. Factory = all facilities together.</p>
    <div class="tbl-wrap" style="padding:0"><table class="tbl edit-table"><thead><tr><th>KPI</th><th>Factory</th>${facs.map(f => `<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>
    ${KPIS.map(([k, l]) => `<tr><td>${esc(l)}</td><td><input type="number" step="any" data-k="${k}" data-f="*" value="${(T[k] || {})['*'] ?? ''}"></td>${facs.map(f => `<td><input type="number" step="any" data-k="${k}" data-f="${esc(f)}" value="${(T[k] || {})[f] ?? ''}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><button class="btn primary" style="margin-top:8px">Save targets</button></section>`);
  tbl.querySelector('button.primary').addEventListener('click', () => {
    const out = {}; tbl.querySelectorAll('input[data-k]').forEach(i => { if (i.value !== '') (out[i.dataset.k] = out[i.dataset.k] || {})[i.dataset.f] = Number(i.value); });
    for (const [k] of KPIS) out[k] = out[k] || {};
    put('/api/settings/targets', { value: out });
  });
  const TW = s().targetWeeks || {};
  const tw = el(`<section class="section"><h2>Targets for a specific week (factory)</h2><p class="muted">Overrides the factory daily target for one week, for example a short week. One line per week: week key (e.g. 202646) = value per day.</p>
    <div class="form-grid">${KPIS.map(([k, l]) => `<label class="field"><span>${esc(l)}</span><textarea rows="3" data-k="${k}" placeholder="202646 = 15">${Object.entries(TW[k] || {}).map(([w, v]) => `${w} = ${v}`).join('\n')}</textarea></label>`).join('')}</div><button class="btn primary" style="margin-top:8px">Save week targets</button></section>`);
  tw.querySelector('button').addEventListener('click', () => { const out = {}; tw.querySelectorAll('textarea').forEach(t => { out[t.dataset.k] = {}; for (const line of t.value.split('\n')) { const m = line.match(/(\d{6})\s*=\s*([\d.]+)/); if (m) out[t.dataset.k][m[1]] = Number(m[2]); } }); put('/api/settings/targetWeeks', { value: out }); });
  const sp = s().spec || {}; const fsp = s().facilitySpec || {};
  const spec = el(`<section class="section"><h2>Mislocation spec limits</h2>
    <div class="form-grid"><label class="field"><span>Factory LSL (mislocations per day)</span><input type="number" step="any" name="lsl" value="${sp.mislocation?.lsl ?? ''}"></label><label class="field"><span>Factory USL</span><input type="number" step="any" name="usl" value="${sp.mislocation?.usl ?? ''}"></label>
    <label class="field"><span>Electrical LSL (optional)</span><input type="number" step="any" name="elsl" value="${sp.electrical?.lsl ?? ''}"></label><label class="field"><span>Electrical USL (optional)</span><input type="number" step="any" name="eusl" value="${sp.electrical?.usl ?? ''}"></label></div>
    <h3>Facility limits</h3><p class="muted">"Derived" = factory limits x the facility's share of the average. Or enter limits by hand.</p>
    <table class="tbl edit-table"><thead><tr><th>Facility</th><th>Mode</th><th>LSL</th><th>USL</th></tr></thead><tbody>${facs.map(f => { const v = fsp[f] || { mode: 'derived' }; return `<tr data-f="${esc(f)}"><td>${esc(f)}</td><td><select><option value="derived" ${v.mode !== 'manual' ? 'selected' : ''}>Derived from factory</option><option value="manual" ${v.mode === 'manual' ? 'selected' : ''}>Entered</option></select></td><td><input type="number" step="any" value="${v.lsl ?? ''}"></td><td><input type="number" step="any" value="${v.usl ?? ''}"></td></tr>`; }).join('')}</tbody></table>
    <button class="btn primary" style="margin-top:8px">Save limits</button></section>`);
  spec.querySelector('button.primary').addEventListener('click', async () => {
    const n = k => { const v = spec.querySelector(`[name=${k}]`).value; return v === '' ? null : Number(v); };
    await api('/api/settings/spec', { method: 'PUT', body: { value: { mislocation: { lsl: n('lsl'), usl: n('usl') }, electrical: { lsl: n('elsl'), usl: n('eusl') } } } });
    const out = {}; spec.querySelectorAll('tr[data-f]').forEach(tr => { const [sel, a, b] = tr.querySelectorAll('select, input'); out[tr.dataset.f] = sel.value === 'manual' ? { mode: 'manual', lsl: a.value, usl: b.value } : { mode: 'derived' }; });
    put('/api/settings/facilitySpec', { value: out }, 'Limits saved');
  });
  const other = el(`<section class="section"><h2>Other rules</h2><div class="form-grid">
    <label class="field"><span>New operator = under this many months in assembly</span><input type="number" name="nom" value="${s().newOperatorMonths ?? 3}"></label>
    <label class="field"><span>Repeat critical defect window (days)</span><input type="number" name="rd" value="${s().repeatDays ?? 7}"></label>
    <label class="field"><span>Compliance totals</span><select name="cam"><option value="0" ${!s().complianceIncludeCamera ? 'selected' : ''}>Line / patrol cases only (camera cases shown separately)</option><option value="1" ${s().complianceIncludeCamera ? 'selected' : ''}>Include camera cases in the totals</option></select></label></div>
    <button class="btn primary" style="margin-top:8px">Save</button></section>`);
  other.querySelector('button').addEventListener('click', async () => {
    await api('/api/settings/newOperatorMonths', { method: 'PUT', body: { value: Number(other.querySelector('[name=nom]').value) || 3 } });
    await api('/api/settings/repeatDays', { method: 'PUT', body: { value: Number(other.querySelector('[name=rd]').value) || 7 } });
    put('/api/settings/complianceIncludeCamera', { value: other.querySelector('[name=cam]').value === '1' });
  });
  body.append(tbl, tw, spec, other);
}

function editableTable(cols, rows, { addLabel = 'Add row', empty = {} } = {}) {
  const wrap = el(`<div><div class="tbl-wrap" style="padding:0;max-height:480px"><table class="tbl edit-table"><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody></tbody></table></div><button class="btn small" style="margin-top:6px" data-add>+ ${esc(addLabel)}</button></div>`);
  const tb = wrap.querySelector('tbody');
  const addRow = r => {
    const tr = document.createElement('tr');
    tr.innerHTML = cols.map(c => {
      const v = r[c.key] ?? '';
      if (c.type === 'select') return `<td><select data-k="${c.key}">${c.options.map(o => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`;
      if (c.type === 'check') return `<td style="text-align:center"><input type="checkbox" data-k="${c.key}" ${v ? 'checked' : ''}></td>`;
      if (c.type === 'color') return `<td><input type="color" data-k="${c.key}" value="${esc(v || '#64748b')}" style="width:52px;padding:0"></td>`;
      if (c.type === 'ro') return `<td ${c.rtl ? 'dir="rtl" class="rtl"' : ''} data-ro="${c.key}" data-v="${esc(v)}">${esc(v)}</td>`;
      return `<td><input type="text" data-k="${c.key}" value="${esc(v)}" ${c.rtl ? 'dir="rtl"' : ''}></td>`;
    }).join('') + '<td><button class="btn small danger" data-del aria-label="Remove row">✕</button></td>';
    tb.append(tr);
  };
  rows.forEach(addRow);
  wrap.addEventListener('click', e => { if (e.target.dataset.del !== undefined) e.target.closest('tr').remove(); if (e.target.dataset.add !== undefined) addRow(empty); });
  wrap.values = () => [...tb.querySelectorAll('tr')].map(tr => { const o = {}; tr.querySelectorAll('[data-k]').forEach(i => (o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value)); tr.querySelectorAll('[data-ro]').forEach(td => (o[td.dataset.ro] = td.dataset.v)); return o; });
  return wrap;
}

function facilities(body) {
  const sec1 = el(`<section class="section"><h2>Facilities (master list)</h2><p class="muted">One color per facility is used on every chart. "Confirmed" off = code not yet confirmed (412B, PSA - Front door / Rear door…).</p></section>`);
  const t1 = editableTable([{ key: 'name', label: 'Facility name' }, { key: 'color', label: 'Color', type: 'color' }, { key: 'confirmed', label: 'Confirmed', type: 'check' }, { key: 'production', label: 'Production facility', type: 'check' }], master.facilities.map(f => ({ ...f, confirmed: !!f.confirmed, production: !!f.production })), { addLabel: 'Add facility', empty: { color: '#64748b', confirmed: true, production: true } });
  const b1 = el('<button class="btn primary" style="margin-top:8px">Save facilities</button>'); b1.addEventListener('click', () => put('/api/master/facilities', { list: t1.values() }));
  sec1.append(t1, b1);
  const facNames = master.facilities.map(f => f.name);
  const sec2 = el(`<section class="section"><h2>Mapping rules (line / facility / area name → facility)</h2><p class="muted">Exact names win; otherwise the longest matching prefix. Applies to the defects "Assembly line", the compliance "Facility" and "Assembly line", and the safety "Area". Saving re-maps all stored data.</p></section>`);
  const t2 = editableTable([{ key: 'pattern', label: 'Name or start of name' }, { key: 'match', label: 'Match', type: 'select', options: ['exact', 'prefix', 'contains'] }, { key: 'facility', label: 'Facility', type: 'select', options: facNames }], master.rules, { addLabel: 'Add rule', empty: { match: 'prefix' } });
  const b2 = el('<button class="btn primary" style="margin-top:8px">Save rules and re-map data</button>'); b2.addEventListener('click', () => put('/api/master/rules', { list: t2.values() }, 'Rules saved, data re-mapped'));
  sec2.append(t2, b2);
  const n = master.names;
  const row = x => `<tr><td>${esc(x.name ?? '(empty)')}</td><td>${x.facility ? esc(x.facility) : '<span class="badge red">not mapped</span>'}${x.facility && !(master.facilities.find(f => f.name === x.facility) || {}).confirmed ? ' <span class="badge">to confirm</span>' : ''}</td><td class="num">${fmt(x.n)}</td></tr>`;
  const sec3 = el(`<section class="section"><h2>Names found in the data and their facility</h2><div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
    <div><h3>Lines (defects and compliance)</h3><div class="tbl-wrap" style="padding:0;max-height:360px"><table class="tbl"><thead><tr><th>Line</th><th>Facility</th><th class="num">Rows</th></tr></thead><tbody>${n.lines.map(row).join('')}</tbody></table></div></div>
    <div><h3>Safety areas</h3><div class="tbl-wrap" style="padding:0;max-height:360px"><table class="tbl"><thead><tr><th>Area</th><th>Facility</th><th class="num">Rows</th></tr></thead><tbody>${n.areas.map(row).join('')}</tbody></table></div><p class="muted">Areas without a facility (CST Machines, Stores, …) are non-production areas: they are shown in the safety pages under their own name.</p></div>
    <div><h3>Compliance "Facility" values</h3><div class="tbl-wrap" style="padding:0;max-height:360px"><table class="tbl"><thead><tr><th>Facility (file)</th><th>Facility</th><th class="num">Rows</th></tr></thead><tbody>${n.facilityRaw.map(row).join('')}</tbody></table></div></div></div></section>`);
  body.append(sec1, sec2, sec3);
}

function defectNames(body) {
  const sec = el(`<section class="section"><h2>Defect name aliases</h2><p class="muted">Names are matched after trimming and ignoring capitals ("Damage Connector" = "Damage connector"). Set "Show as" to merge different spellings into one name.</p></section>`);
  const t = editableTable([{ key: 'raw_key', label: 'Name in file (lower case)', type: 'ro' }, { key: 'canonical', label: 'Show as' }, { key: 'n', label: 'Rows', type: 'ro' }], master.defectAlias, { addLabel: 'Add alias' });
  const b = el('<button class="btn primary" style="margin-top:8px">Save aliases</button>'); b.addEventListener('click', () => put('/api/master/alias/defect', { list: t.values() }));
  sec.append(t, b);
  const crit = el(`<section class="section"><h2>Critical defect list</h2><p class="muted">"exact": the defect name equals one of the values. "contains": the defect name contains the value (e.g. every name with "missing"). Values separated by commas. Defect rank is not used.</p></section>`);
  const tc = editableTable([{ key: 'type', label: 'Critical type' }, { key: 'match', label: 'Match', type: 'select', options: ['exact', 'contains'] }, { key: 'values', label: 'Values (comma separated)' }], (s().critical || []).map(c => ({ ...c, values: c.values.join(', ') })), { addLabel: 'Add critical type', empty: { match: 'exact' } });
  const bc = el('<button class="btn primary" style="margin-top:8px">Save critical list and recalculate</button>');
  bc.addEventListener('click', () => put('/api/settings/critical', { value: tc.values().filter(r => r.type).map(r => ({ type: r.type.trim(), match: r.match, values: r.values.split(',').map(x => x.trim()).filter(Boolean) })) }, 'Critical list saved, data recalculated'));
  crit.append(tc, bc);
  body.append(sec, crit);
}

function names(body) {
  const sec = el(`<section class="section"><h2>Compliance violation aliases</h2></section>`);
  const t = editableTable([{ key: 'raw_key', label: 'Name in file (lower case)', type: 'ro' }, { key: 'canonical', label: 'Show as' }], master.violationAlias, { addLabel: 'Add alias' });
  const b = el('<button class="btn primary" style="margin-top:8px">Save</button>'); b.addEventListener('click', () => put('/api/master/alias/violation', { list: t.values() }));
  sec.append(t, b);
  const sec2 = el(`<section class="section"><h2>Safety non-compliance items: English short names</h2><p class="muted">Charts show the English short name; the Arabic original is in the tooltip and tables.</p></section>`);
  const t2 = editableTable([{ key: 'raw_key', label: 'key', type: 'ro' }, { key: 'arabic', label: 'Arabic (from the file)', type: 'ro', rtl: true }, { key: 'english', label: 'English short name' }], master.safetyItems);
  t2.querySelectorAll('th')[0].style.display = 'none'; t2.querySelectorAll('td[data-ro="raw_key"]').forEach(td => (td.style.display = 'none')); t2.querySelector('[data-add]').remove();
  const b2 = el('<button class="btn primary" style="margin-top:8px">Save English names</button>'); b2.addEventListener('click', () => put('/api/master/safety-items', { list: t2.values() }));
  sec2.append(t2, b2);
  body.append(sec, sec2);
}

function weekTab(body) {
  const w = s().week; const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const sec = el(`<section class="section"><h2>Week settings</h2><div class="form-grid">
    <label class="field"><span>Week starts on</span><select name="ws">${days.map((d, i) => `<option value="${i}" ${w.weekStart === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="field"><span>Week numbering</span><select name="num"><option value="jan1" ${w.numbering === 'jan1' ? 'selected' : ''}>WK1 = the week that contains 1 January</option><option value="first4" ${w.numbering === 'first4' ? 'selected' : ''}>WK1 = first week with 4+ days in the new year</option><option value="firstfull" ${w.numbering === 'firstfull' ? 'selected' : ''}>WK1 = first full week of the year</option></select></label></div>
    <h3>Working days</h3><div class="frow">${days.map((d, i) => `<label><input type="checkbox" value="${i}" ${w.workDays.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <p class="muted">Default: week starts Saturday, WK1 contains 1 January (so WK40 = Sat 26 Sep – Fri 2 Oct 2026, WK46 = Sat 7 Nov), working days Saturday to Thursday. Saving re-numbers all stored data.</p>
    <button class="btn primary">Save week settings</button></section>`);
  sec.querySelector('button').addEventListener('click', () => put('/api/settings/week', { value: { weekStart: Number(sec.querySelector('[name=ws]').value), numbering: sec.querySelector('[name=num]').value, workDays: [...sec.querySelectorAll('input[type=checkbox]:checked')].map(i => Number(i.value)) } }, 'Week settings saved, weeks re-numbered'));
  body.append(sec);
}

function templates(body) {
  const sec = el(`<section class="section"><h2>Column mapping templates</h2><p class="muted">A file whose sheet has all "required" headers (and a matching sheet name, if set) is imported in one click with this template. Templates you create in the upload wizard appear here.</p>
    <div class="tbl-wrap" style="padding:0;max-height:none"><table class="tbl"><thead><tr><th>Name</th><th>Data</th><th>Sheet name rule</th><th>Required headers</th><th>Built in</th><th></th></tr></thead><tbody>
    ${master.templates.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(TYPE_LABEL[t.data_type] || t.data_type)}${t.source ? ' (' + esc(t.source) + ')' : ''}</td><td>${esc(t.sheet_hint || 'any')}</td><td>${esc(t.required.join(', '))}</td><td>${t.builtin ? 'yes' : ''}</td><td style="white-space:nowrap"><button class="btn small" data-e="${t.id}">View / edit</button> <button class="btn small danger" data-d="${t.id}">Delete</button></td></tr>`).join('')}
    </tbody></table></div></section>`);
  sec.addEventListener('click', async e => {
    const id = e.target.dataset.e || e.target.dataset.d; if (!id) return; const t = master.templates.find(x => String(x.id) === id);
    if (e.target.dataset.d) { if (!confirm(`Delete template "${t.name}"?${t.builtin ? '\nIt is a built-in template for your current files.' : ''}`)) return; await api('/api/templates/' + id, { method: 'DELETE' }); toast('Deleted'); await loadMaster(); body.innerHTML = ''; templates(body); return; }
    const f = el(`<div><div class="form-grid"><label class="field"><span>Name</span><input type="text" name="name" value="${esc(t.name)}"></label><label class="field"><span>Sheet name rule (regular expression, empty = any)</span><input type="text" name="hint" value="${esc(t.sheet_hint || '')}"></label><label class="field"><span>Priority</span><input type="number" name="prio" value="${t.priority || 0}"></label><label class="field"><span>Required headers (comma separated)</span><input type="text" name="req" value="${esc(t.required.join(', '))}"></label></div>
      <h3>Columns</h3><table class="tbl edit-table"><thead><tr><th>Field</th><th>Header in the file</th></tr></thead><tbody>${Object.entries(fields[t.data_type] || {}).map(([k, l]) => `<tr><td>${esc(l)}</td><td><input type="text" data-f="${k}" value="${esc(t.field_map[k] || '')}"></td></tr>`).join('')}</tbody></table>
      <button class="btn primary" style="margin-top:8px">Save template</button></div>`);
    f.querySelector('button').addEventListener('click', async () => {
      const fm = {}; f.querySelectorAll('[data-f]').forEach(i => { if (i.value.trim()) fm[i.dataset.f] = i.value.trim(); });
      await api('/api/templates/' + id, { method: 'PUT', body: { ...t, name: f.querySelector('[name=name]').value, sheet_hint: f.querySelector('[name=hint]').value, priority: f.querySelector('[name=prio]').value, required: f.querySelector('[name=req]').value.split(',').map(x => x.trim()).filter(Boolean), field_map: fm } });
      toast('Template saved'); closeModal(); await loadMaster(); body.innerHTML = ''; templates(body);
    });
    modal('Template: ' + t.name, f);
  });
  body.append(sec);
}

function users(body) {
  const sec = el(`<section class="section"><h2>Users</h2><p class="muted">Admin: upload, delete, settings. Viewer: view and download. Users sign in with their name and a PIN (or password).</p>
    <table class="tbl"><thead><tr><th>User</th><th>Role</th><th></th></tr></thead><tbody>${master.users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td><button class="btn small danger" data-d="${esc(u.username)}">Delete</button></td></tr>`).join('')}</tbody></table>
    <h3>Add a user or change a password</h3><div class="form-grid"><label class="field"><span>User name</span><input type="text" name="u"></label><label class="field"><span>Password (at least 8 characters)</span><input type="password" name="p" autocomplete="new-password"></label><label class="field"><span>Role</span><select name="r"><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label></div>
    <button class="btn primary" style="margin-top:8px" data-a="add">Save user</button></section>`);
  sec.addEventListener('click', async e => {
    if (e.target.dataset.d) { if (!confirm('Delete user ' + e.target.dataset.d + '?')) return; try { await api('/api/users/' + encodeURIComponent(e.target.dataset.d), { method: 'DELETE' }); toast('Deleted'); await loadMaster(); body.innerHTML = ''; users(body); } catch (err) { toast(err.message, true); } }
    if (e.target.dataset.a === 'add') { try { await api('/api/users', { method: 'POST', body: { username: sec.querySelector('[name=u]').value, password: sec.querySelector('[name=p]').value, role: sec.querySelector('[name=r]').value } }); toast('User saved'); await loadMaster(); body.innerHTML = ''; users(body); } catch (err) { toast(err.message, true); } }
  });
  const c = s().company || {};
  const acc = el(`<section class="section"><h2>Access and company</h2><label><input type="checkbox" name="rl" ${s().requireLogin ? 'checked' : ''}> Viewers must log in to see the website (off: anyone on the plant network can view; admin pages always need a login)</label>
    <div class="form-grid" style="margin-top:10px"><label class="field"><span>Company</span><input type="text" name="cn" value="${esc(c.name || '')}"></label><label class="field"><span>Site</span><input type="text" name="cs" value="${esc(c.site || '')}"></label><label class="field"><span>Department</span><input type="text" name="cd" value="${esc(c.department || '')}"></label></div>
    <p class="muted">Logos: website/public/img/sews-e-logo-wide-white.png (header), sews-e-logo-wide-indigo.png (print / PDF), sews-e-icon.png (browser tab). Replace these files to change them.</p><button class="btn primary">Save</button></section>`);
  acc.querySelector('button').addEventListener('click', async () => { await api('/api/settings/requireLogin', { method: 'PUT', body: { value: acc.querySelector('[name=rl]').checked } }); put('/api/settings/company', { value: { name: acc.querySelector('[name=cn]').value, site: acc.querySelector('[name=cs]').value, department: acc.querySelector('[name=cd]').value } }); });
  body.append(sec, acc);
}

function presentation(body) {
  const p = s().presentation || {}; const routes = ['/', '/defects', '/defects/critical', '/defects/czcf', '/defects/rework', '/defects/mislocation', '/defects/mislocation?tab=control', '/compliance', '/compliance/team-leaders', '/compliance/operators', '/safety', '/safety/areas', '/safety/items'];
  const sec = el(`<section class="section"><h2>Presentation mode</h2><p class="muted">For the meeting-room screen: full screen, large fonts, pages rotate automatically. Start it with ▶ in the header, or open any link with <code>?present=1</code>.</p>
    <label class="field" style="max-width:240px"><span>Seconds per page</span><input type="number" name="sec" min="5" value="${p.seconds || 30}"></label>
    <h3>Pages in the rotation</h3><div class="form-grid">${routes.map(r => `<label><input type="checkbox" value="${esc(r)}" ${(p.pages || []).includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</div>
    <button class="btn primary" style="margin-top:8px">Save</button></section>`);
  sec.querySelector('button').addEventListener('click', () => put('/api/settings/presentation', { value: { seconds: Number(sec.querySelector('[name=sec]').value) || 30, pages: [...sec.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value) } }));
  body.append(sec);
}

function backups(body) {
  const sec = el(`<section class="section"><h2>Database backups</h2><p class="muted">A backup is written automatically once a day into the project's <b>Backups</b> folder (the last 30 are kept). See the README to restore one.</p>
    <table class="tbl"><thead><tr><th>File</th><th class="num">Size</th></tr></thead><tbody>${master.backups.map(b => `<tr><td>${esc(b.file)}</td><td class="num">${fmt(b.size / 1024 / 1024, 1)} MB</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No backup yet</td></tr>'}</tbody></table>
    <button class="btn primary" style="margin-top:8px">Back up now</button></section>`);
  sec.querySelector('button').addEventListener('click', async () => { const r = await api('/api/backup', { method: 'POST' }); toast('Backup written: ' + r.file); await loadMaster(); body.innerHTML = ''; backups(body); });
  body.append(sec);
}
export { go };
