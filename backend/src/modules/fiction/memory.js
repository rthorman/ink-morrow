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
  const cte = `WITH RECURSIVE path(id, parent_id, changes_json, depth) AS (
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
  function facts(gameId, headId, { query = '', id = null, includeRemoved = false, limit = 32 } = {}) {
    const words = [...new Set(query.toLowerCase().match(/[\p{L}]{3,}/gu) || [])].slice(0, 12);
    const match = words.length ? words.map(() => "CASE WHEN instr(lower(json_extract(fact, '$.text')), ?) > 0 THEN 3 ELSE 0 END").join(' + ') : '0';
    const rows = db.prepare(`${cte} SELECT fact, op FROM ranked WHERE n = 1
      AND (? IS NULL OR json_extract(fact, '$.id') = ?) AND (? OR op != 'remove')
      ORDER BY (${match}) + CASE WHEN json_extract(fact, '$.visibility') = 'secret' THEN 2 ELSE 0 END
        + CASE WHEN json_extract(fact, '$.status') = 'active' THEN 4 ELSE 0 END
        + CASE WHEN json_extract(fact, '$.kind') IN ('commitment', 'goal') THEN 3 ELSE 0 END DESC, depth, ordinal DESC LIMIT ?`)
      .all(gameId, headId, gameId, gameId, id, id, Number(includeRemoved), ...words, Math.max(1, Math.min(128, limit)));
    return rows.map((row) => ({ ...JSON.parse(row.fact), ...(row.op === 'remove' ? { retired: true } : {}) }));
  }
  return { facts, get: (gameId, headId, id, includeRemoved = false) => facts(gameId, headId, { id, includeRemoved, limit: 1 })[0] || null };
}

module.exports = { compactFacts, createMemory };
