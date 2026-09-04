'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const fs = require('node:fs');
const { createDb } = require('./src/db');
const { resetAuthentication } = require('./src/modules/auth/service');
const { storagePaths } = require('./src/core/storage');

process.umask(0o077);

if (!process.argv.includes('--yes')) {
  console.error('Stop Ink Morrow, then run: npm run auth:reset -- --yes');
  console.error('This removes the local password, browser sessions, and saved provider credentials. Stories and assets are untouched.');
  process.exit(2);
}

const { dbPath } = storagePaths();
if (dbPath === ':memory:' || !fs.existsSync(dbPath)) {
  console.error(`No persistent database exists at ${dbPath}. Check DATA_DIR/DB_PATH. Nothing was removed.`);
  process.exit(2);
}
const db = createDb(dbPath);
try {
  resetAuthentication(db);
  console.log('The local password, all browser sessions, and saved provider credentials were removed.');
  console.log('Start Ink Morrow again and use the new one-time setup code printed in this terminal.');
} finally {
  db.close();
}
