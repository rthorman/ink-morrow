'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const {
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  SQLITE_APPLICATION_ID,
} = require('./release');
const { reconcileInterruptedOperations } = require('./core/operation-journal');
const { inspectCopy, hasDatabaseSidecars } = require('./core/database-inspection');
const { FICTION_SCHEMA, FICTION_MEDIA_SCHEMA, FICTION_CALL_SCHEMA } = require('./modules/fiction/schema');
const { FICTION_LIBRARY_SCHEMA } = require('./modules/fiction/library-schema');

const LEGACY_TABLES = new Set([
  'worlds',
  'characters',
  'stories',
  'story_pages',
  'story_previews',
  'story_memory_pages',
  'auth_owner',
]);


// The fresh 5.0 family reuses the tested incremental schema construction.
// Historical tables support tested internal reuse, not live writing routes or
// old-product compatibility. They are constructed only in the ink-morrow-5 family.
const SCHEMA_V1 = `
CREATE TABLE ink_morrow_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  family TEXT NOT NULL CHECK (family = 'ink-morrow-5'),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ink_morrow_schema (singleton, family, version)
VALUES (1, 'ink-morrow-5', 0);

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

// Version 1 already reserved the target hierarchy tables. Version 2 makes
// that structure live and backfills any compatibility stories/pages created
// while the kernel-only release branch was running. The same opaque page id is
// used on both sides of the temporary PR 02/PR 03 compatibility seam.
function backfillManuscriptHierarchy(db) {
  const insertVolume = db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, 1, ?)');
  const insertChapter = db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, 1, ?)');
  const insertPage = db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)');
  const pageExists = db.prepare('SELECT 1 FROM pages WHERE id = ?');
  const lastVolume = db.prepare('SELECT * FROM volumes WHERE story_id = ? ORDER BY ordinal DESC LIMIT 1');
  const lastChapter = db.prepare('SELECT * FROM chapters WHERE volume_id = ? ORDER BY ordinal DESC LIMIT 1');
  const nextOrdinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM pages WHERE chapter_id = ?');
  const compatibilityPages = db.prepare('SELECT id FROM story_pages WHERE story_id = ? ORDER BY page_number');

  for (const story of db.prepare('SELECT id FROM stories ORDER BY created_at, id').all()) {
    let volume = lastVolume.get(story.id);
    if (!volume) {
      const id = randomUUID();
      insertVolume.run(id, story.id, 'Volume I');
      volume = lastVolume.get(story.id);
    }
    let chapter = lastChapter.get(volume.id);
    if (!chapter) {
      const id = randomUUID();
      insertChapter.run(id, volume.id, 'Chapter I');
      chapter = lastChapter.get(volume.id);
    }
    let ordinal = nextOrdinal.get(chapter.id).value;
    for (const page of compatibilityPages.all(story.id)) {
      if (pageExists.get(page.id)) continue;
      insertPage.run(page.id, chapter.id, ordinal);
      ordinal += 1;
    }
  }
}

const HIERARCHY_V2_CHECKSUM_SOURCE = `
PR 02 manuscript hierarchy activation:
- ensure every existing story has a Volume I and Chapter I tail
- pair every compatibility story page with a stable pages row using the same id
- preserve compatibility page order as scoped chapter ordinals
`;

function activatePageRevisions(db) {
  db.exec(`
    ALTER TABLE page_revisions ADD COLUMN source TEXT NOT NULL DEFAULT 'author'
      CHECK (source IN ('author', 'ai', 'import', 'migration'));
    ALTER TABLE page_revisions ADD COLUMN model TEXT;
    ALTER TABLE page_revisions ADD COLUMN prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0);
    ALTER TABLE page_revisions ADD COLUMN completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0);
    ALTER TABLE page_revisions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0);

    DROP TRIGGER story_pages_invalidate_memory;
    CREATE TRIGGER story_pages_invalidate_memory
    AFTER UPDATE OF content ON story_pages
    WHEN OLD.content <> NEW.content
      AND EXISTS (
        SELECT 1 FROM pages p
         WHERE p.id = NEW.id
           AND p.canonical_revision_id = p.display_revision_id
      )
    BEGIN
      DELETE FROM story_memory_pages WHERE page_id = OLD.id;
      DELETE FROM story_memory_search WHERE page_id = OLD.id;
    END;

    CREATE TRIGGER page_revisions_immutable
    BEFORE UPDATE ON page_revisions
    BEGIN
      SELECT RAISE(ABORT, 'Page revisions are immutable');
    END;

    CREATE TRIGGER page_revision_parent_same_page
    BEFORE INSERT ON page_revisions
    WHEN NEW.parent_revision_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM page_revisions parent
         WHERE parent.id = NEW.parent_revision_id
           AND parent.page_id = NEW.page_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Revision parent belongs to another page');
    END;

    CREATE TRIGGER page_revision_pointers_same_page
    BEFORE UPDATE OF canonical_revision_id, display_revision_id ON pages
    WHEN NEW.canonical_revision_id IS NOT NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM page_revisions canonical
           WHERE canonical.id = NEW.canonical_revision_id
             AND canonical.page_id = NEW.id
             AND canonical.kind = 'canonical'
        )
        OR NOT EXISTS (
          SELECT 1 FROM page_revisions display
           WHERE display.id = NEW.display_revision_id
             AND display.page_id = NEW.id
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Revision pointer belongs to another page');
    END;
  `);

  const insertRevision = db.prepare(`
    INSERT INTO page_revisions
      (id, page_id, parent_revision_id, kind, content, direction, created_at,
       source, model, prompt_tokens, completion_tokens, cost_usd)
    VALUES (?, ?, NULL, 'canonical', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setPointers = db.prepare(`
    UPDATE pages SET canonical_revision_id = ?, display_revision_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `);
  const legacyPages = db.prepare(`
    SELECT sp.*, p.canonical_revision_id
      FROM story_pages sp
      JOIN pages p ON p.id = sp.id
     ORDER BY sp.story_id, sp.page_number
  `).all();
  for (const page of legacyPages) {
    if (page.canonical_revision_id) continue;
    const revisionId = randomUUID();
    insertRevision.run(
      revisionId,
      page.id,
      page.content,
      page.user_input,
      page.created_at,
      page.model ? 'ai' : 'author',
      page.model,
      page.prompt_tokens,
      page.completion_tokens,
      page.cost_usd || 0
    );
    setPointers.run(revisionId, revisionId, page.id);
  }
}

const REVISIONS_V3_CHECKSUM_SOURCE = `
PR 03 immutable page revisions and recovery activation:
- add immutable author/AI revision provenance and usage metadata
- backfill each compatibility page with one canonical/display revision
- enforce same-page ancestry and canonical/display pointer ownership
- preserve continuity rows during display-only copyedits
`;

function activateProviderVault(db) {
  db.exec(`
    CREATE TABLE provider_profiles (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
      base_url TEXT NOT NULL CHECK (length(trim(base_url)) BETWEEN 1 AND 2000),
      capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
      credential_source TEXT NOT NULL DEFAULT 'none'
        CHECK (credential_source IN ('none', 'environment', 'session', 'vault')),
      environment_key TEXT,
      secret_ref TEXT UNIQUE,
      timeout_ms INTEGER NOT NULL DEFAULT 120000 CHECK (timeout_ms BETWEEN 1000 AND 600000),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((credential_source = 'environment' AND environment_key IS NOT NULL AND secret_ref IS NULL)
          OR (credential_source = 'vault' AND environment_key IS NULL AND secret_ref IS NOT NULL)
          OR (credential_source IN ('none', 'session') AND environment_key IS NULL AND secret_ref IS NULL))
    );

    CREATE TABLE provider_role_assignments (
      role TEXT PRIMARY KEY CHECK (role IN ('scribe', 'archivist', 'narrator')),
      profile_id TEXT NOT NULL REFERENCES provider_profiles (id) ON DELETE RESTRICT,
      model_id TEXT NOT NULL CHECK (length(trim(model_id)) BETWEEN 1 AND 500),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_provider_roles_profile ON provider_role_assignments (profile_id);

    CREATE TABLE provider_vault (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wrap_salt BLOB NOT NULL,
      wrap_nonce BLOB NOT NULL,
      wrapped_key BLOB NOT NULL,
      wrap_tag BLOB NOT NULL,
      scrypt_n INTEGER NOT NULL CHECK (scrypt_n > 1),
      scrypt_r INTEGER NOT NULL CHECK (scrypt_r > 0),
      scrypt_p INTEGER NOT NULL CHECK (scrypt_p > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE provider_secrets (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      profile_id TEXT NOT NULL UNIQUE REFERENCES provider_profiles (id) ON DELETE CASCADE,
      nonce BLOB NOT NULL,
      ciphertext BLOB NOT NULL,
      auth_tag BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER provider_profile_secret_ownership
    BEFORE UPDATE OF credential_source, secret_ref ON provider_profiles
    WHEN NEW.credential_source = 'vault'
      AND NOT EXISTS (
        SELECT 1 FROM provider_secrets secret
         WHERE secret.id = NEW.secret_ref AND secret.profile_id = NEW.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Provider secret belongs to another profile');
    END;

    CREATE TRIGGER provider_secret_owner_immutable
    BEFORE UPDATE OF profile_id ON provider_secrets
    BEGIN
      SELECT RAISE(ABORT, 'Provider secret ownership is immutable');
    END;

    CREATE TRIGGER provider_secret_delete_detaches_profile
    AFTER DELETE ON provider_secrets
    BEGIN
      UPDATE provider_profiles
         SET credential_source = 'none', environment_key = NULL, secret_ref = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = OLD.profile_id AND secret_ref = OLD.id;
    END;
  `);
}

const PROVIDERS_V4_CHECKSUM_SOURCE = `
PR 04 provider profiles and encrypted secret vault activation:
- add OpenAI-compatible provider profiles and logical AI role assignments
- separate environment, process-session, and encrypted-vault credential sources
- bind every encrypted secret reference to exactly one provider profile
- keep vault wrapping material and encrypted entries outside portable aggregates
`;

function activateContinuityV2(db) {
  db.exec(`
    ALTER TABLE continuity_deltas ADD COLUMN content_hash TEXT;
    ALTER TABLE continuity_deltas ADD COLUMN summary TEXT;
    ALTER TABLE continuity_deltas ADD COLUMN model TEXT;
    ALTER TABLE continuity_deltas ADD COLUMN prompt_tokens INTEGER
      CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0);
    ALTER TABLE continuity_deltas ADD COLUMN completion_tokens INTEGER
      CHECK (completion_tokens IS NULL OR completion_tokens >= 0);
    ALTER TABLE continuity_deltas ADD COLUMN error TEXT;

    CREATE TABLE continuity_search (
      revision_id TEXT PRIMARY KEY REFERENCES page_revisions (id) ON DELETE CASCADE,
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      content TEXT NOT NULL
    );

    CREATE INDEX idx_continuity_search_story
      ON continuity_search (story_id);

    CREATE TABLE continuity_projection_checkpoints (
      revision_id TEXT PRIMARY KEY REFERENCES page_revisions (id) ON DELETE CASCADE,
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL CHECK (page_number > 0),
      delta_count INTEGER NOT NULL CHECK (delta_count >= 0),
      projection_json TEXT NOT NULL CHECK (json_valid(projection_json)),
      projection_hash TEXT NOT NULL CHECK (length(projection_hash) = 64),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_continuity_checkpoints_story_page
      ON continuity_projection_checkpoints (story_id, page_number);

    CREATE TRIGGER continuity_delta_canonical_revision
    BEFORE INSERT ON continuity_deltas
    WHEN NOT EXISTS (
      SELECT 1
        FROM page_revisions revision
        JOIN pages page ON page.id = revision.page_id
        JOIN chapters chapter ON chapter.id = page.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE revision.id = NEW.revision_id
         AND revision.kind = 'canonical'
         AND volume.story_id = NEW.story_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Continuity delta provenance is not a canonical revision in this story');
    END;

    CREATE TRIGGER continuity_checkpoint_canonical_changed
    AFTER UPDATE OF canonical_revision_id ON pages
    WHEN OLD.canonical_revision_id IS NOT NEW.canonical_revision_id
    BEGIN
      DELETE FROM continuity_projection_checkpoints
       WHERE story_id = (
         SELECT volume.story_id
           FROM chapters chapter
           JOIN volumes volume ON volume.id = chapter.volume_id
          WHERE chapter.id = NEW.chapter_id
       )
         AND page_number >= COALESCE(
           (SELECT page_number FROM story_pages WHERE id = NEW.id),
           1
         );
    END;

    CREATE TRIGGER continuity_checkpoint_page_removed
    BEFORE DELETE ON pages
    BEGIN
      DELETE FROM continuity_projection_checkpoints
       WHERE story_id = (
         SELECT volume.story_id
           FROM chapters chapter
           JOIN volumes volume ON volume.id = chapter.volume_id
          WHERE chapter.id = OLD.chapter_id
       )
         AND page_number >= COALESCE(
           (SELECT page_number FROM story_pages WHERE id = OLD.id),
           1
         );
    END;

    CREATE TRIGGER continuity_checkpoint_page_renumbered
    AFTER UPDATE OF page_number ON story_pages
    WHEN OLD.page_number IS NOT NEW.page_number
    BEGIN
      DELETE FROM continuity_projection_checkpoints
       WHERE story_id = NEW.story_id
         AND page_number >= MIN(OLD.page_number, NEW.page_number);
    END;

    INSERT OR IGNORE INTO continuity_deltas
      (revision_id, story_id, status, schema_version, delta_json,
       provider_result_json, spend_usd, error_code, created_at, updated_at,
       content_hash, summary, model, prompt_tokens, completion_tokens, error)
    SELECT p.canonical_revision_id, memory.story_id, memory.status,
           memory.schema_version, memory.delta_json,
           json_object('model', memory.model,
                       'prompt_tokens', memory.prompt_tokens,
                       'completion_tokens', memory.completion_tokens),
           memory.cost_usd,
           CASE WHEN memory.status = 'failed' THEN 'EXTRACTION_FAILED' ELSE NULL END,
           memory.created_at, memory.updated_at, memory.content_hash,
           memory.summary, memory.model, memory.prompt_tokens,
           memory.completion_tokens, memory.error
      FROM story_memory_pages memory
      JOIN pages p ON p.id = memory.page_id
     WHERE p.canonical_revision_id IS NOT NULL;

    INSERT OR IGNORE INTO continuity_search (revision_id, story_id, content)
    SELECT p.canonical_revision_id, search.story_id, search.content
      FROM story_memory_search search
      JOIN pages p ON p.id = search.page_id
      JOIN continuity_deltas delta ON delta.revision_id = p.canonical_revision_id
     WHERE delta.status = 'ready';

    INSERT OR IGNORE INTO template_snapshots
      (id, story_id, template_kind, source_template_id, source_revision,
       snapshot_json, created_at)
    SELECT 'world:' || story.id || ':' || world.id,
           story.id, 'world', world.id, world.updated_at,
           json_object(
             'name', world.name,
             'description', world.description,
             'genre', world.genre,
             'setting', world.setting,
             'lore', world.lore
           ),
           COALESCE(story.created_at, CURRENT_TIMESTAMP)
      FROM stories story
      JOIN worlds world ON world.id = story.world_id;

    INSERT OR IGNORE INTO template_snapshots
      (id, story_id, template_kind, source_template_id, source_revision,
       snapshot_json, created_at)
    SELECT 'character:' || snapshot.story_id || ':' || snapshot.character_id,
           snapshot.story_id, 'character', snapshot.character_id,
           snapshot.source_updated_at,
           json_object(
             'name', snapshot.name,
             'description', snapshot.description,
             'personality', snapshot.personality,
             'appearance', snapshot.appearance,
             'background', snapshot.background
           ),
           snapshot.created_at
      FROM story_character_snapshots snapshot;
  `);
}

const CONTINUITY_V5_CHECKSUM_SOURCE = `
PR 05 revision-provenanced continuity ledger v2 activation:
- bind each structured delta and search row to an immutable canonical revision
- add deterministic rebuild checkpoints that are safe to discard
- carry legacy page memory into revision provenance without rewriting prose
- freeze story-local world and character templates for reviewed field imports
`;

function activateWritingTransactions(db) {
  // PR 01 reserved these names with deliberately conservative shapes. PR 06
  // activates the final state machine. No shipped runtime wrote these
  // scaffold rows, so the incompatible placeholders are replaced atomically.
  db.exec(`
    ALTER TABLE prepared_pages RENAME TO prepared_pages_scaffold;
    ALTER TABLE writing_operations RENAME TO writing_operations_scaffold;
    DROP INDEX idx_writing_operations_story_status;

    CREATE TABLE writing_operations (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
      kind TEXT NOT NULL CHECK (kind IN ('prepare', 'promote', 'directed_generate', 'regenerate')),
      status TEXT NOT NULL CHECK (status IN ('requested', 'running', 'succeeded', 'committed', 'failed', 'superseded')),
      writer_session_id TEXT NOT NULL CHECK (length(trim(writer_session_id)) > 0),
      lease_token TEXT,
      expected_tail_page_id TEXT REFERENCES pages (id) ON DELETE SET NULL,
      expected_tail_revision_id TEXT REFERENCES page_revisions (id) ON DELETE SET NULL,
      context_fingerprint TEXT NOT NULL CHECK (length(context_fingerprint) = 64),
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      provider_result_json TEXT CHECK (provider_result_json IS NULL OR json_valid(provider_result_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
      billed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (billed_attempts >= 0),
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      UNIQUE (story_id, sequence),
      UNIQUE (story_id, idempotency_key)
    );

    CREATE INDEX idx_writing_operations_story_status
      ON writing_operations (story_id, status, sequence);

    CREATE TABLE prepared_pages (
      story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
      id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
      operation_id TEXT NOT NULL UNIQUE REFERENCES writing_operations (id) ON DELETE CASCADE,
      expected_page INTEGER NOT NULL CHECK (expected_page > 0),
      expected_tail_page_id TEXT REFERENCES pages (id) ON DELETE SET NULL,
      expected_tail_revision_id TEXT REFERENCES page_revisions (id) ON DELETE SET NULL,
      context_fingerprint TEXT NOT NULL CHECK (length(context_fingerprint) = 64),
      context_json TEXT NOT NULL CHECK (json_valid(context_json)),
      content TEXT NOT NULL,
      provider_result_json TEXT NOT NULL CHECK (json_valid(provider_result_json)),
      spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE writer_leases (
      story_id TEXT PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
      writer_session_id TEXT NOT NULL CHECK (length(trim(writer_session_id)) > 0),
      lease_token TEXT NOT NULL UNIQUE CHECK (length(trim(lease_token)) > 0),
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX idx_writer_leases_expiry ON writer_leases (expires_at);

    DROP TABLE prepared_pages_scaffold;
    DROP TABLE writing_operations_scaffold;
  `);
}

const WRITING_V6_CHECKSUM_SOURCE = `
PR 06 transactional writing state machine activation:
- durable requested/running/succeeded/committed/failed/superseded operations
- per-story expiring writer leases and deterministic operation sequencing
- one opaque restart-safe prepared page bound to a full context fingerprint
- authoritative provider result, billed-attempt and speculative-spend records
`;

function activateArtStore(db) {
  db.exec(`
    DROP INDEX idx_asset_placements_anchor_order;
    DROP INDEX idx_assets_story_created;
    ALTER TABLE asset_placements RENAME TO asset_placements_scaffold;
    ALTER TABLE assets RENAME TO assets_scaffold;

    CREATE TABLE assets (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('uploaded', 'ai-generated')),
      status TEXT NOT NULL CHECK (status IN ('staging', 'ready', 'failed')),
      source_media_type TEXT,
      media_type TEXT CHECK (media_type IS NULL OR media_type IN ('image/webp', 'image/png', 'image/jpeg')),
      storage_key TEXT NOT NULL UNIQUE CHECK (length(trim(storage_key)) > 0),
      sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
      size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      title TEXT CHECK (title IS NULL OR length(title) <= 500),
      alt_text TEXT CHECK (alt_text IS NULL OR length(alt_text) <= 2000),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      provider_result_json TEXT CHECK (provider_result_json IS NULL OR json_valid(provider_result_json)),
      spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
      provider_reference_allowed INTEGER NOT NULL DEFAULT 0
        CHECK (provider_reference_allowed IN (0, 1)),
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (status <> 'ready' OR
        (media_type IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL
         AND width IS NOT NULL AND height IS NOT NULL))
    );

    CREATE INDEX idx_assets_story_created ON assets (story_id, created_at, id);
    CREATE INDEX idx_assets_story_status ON assets (story_id, status);

    CREATE TABLE asset_placements (
      id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
      after_page_id TEXT REFERENCES pages (id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_asset_placements_anchor_order
      ON asset_placements (story_id, COALESCE(after_page_id, ''), ordinal);
    CREATE INDEX idx_asset_placements_asset ON asset_placements (asset_id);

    CREATE TRIGGER asset_placement_same_story_insert
    BEFORE INSERT ON asset_placements
    WHEN NOT EXISTS (
      SELECT 1 FROM assets asset
       WHERE asset.id = NEW.asset_id AND asset.story_id = NEW.story_id AND asset.status = 'ready'
    ) OR (
      NEW.after_page_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pages page
        JOIN chapters chapter ON chapter.id = page.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
        WHERE page.id = NEW.after_page_id AND volume.story_id = NEW.story_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Asset placement belongs to another story or unavailable asset');
    END;

    CREATE TRIGGER asset_placement_same_story_update
    BEFORE UPDATE OF story_id, asset_id, after_page_id ON asset_placements
    WHEN NOT EXISTS (
      SELECT 1 FROM assets asset
       WHERE asset.id = NEW.asset_id AND asset.story_id = NEW.story_id AND asset.status = 'ready'
    ) OR (
      NEW.after_page_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pages page
        JOIN chapters chapter ON chapter.id = page.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
        WHERE page.id = NEW.after_page_id AND volume.story_id = NEW.story_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Asset placement belongs to another story or unavailable asset');
    END;

    CREATE TABLE legacy_art_pages (
      page_id TEXT PRIMARY KEY CHECK (length(trim(page_id)) > 0),
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      after_page_id TEXT REFERENCES pages (id) ON DELETE SET NULL,
      media_type TEXT NOT NULL,
      prompt TEXT,
      spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
      ordinal INTEGER NOT NULL CHECK (ordinal > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO legacy_art_pages
      (page_id, story_id, after_page_id, media_type, prompt, spend_usd, ordinal, created_at)
    SELECT image.id, image.story_id,
           (
             SELECT prior.id FROM story_pages prior
              WHERE prior.story_id = image.story_id
                AND prior.page_number < image.page_number
                AND prior.image_media_type IS NULL
              ORDER BY prior.page_number DESC LIMIT 1
           ),
           image.image_media_type, image.image_prompt, COALESCE(image.cost_usd, 0),
           1 + (
             SELECT COUNT(*) FROM story_pages prior_image
              WHERE prior_image.story_id = image.story_id
                AND prior_image.page_number < image.page_number
                AND prior_image.image_media_type IS NOT NULL
                AND COALESCE((
                  SELECT prior_text.id FROM story_pages prior_text
                   WHERE prior_text.story_id = prior_image.story_id
                     AND prior_text.page_number < prior_image.page_number
                     AND prior_text.image_media_type IS NULL
                   ORDER BY prior_text.page_number DESC LIMIT 1
                ), '') = COALESCE((
                  SELECT anchor_text.id FROM story_pages anchor_text
                   WHERE anchor_text.story_id = image.story_id
                     AND anchor_text.page_number < image.page_number
                     AND anchor_text.image_media_type IS NULL
                   ORDER BY anchor_text.page_number DESC LIMIT 1
                ), '')
           ),
           image.created_at
      FROM story_pages image
     WHERE image.image_media_type IS NOT NULL;

    INSERT INTO assets
      (id, story_id, source, status, source_media_type, media_type, storage_key,
       sha256, size_bytes, width, height, metadata_json, provider_result_json,
       spend_usd, created_at, updated_at)
    SELECT id, story_id,
           CASE source WHEN 'generated' THEN 'ai-generated' ELSE 'uploaded' END,
           status, media_type, media_type, storage_key, sha256, size_bytes,
           width, height,
           CASE WHEN metadata_json IS NOT NULL AND json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
           CASE WHEN provider_result_json IS NOT NULL AND json_valid(provider_result_json)
                THEN provider_result_json ELSE NULL END,
           spend_usd, created_at, created_at
      FROM assets_scaffold;

    INSERT INTO asset_placements
      (id, story_id, asset_id, after_page_id, ordinal, created_at, updated_at)
    SELECT placement.id, placement.story_id, placement.asset_id,
           placement.after_page_id, placement.ordinal, placement.created_at, placement.created_at
      FROM asset_placements_scaffold placement
      JOIN assets asset ON asset.id = placement.asset_id AND asset.story_id = placement.story_id;

    DROP TABLE asset_placements_scaffold;
    DROP TABLE assets_scaffold;

    UPDATE pages
       SET canonical_revision_id = NULL, display_revision_id = NULL
     WHERE id IN (SELECT page_id FROM legacy_art_pages);
    DELETE FROM pages WHERE id IN (SELECT page_id FROM legacy_art_pages);
    DELETE FROM story_pages WHERE id IN (SELECT page_id FROM legacy_art_pages);

    UPDATE story_pages SET page_number = page_number + 1000000000;
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY story_id ORDER BY page_number, rowid) AS position
        FROM story_pages
    )
    UPDATE story_pages
       SET page_number = (SELECT position FROM ranked WHERE ranked.id = story_pages.id);

    UPDATE pages SET ordinal = ordinal + 1000000000;
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY chapter_id ORDER BY ordinal, rowid) AS position
        FROM pages
    )
    UPDATE pages
       SET ordinal = (SELECT position FROM ranked WHERE ranked.id = pages.id);
  `);
}

const ART_V7_CHECKSUM_SOURCE = `
PR 07 noncanonical art store and safe-upload activation:
- replace planned asset scaffolds with story-owned uploaded/AI-generated assets
- anchor independent placements before the first page or after stable page IDs
- remove legacy image rows from the canonical page timeline and stage media reconciliation
- enforce ready-asset and same-story placement ownership in SQLite
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
  Object.freeze({
    version: 2,
    name: 'manuscript hierarchy activation',
    checksumSource: HIERARCHY_V2_CHECKSUM_SOURCE,
    up(db) {
      backfillManuscriptHierarchy(db);
    },
  }),
  Object.freeze({
    version: 3,
    name: 'immutable page revisions and recovery activation',
    checksumSource: REVISIONS_V3_CHECKSUM_SOURCE,
    up(db) {
      activatePageRevisions(db);
    },
  }),
  Object.freeze({
    version: 4,
    name: 'provider profiles and encrypted secret vault',
    checksumSource: PROVIDERS_V4_CHECKSUM_SOURCE,
    up(db) {
      activateProviderVault(db);
    },
  }),
  Object.freeze({
    version: 5,
    name: 'revision-provenanced continuity ledger v2',
    checksumSource: CONTINUITY_V5_CHECKSUM_SOURCE,
    up(db) {
      activateContinuityV2(db);
    },
  }),
  Object.freeze({
    version: 6,
    name: 'transactional writing state machine',
    checksumSource: WRITING_V6_CHECKSUM_SOURCE,
    up(db) {
      activateWritingTransactions(db);
    },
  }),
  Object.freeze({
    version: 7,
    name: 'noncanonical art store and safe upload',
    checksumSource: ART_V7_CHECKSUM_SOURCE,
    up(db) {
      activateArtStore(db);
    },
  }),
  Object.freeze({
    version: 8,
    name: 'immutable publication document',
    checksumSource: `PR 15 publication snapshots are append-only and retain one allowlisted normalized document.`,
    up(db) {
      db.exec(`
        CREATE TRIGGER publication_snapshots_immutable
        BEFORE UPDATE ON publication_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'publication snapshots are immutable');
        END;
      `);
    },
  }),
  Object.freeze({
    version: 9,
    name: 'hashed immutable publication shares',
    checksumSource: `PR 17 activates hashed 256-bit publication capabilities with fixed identity, expiry, and one-way revocation.`,
    up(db) {
      db.exec(`
        CREATE TRIGGER shares_identity_immutable
        BEFORE UPDATE OF publication_snapshot_id, capability_hash, created_at, expires_at ON shares
        BEGIN
          SELECT RAISE(ABORT, 'publication share identity is immutable');
        END;

        CREATE TRIGGER shares_revocation_one_way
        BEFORE UPDATE OF status, revoked_at ON shares
        WHEN NOT (
          OLD.status = 'active' AND NEW.status = 'revoked' AND
          OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'publication share revocation is one-way');
        END;
      `);
    },
  }),
  Object.freeze({
    version: 10,
    name: 'versioned author canon',
    checksumSource: `Author canon keeps stable entries and append-only revisions separate from extracted evidence and corrections.`,
    up(db) {
      db.exec(`
        CREATE TABLE author_canon_entries (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN (
            'world_event', 'world_fact', 'character_fact', 'relationship',
            'goal', 'thread', 'story_rule', 'custom'
          )),
          subject_id TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'retired')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_author_canon_entries_story_status
          ON author_canon_entries (story_id, status, created_at);

        CREATE TABLE author_canon_revisions (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          entry_id TEXT NOT NULL REFERENCES author_canon_entries (id) ON DELETE CASCADE,
          revision_number INTEGER NOT NULL CHECK (revision_number > 0),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          value_json TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (entry_id, revision_number)
        );

        CREATE INDEX idx_author_canon_revisions_entry
          ON author_canon_revisions (entry_id, revision_number);

        CREATE TRIGGER author_canon_revisions_immutable
        BEFORE UPDATE ON author_canon_revisions
        BEGIN
          SELECT RAISE(ABORT, 'author canon revisions are immutable');
        END;
      `);
    },
  }),
  Object.freeze({
    version: 11,
    name: 'first-class catgirl scribes',
    checksumSource: `The Tribe stores versioned catgirl Scribes, immutable manuscript bindings, and per-page Scribe provenance.`,
    up(db) {
      db.exec(`
        CREATE TABLE scribes (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          entity_kind TEXT NOT NULL DEFAULT 'catgirl' CHECK (entity_kind = 'catgirl'),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          description TEXT,
          personality TEXT,
          appearance TEXT,
          background TEXT,
          feline_traits TEXT,
          diction TEXT NOT NULL DEFAULT 'balanced' CHECK (diction IN ('plain', 'balanced', 'ornate')),
          sentence_rhythm TEXT NOT NULL DEFAULT 'varied' CHECK (sentence_rhythm IN ('clipped', 'varied', 'flowing')),
          narrative_distance TEXT NOT NULL DEFAULT 'flexible' CHECK (narrative_distance IN ('intimate', 'flexible', 'observational')),
          figurative_language TEXT NOT NULL DEFAULT 'balanced' CHECK (figurative_language IN ('restrained', 'balanced', 'abundant')),
          description_density TEXT NOT NULL DEFAULT 'balanced' CHECK (description_density IN ('lean', 'balanced', 'immersive')),
          dialogue_tendency TEXT NOT NULL DEFAULT 'balanced' CHECK (dialogue_tendency IN ('sparse', 'balanced', 'dialogue-led')),
          exposition_style TEXT NOT NULL DEFAULT 'balanced' CHECK (exposition_style IN ('explicit', 'balanced', 'implicit')),
          humor TEXT NOT NULL DEFAULT 'restrained' CHECK (humor IN ('none', 'restrained', 'dry', 'warm', 'dark', 'playful')),
          scene_tempo TEXT NOT NULL DEFAULT 'measured' CHECK (scene_tempo IN ('contemplative', 'measured', 'brisk')),
          progress_appetite TEXT NOT NULL DEFAULT 'develop' CHECK (progress_appetite IN ('linger', 'develop', 'advance')),
          tension_tolerance TEXT NOT NULL DEFAULT 'medium' CHECK (tension_tolerance IN ('low', 'medium', 'high')),
          aftermath_dwell TEXT NOT NULL DEFAULT 'balanced' CHECK (aftermath_dwell IN ('brief', 'balanced', 'patient')),
          focus_areas TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(focus_areas) AND json_type(focus_areas) = 'array'),
          signature_habits TEXT,
          avoidances TEXT,
          image_prompt TEXT,
          image_status TEXT NOT NULL DEFAULT 'none',
          image_media_type TEXT,
          image_cost_usd REAL,
          image_updated_at TEXT,
          revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE scribe_revisions (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          scribe_id TEXT NOT NULL REFERENCES scribes (id) ON DELETE CASCADE,
          revision_number INTEGER NOT NULL CHECK (revision_number > 0),
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (scribe_id, revision_number)
        );

        CREATE TRIGGER scribe_revisions_immutable
        BEFORE UPDATE ON scribe_revisions
        BEGIN
          SELECT RAISE(ABORT, 'scribe revisions are immutable');
        END;

        CREATE TABLE story_scribe_bindings (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          action TEXT NOT NULL CHECK (action IN ('assigned', 'cleared')),
          source_scribe_id TEXT REFERENCES scribes (id) ON DELETE SET NULL,
          source_revision_number INTEGER,
          snapshot_json TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (action = 'assigned' AND source_revision_number > 0 AND snapshot_json IS NOT NULL) OR
            (action = 'cleared' AND source_scribe_id IS NULL AND source_revision_number IS NULL AND snapshot_json IS NULL)
          )
        );

        CREATE INDEX idx_story_scribe_bindings_story
          ON story_scribe_bindings (story_id, created_at);

        ALTER TABLE page_revisions
          ADD COLUMN scribe_binding_id TEXT REFERENCES story_scribe_bindings (id);

        CREATE INDEX idx_page_revisions_scribe_binding
          ON page_revisions (scribe_binding_id);
      `);
    },
  }),
  Object.freeze({
    version: 12,
    name: 'bounded publication media and continuity lookup',
    checksumSource: `Publication snapshots reference deduplicated immutable media blobs; continuity issues gain a story/status lookup index.`,
    up(db) {
      db.exec(`
        CREATE TABLE publication_blobs (
          sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
          media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
          width INTEGER NOT NULL CHECK (width > 0 AND width <= 4096),
          height INTEGER NOT NULL CHECK (height > 0 AND height <= 4096),
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          content BLOB NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE publication_snapshot_assets (
          snapshot_id TEXT NOT NULL REFERENCES publication_snapshots (id) ON DELETE CASCADE,
          asset_key TEXT NOT NULL CHECK (length(trim(asset_key)) > 0),
          sha256 TEXT NOT NULL REFERENCES publication_blobs (sha256),
          PRIMARY KEY (snapshot_id, asset_key)
        );

        CREATE INDEX idx_publication_snapshot_assets_blob
          ON publication_snapshot_assets (sha256);

        CREATE INDEX idx_continuity_issues_story_status
          ON continuity_issues (story_id, status, created_at);
      `);
    },
  }),
  Object.freeze({
    version: 13,
    name: 'canonical manuscript and continuity storage',
    checksumSource: `Current manuscript pages become a read-only projection of hierarchy and immutable revisions; legacy prose and continuity mirrors are retired after their canonical rows are proven complete.`,
    up(db) {
      db.exec(`
        ALTER TABLE page_revisions ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1
          CHECK (cost_known IN (0, 1));
        DROP TRIGGER page_revisions_immutable;
        UPDATE page_revisions
           SET cost_known = 0
         WHERE id IN (
           SELECT page.canonical_revision_id
             FROM pages page
             JOIN story_pages legacy ON legacy.id = page.id
            WHERE legacy.cost_usd IS NULL
         );
      `);
      // Be deliberately defensive at the one-way boundary. Normal schema-12
      // databases already have these rows; repairing a partially completed
      // earlier backfill here is safer than discarding otherwise valid prose.
      backfillManuscriptHierarchy(db);
      const insertRevision = db.prepare(`
        INSERT INTO page_revisions
          (id, page_id, parent_revision_id, kind, content, direction, created_at,
           source, model, prompt_tokens, completion_tokens, cost_usd, cost_known)
        VALUES (?, ?, NULL, 'canonical', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const setPointers = db.prepare(`
        UPDATE pages SET canonical_revision_id = ?, display_revision_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `);
      const incompletePages = db.prepare(`
        SELECT legacy.*
          FROM story_pages legacy
          JOIN pages page ON page.id = legacy.id
         WHERE page.canonical_revision_id IS NULL OR page.display_revision_id IS NULL
         ORDER BY legacy.story_id, legacy.page_number
      `).all();
      for (const page of incompletePages) {
        const revisionId = randomUUID();
        insertRevision.run(
          revisionId, page.id, page.content, page.user_input, page.created_at,
          page.model ? 'ai' : 'migration', page.model, page.prompt_tokens,
          page.completion_tokens, page.cost_usd || 0, page.cost_usd === null ? 0 : 1
        );
        setPointers.run(revisionId, revisionId, page.id);
      }
      db.exec(`
        INSERT OR IGNORE INTO continuity_deltas
          (revision_id, story_id, status, schema_version, delta_json,
           provider_result_json, spend_usd, error_code, created_at, updated_at,
           content_hash, summary, model, prompt_tokens, completion_tokens, error)
        SELECT page.canonical_revision_id, memory.story_id, memory.status,
               memory.schema_version, memory.delta_json,
               json_object('model', memory.model,
                           'prompt_tokens', memory.prompt_tokens,
                           'completion_tokens', memory.completion_tokens),
               memory.cost_usd,
               CASE WHEN memory.status = 'failed' THEN 'EXTRACTION_FAILED' ELSE NULL END,
               memory.created_at, memory.updated_at, memory.content_hash,
               memory.summary, memory.model, memory.prompt_tokens,
               memory.completion_tokens, memory.error
          FROM story_memory_pages memory
          JOIN pages page ON page.id = memory.page_id
         WHERE page.canonical_revision_id IS NOT NULL;

        INSERT OR IGNORE INTO continuity_search (revision_id, story_id, content)
        SELECT page.canonical_revision_id, search.story_id, search.content
          FROM story_memory_search search
          JOIN pages page ON page.id = search.page_id
          JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id
         WHERE delta.status = 'ready';

        -- The old page projection accumulated every extraction attempt while
        -- the earlier canonical delta stored only the latest attempt. Carry
        -- the larger lifetime totals forward before retiring that projection.
        UPDATE continuity_deltas
           SET spend_usd = MAX(spend_usd, COALESCE((
                 SELECT legacy.continuity_cost_usd
                   FROM pages page
                   JOIN story_pages legacy ON legacy.id = page.id
                  WHERE page.canonical_revision_id = continuity_deltas.revision_id
               ), 0)),
               model = COALESCE((
                 SELECT legacy.continuity_model
                   FROM pages page
                   JOIN story_pages legacy ON legacy.id = page.id
                  WHERE page.canonical_revision_id = continuity_deltas.revision_id
               ), model)
         WHERE revision_id IN (SELECT canonical_revision_id FROM pages);

        UPDATE continuity_deltas
           SET prompt_tokens = MAX(COALESCE(prompt_tokens, 0), (
                 SELECT legacy.continuity_prompt_tokens
                   FROM pages page
                   JOIN story_pages legacy ON legacy.id = page.id
                  WHERE page.canonical_revision_id = continuity_deltas.revision_id
               ))
         WHERE EXISTS (
           SELECT 1 FROM pages page
           JOIN story_pages legacy ON legacy.id = page.id
           WHERE page.canonical_revision_id = continuity_deltas.revision_id
             AND legacy.continuity_prompt_tokens IS NOT NULL
         );

        UPDATE continuity_deltas
           SET completion_tokens = MAX(COALESCE(completion_tokens, 0), (
                 SELECT legacy.continuity_completion_tokens
                   FROM pages page
                   JOIN story_pages legacy ON legacy.id = page.id
                  WHERE page.canonical_revision_id = continuity_deltas.revision_id
               ))
         WHERE EXISTS (
           SELECT 1 FROM pages page
           JOIN story_pages legacy ON legacy.id = page.id
           WHERE page.canonical_revision_id = continuity_deltas.revision_id
             AND legacy.continuity_completion_tokens IS NOT NULL
         );
      `);
      const missingPages = db.prepare(`
        SELECT COUNT(*) AS count
          FROM story_pages legacy
          LEFT JOIN pages page ON page.id = legacy.id
          LEFT JOIN page_revisions canonical ON canonical.id = page.canonical_revision_id
          LEFT JOIN page_revisions display ON display.id = page.display_revision_id
         WHERE page.id IS NULL OR canonical.id IS NULL OR display.id IS NULL
      `).get().count;
      if (Number(missingPages) > 0) {
        throw new Error('Schema 13 cannot retire page mirrors because canonical revisions are incomplete');
      }
      const missingContinuity = db.prepare(`
        SELECT COUNT(*) AS count
          FROM story_memory_pages memory
          JOIN pages page ON page.id = memory.page_id
          LEFT JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id
         WHERE delta.revision_id IS NULL
      `).get().count;
      if (Number(missingContinuity) > 0) {
        throw new Error('Schema 13 cannot retire continuity mirrors because canonical deltas are incomplete');
      }
      db.exec(`
        DROP TRIGGER IF EXISTS story_pages_invalidate_memory;
        DROP TRIGGER IF EXISTS story_memory_search_fts_delete;
        DROP TRIGGER IF EXISTS continuity_checkpoint_canonical_changed;
        DROP TRIGGER IF EXISTS continuity_checkpoint_page_removed;
        DROP TRIGGER IF EXISTS continuity_checkpoint_page_renumbered;
        DROP TABLE IF EXISTS story_memory_fts;
        DROP TABLE story_memory_search;
        DROP TABLE story_memory_pages;
        DROP TABLE story_pages;

        CREATE TRIGGER page_revisions_immutable
        BEFORE UPDATE ON page_revisions
        BEGIN
          SELECT RAISE(ABORT, 'Page revisions are immutable');
        END;

        CREATE VIEW manuscript_pages AS
        WITH ordered_pages AS (
          SELECT page.id, page.chapter_id, page.ordinal,
                 page.canonical_revision_id, page.display_revision_id,
                 page.created_at, page.updated_at, volume.story_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY volume.story_id
                   ORDER BY volume.ordinal, chapter.ordinal, page.ordinal, page.id
                 ) AS page_number
            FROM pages page
            JOIN chapters chapter ON chapter.id = page.chapter_id
            JOIN volumes volume ON volume.id = chapter.volume_id
        )
        SELECT ordered.id, ordered.story_id, ordered.page_number,
               COALESCE(display.content, canonical.content, '') AS content,
               canonical.direction AS user_input, canonical.model,
               canonical.prompt_tokens, canonical.completion_tokens,
               CASE WHEN canonical.cost_known = 1 THEN canonical.cost_usd ELSE NULL END AS cost_usd,
               NULL AS image_media_type,
               NULL AS image_prompt, delta.model AS continuity_model,
               delta.prompt_tokens AS continuity_prompt_tokens,
               delta.completion_tokens AS continuity_completion_tokens,
               COALESCE(delta.spend_usd, 0) AS continuity_cost_usd,
               delta.status AS continuity_status,
               delta.error AS continuity_error,
               delta.error_code AS continuity_error_code,
               ordered.created_at, ordered.updated_at,
               ordered.chapter_id, ordered.ordinal,
               ordered.canonical_revision_id, ordered.display_revision_id
          FROM ordered_pages ordered
          LEFT JOIN page_revisions canonical ON canonical.id = ordered.canonical_revision_id
          LEFT JOIN page_revisions display ON display.id = ordered.display_revision_id
          LEFT JOIN continuity_deltas delta ON delta.revision_id = ordered.canonical_revision_id;

        CREATE TRIGGER continuity_checkpoint_canonical_changed
        AFTER UPDATE OF canonical_revision_id ON pages
        WHEN OLD.canonical_revision_id IS NOT NEW.canonical_revision_id
        BEGIN
          DELETE FROM continuity_projection_checkpoints
           WHERE story_id = (
             SELECT story_id FROM manuscript_pages WHERE id = NEW.id
           )
             AND page_number >= COALESCE(
               (SELECT page_number FROM manuscript_pages WHERE id = NEW.id), 1
             );
        END;

        CREATE TRIGGER continuity_checkpoint_page_removed
        BEFORE DELETE ON pages
        BEGIN
          DELETE FROM continuity_projection_checkpoints
           WHERE story_id = (
             SELECT story_id FROM manuscript_pages WHERE id = OLD.id
           )
             AND page_number >= COALESCE(
               (SELECT page_number FROM manuscript_pages WHERE id = OLD.id), 1
             );
        END;
      `);
    },
  }),
  Object.freeze({
    version: 14,
    name: 'optional manuscript scenes',
    checksumSource: `Scenes are optional chapter-owned planning and play containers; page membership is noncanonical and deleting a scene never deletes prose.`,
    up(db) {
      db.exec(`
        CREATE TABLE scenes (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          chapter_id TEXT NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 300),
          mode TEXT NOT NULL DEFAULT 'author'
            CHECK (mode IN ('author', 'play', 'hybrid')),
          status TEXT NOT NULL DEFAULT 'planned'
            CHECK (status IN ('planned', 'in_progress', 'complete')),
          viewpoint_character_id TEXT CHECK (
            viewpoint_character_id IS NULL OR
            (length(trim(viewpoint_character_id)) > 0 AND length(viewpoint_character_id) <= 200)
          ),
          location TEXT CHECK (location IS NULL OR length(location) <= 500),
          story_time TEXT CHECK (story_time IS NULL OR length(story_time) <= 500),
          purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 4000),
          stakes TEXT CHECK (stakes IS NULL OR length(stakes) <= 4000),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (chapter_id, ordinal)
        );

        CREATE INDEX idx_scenes_chapter_order
          ON scenes (chapter_id, ordinal);

        CREATE TABLE scene_pages (
          scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
          page_id TEXT PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_scene_pages_scene
          ON scene_pages (scene_id, page_id);

        CREATE TRIGGER scene_pages_same_chapter_insert
        BEFORE INSERT ON scene_pages
        WHEN (SELECT chapter_id FROM pages WHERE id = NEW.page_id)
             IS NOT (SELECT chapter_id FROM scenes WHERE id = NEW.scene_id)
        BEGIN
          SELECT RAISE(ABORT, 'Scene pages must belong to the scene chapter');
        END;

        CREATE TRIGGER scene_pages_same_chapter_update
        BEFORE UPDATE OF scene_id, page_id ON scene_pages
        WHEN (SELECT chapter_id FROM pages WHERE id = NEW.page_id)
             IS NOT (SELECT chapter_id FROM scenes WHERE id = NEW.scene_id)
        BEGIN
          SELECT RAISE(ABORT, 'Scene pages must belong to the scene chapter');
        END;
      `);
    },
  }),
  Object.freeze({
    version: 15,
    name: 'optional scene play sessions',
    checksumSource: `Opt-in Session Zero contracts and immutable author/Scribe turns remain working history outside canonical manuscript prose; paid requests retain the exact contract snapshot.`,
    up(db) {
      db.exec(`
        CREATE TABLE play_sessions (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
          participants_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(participants_json)),
          scribe_initiative TEXT NOT NULL DEFAULT 'balanced'
            CHECK (scribe_initiative IN ('low', 'balanced', 'high')),
          challenge TEXT NOT NULL DEFAULT 'balanced'
            CHECK (challenge IN ('gentle', 'balanced', 'harsh')),
          pacing TEXT NOT NULL DEFAULT 'balanced'
            CHECK (pacing IN ('reflective', 'balanced', 'brisk')),
          consequences TEXT NOT NULL DEFAULT 'meaningful'
            CHECK (consequences IN ('guarded', 'meaningful', 'severe')),
          allow_character_death INTEGER NOT NULL DEFAULT 0
            CHECK (allow_character_death IN (0, 1)),
          suggestions TEXT NOT NULL DEFAULT 'on_request'
            CHECK (suggestions IN ('off', 'on_request', 'proactive')),
          player_interiority TEXT NOT NULL DEFAULT 'owner_only'
            CHECK (player_interiority IN ('owner_only', 'sensory_only', 'shared')),
          notes TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at TEXT,
          UNIQUE (scene_id, ordinal)
        );

        CREATE UNIQUE INDEX idx_play_sessions_one_active
          ON play_sessions (scene_id) WHERE status = 'active';
        CREATE INDEX idx_play_sessions_scene_order
          ON play_sessions (scene_id, ordinal);

        CREATE TABLE play_turns (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          session_id TEXT NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          speaker TEXT NOT NULL CHECK (speaker IN ('owner', 'scribe', 'system')),
          input_kind TEXT NOT NULL CHECK (input_kind IN ('act', 'say', 'ask', 'direct', 'response', 'note')),
          character_id TEXT,
          content TEXT NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 20000),
          source TEXT NOT NULL CHECK (source IN ('author', 'ai', 'system')),
          model TEXT,
          prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
          completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
          cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
          cost_known INTEGER NOT NULL DEFAULT 1 CHECK (cost_known IN (0, 1)),
          billed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (billed_attempts >= 0),
          idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 300),
          request_hash TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (session_id, ordinal)
        );

        CREATE UNIQUE INDEX idx_play_turns_request_key
          ON play_turns (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX idx_play_turns_session_order
          ON play_turns (session_id, ordinal);

        CREATE TABLE play_ai_requests (
          session_id TEXT NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0 AND length(idempotency_key) <= 300),
          request_hash TEXT NOT NULL,
          contract_json TEXT NOT NULL CHECK (json_valid(contract_json)),
          owner_turn_id TEXT NOT NULL REFERENCES play_turns (id) ON DELETE CASCADE,
          response_turn_id TEXT REFERENCES play_turns (id) ON DELETE SET NULL,
          status TEXT NOT NULL CHECK (status IN ('in_flight', 'succeeded', 'failed')),
          spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
          cost_known INTEGER NOT NULL DEFAULT 1 CHECK (cost_known IN (0, 1)),
          billed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (billed_attempts >= 0),
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          PRIMARY KEY (session_id, idempotency_key)
        );

        CREATE UNIQUE INDEX idx_play_ai_one_in_flight
          ON play_ai_requests (session_id) WHERE status = 'in_flight';
      `);
    },
  }),
  Object.freeze({
    version: 16,
    name: 'living campaign state',
    checksumSource: `Revisioned campaign entries unify owner-authored facts and source-linked page or Play evidence. Explicit idempotent AI proposal requests are durable and accounted without changing prose or continuity deltas.`,
    up(db) {
      db.exec(`
        CREATE TABLE campaign_entries (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN (
            'relationship', 'promise', 'debt', 'knowledge_boundary', 'secret',
            'npc_goal', 'faction', 'quest', 'condition', 'inventory',
            'resource', 'world_time', 'deadline', 'clock'
          )),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'retired')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_campaign_entries_story_kind
          ON campaign_entries (story_id, status, kind, updated_at);

        CREATE TABLE campaign_entry_revisions (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          entry_id TEXT NOT NULL REFERENCES campaign_entries (id) ON DELETE CASCADE,
          revision_number INTEGER NOT NULL CHECK (revision_number > 0),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 300),
          details_json TEXT NOT NULL CHECK (json_valid(details_json)),
          subject_character_id TEXT,
          related_character_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'secret')),
          known_by_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(known_by_json)),
          witnesses_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(witnesses_json)),
          source_type TEXT NOT NULL CHECK (source_type IN ('author', 'page_revision', 'play_turn')),
          source_id TEXT,
          source_excerpt TEXT CHECK (source_excerpt IS NULL OR length(source_excerpt) <= 1200),
          note TEXT CHECK (note IS NULL OR length(note) <= 2000),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (entry_id, revision_number)
        );

        CREATE INDEX idx_campaign_revisions_entry
          ON campaign_entry_revisions (entry_id, revision_number);
        CREATE INDEX idx_campaign_revisions_source
          ON campaign_entry_revisions (source_type, source_id);

        CREATE TABLE campaign_ai_requests (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0 AND length(idempotency_key) <= 300),
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('in_flight', 'succeeded', 'failed')),
          result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
          spend_usd REAL NOT NULL DEFAULT 0 CHECK (spend_usd >= 0),
          cost_known INTEGER NOT NULL DEFAULT 1 CHECK (cost_known IN (0, 1)),
          billed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (billed_attempts >= 0),
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          finished_at TEXT,
          UNIQUE (story_id, idempotency_key)
        );

        CREATE UNIQUE INDEX idx_campaign_ai_one_in_flight
          ON campaign_ai_requests (story_id) WHERE status = 'in_flight';
      `);
    },
  }),
  Object.freeze({
    version: 17,
    name: 'alternate Play branches',
    checksumSource: `Play branches form immutable ancestry from exact turns. Selection remains noncanonical; Play-to-Prose uses the ordinary prepared-page transaction.`,
    up(db) {
      db.exec(`
        CREATE TABLE play_branches (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          session_id TEXT NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
          parent_branch_id TEXT REFERENCES play_branches (id) ON DELETE CASCADE,
          fork_turn_id TEXT REFERENCES play_turns (id) ON DELETE CASCADE,
          selected_successor_turn_id TEXT REFERENCES play_turns (id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (session_id, ordinal)
        );
        ALTER TABLE play_sessions ADD COLUMN selected_branch_id TEXT REFERENCES play_branches (id) ON DELETE SET NULL;
        ALTER TABLE play_turns ADD COLUMN branch_id TEXT REFERENCES play_branches (id) ON DELETE CASCADE;
      `);
      const sessions = db.prepare('SELECT id FROM play_sessions ORDER BY created_at, id').all();
      for (const session of sessions) {
        const branchId = `${session.id}-main`;
        db.prepare("INSERT INTO play_branches (id, session_id, ordinal, name) VALUES (?, ?, 1, 'Main path')")
          .run(branchId, session.id);
        db.prepare('UPDATE play_turns SET branch_id = ? WHERE session_id = ?').run(branchId, session.id);
        db.prepare('UPDATE play_sessions SET selected_branch_id = ? WHERE id = ?').run(branchId, session.id);
      }
      db.exec(`
        CREATE INDEX idx_play_branches_session_order ON play_branches (session_id, ordinal);
        CREATE INDEX idx_play_turns_branch_order ON play_turns (branch_id, ordinal);
        CREATE TRIGGER play_turn_branch_owner_insert
        BEFORE INSERT ON play_turns WHEN NEW.branch_id IS NOT NULL
        BEGIN
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM play_branches branch
             WHERE branch.id = NEW.branch_id AND branch.session_id = NEW.session_id
          ) THEN RAISE(ABORT, 'Play turn branch belongs to another session') END;
        END;
      `);
    },
  }),
  Object.freeze({
    version: 18,
    name: 'deterministic solo tools',
    checksumSource: `Reusable system-neutral tools keep explicit state. Frozen branch-aware records contain only results produced by local application code.`,
    up(db) {
      db.exec(`
        CREATE TABLE solo_tools (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          kind TEXT NOT NULL CHECK (kind IN ('dice', 'oracle', 'table', 'deck', 'fields', 'clock')),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
          config_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (story_id, ordinal)
        );
        CREATE TABLE play_tool_records (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
          scene_id TEXT NOT NULL REFERENCES scenes (id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL REFERENCES play_branches (id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          after_turn_ordinal INTEGER NOT NULL CHECK (after_turn_ordinal >= 0),
          tool_id TEXT REFERENCES solo_tools (id) ON DELETE SET NULL,
          tool_kind TEXT NOT NULL CHECK (tool_kind IN ('dice', 'oracle', 'table', 'deck', 'fields', 'clock')),
          tool_name TEXT NOT NULL CHECK (length(trim(tool_name)) > 0),
          input_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          summary TEXT NOT NULL CHECK (length(trim(summary)) > 0 AND length(summary) <= 2000),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (session_id, ordinal)
        );
        CREATE INDEX idx_solo_tools_story_order ON solo_tools (story_id, active, ordinal);
        CREATE INDEX idx_play_tool_records_scene_order ON play_tool_records (scene_id, session_id, ordinal);
        CREATE INDEX idx_play_tool_records_branch_order ON play_tool_records (branch_id, after_turn_ordinal, ordinal);
        CREATE TRIGGER play_tool_records_frozen
        BEFORE UPDATE ON play_tool_records
        BEGIN
          SELECT RAISE(ABORT, 'Committed solo-tool results are immutable');
        END;
      `);
    },
  }),
  Object.freeze({
    version: 19,
    name: 'playable fiction state',
    checksumSource: FICTION_SCHEMA,
    up(db) { db.exec(FICTION_SCHEMA); },
  }),
  Object.freeze({
    version: 20,
    name: 'playable fiction illustrations',
    checksumSource: FICTION_MEDIA_SCHEMA,
    up(db) { db.exec(FICTION_MEDIA_SCHEMA); },
  }),
  Object.freeze({
    version: 21,
    name: 'bounded fiction quality calls',
    checksumSource: FICTION_CALL_SCHEMA,
    up(db) { db.exec(FICTION_CALL_SCHEMA); },
  }),
  Object.freeze({
    version: 22,
    name: 'visual fiction catalogues',
    checksumSource: FICTION_LIBRARY_SCHEMA,
    up(db) { db.exec(FICTION_LIBRARY_SCHEMA); },
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
    '(or DB_PATH to a new file). InkMorrow 5.0 does not open older databases or development-edition data.';
}

function verifyMigrationLedger(db, version, migrations = MIGRATIONS, checksumOf = migrationChecksum) {
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
        row.checksum !== checksumOf(expected)) {
      throw new DatabaseCompatibilityError(
        'INVALID_MIGRATION_LEDGER',
        `Migration ledger entry ${index + 1} does not match this Ink Morrow build.`
      );
    }
  }
}

function inspectExistingDatabase(dbPath, migrations = MIGRATIONS) {
  if (dbPath === ':memory:') return { kind: 'empty', version: 0 };
  const resolved = path.resolve(dbPath);
  const reject = (code, detail) => { throw new DatabaseCompatibilityError(code, databaseMessage(resolved, detail)); };
  let stat;
  try { stat = fs.lstatSync(resolved); }
  catch (error) { if (error.code !== 'ENOENT') reject('INVALID_DATABASE', 'The database path could not be inspected.'); }
  if (!stat) {
    if (hasDatabaseSidecars(resolved)) reject('INVALID_DATABASE', 'A missing database has journal sidecars. Recover with its original version.');
    return { kind: 'empty', version: 0 };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) reject('INVALID_DATABASE', 'Use a regular database file, not a directory or symbolic link.');
  if (stat.size === 0) {
    if (hasDatabaseSidecars(resolved)) reject('INVALID_DATABASE', 'An empty database has journal sidecars and is not fresh storage.');
    return { kind: 'empty', version: 0 };
  }
  try {
    return inspectCopy(resolved, (copied) => {
      let db;
      try {
        // Recovery and SHM creation can occur only inside the private copy.
        db = new DatabaseSync(copied);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
        if (!tables.includes('ink_morrow_schema')) reject(tables.some((name) => LEGACY_TABLES.has(name)) ? 'LEGACY_DATABASE' : 'UNRECOGNIZED_DATABASE', 'InkMorrow 5.0 could not verify this database family. Older data is not upgraded.');
        if (!tables.includes('schema_migrations')) reject('INVALID_DATABASE_IDENTITY', 'The 5.0 schema identity is incomplete.');
        const identity = db.prepare('SELECT family, version FROM ink_morrow_schema WHERE singleton = 1').get();
        if (!identity || identity.family !== DATABASE_FAMILY || !Number.isSafeInteger(Number(identity.version))) reject('UNSUPPORTED_DATABASE_FAMILY', 'This is not an InkMorrow 5.0 release database.');
        const version = Number(identity.version);
        if (version > DATABASE_SCHEMA_VERSION) reject('FUTURE_DATABASE', `This database uses future schema version ${version}; this build supports through ${DATABASE_SCHEMA_VERSION}.`);
        if (version < 1) reject('INVALID_DATABASE_IDENTITY', 'This database records an invalid schema version.');
        const applicationId = Number(db.prepare('PRAGMA application_id').get().application_id);
        const userVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
        if (applicationId !== SQLITE_APPLICATION_ID || userVersion !== version) reject('INVALID_DATABASE_IDENTITY', 'The SQLite and InkMorrow identities disagree.');
        verifyMigrationLedger(db, version, migrations);
        validateDatabaseIntegrity(db);
        return { kind: 'recognized', version };
      } finally { db?.close(); }
    });
  } catch (error) {
    if (error instanceof DatabaseCompatibilityError) throw error;
    reject('INVALID_DATABASE', `InkMorrow 5.0 could not safely inspect this database (${error.message}).`);
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
      UPDATE ink_morrow_schema
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
      CREATE VIRTUAL TABLE IF NOT EXISTS continuity_search_fts
        USING fts5(revision_id UNINDEXED, story_id UNINDEXED, content);
      CREATE TRIGGER IF NOT EXISTS continuity_search_fts_delete
      AFTER DELETE ON continuity_search BEGIN
        DELETE FROM continuity_search_fts WHERE revision_id = OLD.revision_id;
      END;
      DELETE FROM continuity_search_fts
        WHERE revision_id NOT IN (SELECT revision_id FROM continuity_search);
      INSERT INTO continuity_search_fts (revision_id, story_id, content)
        SELECT s.revision_id, s.story_id, s.content
          FROM continuity_search s
         WHERE NOT EXISTS (
           SELECT 1 FROM continuity_search_fts f WHERE f.revision_id = s.revision_id
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
  const row = db.prepare('SELECT family, version, created_at, updated_at FROM ink_morrow_schema WHERE singleton = 1').get();
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
