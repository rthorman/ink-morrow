'use strict';

// The 5.0 narrative is independent of manuscript/Play tables. Reusing the
// established runtime does not make a transcript or a page the game state.
const FICTION_SCHEMA = `
CREATE TABLE fiction_games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  genre TEXT NOT NULL,
  initial_state_json TEXT NOT NULL,
  active_branch_id TEXT REFERENCES fiction_branches(id) DEFERRABLE INITIALLY DEFERRED,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fiction_branches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_branch_id TEXT REFERENCES fiction_branches(id),
  fork_beat_id TEXT REFERENCES fiction_beats(id),
  head_beat_id TEXT REFERENCES fiction_beats(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fiction_branches_game ON fiction_branches(game_id);
CREATE TABLE fiction_beats (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES fiction_branches(id),
  parent_id TEXT REFERENCES fiction_beats(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'scene', 'clarification', 'correction', 'control', 'episode')),
  prose TEXT NOT NULL,
  summary TEXT NOT NULL,
  input_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fiction_beats_game ON fiction_beats(game_id, created_at);
CREATE TRIGGER fiction_beats_immutable BEFORE UPDATE ON fiction_beats
BEGIN SELECT RAISE(ABORT, 'Story beats are immutable'); END;
CREATE TABLE fiction_requests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES fiction_branches(id),
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'interrupted')),
  beat_id TEXT REFERENCES fiction_beats(id),
  model TEXT,
  billed_attempts INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE(game_id, idempotency_key)
);
CREATE UNIQUE INDEX fiction_one_pending ON fiction_requests(game_id) WHERE status = 'pending';
`;

const FICTION_MEDIA_SCHEMA = `
CREATE TABLE fiction_assets (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/webp', 'image/png', 'image/jpeg')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fiction_assets_game ON fiction_assets(game_id);
ALTER TABLE provider_role_assignments RENAME TO provider_role_assignments_previous;
CREATE TABLE provider_role_assignments (
  role TEXT PRIMARY KEY CHECK (role IN ('scribe', 'archivist', 'narrator', 'illustrator')),
  profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL CHECK (length(trim(model_id)) BETWEEN 1 AND 500),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO provider_role_assignments SELECT * FROM provider_role_assignments_previous;
DROP TABLE provider_role_assignments_previous;
CREATE INDEX idx_provider_roles_profile ON provider_role_assignments(profile_id);
`;

module.exports = { FICTION_SCHEMA, FICTION_MEDIA_SCHEMA };
