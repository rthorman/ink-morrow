'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const {
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  SQLITE_APPLICATION_ID,
} = require('./release');
const { reconcileInterruptedOperations } = require('./core/operation-journal');

const LEGACY_TABLES = new Set([
  'worlds',
  'characters',
  'stories',
  'story_pages',
  'story_previews',
  'story_memory_pages',
  'auth_owner',
]);

// PR 01 establishes the durable 4.0 identity and empty target-domain tables.
// The 3.2.2-shaped catalogue tables remain as a temporary runtime seam so the
// release branch stays bootable while PRs 02–06 move behavior onto the new
// hierarchy/revision/operation model. A database made by 3.x is still refused:
// these tables are created only inside a database already branded scribetribe-4.
const SCHEMA_V1 = `
CREATE TABLE scribe_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  family TEXT NOT NULL CHECK (family = 'scribetribe-4'),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO scribe_schema (singleton, family, version)
VALUES (1, 'scribetribe-4', 0);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  setting TEXT,
  lore TEXT,
  image_prompt TEXT,
  image_status TEXT NOT NULL DEFAULT 'none',
  image_media_type TEXT,
  image_cost_usd REAL,
  image_updated_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  appearance TEXT,
  background TEXT,
  world_id TEXT REFERENCES worlds (id),
  image_prompt TEXT,
  image_status TEXT NOT NULL DEFAULT 'none',
  image_media_type TEXT,
  image_cost_usd REAL,
  image_updated_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  world_id TEXT REFERENCES worlds (id),
  characters TEXT NOT NULL DEFAULT '[]',
  tone TEXT NOT NULL DEFAULT 'fade-to-black'
    CHECK (tone IN ('fade-to-black', 'romantic', 'explicit')),
  image_status TEXT NOT NULL DEFAULT 'none',
  image_media_type TEXT,
  image_cost_usd REAL,
  image_updated_at TEXT,
  image_prompt TEXT,
  continuity_overrides TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE story_pages (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  user_input TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  image_media_type TEXT,
  image_prompt TEXT,
  continuity_model TEXT,
  continuity_prompt_tokens INTEGER,
  continuity_completion_tokens INTEGER,
  continuity_cost_usd REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (story_id, page_number)
);

CREATE INDEX idx_pages_story ON story_pages (story_id, page_number);
CREATE INDEX idx_characters_world ON characters (world_id);
CREATE INDEX idx_stories_world ON stories (world_id);

CREATE TABLE story_previews (
  story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  expected_page INTEGER NOT NULL,
  raw_content TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE story_character_snapshots (
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  appearance TEXT,
  background TEXT,
  source_updated_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (story_id, character_id)
);

CREATE TABLE story_memory_pages (
  page_id TEXT PRIMARY KEY REFERENCES story_pages (id) ON DELETE CASCADE,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  summary TEXT,
  delta_json TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_story_memory_pages_story
  ON story_memory_pages (story_id, status);

CREATE TABLE story_memory_search (
  page_id TEXT PRIMARY KEY REFERENCES story_pages (id) ON DELETE CASCADE,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  content TEXT NOT NULL
);

CREATE INDEX idx_story_memory_search_story
  ON story_memory_search (story_id);

CREATE TRIGGER story_pages_invalidate_memory
AFTER UPDATE OF content ON story_pages
WHEN OLD.content <> NEW.content BEGIN
  DELETE FROM story_memory_pages WHERE page_id = OLD.id;
  DELETE FROM story_memory_search WHERE page_id = OLD.id;
END;

CREATE TABLE audiobooks (
  story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  pages_done INTEGER NOT NULL DEFAULT 0,
  pages_total INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER,
  duration_s INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  fingerprint TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  scrypt_n INTEGER NOT NULL,
  scrypt_r INTEGER NOT NULL,
  scrypt_p INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  idle_timeout_ms INTEGER NOT NULL
);

CREATE INDEX idx_auth_sessions_expiry
  ON auth_sessions (absolute_expires_at);

-- Empty 4.0 manuscript hierarchy. PR 02 will own its store and API behavior.
CREATE TABLE volumes (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (story_id, ordinal)
);

CREATE INDEX idx_volumes_story_order ON volumes (story_id, ordinal);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  volume_id TEXT NOT NULL REFERENCES volumes (id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (volume_id, ordinal)
);

CREATE INDEX idx_chapters_volume_order ON chapters (volume_id, ordinal);

CREATE TABLE pages (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  chapter_id TEXT NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  canonical_revision_id TEXT,
  display_revision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chapter_id, ordinal),
  CHECK ((canonical_revision_id IS NULL) = (display_revision_id IS NULL)),
  FOREIGN KEY (canonical_revision_id) REFERENCES page_revisions (id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (display_revision_id) REFERENCES page_revisions (id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_pages_chapter_order ON pages (chapter_id, ordinal);

CREATE TABLE page_revisions (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  parent_revision_id TEXT REFERENCES page_revisions (id),
  kind TEXT NOT NULL CHECK (kind IN ('canonical', 'copyedit')),
  content TEXT NOT NULL,
  direction TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (parent_revision_id IS NULL OR parent_revision_id <> id)
);

CREATE INDEX idx_page_revisions_page_time ON page_revisions (page_id, created_at, id);

CREATE TABLE prepared_pages (
  story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
  expected_tail_revision_id TEXT REFERENCES page_revisions (id),
  context_fingerprint TEXT NOT NULL CHECK (length(context_fingerprint) = 64),
  content TEXT NOT NULL,
  provider_result_json TEXT,
  spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE writing_operations (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('tail_edit', 'prepare', 'promote', 'directed_generate', 'truncate', 'restore')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'provider_pending', 'provider_complete', 'committed', 'failed', 'cancelled', 'interrupted')),
  expected_tail_revision_id TEXT REFERENCES page_revisions (id),
  context_fingerprint TEXT,
  provider_result_json TEXT,
  spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE (story_id, idempotency_key)
);

CREATE INDEX idx_writing_operations_story_status
  ON writing_operations (story_id, status, created_at);

CREATE TABLE continuity_deltas (
  revision_id TEXT PRIMARY KEY REFERENCES page_revisions (id) ON DELETE CASCADE,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  delta_json TEXT,
  provider_result_json TEXT,
  spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_continuity_deltas_story_status
  ON continuity_deltas (story_id, status);

CREATE TABLE continuity_corrections (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('story', 'world', 'character', 'goal', 'thread')),
  subject_id TEXT,
  correction_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_continuity_corrections_story
  ON continuity_corrections (story_id, created_at);

CREATE TABLE continuity_issues (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  correction_id TEXT NOT NULL REFERENCES continuity_corrections (id) ON DELETE CASCADE,
  page_revision_id TEXT NOT NULL REFERENCES page_revisions (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (correction_id, page_revision_id)
);

CREATE TABLE template_snapshots (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  template_kind TEXT NOT NULL CHECK (template_kind IN ('world', 'character')),
  source_template_id TEXT NOT NULL CHECK (length(trim(source_template_id)) > 0),
  source_revision TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (story_id, template_kind, source_template_id, id)
);

CREATE INDEX idx_template_snapshots_story
  ON template_snapshots (story_id, template_kind, source_template_id, created_at);

CREATE TABLE recovery_suffixes (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  anchor_page_id TEXT REFERENCES pages (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('recoverable', 'restored', 'expired', 'exported')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_recovery_suffixes_story_status
  ON recovery_suffixes (story_id, status, expires_at);

CREATE TABLE assets (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT REFERENCES stories (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('uploaded', 'generated')),
  status TEXT NOT NULL CHECK (status IN ('staging', 'ready', 'failed')),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  storage_key TEXT NOT NULL UNIQUE CHECK (length(trim(storage_key)) > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  metadata_json TEXT,
  provider_result_json TEXT,
  spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_assets_story_created ON assets (story_id, created_at);

CREATE TABLE asset_placements (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  after_page_id TEXT REFERENCES pages (id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  alt_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_asset_placements_anchor_order
  ON asset_placements (story_id, COALESCE(after_page_id, ''), ordinal);

CREATE TABLE publication_snapshots (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  document_json TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_publication_snapshots_story
  ON publication_snapshots (story_id, created_at);

CREATE TABLE shares (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  publication_snapshot_id TEXT NOT NULL REFERENCES publication_snapshots (id) ON DELETE CASCADE,
  capability_hash TEXT NOT NULL UNIQUE CHECK (length(capability_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE INDEX idx_shares_snapshot_status
  ON shares (publication_snapshot_id, status);

CREATE TABLE operation_journal (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  subject_type TEXT,
  subject_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'committed', 'failed', 'cancelled', 'interrupted')),
  request_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  CHECK ((status = 'pending' AND finished_at IS NULL) OR
         (status <> 'pending' AND finished_at IS NOT NULL))
);

CREATE UNIQUE INDEX idx_operation_journal_idempotency
  ON operation_journal (kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_operation_journal_status
  ON operation_journal (status, started_at);
`;

const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: '4.0 kernel and schema identity',
    checksumSource: SCHEMA_V1,
    up(db) {
      db.exec(SCHEMA_V1);
    },
  }),
]);

if (MIGRATIONS[MIGRATIONS.length - 1].version !== DATABASE_SCHEMA_VERSION) {
  throw new Error('DATABASE_SCHEMA_VERSION must match the latest migration');
}

class DatabaseCompatibilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DatabaseCompatibilityError';
    this.code = code;
  }
}

function migrationChecksum(migration) {
  const source = migration.checksumSource || migration.up.toString();
  return createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${source}`)
    .digest('hex');
}

function databaseMessage(dbPath, detail) {
  const displayPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
  return `${detail} Database: ${displayPath}. ` +
    'The database was not modified. Set DATA_DIR to a new empty directory ' +
    '(or DB_PATH to a new file), or use ScribeTribe 3.2.2 with existing 3.x data.';
}

function verifyMigrationLedger(db, version, migrations = MIGRATIONS) {
  if (version === 0) return;
  const rows = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
  if (rows.length !== version) {
    throw new DatabaseCompatibilityError(
      'INVALID_MIGRATION_LEDGER',
      `The schema says version ${version}, but its migration ledger has ${rows.length} entries.`
    );
  }
  for (let index = 0; index < rows.length; index += 1) {
    const expected = migrations[index];
    const row = rows[index];
    if (!expected || Number(row.version) !== index + 1 || row.name !== expected.name ||
        row.checksum !== migrationChecksum(expected)) {
      throw new DatabaseCompatibilityError(
        'INVALID_MIGRATION_LEDGER',
        `Migration ledger entry ${index + 1} does not match this ScribeTribe build.`
      );
    }
  }
}

function inspectExistingDatabase(dbPath, migrations = MIGRATIONS) {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return { kind: 'empty', version: 0 };
  const resolved = path.resolve(dbPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new DatabaseCompatibilityError(
      'INVALID_DATABASE',
      databaseMessage(resolved, 'ScribeTribe needs a database file, but this path is not a regular file.')
    );
  }
  if (stat.size === 0) return { kind: 'empty', version: 0 };

  let db;
  try {
    db = new DatabaseSync(resolved, { readOnly: true });
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name
    `).all().map((row) => row.name);
    if (tables.length === 0) return { kind: 'empty', version: 0 };

    if (!tables.includes('scribe_schema')) {
      const isLegacy = tables.some((name) => LEGACY_TABLES.has(name));
      throw new DatabaseCompatibilityError(
        isLegacy ? 'LEGACY_DATABASE' : 'UNRECOGNIZED_DATABASE',
        databaseMessage(
          resolved,
          isLegacy
            ? 'ScribeTribe 4.0 found a 3.x database and will not reinterpret it.'
            : 'ScribeTribe 4.0 could not verify this database family.'
        )
      );
    }

    if (!tables.includes('schema_migrations')) {
      throw new DatabaseCompatibilityError(
        'INVALID_DATABASE_IDENTITY',
        databaseMessage(resolved, 'The ScribeTribe 4.0 schema identity is incomplete.')
      );
    }
    const identity = db.prepare('SELECT family, version FROM scribe_schema WHERE singleton = 1').get();
    if (!identity || identity.family !== DATABASE_FAMILY || !Number.isSafeInteger(Number(identity.version))) {
      throw new DatabaseCompatibilityError(
        'UNSUPPORTED_DATABASE_FAMILY',
        databaseMessage(resolved, 'This database does not have a supported ScribeTribe 4.0 identity.')
      );
    }
    const version = Number(identity.version);
    if (version > DATABASE_SCHEMA_VERSION) {
      throw new DatabaseCompatibilityError(
        'FUTURE_DATABASE',
        databaseMessage(
          resolved,
          `This database uses future schema version ${version}; this build supports through ${DATABASE_SCHEMA_VERSION}.`
        )
      );
    }
    if (version < 1) {
      throw new DatabaseCompatibilityError(
        'INVALID_DATABASE_IDENTITY',
        databaseMessage(resolved, `This database records invalid schema version ${version}.`)
      );
    }
    const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
    const userVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (applicationId !== SQLITE_APPLICATION_ID || userVersion !== version) {
      throw new DatabaseCompatibilityError(
        'INVALID_DATABASE_IDENTITY',
        databaseMessage(resolved, 'The SQLite and ScribeTribe schema identities disagree.')
      );
    }
    verifyMigrationLedger(db, version, migrations);
    return { kind: 'recognized', version };
  } catch (error) {
    if (error instanceof DatabaseCompatibilityError) throw error;
    throw new DatabaseCompatibilityError(
      'INVALID_DATABASE',
      databaseMessage(resolved, `ScribeTribe 4.0 could not safely read this database (${error.message}).`)
    );
  } finally {
    try { db?.close(); } catch { /* read-only inspection was already closed */ }
  }
}

function validateMigrationList(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) throw new Error('At least one migration is required');
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1 || typeof migration.name !== 'string' || typeof migration.up !== 'function') {
      throw new Error(`Migration ${index + 1} is not a contiguous, named migration`);
    }
  });
}

function applyMigration(db, migration) {
  db.exec('BEGIN IMMEDIATE');
  try {
    migration.up(db);
    db.prepare(`
      INSERT INTO schema_migrations (version, name, checksum)
      VALUES (?, ?, ?)
    `).run(migration.version, migration.name, migrationChecksum(migration));
    db.prepare(`
      UPDATE scribe_schema
         SET version = ?, updated_at = CURRENT_TIMESTAMP
       WHERE singleton = 1
    `).run(migration.version);
    db.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID}`);
    db.exec(`PRAGMA user_version = ${migration.version}`);
    const violation = db.prepare('PRAGMA foreign_key_check').get();
    if (violation) throw new Error(`Migration ${migration.version} violates a foreign key constraint`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction was already rolled back */ }
    throw error;
  }
}

function runMigrations(db, currentVersion, migrations = MIGRATIONS) {
  validateMigrationList(migrations);
  const targetVersion = migrations.length;
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0 || currentVersion > targetVersion) {
    throw new Error(`Cannot migrate from schema version ${currentVersion} to ${targetVersion}`);
  }
  if (currentVersion > 0) verifyMigrationLedger(db, currentVersion, migrations);
  for (const migration of migrations) {
    if (migration.version > currentVersion) applyMigration(db, migration);
  }
  verifyMigrationLedger(db, targetVersion, migrations);
  return targetVersion;
}

function ensureContinuitySearch(db) {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS story_memory_fts
        USING fts5(page_id UNINDEXED, story_id UNINDEXED, content);
      CREATE TRIGGER IF NOT EXISTS story_memory_search_fts_delete
      AFTER DELETE ON story_memory_search BEGIN
        DELETE FROM story_memory_fts WHERE page_id = OLD.page_id;
      END;
      DELETE FROM story_memory_fts
        WHERE page_id NOT IN (SELECT page_id FROM story_memory_search);
      INSERT INTO story_memory_fts (page_id, story_id, content)
        SELECT s.page_id, s.story_id, s.content
          FROM story_memory_search s
         WHERE NOT EXISTS (
           SELECT 1 FROM story_memory_fts f WHERE f.page_id = s.page_id
         );
    `);
  } catch {
    // Some minimal SQLite builds omit FTS5. The ordinary search table remains
    // authoritative and gives a slower but correct local fallback.
  }
}

function validateDatabaseIntegrity(db) {
  const check = db.prepare('PRAGMA quick_check').all();
  if (check.length !== 1 || check[0].quick_check !== 'ok') {
    throw new Error('SQLite quick_check did not return ok');
  }
  const foreignKeyViolation = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyViolation) throw new Error('SQLite foreign_key_check found an invalid relationship');
}

function schemaIdentity(db) {
  const row = db.prepare('SELECT family, version, created_at, updated_at FROM scribe_schema WHERE singleton = 1').get();
  return row ? { ...row, version: Number(row.version) } : null;
}

function createDb(dbPath, {
  migrations = MIGRATIONS,
  reconcileOperations = true,
} = {}) {
  validateMigrationList(migrations);
  const inspection = inspectExistingDatabase(dbPath, migrations);
  if (dbPath !== ':memory:') {
    const parent = path.dirname(path.resolve(dbPath));
    const parentExisted = fs.existsSync(parent);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (!parentExisted) {
      try { fs.chmodSync(parent, 0o700); } catch { /* permissions are best-effort off POSIX */ }
    }
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    try {
      db.exec('PRAGMA journal_mode = WAL');
    } catch {
      // :memory: databases do not support WAL.
    }
    runMigrations(db, inspection.version, migrations);
    ensureContinuitySearch(db);
    validateDatabaseIntegrity(db);
    if (reconcileOperations) reconcileInterruptedOperations(db);
    if (dbPath !== ':memory:') {
      try { fs.chmodSync(path.resolve(dbPath), 0o600); } catch { /* permissions are best-effort off POSIX */ }
    }
    return db;
  } catch (error) {
    try { db.close(); } catch { /* already closed */ }
    throw error;
  }
}

module.exports = {
  createDb,
  inspectExistingDatabase,
  runMigrations,
  validateDatabaseIntegrity,
  schemaIdentity,
  migrationChecksum,
  DatabaseCompatibilityError,
  MIGRATIONS,
};
