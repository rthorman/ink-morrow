'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const path = require('node:path');
const { createDb } = require('./src/db');
const { resetAuthentication } = require('./src/modules/auth/service');

process.umask(0o077);

if (!process.argv.includes('--yes')) {
  console.error('Stop ScribeTribe, then run: npm run auth:reset -- --yes');
  console.error('This removes only the local password and browser sessions. Stories and assets are untouched.');
  process.exit(2);
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '../database/scribe-tribe.db');
const db = createDb(dbPath);
try {
  resetAuthentication(db);
  console.log('The local password and all browser sessions were removed.');
  console.log('Start ScribeTribe again and use the new one-time setup code printed in this terminal.');
} finally {
  db.close();
}
