'use strict';

const { randomUUID } = require('node:crypto');
const { compactFacts } = require('./memory');
const { STYLES, normalizeChallenges, publicChallenges } = require('./resistance');
const { FOURTH_WALL_MODES } = require('./fourth-wall');
const { makeEpisode } = require('./episodes');
const { QUALITY_MODES } = require('./quality');

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

function initialState(input) {
  const cast = normalizeCast(input.cast);
  const factsInput = input.facts ?? [];
  if (!Array.isArray(factsInput) || factsInput.length > LIMITS.facts) fail(`A story supports at most ${LIMITS.facts} durable facts.`);
  const facts = factsInput.map((fact) => normalizeFact(fact, cast.map((entry) => entry.id)));
  if (new Set(facts.map((fact) => fact.id)).size !== facts.length) fail('Fact IDs must be unique.');
  return {
    version: 1, cast, facts, illustrations: [], control: { character_id: null },
    play_style: choice(input.play_style, STYLES, 'story-shaping', 'Play style'),
    fourth_wall: choice(input.fourth_wall, FOURTH_WALL_MODES, 'never', 'Fourth-wall setting'), last_fourth_wall_scene: null,
    quality_mode: choice(input.quality_mode, QUALITY_MODES, 'off', 'Consistency quality mode'),
    challenges: normalizeChallenges(input.challenges, cast.map((person) => person.id), { keys, text, fail }), adjudications: [],
    pacing: choice(input.pacing, ['reflective', 'balanced', 'brisk'], 'balanced', 'Pacing'),
    consequences: choice(input.consequences, ['gentle', 'dramatic'], 'gentle', 'Consequences'),
    boundaries: text(input.boundaries, 'Boundaries', 2000, { optional: true }),
    voice: text(input.voice, 'Narration voice', 1500, { optional: true }),
    focus: '', episode: makeEpisode({ question: text(input.episode_question, 'Episode question', 500, { optional: true }) }, facts), scene_history: [], scene_count: 0,
  };
}

function publicState(state) {
  return { ...state, play_style: state.play_style || 'story-shaping', challenges: publicChallenges(state),
    adjudications: (state.adjudications || []).map(({ basis: _basis, ...entry }) => entry),
    cast: state.cast.map(({ motive: _motive, ...character }) => character), facts: state.facts.filter((fact) => fact.visibility === 'public'), scene_history: [] };
}

function validateIntent(input, state) {
  keys(input, ['kind', 'text', 'challenge_id', 'approach_id', 'direction_scope'], 'Story direction');
  const kind = choice(input.kind, ['follow', 'steer', 'act', 'say', 'ask'], 'follow', 'Participation');
  const value = text(input.text, 'Direction', LIMITS.input, { optional: kind === 'follow' });
  if (['act', 'say'].includes(kind) && !state.control.character_id) fail('Take control of a character before acting or speaking as them.');
  if (kind === 'follow' && value) fail('Use Steer to give a narrative direction.');
  if (input.direction_scope !== undefined && kind !== 'steer') fail('Only Steer can set an ongoing focus.');
  const scope = kind === 'steer' ? choice(input.direction_scope, ['moment', 'ongoing'], 'moment', 'Direction scope') : null;
  if (input.challenge_id !== undefined || input.approach_id !== undefined) {
    if (kind !== 'steer' && kind !== 'act') fail('Use a direction or explicit character action for a challenge.');
    text(input.challenge_id, 'Challenge', 80); text(input.approach_id, 'Approach', 80);
  }
  return { kind, text: value, character_id: ['act', 'say'].includes(kind) ? state.control.character_id : null,
    ...(scope ? { direction_scope: scope } : {}),
    ...(input.challenge_id ? { challenge_id: input.challenge_id, approach_id: input.approach_id } : {}) };
}

// Effects are narrow, evidenced proposals. Introducing a named person is not
// a control handoff. Plans never become completed events just by being selected.
function applyEffects(original, effects, { prose, input, beatId, lookup = () => null }) {
  if (!Array.isArray(effects) || effects.length > 12) fail('A scene may have at most twelve state changes.', 'INVALID_STORY_REPLY', 502);
  const state = structuredClone(original);
  const changes = [];
  for (const effect of effects) {
    keys(effect, ['op', 'fact', 'id', 'evidence', 'known_by', 'amount', 'character', 'text'], 'Story effect');
    const evidence = text(effect.evidence, 'Effect evidence', 1000);
    if (!prose.includes(evidence) && !input.text.includes(evidence)) fail('A state change has no direct evidence in this beat.', 'INVALID_STORY_REPLY', 502);
    if (effect.op === 'introduce') {
      const [character] = normalizeCast([effect.character]);
      if (state.cast.length >= LIMITS.cast || state.cast.some((entry) => entry.id === character.id || entry.name.toLowerCase() === character.name.toLowerCase())) fail('A cast introduction duplicates a person or exceeds the cast limit.', 'INVALID_STORY_REPLY', 502);
      if (!prose.includes(character.name)) fail('A new cast member must appear by name in the prose.', 'INVALID_STORY_REPLY', 502);
      state.cast.push(character);
      changes.push({ op: 'introduce', character: { id: character.id, name: character.name, description: character.description } });
    } else if (effect.op === 'remember') {
      const fact = normalizeFact(effect.fact, state.cast.map((entry) => entry.id), { evidenceBeatId: beatId });
      if (state.facts.some((entry) => entry.id === fact.id) || lookup(fact.id, true)) fail('A new fact cannot overwrite existing truth.', 'INVALID_STORY_REPLY', 502);
      if (['commitment', 'relationship'].includes(fact.kind) && fact.actor_id === state.control.character_id && state.control.character_id && !input.text.includes(evidence)) {
        fail('The narrator cannot invent a commitment or relationship for an inhabited character.', 'OWNED_CHARACTER_BOUNDARY', 502);
      }
      state.facts.push(fact);
      changes.push({ op: 'remember', fact });
    } else {
      let fact = state.facts.find((entry) => entry.id === effect.id);
      if (!fact) { const recalled = lookup(effect.id); if (recalled) { fact = structuredClone(recalled); state.facts.push(fact); } }
      if (!fact) fail('The change references an unknown fact.', 'INVALID_STORY_REPLY', 502);
      const priorEvidence = fact.evidence_beat_id === beatId
        ? changes.find((change) => change.fact?.id === fact.id)?.prior_evidence_beat_id || null
        : fact.evidence_beat_id;
      if (effect.op === 'develop') {
        if (fact.kind !== 'relationship') fail('Only an existing relationship can develop; established world truth cannot be rewritten.', 'INVALID_STORY_REPLY', 502);
        if (fact.actor_id === state.control.character_id && state.control.character_id && !input.text.includes(evidence)) fail('The narrator cannot change an inhabited character\'s feelings or expectations.', 'OWNED_CHARACTER_BOUNDARY', 502);
        fact.text = text(effect.text, 'Relationship development', 1500);
      } else if (effect.op === 'resolve') fact.status = 'resolved';
      else if (effect.op === 'reveal') {
        if (!Array.isArray(effect.known_by) || effect.known_by.some((id) => !state.cast.some((entry) => entry.id === id))) fail('A revelation references unknown characters.');
        fact.visibility = 'public';
        fact.known_by = [...new Set([...fact.known_by, ...effect.known_by])];
      } else if (effect.op === 'adjust') {
        if (fact.kind !== 'resource' || fact.value === null || !Number.isFinite(effect.amount) || Math.abs(effect.amount) > 10000 || Math.abs(fact.value + effect.amount) > 1000000) fail('Invalid resource adjustment.', 'INVALID_STORY_REPLY', 502);
        fact.value += effect.amount;
      } else fail('Unsupported story effect.', 'INVALID_STORY_REPLY', 502);
      fact.evidence_beat_id = beatId;
      changes.push({ op: effect.op, fact: structuredClone(fact), prior_evidence_beat_id: priorEvidence });
    }
  }
  compactFacts(state, LIMITS.facts);
  return { state, changes };
}

module.exports = { LIMITS, GENRES, RELATIONSHIP_FACETS, fail, object, text, choice, keys, normalizeCast, normalizeFact, initialState, publicState, validateIntent, applyEffects };
