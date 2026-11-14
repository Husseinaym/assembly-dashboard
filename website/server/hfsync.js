'use strict';
// Cloud persistence for Hugging Face Spaces: the database is restored from a private HF dataset at start
// and saved back (debounced) after every upload / settings change. Inactive unless HF_DATA_REPO and HF_TOKEN are set.
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = process.env.HF_DATA_REPO, TOKEN = process.env.HF_TOKEN;
const enabled = !!(REPO && TOKEN);
const hub = () => import('@huggingface/hub');
const repo = { type: 'dataset', name: REPO };

async function restore(file) {
  if (!enabled) return;
  try {
    const { downloadFile } = await hub();
    const res = await downloadFile({ repo, path: 'production.db', credentials: { accessToken: TOKEN } });
    if (!res) { console.log('No saved database yet in', REPO); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('Database restored from', REPO);
  } catch (e) { console.error('Restore failed:', e.message); }
}

let timer = null;
function schedule(db) { if (!enabled) return; clearTimeout(timer); timer = setTimeout(() => save(db), 15000); }
async function save(db) {
  try {
    const tmp = path.join(os.tmpdir(), 'pda-save.db');
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const { uploadFile } = await hub();
    await uploadFile({ repo, credentials: { accessToken: TOKEN }, file: { path: 'production.db', content: new Blob([fs.readFileSync(tmp)]) }, commitTitle: 'Website data ' + new Date().toISOString() });
    console.log('Database saved to', REPO);
  } catch (e) { console.error('Save failed:', e.message); }
}
module.exports = { restore, schedule, save, enabled };
