'use strict';

const path = require('node:path');

// The executable and password-reset utility must resolve exactly the same file.
// Relative environment overrides are relative to backend/, never shell cwd.
function storagePaths(env = process.env, backendDirectory = path.resolve(__dirname, '../..')) {
  const resolve = (value) => path.isAbsolute(value) ? value : path.resolve(backendDirectory, value);
  if (env.DATA_DIR === ':memory:') throw new Error('DATA_DIR must name a directory; use DB_PATH=:memory: for isolated ephemeral storage.');
  const defaultRoot = path.resolve(backendDirectory, '../database-v5');
  const configuredRoot = env.DATA_DIR ? resolve(env.DATA_DIR) : null;
  const dbPath = env.DB_PATH ? (env.DB_PATH === ':memory:' ? ':memory:' : resolve(env.DB_PATH)) : path.join(configuredRoot || defaultRoot, 'ink-morrow-5.db');
  const ephemeral = dbPath === ':memory:' && !configuredRoot;
  return { dbPath, storageRoot: configuredRoot || (ephemeral ? null : env.DB_PATH ? path.dirname(dbPath) : defaultRoot), ephemeral };
}

module.exports = { storagePaths };
