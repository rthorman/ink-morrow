'use strict';

// Session Zero contracts and turns are optional working history attached to a
// scene. They never write manuscript pages or continuity rows.

const { createHash, randomUUID } = require('node:crypto');
const { optionalText, asString } = require('../../core/validation');

const CONTROLLERS = Object.freeze(['owner', 'scribe', 'shared']);
const TURN_KINDS = Object.freeze(['act', 'say', 'ask', 'direct']);
const CONTRACT_ENUMS = Object.freeze({
  scribe_initiative: ['low', 'balanced', 'high'],
  challenge: ['gentle', 'balanced', 'harsh'],
  pacing: ['reflective', 'balanced', 'brisk'],
  consequences: ['guarded', 'meaningful', 'severe'],
  suggestions: ['off', 'on_request', 'proactive'],
  player_interiority: ['owner_only', 'sensory_only', 'shared'],
});

function problem(message, statusCode = 409, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function stableHash(value) {
  const ordered = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function createPlayStore(db, { stories }) {
  const inImmediate = (operation) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  function rawSession(storyId, sessionId) {
    return db.prepare(`
      SELECT session.*, scene.title AS scene_title, scene.mode AS scene_mode,
             scene.viewpoint_character_id, scene.location, scene.story_time,
             scene.purpose, scene.stakes, volume.story_id
        FROM play_sessions session
        JOIN scenes scene ON scene.id = session.scene_id
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE session.id = ? AND volume.story_id = ?
    `).get(sessionId, storyId) || null;
  }

  function publicSession(row, { turns = false } = {}) {
    if (!row) return null;
    const value = {
      id: row.id,
      scene_id: row.scene_id,
      ordinal: row.ordinal,
      status: row.status,
      participants: parseJson(row.participants_json, []),
      scribe_initiative: row.scribe_initiative,
      challenge: row.challenge,
      pacing: row.pacing,
      consequences: row.consequences,
      allow_character_death: Boolean(row.allow_character_death),
      suggestions: row.suggestions,
      player_interiority: row.player_interiority,
      notes: row.notes,
      scene: {
        id: row.scene_id,
        title: row.scene_title,
        mode: row.scene_mode,
        viewpoint_character_id: row.viewpoint_character_id,
        location: row.location,
        story_time: row.story_time,
        purpose: row.purpose,
        stakes: row.stakes,
      },
      turn_count: Number(row.turn_count) || 0,
      total_cost_usd: Number(row.total_cost_usd) || 0,
      cost_known: row.unknown_costs ? false : true,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ended_at: row.ended_at,
      selected_branch_id: row.selected_branch_id || null,
    };
    value.branches = listBranches(row.id);
    if (turns) value.turns = listTurns(row.id, row.selected_branch_id);
    return value;
  }

  function contractSnapshot(session) {
    return {
      participants: session.participants,
      scribe_initiative: session.scribe_initiative,
      challenge: session.challenge,
      pacing: session.pacing,
      consequences: session.consequences,
      allow_character_death: session.allow_character_death,
      suggestions: session.suggestions,
      player_interiority: session.player_interiority,
      notes: session.notes,
    };
  }

  const sessionProjection = `
    SELECT session.*, scene.title AS scene_title, scene.mode AS scene_mode,
           scene.viewpoint_character_id, scene.location, scene.story_time,
           scene.purpose, scene.stakes, volume.story_id,
           (SELECT COUNT(*) FROM play_turns turn WHERE turn.session_id = session.id) AS turn_count,
           (SELECT COALESCE(SUM(request.spend_usd), 0) FROM play_ai_requests request
             WHERE request.session_id = session.id) AS total_cost_usd,
           (SELECT COUNT(*) FROM play_ai_requests request
             WHERE request.session_id = session.id AND request.cost_known = 0) AS unknown_costs
      FROM play_sessions session
      JOIN scenes scene ON scene.id = session.scene_id
      JOIN chapters chapter ON chapter.id = scene.chapter_id
      JOIN volumes volume ON volume.id = chapter.volume_id
  `;

  function get(storyId, sessionId, options = {}) {
    const row = db.prepare(`${sessionProjection} WHERE session.id = ? AND volume.story_id = ?`)
      .get(sessionId, storyId);
    return publicSession(row, options);
  }

  function listForScene(storyId, sceneId) {
    return db.prepare(`${sessionProjection}
      WHERE scene.id = ? AND volume.story_id = ?
      ORDER BY session.ordinal DESC
    `).all(sceneId, storyId).map(publicSession);
  }

  function listBranches(sessionId) {
    return db.prepare(`SELECT branch.*,
      (SELECT COUNT(*) FROM play_turns turn WHERE turn.branch_id = branch.id) AS own_turn_count,
      (SELECT MAX(ordinal) FROM play_turns turn WHERE turn.branch_id = branch.id) AS tip_ordinal
      FROM play_branches branch WHERE branch.session_id = ? ORDER BY branch.ordinal`).all(sessionId);
  }

  function selectedBranch(sessionId, branchId = null) {
    if (branchId) return db.prepare('SELECT * FROM play_branches WHERE id = ? AND session_id = ?').get(branchId, sessionId) || null;
    return db.prepare(`SELECT branch.* FROM play_sessions session JOIN play_branches branch
      ON branch.id = session.selected_branch_id WHERE session.id = ?`).get(sessionId) ||
      db.prepare('SELECT * FROM play_branches WHERE session_id = ? ORDER BY ordinal LIMIT 1').get(sessionId) || null;
  }

  function listTurns(sessionId, branchId = null) {
    let branch = selectedBranch(sessionId, branchId);
    if (!branch) return [];
    const chain = [];
    while (branch) {
      chain.unshift(branch);
      branch = branch.parent_branch_id
        ? db.prepare('SELECT * FROM play_branches WHERE id = ? AND session_id = ?').get(branch.parent_branch_id, sessionId)
        : null;
      if (chain.length > 100) throw problem('Play branch ancestry is too deep.', 409, 'PLAY_BRANCH_DEPTH');
    }
    const rows = [];
    for (let index = 0; index < chain.length; index++) {
      const current = chain[index];
      const cutoff = chain[index + 1]?.fork_turn_id
        ? db.prepare('SELECT ordinal FROM play_turns WHERE id = ? AND session_id = ?').get(chain[index + 1].fork_turn_id, sessionId)?.ordinal
        : null;
      rows.push(...db.prepare(`
      SELECT id, session_id, ordinal, speaker, input_kind, character_id,
             content, source, model, prompt_tokens, completion_tokens,
             cost_usd, cost_known, billed_attempts, created_at, branch_id
        FROM play_turns WHERE session_id = ? AND branch_id = ?
          AND (? IS NULL OR ordinal <= ?) ORDER BY ordinal
      `).all(sessionId, current.id, cutoff, cutoff));
    }
    return rows.map((turn) => ({ ...turn, cost_known: Boolean(turn.cost_known) }));
  }

  function validateContract(body, storyId, existing = null) {
    const story = stories.getStory(storyId);
    if (!story) return { error: 'Story not found' };
    const cast = parseJson(story.characters || '[]', []);
    const castById = new Map(cast.map((member) => [member.id, member]));
    let participants;
    if (body.participants === undefined && existing) {
      participants = existing.participants;
    } else if (!Array.isArray(body.participants)) {
      return { error: '"participants" must list every current cast member and who controls them' };
    } else {
      const seen = new Set();
      participants = [];
      for (const item of body.participants) {
        const id = asString(item?.character_id);
        const controller = asString(item?.controller);
        if (!id || !castById.has(id) || seen.has(id) || !CONTROLLERS.includes(controller)) {
          return { error: 'Every participant must be a unique cast member controlled by owner, scribe, or shared' };
        }
        const snapshot = db.prepare(`
          SELECT name FROM story_character_snapshots WHERE story_id = ? AND character_id = ?
        `).get(storyId, id);
        participants.push({
          character_id: id,
          name: snapshot?.name || 'Unnamed cast member',
          role: castById.get(id).role || 'supporting',
          controller,
        });
        seen.add(id);
      }
      if (seen.size !== castById.size) {
        return { error: 'Session Zero must assign control for every current cast member' };
      }
      if (participants.length && !participants.some((item) => ['owner', 'shared'].includes(item.controller))) {
        return { error: 'At least one cast participant must remain under owner or shared control' };
      }
    }

    const contract = { participants };
    for (const [field, allowed] of Object.entries(CONTRACT_ENUMS)) {
      const value = body[field] === undefined ? existing?.[field] : asString(body[field]);
      contract[field] = value || {
        scribe_initiative: 'balanced', challenge: 'balanced', pacing: 'balanced',
        consequences: 'meaningful', suggestions: 'on_request', player_interiority: 'owner_only',
      }[field];
      if (!allowed.includes(contract[field])) return { error: `"${field}" must be one of: ${allowed.join(', ')}` };
    }
    if (body.allow_character_death !== undefined && typeof body.allow_character_death !== 'boolean') {
      return { error: '"allow_character_death" must be true or false' };
    }
    contract.allow_character_death = body.allow_character_death === undefined
      ? Boolean(existing?.allow_character_death)
      : body.allow_character_death;
    const notes = body.notes === undefined ? existing?.notes || null : optionalText(body.notes, { max: 4000 });
    if (notes === undefined) return { error: '"notes" must be text of at most 4000 characters' };
    contract.notes = notes;
    return contract;
  }

  function create(storyId, sceneId, contract) {
    if (!stories.scenes.get(storyId, sceneId)) return null;
    const id = randomUUID();
    inImmediate(() => {
      if (db.prepare("SELECT id FROM play_sessions WHERE scene_id = ? AND status = 'active'").get(sceneId)) {
        throw problem('This scene already has an active play session.', 409, 'PLAY_SESSION_ACTIVE');
      }
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM play_sessions WHERE scene_id = ?')
        .get(sceneId).n;
      db.prepare(`
        INSERT INTO play_sessions
          (id, scene_id, ordinal, participants_json, scribe_initiative, challenge,
           pacing, consequences, allow_character_death, suggestions,
           player_interiority, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, sceneId, ordinal, JSON.stringify(contract.participants), contract.scribe_initiative,
        contract.challenge, contract.pacing, contract.consequences,
        contract.allow_character_death ? 1 : 0, contract.suggestions,
        contract.player_interiority, contract.notes);
      const branchId = `${id}-main`;
      db.prepare("INSERT INTO play_branches (id, session_id, ordinal, name) VALUES (?, ?, 1, 'Main path')").run(branchId, id);
      db.prepare('UPDATE play_sessions SET selected_branch_id = ? WHERE id = ?').run(branchId, id);
    });
    return get(storyId, id, { turns: true });
  }

  function updateContract(storyId, sessionId, contract) {
    const session = get(storyId, sessionId);
    if (!session) return null;
    if (session.status !== 'active') throw problem('An ended session is read-only.', 409, 'PLAY_SESSION_ENDED');
    if (db.prepare("SELECT 1 FROM play_ai_requests WHERE session_id = ? AND status = 'in_flight'").get(sessionId)) {
      throw problem('Wait for the Scribe reply before changing Session Zero.', 409, 'PLAY_REPLY_IN_FLIGHT');
    }
    db.prepare(`
      UPDATE play_sessions SET participants_json = ?, scribe_initiative = ?, challenge = ?,
        pacing = ?, consequences = ?, allow_character_death = ?, suggestions = ?,
        player_interiority = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(contract.participants), contract.scribe_initiative, contract.challenge,
      contract.pacing, contract.consequences, contract.allow_character_death ? 1 : 0,
      contract.suggestions, contract.player_interiority, contract.notes, sessionId);
    return get(storyId, sessionId, { turns: true });
  }

  function end(storyId, sessionId) {
    const session = get(storyId, sessionId);
    if (!session) return null;
    if (db.prepare("SELECT 1 FROM play_ai_requests WHERE session_id = ? AND status = 'in_flight'").get(sessionId)) {
      throw problem('Wait for the Scribe reply before ending this session.', 409, 'PLAY_REPLY_IN_FLIGHT');
    }
    db.prepare(`
      UPDATE play_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'
    `).run(sessionId);
    return get(storyId, sessionId, { turns: true });
  }

  function validateTurn(body, session) {
    const kind = asString(body.kind);
    const content = optionalText(body.content, { max: 20000 });
    const characterId = optionalText(body.character_id, { max: 200 });
    if (!TURN_KINDS.includes(kind)) return { error: `"kind" must be one of: ${TURN_KINDS.join(', ')}` };
    if (!content) return { error: '"content" must be non-empty text of at most 20000 characters' };
    if (characterId === undefined) return { error: '"character_id" must be a character identifier or null' };
    if (characterId) {
      const participant = session.participants.find((item) => item.character_id === characterId);
      if (!participant || !['owner', 'shared'].includes(participant.controller)) {
        return { error: 'Owner turns may only use owner-controlled or shared participants' };
      }
    }
    return { kind, content, character_id: characterId };
  }

  function nextOrdinal(sessionId) {
    return db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM play_turns WHERE session_id = ?')
      .get(sessionId).n;
  }

  function createBranch(storyId, sessionId, forkTurnId, name) {
    const session = get(storyId, sessionId, { turns: true });
    if (!session) return null;
    assertWritable(sessionId);
    const visible = new Map(session.turns.map((turn) => [turn.id, turn]));
    if (!visible.has(forkTurnId)) throw problem('Choose a turn on the current path.', 400, 'PLAY_FORK_TURN_INVALID');
    const cleanName = optionalText(name, { max: 200 });
    if (!cleanName) throw problem('Branch name must be non-empty text of at most 200 characters.', 400, 'PLAY_BRANCH_NAME_INVALID');
    const forkTurn = visible.get(forkTurnId);
    const id = randomUUID();
    inImmediate(() => {
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM play_branches WHERE session_id = ?').get(sessionId).n;
      db.prepare(`INSERT INTO play_branches (id, session_id, ordinal, name, parent_branch_id, fork_turn_id)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, sessionId, ordinal, cleanName, forkTurn.branch_id, forkTurnId);
      db.prepare('UPDATE play_sessions SET selected_branch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id, sessionId);
    });
    return get(storyId, sessionId, { turns: true });
  }

  function chooseBranch(storyId, sessionId, branchId) {
    if (!rawSession(storyId, sessionId)) return null;
    assertNoReply(sessionId);
    if (!selectedBranch(sessionId, branchId)) throw problem('That branch does not belong to this session.', 404, 'PLAY_BRANCH_NOT_FOUND');
    db.prepare('UPDATE play_sessions SET selected_branch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(branchId, sessionId);
    return get(storyId, sessionId, { turns: true });
  }

  function selectSuccessor(storyId, sessionId, branchId, turnId) {
    if (!rawSession(storyId, sessionId)) return null;
    assertNoReply(sessionId);
    const branch = selectedBranch(sessionId, branchId);
    const turn = branch && db.prepare('SELECT * FROM play_turns WHERE id = ? AND session_id = ? AND branch_id = ?').get(turnId, sessionId, branchId);
    if (!branch || !turn) throw problem('Select a successor turn written on that branch.', 400, 'PLAY_SUCCESSOR_INVALID');
    db.prepare('UPDATE play_branches SET selected_successor_turn_id = ? WHERE id = ?').run(turnId, branchId);
    return get(storyId, sessionId, { turns: true });
  }

  function insertOwnerTurn(sessionId, turn, idempotencyKey, requestHash) {
    const id = randomUUID();
    const branch = selectedBranch(sessionId);
    if (!branch) throw problem('This session has no active path.', 409, 'PLAY_BRANCH_MISSING');
    db.prepare(`
      INSERT INTO play_turns
        (id, session_id, ordinal, speaker, input_kind, character_id, content,
         source, idempotency_key, request_hash, branch_id)
      VALUES (?, ?, ?, 'owner', ?, ?, ?, 'author', ?, ?, ?)
    `).run(id, sessionId, nextOrdinal(sessionId), turn.kind, turn.character_id,
      turn.content, idempotencyKey, requestHash, branch.id);
    return db.prepare('SELECT * FROM play_turns WHERE id = ?').get(id);
  }

  function assertWritable(sessionId) {
    const row = db.prepare('SELECT status FROM play_sessions WHERE id = ?').get(sessionId);
    if (!row || row.status !== 'active') throw problem('An ended session is read-only.', 409, 'PLAY_SESSION_ENDED');
    assertNoReply(sessionId);
  }

  function assertNoReply(sessionId) {
    if (db.prepare("SELECT 1 FROM play_ai_requests WHERE session_id = ? AND status = 'in_flight'").get(sessionId)) {
      throw problem('The Scribe is already answering this session.', 409, 'PLAY_REPLY_IN_FLIGHT');
    }
  }

  function recordOwnerTurn(storyId, sessionId, turn, idempotencyKey = null) {
    if (!rawSession(storyId, sessionId)) return null;
    const requestHash = stableHash(turn);
    return inImmediate(() => {
      assertWritable(sessionId);
      if (idempotencyKey) {
        const repeated = db.prepare('SELECT * FROM play_turns WHERE session_id = ? AND idempotency_key = ?')
          .get(sessionId, idempotencyKey);
        if (repeated) {
          if (repeated.request_hash !== requestHash) throw problem('That request key was already used for a different turn.', 409, 'IDEMPOTENCY_MISMATCH');
          return { turn: repeated, reused: true };
        }
      }
      const inserted = insertOwnerTurn(sessionId, turn, idempotencyKey, requestHash);
      db.prepare('UPDATE play_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
      return { turn: inserted, reused: false };
    });
  }

  function beginAiRequest(storyId, sessionId, turn, idempotencyKey) {
    if (!idempotencyKey) throw problem('An Idempotency-Key is required for a paid Scribe reply.', 400, 'IDEMPOTENCY_REQUIRED');
    if (!rawSession(storyId, sessionId)) return null;
    const requestHash = stableHash(turn);
    return inImmediate(() => {
      assertWritable(sessionId);
      const existing = db.prepare('SELECT * FROM play_ai_requests WHERE session_id = ? AND idempotency_key = ?')
        .get(sessionId, idempotencyKey);
      if (existing) {
        if (existing.request_hash !== requestHash) throw problem('That request key was already used for a different turn.', 409, 'IDEMPOTENCY_MISMATCH');
        if (existing.status === 'succeeded') {
          return {
            reused: true,
            ownerTurn: db.prepare('SELECT * FROM play_turns WHERE id = ?').get(existing.owner_turn_id),
            responseTurn: db.prepare('SELECT * FROM play_turns WHERE id = ?').get(existing.response_turn_id),
          };
        }
        const latest = listTurns(sessionId).at(-1);
        if (latest?.id !== existing.owner_turn_id) {
          throw problem('Newer turns exist. Send a new request instead of retrying this older prompt.', 409, 'PLAY_RETRY_STALE');
        }
        db.prepare(`
          UPDATE play_ai_requests SET status = 'in_flight', error_code = NULL,
            error_message = NULL, updated_at = CURRENT_TIMESTAMP, finished_at = NULL
          WHERE session_id = ? AND idempotency_key = ?
        `).run(sessionId, idempotencyKey);
        return {
          reused: false,
          ownerTurn: db.prepare('SELECT * FROM play_turns WHERE id = ?').get(existing.owner_turn_id),
        };
      }
      const ownerTurn = insertOwnerTurn(sessionId, turn, idempotencyKey, requestHash);
      db.prepare(`
        INSERT INTO play_ai_requests
          (session_id, idempotency_key, request_hash, contract_json, owner_turn_id, status)
        VALUES (?, ?, ?, ?, ?, 'in_flight')
      `).run(sessionId, idempotencyKey, requestHash, JSON.stringify(contractSnapshot(get(storyId, sessionId))), ownerTurn.id);
      db.prepare('UPDATE play_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
      return { reused: false, ownerTurn };
    });
  }

  function settleAiSuccess(storyId, sessionId, idempotencyKey, result) {
    return inImmediate(() => {
      const request = db.prepare(`
        SELECT * FROM play_ai_requests
         WHERE session_id = ? AND idempotency_key = ? AND status = 'in_flight'
      `).get(sessionId, idempotencyKey);
      const session = rawSession(storyId, sessionId);
      const latest = listTurns(sessionId).at(-1);
      if (!request || !session || session.status !== 'active' || latest?.id !== request.owner_turn_id) {
        throw problem('The session changed before the Scribe reply returned. The paid reply was not added.', 409, 'PLAY_REPLY_STALE');
      }
      const responseId = randomUUID();
      const costKnown = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd);
      db.prepare(`
        INSERT INTO play_turns
          (id, session_id, ordinal, speaker, input_kind, content, source, model,
           prompt_tokens, completion_tokens, cost_usd, cost_known, billed_attempts, branch_id)
        VALUES (?, ?, ?, 'scribe', 'response', ?, 'ai', ?, ?, ?, ?, ?, ?, ?)
      `).run(responseId, sessionId, nextOrdinal(sessionId), result.content, result.model || null,
        result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null,
        costKnown ? result.cost_usd : null, costKnown ? 1 : 0,
        Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1,
        db.prepare('SELECT branch_id FROM play_turns WHERE id = ?').get(request.owner_turn_id).branch_id);
      db.prepare(`
        UPDATE play_ai_requests SET response_turn_id = ?, status = 'succeeded',
          spend_usd = spend_usd + ?, cost_known = cost_known AND ?,
          billed_attempts = billed_attempts + ?, updated_at = CURRENT_TIMESTAMP,
          finished_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND idempotency_key = ?
      `).run(responseId, costKnown ? result.cost_usd : 0, costKnown ? 1 : 0,
        Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1,
        sessionId, idempotencyKey);
      db.prepare('UPDATE play_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
      return {
        owner_turn: db.prepare('SELECT * FROM play_turns WHERE id = ?').get(request.owner_turn_id),
        response_turn: db.prepare('SELECT * FROM play_turns WHERE id = ?').get(responseId),
      };
    });
  }

  function settleAiFailure(sessionId, idempotencyKey, error) {
    const attempts = Number.isInteger(error.billedAttempts) ? error.billedAttempts : 0;
    const costKnown = typeof error.costUsd === 'number' && Number.isFinite(error.costUsd);
    db.prepare(`
      UPDATE play_ai_requests SET status = 'failed', spend_usd = spend_usd + ?,
        cost_known = cost_known AND ?, billed_attempts = billed_attempts + ?,
        error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP,
        finished_at = CURRENT_TIMESTAMP
      WHERE session_id = ? AND idempotency_key = ? AND status = 'in_flight'
    `).run(costKnown ? error.costUsd : 0, attempts === 0 || costKnown ? 1 : 0, attempts,
      String(error.code || 'PLAY_PROVIDER_FAILED').slice(0, 100),
      String(error.message || 'Scribe reply failed.').slice(0, 2000), sessionId, idempotencyKey);
  }

  function reconcile() {
    db.prepare(`
      UPDATE play_ai_requests SET status = 'failed', error_code = 'RESTART_INTERRUPTED',
        error_message = 'The server restarted before this Scribe reply completed. Retry explicitly.',
        updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP
      WHERE status = 'in_flight'
    `).run();
  }

  reconcile();
  return {
    get, listForScene, listTurns, listBranches, validateContract, validateTurn, create,
    updateContract, end, recordOwnerTurn, beginAiRequest, settleAiSuccess,
    settleAiFailure, reconcile, createBranch, chooseBranch, selectSuccessor,
  };
}

module.exports = { createPlayStore, CONTROLLERS, TURN_KINDS, CONTRACT_ENUMS, stableHash };
