'use strict';

// Episode framing follows recorded developments. It is neither a countdown nor
// authority to resolve a goal, and never changes the player's end decision.
function makeEpisode({ number = 1, title = 'The beginning', question = '' } = {}, facts = []) {
  return { number, title, status: 'active', summary: '', question,
    goal_ids: facts.filter((fact) => fact.kind === 'goal' && fact.visibility === 'public' && fact.status === 'active').slice(0, 6).map((fact) => fact.id),
    phase: 'opening', payoff_beat_id: null };
}

function episodeGoals(state, lookup = () => null) {
  return (state.episode.goal_ids || []).map((id) => state.facts.find((fact) => fact.id === id) || lookup(id))
    .filter((fact) => fact?.kind === 'goal' && fact.visibility === 'public');
}

function recordEpisode(state, changes, beatId, lookup = () => null) {
  const episode = state.episode;
  const ids = episode.goal_ids || [];
  const goals = episodeGoals(state, lookup);
  const complete = ids.length > 0 && goals.length === ids.length && goals.every((fact) => fact.status === 'resolved');
  if (complete && (episode.payoff_beat_id || changes.some((change) => change.op === 'resolve' && ids.includes(change.fact?.id)))) {
    episode.phase = episode.payoff_beat_id ? 'aftermath' : 'payoff';
    episode.payoff_beat_id ||= beatId;
  } else if (!complete) {
    if (episode.payoff_beat_id || changes.some((change) => change.op === 'introduce' || change.fact?.visibility === 'public')) episode.phase = 'developing';
    episode.payoff_beat_id = null;
  }
}

function returnRecap(state, rows, commitments = []) {
  return {
    question: state.episode.question || '', phase: state.episode.phase || 'opening',
    recent: rows.filter((row) => ['opening', 'scene'].includes(row.kind)).slice(-3)
      .map((row) => ({ beat_id: row.id, summary: row.summary })),
    commitments: commitments.filter((fact) => fact.kind === 'commitment' && fact.visibility === 'public' && fact.status === 'active').slice(0, 6)
      .map((fact) => ({ id: fact.id, text: fact.text, evidence_beat_id: fact.evidence_beat_id })),
  };
}

module.exports = { makeEpisode, episodeGoals, recordEpisode, returnRecap };
