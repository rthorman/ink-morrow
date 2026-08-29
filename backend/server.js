'use strict';

// Entry point: loads config, wires up the database, serves the app.
// The app itself lives in src/app.js so tests can create isolated instances.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const { createDb } = require('./src/db');
const { createApp } = require('./src/app');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../database/scribe-tribe.db');
const db = createDb(dbPath);
const app = createApp(db);

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = app.listen(PORT, () => {
  console.log(`ScribeTribe (API + frontend) serving on http://localhost:${PORT}`);
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