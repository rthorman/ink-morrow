'use strict';

// A bounded, deterministic scene selector. Plans guide one narration; they are
// not world truth and cannot fulfil a promise, reveal a secret, or end an episode.
function chooseScene(game, state, intent) {
  const history = state.scene_history.filter((entry) => entry.episode === state.episode.number);
  const recent = history.slice(-2);
  const available = (kind, factId = null) => !recent.some((entry) => entry.kind === kind && (!factId || entry.fact_ids.includes(factId)));
  const active = state.facts.filter((fact) => fact.status === 'active' && fact.visibility === 'public');
  const focused = state.focus.toLowerCase();
  const rank = (facts) => [...facts].sort((a, b) => Number(focused.includes(b.actor_id || '\0')) - Number(focused.includes(a.actor_id || '\0')));
  const plan = (kind, guidance, facts = []) => ({ kind, guidance, fact_ids: facts.map((fact) => fact.id) });
  if (intent.kind === 'ask') return plan('clarification', 'Answer only from reader-known information. Do not advance time, reveal secrets, or create effects.');
  if (intent.kind !== 'follow') return plan('response', 'Respond to the supplied direction or explicit character intent before any scene pattern. This does not guarantee success or dictate the reader’s character.');
  const promise = rank(active.filter((fact) => fact.kind === 'commitment')).find((fact) => available('commitment', fact.id));
  if (promise) return plan('commitment', 'Create a plausible opportunity, complication, or acknowledgement specifically because this recorded commitment exists. Do not declare it fulfilled without an event that fulfils it.', [promise]);
  if (history.length && available('quiet') && (state.pacing === 'reflective' || (state.scene_count || history.length) % 3 === 2)) return plan('quiet', 'Let the cast absorb what happened through ordinary activity or conversation. No compulsory escalation, quest, or permanent consequence.');
  const goal = rank(active.filter((fact) => fact.kind === 'goal')).find((fact) => available('opportunity', fact.id));
  if (goal) return plan('opportunity', 'Offer a concrete, plausible way to pursue this established desire, without forcing anyone to accept it. Relationships and prior actions should alter how the opportunity appears.', [goal]);
  const resolved = state.facts.filter((fact) => fact.visibility === 'public' && fact.status === 'resolved');
  if (history.length >= 3 && resolved.length && available('rest')) return plan('rest', 'Allow a satisfying resting point or aftermath. A thread has resolved. Do not add a cliffhanger to prevent stopping; episode status remains the reader’s decision.', resolved.slice(-2));
  if (game.genre === 'mystery' && state.facts.some((fact) => fact.visibility === 'secret') && available('discovery')) return plan('discovery', 'Offer a fair observable clue consistent with fixed hidden truth and prior discoveries. Never alter the solution after a deduction. Only a genuine on-page discovery can justify a reveal effect.');
  if (game.genre === 'cozy') return plan('connection', 'Develop a small act of care, a practical shared activity, or a gentle difference of wishes. Meaning does not require danger or a reward counter.');
  if (game.genre === 'exploration') return plan('exploration', 'Let a concrete place or discovery invite curiosity, shaped by previous discoveries. Avoid an arbitrary checklist or mandatory peril.');
  return plan('relationship', state.consequences === 'dramatic' ? 'Develop an established tension or relationship with proportionate consequences. Do not manufacture a new crisis every beat.' : 'Develop the cast’s different wishes through a grounded encounter. Low-stakes expression is a complete contribution.');
}

function recordScene(state, plan, beatId) {
  if (plan.kind === 'clarification') return;
  state.scene_count = (state.scene_count || 0) + 1;
  state.scene_history = [...state.scene_history, { kind: plan.kind, fact_ids: plan.fact_ids, beat_id: beatId, episode: state.episode.number }].slice(-12);
}

module.exports = { chooseScene, recordScene };
