'use strict';

// A bounded, deterministic scene selector. Plans guide one narration; they are
// not world truth and cannot fulfil a promise, reveal a secret, or end an episode.
function chooseLegacyScene(game, state, intent) {
  const history = state.scene_history.filter((entry) => entry.episode === state.episode.number);
  const recent = history.slice(-2);
  const available = (kind, factId = null) => !recent.some((entry) => entry.kind === kind && (!factId || entry.fact_ids.includes(factId)));
  const active = state.facts.filter((fact) => fact.status === 'active' && fact.visibility === 'public');
  const focused = state.focus.toLowerCase();
  const rank = (facts) => [...facts].sort((a, b) => Number(focused.includes(b.actor_id || '\0')) - Number(focused.includes(a.actor_id || '\0')));
  const plan = (kind, guidance, facts = []) => ({ kind, guidance, fact_ids: facts.map((fact) => fact.id) });
  if (intent.kind === 'ask') return plan('clarification', 'Answer only from reader-known information. Do not advance time, reveal secrets, or create effects.');
  if (intent.kind !== 'follow') return plan('response', 'Respond to the supplied direction or explicit character intent before any scene pattern. This does not guarantee success or dictate the reader’s character.');
  if (state.episode.payoff_beat_id && available('rest')) return plan('rest', 'Let the cast experience what this episode\'s recorded resolution means: a practical consequence, changed expectation or quiet aftermath. Do not undo the payoff to force a new crisis. The reader decides when to end or move on.');
  const promise = rank(active.filter((fact) => fact.kind === 'commitment')).find((fact) => available('commitment', fact.id));
  if (promise) return plan('commitment', 'Create a plausible opportunity, complication, or acknowledgement specifically because this recorded commitment exists. Do not declare it fulfilled without an event that fulfils it.', [promise]);
  if (history.length && available('quiet') && (state.pacing === 'reflective' || (state.scene_count || history.length) % 3 === 2)) return plan('quiet', 'Let the cast absorb what happened through ordinary activity or conversation. No compulsory escalation, quest, or permanent consequence.');
  const goal = rank(active.filter((fact) => fact.kind === 'goal')).find((fact) => available('opportunity', fact.id));
  if (goal && available('opportunity')) return plan('opportunity', 'Offer a concrete, plausible way to pursue this established desire, without forcing anyone to accept it. Relationships and prior actions should alter how the opportunity appears.', [goal]);
  const resolved = state.facts.filter((fact) => fact.visibility === 'public' && fact.status === 'resolved');
  if (history.length >= 3 && resolved.length && available('rest')) return plan('rest', 'Allow a satisfying resting point or aftermath. A thread has resolved. Do not add a cliffhanger to prevent stopping; episode status remains the reader’s decision.', resolved.slice(-2));
  if (game.genre === 'mystery' && state.facts.some((fact) => fact.visibility === 'secret') && available('discovery')) return plan('discovery', 'Offer a fair observable clue consistent with fixed hidden truth and prior discoveries. Never alter the solution after a deduction. Only a genuine on-page discovery can justify a reveal effect.');
  if (game.genre === 'cozy') return plan('connection', 'Develop a small act of care, a practical shared activity, or a gentle difference of wishes. Meaning does not require danger or a reward counter.');
  if (game.genre === 'exploration') return plan('exploration', 'Let a concrete place or discovery invite curiosity, shaped by previous discoveries. Avoid an arbitrary checklist or mandatory peril.');
  return plan('relationship', state.consequences === 'dramatic' ? 'Develop an established tension or relationship with proportionate consequences. Do not manufacture a new crisis every beat.' : 'Develop the cast’s different wishes through a grounded encounter. Low-stakes expression is a complete contribution.');
}

const OPPORTUNITIES=['commitment','quiet','opportunity','rest','discovery','connection','exploration','relationship'];
function chooseScene(game,state,intent){
  if(state.version!==2||intent.kind!=='follow')return chooseLegacyScene(game,state,intent);
  const legacy=chooseLegacyScene(game,state,intent);if(state.episode.phase==='payoff'&&state.episode.payoff_beat_id)return {kind:'rest',guidance:'Allow aftermath of the recorded achievement without manufacturing another crisis. Ending remains the reader’s choice.',fact_ids:[],round:state.opportunity_round?.round||0};if(legacy.kind==='rest'&&state.episode.payoff_beat_id)return {...legacy,round:state.opportunity_round?.round||0};
  const active=state.facts.filter(fact=>fact.status==='active'&&fact.visibility==='public');
  const pick=kind=>active.filter(fact=>fact.kind===kind).sort((a,b)=>a.id.localeCompare(b.id))[0];
  const nominees=[];const add=(kind,guidance,fact=null)=>nominees.push({kind,guidance,fact_ids:fact?[fact.id]:[]});
  const promise=pick('commitment');if(promise)add('commitment','Acknowledge or offer one grounded opportunity arising from this promise. It creates no urgency by itself and is not fulfilled by a plan.',promise);
  const quiet=()=>add('quiet','Give ordinary activity, reflection or connection room. This nomination is independent of how many promises exist; no compulsory crisis, reward or lasting effect.');
  if(state.scene_history.length&&state.pacing==='reflective')quiet();
  if(state.scene_history.length>=3&&state.facts.some(fact=>fact.visibility==='public'&&fact.status==='resolved'))add('rest','Acknowledge the recorded outcome or allow aftermath. Resolved does not by itself mean achieved, and rest does not end the episode.');
  const goal=pick('goal');if(goal)add('opportunity','Offer a plausible next possibility for this desire. Do not decide acceptance or manufacture achievement.',goal);
  if(game.genre==='mystery'&&state.facts.some(fact=>fact.visibility==='secret'))add('discovery','Offer a fair observable clue consistent with fixed truth; disclosure requires its own narrated evidence.');
  else if(game.genre==='cozy')add('connection','Explore care, shared practical activity or a gentle difference of wishes. A quest is optional.');
  else if(game.genre==='exploration')add('exploration','Let a concrete place invite curiosity, shaped by established discoveries rather than a checklist.');
  else add('relationship','Explore the cast’s distinct wishes in proportionate circumstances, without manufacturing another crisis.');
  if(state.scene_history.length&&state.pacing!=='reflective')quiet();
  let round=state.opportunity_round?.round||0;let used=state.opportunity_round?.used||[];
  let selected=nominees.find(nominee=>!used.includes(nominee.kind));if(!selected){round++;used=[];selected=nominees[0];}
  return {...selected,round,round_used:used,nomination_policy:'one nomination per eligible category per round; independent of fact cardinality'};
}

function recordScene(state, plan, beatId) {
  if (plan.kind === 'clarification') return;
  if(state.version===2&&OPPORTUNITIES.includes(plan.kind)){const used=plan.round_used||state.opportunity_round?.used||[];state.opportunity_round={round:plan.round??state.opportunity_round?.round??0,used:[...new Set([...used,plan.kind])].slice(-12)};}
  state.scene_count = (state.scene_count || 0) + 1;
  state.scene_history = [...state.scene_history, { kind: plan.kind, fact_ids: plan.fact_ids, beat_id: beatId, episode: state.episode.number }].slice(-12);
}

module.exports = { chooseScene, recordScene };
