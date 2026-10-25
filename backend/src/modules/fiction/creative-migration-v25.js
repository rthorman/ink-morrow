'use strict';
// Published migration source is immutable. Add a later migration for changes.
const SQL = `
CREATE TABLE fiction_config_revisions (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 parent_id TEXT REFERENCES fiction_config_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 beat_id TEXT NOT NULL UNIQUE REFERENCES fiction_beats(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 value_json TEXT NOT NULL CHECK(length(CAST(value_json AS BLOB))<=32768),public_change INTEGER NOT NULL CHECK(public_change IN (0,1))
);
CREATE INDEX fiction_config_game ON fiction_config_revisions(game_id);
CREATE TRIGGER fiction_config_immutable BEFORE UPDATE ON fiction_config_revisions BEGIN SELECT RAISE(ABORT,'Configuration revisions are immutable'); END;
CREATE TABLE fiction_reference_revisions (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('world','scribe','character')),subject_id TEXT,
 parent_id TEXT REFERENCES fiction_reference_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 beat_id TEXT NOT NULL UNIQUE REFERENCES fiction_beats(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 value_json TEXT NOT NULL CHECK(length(CAST(value_json AS BLOB))<=65536),source_json TEXT,bindings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_type(bindings_json)='array' AND json_array_length(bindings_json)<=32),
 public_change INTEGER NOT NULL CHECK(public_change IN (0,1)),CHECK((subject_kind='character')=(subject_id IS NOT NULL))
);
CREATE INDEX fiction_reference_game ON fiction_reference_revisions(game_id);
CREATE TRIGGER fiction_reference_immutable BEFORE UPDATE ON fiction_reference_revisions BEGIN SELECT RAISE(ABORT,'Reference revisions are immutable'); END;
CREATE TABLE fiction_command_fences(game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,action_key TEXT NOT NULL,PRIMARY KEY(game_id,action_key));
CREATE TABLE fiction_command_receipts (
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,action_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL,beat_id TEXT NOT NULL REFERENCES fiction_beats(id) ON DELETE CASCADE,result_json TEXT NOT NULL,
 PRIMARY KEY(game_id,action_key)
);
CREATE TABLE fiction_context_manifests (
 request_id TEXT PRIMARY KEY REFERENCES fiction_requests(id) ON DELETE CASCADE,manifest_json TEXT NOT NULL CHECK(length(CAST(manifest_json AS BLOB))<=32768)
);
CREATE TABLE fiction_narrative_assemblies (
 beat_id TEXT PRIMARY KEY REFERENCES fiction_beats(id) ON DELETE CASCADE,manifest_json TEXT NOT NULL CHECK(length(CAST(manifest_json AS BLOB))<=32768)
);
CREATE TRIGGER fiction_assembly_immutable BEFORE UPDATE ON fiction_narrative_assemblies BEGIN SELECT RAISE(ABORT,'Narrative assembly is immutable'); END;
CREATE TABLE fiction_operation_plans (id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,plan_json TEXT NOT NULL CHECK(length(CAST(plan_json AS BLOB))<=32768),expires_at INTEGER NOT NULL,request_id TEXT REFERENCES fiction_requests(id) ON DELETE CASCADE);
CREATE INDEX fiction_plan_game ON fiction_operation_plans(game_id);
CREATE TABLE provider_model_limits (
 profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,model_id TEXT NOT NULL,
 context_tokens INTEGER NOT NULL CHECK(context_tokens BETWEEN 4096 AND 2000000),output_tokens INTEGER NOT NULL CHECK(output_tokens BETWEEN 1024 AND 128000),
 source TEXT NOT NULL CHECK(source IN ('catalogue','owner')),PRIMARY KEY(profile_id,model_id)
);
`;
function up(db) {
  db.exec(SQL);
}
module.exports = { SQL, up };
