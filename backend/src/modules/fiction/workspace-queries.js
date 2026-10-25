'use strict';
const { fail, text, choice, publicState } = require('./model');

function createWorkspaceQueries({ db, store }) {
  const identifier = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('Invalid story identity.');
    return value;
  };
  const row = (game, beat) =>
    db.prepare('SELECT * FROM fiction_beats WHERE game_id=? AND id=?').get(game, beat) ||
    fail('Moment not found.', 'BEAT_NOT_FOUND', 404);
  const index = (beat) => (beat ? db.prepare('SELECT * FROM fiction_history_index WHERE beat_id=?').get(beat) : null);
  function ancestor(head, target) {
    if (target === null) return true;
    let current = index(head);
    const wanted = index(target);
    if (!current || !wanted || current.game_id !== wanted.game_id || current.depth < wanted.depth) return false;
    let difference = current.depth - wanted.depth;
    let id = head;
    let level = 0;
    while (difference) {
      if (difference % 2)
        id = db
          .prepare('SELECT ancestor_id FROM fiction_history_jumps WHERE beat_id=? AND level=?')
          .get(id, level)?.ancestor_id;
      difference = Math.floor(difference / 2);
      level++;
    }
    return id === target;
  }
  const narrativeAt = (head) => {
    const at = index(head);
    return at?.is_narrative ? head : at?.previous_narrative_id || null;
  };
  function context(gameId, query = {}) {
    const current = store.current(identifier(gameId));
    const branchId = query.branch_id === undefined ? current.branch.id : identifier(query.branch_id);
    const branch =
      db.prepare('SELECT * FROM fiction_branches WHERE game_id=? AND id=?').get(gameId, branchId) ||
      fail('Path not found.', 'PATH_NOT_FOUND', 404);
    const head =
      query.inspection_at === 'initial'
        ? null
        : query.inspection_at === undefined
          ? branch.head_beat_id
          : identifier(query.inspection_at);
    if (!ancestor(branch.head_beat_id, head))
      fail('That inspection moment is not on the selected path.', 'INSPECTION_BOUNDARY', 404);
    return { ...current, viewBranch: branch, head, state: store.stateAt(current.game, head), query };
  }
  function metadata(ctx) {
    return {
      game_id: ctx.game.id,
      revision: ctx.game.revision,
      active_branch_id: ctx.branch.id,
      view_branch_id: ctx.viewBranch.id,
      branch_head_id: ctx.viewBranch.head_beat_id,
      inspection_head_id: ctx.head,
      inspection_narrative_id: narrativeAt(ctx.head),
      latest_narrative_id: narrativeAt(ctx.viewBranch.head_beat_id),
      narrative_ordinal: index(ctx.head)?.narrative_ordinal || 0,
      action_target: { branch_id: ctx.branch.id, head_beat_id: ctx.branch.head_beat_id, revision: ctx.game.revision }
    };
  }
  function cursor(value, ctx, kind, section = '', query = '') {
    if (!value) return null;
    let result;
    try {
      if (typeof value !== 'string' || value.length > 2048) throw Error();
      result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    } catch {
      fail('Invalid inspection cursor.', 'CURSOR_INVALID');
    }
    if (
      result.v !== 1 ||
      result.game !== ctx.game.id ||
      result.branch !== ctx.viewBranch.id ||
      result.head !== ctx.head ||
      result.kind !== kind ||
      result.section !== section ||
      result.query !== query
    )
      fail('The inspection window changed. Refresh this view.', 'CURSOR_STALE', 409);
    if (result.anchor !== undefined && (!ancestor(ctx.head, result.anchor) || !index(result.anchor)?.reader_visible))
      fail('Invalid history cursor.', 'CURSOR_INVALID');
    if (
      result.offset !== undefined &&
      (!Number.isSafeInteger(result.offset) || result.offset < 0 || result.offset > 1000000)
    )
      fail('Invalid record cursor.', 'CURSOR_INVALID');
    return result;
  }
  function next(ctx, kind, extras = {}, section = '', query = '') {
    return Buffer.from(
      JSON.stringify({
        v: 1,
        game: ctx.game.id,
        branch: ctx.viewBranch.id,
        head: ctx.head,
        kind,
        section,
        query,
        ...extras
      })
    ).toString('base64url');
  }
  function visibleBeat(game, at) {
    const value = row(game, at);
    const meta = index(at);
    if (!meta?.reader_visible) fail('No reader-visible record at this identity.', 'BEAT_NOT_FOUND', 404);
    const beat = store.publicBeat(value);
    return {
      ...beat,
      input: {
        ...(beat.input?.kind ? { kind: beat.input.kind } : {}),
        ...(beat.input?.character_id ? { character_id: beat.input.character_id } : {})
      }
    };
  }
  function workspace(id, query) {
    const ctx = context(id, query);
    const state = publicState(ctx.state);
    return {
      ...metadata(ctx),
      title: ctx.game.title,
      state: {
        cast: state.cast,
        control: state.control,
        episode: state.episode,
        library: state.library,
        play_style: state.play_style,
        pacing: state.pacing,
        consequences: state.consequences,
        fourth_wall: state.fourth_wall,
        quality_mode: state.quality_mode
      },
      branches: db
        .prepare(
          'SELECT id,name,parent_branch_id,fork_beat_id,head_beat_id FROM fiction_branches WHERE game_id=? ORDER BY rowid LIMIT 40'
        )
        .all(id),
      pending: Boolean(db.prepare("SELECT id FROM fiction_requests WHERE game_id=? AND status='pending'").get(id)),
      capabilities: {
        historical_inspection: true,
        read_only_paths: true,
        precise_evidence: true,
        private_drafts: true,
        save_version: 2
      }
    };
  }
  function timeline(id, query = {}) {
    const ctx = context(id, query);
    const parsed = cursor(query.cursor, ctx, 'timeline');
    const limit = query.limit === undefined ? 40 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) fail('Choose between 1 and 80 history records.');
    let at = parsed?.anchor || ctx.head;
    const entries = [];
    if (at && !index(at)?.reader_visible) at = index(at)?.previous_reader_id;
    while (at && entries.length < limit + 1) {
      const beat = visibleBeat(id, at);
      const meta = index(at);
      entries.push({
        id: beat.id,
        kind: beat.kind,
        summary: beat.summary,
        narrative_ordinal: meta.is_narrative ? meta.narrative_ordinal : null,
        excerpt: beat.prose.slice(0, 240),
        is_narrative: Boolean(meta.is_narrative),
        source_available: beat.changes.length > 0
      });
      at = meta.previous_reader_id;
    }
    const more = entries.length > limit ? entries.pop() : null;
    return { ...metadata(ctx), entries, next_cursor: more ? next(ctx, 'timeline', { anchor: more.id }) : null };
  }
  function codex(id, query = {}, planning = false) {
    const ctx = context(id, query);
    const section = choice(
      query.section,
      ['all', 'facts', 'people', 'commitments', 'relationships', 'goals', 'resources'],
      'all',
      'Codex section'
    );
    const search = text(query.q, 'Search', 200, { optional: true });
    const parsed = cursor(query.cursor, ctx, planning ? 'planning' : 'codex', section, search);
    const offset = parsed?.offset || 0;
    const kinds = {
      facts: 'fact',
      commitments: 'commitment',
      relationships: 'relationship',
      goals: 'goal',
      resources: 'resource'
    };
    let records;
    if (section === 'people')
      records = publicState(ctx.state)
        .cast.filter(
          (person) => !search || (person.name + ' ' + person.description).toLowerCase().includes(search.toLowerCase())
        )
        .slice(offset, offset + 41)
        .map((person) => ({ type: 'person', ...person }));
    else
      records = store.memory.facts(id, ctx.head, {
        query: search,
        kind: kinds[section] || null,
        publicOnly: !planning,
        limit: 41,
        offset
      });
    const more = records.length > 40;
    records = records.slice(0, 40);
    return {
      ...metadata(ctx),
      section,
      records,
      next_cursor: more ? next(ctx, planning ? 'planning' : 'codex', { offset: offset + 40 }, section, search) : null,
      foundations: planning ? ctx.state.library : publicState(ctx.state).library
    };
  }
  function evidence(id, beatId, query = {}, planning = false) {
    const ctx = context(id, query);
    identifier(beatId);
    if (!ancestor(ctx.head, beatId)) fail('Evidence is outside this inspection boundary.', 'BEAT_NOT_FOUND', 404);
    const original = row(id, beatId);
    const beat = planning ? store.publicBeat(original) : visibleBeat(id, beatId);
    if (planning) {
      beat.input = JSON.parse(original.input_json);
      beat.changes = JSON.parse(original.changes_json);
    }
    const records = store.evidenceRecords.rows(id, beatId, planning);
    // Public ordinal numbering never reveals skipped private changes.
    const changes = JSON.parse(original.changes_json);
    const allowed = changes
      .map((change, i) => ({ change, i }))
      .filter(({ change }) => planning || change.op === 'introduce' || change.fact?.visibility === 'public');
    const sources = allowed.map(({ change, i }, visibleIndex) => {
      const source = records.find((record) => record.change_index === i);
      return {
        change_index: visibleIndex,
        fact_id: change.fact?.id || null,
        precision: source
          ? source.source_kind
          : original.kind === 'correction'
            ? 'owner-declared; exact source private'
            : 'passage-level',
        ...(source
          ? {
              source_kind: source.source_kind,
              source_field: source.source_field,
              quote: source.quote,
              sha256: source.sha256
            }
          : {})
      };
    });
    return {
      ...metadata(ctx),
      beat,
      sources,
      precision: sources.some((source) => source.quote)
        ? 'exact stored source'
        : 'passage-level evidence; exact quote unavailable in this view'
    };
  }
  function passages(id, beatId, query = {}) {
    const ctx = context(id, query);
    identifier(beatId);
    if (!ancestor(ctx.head, beatId)) fail('Passage is outside this inspection boundary.', 'BEAT_NOT_FOUND', 404);
    const meta = index(beatId);
    if (!meta?.is_narrative)
      fail('Choose a narrative passage; inspect Ask or local records in history.', 'NOT_A_PASSAGE');
    const mode = choice(query.presentation_mode, ['current', 'historical'], 'current', 'Presentation mode');
    const presentation = query.presentation_head
      ? identifier(query.presentation_head)
      : mode === 'historical'
        ? ctx.head
        : ctx.viewBranch.head_beat_id;
    if (
      !ancestor(ctx.viewBranch.head_beat_id, presentation) ||
      !ancestor(presentation, beatId) ||
      (mode === 'historical' && presentation !== ctx.head)
    )
      fail('Invalid presentation boundary.', 'INSPECTION_BOUNDARY');
    const display = store.stateAt(ctx.game, presentation);
    const beat = visibleBeat(id, beatId);
    const candidates = db
      .prepare('SELECT beat_id FROM fiction_history_index WHERE game_id=? AND narrative_ordinal=? AND is_narrative=1')
      .all(id, meta.narrative_ordinal + 1);
    const after = candidates.find((candidate) => ancestor(ctx.head, candidate.beat_id));
    return {
      ...metadata(ctx),
      beat,
      narrative_ordinal: meta.narrative_ordinal,
      previous_id: meta.previous_narrative_id,
      next_id: after?.beat_id || null,
      presentation_mode: mode,
      presentation_head_id: presentation,
      illustration: display.illustrations?.find((image) => image.beat_id === beatId) || null
    };
  }
  function planning(id, query = {}) {
    const ctx = context(id, query);
    return {
      ...codex(id, query, true),
      exposure: 'private owner planning',
      cast: ctx.state.cast,
      configuration: { boundaries: ctx.state.boundaries, voice: ctx.state.voice, focus: ctx.state.focus },
      ...(query.evidence_at ? { evidence: evidence(id, query.evidence_at, query, true) } : {})
    };
  }
  return { context, ancestor, metadata, workspace, timeline, codex, evidence, passages, planning };
}
module.exports = { createWorkspaceQueries };
