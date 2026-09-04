'use strict';

const FICTION_LIBRARY_SCHEMA = `
CREATE TABLE fiction_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('world','character','scribe')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  image_id TEXT,
  image_alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fiction_templates_kind ON fiction_templates(kind, updated_at);
CREATE TABLE fiction_template_assets (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES fiction_templates(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);
CREATE TABLE fiction_template_requests (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES fiction_templates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','interrupted')),
  model TEXT NOT NULL,
  billed_attempts INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE(template_id,idempotency_key)
);
CREATE UNIQUE INDEX fiction_template_one_pending ON fiction_template_requests(template_id) WHERE status = 'pending';
`;
module.exports = { FICTION_LIBRARY_SCHEMA };
