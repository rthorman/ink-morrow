'use strict';
const SQL=`
CREATE TABLE fiction_listening_plans (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 branch_id TEXT NOT NULL,head_id TEXT,kind TEXT NOT NULL,source_hash TEXT NOT NULL,
 configuration_json TEXT NOT NULL,manifest_json TEXT NOT NULL,estimated_bytes INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER fiction_listening_plan_immutable BEFORE UPDATE ON fiction_listening_plans BEGIN SELECT RAISE(ABORT,'Listening source editions are immutable');END;
CREATE TABLE fiction_audio_cache (
 cache_key TEXT PRIMARY KEY,storage_key TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=16777216),media_type TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fiction_listening_jobs (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES fiction_listening_plans(id),action_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('requested','running','succeeded','failed','interrupted','cancelled')),
 completed INTEGER NOT NULL DEFAULT 0,error_code TEXT,storage_key TEXT,sha256 TEXT,byte_size INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(game_id,action_key),UNIQUE(plan_id)
);
CREATE UNIQUE INDEX fiction_one_listening_job ON fiction_listening_jobs(game_id) WHERE status IN ('requested','running');
CREATE UNIQUE INDEX fiction_one_listening_worker ON fiction_listening_jobs((1)) WHERE status='running';
CREATE TABLE fiction_audio_calls (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES fiction_listening_jobs(id) ON DELETE CASCADE,
 segment_index INTEGER NOT NULL,cache_key TEXT NOT NULL,model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('dispatched','succeeded','failed','interrupted')),
 billed_attempts INTEGER NOT NULL DEFAULT 1,cost_usd REAL,
 generation_id TEXT,UNIQUE(job_id,segment_index)
);
`;
module.exports={SQL,up(db){db.exec(SQL);}};
