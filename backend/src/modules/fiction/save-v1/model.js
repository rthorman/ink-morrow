'use strict';

const { randomUUID } = require('node:crypto');

const LIMITS = Object.freeze({ cast: 24, facts: 128, branches: 40, prose: 24000, input: 4000 });
const GENRES = ['drama', 'mystery', 'exploration', 'cozy'];
const FACT_KINDS = ['fact', 'commitment', 'relationship', 'goal', 'resource'];
const RELATIONSHIP_FACETS = ['general', 'affection', 'trust', 'cooperation', 'expectation'];

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
  keys(value, ['id', 'kind', 'text', 'visibility', 'known_by', 'status', 'actor_id', 'value', 'evidence_beat_id', 'facet', 'toward_id'], 'Story fact');
  const id = text(value.id, 'Fact ID', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Fact ID contains invalid characters.');
  const knownBy = value.known_by === undefined ? [] : value.known_by;
  if (!Array.isArray(knownBy) || knownBy.length > LIMITS.cast || knownBy.some((id) => !castIds.includes(id))) fail('Knowledge must name members of this cast.');
  const actorId = value.actor_id ?? null;
  if (actorId !== null && !castIds.includes(actorId)) fail('The fact concerns an unknown cast member.');
  const numeric = value.value ?? null;
  if (numeric !== null && (!Number.isFinite(numeric) || Math.abs(numeric) > 1000000)) fail('Resource value is outside the supported range.');
  const kind = choice(value.kind, FACT_KINDS, 'fact', 'Fact kind');
  let relationship = {};
  if (kind === 'relationship') {
    const facet = choice(value.facet, RELATIONSHIP_FACETS, 'general', 'Relationship aspect');
    const towardId = value.toward_id ?? null;
    if (towardId !== null && (!castIds.includes(towardId) || towardId === actorId)) fail('A relationship must concern another known cast member.');
    if (facet !== 'general' && (!actorId || (facet !== 'expectation' && !towardId))) fail('Name whose relationship this is and who it concerns.');
    if (numeric !== null) fail('Relationships use descriptions, not numeric meters.');
    relationship = { facet, toward_id: towardId };
  } else if (value.facet !== undefined || value.toward_id !== undefined) fail('Only relationships have an aspect or target.');
  return {
    id, kind, text: text(value.text, 'Fact', 1500), ...relationship,
    visibility: choice(value.visibility, ['public', 'secret'], 'public', 'Fact visibility'),
    known_by: [...new Set(knownBy)], status: choice(value.status, ['active', 'resolved'], 'active', 'Fact status'),
    actor_id: actorId, value: numeric, evidence_beat_id: evidenceBeatId,
  };
}

module.exports = { keys, text, choice, fail, normalizeCast, normalizeFact, GENRES };
