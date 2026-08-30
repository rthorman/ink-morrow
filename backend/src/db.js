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
`;

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    // node:sqlite won't create missing parent dirs (fresh clones have an empty/absent database/)
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
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
  return db;
}

module.exports = { createDb };