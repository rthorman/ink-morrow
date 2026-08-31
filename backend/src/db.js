'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  setting TEXT,
  image_status TEXT NOT NULL DEFAULT 'none',
  image_media_type TEXT,
  image_cost_usd REAL,
  image_updated_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  personality TEXT,
  appearance TEXT,
  background TEXT,
  world_id TEXT REFERENCES worlds (id),
  image_status TEXT NOT NULL DEFAULT 'none',
  image_media_type TEXT,
  image_cost_usd REAL,
  image_updated_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
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

CREATE TABLE IF NOT EXISTS story_pages (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  user_input TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (story_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pages_story ON story_pages (story_id, page_number);
CREATE INDEX IF NOT EXISTS idx_characters_world ON characters (world_id);
CREATE INDEX IF NOT EXISTS idx_stories_world ON stories (world_id);

CREATE TABLE IF NOT EXISTS story_previews (
  story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  expected_page INTEGER NOT NULL,
  raw_content TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The reusable character catalogue is not the identity of a character inside
-- an existing tale.  A cast snapshot is taken when the character first joins
-- the story and remains the baseline from which page-linked memory is folded.
CREATE TABLE IF NOT EXISTS story_character_snapshots (
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

-- One extraction result per COMMITTED text page.  A preview never receives a
-- row here.  Page ids, rather than page numbers, keep provenance stable when a
-- deletion closes a numbering gap.
CREATE TABLE IF NOT EXISTS story_memory_pages (
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

CREATE INDEX IF NOT EXISTS idx_story_memory_pages_story
  ON story_memory_pages (story_id, status);

-- Always-present search copy.  FTS5 is layered over this where the bundled
-- SQLite supports it; LIKE retrieval remains a graceful local fallback.
CREATE TABLE IF NOT EXISTS story_memory_search (
  page_id TEXT PRIMARY KEY REFERENCES story_pages (id) ON DELETE CASCADE,
  story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_memory_search_story
  ON story_memory_search (story_id);

CREATE TABLE IF NOT EXISTS audiobooks (
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

-- One local owner, deliberately without usernames or roles. Authentication
-- state is installation-local and is never part of a portable archive.
CREATE TABLE IF NOT EXISTS auth_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  scrypt_n INTEGER NOT NULL,
  scrypt_r INTEGER NOT NULL,
  scrypt_p INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Browser sessions are opaque: only the SHA-256 digest of the cookie value is
-- persisted. The CSRF secret is useless without that cookie and remains local.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  idle_timeout_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions (absolute_expires_at);
`;

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
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
    // Some minimal SQLite builds omit FTS5.  The ordinary search table above
    // still gives correct (if less sophisticated) retrieval.
  }
}

function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    // node:sqlite won't create missing parent dirs (fresh clones have an empty/absent database/)
    const parent = path.dirname(path.resolve(dbPath));
    const parentExisted = fs.existsSync(parent);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (!parentExisted) {
      try { fs.chmodSync(parent, 0o700); } catch { /* permissions are best-effort off POSIX */ }
    }
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    try { fs.chmodSync(path.resolve(dbPath), 0o600); } catch { /* permissions are best-effort off POSIX */ }
  }
  db.exec('PRAGMA foreign_keys = ON');
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {
    // :memory: databases don't support WAL; that's fine
  }
  db.exec(SCHEMA);
  // Migrations for databases created before v2 of the schema
  ensureColumn(db, 'stories', 'tone', "tone TEXT NOT NULL DEFAULT 'fade-to-black' CHECK (tone IN ('fade-to-black', 'romantic', 'explicit'))");
  ensureColumn(db, 'story_pages', 'user_input', 'user_input TEXT');
  // v3: per-page AI usage accounting (model choice + cost ticker)
  ensureColumn(db, 'story_pages', 'model', 'model TEXT');
  ensureColumn(db, 'story_pages', 'prompt_tokens', 'prompt_tokens INTEGER');
  ensureColumn(db, 'story_pages', 'completion_tokens', 'completion_tokens INTEGER');
  ensureColumn(db, 'story_pages', 'cost_usd', 'cost_usd REAL');
  // v4: reference images for characters & worlds (generated in the background)
  for (const table of ['characters', 'worlds']) {
    ensureColumn(db, table, 'image_status', "image_status TEXT NOT NULL DEFAULT 'none'");
    ensureColumn(db, table, 'image_media_type', 'image_media_type TEXT');
    ensureColumn(db, table, 'image_cost_usd', 'image_cost_usd REAL');
    ensureColumn(db, table, 'image_updated_at', 'image_updated_at TEXT');
  }
  // v5: editable image blurbs + world lorebooks (kept out of creation forms by design)
  ensureColumn(db, 'worlds', 'lore', 'lore TEXT');
  ensureColumn(db, 'worlds', 'image_prompt', 'image_prompt TEXT');
  ensureColumn(db, 'characters', 'image_prompt', 'image_prompt TEXT');
  // v6: painted scene plates bound into the story as real pages. A row with
  // image_media_type set is an illustration page (content stays empty); the
  // bytes live on disk keyed by the page id, so renumbering never orphans them.
  ensureColumn(db, 'story_pages', 'image_media_type', 'image_media_type TEXT');
  ensureColumn(db, 'story_pages', 'image_prompt', 'image_prompt TEXT');
  // v8: story-cover paintings live on disk alongside the other reference
  // images. Status/cost/prompt mirror worlds and characters so one queue can
  // own every catalogue painting without storing large blobs in SQLite.
  ensureColumn(db, 'stories', 'image_status', "image_status TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'stories', 'image_media_type', 'image_media_type TEXT');
  ensureColumn(db, 'stories', 'image_cost_usd', 'image_cost_usd REAL');
  ensureColumn(db, 'stories', 'image_updated_at', 'image_updated_at TEXT');
  ensureColumn(db, 'stories', 'image_prompt', 'image_prompt TEXT');
  // v9 / 3.1.0: page-provenanced narrative memory.  Costs live beside the
  // generated page so story accounting survives memory rebuilds and failures.
  ensureColumn(db, 'stories', 'continuity_overrides', "continuity_overrides TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'story_pages', 'continuity_model', 'continuity_model TEXT');
  ensureColumn(db, 'story_pages', 'continuity_prompt_tokens', 'continuity_prompt_tokens INTEGER');
  ensureColumn(db, 'story_pages', 'continuity_completion_tokens', 'continuity_completion_tokens INTEGER');
  ensureColumn(db, 'story_pages', 'continuity_cost_usd', 'continuity_cost_usd REAL NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS story_pages_invalidate_memory
    AFTER UPDATE OF content ON story_pages
    WHEN OLD.content <> NEW.content BEGIN
      DELETE FROM story_memory_pages WHERE page_id = OLD.id;
      DELETE FROM story_memory_search WHERE page_id = OLD.id;
    END;
  `);
  ensureContinuitySearch(db);
  return db;
}

module.exports = { createDb };
