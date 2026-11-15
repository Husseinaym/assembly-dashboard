import L from './i18n/en.js';
export const t = k => L[k] ?? k;

export async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((data && data.error) || r.statusText); e.status = r.status; throw e; }
  return data;
}

// Inline SVG icons (24x24, 2px stroke, currentColor): render the same on every PC, unlike text symbols.
const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
};
export const icon = (name, size = 16) => `<svg class="ico-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
export function fmt(n, d = 0) { if (n === null || n === undefined || n === '' || !isFinite(n)) return '–'; return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
export function fmtAuto(n) { if (typeof n !== 'number') return n ?? ''; return Number.isInteger(n) ? fmt(n) : fmt(n, Math.abs(n) < 10 ? 2 : 1); }
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dLabel(iso, year = true) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${M[m - 1]}${year ? ' ' + y : ''}`; }
export function dtLabel(iso) { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${dLabel(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)}, ${p(d.getHours())}:${p(d.getMinutes())}`; }
export function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 864e5).toISOString().slice(0, 10); }

export function toast(msg, err = false, ms = 3500) {
  const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

export function modal(title, bodyEl) {
  const m = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  const b = document.getElementById('modal-body'); b.innerHTML = ''; if (bodyEl) b.append(bodyEl);
  m.hidden = false; document.getElementById('modal-close').focus();
  return b;
}
export function closeModal() { const m = document.getElementById('modal'); m.hidden = true; document.getElementById('modal-body').innerHTML = ''; }

export function stamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
export function safeName(s) { return String(s).replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }
export function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

let loaded = {};
export function loadScript(src) { if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); return loaded[src]; }
