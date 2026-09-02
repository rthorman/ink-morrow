'use strict';

const { randomUUID } = require('node:crypto');
const { optionalText, asString } = require('../../core/validation');

const CATGIRL_CANON = Object.freeze({
  entity_kind: 'catgirl',
  definition: 'An unmistakably adult human woman with exactly one natural feline tail and one pair of natural feline ears.',
});

const ENUMS = Object.freeze({
  diction: ['plain', 'balanced', 'ornate'],
  sentence_rhythm: ['clipped', 'varied', 'flowing'],
  narrative_distance: ['intimate', 'flexible', 'observational'],
  figurative_language: ['restrained', 'balanced', 'abundant'],
  description_density: ['lean', 'balanced', 'immersive'],
  dialogue_tendency: ['sparse', 'balanced', 'dialogue-led'],
  exposition_style: ['explicit', 'balanced', 'implicit'],
  humor: ['none', 'restrained', 'dry', 'warm', 'dark', 'playful'],
  scene_tempo: ['contemplative', 'measured', 'brisk'],
  progress_appetite: ['linger', 'develop', 'advance'],
  tension_tolerance: ['low', 'medium', 'high'],
  aftermath_dwell: ['brief', 'balanced', 'patient'],
});

const DEFAULTS = Object.freeze({
  diction: 'balanced', sentence_rhythm: 'varied', narrative_distance: 'flexible',
  figurative_language: 'balanced', description_density: 'balanced', dialogue_tendency: 'balanced',
  exposition_style: 'balanced', humor: 'restrained', scene_tempo: 'measured',
  progress_appetite: 'develop', tension_tolerance: 'medium', aftermath_dwell: 'balanced',
});

const FOCUS_AREAS = Object.freeze([
  'interiority', 'relationships', 'dialogue', 'action', 'sensory-detail', 'setting',
  'world-systems', 'mystery', 'theme', 'humor', 'consequences',
]);

const TEXT_FIELDS = Object.freeze([
  'description', 'personality', 'appearance', 'background', 'feline_traits',
  'signature_habits', 'avoidances', 'image_prompt',
]);

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function publicScribe(row) {
  return row ? { ...row, focus_areas: parseJson(row.focus_areas, []) } : null;
}

function snapshotOf(row) {
  const result = {
    entity_kind: CATGIRL_CANON.entity_kind,
    name: row.name,
  };
  for (const key of TEXT_FIELDS) result[key] = row[key] || null;
  for (const key of Object.keys(ENUMS)) result[key] = row[key];
  result.focus_areas = Array.isArray(row.focus_areas) ? row.focus_areas : parseJson(row.focus_areas, []);
  return result;
}

function createScribeStore(db) {
  const getRaw = (id) => db.prepare('SELECT * FROM scribes WHERE id = ?').get(id);
  const getScribe = (id) => publicScribe(getRaw(id));
  const listScribes = () => db.prepare('SELECT * FROM scribes ORDER BY updated_at DESC, name').all().map(publicScribe);

  function validatePayload(body, { partial = false, existing = null } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Scribe payload must be an object' };
    if (body.entity_kind !== undefined && asString(body.entity_kind).toLowerCase() !== 'catgirl') {
      return { error: 'Every Scribe is a catgirl by Ink Morrow canon.' };
    }
    if (body.species !== undefined && asString(body.species).toLowerCase() !== 'catgirl') {
      return { error: 'A Scribe cannot be changed into another species.' };
    }
    const name = body.name === undefined
      ? (partial ? existing?.name : null)
      : optionalText(body.name, { max: 200 });
    if (!name) return { error: '"name" is required' };

    const payload = { name, entity_kind: 'catgirl' };
    for (const key of TEXT_FIELDS) {
      const max = key === 'image_prompt' ? 3000 : 10000;
      const value = body[key] === undefined
        ? (partial ? existing?.[key] ?? null : null)
        : optionalText(body[key], { max });
      if (value === undefined) return { error: `"${key}" must be text` };
      payload[key] = value;
    }
    for (const [key, allowed] of Object.entries(ENUMS)) {
      const value = body[key] === undefined
        ? (partial ? existing?.[key] : DEFAULTS[key])
        : asString(body[key]);
      if (!allowed.includes(value)) return { error: `"${key}" must be one of: ${allowed.join(', ')}` };
      payload[key] = value;
    }
    const rawFocus = body.focus_areas === undefined
      ? (partial ? existing?.focus_areas : [])
      : body.focus_areas;
    if (!Array.isArray(rawFocus) || rawFocus.some((value) => !FOCUS_AREAS.includes(value))) {
      return { error: `"focus_areas" must contain only: ${FOCUS_AREAS.join(', ')}` };
    }
    payload.focus_areas = [...new Set(rawFocus)].slice(0, 8);
    return payload;
  }

  function insertRevisionInTransaction(scribe) {
    db.prepare(`
      INSERT INTO scribe_revisions (id, scribe_id, revision_number, snapshot_json)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), scribe.id, scribe.revision_number, JSON.stringify(snapshotOf(scribe)));
  }

  function createScribe(payload) {
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO scribes (
          id, entity_kind, name, description, personality, appearance, background, feline_traits,
          diction, sentence_rhythm, narrative_distance, figurative_language, description_density,
          dialogue_tendency, exposition_style, humor, scene_tempo, progress_appetite,
          tension_tolerance, aftermath_dwell, focus_areas, signature_habits, avoidances, image_prompt
        ) VALUES (?, 'catgirl', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, payload.name, payload.description, payload.personality, payload.appearance,
        payload.background, payload.feline_traits, payload.diction, payload.sentence_rhythm,
        payload.narrative_distance, payload.figurative_language, payload.description_density,
        payload.dialogue_tendency, payload.exposition_style, payload.humor, payload.scene_tempo,
        payload.progress_appetite, payload.tension_tolerance, payload.aftermath_dwell,
        JSON.stringify(payload.focus_areas), payload.signature_habits, payload.avoidances, payload.image_prompt);
      insertRevisionInTransaction(getRaw(id));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return getScribe(id);
  }

  function updateScribe(id, payload) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE scribes SET
          name = ?, description = ?, personality = ?, appearance = ?, background = ?, feline_traits = ?,
          diction = ?, sentence_rhythm = ?, narrative_distance = ?, figurative_language = ?,
          description_density = ?, dialogue_tendency = ?, exposition_style = ?, humor = ?,
          scene_tempo = ?, progress_appetite = ?, tension_tolerance = ?, aftermath_dwell = ?,
          focus_areas = ?, signature_habits = ?, avoidances = ?, image_prompt = ?,
          revision_number = revision_number + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(payload.name, payload.description, payload.personality, payload.appearance,
        payload.background, payload.feline_traits, payload.diction, payload.sentence_rhythm,
        payload.narrative_distance, payload.figurative_language, payload.description_density,
        payload.dialogue_tendency, payload.exposition_style, payload.humor, payload.scene_tempo,
        payload.progress_appetite, payload.tension_tolerance, payload.aftermath_dwell,
        JSON.stringify(payload.focus_areas), payload.signature_habits, payload.avoidances,
        payload.image_prompt, id);
      insertRevisionInTransaction(getRaw(id));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return getScribe(id);
  }

  function revisionsFor(id) {
    return db.prepare(`SELECT * FROM scribe_revisions WHERE scribe_id = ? ORDER BY revision_number DESC`).all(id)
      .map((row) => ({ ...row, snapshot: parseJson(row.snapshot_json, {}) }));
  }

  function deleteScribe(id) {
    db.prepare('DELETE FROM scribes WHERE id = ?').run(id);
  }

  function latestBinding(storyId) {
    return db.prepare(`
      SELECT * FROM story_scribe_bindings WHERE story_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(storyId) || null;
  }

  function forStory(storyId) {
    const row = latestBinding(storyId);
    if (!row || row.action === 'cleared') return null;
    return {
      binding_id: row.id,
      source_scribe_id: row.source_scribe_id,
      source_revision_number: row.source_revision_number,
      bound_at: row.created_at,
      ...parseJson(row.snapshot_json, {}),
    };
  }

  function bindStoryInTransaction(storyId, scribeId) {
    const current = forStory(storyId);
    if (!scribeId) {
      if (!current) return null;
      db.prepare(`
        INSERT INTO story_scribe_bindings (id, story_id, action) VALUES (?, ?, 'cleared')
      `).run(randomUUID(), storyId);
      return null;
    }
    const scribe = getScribe(scribeId);
    if (!scribe) {
      const error = new Error('scribe_id does not reference an existing Scribe');
      error.statusCode = 400;
      throw error;
    }
    if (current?.source_scribe_id === scribeId && current.source_revision_number === scribe.revision_number) return current;
    const id = randomUUID();
    db.prepare(`
      INSERT INTO story_scribe_bindings
        (id, story_id, action, source_scribe_id, source_revision_number, snapshot_json)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run(id, storyId, scribe.id, scribe.revision_number, JSON.stringify(snapshotOf(scribe)));
    return forStory(storyId);
  }

  function setImageDeleted(id) {
    db.prepare(`
      UPDATE scribes SET image_status = 'deleted', image_media_type = NULL,
        image_cost_usd = NULL, image_updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  }

  return {
    getScribe, listScribes, createScribe, updateScribe, deleteScribe, revisionsFor,
    validatePayload, latestBinding, forStory, bindStoryInTransaction, setImageDeleted,
  };
}

module.exports = { createScribeStore, CATGIRL_CANON, ENUMS, DEFAULTS, FOCUS_AREAS, snapshotOf };
