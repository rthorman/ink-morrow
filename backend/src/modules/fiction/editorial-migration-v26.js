'use strict';
// Published migration source is immutable; append a new migration for changes.
const SQL = `
CREATE TABLE fiction_editorial_passages (
 beat_id TEXT PRIMARY KEY REFERENCES fiction_beats(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 episode_number INTEGER,episode_title TEXT
);
CREATE INDEX fiction_editorial_passage_game ON fiction_editorial_passages(game_id);
INSERT INTO fiction_editorial_passages SELECT id,game_id,json_extract(state_json,'$.episode.number'),json_extract(state_json,'$.episode.title') FROM fiction_beats WHERE kind IN ('opening','scene');
CREATE TRIGGER fiction_editorial_passage_insert AFTER INSERT ON fiction_beats WHEN NEW.kind IN ('opening','scene') BEGIN
 INSERT INTO fiction_editorial_passages VALUES(NEW.id,NEW.game_id,json_extract(NEW.state_json,'$.episode.number'),json_extract(NEW.state_json,'$.episode.title'));
END;
CREATE TABLE fiction_editorial_revisions (
 id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 parent_id TEXT REFERENCES fiction_editorial_revisions(id) DEFERRABLE INITIALLY DEFERRED,
 beat_id TEXT NOT NULL UNIQUE REFERENCES fiction_beats(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 value_json TEXT NOT NULL CHECK(length(CAST(value_json AS BLOB))<=65536)
);
CREATE INDEX fiction_editorial_game ON fiction_editorial_revisions(game_id);
CREATE TRIGGER fiction_editorial_immutable BEFORE UPDATE ON fiction_editorial_revisions BEGIN SELECT RAISE(ABORT,'Editorial revisions are immutable'); END;
`;
module.exports = {
  SQL,
  up(db) {
    db.exec(SQL);
  },
};
