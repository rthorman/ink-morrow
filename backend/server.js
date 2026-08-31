'use strict';

// Entry point: loads config, wires up the database, serves the app.
// The app itself lives in src/app.js so tests can create isolated instances.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');

// Newly-created local secrets and media should never become group/world
// readable merely because the shell has a permissive default umask.
process.umask(0o077);
try { fs.chmodSync(path.join(__dirname, '.env'), 0o600); } catch { /* missing on first launch or unsupported */ }
const defaultStorageRoot = path.join(__dirname, '../database');
fs.mkdirSync(defaultStorageRoot, { recursive: true, mode: 0o700 });
try { fs.chmodSync(defaultStorageRoot, 0o700); } catch { /* permissions are best-effort off POSIX */ }

const dbPath = process.env.DB_PATH || path.join(defaultStorageRoot, 'scribe-tribe.db');
const db = createDb(dbPath);

const PORT = parseInt(process.env.PORT || '3000', 10);
// Local-only is the safe default. Direct LAN HTTP must be a deliberate
// opt-in; HTTPS through a local reverse proxy can keep this loopback bind.
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const allowLan = !LOOPBACK_HOSTS.has(HOST);
if (allowLan && process.env.ALLOW_INSECURE_LAN !== '1') {
  console.error(`Refusing to bind ScribeTribe to ${HOST} over unencrypted HTTP.`);
  console.error('Use a local HTTPS reverse proxy, or set ALLOW_INSECURE_LAN=1 only on a trusted network.');
  db.close();
  process.exit(1);
}
if (allowLan) console.warn('Warning: ScribeTribe is accepting direct, unencrypted LAN connections.');

const allowedHosts = String(process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const authOptions = {};
if (process.env.NODE_ENV === 'e2e') {
  authOptions.setupCode = process.env.AUTH_SETUP_CODE || 'E2E-SETUP-CODE';
  authOptions.scryptParams = { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 };
  authOptions.delay = async () => {};
}
const app = createApp(db, {
  // The executable entry point is always sealed, even if a caller happens to
  // use NODE_ENV=test. Only direct in-memory unit-test composers opt out.
  authRequired: true,
  allowLan,
  allowedHosts,
  trustProxy: process.env.TRUST_PROXY === '1',
  authOptions,
});

const server = app.listen(PORT, HOST, () => {
  console.log(`ScribeTribe (API + frontend) serving on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received - closing down...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    process.exit(0);
  });
  // Force-exit if close hangs
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, db };
