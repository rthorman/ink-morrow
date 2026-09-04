'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { LIMITS, GENRES, fail, text, choice, keys, initialState, publicState, normalizeCast, normalizeFact } = require('./model');
const { scenarioInput } = require('./scenarios');
const { createMemory, compactFacts } = require('./memory');
const { STYLES } = require('./resistance');
const { FOURTH_WALL_MODES } = require('./fourth-wall');
const { makeEpisode, returnRecap } = require('./episodes');

function createFictionStore(db) {
  const memory = createMemory(db);
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const game = (id) => db.prepare('SELECT * FROM fiction_games WHERE id = ?').get(id) || fail('Story not found.', 'STORY_NOT_FOUND', 404);
  const branch = (gameId, id) => db.prepare('SELECT * FROM fiction_branches WHERE game_id = ? AND id = ?').get(gameId, id) || fail('Path not found.', 'PATH_NOT_FOUND', 404);
  const beat = (gameId, id) => db.prepare('SELECT * FROM fiction_beats WHERE game_id = ? AND id = ?').get(gameId, id) || fail('Story moment not found.', 'BEAT_NOT_FOUND', 404);
  const stateAt = (g, headId) => {
    const state = { play_style: 'story-shaping', challenges: [], adjudications: [], fourth_wall: 'never', last_fourth_wall_scene: null,
      ...JSON.parse(headId ? beat(g.id, headId).state_json : g.initial_state_json) };
    state.episode = { question: '', goal_ids: [], phase: 'opening', payoff_beat_id: null, ...state.episode };
    return state;
  };
  const current = (id) => {
    const g = game(id);
    const b = branch(id, g.active_branch_id);
    return { game: g, branch: b, state: stateAt(g, b.head_beat_id) };
  };
  const assertRevision = (g, expected) => {
    if (!Number.isSafeInteger(expected) || expected < 0) fail('The current story revision is required.');
    if (g.revision !== expected) fail('This story changed in another action. Refresh before continuing.', 'STORY_CHANGED', 409);
  };
  const assertIdle = (id) => {
    if (db.prepare("SELECT id FROM fiction_requests WHERE game_id = ? AND status = 'pending'").get(id)) fail('A story response is already in progress.', 'STORY_BUSY', 409);
  };
  const bump = (id) => db.prepare('UPDATE fiction_games SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  const publicBeat = (row) => row && ({
    id: row.id, parent_id: row.parent_id, branch_id: row.branch_id, kind: row.kind,
    prose: row.prose, summary: row.summary, input: row.kind === 'correction' ? {} : JSON.parse(row.input_json),
    changes: JSON.parse(row.changes_json).filter((change) => change.op === 'introduce' || change.fact?.visibility === 'public'), created_at: row.created_at,
  });
  const historyRows = (gameId, headId, limit = 60) => db.prepare(`
    WITH RECURSIVE path AS (
      SELECT *, 0 AS depth FROM fiction_beats WHERE id = ? AND game_id = ?
      UNION ALL SELECT b.*, path.depth + 1 FROM fiction_beats b JOIN path ON b.id = path.parent_id
      WHERE b.game_id = ? AND path.depth < ?
    ) SELECT * FROM path ORDER BY depth DESC
  `).all(headId, gameId, gameId, limit - 1);
  function view(id, { before = null, limit = 60 } = {}) {
    const { game: g, branch: b, state } = current(id);
    const bounded = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 60));
    let headId = b.head_beat_id;
    if (before) {
      if (!isAncestor(id, headId, before)) fail('That moment is not on the active path.');
      headId = beat(id, before).parent_id;
    }
    const rows = headId ? historyRows(id, headId, bounded) : [];
    return {
      id: g.id, title: g.title, premise: g.premise, genre: g.genre, revision: g.revision,
      active_branch_id: b.id, head_beat_id: b.head_beat_id, state: publicState(state),
      branches: db.prepare('SELECT id, name, head_beat_id, fork_beat_id, parent_branch_id FROM fiction_branches WHERE game_id = ? ORDER BY created_at, rowid').all(id),
      beats: rows.map(publicBeat), has_earlier: Boolean(rows[0]?.parent_id),
      pending: Boolean(db.prepare("SELECT id FROM fiction_requests WHERE game_id = ? AND status = 'pending'").get(id)),
      spend: db.prepare(`SELECT coalesce(sum(cost_usd), 0) AS known_usd,
        coalesce(sum(CASE WHEN cost_usd IS NULL THEN billed_attempts ELSE 0 END), 0) AS unknown_attempts
        FROM fiction_requests WHERE game_id = ?`).get(id),
      created_at: g.created_at, updated_at: g.updated_at,
    };
  }
  function isAncestor(gameId, headId, targetId) {
    if (targetId === null) return true;
    return Boolean(db.prepare(`WITH RECURSIVE path(id, parent_id) AS (
      SELECT id, parent_id FROM fiction_beats WHERE id = ? AND game_id = ?
      UNION ALL SELECT b.id, b.parent_id FROM fiction_beats b JOIN path ON b.id = path.parent_id WHERE b.game_id = ?
    ) SELECT id FROM path WHERE id = ? LIMIT 1`).get(headId, gameId, gameId, targetId));
  }
  function publicationRows(gameId, headId) {
    const cte = `WITH RECURSIVE path(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM fiction_beats WHERE id = ? AND game_id = ?
      UNION ALL SELECT b.id, b.parent_id, path.depth + 1 FROM fiction_beats b JOIN path ON b.id = path.parent_id
      WHERE b.game_id = ? AND path.depth < 100000
    )`;
    const args = [headId, gameId, gameId];
    const size = db.prepare(`${cte} SELECT count(*) AS n, coalesce(sum(length(CAST(b.prose AS BLOB))), 0) AS bytes
      FROM path JOIN fiction_beats b ON b.id = path.id`).get(...args);
    if (size.n > 100000 || size.bytes > 64 * 1024 * 1024) fail('This path exceeds the book export limit.', 'BOOK_TOO_LARGE', 413);
    return db.prepare(`${cte} SELECT b.id, b.kind, b.prose,
      json_extract(b.state_json, '$.episode.number') AS episode_number,
      json_extract(b.state_json, '$.episode.title') AS episode_title
      FROM path JOIN fiction_beats b ON b.id = path.id WHERE b.kind IN ('opening', 'scene') ORDER BY path.depth DESC`).all(...args);
  }
  function append({ game: g, branch: b }, { id = randomUUID(), kind, prose = '', summary, input = {}, state, changes = [] }) {
    db.prepare(`INSERT INTO fiction_beats (id, game_id, branch_id, parent_id, kind, prose, summary, input_json, state_json, changes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, g.id, b.id, b.head_beat_id, kind, prose, summary, JSON.stringify(input), JSON.stringify(state), JSON.stringify(changes));
    db.prepare('UPDATE fiction_branches SET head_beat_id = ? WHERE id = ?').run(id, b.id);
    bump(g.id);
    return id;
  }
  function create(input) {
    keys(input, ['title', 'premise', 'genre', 'cast', 'facts', 'opening', 'pacing', 'consequences', 'boundaries', 'voice', 'scenario_id', 'play_style', 'challenges', 'fourth_wall', 'episode_question'], 'New story');
    input = scenarioInput(input);
    const title = text(input.title, 'Title', 200);
    const premise = text(input.premise, 'Premise', 4000);
    const genre = choice(input.genre, GENRES, 'drama', 'Genre');
    const opening = text(input.opening, 'Opening', LIMITS.prose, { optional: true });
    const state = initialState(input);
    const id = randomUUID(); const branchId = randomUUID();
    transaction(() => {
      db.prepare('INSERT INTO fiction_games (id, title, premise, genre, initial_state_json) VALUES (?, ?, ?, ?, ?)').run(id, title, premise, genre, JSON.stringify(state));
      db.prepare('INSERT INTO fiction_branches (id, game_id, name) VALUES (?, ?, ?)').run(branchId, id, 'Original path');
      db.prepare('UPDATE fiction_games SET active_branch_id = ? WHERE id = ?').run(branchId, id);
      if (opening) append(current(id), { kind: 'opening', prose: opening, summary: 'The story begins.', state });
    });
    return view(id);
  }
  function mutate(id, expected, fn) {
    transaction(() => { const context = current(id); assertRevision(context.game, expected); assertIdle(id); fn(context); });
    return view(id);
  }
  function fork(id, expected, input) {
    keys(input, ['name', 'beat_id'], 'Alternate path');
    const name = text(input.name, 'Path name', 120);
    if (input.beat_id !== null && typeof input.beat_id !== 'string') fail('Select a story moment or the beginning.');
    return mutate(id, expected, ({ game: g, branch: b }) => {
      if (!isAncestor(id, b.head_beat_id, input.beat_id)) fail('Choose a moment on the current path.');
      const count = db.prepare('SELECT count(*) AS n FROM fiction_branches WHERE game_id = ?').get(id).n;
      if (count >= LIMITS.branches) fail(`A story supports at most ${LIMITS.branches} paths.`);
      const branchId = randomUUID();
      db.prepare('INSERT INTO fiction_branches (id, game_id, name, parent_branch_id, fork_beat_id, head_beat_id) VALUES (?, ?, ?, ?, ?, ?)').run(branchId, id, name, b.id, input.beat_id, input.beat_id);
      db.prepare('UPDATE fiction_games SET active_branch_id = ? WHERE id = ?').run(branchId, g.id);
      bump(id);
    });
  }
  function selectBranch(id, expected, branchId) {
    return mutate(id, expected, () => { branch(id, branchId); db.prepare('UPDATE fiction_games SET active_branch_id = ? WHERE id = ?').run(branchId, id); bump(id); });
  }
  function control(id, expected, characterId) {
    return mutate(id, expected, (context) => {
      const character = context.state.cast.find((entry) => entry.id === characterId);
      if (characterId !== null && !character) fail('Choose a member of this cast or release control.');
      const state = structuredClone(context.state);
      state.control.character_id = characterId;
      append(context, { kind: 'control', summary: character ? `You now control ${character.name}.` : 'The narrator now controls the cast. You remain the reader-director.', input: { character_id: characterId }, state });
    });
  }
  function correct(id, expected, input) {
    keys(input, ['fact', 'reason', 'remove_id'], 'Correction');
    const reason = text(input.reason, 'Correction reason', 1500);
    if (Boolean(input.fact) === Boolean(input.remove_id)) fail('Correct one fact or remove one fact.');
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state); const beatId = randomUUID();
      let fact; let priorEvidence = null;
      if (input.remove_id) {
        fact = state.facts.find((entry) => entry.id === input.remove_id) || memory.get(id, context.branch.head_beat_id, input.remove_id);
        if (!fact) fail('Fact not found.', 'FACT_NOT_FOUND', 404);
        priorEvidence = fact.evidence_beat_id;
        state.facts = state.facts.filter((entry) => entry.id !== input.remove_id);
      } else {
        fact = normalizeFact(input.fact, state.cast.map((entry) => entry.id), { evidenceBeatId: beatId });
        priorEvidence = memory.get(id, context.branch.head_beat_id, fact.id)?.evidence_beat_id || null;
        const index = state.facts.findIndex((entry) => entry.id === fact.id);
        if (index < 0) state.facts.push(fact); else state.facts[index] = fact;
        compactFacts(state, LIMITS.facts);
      }
      // The reason may itself contain a secret. Keep it out of the reader view.
      append(context, { id: beatId, kind: 'correction', summary: 'A story fact was corrected.', input: { reason }, state, changes: [{ op: input.remove_id ? 'remove' : 'correct', fact, prior_evidence_beat_id: priorEvidence }] });
    });
  }
  function episode(id, expected, input) {
    keys(input, ['action', 'title', 'summary', 'question'], 'Episode');
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      if (input.action === 'end') {
        if (state.episode.status === 'ended') fail('This episode has already ended.');
        state.episode.status = 'ended';
        state.episode.summary = text(input.summary, 'Episode summary', 2000, { optional: true });
      } else if (input.action === 'start') {
        if (state.episode.status !== 'ended') fail('Finish the current episode first.');
        state.episode = makeEpisode({ number: state.episode.number + 1, title: text(input.title, 'Episode title', 200), question: text(input.question, 'Episode question', 500, { optional: true }) },
          memory.facts(id, context.branch.head_beat_id, { kind: 'goal', status: 'active', publicOnly: true, limit: 6 }));
      } else fail('Choose start or end.');
      append(context, { kind: 'episode', summary: input.action === 'end' ? 'The episode ends. You can stop here.' : `Episode ${state.episode.number}: ${state.episode.title}`, state });
    });
  }
  function preferences(id, expected, input) {
    keys(input, ['pacing', 'consequences', 'boundaries', 'voice', 'focus', 'play_style', 'fourth_wall'], 'Story preferences');
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      state.pacing = choice(input.pacing, ['reflective', 'balanced', 'brisk'], state.pacing, 'Pacing');
      state.consequences = choice(input.consequences, ['gentle', 'dramatic'], state.consequences, 'Consequences');
      state.play_style = choice(input.play_style, STYLES, state.play_style || 'story-shaping', 'Play style');
      state.fourth_wall = choice(input.fourth_wall, FOURTH_WALL_MODES, state.fourth_wall || 'never', 'Fourth-wall setting');
      for (const [key, max] of [['boundaries', 2000], ['voice', 1500], ['focus', 1500]]) if (input[key] !== undefined) state[key] = text(input[key], key, max, { optional: true });
      append(context, { kind: 'correction', summary: 'Story preferences were updated.', state });
    });
  }
  function addCast(id, expected, input) {
    const [character] = normalizeCast([input]);
    return mutate(id, expected, (context) => {
      if (context.state.cast.length >= LIMITS.cast || context.state.cast.some((entry) => entry.id === character.id || entry.name.toLowerCase() === character.name.toLowerCase())) fail('Choose a new cast member within the 24-person limit.');
      const state = structuredClone(context.state); state.cast.push(character);
      append(context, { kind: 'correction', summary: `${character.name} was added to the cast.`, state });
    });
  }
  function beginRequest(id, expected, idempotencyKey, payload) {
    const key = text(idempotencyKey, 'Idempotency key', 200);
    const fingerprint = createHash('sha256').update(JSON.stringify({ expected, payload })).digest('hex');
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM fiction_requests WHERE game_id = ? AND idempotency_key = ?').get(id, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('This request key belongs to a different action.', 'IDEMPOTENCY_CONFLICT', 409);
        if (previous.status === 'pending') fail('This response is still in progress.', 'STORY_BUSY', 409);
        if (previous.status !== 'succeeded') fail('That request did not complete. A new explicit action is required.', previous.error_code || 'STORY_REQUEST_FAILED', 409);
        return { request: previous, reused: true };
      }
      const context = current(id); assertRevision(context.game, expected); assertIdle(id);
      if (context.state.episode.status !== 'active' && payload.operation !== 'image') fail('This episode has ended. Begin the next episode when ready.', 'EPISODE_ENDED', 409);
      const requestId = randomUUID();
      db.prepare(`INSERT INTO fiction_requests (id, game_id, branch_id, idempotency_key, fingerprint, expected_revision, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`).run(requestId, id, context.branch.id, key, fingerprint, expected);
      return { request: db.prepare('SELECT * FROM fiction_requests WHERE id = ?').get(requestId), context, reused: false };
    });
  }
  function completeRequest(request, result, usage = {}) {
    return transaction(() => {
      const pending = db.prepare("SELECT * FROM fiction_requests WHERE id = ? AND status = 'pending'").get(request.id);
      if (!pending) fail('This response is no longer active.', 'STORY_REQUEST_STALE', 409);
      const context = current(request.game_id); assertRevision(context.game, request.expected_revision);
      if (context.branch.id !== request.branch_id) fail('The active path changed.', 'STORY_CHANGED', 409);
      const beatId = append(context, typeof result === 'function' ? result(context) : result);
      db.prepare("UPDATE fiction_requests SET status = 'succeeded', beat_id = ?, model = ?, cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(beatId, usage.model ?? null, usage.costUsd ?? null, usage.billedAttempts ?? 0, request.id);
      return beatId;
    });
  }
  function dispatchRequest(requestId, model) {
    const result = db.prepare("UPDATE fiction_requests SET billed_attempts = 1, model = ? WHERE id = ? AND status = 'pending'").run(model || null, requestId);
    if (!result.changes) fail('This response is no longer active.', 'STORY_REQUEST_STALE', 409);
  }
  function illustrationTarget(id, beatId) {
    const context = current(id);
    if (!isAncestor(id, context.branch.head_beat_id, beatId)) fail('Choose a moment on the current path.');
    const target = beat(id, beatId);
    if (!['opening', 'scene'].includes(target.kind)) fail('Illustrate a story passage, not a control or clarification.');
    if ((context.state.illustrations || []).filter((entry) => entry.beat_id !== beatId).length >= 200) fail('A path supports at most 200 illustrated moments.');
    if (db.prepare('SELECT count(*) AS n FROM fiction_assets WHERE game_id = ?').get(id).n >= 400) fail('This story has reached its 400-image save limit.');
    return target;
  }
  function illustrate(id, expected, { asset, beat_id, alt_text, caption = '' }, request = null, usage = {}) {
    const alt = text(alt_text, 'Image description', 1000);
    const label = text(caption, 'Caption', 500, { optional: true });
    const result = (context) => {
      illustrationTarget(id, beat_id);
      const state = structuredClone(context.state);
      const placements = (state.illustrations || []).filter((entry) => entry.beat_id !== beat_id);
      if (placements.length >= 200) fail('A path supports at most 200 illustrated moments.');
      if (db.prepare('SELECT count(*) AS n FROM fiction_assets WHERE game_id = ?').get(id).n >= 400) fail('This story has reached its 400-image save limit.');
      db.prepare('INSERT INTO fiction_assets (id, game_id, media_type, sha256, byte_size, width, height, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(asset.id, id, asset.media_type, asset.sha256, asset.byte_size, asset.width, asset.height, asset.storage_key);
      state.illustrations = [...placements, { beat_id, asset_id: asset.id, alt_text: alt, caption: label }];
      return { kind: 'correction', summary: 'An illustration was added above a story passage.', state };
    };
    if (request) { completeRequest(request, result, usage); return view(id); }
    return mutate(id, expected, (context) => append(context, result(context)));
  }
  function removeIllustration(id, expected, beatId) {
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      state.illustrations = (state.illustrations || []).filter((entry) => entry.beat_id !== beatId);
      append(context, { kind: 'correction', summary: 'An illustration was removed from this path. Earlier snapshots retain it.', state });
    });
  }
  function describeIllustration(id, expected, input) {
    const alt = text(input.alt_text, 'Image description', 1000);
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      const placed = state.illustrations.find((entry) => entry.beat_id === input.beat_id);
      if (!placed) fail('This moment has no illustration.', 'IMAGE_NOT_FOUND', 404);
      placed.alt_text = alt;
      append(context, { kind: 'correction', summary: 'An illustration description was corrected.', state });
    });
  }
  function failRequest(requestId, code, usage = {}) {
    db.prepare("UPDATE fiction_requests SET status = 'failed', error_code = ?, model = ?, cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .run(code, usage.model ?? null, usage.costUsd ?? null, usage.billedAttempts ?? 0, requestId);
  }
  function reconcile() {
    return db.prepare("UPDATE fiction_requests SET status = 'interrupted', error_code = 'STORY_INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'pending'").run().changes;
  }
  const list = (offset = 0) => db.prepare('SELECT id, title, premise, genre, revision, updated_at FROM fiction_games ORDER BY updated_at DESC, rowid DESC LIMIT 81 OFFSET ?').all(offset);
  function recall(id, query) {
    const context = current(id);
    return memory.facts(id, context.branch.head_beat_id, { query: text(query, 'Memory search', 200, { optional: true }), publicOnly: true });
  }
  function evidence(id, beatId) {
    const context = current(id);
    if (!isAncestor(id, context.branch.head_beat_id, beatId)) fail('That evidence is not on this path.', 'BEAT_NOT_FOUND', 404);
    return publicBeat(beat(id, beatId));
  }
  function recap(id) {
    const context = current(id); const head = context.branch.head_beat_id;
    const recent = db.prepare(`WITH RECURSIVE path AS (
      SELECT id, parent_id, kind, summary, 0 AS depth FROM fiction_beats WHERE game_id = ? AND id = ?
      UNION ALL SELECT b.id, b.parent_id, b.kind, b.summary, path.depth + 1 FROM fiction_beats b JOIN path ON b.id = path.parent_id WHERE b.game_id = ?
    ) SELECT id, kind, summary FROM path WHERE kind IN ('opening', 'scene') ORDER BY depth LIMIT 3`).all(id, head, id).reverse();
    return { ...returnRecap(context.state, recent, memory.facts(id, head, { publicOnly: true, kind: 'commitment', status: 'active', limit: 6 })),
      relationships: memory.facts(id, head, { publicOnly: true, kind: 'relationship', status: 'active', limit: 12 }) };
  }
  const requestResult = (request) => ({ beat: publicBeat(beat(request.game_id, request.beat_id)), cost_usd: request.cost_usd, billed_attempts: request.billed_attempts, model: request.model });
  return { create, list, recall, evidence, recap, view, current, stateAt, memory, historyRows, publicationRows, fork, selectBranch, control, correct, episode, preferences, addCast, beginRequest, dispatchRequest, completeRequest, failRequest, reconcile, requestResult, publicBeat, illustrate, illustrationTarget, removeIllustration, describeIllustration };
}

module.exports = { createFictionStore };
