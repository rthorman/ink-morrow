'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { LIMITS, GENRES, fail, text, choice, keys, initialState, publicState, normalizeCast, normalizeFact } = require('./model');
const { scenarioInput } = require('./scenarios');

function createFictionStore(db) {
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const game = (id) => db.prepare('SELECT * FROM fiction_games WHERE id = ?').get(id) || fail('Story not found.', 'STORY_NOT_FOUND', 404);
  const branch = (gameId, id) => db.prepare('SELECT * FROM fiction_branches WHERE game_id = ? AND id = ?').get(gameId, id) || fail('Path not found.', 'PATH_NOT_FOUND', 404);
  const beat = (gameId, id) => db.prepare('SELECT * FROM fiction_beats WHERE game_id = ? AND id = ?').get(gameId, id) || fail('Story moment not found.', 'BEAT_NOT_FOUND', 404);
  const stateAt = (g, headId) => JSON.parse(headId ? beat(g.id, headId).state_json : g.initial_state_json);
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
  function append({ game: g, branch: b }, { id = randomUUID(), kind, prose = '', summary, input = {}, state, changes = [] }) {
    db.prepare(`INSERT INTO fiction_beats (id, game_id, branch_id, parent_id, kind, prose, summary, input_json, state_json, changes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, g.id, b.id, b.head_beat_id, kind, prose, summary, JSON.stringify(input), JSON.stringify(state), JSON.stringify(changes));
    db.prepare('UPDATE fiction_branches SET head_beat_id = ? WHERE id = ?').run(id, b.id);
    bump(g.id);
    return id;
  }
  function create(input) {
    keys(input, ['title', 'premise', 'genre', 'cast', 'facts', 'opening', 'pacing', 'consequences', 'boundaries', 'voice', 'scenario_id'], 'New story');
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
      let fact;
      if (input.remove_id) {
        fact = state.facts.find((entry) => entry.id === input.remove_id);
        if (!fact) fail('Fact not found.', 'FACT_NOT_FOUND', 404);
        state.facts = state.facts.filter((entry) => entry.id !== input.remove_id);
      } else {
        fact = normalizeFact(input.fact, state.cast.map((entry) => entry.id), { evidenceBeatId: beatId });
        const index = state.facts.findIndex((entry) => entry.id === fact.id);
        if (index < 0) state.facts.push(fact); else state.facts[index] = fact;
        if (state.facts.length > LIMITS.facts) fail('The story fact limit has been reached.');
      }
      // The reason may itself contain a secret. Keep it out of the reader view.
      append(context, { id: beatId, kind: 'correction', summary: 'A story fact was corrected.', input: { reason }, state, changes: [{ op: input.remove_id ? 'remove' : 'correct', fact }] });
    });
  }
  function episode(id, expected, input) {
    keys(input, ['action', 'title', 'summary'], 'Episode');
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      if (input.action === 'end') {
        if (state.episode.status === 'ended') fail('This episode has already ended.');
        state.episode.status = 'ended';
        state.episode.summary = text(input.summary, 'Episode summary', 2000, { optional: true });
      } else if (input.action === 'start') {
        if (state.episode.status !== 'ended') fail('Finish the current episode first.');
        state.episode = { number: state.episode.number + 1, title: text(input.title, 'Episode title', 200), status: 'active', summary: '' };
      } else fail('Choose start or end.');
      append(context, { kind: 'episode', summary: input.action === 'end' ? 'The episode ends. You can stop here.' : `Episode ${state.episode.number}: ${state.episode.title}`, state });
    });
  }
  function preferences(id, expected, input) {
    keys(input, ['pacing', 'consequences', 'boundaries', 'voice', 'focus'], 'Story preferences');
    return mutate(id, expected, (context) => {
      const state = structuredClone(context.state);
      state.pacing = choice(input.pacing, ['reflective', 'balanced', 'brisk'], state.pacing, 'Pacing');
      state.consequences = choice(input.consequences, ['gentle', 'dramatic'], state.consequences, 'Consequences');
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
      if (context.state.episode.status !== 'active') fail('This episode has ended. Begin the next episode when ready.', 'EPISODE_ENDED', 409);
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
      const beatId = append(context, result);
      db.prepare("UPDATE fiction_requests SET status = 'succeeded', beat_id = ?, model = ?, cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(beatId, usage.model ?? null, usage.costUsd ?? null, usage.billedAttempts ?? 0, request.id);
      return beatId;
    });
  }
  function dispatchRequest(requestId, model) {
    const result = db.prepare("UPDATE fiction_requests SET billed_attempts = 1, model = ? WHERE id = ? AND status = 'pending'").run(model || null, requestId);
    if (!result.changes) fail('This response is no longer active.', 'STORY_REQUEST_STALE', 409);
  }
  function failRequest(requestId, code, usage = {}) {
    db.prepare("UPDATE fiction_requests SET status = 'failed', error_code = ?, model = ?, cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .run(code, usage.model ?? null, usage.costUsd ?? null, usage.billedAttempts ?? 0, requestId);
  }
  function reconcile() {
    return db.prepare("UPDATE fiction_requests SET status = 'interrupted', error_code = 'STORY_INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'pending'").run().changes;
  }
  const list = () => db.prepare('SELECT id, title, premise, genre, revision, updated_at FROM fiction_games ORDER BY updated_at DESC, rowid DESC LIMIT 200').all();
  const requestResult = (request) => ({ beat: publicBeat(beat(request.game_id, request.beat_id)), cost_usd: request.cost_usd, billed_attempts: request.billed_attempts, model: request.model });
  return { create, list, view, current, stateAt, historyRows, fork, selectBranch, control, correct, episode, preferences, addCast, beginRequest, dispatchRequest, completeRequest, failRequest, reconcile, requestResult, publicBeat };
}

module.exports = { createFictionStore };
