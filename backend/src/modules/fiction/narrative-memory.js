"use strict";
// Read-only projections of the selected immutable ancestry. No new ledger,
// inferred semantic events, global-latest references or model calls.
function createNarrativeMemory(db) {
  const path = `WITH RECURSIVE path(id,parent_id,depth) AS (
 SELECT id,parent_id,0 FROM fiction_beats WHERE game_id=? AND id=?
 UNION ALL SELECT b.id,b.parent_id,p.depth+1 FROM fiction_beats b JOIN path p ON b.id=p.parent_id WHERE b.game_id=?)`;
  function sources(gameId, head, ids) {
    if (!ids.length) return [];
    const rows = db
      .prepare(
        `${path}, events AS (
   SELECT e.fact_id,e.op,e.beat_id,e.ordinal,p.depth FROM path p JOIN fiction_fact_events e ON e.beat_id=p.id
   UNION ALL SELECT fact_id,op,beat_id,ordinal,2147483647 FROM fiction_fact_events WHERE game_id=? AND beat_id IS NULL
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY fact_id ORDER BY depth,ordinal DESC) AS rank FROM events WHERE fact_id IN(SELECT value FROM json_each(?)))
  SELECT r.fact_id,r.op,r.beat_id AS source_beat_id,v.source_kind,v.source_field,v.quote,v.sha256 FROM ranked r LEFT JOIN fiction_effect_evidence v ON v.beat_id=r.beat_id AND v.change_index=r.ordinal WHERE rank=1`,
      )
      .all(
        gameId,
        head,
        gameId,
        gameId,
        JSON.stringify([...new Set(ids)].slice(0, 512)),
      );
    return rows.map((row) => ({
      ...row,
      source_kind:
        row.source_kind ||
        (row.source_beat_id
          ? "recorded_fact_without_exact_quote"
          : "initial_fact"),
    }));
  }
  function outcomes(gameId, head, challengeId = null) {
    return db
      .prepare(
        `${path}, attempts AS MATERIALIZED (SELECT b.id,p.depth FROM path p JOIN fiction_beats b ON b.id=p.id WHERE b.kind='scene' AND json_extract(b.input_json,'$.challenge_id') IS NOT NULL AND (? IS NULL OR json_extract(b.input_json,'$.challenge_id')=?) ORDER BY p.depth LIMIT 12)
  SELECT b.id AS source_beat_id,json_extract(j.value,'$.challenge_id') AS challenge_id,json_extract(j.value,'$.approach_id') AS approach_id,json_extract(j.value,'$.outcome') AS outcome,json_extract(j.value,'$.explanation') AS explanation
  FROM attempts a JOIN fiction_beats b ON b.id=a.id,json_each(b.state_json,'$.adjudications') j
  WHERE json_extract(j.value,'$.beat_id')=b.id ORDER BY a.depth LIMIT 12`,
      )
      .all(gameId, head, gameId, challengeId, challengeId)
      .reverse();
  }
  function chapter(gameId, head, state) {
    const episode = {
      number: state.episode.number,
      title: state.episode.title,
      phase: state.episode.phase,
      payoff_source_beat_id: state.episode.payoff_beat_id || null,
    };
    if (!state.editorial_revision_id)
      return { mode: "episode_grouping", episode };
    const row = db
      .prepare(
        "SELECT value_json FROM fiction_editorial_revisions WHERE game_id=? AND id=?",
      )
      .get(gameId, state.editorial_revision_id);
    if (!row) throw Error("Narrative handoff editorial source is missing.");
    const value = JSON.parse(row.value_json);
    const ids = [
      head,
      ...value.chapters.flatMap((c) => [c.after_beat_id, c.through_beat_id]),
    ].filter(Boolean);
    const ordinals = new Map(
      db
        .prepare(
          "SELECT beat_id,narrative_ordinal FROM fiction_history_index WHERE game_id=? AND beat_id IN(SELECT value FROM json_each(?))",
        )
        .all(gameId, JSON.stringify(ids))
        .map((r) => [r.beat_id, r.narrative_ordinal]),
    );
    const ordinal = ordinals.get(head) || 0;
    const start = (chapter) =>
      chapter.after_beat_id === null
        ? 1
        : (ordinals.get(chapter.after_beat_id) ?? Infinity) + 1;
    const next = value.chapters.find(
      (c) => c.open_tail && start(c) === ordinal + 1,
    );
    const selected =
      next ||
      value.chapters.find(
        (c) =>
          start(c) <= ordinal &&
          (c.open_tail || ordinal <= (ordinals.get(c.through_beat_id) ?? -1)),
      );
    if (!selected)
      return {
        mode: "unassigned",
        editorial_revision_id: state.editorial_revision_id,
        episode,
      };
    const previous = next
      ? value.chapters
          .filter(
            (c) =>
              !c.open_tail &&
              (ordinals.get(c.through_beat_id) ?? -1) <= ordinal,
          )
          .at(-1)
      : null;
    return {
      mode: "editorial",
      editorial_revision_id: state.editorial_revision_id,
      episode,
      new_chapter: Boolean(next),
      chapter: {
        id: selected.id,
        title: selected.title,
        volume_id: selected.volume_id,
        volume_title:
          value.volumes.find((v) => v.id === selected.volume_id)?.title || "",
        after_source_beat_id: selected.after_beat_id,
        through_source_beat_id: selected.through_beat_id,
      },
      previous_chapter: previous
        ? {
            id: previous.id,
            title: previous.title,
            through_source_beat_id: previous.through_beat_id,
          }
        : null,
    };
  }
  return { sources, outcomes, chapter };
}
module.exports = { createNarrativeMemory };
