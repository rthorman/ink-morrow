'use strict';
const SQL = `
CREATE TABLE fiction_inventory (
 asset_id TEXT PRIMARY KEY REFERENCES fiction_assets(id) ON DELETE CASCADE,
 alt_text TEXT NOT NULL DEFAULT '', provenance TEXT NOT NULL DEFAULT 'retained',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO fiction_inventory(asset_id) SELECT id FROM fiction_assets;
CREATE TRIGGER fiction_inventory_insert AFTER INSERT ON fiction_assets BEGIN
 INSERT INTO fiction_inventory(asset_id) VALUES(NEW.id);
END;
CREATE TABLE fiction_inventory_versions (
 game_id TEXT PRIMARY KEY REFERENCES fiction_games(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO fiction_inventory_versions(game_id) SELECT id FROM fiction_games;
CREATE TRIGGER fiction_inventory_game AFTER INSERT ON fiction_games BEGIN
 INSERT INTO fiction_inventory_versions(game_id) VALUES(NEW.id);
END;
CREATE TRIGGER fiction_inventory_bump AFTER INSERT ON fiction_assets BEGIN
 UPDATE fiction_inventory_versions SET revision=revision+1 WHERE game_id=NEW.game_id;
END;
CREATE TABLE fiction_art_jobs (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES fiction_games(id) ON DELETE CASCADE,
 action_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 branch_id TEXT NOT NULL, head_id TEXT, expected_revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted','cancelled')),
 asset_id TEXT REFERENCES fiction_assets(id), placed INTEGER NOT NULL DEFAULT 0,
 billed_attempts INTEGER NOT NULL DEFAULT 0, cost_usd REAL, error_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(game_id,action_key)
);
CREATE UNIQUE INDEX fiction_one_art_job ON fiction_art_jobs(game_id) WHERE status='running';
`;
module.exports={SQL,up(db){db.exec(SQL);}};
