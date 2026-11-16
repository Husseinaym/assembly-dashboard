'use strict';
/**
 * Sign-in security: password rules, administrator bootstrap, sessions, cookies and brute-force protection.
 * No account or password is ever built into the code. The first administrator comes only from the
 * PDA_ADMIN_USER / PDA_ADMIN_PIN secrets of the hosting provider (or environment variables on a PC).
 */
const crypto = require('crypto');

const HOUR = 3600 * 1000;
const SESSION_MAX_MS = (Number(process.env.PDA_SESSION_MAX_HOURS) || 7 * 24) * HOUR;   // a session never lives longer than this
const SESSION_IDLE_MS = (Number(process.env.PDA_SESSION_IDLE_HOURS) || 24) * HOUR;     // ... and ends after this long without use
const COOKIE = 'pda_session';
const WEAK = new Set(['admin', 'viewer', 'password', 'passw0rd', '12345678', '123456789', '1234567890', 'qwertyui', 'sewse123', '00000000', '11111111', 'changeme', 'letmein1']);

// ---------- passwords ----------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function verifyPassword(pw, salt, hash) {
  const a = Buffer.from(hashPassword(pw, salt).hash, 'hex'), b = Buffer.from(String(hash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** Returns an error text, or null when the password is acceptable. */
function passwordProblem(pw, username = '') {
  pw = String(pw || '');
  if (pw.length < 8) return 'The password must have at least 8 characters';
  if (pw.length > 200) return 'The password is too long';
  if (WEAK.has(pw.toLowerCase()) || pw.toLowerCase() === String(username).toLowerCase()) return 'This password is too easy to guess';
  if (/^(.)\1+$/.test(pw)) return 'This password is too easy to guess';
  return null;
}
function usernameProblem(u) {
  u = String(u || '');
  return /^[\w.@-]{2,40}$/.test(u) ? null : 'The user name must be 2 to 40 letters, digits, dot, dash or underscore';
}

// ---------- administrator bootstrap (fail securely) ----------
/**
 * Removes any account that still uses a well-known default password, applies the administrator from the
 * environment, and refuses to continue when no administrator exists. Throws an Error with code 'NO_ADMIN'.
 */
function ensureAdmin(db, env = process.env) {
  let removed = 0;
  for (const u of db.prepare('SELECT username, salt, hash FROM users').all()) {
    if (['admin', 'viewer', u.username].some(d => verifyPassword(d, u.salt, u.hash))) {
      db.prepare('DELETE FROM users WHERE username=?').run(u.username);
      db.prepare('DELETE FROM sessions WHERE username=?').run(u.username);
      removed++;
    }
  }
  if (removed) console.log(`Security: removed ${removed} account(s) that used a default password.`);
  const user = (env.PDA_ADMIN_USER || '').trim(), pin = env.PDA_ADMIN_PIN || '';
  if (user || pin) {
    const bad = !user || !pin ? 'Both PDA_ADMIN_USER and PDA_ADMIN_PIN must be set' : usernameProblem(user) || passwordProblem(pin, user);
    if (bad) { const e = new Error(`Administrator secret rejected: ${bad}.`); e.code = 'NO_ADMIN'; throw e; }
    const cur = db.prepare('SELECT salt, hash, role FROM users WHERE lower(username)=lower(?)').get(user);
    if (!cur || cur.role !== 'admin' || !verifyPassword(pin, cur.salt, cur.hash)) {
      const h = hashPassword(pin);
      db.prepare('DELETE FROM users WHERE lower(username)=lower(?)').run(user);
      db.prepare('INSERT INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run(user, h.salt, h.hash, 'admin');
      db.prepare('DELETE FROM sessions WHERE lower(username)=lower(?)').run(user);
      console.log('Security: administrator account set from the environment.');
    }
  }
  if (!db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n) {
    const e = new Error('No administrator account exists. Set the secrets PDA_ADMIN_USER and PDA_ADMIN_PIN (at least 8 characters) and start again. The website does not start without them.');
    e.code = 'NO_ADMIN'; throw e;
  }
  return removed;
}

// ---------- sessions ----------
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  if (!cols.includes('expires_at')) db.exec('ALTER TABLE sessions ADD COLUMN expires_at INTEGER');
  if (!cols.includes('last_seen')) db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER');
  db.prepare('DELETE FROM sessions WHERE expires_at IS NULL OR expires_at < ?').run(Date.now()); // old-style and expired sessions
}
/** Only a hash of the token is stored, so a copy of the database cannot be used to take over a session. */
function createSession(db, username) {
  const token = crypto.randomBytes(32).toString('hex'); const now = Date.now();
  db.prepare('INSERT INTO sessions(token,username,created_at,expires_at,last_seen) VALUES(?,?,?,?,?)').run(sha(token), username, new Date(now).toISOString(), now + SESSION_MAX_MS, now);
  return token;
}
function readSession(db, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const key = sha(token); const now = Date.now();
  const s = db.prepare('SELECT s.username, s.expires_at, s.last_seen, u.role FROM sessions s JOIN users u ON u.username=s.username WHERE s.token=?').get(key);
  if (!s) return null;
  if (s.expires_at < now || now - (s.last_seen || 0) > SESSION_IDLE_MS) { db.prepare('DELETE FROM sessions WHERE token=?').run(key); return null; }
  if (now - s.last_seen > 5 * 60 * 1000) db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(now, key);
  return { username: s.username, role: s.role };
}
function destroySession(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(token)); }
function destroyUserSessions(db, username) { db.prepare('DELETE FROM sessions WHERE lower(username)=lower(?)').run(username); }

// ---------- cookies ----------
function parseCookies(req) { const o = {}; for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore a broken cookie */ } } } return o; }
/** HTTPS-only cookies in the cloud, or whenever the request came over HTTPS. */
function isSecure(req) { return process.env.PDA_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production' || !!process.env.SPACE_ID || req.secure; }
function sessionCookie(req, token) {
  const base = `${COOKIE}=${token || ''}; HttpOnly; Path=/; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`;
  return token ? `${base}; Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}` : `${base}; Max-Age=0`;
}

// ---------- brute-force protection ----------
const WINDOW = 15 * 60 * 1000, LOCK = 15 * 60 * 1000;
const LIMITS = { pair: 5, user: 10, ip: 30 }; // failed attempts allowed inside the window
const fails = new Map(); // key -> { n, first, until }
function bucket(key) { const now = Date.now(); let b = fails.get(key); if (!b || (now - b.first > WINDOW && now > b.until)) { b = { n: 0, first: now, until: 0 }; fails.set(key, b); } return b; }
function keysFor(ip, username) { const u = String(username || '').toLowerCase().slice(0, 60); return [['pair', `p|${ip}|${u}`], ['user', `u|${u}`], ['ip', `i|${ip}`]]; }
/** Seconds the caller must wait, or 0 when a login attempt is allowed. */
function lockedFor(ip, username) {
  const now = Date.now(); let wait = 0;
  for (const [, k] of keysFor(ip, username)) { const b = fails.get(k); if (b && b.until > now) wait = Math.max(wait, Math.ceil((b.until - now) / 1000)); }
  return wait;
}
function recordFailure(ip, username) { for (const [kind, k] of keysFor(ip, username)) { const b = bucket(k); b.n++; if (b.n >= LIMITS[kind]) b.until = Date.now() + LOCK; } }
function recordSuccess(ip, username) { fails.delete(`p|${ip}|${String(username || '').toLowerCase().slice(0, 60)}`); }
setInterval(() => { const now = Date.now(); for (const [k, b] of fails) if (now - b.first > WINDOW && now > b.until) fails.delete(k); }, 10 * 60 * 1000).unref();

/** Check a user name and password. Always spends the same time, whether or not the user exists. */
const DUMMY = hashPassword(crypto.randomBytes(8).toString('hex'));
function checkLogin(db, username, password) {
  const u = db.prepare('SELECT username, salt, hash, role FROM users WHERE lower(username)=lower(?)').get(String(username || '').trim());
  const ok = verifyPassword(String(password || ''), u ? u.salt : DUMMY.salt, u ? u.hash : DUMMY.hash);
  return u && ok ? { username: u.username, role: u.role } : null;
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, passwordProblem, usernameProblem, ensureAdmin, migrate,
  createSession, readSession, destroySession, destroyUserSessions, parseCookies, sessionCookie, isSecure,
  lockedFor, recordFailure, recordSuccess, checkLogin, LIMITS,
};
