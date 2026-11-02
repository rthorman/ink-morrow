"use strict";
const SQL = `
CREATE TABLE fiction_book_snapshots (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 branch_id TEXT NOT NULL,head_id TEXT,document_hash TEXT NOT NULL,document_json TEXT NOT NULL,byte_size INTEGER NOT NULL,preview_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX fiction_book_snapshot_game ON fiction_book_snapshots(game_id,branch_id,head_id,document_hash);
CREATE TRIGGER fiction_book_snapshot_immutable BEFORE UPDATE ON fiction_book_snapshots BEGIN SELECT RAISE(ABORT,'Book editions are immutable');END;
CREATE TABLE fiction_book_jobs (
 id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL REFERENCES fiction_book_snapshots(id) ON DELETE CASCADE,
 action_key TEXT NOT NULL UNIQUE,formats_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('requested','running','succeeded','failed','interrupted','cancelled')),
 error_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX fiction_one_book_renderer ON fiction_book_jobs((1)) WHERE status='running';
CREATE TABLE fiction_book_files (
 storage_key TEXT PRIMARY KEY,sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL,
 content_type TEXT NOT NULL,format TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1))
);
CREATE TABLE fiction_book_outputs (
 job_id TEXT NOT NULL REFERENCES fiction_book_jobs(id) ON DELETE CASCADE,format TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ready','failed')),storage_key TEXT REFERENCES fiction_book_files(storage_key),error_code TEXT,
 PRIMARY KEY(job_id,format)
);
CREATE TRIGGER fiction_book_pin_available BEFORE INSERT ON fiction_book_outputs WHEN NEW.storage_key IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fiction_book_files WHERE storage_key=NEW.storage_key AND available=1) THEN RAISE(ABORT,'Book file is unavailable') END;
END;
CREATE TABLE fiction_reading_shares (
 id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL REFERENCES fiction_book_snapshots(id) ON DELETE CASCADE,
 capability_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;
module.exports = {
  SQL,
  up(db) {
    db.exec(SQL);
  },
};
