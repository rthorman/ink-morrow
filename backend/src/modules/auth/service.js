'use strict';

const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'st_session';
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const COMMON_PASSWORDS = new Set([
  'passwordpassword', 'password123456', 'password123456789', 'qwertyuiopasdfgh',
  'letmeinletmein', 'iloveyouiloveyou', 'correcthorsebatterystaple',
  'scribetribescribetribe', 'scribetribe12345', 'thequickbrownfox',
  'adminadminadmin', 'welcome123456789', 'changemechangeme',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* malformed cookie */ }
  }
  return cookies;
}

function normalizePassword(value) {
  return typeof value === 'string' ? value.normalize('NFC') : null;
}

function passwordProblem(value) {
  const password = normalizePassword(value);
  if (password === null) return 'Password must be text.';
  const length = [...password].length;
  if (length < 15) return 'Use at least 15 characters.';
  if (length > 128) return 'Use no more than 128 characters.';
  if (COMMON_PASSWORDS.has(password.toLocaleLowerCase('en-US'))) {
    return 'That password is too commonly guessed. Choose a more distinctive phrase.';
  }
  return null;
}

function setupCodeValue() {
  return randomBytes(12).toString('hex').toUpperCase().match(/.{1,6}/g).join('-');
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookie(token, { remember, secure }) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (remember) parts.push(`Max-Age=${30 * 24 * 60 * 60}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(secure) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function createAuthService({
  db,
  logger = console,
  enabled = true,
  setupCode = null,
  scryptParams = DEFAULT_SCRYPT,
  now = () => Date.now(),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const firstRunCode = setupCode || setupCodeValue();
  const attempts = new Map();
  let lastCleanup = 0;
  let lastAttemptCleanup = 0;

  const ownerRow = () => db.prepare('SELECT * FROM auth_owner WHERE id = 1').get();
  const ownerExists = () => Boolean(ownerRow());
  const deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');

  if (enabled && !ownerExists()) {
    logger.log('ScribeTribe needs its first password. Enter this one-time setup code in the browser:');
    logger.log(firstRunCode);
  }

  async function derive(password, salt, params) {
    return scrypt(password, salt, 64, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem || DEFAULT_SCRYPT.maxmem,
    });
  }

  async function makePasswordRecord(password) {
    const salt = randomBytes(16);
    const hash = await derive(password, salt, scryptParams);
    return {
      hash: hash.toString('base64'),
      salt: salt.toString('base64'),
      N: scryptParams.N,
      r: scryptParams.r,
      p: scryptParams.p,
    };
  }

  async function passwordMatches(password, owner) {
    const normalized = normalizePassword(password);
    if (normalized === null) return false;
    const actual = await derive(normalized, Buffer.from(owner.password_salt, 'base64'), {
      N: owner.scrypt_n,
      r: owner.scrypt_r,
      p: owner.scrypt_p,
      maxmem: Math.max(DEFAULT_SCRYPT.maxmem, 128 * owner.scrypt_n * owner.scrypt_r + 1024 * 1024),
    });
    const expected = Buffer.from(owner.password_hash, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  function attemptKey(req, action) {
    return `${action}:${req.ip || req.socket?.remoteAddress || 'local'}`;
  }

  function rateState(req, action) {
    const key = attemptKey(req, action);
    const timestamp = now();
    if (timestamp - lastAttemptCleanup >= 60 * 1000 || attempts.size >= 1000) {
      lastAttemptCleanup = timestamp;
      for (const [attemptKeyValue, value] of attempts) {
        if (timestamp - value.startedAt > 15 * 60 * 1000) attempts.delete(attemptKeyValue);
      }
      // A local app should never approach this in ordinary use. The cap keeps
      // spoofed proxy addresses from turning throttling state into a memory DoS.
      while (attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
    }
    const current = attempts.get(key);
    if (!current || timestamp - current.startedAt > 15 * 60 * 1000) {
      const fresh = { key, failures: 0, startedAt: timestamp };
      attempts.set(key, fresh);
      return fresh;
    }
    return current;
  }

  function assertRate(req, action) {
    const state = rateState(req, action);
    if (state.failures < 10) return state;
    const error = new Error('Too many attempts. Wait a few minutes and try again.');
    error.statusCode = 429;
    error.retryAfter = Math.max(1, Math.ceil((15 * 60 * 1000 - (now() - state.startedAt)) / 1000));
    throw error;
  }

  async function recordFailure(state) {
    state.failures += 1;
    await delay(Math.min(2000, 125 * 2 ** Math.min(state.failures - 1, 4)));
  }

  function clearAttempts(state) {
    attempts.delete(state.key);
  }

  function cleanupSessions() {
    const timestamp = now();
    if (timestamp - lastCleanup < 60 * 1000) return;
    lastCleanup = timestamp;
    db.prepare('DELETE FROM auth_sessions WHERE absolute_expires_at <= ? OR last_seen_at + idle_timeout_ms <= ?')
      .run(timestamp, timestamp);
  }

  function sessionFromRequest(req, { touch = true } = {}) {
    cleanupSessions();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = sha256(token);
    const row = db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(tokenHash);
    if (!row) return null;
    const timestamp = now();
    if (timestamp >= row.absolute_expires_at || timestamp - row.last_seen_at >= row.idle_timeout_ms) {
      deleteSession.run(tokenHash);
      return null;
    }
    if (touch && timestamp - row.last_seen_at >= 5 * 60 * 1000) {
      db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(timestamp, tokenHash);
      row.last_seen_at = timestamp;
    }
    return { ...row, tokenHash };
  }

  function createSession(req, res, remember) {
    const timestamp = now();
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const idleTimeout = remember ? 7 * DAY : 8 * 60 * 60 * 1000;
    const absoluteExpires = timestamp + (remember ? 30 * DAY : DAY);
    db.prepare(`
      INSERT INTO auth_sessions
        (token_hash, csrf_token, created_at, last_seen_at, absolute_expires_at, idle_timeout_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sha256(token), csrfToken, timestamp, timestamp, absoluteExpires, idleTimeout);
    res.setHeader('Set-Cookie', sessionCookie(token, { remember, secure: req.secure }));
    return { state: 'unlocked', csrf_token: csrfToken, expires_at: absoluteExpires };
  }

  function status(req) {
    if (!enabled) return { state: 'disabled' };
    if (!ownerExists()) return { state: 'setup-required' };
    const session = sessionFromRequest(req);
    if (!session) return { state: 'locked' };
    return { state: 'unlocked', csrf_token: session.csrf_token, expires_at: session.absolute_expires_at };
  }

  async function setup(req, res, { code, password, remember = true }) {
    if (!enabled) return { state: 'disabled' };
    if (ownerExists()) {
      const error = new Error('Initial password setup is already complete.');
      error.statusCode = 409;
      throw error;
    }
    const attempt = assertRate(req, 'setup');
    if (!safeEqualText(String(code || '').trim().toUpperCase(), firstRunCode)) {
      await recordFailure(attempt);
      const error = new Error('The setup code was not accepted.');
      error.statusCode = 401;
      throw error;
    }
    const problem = passwordProblem(password);
    if (problem) {
      const error = new Error(problem);
      error.statusCode = 400;
      throw error;
    }
    const normalized = normalizePassword(password);
    const record = await makePasswordRecord(normalized);
    const timestamp = now();
    try {
      db.prepare(`
        INSERT INTO auth_owner
          (id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.hash, record.salt, record.N, record.r, record.p, timestamp, timestamp);
    } catch {
      const error = new Error('Initial password setup was completed by another request.');
      error.statusCode = 409;
      throw error;
    }
    clearAttempts(attempt);
    return createSession(req, res, Boolean(remember));
  }

  async function login(req, res, { password, remember = true }) {
    if (!enabled) return { state: 'disabled' };
    const owner = ownerRow();
    if (!owner) {
      const error = new Error('Initial password setup is required.');
      error.statusCode = 409;
      error.state = 'setup-required';
      throw error;
    }
    const attempt = assertRate(req, 'login');
    if (!(await passwordMatches(password, owner))) {
      await recordFailure(attempt);
      const error = new Error('The password was not accepted.');
      error.statusCode = 401;
      throw error;
    }
    clearAttempts(attempt);
    return createSession(req, res, Boolean(remember));
  }

  function requireAuth(req, res, next) {
    if (!enabled) return next();
    if (!ownerExists()) {
      return res.status(401).json({ error: 'Initial password setup is required.', code: 'AUTH_REQUIRED', state: 'setup-required' });
    }
    const session = sessionFromRequest(req);
    if (!session) {
      res.setHeader('Set-Cookie', clearCookie(req.secure));
      return res.status(401).json({ error: 'Unlock ScribeTribe to continue.', code: 'AUTH_REQUIRED', state: 'locked' });
    }
    req.authSession = session;
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  }

  function requireSameOrigin(req, res, next) {
    const origin = req.get('Origin');
    const fetchSite = req.get('Sec-Fetch-Site');
    if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not permitted.' });
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.host.toLowerCase() !== String(req.get('host') || '').toLowerCase() || parsed.protocol !== `${req.protocol}:`) {
          return res.status(403).json({ error: 'The request origin is not permitted.' });
        }
      } catch {
        return res.status(403).json({ error: 'The request origin is not permitted.' });
      }
    }
    next();
  }

  function requireCsrf(req, res, next) {
    if (!enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('X-ScribeTribe-CSRF') || '';
    const expected = req.authSession?.csrf_token || '';
    if (!supplied || !expected || !safeEqualText(supplied, expected)) {
      return res.status(403).json({ error: 'The request could not be verified. Refresh and try again.', code: 'CSRF_REQUIRED' });
    }
    next();
  }

  function logout(req, res) {
    if (req.authSession) deleteSession.run(req.authSession.tokenHash);
    res.setHeader('Set-Cookie', clearCookie(req.secure));
    return { state: ownerExists() ? 'locked' : 'setup-required' };
  }

  async function changePassword(req, res, { currentPassword, newPassword }) {
    const attempt = assertRate(req, 'change-password');
    const remember = Number(req.authSession?.idle_timeout_ms) > DAY;
    const owner = ownerRow();
    if (!owner || !(await passwordMatches(currentPassword, owner))) {
      await recordFailure(attempt);
      const error = new Error('The current password was not accepted.');
      error.statusCode = 401;
      throw error;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      const error = new Error(problem);
      error.statusCode = 400;
      throw error;
    }
    const record = await makePasswordRecord(normalizePassword(newPassword));
    const timestamp = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE auth_owner
           SET password_hash = ?, password_salt = ?, scrypt_n = ?, scrypt_r = ?, scrypt_p = ?, updated_at = ?
         WHERE id = 1
      `).run(record.hash, record.salt, record.N, record.r, record.p, timestamp);
      db.prepare('DELETE FROM auth_sessions').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    clearAttempts(attempt);
    return createSession(req, res, remember);
  }

  return {
    enabled,
    setupCode: firstRunCode,
    ownerExists,
    status,
    setup,
    login,
    logout,
    changePassword,
    requireAuth,
    requireSameOrigin,
    requireCsrf,
    sessionFromRequest,
  };
}

function resetAuthentication(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM auth_sessions').run();
    db.prepare('DELETE FROM auth_owner').run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  createAuthService,
  resetAuthentication,
  passwordProblem,
  SESSION_COOKIE,
  DEFAULT_SCRYPT,
};
