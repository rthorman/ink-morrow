'use strict';

// Snapshots hold a working set, never the only copy of history. Initial facts
// and every subsequent change remain in immutable game/beat records.
function compactFacts(state, limit = 128) {
  if (state.facts.length <= limit) return state;
  const ranked = state.facts.map((fact, index) => ({ fact, index, priority:
    (fact.visibility === 'secret' ? 8 : 0) +
    (fact.status === 'active' ? 4 : 0) +
    (['commitment', 'goal'].includes(fact.kind) ? 2 : 0),
  })).sort((a, b) => b.priority - a.priority || b.index - a.index).slice(0, limit);
  state.facts = ranked.sort((a, b) => a.index - b.index).map(({ fact }) => fact);
  return state;
}

function createMemory(db) {
  const legacy = `WITH RECURSIVE path(id, parent_id, changes_json, depth) AS (
    SELECT id, parent_id, changes_json, 0 FROM fiction_beats WHERE game_id = ? AND id = ?
    UNION ALL SELECT b.id, b.parent_id, b.changes_json, path.depth + 1
      FROM fiction_beats b JOIN path ON b.id = path.parent_id WHERE b.game_id = ?
  ), versions AS (
    SELECT json_extract(j.value, '$.fact') AS fact, json_extract(j.value, '$.op') AS op,
      path.depth AS depth, CAST(j.key AS INTEGER) AS ordinal
      FROM path, json_each(path.changes_json) j WHERE json_type(j.value, '$.fact') = 'object'
    UNION ALL SELECT j.value, 'initial', 2147483647, CAST(j.key AS INTEGER)
      FROM fiction_games g, json_each(g.initial_state_json, '$.facts') j WHERE g.id = ?
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY json_extract(fact, '$.id') ORDER BY depth, ordinal DESC) AS n FROM versions
  )`;
  const projected = `WITH RECURSIVE path(id,parent_id,depth) AS (
    SELECT id,parent_id,0 FROM fiction_beats WHERE game_id=? AND id=?
    UNION ALL SELECT b.id,b.parent_id,p.depth+1 FROM fiction_beats b JOIN path p ON b.id=p.parent_id WHERE b.game_id=?
  ), versions AS (
    SELECT e.fact_json AS fact,e.op,p.depth,e.ordinal FROM path p JOIN fiction_fact_events e ON e.beat_id=p.id
    UNION ALL SELECT fact_json,op,2147483647,ordinal FROM fiction_fact_events WHERE game_id=? AND beat_id IS NULL
  ), ranked AS (SELECT *,row_number() OVER (PARTITION BY json_extract(fact,'$.id') ORDER BY depth,ordinal DESC) AS n FROM versions)`;
  const cte = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fiction_fact_events'").get() ? projected : legacy;
  function facts(gameId, headId, { query = '', id = null, kind = null, status = null, includeRemoved = false, publicOnly = false, limit = 32, offset = 0, visibility = null, actorIds = [], ids = [], campaignSection=null } = {}) {
    const words = [...new Set(query.toLowerCase().match(/[\p{L}]{3,}/gu) || [])].slice(0, 12);
    const match = words.length ? words.map(() => "CASE WHEN instr(lower(json_extract(fact, '$.text')), ?) > 0 THEN 3 ELSE 0 END").join(' + ') : '0';
    const actors=[...new Set(actorIds)].slice(0,24);
    const actorRank=actors.length?`CASE WHEN json_extract(fact, '$.actor_id') IN (${actors.map(()=>'?').join(',')}) THEN 12 ELSE 0 END`:'0';
    const rows = db.prepare(`${cte} SELECT fact, op FROM ranked WHERE n = 1
      AND (? IS NULL OR json_extract(fact, '$.id') = ?) AND (? OR op != 'remove')
      AND (? = 0 OR json_extract(fact, '$.visibility') = 'public')
      AND (? IS NULL OR json_extract(fact, '$.kind') = ?)
      AND (? IS NULL OR json_extract(fact, '$.status') = ?)
      AND (? IS NULL OR json_extract(fact, '$.visibility') = ?)
      AND (? IS NULL OR json_extract(fact,'$.campaign_section')=? OR (json_extract(fact,'$.campaign_section') IS NULL AND CASE WHEN json_extract(fact,'$.visibility')='secret' THEN 'secrets' ELSE CASE json_extract(fact,'$.kind') WHEN 'relationship' THEN 'relationships' WHEN 'commitment' THEN 'promises' WHEN 'goal' THEN 'goals' WHEN 'resource' THEN 'inventory' ELSE 'knowledge' END END=?))
      AND (?=0 OR json_extract(fact,'$.id') IN (SELECT value FROM json_each(?)))
      AND (? = 0 OR (${match}) > 0)
      ORDER BY (${actorRank}) + (${match}) + CASE WHEN json_extract(fact, '$.visibility') = 'secret' THEN 2 ELSE 0 END
        + CASE WHEN json_extract(fact, '$.status') = 'active' THEN 4 ELSE 0 END
        + CASE WHEN json_extract(fact, '$.kind') IN ('commitment', 'goal') THEN 3 ELSE 0 END DESC, depth, ordinal DESC LIMIT ? OFFSET ?`)
      .all(gameId, headId, gameId, gameId, id, id, Number(includeRemoved), Number(publicOnly), kind, kind, status, status, visibility, visibility,campaignSection,campaignSection,campaignSection, Number(ids.length>0), JSON.stringify(ids.slice(0,128)), Number(publicOnly && words.length > 0), ...words, ...actors, ...words, Math.max(1, Math.min(128, limit)), Math.max(0, Math.min(1000000, offset)));
    return rows.map((row) => ({ ...JSON.parse(row.fact), ...(row.op === 'remove' ? { retired: true } : {}) }));
  }
  return { facts, get: (gameId, headId, id, includeRemoved = false) => facts(gameId, headId, { id, includeRemoved, limit: 1 })[0] || null };
}

module.exports = { compactFacts, createMemory };
