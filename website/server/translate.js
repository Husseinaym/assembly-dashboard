'use strict';
/**
 * Offline Arabic -> English translation for free-text notes (safety Notes, compliance Comment / Justification).
 * 1. Exact match in the translation table (5,268 notes translated from the real data; editable in Settings).
 * 2. Template match: the same sentence with other numbers / codes (e.g. "machine 52" -> "machine 61").
 * 3. Phrase glossary: plant vocabulary, longest phrase first. Marked "auto" so an admin can review it.
 * Nothing is sent outside the plant network.
 */
const C = require('./calc');

const AR = /[؀-ۿ]/;
const hasArabic = s => typeof s === 'string' && AR.test(s);
const arNorm = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '');
const digits = s => s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
const spaced = s => digits(s).replace(/([؀-ۿ])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([؀-ۿ])/g, '$1 $2');
const TOKEN = /[A-Za-z0-9][A-Za-z0-9.\-_/&+]*/g;

function template(s) {
  const tokens = [];
  const t = spaced(String(s)).replace(TOKEN, m => { tokens.push(m); return ' \u0001 '; });
  return { key: arNorm(C.normKey(t)), tokens };
}

// Phrase glossary (normalised Arabic: ة->ه, ى->ي, أ/إ/آ->ا). Longest phrases are tried first.
const G = [
  ['لا يوجد', 'no'], ['لايوجد', 'no'], ['يوجد', ''], ['وجود', ''],
  ['طفايه الحريق', 'fire extinguisher'], ['طفايه حريق', 'fire extinguisher'], ['طفايه', 'fire extinguisher'], ['صندوق الحريق', 'fire box'], ['خرطوم الحريق', 'fire hose'],
  ['معدات مكافحه الحرائق', 'firefighting equipment'], ['انذار الحريق', 'fire alarm'],
  ['باب الطوارئ', 'emergency door'], ['باب طوارئ', 'emergency door'], ['مخرج الطوارئ', 'emergency exit'], ['مخرج طوارئ', 'emergency exit'], ['زرار الطوارئ', 'emergency button'], ['زر الطوارئ', 'emergency button'], ['زرار طوارئ', 'emergency button'],
  ['عجله اسبولات', 'spool reel'], ['عجله الاسبولات', 'spool reel'], ['اسبولات ليد', 'lead spools'], ['اسبولات', 'spools'], ['اسبوله', 'spool'], ['حواجز الامان', 'safety barriers'], ['حاجز الاسبولات', 'spool barrier'], ['حواجز', 'barriers'], ['حاجز', 'barrier'],
  ['ترول ليد', 'lead trolley'], ['ترولي ليد', 'lead trolley'], ['تروليات', 'trolleys'], ['ترولات', 'trolleys'], ['ترولي', 'trolley'], ['ترول', 'trolley'],
  ['بالتات', 'pallets'], ['بالته', 'pallet'], ['بالت', 'pallet'], ['كراتين', 'cartons'], ['كرتونه', 'carton'], ['بوكسات', 'boxes'], ['بوكس', 'box'], ['باجات', 'bags'], ['باجه', 'bag'], ['اكياس', 'bags'], ['كيس', 'bag'],
  ['هاند ليفت', 'hand lift'], ['هاند', 'hand lift'], ['استاند', 'stand'], ['استند', 'stand'], ['سلم', 'ladder'], ['راك', 'rack'],
  ['خارج الاي اوت', 'outside the layout'], ['خارج اللاي اوت', 'outside the layout'], ['خارج اللي اوت', 'outside the layout'], ['خارج الي اوت', 'outside the layout'], ['لاي اوت', 'layout'],
  ['في مكان غير مخصص', 'in a non-assigned place'], ['ف مكان غير مخصص', 'in a non-assigned place'], ['فمكان غير مخصص', 'in a non-assigned place'], ['مكان غير مخصص', 'non-assigned place'],
  ['يعيق الحركه', 'blocking movement'], ['تعيق الحركه', 'blocking movement'], ['يعيق', 'blocking'], ['الواك واي', 'the walkway'], ['الوك واي', 'the walkway'], ['واك واي', 'walkway'], ['الممر', 'the aisle'], ['ممر', 'aisle'],
  ['علي الارض', 'on the floor'], ['عالارض', 'on the floor'], ['علارض', 'on the floor'], ['الارضيه', 'the floor'], ['الارض', 'the floor'],
  ['لوحه الكهرباء', 'electrical panel'], ['لوحه كهرباء', 'electrical panel'], ['علبه كهرباء', 'electrical box'], ['كابينه', 'cabinet'], ['مفتوحه', 'open'], ['مفتوح', 'open'], ['مغلقه', 'closed'],
  ['مشترك', 'power strip'], ['مشتركات', 'power strips'], ['فيشه', 'plug'], ['بلجه', 'plug'], ['اسلاك', 'wires'], ['سلك ارضي', 'earth wire'], ['سلك', 'wire'], ['كابلات', 'cables'], ['كبلات', 'cables'], ['كابل', 'cable'], ['كبل', 'cable'], ['خرطوم هواء', 'air hose'], ['خرطوم', 'hose'],
  ['يحتاج للتثبيت', 'needs fixing'], ['يحتاج الي تثبيت', 'needs fixing'], ['يحتاج الي التثبيت', 'needs fixing'], ['تحتاج للتثبيت', 'needs fixing'], ['تحتاج الي تثبيت', 'needs fixing'], ['غير مثبته', 'not fixed'], ['غير مثبت', 'not fixed'], ['مخلوعه', 'loose'], ['مخلوع', 'loose'],
  ['مكسوره', 'broken'], ['مكسور', 'broken'], ['كسر', 'break'], ['لا يعمل', 'not working'], ['لا تعمل', 'not working'], ['لايعمل', 'not working'], ['عطل', 'fault'],
  ['اجزاء حاده', 'sharp parts'], ['جزء حاد', 'sharp part'], ['حواف حاده', 'sharp edges'], ['مسامير', 'nails'], ['مسمار', 'nail'], ['طابه', 'protective cap'], ['صداده', 'guard'],
  ['استروتيرف', 'astroturf mat'], ['استرتيرف', 'astroturf mat'], ['كفر حمايه', 'protective cover'], ['غطاء حمايه', 'protective cover'], ['غطاء السلاح', 'blade cover'], ['غطاء', 'cover'], ['كفر', 'cover'], ['السير', 'belt'], ['سير', 'belt'],
  ['سارينه انذار', 'alarm siren'], ['سارينه', 'siren'], ['انذار', 'alarm'], ['الكاركاز', 'carcass'], ['الكركاز', 'carcass'], ['الكراكاز', 'carcass'], ['رفع', 'lifting'],
  ['ورق ويندر', 'paper winder paper'], ['ورق', 'paper'], ['اتشوبر', 'chopper waste'], ['تشوبر', 'chopper waste'], ['زيت', 'oil'], ['مياه', 'water'], ['تنر', 'thinner'], ['بدون اسم تعريفي', 'without an identification label'],
  ['سيفتي شوز', 'safety shoes'], ['سفتي شوز', 'safety shoes'], ['سيفتي شوذ', 'safety shoes'], ['سيفتي', 'safety shoes'], ['سفتي', 'safety shoes'], ['نضاره', 'safety glasses'], ['نظاره', 'safety glasses'], ['خوذه', 'helmet'], ['جلفز', 'gloves'], ['حزام الامان', 'safety harness'],
  ['الريسك اريا', 'the risk area'], ['الرسك اريا', 'the risk area'], ['منطقه الخطر', 'the danger zone'], ['الكارسول', 'the carousel'], ['الكرسول', 'the carousel'], ['البورده', 'the board'], ['بورده', 'board'],
  ['يتحدث في الهاتف', 'talking on the phone'], ['التحدث في الهاتف', 'talking on the phone'], ['الهاتف', 'the phone'], ['اثناء السير', 'while walking'], ['اثناء العمل', 'while working'], ['اثناء التكيت', 'while kitting'], ['اثناء', 'while'],
  ['لم يتم تسليمه', '(not yet issued)'], ['كيتر', 'kitter'], ['التكيت', 'kitting'], ['فرامل', 'brakes'], ['غلق', 'locking'], ['قفل', 'lock'],
  ['يعمل', 'working'], ['تعمل', 'working'], ['العمل', 'working'], ['بدون', 'without'], ['امام', 'in front of'], ['بجوار', 'next to'], ['بجانب', 'next to'], ['جنب', 'next to'], ['خلف', 'behind'], ['داخل', 'inside'], ['تحت', 'under'], ['فوق', 'above'],
  ['ماكينه', 'machine'], ['مكينه', 'machine'], ['مكنه', 'machine'], ['الماكينه', 'the machine'], ['رقم', 'no.'], ['باب', 'door'], ['الورشه', 'the workshop'], ['ورشه', 'workshop'], ['مخزن', 'store'], ['الرسيف', 'receiving'], ['الشيبنج', 'shipping'],
  ['له', ''], ['لها', ''], ['ليه', ''], ['ليها', ''], ['في', 'in'], ['ف', 'in'], ['فى', 'in'], ['و', 'and'], ['من', 'from'], ['الي', 'to'], ['علي', 'on'], ['به', 'with'],
].map(([a, e]) => [arNorm(a).split(' '), e]).sort((x, y) => y[0].length - x[0].length);

function glossary(text) {
  const words = arNorm(C.normText(spaced(text))).split(' ').filter(Boolean);
  const out = []; let unknown = 0;
  for (let i = 0; i < words.length;) {
    if (!AR.test(words[i])) { out.push(words[i]); i++; continue; }
    let hit = null;
    for (const [ph, en] of G) { if (ph.length <= words.length - i && ph.every((w, j) => words[i + j] === w)) { hit = [ph.length, en]; break; } }
    if (!hit) { // try without prefixes ال / و / ف / ب
      const w = words[i]; const variants = [w.replace(/^ال/, ''), w.replace(/^و/, ''), w.replace(/^[فب]/, ''), w.replace(/^(وال|فال|بال)/, '')];
      for (const v of variants) { const g = G.find(([ph]) => ph.length === 1 && ph[0] === v); if (g) { hit = [1, g[1]]; break; } }
    }
    if (hit) { if (hit[1]) out.push(hit[1]); i += hit[0]; } else { unknown++; i++; }
  }
  let en = out.join(' ').replace(/\s+/g, ' ').trim();
  if (en) en = en[0].toUpperCase() + en.slice(1);
  return { en, unknown };
}

class Translator {
  constructor(rows) { // rows: [{raw_key, arabic, english}]
    this.exact = new Map(); this.tpl = new Map();
    for (const r of rows) {
      if (!r.english) continue;
      this.exact.set(r.raw_key, r.english);
      const t = template(r.arabic);
      if (!t.tokens.length || this.tpl.has(t.key)) continue;
      let eng = r.english, ok = true, pos = 0; const marks = [];
      for (const tok of t.tokens) {
        const i = eng.toLowerCase().indexOf(tok.toLowerCase(), pos);
        if (i < 0) { ok = false; break; }
        marks.push([i, tok.length]); pos = i + tok.length;
      }
      if (!ok) continue;
      for (let k = marks.length - 1; k >= 0; k--) eng = eng.slice(0, marks[k][0]) + '\u0001' + eng.slice(marks[k][0] + marks[k][1]);
      this.tpl.set(t.key, eng);
    }
  }
  /** returns { en, method: 'table'|'template'|'glossary', complete } */
  translate(text) {
    if (!hasArabic(text)) return { en: text, method: 'none', complete: true };
    const k = C.normKey(text);
    if (this.exact.has(k)) return { en: this.exact.get(k), method: 'table', complete: true };
    const t = template(text);
    if (t.tokens.length && this.tpl.has(t.key)) { let i = 0; return { en: this.tpl.get(t.key).replace(/\u0001/g, () => t.tokens[i++]), method: 'template', complete: true }; }
    if (!t.tokens.length) { const t2 = this.tpl.get(t.key); if (t2 && !t2.includes('\u0001')) return { en: t2, method: 'template', complete: true }; }
    const g = glossary(text);
    return { en: g.en || '(not translated yet)', method: 'glossary', complete: g.unknown === 0 && !!g.en };
  }
}

// ---------- database helpers ----------
let cache = null;
function load(db) {
  if (!cache) {
    const rows = db.prepare('SELECT raw_key, arabic, english, source FROM translations').all();
    cache = { map: new Map(rows.map(r => [r.raw_key, r])), tr: new Translator(rows.filter(r => r.source !== 'auto')) };
  }
  return cache;
}
function invalidate() { cache = null; }

/** English for a stored Arabic text (null when the text has no Arabic). */
function english(db, text) {
  if (!hasArabic(text)) return null;
  const c = load(db); const r = c.map.get(C.normKey(text));
  if (r && r.english) return r.source === 'auto' ? `${r.english} [auto]` : r.english;
  return `${c.tr.translate(text).en} [auto]`;
}

/** Store translations for new Arabic texts found in an upload. Returns the number of new texts. */
function learn(db, texts) {
  const c = load(db); const ins = db.prepare('INSERT OR IGNORE INTO translations(raw_key, arabic, english, source) VALUES(?,?,?,?)');
  let n = 0; const added = [];
  for (const t of texts) {
    if (!hasArabic(t)) continue; const k = C.normKey(t);
    if (c.map.has(k)) continue;
    const r = c.tr.translate(t);
    ins.run(k, C.normText(t), r.en, r.method === 'table' ? 'manual' : 'auto');
    c.map.set(k, { raw_key: k, arabic: C.normText(t), english: r.en, source: 'auto' }); n++;
    if (added.length < 50) added.push({ arabic: C.normText(t), english: r.en, method: r.method });
  }
  return { count: n, sample: added };
}

function seed(db, file) {
  const n = db.prepare('SELECT COUNT(*) n FROM translations').get().n;
  if (n) return 0;
  const data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  const ins = db.prepare('INSERT OR REPLACE INTO translations(raw_key, arabic, english, source) VALUES(?,?,?,?)');
  db.exec('BEGIN'); for (const [k, v] of Object.entries(data)) ins.run(k, v.ar, v.en, 'manual'); db.exec('COMMIT');
  invalidate();
  return Object.keys(data).length;
}

module.exports = { Translator, template, glossary, hasArabic, english, learn, seed, invalidate, load };
