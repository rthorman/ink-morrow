'use strict';

// Campaign state is an optional, revisioned owner ledger. It also projects
// selected page-extracted continuity into the same read model without copying
// or mutating the evidence-bound continuity rows.

const { randomUUID, createHash } = require('node:crypto');

const KINDS = Object.freeze([
  'relationship', 'promise', 'debt', 'knowledge_boundary', 'secret',
  'npc_goal', 'faction', 'quest', 'condition', 'inventory', 'resource',
  'world_time', 'deadline', 'clock',
]);
const STATUSES = Object.freeze(['active', 'resolved']);
const VISIBILITIES = Object.freeze(['public', 'secret']);
const DETAIL_FIELDS = Object.freeze(['summary', 'state', 'quantity', 'unit', 'progress', 'maximum', 'due', 'notes']);

function problem(message, statusCode = 400, code = 'INVALID_CAMPAIGN_STATE') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, max, { nullable = true } = {}) {
  if (value === null || value === undefined || value === '') return nullable ? null : undefined;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : undefined;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function castFor(story) {
  return parseJson(story.characters, []);
}

function castIdsFor(story) {
  return new Set(castFor(story).map((member) => member.id));
}

function validateIdList(value, castIds, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw problem(`${label} must be a list of at most 50 cast members.`);
  const result = [];
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !castIds.has(id) || seen.has(id)) {
      throw problem(`${label} contains an unknown or repeated cast member.`);
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function validateDetails(value, existing = {}) {
  if (value === undefined) return existing;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !DETAIL_FIELDS.includes(key))) {
    throw problem(`details may contain only: ${DETAIL_FIELDS.join(', ')}.`);
  }
  const result = { ...existing };
  for (const field of ['summary', 'state', 'unit', 'due', 'notes']) {
    if (value[field] === undefined) continue;
    const clean = cleanText(value[field], field === 'notes' ? 4000 : 1200);
    if (value[field] !== null && value[field] !== '' && clean === undefined) {
      throw problem(`details.${field} must be bounded text.`);
    }
    result[field] = clean;
  }
  for (const field of ['quantity', 'progress', 'maximum']) {
    if (value[field] === undefined || value[field] === null) continue;
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || Math.abs(value[field]) > 1e12) {
      throw problem(`details.${field} must be a finite number.`);
    }
    result[field] = value[field];
  }
  if (result.progress !== undefined && result.maximum !== undefined && result.maximum <= 0) {
    throw problem('A progress clock maximum must be greater than zero.');
  }
  return result;
}

function createCampaignStore(db, { stories, continuity, playStore }) {
  function storyOrNull(storyId) {
    return stories.getStory(storyId);
  }

  function sourceFor(storyId, sourceType, sourceId) {
    if (sourceType === 'author') return { source_type: 'author', source_id: null, source_excerpt: null, source_label: 'Owner record' };
    if (!sourceId || typeof sourceId !== 'string') throw problem('Choose a source page or Play turn.');
    if (sourceType === 'page_revision') {
      const row = db.prepare(`
        SELECT revision.id, revision.content, projected.page_number
          FROM page_revisions revision
          JOIN pages page ON page.id = revision.page_id
          JOIN chapters chapter ON chapter.id = page.chapter_id
          JOIN volumes volume ON volume.id = chapter.volume_id
          JOIN manuscript_pages projected ON projected.id = page.id
         WHERE revision.id = ? AND volume.story_id = ?
      `).get(sourceId, storyId);
      if (!row) throw problem('That page revision does not belong to this manuscript.');
      return {
        source_type: sourceType, source_id: row.id,
        source_excerpt: String(row.content || '').slice(0, 1200),
        source_label: `Page ${row.page_number}`,
      };
    }
    if (sourceType === 'play_turn') {
      const row = db.prepare(`
        SELECT turn.id, turn.ordinal, turn.content, session.ordinal AS session_ordinal,
               scene.title AS scene_title
          FROM play_turns turn
          JOIN play_sessions session ON session.id = turn.session_id
          JOIN scenes scene ON scene.id = session.scene_id
          JOIN chapters chapter ON chapter.id = scene.chapter_id
          JOIN volumes volume ON volume.id = chapter.volume_id
         WHERE turn.id = ? AND volume.story_id = ?
      `).get(sourceId, storyId);
      if (!row) throw problem('That Play turn does not belong to this manuscript.');
      return {
        source_type: sourceType, source_id: row.id,
        source_excerpt: String(row.content || '').slice(0, 1200),
        source_label: `${row.scene_title} · session ${row.session_ordinal}, turn ${row.ordinal}`,
      };
    }
    throw problem('source_type must be author, page_revision, or play_turn.');
  }

  function currentRow(storyId, entryId) {
    const row = db.prepare(`
      SELECT entry.*, revision.id AS revision_id, revision.revision_number,
             revision.title, revision.details_json, revision.subject_character_id,
             revision.related_character_id, revision.visibility,
             revision.known_by_json, revision.witnesses_json, revision.source_type,
             revision.source_id, revision.source_excerpt, revision.note,
             revision.created_at AS revision_created_at
        FROM campaign_entries entry
        JOIN campaign_entry_revisions revision ON revision.entry_id = entry.id
       WHERE entry.id = ? AND entry.story_id = ?
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number) FROM campaign_entry_revisions latest
            WHERE latest.entry_id = entry.id
         )
    `).get(entryId, storyId);
    return row ? publicEntry(row) : null;
  }

  function sourceLabel(storyId, row) {
    if (row.source_type === 'author') return 'Owner record';
    try { return sourceFor(storyId, row.source_type, row.source_id).source_label; }
    catch { return row.source_type === 'play_turn' ? 'Archived Play turn' : 'Archived page revision'; }
  }

  function publicEntry(row) {
    return {
      id: row.id,
      story_id: row.story_id,
      kind: row.kind,
      status: row.status,
      revision_id: row.revision_id,
      revision_number: Number(row.revision_number),
      title: row.title,
      details: parseJson(row.details_json, {}),
      subject_character_id: row.subject_character_id,
      related_character_id: row.related_character_id,
      visibility: row.visibility,
      known_by: parseJson(row.known_by_json, []),
      witnesses: parseJson(row.witnesses_json, []),
      source: {
        type: row.source_type,
        id: row.source_id,
        excerpt: row.source_excerpt,
        label: sourceLabel(row.story_id, row),
      },
      note: row.note,
      origin: (row.origin_source_type || row.source_type) ? {
        type: row.origin_source_type || row.source_type,
        id: row.origin_source_type ? row.origin_source_id : row.source_id,
        excerpt: row.origin_source_type ? row.origin_source_excerpt : row.source_excerpt,
        label: sourceLabel(row.story_id, {
          source_type: row.origin_source_type || row.source_type,
          source_id: row.origin_source_type ? row.origin_source_id : row.source_id,
        }),
      } : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      revision_created_at: row.revision_created_at,
      derived: false,
    };
  }

  function listAuthored(storyId, { includeRetired = false } = {}) {
    return db.prepare(`
      SELECT entry.*, revision.id AS revision_id, revision.revision_number,
             revision.title, revision.details_json, revision.subject_character_id,
             revision.related_character_id, revision.visibility,
             revision.known_by_json, revision.witnesses_json, revision.source_type,
             revision.source_id, revision.source_excerpt, revision.note,
             revision.created_at AS revision_created_at,
             origin.source_type AS origin_source_type, origin.source_id AS origin_source_id,
             origin.source_excerpt AS origin_source_excerpt
        FROM campaign_entries entry
        JOIN campaign_entry_revisions revision ON revision.entry_id = entry.id
        JOIN campaign_entry_revisions origin ON origin.entry_id = entry.id AND origin.revision_number = 1
       WHERE entry.story_id = ? ${includeRetired ? '' : "AND entry.status != 'retired'"}
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number) FROM campaign_entry_revisions latest
            WHERE latest.entry_id = entry.id
         )
       ORDER BY CASE entry.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
                entry.updated_at DESC, entry.id
    `).all(storyId).map(publicEntry);
  }

  function validate(story, body, existing = null) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('Campaign state must be an object.');
    const kind = body.kind === undefined ? existing?.kind : cleanText(body.kind, 40, { nullable: false });
    if (!KINDS.includes(kind)) throw problem(`kind must be one of: ${KINDS.join(', ')}.`);
    const status = body.status === undefined ? existing?.status || 'active' : cleanText(body.status, 20, { nullable: false });
    if (!STATUSES.includes(status)) throw problem('status must be active or resolved.');
    const title = body.title === undefined ? existing?.title : cleanText(body.title, 300, { nullable: false });
    if (!title) throw problem('title must be non-empty text of at most 300 characters.');
    const details = validateDetails(body.details, existing?.details || {});
    const castIds = castIdsFor(story);
    const member = (value, fallback, label) => {
      const id = value === undefined ? fallback : (value || null);
      if (id !== null && (typeof id !== 'string' || !castIds.has(id))) throw problem(`${label} must belong to this manuscript cast.`);
      return id;
    };
    const subject = member(body.subject_character_id, existing?.subject_character_id || null, 'subject_character_id');
    const related = member(body.related_character_id, existing?.related_character_id || null, 'related_character_id');
    if (subject && related && subject === related) throw problem('A relationship cannot point a character at themselves.');
    const visibility = body.visibility === undefined ? existing?.visibility || 'public' : body.visibility;
    if (!VISIBILITIES.includes(visibility)) throw problem('visibility must be public or secret.');
    const knownBy = validateIdList(body.known_by, castIds, 'known_by') ?? existing?.known_by ?? [];
    const witnesses = validateIdList(body.witnesses, castIds, 'witnesses') ?? existing?.witnesses ?? [];
    const note = body.note === undefined ? existing?.note || null : cleanText(body.note, 2000);
    if (body.note !== undefined && body.note !== null && body.note !== '' && note === undefined) {
      throw problem('note must be text of at most 2000 characters.');
    }
    const sourceType = body.source_type === undefined ? 'author' : body.source_type;
    const source = sourceFor(story.id, sourceType, body.source_id || null);
    return { kind, status, title, details, subject, related, visibility, knownBy, witnesses, note, source };
  }

  function insertRevision(entryId, number, clean) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO campaign_entry_revisions
        (id, entry_id, revision_number, title, details_json, subject_character_id,
         related_character_id, visibility, known_by_json, witnesses_json,
         source_type, source_id, source_excerpt, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entryId, number, clean.title, JSON.stringify(clean.details), clean.subject,
      clean.related, clean.visibility, JSON.stringify(clean.knownBy), JSON.stringify(clean.witnesses),
      clean.source.source_type, clean.source.source_id, clean.source.source_excerpt, clean.note);
    return id;
  }

  function create(storyId, body) {
    const story = storyOrNull(storyId);
    if (!story) return null;
    const clean = validate(story, body);
    const entryId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO campaign_entries (id, story_id, kind, status) VALUES (?, ?, ?, ?)')
        .run(entryId, storyId, clean.kind, clean.status);
      insertRevision(entryId, 1, clean);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return currentRow(storyId, entryId);
  }

  function revise(storyId, entryId, body) {
    const story = storyOrNull(storyId);
    const existing = story && currentRow(storyId, entryId);
    if (!existing || existing.status === 'retired') return null;
    const clean = validate(story, body, existing);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE campaign_entries SET kind = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND story_id = ?`)
        .run(clean.kind, clean.status, entryId, storyId);
      insertRevision(entryId, existing.revision_number + 1, clean);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return currentRow(storyId, entryId);
  }

  function retire(storyId, entryId) {
    const result = db.prepare(`
      UPDATE campaign_entries SET status = 'retired', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND story_id = ? AND status != 'retired'
    `).run(entryId, storyId);
    if (result.changes) db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return Boolean(result.changes);
  }

  function pageOrigin(provenance) {
    if (!provenance) return { type: 'page_revision', id: null, page_id: null, page_number: null, evidence: [] };
    return {
      type: 'page_revision', id: provenance.page_revision_id || null,
      page_id: provenance.page_id || null, page_number: provenance.page_number || null,
      label: provenance.page_number ? `Page ${provenance.page_number}` : 'Manuscript page',
      evidence: provenance.evidence || [],
    };
  }

  function derivedEntries(story) {
    const view = continuity.view(story);
    const result = [];
    const add = (id, kind, title, details, subject, related, provenance) => result.push({
      id: `derived:${id}`, story_id: story.id, kind, status: 'active', title, details,
      subject_character_id: subject || null, related_character_id: related || null,
      visibility: 'public', known_by: [], witnesses: [], source: pageOrigin(provenance),
      origin: pageOrigin(provenance), derived: true,
    });
    for (const character of view.characters || []) {
      if (character.current?.condition) add(`condition:${character.id}`, 'condition', `${character.name} · condition`,
        { summary: character.current.condition }, character.id, null, character.evidence?.condition);
      if (character.current?.knowledge?.length) add(`knowledge:${character.id}`, 'knowledge_boundary', `${character.name} · knowledge`,
        { summary: character.current.knowledge.join('; ') }, character.id, null, character.evidence?.knowledge);
      if (character.current?.possessions?.length) add(`inventory:${character.id}`, 'inventory', `${character.name} · inventory`,
        { summary: character.current.possessions.join('; ') }, character.id, null, character.evidence?.possessions);
      for (const [otherId, summary] of Object.entries(character.current?.relationships || {})) {
        const other = (view.characters || []).find((item) => item.id === otherId)?.name || 'cast member';
        add(`relationship:${character.id}:${otherId}`, 'relationship', `${character.name} → ${other}`,
          { summary }, character.id, otherId, character.evidence?.[`relationship:${otherId}`]);
      }
    }
    for (const goal of view.goals || []) {
      if (!['pending', 'active'].includes(goal.status)) continue;
      const name = (view.characters || []).find((item) => item.id === goal.character_id)?.name;
      add(`goal:${goal.id}`, 'npc_goal', name ? `${name} · goal` : 'Active goal',
        { summary: goal.text, state: goal.status }, goal.character_id, null, goal.provenance);
    }
    for (const thread of view.threads || []) {
      if (thread.status !== 'open') continue;
      add(`thread:${thread.id}`, 'quest', thread.text || 'Open thread',
        { state: thread.status }, null, null, thread.provenance);
    }
    return result;
  }

  function priority(entry, roleById) {
    const roles = [entry.subject_character_id, entry.related_character_id, ...(entry.known_by || []), ...(entry.witnesses || [])]
      .map((id) => roleById.get(id)).filter(Boolean);
    if (roles.includes('mc')) return 0;
    if (roles.includes('supporting')) return 1;
    if (roles.includes('background')) return 2;
    return 1;
  }

  function list(storyId, options = {}) {
    const story = storyOrNull(storyId);
    if (!story) return null;
    const roleById = new Map(castFor(story).map((member) => [member.id, member.role || 'supporting']));
    const entries = [...listAuthored(storyId, options), ...derivedEntries(story)]
      .map((entry) => ({ ...entry, priority: priority(entry, roleById) }))
      .sort((left, right) => left.priority - right.priority || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
    return { entries, kinds: KINDS };
  }

  function recap(storyId, sceneId) {
    const story = storyOrNull(storyId);
    if (!story || !stories.scenes.get(storyId, sceneId)) return null;
    const all = list(storyId)?.entries.filter((entry) => entry.status === 'active') || [];
    const selected = [];
    const perTier = new Map();
    for (const entry of all) {
      const count = perTier.get(entry.priority) || 0;
      if (count >= 12 || selected.length >= 30) continue;
      selected.push(entry);
      perTier.set(entry.priority, count + 1);
    }
    const latest = selectedTurns(storyId, sceneId, 8).map((turn) => ({
      ...turn,
      content: String(turn.content || '').slice(0, 500),
    }));
    return {
      entries: selected,
      omitted: Math.max(0, all.length - selected.length),
      recent_turns: latest,
      priority_order: ['main', 'supporting', 'background'],
    };
  }

  function selectedTurns(storyId, sceneId, limit) {
    const sessions = playStore.listForScene(storyId, sceneId) || [];
    return sessions.flatMap((session) => playStore.listTurns(session.id, session.selected_branch_id)
      .map((turn) => ({ ...turn, session_ordinal: session.ordinal })))
      .sort((left, right) => left.session_ordinal - right.session_ordinal || left.ordinal - right.ordinal)
      .slice(-limit);
  }

  function suggestionContext(storyId, sceneId) {
    const story = storyOrNull(storyId);
    if (!story || !stories.scenes.get(storyId, sceneId)) return null;
    const turns = selectedTurns(storyId, sceneId, 60);
    return { story, scene: stories.scenes.get(storyId, sceneId), turns, state: recap(storyId, sceneId) };
  }

  function requestHashFor(context) {
    return createHash('sha256').update(JSON.stringify({
      scene_id: context.scene.id,
      turns: context.turns.map((turn) => [turn.id, turn.content]),
      entries: context.state.entries.map((entry) => [entry.id, entry.revision_id || null, entry.status]),
    })).digest('hex');
  }

  function beginSuggestion(storyId, sceneId, idempotencyKey) {
    if (!idempotencyKey) throw problem('An Idempotency-Key is required for paid campaign suggestions.', 400, 'IDEMPOTENCY_REQUIRED');
    const context = suggestionContext(storyId, sceneId);
    if (!context) return null;
    if (!context.turns.length) throw problem('Record at least one Play turn before asking for campaign suggestions.');
    const requestHash = requestHashFor(context);
    const existing = db.prepare('SELECT * FROM campaign_ai_requests WHERE story_id = ? AND idempotency_key = ?')
      .get(storyId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) throw problem('That request key belongs to an older campaign-state context.', 409, 'IDEMPOTENCY_MISMATCH');
      if (existing.status === 'succeeded') return {
        reused: true, context, result: parseJson(existing.result_json, []),
        cost_usd: existing.cost_known ? existing.spend_usd : null,
        billed_attempts: existing.billed_attempts,
      };
      db.prepare(`UPDATE campaign_ai_requests SET status = 'in_flight', error_code = NULL,
        error_message = NULL, updated_at = CURRENT_TIMESTAMP, finished_at = NULL WHERE id = ?`).run(existing.id);
      return { reused: false, context };
    }
    db.prepare(`INSERT INTO campaign_ai_requests
      (id, story_id, scene_id, idempotency_key, request_hash, status)
      VALUES (?, ?, ?, ?, ?, 'in_flight')`)
      .run(randomUUID(), storyId, sceneId, idempotencyKey, requestHash);
    return { reused: false, context };
  }

  function settleSuggestionSuccess(storyId, idempotencyKey, result, proposals) {
    const request = db.prepare(`SELECT * FROM campaign_ai_requests
      WHERE story_id = ? AND idempotency_key = ? AND status = 'in_flight'`).get(storyId, idempotencyKey);
    if (!request) throw problem('Campaign state changed before the suggestions returned.', 409, 'CAMPAIGN_SUGGESTION_STALE');
    const current = suggestionContext(storyId, request.scene_id);
    if (!current || request.request_hash !== requestHashFor(current)) {
      throw problem('Campaign state changed before the suggestions returned. The paid suggestions were not applied.', 409, 'CAMPAIGN_SUGGESTION_STALE');
    }
    const known = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd);
    const attempts = Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1;
    db.prepare(`UPDATE campaign_ai_requests SET status = 'succeeded', result_json = ?,
      spend_usd = spend_usd + ?, cost_known = cost_known AND ?, billed_attempts = billed_attempts + ?,
      updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(proposals), known ? result.cost_usd : 0, known ? 1 : 0, attempts, request.id);
    return { proposals, cost_usd: known ? result.cost_usd : null, billed_attempts: attempts };
  }

  function settleSuggestionFailure(storyId, idempotencyKey, error) {
    const attempts = Number.isInteger(error.billedAttempts) ? error.billedAttempts : 0;
    const known = typeof error.costUsd === 'number' && Number.isFinite(error.costUsd);
    db.prepare(`UPDATE campaign_ai_requests SET status = 'failed', spend_usd = spend_usd + ?,
      cost_known = cost_known AND ?, billed_attempts = billed_attempts + ?, error_code = ?,
      error_message = ?, updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP
      WHERE story_id = ? AND idempotency_key = ? AND status = 'in_flight'`)
      .run(known ? error.costUsd : 0, attempts === 0 || known ? 1 : 0, attempts,
        String(error.code || 'CAMPAIGN_PROVIDER_FAILED').slice(0, 100),
        String(error.message || 'Campaign suggestion failed.').slice(0, 2000), storyId, idempotencyKey);
  }

  db.prepare(`UPDATE campaign_ai_requests SET status = 'failed', error_code = 'RESTART_INTERRUPTED',
    error_message = 'The server restarted before these suggestions completed. Retry explicitly.',
    updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP WHERE status = 'in_flight'`).run();

  return {
    create, revise, retire, list, recap, currentRow, listAuthored, suggestionContext,
    beginSuggestion, settleSuggestionSuccess, settleSuggestionFailure, KINDS,
  };
}

module.exports = { createCampaignStore, KINDS, STATUSES, VISIBILITIES, DETAIL_FIELDS };
