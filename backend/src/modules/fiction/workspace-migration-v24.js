'use strict';

// Frozen migration source after publication. Append a new migration rather
// than changing these statements or their checksum input.
const SQL = `
CREATE TABLE fiction_history_index (
 beat_id TEXT PRIMARY KEY REFERENCES fiction_beats(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 depth INTEGER NOT NULL, narrative_ordinal INTEGER NOT NULL,
 is_narrative INTEGER NOT NULL, reader_visible INTEGER NOT NULL,
 previous_narrative_id TEXT, previous_reader_id TEXT
);
CREATE INDEX fiction_history_narratives ON fiction_history_index(game_id,narrative_ordinal) WHERE is_narrative=1;
CREATE TABLE fiction_history_jumps (
 beat_id TEXT NOT NULL REFERENCES fiction_beats(id) ON DELETE CASCADE,
 level INTEGER NOT NULL, ancestor_id TEXT NOT NULL REFERENCES fiction_beats(id),
 PRIMARY KEY(beat_id,level)
);
CREATE TABLE fiction_fact_events (
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL, beat_id TEXT REFERENCES fiction_beats(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, fact_id TEXT NOT NULL, op TEXT NOT NULL, fact_json TEXT NOT NULL,
 PRIMARY KEY(game_id,source_key,ordinal)
);
CREATE INDEX fiction_fact_events_beat ON fiction_fact_events(beat_id);
CREATE INDEX fiction_fact_events_identity ON fiction_fact_events(game_id,fact_id);
CREATE TABLE fiction_effect_evidence (
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 beat_id TEXT NOT NULL REFERENCES fiction_beats(id) ON DELETE CASCADE,
 change_index INTEGER NOT NULL CHECK(change_index BETWEEN 0 AND 11),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('narration','submitted_input','owner_assertion')),
 source_beat_id TEXT NOT NULL REFERENCES fiction_beats(id),
 source_field TEXT NOT NULL CHECK(source_field IN ('prose','input.text','changes.fact.text')),
 quote TEXT NOT NULL CHECK(length(quote) BETWEEN 1 AND 1000),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 visibility TEXT NOT NULL CHECK(visibility IN ('public','owner')),
 PRIMARY KEY(beat_id,change_index)
);
CREATE INDEX fiction_evidence_game ON fiction_effect_evidence(game_id);
CREATE TRIGGER fiction_evidence_immutable BEFORE UPDATE ON fiction_effect_evidence BEGIN SELECT RAISE(ABORT,'Evidence is immutable'); END;
CREATE TABLE fiction_owner_drafts (
 id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, scope_json TEXT NOT NULL,
 content_json TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
 submitted_json TEXT, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 expires_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX fiction_draft_scope ON fiction_owner_drafts(scope_key) WHERE deleted=0;
CREATE INDEX fiction_draft_expiry ON fiction_owner_drafts(expires_at);
CREATE TABLE fiction_local_receipts (
 action_key TEXT PRIMARY KEY, kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
 result_id TEXT NOT NULL, scope_key TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fiction_catalogue_action_fences (action_key TEXT PRIMARY KEY,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE fiction_action_fences (
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 action_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(game_id,action_key)
);
`;
const visible = (alias) => {
  const previous = `coalesce((SELECT state_json FROM fiction_beats WHERE id=${alias}.parent_id),(SELECT initial_state_json FROM fiction_games WHERE id=${alias}.game_id))`;
  const publicFields = [
    'cast',
    'control',
    'episode',
    'illustrations',
    'visuals',
    'pacing',
    'consequences',
    'play_style',
    'fourth_wall',
    'quality_mode'
  ];
  const changed = publicFields
    .map((field) => `json_extract(${alias}.state_json,'$.${field}') IS NOT json_extract(${previous},'$.${field}')`)
    .join(' OR ');
  return `(${alias}.kind IN ('opening','scene','clarification') OR (json_array_length(${alias}.changes_json)=0 AND (${changed})) OR EXISTS (SELECT 1 FROM json_each(${alias}.changes_json) e WHERE json_extract(e.value,'$.op')='introduce' OR json_extract(e.value,'$.fact.visibility')='public'))`;
};
const narrative = (alias) => `(${alias}.kind IN ('opening','scene'))`;
function up(db) {
  db.exec(SQL);
  db.exec(`WITH RECURSIVE tree AS (
    SELECT b.id,b.game_id,1 AS depth,CAST(${narrative('b')} AS INTEGER) AS n,
      NULL AS previous_narrative_id,NULL AS previous_reader_id,
      CASE WHEN ${narrative('b')} THEN b.id END AS last_narrative,
      CASE WHEN ${visible('b')} THEN b.id END AS last_reader
      FROM fiction_beats b WHERE parent_id IS NULL
    UNION ALL SELECT b.id,b.game_id,t.depth+1,t.n+CAST(${narrative('b')} AS INTEGER),
      t.last_narrative,t.last_reader,
      CASE WHEN ${narrative('b')} THEN b.id ELSE t.last_narrative END,
      CASE WHEN ${visible('b')} THEN b.id ELSE t.last_reader END
      FROM fiction_beats b JOIN tree t ON b.parent_id=t.id AND b.game_id=t.game_id
  ) INSERT INTO fiction_history_index SELECT t.id,t.game_id,t.depth,t.n,CAST(${narrative('b')} AS INTEGER),CAST(${visible('b')} AS INTEGER),t.previous_narrative_id,t.previous_reader_id
    FROM tree t JOIN fiction_beats b ON b.id=t.id;`);
  if (
    db.prepare('SELECT count(*) AS n FROM fiction_history_index').get().n !==
    db.prepare('SELECT count(*) AS n FROM fiction_beats').get().n
  )
    throw new Error('Cannot index an invalid fiction ancestry graph.');
  db.exec('INSERT INTO fiction_history_jumps SELECT id,0,parent_id FROM fiction_beats WHERE parent_id IS NOT NULL');
  for (let level = 1; level < 31; level++)
    db.prepare(
      `INSERT INTO fiction_history_jumps SELECT a.beat_id,?,b.ancestor_id FROM fiction_history_jumps a JOIN fiction_history_jumps b ON b.beat_id=a.ancestor_id AND b.level=a.level WHERE a.level=?`
    ).run(level, level - 1);
  db.exec(`INSERT INTO fiction_fact_events SELECT g.id,'initial',NULL,CAST(e.key AS INTEGER),json_extract(e.value,'$.id'),'initial',e.value FROM fiction_games g,json_each(g.initial_state_json,'$.facts') e;
    INSERT INTO fiction_fact_events SELECT b.game_id,'beat:'||b.id,b.id,CAST(e.key AS INTEGER),json_extract(e.value,'$.fact.id'),json_extract(e.value,'$.op'),json_extract(e.value,'$.fact') FROM fiction_beats b,json_each(b.changes_json) e WHERE json_type(e.value,'$.fact')='object';
    CREATE TRIGGER fiction_initial_fact_index AFTER INSERT ON fiction_games BEGIN
      INSERT INTO fiction_fact_events SELECT NEW.id,'initial',NULL,CAST(e.key AS INTEGER),json_extract(e.value,'$.id'),'initial',e.value FROM json_each(NEW.initial_state_json,'$.facts') e;
    END;
    CREATE TRIGGER fiction_history_insert AFTER INSERT ON fiction_beats BEGIN
      SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fiction_history_index WHERE beat_id=NEW.parent_id AND game_id=NEW.game_id) THEN RAISE(ABORT,'Parent must be indexed in the same story') END;
      INSERT INTO fiction_history_index SELECT NEW.id,NEW.game_id,coalesce(p.depth,0)+1,coalesce(p.narrative_ordinal,0)+CAST(${narrative('NEW')} AS INTEGER),CAST(${narrative('NEW')} AS INTEGER),CAST(${visible('NEW')} AS INTEGER),
        CASE WHEN p.is_narrative=1 THEN p.beat_id ELSE p.previous_narrative_id END,
        CASE WHEN p.reader_visible=1 THEN p.beat_id ELSE p.previous_reader_id END
        FROM (SELECT 1) LEFT JOIN fiction_history_index p ON p.beat_id=NEW.parent_id;
      INSERT INTO fiction_history_jumps WITH RECURSIVE jumps(level,ancestor_id) AS (
        SELECT 0,NEW.parent_id WHERE NEW.parent_id IS NOT NULL
        UNION ALL SELECT j.level+1,a.ancestor_id FROM jumps j JOIN fiction_history_jumps a ON a.beat_id=j.ancestor_id AND a.level=j.level WHERE j.level<30
      ) SELECT NEW.id,level,ancestor_id FROM jumps;
      INSERT INTO fiction_fact_events SELECT NEW.game_id,'beat:'||NEW.id,NEW.id,CAST(e.key AS INTEGER),json_extract(e.value,'$.fact.id'),json_extract(e.value,'$.op'),json_extract(e.value,'$.fact') FROM json_each(NEW.changes_json) e WHERE json_type(e.value,'$.fact')='object';
    END;`);
}
module.exports = { SQL, up };
