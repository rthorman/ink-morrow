'use strict';

const { randomUUID } = require('node:crypto');

const LIMITS = Object.freeze({ cast: 24, facts: 128, branches: 40, prose: 24000, input: 4000 });
const GENRES = ['drama', 'mystery', 'exploration', 'cozy'];
const FACT_KINDS = ['fact', 'commitment', 'relationship', 'goal', 'resource'];

function fail(message, code = 'INVALID_STORY_INPUT', statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function text(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) {
    fail(`${label} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters.`);
  }
  return value.trim();
}

function choice(value, values, fallback, label) {
  const result = value === undefined ? fallback : value;
  if (!values.includes(result)) fail(`${label} is not supported.`);
  return result;
}

function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(`${label} contains an unsupported field.`);
}

function normalizeCast(input = []) {
  if (!Array.isArray(input) || input.length > LIMITS.cast) fail(`Choose at most ${LIMITS.cast} cast members.`);
  const cast = input.map((entry) => {
    keys(entry, ['id', 'name', 'description', 'motive'], 'Cast member');
    const id = entry.id === undefined ? randomUUID() : text(entry.id, 'Character ID', 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Character ID contains invalid characters.');
    return { id, name: text(entry.name, 'Character name', 200), description: text(entry.description, 'Description', 2000, { optional: true }), motive: text(entry.motive, 'Motive', 1000, { optional: true }) };
  });
  if (new Set(cast.map((entry) => entry.id)).size !== cast.length) fail('Character IDs must be unique.');
  return cast;
}

function normalizeFact(value, castIds, { evidenceBeatId = null } = {}) {
  keys(value, ['id', 'kind', 'text', 'visibility', 'known_by', 'status', 'actor_id', 'value', 'evidence_beat_id'], 'Story fact');
  const id = text(value.id, 'Fact ID', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Fact ID contains invalid characters.');
  const knownBy = value.known_by === undefined ? [] : value.known_by;
  if (!Array.isArray(knownBy) || knownBy.length > LIMITS.cast || knownBy.some((id) => !castIds.includes(id))) fail('Knowledge must name members of this cast.');
  const actorId = value.actor_id ?? null;
  if (actorId !== null && !castIds.includes(actorId)) fail('The fact concerns an unknown cast member.');
  const numeric = value.value ?? null;
  if (numeric !== null && (!Number.isFinite(numeric) || Math.abs(numeric) > 1000000)) fail('Resource value is outside the supported range.');
  return {
    id, kind: choice(value.kind, FACT_KINDS, 'fact', 'Fact kind'), text: text(value.text, 'Fact', 1500),
    visibility: choice(value.visibility, ['public', 'secret'], 'public', 'Fact visibility'),
    known_by: [...new Set(knownBy)], status: choice(value.status, ['active', 'resolved'], 'active', 'Fact status'),
    actor_id: actorId, value: numeric, evidence_beat_id: evidenceBeatId,
  };
}

function initialState(input) {
  const cast = normalizeCast(input.cast);
  const factsInput = input.facts ?? [];
  if (!Array.isArray(factsInput) || factsInput.length > LIMITS.facts) fail(`A story supports at most ${LIMITS.facts} durable facts.`);
  const facts = factsInput.map((fact) => normalizeFact(fact, cast.map((entry) => entry.id)));
  if (new Set(facts.map((fact) => fact.id)).size !== facts.length) fail('Fact IDs must be unique.');
  return {
    version: 1, cast, facts, control: { character_id: null },
    pacing: choice(input.pacing, ['reflective', 'balanced', 'brisk'], 'balanced', 'Pacing'),
    consequences: choice(input.consequences, ['gentle', 'dramatic'], 'gentle', 'Consequences'),
    boundaries: text(input.boundaries, 'Boundaries', 2000, { optional: true }),
    focus: '', episode: { number: 1, title: 'The beginning', status: 'active', summary: '' }, scene_history: [],
  };
}

function publicState(state) {
  return { ...state, facts: state.facts.filter((fact) => fact.visibility === 'public') };
}

function validateIntent(input, state) {
  keys(input, ['kind', 'text'], 'Story direction');
  const kind = choice(input.kind, ['follow', 'steer', 'act', 'say', 'ask'], 'follow', 'Participation');
  const value = text(input.text, 'Direction', LIMITS.input, { optional: kind === 'follow' });
  if (['act', 'say'].includes(kind) && !state.control.character_id) fail('Take control of a character before acting or speaking as them.');
  if (kind === 'follow' && value) fail('Use Steer to give a narrative direction.');
  return { kind, text: value, character_id: ['act', 'say'].includes(kind) ? state.control.character_id : null };
}

// Effects are narrow, evidenced proposals. They cannot hand off control, change
// the cast, rewrite hidden truth, or make a future plan a completed event.
function applyEffects(original, effects, { prose, input, beatId }) {
  if (!Array.isArray(effects) || effects.length > 12) fail('A scene may have at most twelve state changes.', 'INVALID_STORY_REPLY', 502);
  const state = structuredClone(original);
  const changes = [];
  for (const effect of effects) {
    keys(effect, ['op', 'fact', 'id', 'evidence', 'known_by', 'amount'], 'Story effect');
    const evidence = text(effect.evidence, 'Effect evidence', 1000);
    if (!prose.includes(evidence) && !input.text.includes(evidence)) fail('A state change has no direct evidence in this beat.', 'INVALID_STORY_REPLY', 502);
    if (effect.op === 'remember') {
      const fact = normalizeFact(effect.fact, state.cast.map((entry) => entry.id), { evidenceBeatId: beatId });
      if (state.facts.some((entry) => entry.id === fact.id)) fail('A new fact cannot overwrite existing truth.', 'INVALID_STORY_REPLY', 502);
      if (fact.kind === 'commitment' && fact.actor_id === state.control.character_id && state.control.character_id && !input.text.includes(evidence)) {
        fail('The narrator cannot invent a commitment for an inhabited character.', 'OWNED_CHARACTER_BOUNDARY', 502);
      }
      state.facts.push(fact);
      changes.push({ op: 'remember', fact });
    } else {
      const fact = state.facts.find((entry) => entry.id === effect.id);
      if (!fact) fail('The change references an unknown fact.', 'INVALID_STORY_REPLY', 502);
      if (effect.op === 'resolve') fact.status = 'resolved';
      else if (effect.op === 'reveal') {
        if (!Array.isArray(effect.known_by) || effect.known_by.some((id) => !state.cast.some((entry) => entry.id === id))) fail('A revelation references unknown characters.');
        fact.visibility = 'public';
        fact.known_by = [...new Set([...fact.known_by, ...effect.known_by])];
      } else if (effect.op === 'adjust') {
        if (fact.kind !== 'resource' || fact.value === null || !Number.isFinite(effect.amount) || Math.abs(effect.amount) > 10000 || Math.abs(fact.value + effect.amount) > 1000000) fail('Invalid resource adjustment.', 'INVALID_STORY_REPLY', 502);
        fact.value += effect.amount;
      } else fail('Unsupported story effect.', 'INVALID_STORY_REPLY', 502);
      fact.evidence_beat_id = beatId;
      changes.push({ op: effect.op, fact: structuredClone(fact) });
    }
  }
  if (state.facts.length > LIMITS.facts) fail('The story fact limit has been reached. Resolve or consolidate facts with a correction.', 'STORY_STATE_FULL', 409);
  return { state, changes };
}

module.exports = { LIMITS, GENRES, fail, object, text, choice, keys, normalizeFact, initialState, publicState, validateIntent, applyEffects };
