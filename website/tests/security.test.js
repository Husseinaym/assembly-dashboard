'use strict';
// Security tests: they start the real server (as a child process, on a temporary database) and call it over HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pda-sec-'));
const PORT = 18000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'testadmin', PASS = 'Corr3ct-horse-battery'; // test-only values, generated for the temporary database
const baseEnv = extra => ({ ...process.env, PDA_DB: path.join(TMP, 'db', 'test.db'), PDA_UPLOADS: path.join(TMP, 'Uploads'), PDA_BACKUPS: path.join(TMP, 'Backups'), PDA_STORE_DIR: path.join(TMP, 'store'), PDA_SAVE_DELAY_MS: '200', PORT: String(PORT), PDA_ADMIN_USER: ADMIN, PDA_ADMIN_PIN: PASS, NODE_ENV: 'production', NODE_NO_WARNINGS: '1', PDA_ALLOW_GUEST: '', HF_TOKEN: '', HF_DATA_REPO: '', ...extra });

let server = null, log = '';
async function start(extra = {}) {
  log = '';
  server = spawn(process.execPath, ['server/start.js'], { cwd: ROOT, env: baseEnv(extra) });
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/meta'); if (r.ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start: ' + log);
}
async function stop() { if (!server) return; const p = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await p; server = null; }
const cookieOf = r => (r.headers.get('set-cookie') || '');
async function login(user = ADMIN, pass = PASS, headers = {}) { return fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username: user, password: pass }) }); }
async function adminCookie() { const r = await login(); assert.equal(r.status, 200); return cookieOf(r).split(';')[0]; }
const get = (p, cookie) => fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} });

test.after(async () => { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('the server refuses to start without administrator secrets', () => {
  const r = spawnSync(process.execPath, ['server/start.js'], { cwd: ROOT, env: baseEnv({ PDA_ADMIN_USER: '', PDA_ADMIN_PIN: '', PDA_DB: path.join(TMP, 'none', 'x.db'), PORT: String(PORT + 1) }), timeout: 20000, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /STARTUP REFUSED/);
});

test('the server refuses a weak administrator password', () => {
  for (const pin of ['admin', '1234', '12345678', ADMIN]) {
    const r = spawnSync(process.execPath, ['server/start.js'], { cwd: ROOT, env: baseEnv({ PDA_ADMIN_PIN: pin, PDA_DB: path.join(TMP, 'weak', 'x.db'), PORT: String(PORT + 1) }), timeout: 20000, encoding: 'utf8' });
    assert.equal(r.status, 1, 'accepted weak password ' + pin);
    assert.ok(!(r.stderr + r.stdout).includes(pin) || pin === 'admin' || pin === ADMIN, 'the rejected password must not be printed');
  }
});

test('start the server', async () => { await start(); assert.ok(!log.includes(PASS), 'the password must never be logged'); });

test('default accounts do not exist', async () => {
  for (const [u, p] of [['admin', 'admin'], ['viewer', 'viewer'], ['admin', ''], [ADMIN, ADMIN]]) assert.equal((await login(u, p, { 'X-Forwarded-For': '10.9.9.9' })).status, 401);
});

test('without a login no data is returned', async () => {
  const meta = await (await get('/api/meta')).json();
  assert.equal(meta.user, null); assert.equal(meta.requireLogin, true);
  assert.deepEqual(meta.facilities, []); assert.deepEqual(meta.weeks, []); assert.equal(meta.lastUpload, null); assert.equal(meta.dataDate, null);
  for (const p of ['/api/page/home', '/api/page/defects', '/api/options', '/api/records?seg=defects', '/api/records.csv?seg=defects', '/api/search?q=a']) assert.equal((await get(p)).status, 401, p);
  for (const p of ['/api/settings', '/api/uploads', '/api/uploads/1', '/api/uploads/1/file', '/api/translations', '/api/fields']) assert.equal((await get(p)).status, 403, p);
  for (const [m, p] of [['POST', '/api/upload/commit'], ['POST', '/api/upload/analyze'], ['PUT', '/api/settings/requireLogin'], ['POST', '/api/users'], ['DELETE', '/api/users/' + ADMIN], ['POST', '/api/backup'], ['PUT', '/api/translations'], ['DELETE', '/api/uploads/1']]) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test('private files are not reachable as public paths', async () => {
  for (const p of ['/server/db.js', '/data/test.db', '/Uploads/', '/../server/auth.js', '/translations-ar.json', '/server/translations-ar.json', '/.env', '/package.json', '/%2e%2e/server/auth.js']) {
    const r = await get(p); const body = await r.text();
    assert.ok(r.status === 404 || body.includes('<!doctype html>'), `${p} returned ${r.status}`); // unknown paths get the app shell, never a file
    assert.ok(!body.includes('scryptSync') && !body.includes('SQLite format'), p);
  }
});

test('login sets a secure, HttpOnly, SameSite session cookie', async () => {
  const r = await login(); assert.equal(r.status, 200);
  const c = cookieOf(r);
  assert.match(c, /pda_session=[0-9a-f]{64}/); assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Max-Age=\d+/);
  const body = await r.json(); assert.deepEqual(body, { username: ADMIN, role: 'admin' });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('strict-transport-security') || '', /max-age/);
});

test('an invalid or forged session cookie gives no access', async () => {
  for (const c of ['pda_session=' + 'a'.repeat(64), 'pda_session=x', "pda_session=' OR 1=1 --", 'pda_session=%E0%A4%A']) assert.equal((await get('/api/page/home', c)).status, 401, c);
});

test('admin can read data and admin pages; logout ends the session', async () => {
  const c = await adminCookie();
  assert.equal((await get('/api/page/home', c)).status, 200);
  assert.equal((await get('/api/settings', c)).status, 200);
  const out = await fetch(BASE + '/api/logout', { method: 'POST', headers: { Cookie: c } });
  assert.match(cookieOf(out), /Max-Age=0/);
  assert.equal((await get('/api/page/home', c)).status, 401, 'old cookie must stop working after logout');
});

test('viewer accounts: weak passwords refused, viewer cannot use admin routes', async () => {
  const c = await adminCookie();
  const mk = (u, p, role = 'viewer') => fetch(BASE + '/api/users', { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, role }) });
  assert.equal((await mk('viewer1', 'short')).status, 400);
  assert.equal((await mk('viewer1', 'password')).status, 400);
  assert.equal((await mk('viewer1', 'viewer1')).status, 400);
  assert.equal((await mk(ADMIN, 'Another-long-pass1', 'viewer')).status, 400, 'admin cannot demote themselves');
  assert.equal((await mk('viewer1', 'View-only-pass-77')).status, 200);
  const v = await login('viewer1', 'View-only-pass-77'); assert.equal(v.status, 200); const vc = cookieOf(v).split(';')[0];
  assert.equal((await get('/api/page/home', vc)).status, 200);
  for (const p of ['/api/settings', '/api/uploads', '/api/translations']) assert.equal((await get(p, vc)).status, 403, p);
  assert.equal((await fetch(BASE + '/api/users', { method: 'POST', headers: { Cookie: vc, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'evil', password: 'Evil-pass-12345', role: 'admin' }) })).status, 403);
  // changing the password signs the viewer out everywhere
  assert.equal((await mk('viewer1', 'View-only-pass-88')).status, 200);
  assert.equal((await get('/api/page/home', vc)).status, 401);
  const settings = await (await get('/api/settings', c)).json();
  assert.ok(settings.users.every(u => !('hash' in u) && !('salt' in u)), 'password hashes are never sent to the browser');
});

test('requests from another website are refused', async () => {
  const c = await adminCookie();
  const r = await fetch(BASE + '/api/users', { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ username: 'x1', password: 'Some-long-pass-1' }) });
  assert.equal(r.status, 403);
});

test('upload an Excel file, download the original, and both survive a restart', async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Date', 'Shift', 'Area', 'Department', 'Item', 'Notes'], ['11/14/2026', '1st', 'Area A', 'Assembly', 'Test item', 'test note']]), 'Sheet1');
  const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const c = await adminCookie();
  const fd = new FormData(); fd.append('file', new Blob([file]), 'security-test.xlsx');
  const an = await fetch(BASE + '/api/upload/analyze', { method: 'POST', headers: { Cookie: c }, body: fd });
  assert.equal(an.status, 200); const a = await an.json(); assert.ok(a.token);
  const cm = await fetch(BASE + '/api/upload/commit', { method: 'POST', headers: { Cookie: c, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: a.token }) });
  assert.equal(cm.status, 200); const r = await cm.json(); assert.equal(r.fileStored, true);
  const ups = await (await get('/api/uploads', c)).json(); const id = ups[0].id;
  const dl = await get(`/api/uploads/${id}/file`, c); assert.equal(dl.status, 200);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(file), 'downloaded file is identical to the upload');
  assert.equal((await get(`/api/uploads/${id}/file`)).status, 403, 'download needs an admin login');

  // restart with an empty local disk, as a cloud server does after sleeping
  await new Promise(res => setTimeout(res, 600)); await stop();
  fs.rmSync(path.join(TMP, 'db'), { recursive: true, force: true }); fs.rmSync(path.join(TMP, 'Uploads'), { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(TMP, 'store', 'production.db')), 'database is in the private store');
  await start();
  const c2 = await adminCookie();
  const ups2 = await (await get('/api/uploads', c2)).json();
  assert.equal(ups2.length, 1); assert.equal(ups2[0].file_name, 'security-test.xlsx');
  const users = (await (await get('/api/settings', c2)).json()).users.map(u => u.username);
  assert.ok(users.includes('viewer1'), 'user accounts survive a restart');
  const dl2 = await get(`/api/uploads/${id}/file`, c2); assert.equal(dl2.status, 200);
  assert.ok(Buffer.from(await dl2.arrayBuffer()).equals(file), 'original file is restored from the private store');
});

test('repeated wrong passwords lock the login (brute-force protection)', async () => {
  const ip = { 'X-Forwarded-For': '10.1.2.3' }; // the test server is started without a trusted proxy, so all requests share one address
  let last = 0;
  for (let i = 0; i < 5; i++) { last = (await login(ADMIN, 'wrong-password-' + i)).status; assert.equal(last, 401); }
  const locked = await login(ADMIN, 'wrong-password-x'); assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await login(ADMIN, PASS, ip)).status, 429, 'even the correct password is refused while locked');
});

test('an expired session stops working', async () => {
  await stop(); await start({ PDA_SESSION_IDLE_HOURS: '0.00005' }); // idle limit of 0.18 seconds for this test
  const c = await adminCookie();
  assert.equal((await get('/api/page/home', c)).status, 200);
  await new Promise(res => setTimeout(res, 400));
  assert.equal((await get('/api/page/home', c)).status, 401);
});
