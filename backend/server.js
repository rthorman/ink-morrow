'use strict';

// Entry point: loads config, wires up the database, serves the app.
// The app itself lives in src/app.js so tests can create isolated instances.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');
const { storagePaths } = require('./src/core/storage');

// Newly-created local secrets and media should never become group/world
// readable merely because the shell has a permissive default umask.
process.umask(0o077);
try { fs.chmodSync(path.join(__dirname, '.env'), 0o600); } catch { /* missing on first launch or unsupported */ }
const storage = storagePaths();
const dbPath = storage.dbPath;
const storageRoot = storage.ephemeral ? fs.mkdtempSync(path.join(os.tmpdir(), 'inkmorrow-ephemeral-')) : storage.storageRoot;
if (storage.ephemeral) process.once('exit', () => {
  // Only this process's unique disposable in-memory-runtime directory.
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

let db;
try {
  // Inspection reads source files into a private scratch copy. SQLite cannot
  // touch historical database/sidecar files before family/version acceptance.
  db = createDb(dbPath);
} catch (error) {
  console.error(error.message || 'Ink Morrow could not open its database.');
  process.exit(1);
}
fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
try { fs.chmodSync(storageRoot, 0o700); } catch { /* permissions are best-effort off POSIX */ }

const PORT = parseInt(process.env.PORT || '3000', 10);
// Local-only is the safe default. Direct LAN HTTP must be a deliberate
// opt-in; HTTPS through a local reverse proxy can keep this loopback bind.
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const allowLan = !LOOPBACK_HOSTS.has(HOST);
if (allowLan && process.env.ALLOW_INSECURE_LAN !== '1') {
  console.error(`Refusing to bind Ink Morrow to ${HOST} over unencrypted HTTP.`);
  console.error('Use a local HTTPS reverse proxy, or set ALLOW_INSECURE_LAN=1 only on a trusted network.');
  db.close();
  process.exit(1);
}
if (allowLan) console.warn('Warning: Ink Morrow is accepting direct, unencrypted LAN connections.');

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
  legacyEnabled: false,
  allowLan,
  allowedHosts,
  trustProxy: process.env.TRUST_PROXY === '1',
  authOptions,
  imageDir: path.join(storageRoot, 'images'),
  audioDir: path.join(storageRoot, 'audio'),
  transferDir: path.join(storageRoot, 'transfers'),
});

let server = null;
const started = (async () => {
  try {
    await app.locals.validateStartup?.();
  } catch (error) {
    console.error(error.message || 'Ink Morrow could not validate its configured AI models.');
    try { app.locals.dispose?.(); } catch { /* already disposed */ }
    try { db.close(); } catch { /* already closed */ }
    process.exitCode = 1;
    return null;
  }
  server = app.listen(PORT, HOST, () => {
    console.log(`Ink Morrow (API + frontend) serving on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  });
  return server;
})();

function shutdown(signal) {
  console.log(`\n${signal} received - closing down...`);
  if (!server) {
    try { app.locals.dispose?.(); } catch { /* already disposed */ }
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
    return;
  }
  server.close(() => {
    try {
      app.locals.dispose?.();
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

module.exports = { app, get server() { return server; }, db, started };
