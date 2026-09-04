'use strict';

const { createHash } = require('node:crypto');

// These explicit challenges are a bounded rules surface, not a claim that all
// free-form NPC dialogue has become mechanically decidable. Model prose cannot
// edit challenges or authoritative decisions.
const STYLES = ['story-shaping', 'living-world'];
function normalizeChallenges(input, castIds, { keys, text, fail }) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 12) fail('A story supports at most twelve structured challenges.');
  const id = (value) => { const result = text(value, 'Challenge identifier', 80); if (!/^[a-zA-Z0-9_-]+$/.test(result)) fail('Invalid challenge identifier.'); return result; };
  const challenges = input.map((entry) => {
    keys(entry, ['id', 'label', 'actor_id', 'motive', 'success', 'refusal', 'flexible', 'approaches'], 'Challenge');
    if (!castIds.includes(entry.actor_id)) fail('A challenge must concern a member of the cast.');
    if (typeof entry.flexible !== 'boolean') fail('Challenge flexibility must be explicit.');
    if (!Array.isArray(entry.approaches) || !entry.approaches.length || entry.approaches.length > 6) fail('Choose one to six approaches.');
    const approaches = entry.approaches.map((approach) => {
      keys(approach, ['id', 'label', 'requires'], 'Approach');
      if (!Array.isArray(approach.requires) || approach.requires.length > 6) fail('An approach supports at most six requirements.');
      const requires = approach.requires.map((requirement) => {
        keys(requirement, ['fact_id', 'status', 'known_by', 'minimum'], 'Requirement');
        if (!['active', 'resolved', 'any'].includes(requirement.status)) fail('Invalid required fact status.');
        if (requirement.known_by !== null && !castIds.includes(requirement.known_by)) fail('Unknown required knowledge.');
        if (requirement.minimum !== null && (!Number.isFinite(requirement.minimum) || Math.abs(requirement.minimum) > 1000000)) fail('Invalid required resource.');
        return { fact_id: id(requirement.fact_id), status: requirement.status, known_by: requirement.known_by, minimum: requirement.minimum };
      });
      return { id: id(approach.id), label: text(approach.label, 'Approach', 200), requires };
    });
    if (new Set(approaches.map((a) => a.id)).size !== approaches.length) fail('Approach identifiers must be unique.');
    return { id: id(entry.id), label: text(entry.label, 'Challenge', 200), actor_id: entry.actor_id,
      motive: text(entry.motive, 'Private challenge motive', 800), success: text(entry.success, 'Successful outcome', 800),
      refusal: text(entry.refusal, 'Refusal', 800), flexible: entry.flexible, approaches };
  });
  if (new Set(challenges.map((entry) => entry.id)).size !== challenges.length) fail('Challenge identifiers must be unique.');
  return challenges;
}

function adjudicate(state, intent, lookup, fail) {
  if (!intent.challenge_id) return null;
  const challenge = (state.challenges || []).find((entry) => entry.id === intent.challenge_id);
  const approach = challenge?.approaches.find((entry) => entry.id === intent.approach_id);
  if (!approach) fail('Select a known challenge and approach.');
  const previous = (state.adjudications || []).find((entry) => entry.challenge_id === challenge.id);
  if (previous?.outcome === 'granted') { const decision = { ...previous }; delete decision.beat_id; return decision; }
  const grounds = approach.requires.map((requirement) => {
    const fact = lookup(requirement.fact_id);
    return { requirement, fact: fact || null, met: Boolean(fact && fact.visibility === 'public'
      && (requirement.status === 'any' || fact.status === requirement.status)
      && (requirement.known_by === null || fact.known_by.includes(requirement.known_by))
      && (requirement.minimum === null || (fact.kind === 'resource' && fact.value !== null && fact.value >= requirement.minimum))) };
  });
  // An empty requirement list is a plain appeal, not a free permission token.
  const sufficient = grounds.length > 0 && grounds.every((entry) => entry.met);
  const granted = sufficient || ((state.play_style || 'story-shaping') === 'story-shaping' && challenge.flexible);
  const stableGrounds = grounds.map(({ fact, ...entry }) => {
    if (!fact) return { ...entry, fact: null };
    const content = { ...fact }; delete content.evidence_beat_id;
    return { ...entry, fact: content };
  });
  const basis = createHash('sha256').update(JSON.stringify({ challenge, approach: approach.id, style: state.play_style || 'story-shaping', grounds: stableGrounds })).digest('hex');
  return { challenge_id: challenge.id, approach_id: approach.id, basis,
    outcome: granted ? 'granted' : 'refused', explanation: granted ? challenge.success : challenge.refusal,
    evidence_fact_ids: grounds.filter((entry) => entry.met).map((entry) => entry.requirement.fact_id),
  };
}

function publicChallenges(state) {
  return (state.challenges || []).map(({ id, label, actor_id, approaches }) => ({ id, label, actor_id,
    approaches: approaches.map(({ id, label }) => ({ id, label })),
  }));
}

module.exports = { STYLES, normalizeChallenges, adjudicate, publicChallenges };
