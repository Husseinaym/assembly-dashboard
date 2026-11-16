'use strict';
/**
 * Private storage for everything confidential: the database, the original uploaded Excel files and the
 * private translation table. Nothing in this store is ever served as a public file; the website reads it
 * on the server and only hands data to signed-in users.
 *
 * Two back-ends (chosen by environment variables, never by code):
 *   - Hugging Face private dataset:  HF_DATA_REPO + HF_TOKEN   (cloud)
 *   - a folder:                      PDA_STORE_DIR             (plant server / tests)
 * With neither set the store is off and files only live on the local disk.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.HF_DATA_REPO, TOKEN = process.env.HF_TOKEN, DIR = process.env.PDA_STORE_DIR;
const kind = REPO && TOKEN ? 'hf' : DIR ? 'dir' : 'none';
const enabled = kind !== 'none';
const hub = () => import('@huggingface/hub');
const repo = { type: 'dataset', name: REPO };

/** Store keys are relative paths such as "Uploads/2026-11-15/101500_file.xlsx". No "..", no absolute paths. */
function safeKey(key) {
  const k = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!k || k.split('/').some(p => p === '..' || p === '.' || p === '')) throw new Error('Invalid storage path');
  return k;
}

async function get(key) {
  key = safeKey(key);
  if (kind === 'dir') { const f = path.join(DIR, key); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
  if (kind === 'hf') {
    const { downloadFile } = await hub();
    const res = await downloadFile({ repo, path: key, credentials: { accessToken: TOKEN } });
    return res ? Buffer.from(await res.arrayBuffer()) : null;
  }
  return null;
}

async function put(key, buf, title) {
  key = safeKey(key);
  if (kind === 'dir') { const f = path.join(DIR, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return true; }
  if (kind === 'hf') {
    const { uploadFile } = await hub();
    await uploadFile({ repo, credentials: { accessToken: TOKEN }, file: { path: key, content: new Blob([buf]) }, commitTitle: title || 'Website file ' + new Date().toISOString() });
    return true;
  }
  return false;
}

// ---------- database ----------
async function restoreDb(file) {
  if (!enabled) return false;
  try {
    const buf = await get('production.db');
    if (!buf) { console.log('Private store: no saved database yet'); return false; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log('Private store: database restored');
    return true;
  } catch (e) { console.error('Private store: restore failed:', e.message); return false; }
}

let timer = null, lastDb = null, saving = Promise.resolve();
/** Save the database a few seconds after the last change (many changes become one save). */
function schedule(db) { if (!enabled) return; lastDb = db; clearTimeout(timer); timer = setTimeout(() => { timer = null; saveDb(db); }, Number(process.env.PDA_SAVE_DELAY_MS) || 15000); }
function saveDb(db) {
  saving = saving.then(async () => {
    try {
      const tmp = path.join(os.tmpdir(), `pda-save-${process.pid}.db`);
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      await put('production.db', fs.readFileSync(tmp), 'Website data ' + new Date().toISOString());
      fs.unlinkSync(tmp);
      console.log('Private store: database saved');
    } catch (e) { console.error('Private store: save failed:', e.message); }
  });
  return saving;
}
/** Called before the server stops, so a pending change is not lost. */
async function flush() { if (timer && lastDb) { clearTimeout(timer); timer = null; await saveDb(lastDb); } else await saving; }

/** Fetch one private file to the local disk if it is not there yet (used for the private translation table). */
async function fetchTo(key, file) {
  if (!enabled || fs.existsSync(file)) return fs.existsSync(file);
  try { const buf = await get(key); if (!buf) return false; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); return true; }
  catch (e) { console.error(`Private store: could not fetch ${key}:`, e.message); return false; }
}

module.exports = { kind, enabled, get, put, restoreDb, schedule, saveDb, flush, fetchTo, safeKey };
