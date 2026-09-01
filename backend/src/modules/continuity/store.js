'use strict';

// Continuity v2 treats immutable canonical revisions as evidence. Extracted
// deltas, deterministic checkpoints, and search rows are derived data; local
// templates and author corrections remain separate, inspectable layers.

const { createHash, randomUUID } = require('node:crypto');
const { parseCastJson } = require('../stories/cast');

const CONTINUITY_SCHEMA_VERSION = 2;
const CHARACTER_FIELDS = ['location', 'condition', 'personality', 'appearance', 'relationship_to_mc'];
const GOAL_STATUSES = new Set(['pending', 'active', 'fulfilled', 'abandoned']);
const THREAD_STATUSES = new Set(['open', 'resolved']);
const FACT_STATUSES = new Set(['established', 'superseded']);
const ARC_MOVEMENTS = new Set(['advance', 'setback', 'turning_point', 'resolution']);
const CORRECTION_SCOPES = new Set(['story', 'world', 'character', 'goal', 'thread']);
const TEMPLATE_FIELDS = Object.freeze({
  world: Object.freeze(['name', 'description', 'genre', 'setting', 'lore']),
  character: Object.freeze(['name', 'description', 'personality', 'appearance', 'background']),
});
const CHECKPOINT_INTERVAL = 50;
const INSPECTION_HISTORY_LIMIT = 200;

class ContinuitySchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContinuitySchemaError';
    this.code = 'INVALID_CONTINUITY_SCHEMA';
    this.statusCode = 400;
  }
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function text(value, max = 2000) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function textList(value, { maxItems = 30, max = 500 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const clean = text(item, max);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
}

function stableId(prefix, ...parts) {
  const key = parts.map((part) => String(part || '').trim().toLowerCase()).join('|');
  return `${prefix}_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function contentHash(content) {
  return createHash('sha256').update(String(content || '')).digest('hex');
}

function projectionHash(projection) {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

function schemaFailure(path, message) {
  throw new ContinuitySchemaError(`${path} ${message}`);
}

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) schemaFailure(path, 'must be an object');
}

function assertExactKeys(value, keys, path) {
  assertObject(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const extras = actual.filter((key) => !expected.includes(key));
    const missing = expected.filter((key) => !actual.includes(key));
    schemaFailure(path, `has invalid fields${extras.length ? `; unknown: ${extras.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
  }
}

function strictString(value, path, { nullable = false, max = 2000 } = {}) {
  if (nullable && value === null) return null;
  const clean = text(value, max);
  if (!clean) schemaFailure(path, nullable ? 'must be null or non-empty text' : 'must be non-empty text');
  return clean;
}

function strictTextArray(value, path, { maxItems = 30, max = 500 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) schemaFailure(path, `must be an array of at most ${maxItems} strings`);
  return value.map((item, index) => strictString(item, `${path}[${index}]`, { max }));
}

function strictEvidence(value, path) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    schemaFailure(path, 'must contain 1 to 5 direct page quotations');
  }
  return value.map((item, index) => {
    assertExactKeys(item, ['quote'], `${path}[${index}]`);
    return { quote: strictString(item.quote, `${path}[${index}].quote`, { max: 500 }) };
  });
}

function validateContinuityDeltaV2(input, castIds = []) {
  assertExactKeys(input, [
    'schema_version', 'summary', 'events', 'character_updates', 'goal_updates',
    'thread_updates', 'world_fact_updates', 'arc_updates',
  ], 'delta');
  if (input.schema_version !== CONTINUITY_SCHEMA_VERSION) schemaFailure('delta.schema_version', 'must equal 2');
  const cast = new Set(castIds);
  const summary = strictString(input.summary, 'delta.summary', { max: 1600 });

  if (!Array.isArray(input.events) || input.events.length > 20) schemaFailure('delta.events', 'must be an array of at most 20 events');
  const events = input.events.map((raw, index) => {
    const path = `delta.events[${index}]`;
    assertExactKeys(raw, ['id', 'text', 'character_ids', 'importance', 'type', 'evidence'], path);
    const eventText = strictString(raw.text, `${path}.text`, { max: 1200 });
    const ids = strictTextArray(raw.character_ids, `${path}.character_ids`, { maxItems: 12, max: 100 });
    if (ids.some((id) => !cast.has(id))) schemaFailure(`${path}.character_ids`, 'contains a character outside the story snapshot');
    if (!['minor', 'major'].includes(raw.importance)) schemaFailure(`${path}.importance`, 'is invalid');
    if (!['action', 'revelation', 'transition', 'relationship', 'world'].includes(raw.type)) schemaFailure(`${path}.type`, 'is invalid');
    const id = raw.id === null ? stableId('event', eventText, index) : strictString(raw.id, `${path}.id`, { max: 100 });
    return { id, text: eventText, character_ids: ids, importance: raw.importance, type: raw.type, evidence: strictEvidence(raw.evidence, `${path}.evidence`) };
  });

  if (!Array.isArray(input.character_updates) || input.character_updates.length > 30) {
    schemaFailure('delta.character_updates', 'must be an array of at most 30 updates');
  }
  const character_updates = input.character_updates.map((raw, index) => {
    const path = `delta.character_updates[${index}]`;
    assertExactKeys(raw, [
      'character_id', 'location', 'condition', 'knowledge_gained', 'knowledge_lost',
      'possessions_gained', 'possessions_lost', 'personality', 'appearance',
      'relationships', 'evidence',
    ], path);
    const character_id = strictString(raw.character_id, `${path}.character_id`, { max: 100 });
    if (!cast.has(character_id)) schemaFailure(`${path}.character_id`, 'is outside the story snapshot');
    if (!Array.isArray(raw.relationships) || raw.relationships.length > 20) schemaFailure(`${path}.relationships`, 'must be an array of at most 20 relationships');
    const relationships = raw.relationships.map((relationship, relationshipIndex) => {
      const relationPath = `${path}.relationships[${relationshipIndex}]`;
      assertExactKeys(relationship, ['character_id', 'summary'], relationPath);
      return {
        character_id: strictString(relationship.character_id, `${relationPath}.character_id`, { max: 100 }),
        summary: strictString(relationship.summary, `${relationPath}.summary`, { max: 1000 }),
      };
    });
    return {
      character_id,
      location: strictString(raw.location, `${path}.location`, { nullable: true }),
      condition: strictString(raw.condition, `${path}.condition`, { nullable: true }),
      knowledge_gained: strictTextArray(raw.knowledge_gained, `${path}.knowledge_gained`),
      knowledge_lost: strictTextArray(raw.knowledge_lost, `${path}.knowledge_lost`),
      possessions_gained: strictTextArray(raw.possessions_gained, `${path}.possessions_gained`),
      possessions_lost: strictTextArray(raw.possessions_lost, `${path}.possessions_lost`),
      personality: strictString(raw.personality, `${path}.personality`, { nullable: true }),
      appearance: strictString(raw.appearance, `${path}.appearance`, { nullable: true }),
      relationships,
      evidence: strictEvidence(raw.evidence, `${path}.evidence`),
    };
  });

  function validateStatusUpdates(value, name, keys, statuses, prefix, withCharacter = false) {
    if (!Array.isArray(value) || value.length > 30) schemaFailure(`delta.${name}`, 'must be an array of at most 30 updates');
    return value.map((raw, index) => {
      const path = `delta.${name}[${index}]`;
      assertExactKeys(raw, keys, path);
      const itemText = strictString(raw.text, `${path}.text`, { nullable: true, max: 1000 });
      const characterId = withCharacter
        ? (raw.character_id === null ? null : strictString(raw.character_id, `${path}.character_id`, { max: 100 }))
        : null;
      if (characterId && !cast.has(characterId)) schemaFailure(`${path}.character_id`, 'is outside the story snapshot');
      const id = raw.id === null
        ? (itemText ? stableId(prefix, characterId, itemText) : schemaFailure(`${path}.id`, 'cannot be null without text'))
        : strictString(raw.id, `${path}.id`, { max: 100 });
      if (!statuses.has(raw.status)) schemaFailure(`${path}.status`, 'is invalid');
      return {
        id,
        ...(withCharacter ? { character_id: characterId } : {}),
        text: itemText,
        status: raw.status,
        evidence: strictEvidence(raw.evidence, `${path}.evidence`),
      };
    });
  }

  const goal_updates = validateStatusUpdates(input.goal_updates, 'goal_updates', ['id', 'character_id', 'text', 'status', 'evidence'], GOAL_STATUSES, 'goal', true);
  const thread_updates = validateStatusUpdates(input.thread_updates, 'thread_updates', ['id', 'text', 'status', 'evidence'], THREAD_STATUSES, 'thread');
  const world_fact_updates = validateStatusUpdates(input.world_fact_updates, 'world_fact_updates', ['id', 'text', 'status', 'evidence'], FACT_STATUSES, 'fact');

  if (!Array.isArray(input.arc_updates) || input.arc_updates.length > 30) schemaFailure('delta.arc_updates', 'must be an array of at most 30 updates');
  const arc_updates = input.arc_updates.map((raw, index) => {
    const path = `delta.arc_updates[${index}]`;
    assertExactKeys(raw, ['id', 'character_id', 'text', 'movement', 'evidence'], path);
    const character_id = raw.character_id === null ? null : strictString(raw.character_id, `${path}.character_id`, { max: 100 });
    if (character_id && !cast.has(character_id)) schemaFailure(`${path}.character_id`, 'is outside the story snapshot');
    const arcText = strictString(raw.text, `${path}.text`, { max: 1000 });
    if (!ARC_MOVEMENTS.has(raw.movement)) schemaFailure(`${path}.movement`, 'is invalid');
    return {
      id: raw.id === null ? stableId('arc', character_id, arcText) : strictString(raw.id, `${path}.id`, { max: 100 }),
      character_id,
      text: arcText,
      movement: raw.movement,
      evidence: strictEvidence(raw.evidence, `${path}.evidence`),
    };
  });

  return {
    schema_version: CONTINUITY_SCHEMA_VERSION,
    summary,
    events,
    character_updates,
    goal_updates,
    thread_updates,
    world_fact_updates,
    arc_updates,
  };
}

// Version 1 remains readable while existing archives and pre-4.0 model mocks
// are migrated. Version 2 is deliberately strict and never drops unknown data.
function sanitizeLegacyDelta(input, castIds) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowedCharacters = new Set(castIds || []);
  const summary = text(value.summary, 1600) || 'No durable change was recorded for this page.';
  const events = [];
  for (const raw of Array.isArray(value.events) ? value.events.slice(0, 20) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const eventText = text(raw.text, 1200);
    if (!eventText) continue;
    const character_ids = textList(raw.character_ids, { maxItems: 12, max: 100 }).filter((id) => allowedCharacters.has(id));
    events.push({
      id: text(raw.id, 100) || stableId('event', eventText, events.length),
      text: eventText,
      character_ids,
      importance: raw.importance === 'major' ? 'major' : 'minor',
      type: ['action', 'revelation', 'transition', 'relationship', 'world'].includes(raw.type) ? raw.type : 'action',
      evidence: [],
    });
  }
  const character_updates = [];
  for (const raw of Array.isArray(value.character_updates) ? value.character_updates.slice(0, 30) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !allowedCharacters.has(raw.character_id)) continue;
    const update = { character_id: raw.character_id };
    for (const field of CHARACTER_FIELDS) {
      const clean = text(raw[field], 2000);
      if (clean) update[field] = clean;
    }
    for (const field of ['knowledge_gained', 'knowledge_lost', 'possessions_gained', 'possessions_lost']) {
      const list = textList(raw[field]);
      if (list.length) update[field] = list;
    }
    update.relationships = [];
    update.evidence = [];
    if (Object.keys(update).length > 3) character_updates.push(update);
  }
  function legacyStatuses(rows, statuses, prefix, character = false) {
    const result = [];
    for (const raw of Array.isArray(rows) ? rows.slice(0, 30) : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const itemText = text(raw.text, 1000);
      const characterId = character && allowedCharacters.has(raw.character_id) ? raw.character_id : null;
      const id = text(raw.id, 100) || (itemText ? stableId(prefix, characterId, itemText) : null);
      const status = statuses.has(raw.status) ? raw.status : null;
      if (!id || (!itemText && !status)) continue;
      result.push({ id, ...(character ? { character_id: characterId } : {}), text: itemText, status: status || [...statuses][0], evidence: [] });
    }
    return result;
  }
  return {
    schema_version: 1,
    summary,
    events,
    character_updates,
    goal_updates: legacyStatuses(value.goal_updates, GOAL_STATUSES, 'goal', true),
    thread_updates: legacyStatuses(value.thread_updates, THREAD_STATUSES, 'thread'),
    world_fact_updates: legacyStatuses(value.world_fact_updates, FACT_STATUSES, 'fact'),
    arc_updates: [],
  };
}

function sanitizeDelta(input, castIds) {
  return input?.schema_version === CONTINUITY_SCHEMA_VERSION
    ? validateContinuityDeltaV2(input, castIds)
    : sanitizeLegacyDelta(input, castIds);
}

function addUnique(list, values) {
  const byLower = new Map((list || []).map((item) => [item.toLowerCase(), item]));
  for (const value of values || []) if (!byLower.has(value.toLowerCase())) byLower.set(value.toLowerCase(), value);
  return [...byLower.values()];
}

function removeValues(list, values) {
  const removed = new Set((values || []).map((item) => item.toLowerCase()));
  return (list || []).filter((item) => !removed.has(item.toLowerCase()));
}

function emptyLedger() {
  return {
    schema_version: CONTINUITY_SCHEMA_VERSION,
    character_states: {}, goals: {}, threads: {}, world_facts: {}, arcs: {},
    events: [], summaries: [], event_count: 0, summary_count: 0, delta_count: 0,
  };
}

function provenance(row, evidence = []) {
  return {
    page_id: row.page_id,
    page_number: row.page_number,
    page_revision_id: row.revision_id,
    evidence: Array.isArray(evidence) ? evidence : [],
  };
}

function applyDelta(ledger, rawDelta, row) {
  const delta = rawDelta && typeof rawDelta === 'object' ? rawDelta : {};
  const source = provenance(row);
  ledger.delta_count += 1;
  if (delta.summary) {
    ledger.summary_count = (ledger.summary_count || 0) + 1;
    ledger.summaries.push({ ...source, text: delta.summary });
    ledger.summaries = ledger.summaries.slice(-INSPECTION_HISTORY_LIMIT);
  }
  for (const event of delta.events || []) {
    ledger.event_count = (ledger.event_count || 0) + 1;
    ledger.events.push({ ...event, ...provenance(row, event.evidence) });
    ledger.events = ledger.events.slice(-INSPECTION_HISTORY_LIMIT);
  }
  for (const update of delta.character_updates || []) {
    if (!update.character_id) continue;
    const state = ledger.character_states[update.character_id] || {
      fields: {}, knowledge: [], possessions: [], relationships: {}, evidence: {},
    };
    for (const field of CHARACTER_FIELDS) {
      if (update[field]) {
        state.fields[field] = update[field];
        state.evidence[field] = provenance(row, update.evidence);
      }
    }
    state.knowledge = addUnique(state.knowledge, update.knowledge_gained);
    state.knowledge = removeValues(state.knowledge, update.knowledge_lost);
    state.possessions = addUnique(state.possessions, update.possessions_gained);
    state.possessions = removeValues(state.possessions, update.possessions_lost);
    for (const relationship of update.relationships || []) {
      if (relationship?.character_id && relationship?.summary) {
        state.relationships[relationship.character_id] = relationship.summary;
        state.evidence[`relationship:${relationship.character_id}`] = provenance(row, update.evidence);
      }
    }
    if ((update.knowledge_gained || update.knowledge_lost)?.length) state.evidence.knowledge = provenance(row, update.evidence);
    if ((update.possessions_gained || update.possessions_lost)?.length) state.evidence.possessions = provenance(row, update.evidence);
    ledger.character_states[update.character_id] = state;
  }
  for (const [name, target] of [
    ['goal_updates', ledger.goals], ['thread_updates', ledger.threads], ['world_fact_updates', ledger.world_facts],
  ]) {
    for (const update of delta[name] || []) {
      if (!update.id) continue;
      target[update.id] = { ...(target[update.id] || { id: update.id }), ...update, provenance: provenance(row, update.evidence) };
    }
  }
  for (const update of delta.arc_updates || []) {
    if (!update.id) continue;
    const prior = ledger.arcs[update.id] || { id: update.id, movements: [] };
    prior.character_id = update.character_id || prior.character_id || null;
    prior.text = update.text || prior.text;
    prior.movement = update.movement;
    prior.provenance = provenance(row, update.evidence);
    prior.movements.push({ movement: update.movement, text: update.text, ...provenance(row, update.evidence) });
    prior.movements = prior.movements.slice(-50);
    ledger.arcs[update.id] = prior;
  }
  return ledger;
}

function sanitizeOverrides(input, castIds, knownGoalIds = [], knownThreadIds = []) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowedCharacters = new Set(castIds || []);
  const allowedGoals = new Set(knownGoalIds);
  const allowedThreads = new Set(knownThreadIds);
  const characters = {};
  for (const [id, raw] of Object.entries(value.characters || {})) {
    if (!allowedCharacters.has(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const clean = {};
    for (const field of CHARACTER_FIELDS) {
      const v = text(raw[field], 2000);
      if (v) clean[field] = v;
    }
    const knowledge = textList(raw.knowledge);
    const possessions = textList(raw.possessions);
    if (knowledge.length) clean.knowledge = knowledge;
    if (possessions.length) clean.possessions = possessions;
    if (Object.keys(clean).length) characters[id] = clean;
  }
  const goals = {};
  for (const [id, raw] of Object.entries(value.goals || {})) {
    const status = raw && GOAL_STATUSES.has(raw.status) ? raw.status : null;
    if (allowedGoals.has(id) && status) goals[id] = { status };
  }
  const threads = {};
  for (const [id, raw] of Object.entries(value.threads || {})) {
    const status = raw && THREAD_STATUSES.has(raw.status) ? raw.status : null;
    if (allowedThreads.has(id) && status) threads[id] = { status };
  }
  return { characters, goals, threads };
}

function createContinuityStore(db) {
  const insertLegacySnapshot = db.prepare(`
    INSERT OR IGNORE INTO story_character_snapshots
      (story_id, character_id, name, description, personality, appearance, background, source_updated_at)
    SELECT ?, id, name, description, personality, appearance, background, updated_at
      FROM characters WHERE id = ?
  `);

  function insertTemplateSnapshot(storyId, kind, sourceId, sourceRevision, snapshot) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO template_snapshots
        (id, story_id, template_kind, source_template_id, source_revision, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, storyId, kind, sourceId, sourceRevision || null, JSON.stringify(snapshot));
    return db.prepare('SELECT * FROM template_snapshots WHERE id = ?').get(id);
  }

  function latestTemplate(storyId, kind, sourceId) {
    return db.prepare(`
      SELECT * FROM template_snapshots
       WHERE story_id = ? AND template_kind = ? AND source_template_id = ?
       ORDER BY rowid DESC LIMIT 1
    `).get(storyId, kind, sourceId);
  }

  function ensureSnapshots(story) {
    if (story.world_id && !latestTemplate(story.id, 'world', story.world_id)) {
      const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(story.world_id);
      if (world) insertTemplateSnapshot(story.id, 'world', world.id, world.updated_at,
        Object.fromEntries(TEMPLATE_FIELDS.world.map((field) => [field, world[field] ?? null])));
    }
    const cast = parseCastJson(story.characters);
    for (const entry of cast) {
      insertLegacySnapshot.run(story.id, entry.id);
      if (!latestTemplate(story.id, 'character', entry.id)) {
        const frozen = db.prepare(`
          SELECT * FROM story_character_snapshots WHERE story_id = ? AND character_id = ?
        `).get(story.id, entry.id);
        if (frozen) insertTemplateSnapshot(story.id, 'character', entry.id, frozen.source_updated_at,
          Object.fromEntries(TEMPLATE_FIELDS.character.map((field) => [field, frozen[field] ?? null])));
      }
    }
    return cast;
  }

  function snapshots(story) {
    const cast = ensureSnapshots(story);
    return cast.map((entry) => {
      const row = latestTemplate(story.id, 'character', entry.id);
      if (!row) return null;
      const snapshot = parseJson(row.snapshot_json, {});
      return {
        story_id: story.id, character_id: entry.id, ...snapshot,
        source_updated_at: row.source_revision, created_at: row.created_at,
        snapshot_id: row.id, role: entry.role, relation: entry.relation,
        manual_state: entry.state || null,
      };
    }).filter(Boolean);
  }

  function worldSnapshot(story) {
    ensureSnapshots(story);
    if (!story.world_id) return null;
    const row = latestTemplate(story.id, 'world', story.world_id);
    return row ? {
      id: row.source_template_id, snapshot_id: row.id, source_revision: row.source_revision,
      ...parseJson(row.snapshot_json, {}),
    } : null;
  }

  const READY_ROWS_SQL = `
    SELECT delta.*, revision.page_id, page.display_revision_id, story_page.page_number
      FROM continuity_deltas delta
      JOIN page_revisions revision ON revision.id = delta.revision_id
      JOIN pages page ON page.id = revision.page_id AND page.canonical_revision_id = delta.revision_id
      JOIN story_pages story_page ON story_page.id = page.id
     WHERE delta.story_id = ? AND delta.status = 'ready'
     ORDER BY story_page.page_number, page.id
  `;

  function memoryRows(storyId, { throughPageNumber = null, excludePageIds = [] } = {}) {
    const excluded = new Set(excludePageIds || []);
    return db.prepare(READY_ROWS_SQL).all(storyId).filter((row) =>
      (throughPageNumber === null || row.page_number <= throughPageNumber) && !excluded.has(row.page_id)
    );
  }

  function validCheckpoint(row) {
    if (!row) return null;
    const ledger = parseJson(row.projection_json, null);
    return ledger && projectionHash(ledger) === row.projection_hash ? ledger : null;
  }

  function rebuildFrom(storyId, requestedStart = 1) {
    let start = Math.max(1, Number(requestedStart) || 1);
    db.prepare(`
      DELETE FROM continuity_projection_checkpoints
       WHERE story_id = ? AND revision_id NOT IN (
         SELECT canonical_revision_id FROM pages WHERE canonical_revision_id IS NOT NULL
       )
    `).run(storyId);
    let prior = start > 1 ? db.prepare(`
      SELECT checkpoint.* FROM continuity_projection_checkpoints checkpoint
      JOIN pages page ON page.canonical_revision_id = checkpoint.revision_id
      WHERE checkpoint.story_id = ? AND checkpoint.page_number < ?
      ORDER BY checkpoint.page_number DESC LIMIT 1
    `).get(storyId, start) : null;
    let ledger = validCheckpoint(prior);
    if (ledger) {
      const expectedPrior = db.prepare(`
        SELECT COUNT(*) AS count FROM continuity_deltas delta
        JOIN pages page ON page.canonical_revision_id = delta.revision_id
        JOIN story_pages story_page ON story_page.id = page.id
        WHERE delta.story_id = ? AND delta.status = 'ready' AND story_page.page_number < ?
      `).get(storyId, start).count;
      if (Number(prior.delta_count) !== Number(expectedPrior)) ledger = null;
    }
    if (!ledger) { start = 1; prior = null; ledger = emptyLedger(); }
    db.prepare('DELETE FROM continuity_projection_checkpoints WHERE story_id = ? AND page_number >= ?').run(storyId, start);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO continuity_projection_checkpoints
        (revision_id, story_id, page_id, page_number, delta_count, projection_json, projection_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    let rebuilt = 0;
    const rows = memoryRows(storyId).filter((item) => item.page_number >= start);
    for (const [index, row] of rows.entries()) {
      applyDelta(ledger, parseJson(row.delta_json, {}), row);
      if (row.page_number % CHECKPOINT_INTERVAL === 0 || index === rows.length - 1) {
        const serialized = JSON.stringify(ledger);
        insert.run(row.revision_id, storyId, row.page_id, row.page_number, ledger.delta_count, serialized, projectionHash(ledger));
      }
      rebuilt += 1;
    }
    db.prepare(`
      DELETE FROM continuity_projection_checkpoints
       WHERE story_id = ? AND page_number % ? <> 0
         AND revision_id <> COALESCE((
           SELECT delta.revision_id FROM continuity_deltas delta
           JOIN pages page ON page.canonical_revision_id = delta.revision_id
           JOIN story_pages story_page ON story_page.id = page.id
           WHERE delta.story_id = ? AND delta.status = 'ready'
           ORDER BY story_page.page_number DESC LIMIT 1
         ), '')
    `).run(storyId, CHECKPOINT_INTERVAL, storyId);
    return { ledger, rebuilt, delta_count: ledger.delta_count, projection_hash: projectionHash(ledger) };
  }

  function ensureCurrentLedger(storyId) {
    const total = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM continuity_deltas delta
      JOIN pages page ON page.canonical_revision_id = delta.revision_id
      WHERE delta.story_id = ? AND delta.status = 'ready'
    `).get(storyId).count) || 0;
    if (!total) return emptyLedger();
    const latest = db.prepare(`
      SELECT checkpoint.* FROM continuity_projection_checkpoints checkpoint
      JOIN pages page ON page.canonical_revision_id = checkpoint.revision_id
      WHERE checkpoint.story_id = ? ORDER BY checkpoint.page_number DESC LIMIT 1
    `).get(storyId);
    const ledger = validCheckpoint(latest);
    if (ledger && Number(latest.delta_count) === total) return ledger;
    return rebuildFrom(storyId, ledger ? latest.page_number + 1 : 1).ledger;
  }

  function ledgerThrough(storyId, throughPageNumber, excludePageIds = []) {
    const excluded = new Set(excludePageIds || []);
    let excludedBefore = false;
    if (excluded.size) {
      const marks = [...excluded].map(() => '?').join(', ');
      excludedBefore = Boolean(db.prepare(`
        SELECT COUNT(*) AS count FROM story_pages
        WHERE story_id = ? AND page_number <= ? AND id IN (${marks})
      `).get(storyId, throughPageNumber, ...excluded).count);
    }
    if (!excludedBefore) {
      ensureCurrentLedger(storyId);
      const checkpoint = db.prepare(`
        SELECT checkpoint.* FROM continuity_projection_checkpoints checkpoint
        JOIN pages page ON page.canonical_revision_id = checkpoint.revision_id
        WHERE checkpoint.story_id = ? AND checkpoint.page_number <= ?
        ORDER BY checkpoint.page_number DESC LIMIT 1
      `).get(storyId, throughPageNumber);
      const ledger = validCheckpoint(checkpoint) || emptyLedger();
      const after = checkpoint?.page_number || 0;
      for (const row of memoryRows(storyId, { throughPageNumber }).filter((item) => item.page_number > after)) {
        applyDelta(ledger, parseJson(row.delta_json, {}), row);
      }
      return ledger;
    }
    const ledger = emptyLedger();
    for (const row of memoryRows(storyId, { throughPageNumber, excludePageIds })) {
      applyDelta(ledger, parseJson(row.delta_json, {}), row);
    }
    return ledger;
  }

  function correctionRows(storyId) {
    return db.prepare('SELECT * FROM continuity_corrections WHERE story_id = ? ORDER BY created_at, rowid')
      .all(storyId).map((row) => ({ ...row, correction: parseJson(row.correction_json, {}) }));
  }

  function composeProjection(story, ledger) {
    const characters = snapshots(story).map((snapshot) => {
      const state = ledger.character_states[snapshot.character_id] || {
        fields: {}, knowledge: [], possessions: [], relationships: {}, evidence: {},
      };
      return {
        id: snapshot.character_id, name: snapshot.name, role: snapshot.role, relation: snapshot.relation,
        description: snapshot.description || '', personality: snapshot.personality || '',
        appearance: snapshot.appearance || '', background: snapshot.background || '', snapshot_id: snapshot.snapshot_id,
        state: { ...state.fields },
        current: {
          location: state.fields.location || null,
          condition: state.fields.condition || null,
          knowledge: [...state.knowledge], possessions: [...state.possessions],
          personality: state.fields.personality || snapshot.personality || '',
          appearance: state.fields.appearance || snapshot.appearance || '',
          relationship_to_mc: state.fields.relationship_to_mc || snapshot.relation || null,
          relationships: { ...state.relationships },
        },
        evidence: { ...state.evidence }, manual_state: snapshot.manual_state,
      };
    });
    const characterById = new Map(characters.map((character) => [character.id, character]));
    for (const character of characters) {
      for (const field of ['personality', 'appearance', 'relationship_to_mc']) {
        const value = text(character.manual_state?.[field]);
        if (value) { character.current[field] = value; character.state[field] = value; }
      }
    }
    const goals = Object.values(ledger.goals);
    const threads = Object.values(ledger.threads);
    const worldFacts = Object.values(ledger.world_facts);
    const goalById = new Map(goals.map((item) => [item.id, item]));
    const threadById = new Map(threads.map((item) => [item.id, item]));
    const factById = new Map(worldFacts.map((item) => [item.id, item]));
    const overrides = sanitizeOverrides(parseJson(story.continuity_overrides || '{}', {}),
      characters.map((item) => item.id), goals.map((item) => item.id), threads.map((item) => item.id));
    for (const [id, update] of Object.entries(overrides.characters)) {
      const character = characterById.get(id);
      if (character) { Object.assign(character.current, update); Object.assign(character.state, update); }
    }
    for (const [id, update] of Object.entries(overrides.goals)) Object.assign(goalById.get(id), update);
    for (const [id, update] of Object.entries(overrides.threads)) Object.assign(threadById.get(id), update);

    const corrections = correctionRows(story.id);
    for (const row of corrections) {
      const correction = row.correction;
      const metadata = { correction_id: row.id, reason: correction.reason || null, evidence: correction.evidence || [] };
      if (row.scope === 'character') {
        const character = characterById.get(row.subject_id);
        if (character && typeof correction.field === 'string') {
          character.current[correction.field] = correction.value;
          character.state[correction.field] = correction.value;
          character.evidence[correction.field] = { correction: metadata };
        }
      } else {
        const target = row.scope === 'goal' ? goalById.get(row.subject_id)
          : row.scope === 'thread' ? threadById.get(row.subject_id)
            : row.scope === 'world' ? factById.get(row.subject_id) : null;
        if (target) { target[correction.field] = correction.value; target.correction = metadata; }
      }
    }
    return {
      schema_version: CONTINUITY_SCHEMA_VERSION,
      projection_hash: projectionHash(ledger), delta_count: ledger.delta_count,
      world: worldSnapshot(story), characters, goals, threads, world_facts: worldFacts,
      arcs: Object.values(ledger.arcs), events: ledger.events, summaries: ledger.summaries,
      history_counts: {
        events: ledger.event_count ?? ledger.events.length,
        summaries: ledger.summary_count ?? ledger.summaries.length,
      },
      overrides,
      corrections: corrections.map(({ correction_json, correction, ...row }) => ({ ...row, ...correction })),
    };
  }

  function project(story, { throughPageNumber = null, excludePageIds = [] } = {}) {
    const ledger = throughPageNumber === null && !(excludePageIds || []).length
      ? ensureCurrentLedger(story.id)
      : ledgerThrough(story.id, throughPageNumber ?? Number.MAX_SAFE_INTEGER, excludePageIds);
    return composeProjection(story, ledger);
  }

  function coverage(story) {
    const pages = db.prepare(`
      SELECT story_page.id, story_page.page_number, story_page.continuity_cost_usd,
             page.canonical_revision_id AS revision_id,
             COALESCE(delta.status, legacy.status) AS status,
             COALESCE(delta.error, legacy.error) AS error
      FROM story_pages story_page
      LEFT JOIN pages page ON page.id = story_page.id
      LEFT JOIN page_revisions revision ON revision.id = page.canonical_revision_id
      LEFT JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id
      LEFT JOIN story_memory_pages legacy ON legacy.page_id = story_page.id
      WHERE story_page.story_id = ? AND story_page.image_media_type IS NULL
        AND TRIM(COALESCE(revision.content, story_page.content)) <> ''
      ORDER BY story_page.page_number
    `).all(story.id);
    return {
      total: pages.length,
      ready: pages.filter((page) => page.status === 'ready').length,
      pages: pages.map((page) => ({
        page_id: page.id, page_revision_id: page.revision_id, page_number: page.page_number,
        status: page.status || 'pending', error: page.error || null,
      })),
      pending_page_ids: pages.filter((page) => !page.status).map((page) => page.id),
      failed: pages.filter((page) => page.status === 'failed').map((page) => ({
        page_id: page.id, page_revision_id: page.revision_id, page_number: page.page_number, error: page.error,
      })),
      memory_cost_usd: pages.reduce((sum, page) => sum + (Number(page.continuity_cost_usd) || 0), 0),
    };
  }

  function coverageSummary(story) {
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN COALESCE(delta.status, legacy.status) = 'ready' THEN 1 ELSE 0 END), 0) AS ready
      FROM story_pages story_page
      LEFT JOIN pages page ON page.id = story_page.id
      LEFT JOIN page_revisions revision ON revision.id = page.canonical_revision_id
      LEFT JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id
      LEFT JOIN story_memory_pages legacy ON legacy.page_id = story_page.id
      WHERE story_page.story_id = ? AND story_page.image_media_type IS NULL
        AND TRIM(COALESCE(revision.content, story_page.content)) <> ''
    `).get(story.id);
    return { total: Number(row.total) || 0, ready: Number(row.ready) || 0 };
  }

  function issueRows(storyId) {
    return db.prepare('SELECT * FROM continuity_issues WHERE story_id = ? ORDER BY created_at, rowid')
      .all(storyId).map((row) => ({ ...row, detail: parseJson(row.detail_json, {}) }));
  }

  function continuityView(story, options = {}) {
    const folded = project(story, options);
    return {
      ...folded,
      events: folded.events.slice(-200), summaries: folded.summaries.slice(-200),
      history_counts: folded.history_counts,
      coverage: coverage(story), issues: issueRows(story.id),
    };
  }

  function canonicalPage(pageId) {
    return db.prepare(`
      SELECT story_page.*, page.canonical_revision_id AS revision_id, page.display_revision_id,
             revision.content AS canonical_content, revision.direction AS canonical_direction,
             revision.created_at AS revision_created_at
      FROM story_pages story_page
      JOIN pages page ON page.id = story_page.id
      JOIN page_revisions revision ON revision.id = page.canonical_revision_id
      WHERE story_page.id = ?
    `).get(pageId);
  }

  function pageForExtraction(pageId) {
    const row = canonicalPage(pageId);
    return row ? { ...row, content: row.canonical_content, user_input: row.canonical_direction, canonical_revision_id: row.revision_id } : null;
  }

  function invalidateFrom(storyId, pageNumber) {
    db.prepare('DELETE FROM continuity_projection_checkpoints WHERE story_id = ? AND page_number >= ?')
      .run(storyId, Math.max(1, Number(pageNumber) || 1));
  }

  function beginPage(pageInput) {
    const page = pageInput.revision_id ? pageInput : pageForExtraction(pageInput.id);
    if (!page?.revision_id) throw new Error('Page has no canonical revision');
    const hash = contentHash(page.content);
    db.prepare(`
      INSERT INTO continuity_deltas (revision_id, story_id, status, schema_version, content_hash, updated_at)
      VALUES (?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(revision_id) DO UPDATE SET status = 'pending', schema_version = excluded.schema_version,
        content_hash = excluded.content_hash, summary = NULL, delta_json = NULL,
        provider_result_json = NULL, error_code = NULL, error = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(page.revision_id, page.story_id, CONTINUITY_SCHEMA_VERSION, hash);
    db.prepare(`
      INSERT INTO story_memory_pages (page_id, story_id, content_hash, status, schema_version, updated_at)
      VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(page_id) DO UPDATE SET content_hash = excluded.content_hash, status = 'pending',
        schema_version = excluded.schema_version, summary = NULL, delta_json = NULL,
        error = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(page.id, page.story_id, hash, CONTINUITY_SCHEMA_VERSION);
    db.prepare('DELETE FROM continuity_search WHERE revision_id = ?').run(page.revision_id);
    db.prepare('DELETE FROM story_memory_search WHERE page_id = ?').run(page.id);
    try { db.prepare('DELETE FROM continuity_search_fts WHERE revision_id = ?').run(page.revision_id); } catch { /* fallback */ }
    try { db.prepare('DELETE FROM story_memory_fts WHERE page_id = ?').run(page.id); } catch { /* fallback */ }
    invalidateFrom(page.story_id, page.page_number);
    return { hash, page };
  }

  function addPageSpend(page, result) {
    const current = canonicalPage(page.id);
    if (!current || current.revision_id !== page.revision_id) return;
    const prompt = Number(result?.usage?.prompt_tokens) || 0;
    const completion = Number(result?.usage?.completion_tokens) || 0;
    const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : 0;
    db.prepare(`
      UPDATE story_pages SET continuity_model = COALESCE(?, continuity_model),
        continuity_prompt_tokens = COALESCE(continuity_prompt_tokens, 0) + ?,
        continuity_completion_tokens = COALESCE(continuity_completion_tokens, 0) + ?,
        continuity_cost_usd = COALESCE(continuity_cost_usd, 0) + ? WHERE id = ?
    `).run(result?.model || null, prompt, completion, cost, page.id);
  }

  function searchText(delta) {
    return [delta.summary,
      ...(delta.events || []).map((item) => item.text),
      ...(delta.goal_updates || []).map((item) => item.text || ''),
      ...(delta.thread_updates || []).map((item) => item.text || ''),
      ...(delta.world_fact_updates || []).map((item) => item.text || ''),
      ...(delta.arc_updates || []).map((item) => item.text || ''),
    ].filter(Boolean).join('\n');
  }

  function finishPage(page, hash, delta, result) {
    const indexed = searchText(delta);
    const providerResult = JSON.stringify({ model: result.model || null, usage: result.usage || null, billed_attempts: result.billed_attempts || 0 });
    db.exec('BEGIN');
    try {
      addPageSpend(page, result);
      db.prepare(`
        UPDATE continuity_deltas SET status = 'ready', schema_version = ?, content_hash = ?,
          summary = ?, delta_json = ?, provider_result_json = ?, spend_usd = ?, model = ?,
          prompt_tokens = ?, completion_tokens = ?, error_code = NULL, error = NULL,
          updated_at = CURRENT_TIMESTAMP WHERE revision_id = ?
      `).run(delta.schema_version || CONTINUITY_SCHEMA_VERSION, hash, delta.summary, JSON.stringify(delta),
        providerResult, typeof result.cost_usd === 'number' ? result.cost_usd : 0, result.model || null,
        result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null, page.revision_id);
      if (canonicalPage(page.id)?.revision_id === page.revision_id) {
        db.prepare(`
          UPDATE story_memory_pages SET status = 'ready', schema_version = ?, content_hash = ?,
            summary = ?, delta_json = ?, model = ?, prompt_tokens = ?, completion_tokens = ?,
            cost_usd = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE page_id = ?
        `).run(delta.schema_version || CONTINUITY_SCHEMA_VERSION, hash, delta.summary, JSON.stringify(delta),
          result.model || null, result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null,
          typeof result.cost_usd === 'number' ? result.cost_usd : 0, page.id);
      }
      db.prepare('INSERT OR REPLACE INTO continuity_search (revision_id, story_id, content) VALUES (?, ?, ?)')
        .run(page.revision_id, page.story_id, indexed);
      if (canonicalPage(page.id)?.revision_id === page.revision_id) {
        db.prepare('INSERT OR REPLACE INTO story_memory_search (page_id, story_id, content) VALUES (?, ?, ?)')
          .run(page.id, page.story_id, indexed);
      }
      try {
        db.prepare('DELETE FROM continuity_search_fts WHERE revision_id = ?').run(page.revision_id);
        db.prepare('INSERT INTO continuity_search_fts (revision_id, story_id, content) VALUES (?, ?, ?)').run(page.revision_id, page.story_id, indexed);
      } catch { /* fallback */ }
      try {
        if (canonicalPage(page.id)?.revision_id === page.revision_id) {
          db.prepare('DELETE FROM story_memory_fts WHERE page_id = ?').run(page.id);
          db.prepare('INSERT INTO story_memory_fts (page_id, story_id, content) VALUES (?, ?, ?)').run(page.id, page.story_id, indexed);
        }
      } catch { /* fallback */ }
      rebuildFrom(page.story_id, page.page_number);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return getDeltaByRevision(page.revision_id);
  }

  function failPage(page, hash, error, result = {}) {
    const message = text(error?.message || error, 1000) || 'Continuity extraction failed';
    db.exec('BEGIN');
    try {
      addPageSpend(page, result);
      db.prepare(`
        UPDATE continuity_deltas SET status = 'failed', schema_version = ?, content_hash = ?,
          provider_result_json = ?, spend_usd = ?, model = ?, prompt_tokens = ?, completion_tokens = ?,
          error_code = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE revision_id = ?
      `).run(CONTINUITY_SCHEMA_VERSION, hash,
        JSON.stringify({ model: result.model || null, usage: result.usage || null, billed_attempts: result.billed_attempts || 0 }),
        typeof result.cost_usd === 'number' ? result.cost_usd : 0, result.model || null,
        result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null,
        error?.code || 'EXTRACTION_FAILED', message, page.revision_id);
      if (canonicalPage(page.id)?.revision_id === page.revision_id) {
        db.prepare(`
          UPDATE story_memory_pages SET status = 'failed', schema_version = ?, content_hash = ?,
            model = ?, prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, error = ?,
            updated_at = CURRENT_TIMESTAMP WHERE page_id = ?
        `).run(CONTINUITY_SCHEMA_VERSION, hash, result.model || null,
          result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null,
          typeof result.cost_usd === 'number' ? result.cost_usd : 0, message, page.id);
      }
      db.prepare('DELETE FROM continuity_search WHERE revision_id = ?').run(page.revision_id);
      rebuildFrom(page.story_id, page.page_number);
      db.exec('COMMIT');
    } catch (writeError) { db.exec('ROLLBACK'); throw writeError; }
    return getDeltaByRevision(page.revision_id);
  }

  function getDeltaByRevision(revisionId) {
    return db.prepare(`
      SELECT delta.*, revision.page_id FROM continuity_deltas delta
      JOIN page_revisions revision ON revision.id = delta.revision_id WHERE delta.revision_id = ?
    `).get(revisionId);
  }

  function getPageMemory(pageId) {
    return db.prepare(`
      SELECT delta.*, page.id AS page_id FROM pages page
      JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id WHERE page.id = ?
    `).get(pageId);
  }

  function clear(storyId) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM continuity_projection_checkpoints WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM continuity_search WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM continuity_deltas WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM story_memory_search WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM story_memory_pages WHERE story_id = ?').run(storyId);
      try { db.prepare('DELETE FROM continuity_search_fts WHERE story_id = ?').run(storyId); } catch { /* fallback */ }
      try { db.prepare('DELETE FROM story_memory_fts WHERE story_id = ?').run(storyId); } catch { /* fallback */ }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function insertCorrection(story, input, { source = 'author' } = {}) {
    const allowed = ['scope', 'subject_id', 'field', 'value', 'reason', 'evidence'];
    assertObject(input, 'correction');
    const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
    if (unknown.length) schemaFailure('correction', `has unknown fields: ${unknown.join(', ')}`);
    if (!CORRECTION_SCOPES.has(input.scope)) schemaFailure('correction.scope', 'is invalid');
    const subjectId = input.subject_id === null || input.subject_id === undefined
      ? null : strictString(input.subject_id, 'correction.subject_id', { max: 100 });
    if (input.scope !== 'story' && !subjectId) schemaFailure('correction.subject_id', 'is required for this scope');
    const field = strictString(input.field, 'correction.field', { max: 100 });
    const serializedValue = JSON.stringify(input.value);
    if (input.value === undefined || serializedValue === undefined || serializedValue.length > 10000) schemaFailure('correction.value', 'must be a bounded JSON value');
    const reason = input.reason === null || input.reason === undefined ? null : strictString(input.reason, 'correction.reason', { max: 2000 });
    const evidence = input.evidence === undefined ? [] : input.evidence;
    if (!Array.isArray(evidence) || evidence.length > 20) schemaFailure('correction.evidence', 'must be an array of at most 20 citations');
    const checkedEvidence = evidence.map((item, index) => {
      const path = `correction.evidence[${index}]`;
      assertExactKeys(item, ['page_revision_id', 'quote'], path);
      const revisionId = strictString(item.page_revision_id, `${path}.page_revision_id`, { max: 100 });
      const owned = db.prepare(`
        SELECT story_page.page_number, revision.content FROM page_revisions revision
        JOIN story_pages story_page ON story_page.id = revision.page_id
        WHERE revision.id = ? AND story_page.story_id = ?
      `).get(revisionId, story.id);
      if (!owned) schemaFailure(`${path}.page_revision_id`, 'does not belong to this story');
      const quote = strictString(item.quote, `${path}.quote`, { max: 500 });
      const normalizedPage = String(owned.content || '').replace(/\s+/g, ' ').toLowerCase();
      const normalizedQuote = quote.replace(/\s+/g, ' ').toLowerCase();
      if (!normalizedPage.includes(normalizedQuote)) schemaFailure(`${path}.quote`, 'is not present in the cited page revision');
      return { page_revision_id: revisionId, quote };
    });
    const id = randomUUID();
    const correction = { schema_version: 1, field, value: input.value, reason, evidence: checkedEvidence, source };
    db.prepare(`
      INSERT INTO continuity_corrections (id, story_id, scope, subject_id, correction_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, story.id, input.scope, subjectId, JSON.stringify(correction));
    return db.prepare('SELECT * FROM continuity_corrections WHERE id = ?').get(id);
  }

  function impactTerms(row, before) {
    const correction = parseJson(row.correction_json, {});
    const values = [row.subject_id];
    if (row.scope === 'character') {
      const character = before.characters.find((item) => item.id === row.subject_id);
      values.push(character?.name, character?.current?.[correction.field]);
    } else {
      const collection = row.scope === 'goal' ? before.goals : row.scope === 'thread' ? before.threads : before.world_facts;
      const subject = collection?.find((item) => item.id === row.subject_id);
      values.push(subject?.text, subject?.[correction.field]);
    }
    return [...new Set(values.flatMap((value) => {
      if (typeof value === 'string') return [value.trim()];
      if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').map((item) => item.trim());
      return [];
    }).filter((value) => value.length >= 3))];
  }

  function analyzeImpact(story, correctionRow, beforeProjection) {
    const correction = parseJson(correctionRow.correction_json, {});
    let anchorPage = 0;
    for (const evidence of correction.evidence || []) {
      const row = db.prepare(`
        SELECT story_page.page_number FROM page_revisions revision
        JOIN story_pages story_page ON story_page.id = revision.page_id
        WHERE revision.id = ? AND story_page.story_id = ?
      `).get(evidence.page_revision_id, story.id);
      anchorPage = Math.max(anchorPage, Number(row?.page_number) || 0);
    }
    const terms = impactTerms(correctionRow, beforeProjection);
    db.prepare('DELETE FROM continuity_issues WHERE correction_id = ?').run(correctionRow.id);
    if (!terms.length) return [];
    const candidates = db.prepare(`
      SELECT story_page.id AS page_id, story_page.page_number, page.canonical_revision_id,
             page.display_revision_id, display.content AS display_content, delta.delta_json
      FROM story_pages story_page JOIN pages page ON page.id = story_page.id
      JOIN page_revisions display ON display.id = page.display_revision_id
      LEFT JOIN continuity_deltas delta ON delta.revision_id = page.canonical_revision_id
      WHERE story_page.story_id = ? AND story_page.page_number > ? ORDER BY story_page.page_number
    `).all(story.id, anchorPage);
    const insert = db.prepare(`
      INSERT INTO continuity_issues (id, story_id, correction_id, page_revision_id, status, detail_json)
      VALUES (?, ?, ?, ?, 'open', ?)
    `);
    for (const candidate of candidates) {
      const haystack = `${candidate.display_content || ''}\n${candidate.delta_json || ''}`.toLowerCase();
      const matched = terms.filter((term) => haystack.includes(term.toLowerCase()));
      if (!matched.length) continue;
      insert.run(randomUUID(), story.id, correctionRow.id, candidate.display_revision_id, JSON.stringify({
        schema_version: 1, page_id: candidate.page_id, page_number: candidate.page_number,
        canonical_revision_id: candidate.canonical_revision_id, matched_terms: matched,
        reason: 'Later displayed prose or extracted evidence mentions the corrected subject or its previous state.',
        suggested_edit: null,
      }));
    }
    return issueRows(story.id).filter((issue) => issue.correction_id === correctionRow.id);
  }

  function createCorrection(story, input) {
    const before = project(story);
    const row = insertCorrection(story, input);
    const issues = analyzeImpact(story, row, before);
    return { correction: { ...row, ...parseJson(row.correction_json, {}) }, issues, continuity: continuityView(story) };
  }

  function setIssueStatus(storyId, issueId, status) {
    if (!['open', 'acknowledged', 'resolved'].includes(status)) schemaFailure('issue.status', 'is invalid');
    const result = db.prepare(`
      UPDATE continuity_issues SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND story_id = ?
    `).run(status, issueId, storyId);
    return result.changes ? issueRows(storyId).find((issue) => issue.id === issueId) : null;
  }

  function saveOverrides(story, input) {
    const folded = project(story);
    const clean = sanitizeOverrides(input, folded.characters.map((item) => item.id),
      folded.goals.map((item) => item.id), folded.threads.map((item) => item.id));
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE stories SET continuity_overrides = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(clean), story.id);
      db.prepare(`DELETE FROM continuity_corrections WHERE story_id = ? AND json_extract(correction_json, '$.source') = 'compatibility-overrides'`).run(story.id);
      for (const [subjectId, update] of Object.entries(clean.characters)) {
        for (const [field, value] of Object.entries(update)) {
          insertCorrection(story, { scope: 'character', subject_id: subjectId, field, value, reason: null, evidence: [] }, { source: 'compatibility-overrides' });
        }
      }
      for (const [subjectId, update] of Object.entries(clean.goals)) insertCorrection(story, { scope: 'goal', subject_id: subjectId, field: 'status', value: update.status, reason: null, evidence: [] }, { source: 'compatibility-overrides' });
      for (const [subjectId, update] of Object.entries(clean.threads)) insertCorrection(story, { scope: 'thread', subject_id: subjectId, field: 'status', value: update.status, reason: null, evidence: [] }, { source: 'compatibility-overrides' });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return clean;
  }

  function templateReview(story) {
    ensureSnapshots(story);
    const review = [];
    if (story.world_id) {
      const current = db.prepare('SELECT * FROM worlds WHERE id = ?').get(story.world_id);
      const local = latestTemplate(story.id, 'world', story.world_id);
      if (current && local) {
        const snapshot = parseJson(local.snapshot_json, {});
        review.push({
          template_kind: 'world', source_template_id: current.id, snapshot_id: local.id,
          source_revision: local.source_revision,
          changes: TEMPLATE_FIELDS.world.filter((field) => (snapshot[field] ?? null) !== (current[field] ?? null))
            .map((field) => ({ field, from: snapshot[field] ?? null, to: current[field] ?? null })),
        });
      }
    }
    for (const entry of parseCastJson(story.characters)) {
      const current = db.prepare('SELECT * FROM characters WHERE id = ?').get(entry.id);
      const local = latestTemplate(story.id, 'character', entry.id);
      if (!current || !local) continue;
      const snapshot = parseJson(local.snapshot_json, {});
      review.push({
        template_kind: 'character', source_template_id: current.id, snapshot_id: local.id,
        source_revision: local.source_revision,
        changes: TEMPLATE_FIELDS.character.filter((field) => (snapshot[field] ?? null) !== (current[field] ?? null))
          .map((field) => ({ field, from: snapshot[field] ?? null, to: current[field] ?? null })),
      });
    }
    return review;
  }

  function importTemplateFields(story, kind, sourceId, fields) {
    if (!TEMPLATE_FIELDS[kind]) schemaFailure('template_kind', 'must be world or character');
    if (!Array.isArray(fields) || !fields.length) schemaFailure('fields', 'must explicitly select at least one field');
    const selected = [...new Set(fields)];
    if (selected.some((field) => !TEMPLATE_FIELDS[kind].includes(field))) schemaFailure('fields', 'contains a field that cannot be imported');
    if (kind === 'world' && story.world_id !== sourceId) schemaFailure('source_template_id', 'is not this story world');
    if (kind === 'character' && !parseCastJson(story.characters).some((entry) => entry.id === sourceId)) schemaFailure('source_template_id', 'is not in this story cast');
    ensureSnapshots(story);
    const source = db.prepare(`SELECT * FROM ${kind === 'world' ? 'worlds' : 'characters'} WHERE id = ?`).get(sourceId);
    const prior = latestTemplate(story.id, kind, sourceId);
    if (!source || !prior) schemaFailure('source_template_id', 'does not exist');
    const next = parseJson(prior.snapshot_json, {});
    for (const field of selected) next[field] = source[field] ?? null;
    const row = insertTemplateSnapshot(story.id, kind, sourceId, source.updated_at, next);
    if (kind === 'character') {
      const assignments = selected.map((field) => `${field} = ?`).join(', ');
      db.prepare(`UPDATE story_character_snapshots SET ${assignments}, source_updated_at = ? WHERE story_id = ? AND character_id = ?`)
        .run(...selected.map((field) => source[field] ?? null), source.updated_at, story.id, sourceId);
    }
    return { ...row, snapshot: next, imported_fields: selected };
  }

  function rebuild(storyId) {
    db.exec('BEGIN');
    try { const result = rebuildFrom(storyId, 1); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function searchRelevant(storyId, query, { excludePageIds = [], limit = 6 } = {}) {
    const tokens = [...new Set(String(query || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])].slice(0, 12);
    if (!tokens.length) return [];
    const excluded = new Set(excludePageIds || []);
    const boundedLimit = Math.min(Math.max(Number(limit) || 6, 1), 20);
    let rows = [];
    try {
      const match = tokens.map((token) => `${token.replace(/[^a-z0-9]/g, '')}*`).filter(Boolean).join(' OR ');
      rows = db.prepare(`
        SELECT f.revision_id, f.content, revision.page_id, story_page.page_number
        FROM continuity_search_fts f JOIN page_revisions revision ON revision.id = f.revision_id
        JOIN pages page ON page.canonical_revision_id = f.revision_id
        JOIN story_pages story_page ON story_page.id = page.id
        WHERE f.story_id = ? AND continuity_search_fts MATCH ?
        ORDER BY bm25(continuity_search_fts) LIMIT ?
      `).all(storyId, match, Math.max(boundedLimit * 2, 12));
    } catch {
      const clauses = tokens.map(() => 'LOWER(search.content) LIKE ?').join(' OR ');
      rows = db.prepare(`
        SELECT search.revision_id, search.content, revision.page_id, story_page.page_number
        FROM continuity_search search JOIN page_revisions revision ON revision.id = search.revision_id
        JOIN pages page ON page.canonical_revision_id = search.revision_id
        JOIN story_pages story_page ON story_page.id = page.id
        WHERE search.story_id = ? AND (${clauses}) LIMIT ?
      `).all(storyId, ...tokens.map((token) => `%${token}%`), Math.max(boundedLimit * 2, 12));
    }
    return rows.filter((row) => !excluded.has(row.page_id)).slice(0, boundedLimit).map((row) => ({
      page_id: row.page_id, page_revision_id: row.revision_id,
      page_number: row.page_number, text: row.content.slice(0, 2400),
    }));
  }

  return {
    contentHash, sanitizeDelta, ensureSnapshots, snapshots, worldSnapshot,
    templateReview, importTemplateFields, memoryRows, project, coverage,
    coverageSummary, continuityView, pageForExtraction, beginPage, finishPage,
    failPage, getPageMemory, getDeltaByRevision, clear, saveOverrides,
    createCorrection, setIssueStatus, issueRows, rebuild, searchRelevant,
  };
}

module.exports = {
  CONTINUITY_SCHEMA_VERSION, ContinuitySchemaError, createContinuityStore,
  validateContinuityDeltaV2, sanitizeDelta, applyDelta, emptyLedger,
  contentHash, stableId,
};
