'use strict';
const {keys,text,choice,fail,normalizeCast,normalizeFact,GENRES}=require('./model');
const {STYLES,normalizeChallenges}=require('./resistance');
const {FOURTH_WALL_MODES}=require('./fourth-wall');
const {QUALITY_MODES}=require('./quality');
const {validateLibrary,validateVisuals}=require('./library-model');
const SAVE_FORMAT='ink-morrow-fiction-save';
const idOf = (value) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('The save contains an invalid identifier.', 'INVALID_SAVE'); return value; };
const integer = (value, min, max, label) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Invalid ${label} in save.`, 'INVALID_SAVE'); return value; };
const list = (value, max, label) => { if (!Array.isArray(value) || value.length > max) fail(`Invalid ${label} count in save.`, 'INVALID_SAVE'); return value; };
const record = (value, fields, label) => {
  keys(value, fields, label);
  if (fields.some((field) => !Object.hasOwn(value, field))) fail(`Missing ${label} field.`, 'INVALID_SAVE');
};
const savedText = (value, label, max) => {
  if (typeof value !== 'string') fail(`Invalid ${label} in save.`, 'INVALID_SAVE');
  return text(value, label, max, { optional: true });
};

// A strict new-product save, not a legacy archive or a database migration.
// Validation never writes. Import always creates a new story and new media IDs.
function validateSave(value) {
  record(value, ['format', 'version', 'game', 'branches', 'beats', 'assets', 'spend'], 'Save');
  if (value.format !== SAVE_FORMAT || value.version !== 1) fail('This is not a supported InkMorrow 5 save. Earlier products and future save versions are not imported.', 'SAVE_VERSION_UNSUPPORTED');
  const game = value.game;
  record(game, ['id', 'title', 'premise', 'genre', 'initial_state', 'active_branch_id'], 'Saved story');
  idOf(game.id); text(game.title, 'Title', 200); text(game.premise, 'Premise', 4000); choice(game.genre, GENRES, null, 'Genre');
  const index = (rows, max, label, fields) => {
    const map = new Map();
    for (const row of list(rows, max, label)) { record(row, fields, label); idOf(row.id); if (map.has(row.id)) fail(`Duplicate ${label} identifier.`, 'INVALID_SAVE'); map.set(row.id, row); }
    return map;
  };
  const branches = index(value.branches, 40, 'path', ['id', 'name', 'parent_branch_id', 'fork_beat_id', 'head_beat_id']);
  const beats = index(value.beats, 10000, 'moment', ['id', 'branch_id', 'parent_id', 'kind', 'prose', 'summary', 'input', 'state', 'changes']);
  const assets = index(value.assets, 400, 'image', ['id', 'media_type', 'sha256', 'width', 'height', 'content_base64']);
  const ref = (map, id, nullable = false) => { if (id === null && nullable) return; idOf(id); if (!map.has(id)) fail('The save has a dangling reference.', 'INVALID_SAVE'); };
  if (!branches.size) fail('The save has no reading path.', 'INVALID_SAVE');
  ref(branches, game.active_branch_id);
  for (const branch of branches.values()) {
    text(branch.name, 'Path name', 120); ref(branches, branch.parent_branch_id, true); ref(beats, branch.fork_beat_id, true); ref(beats, branch.head_beat_id, true);
  }
  const rootBranches = [...branches.values()].filter((branch) => branch.parent_branch_id === null);
  if (rootBranches.length !== 1 || rootBranches[0].fork_beat_id !== null) fail('The save must have one original path.', 'INVALID_SAVE');
  for (const branch of branches.values()) {
    const seen = new Set(); let next = branch;
    while (next) { if (seen.has(next.id)) fail('The save has cyclic paths.', 'INVALID_SAVE'); seen.add(next.id); next = branches.get(next.parent_branch_id); }
  }
  // Euler intervals make all snapshot provenance checks O(1), not a fresh
  // walk of an ever-growing manuscript for every fact and placement.
  const children = new Map([[null, []]]);
  for (const beat of beats.values()) {
    ref(branches, beat.branch_id); ref(beats, beat.parent_id, true);
    if (!children.has(beat.parent_id)) children.set(beat.parent_id, []);
    children.get(beat.parent_id).push(beat.id);
  }
  const starts = new Map(); const ends = new Map(); let clock = 0;
  const stack = children.get(null).map((id) => [id, false]);
  while (stack.length) {
    const [id, leaving] = stack.pop();
    if (leaving) { ends.set(id, clock++); continue; }
    if (starts.has(id)) fail('The save has cyclic moments.', 'INVALID_SAVE');
    starts.set(id, clock++); stack.push([id, true]);
    for (const child of children.get(id) || []) stack.push([child, false]);
  }
  if (starts.size !== beats.size) fail('The save has cyclic or disconnected moments.', 'INVALID_SAVE');
  const ancestor = (head, target) => target === null || (head !== null && starts.get(target) <= starts.get(head) && ends.get(target) >= ends.get(head));
  const reachable = new Set();
  for (const branch of branches.values()) {
    if (!ancestor(branch.head_beat_id, branch.fork_beat_id)) fail('A path head does not descend from its fork.', 'INVALID_SAVE');
    if (branch.parent_branch_id && !ancestor(branches.get(branch.parent_branch_id).head_beat_id, branch.fork_beat_id)) fail('A path forks outside its parent.', 'INVALID_SAVE');
    if (branch.head_beat_id !== branch.fork_beat_id && beats.get(branch.head_beat_id)?.branch_id !== branch.id) fail('A path head belongs to another path.', 'INVALID_SAVE');
    let next = beats.get(branch.head_beat_id);
    while (next && !reachable.has(next.id)) { reachable.add(next.id); next = beats.get(next.parent_id); }
  }
  if (reachable.size !== beats.size) fail('The save contains unreachable moments.', 'INVALID_SAVE');
  const goalOrigins = new Map();
  const noteGoal = (fact, at) => {
    if (fact?.kind !== 'goal' || fact.visibility !== 'public') return;
    if (!goalOrigins.has(fact.id)) goalOrigins.set(fact.id, []);
    goalOrigins.get(fact.id).push(at);
  };
  if (Array.isArray(game.initial_state?.facts)) game.initial_state.facts.forEach((fact) => noteGoal(fact, null));
  for (const beat of beats.values()) if (Array.isArray(beat.changes)) for (const change of beat.changes) if (change?.op !== 'remove') noteGoal(change?.fact, beat.id);
  const evidence = (head, id) => { ref(beats, id, true); if (!ancestor(head, id)) fail('A snapshot refers to another path or the future.', 'INVALID_SAVE'); };
  const fact = (value, cast, head) => {
    record(value, ['id', 'kind', 'text', 'visibility', 'known_by', 'status', 'actor_id', 'value', 'evidence_beat_id', ...(Object.hasOwn(value, 'facet') ? ['facet', 'toward_id'] : [])], 'Fact');
    normalizeFact(value, cast.map((person) => person.id), { evidenceBeatId: value.evidence_beat_id }); evidence(head, value.evidence_beat_id);
  };
  function state(state, head) {
    record(state, ['version', 'cast', 'facts', 'illustrations', 'control', 'pacing', 'consequences', 'boundaries', 'voice', 'focus', 'episode', 'scene_history', 'scene_count',
      ...(Object.hasOwn(state, 'library') ? ['library'] : []), ...(Object.hasOwn(state, 'visuals') ? ['visuals'] : []),
      ...(Object.hasOwn(state, 'quality_mode') ? ['quality_mode'] : []),
      ...(Object.hasOwn(state, 'fourth_wall') ? ['fourth_wall', 'last_fourth_wall_scene'] : []),
      ...(Object.hasOwn(state, 'play_style') ? ['play_style', 'challenges', 'adjudications'] : [])], 'Saved state');
    if (state.version !== 1) fail('Unsupported story-state version.', 'SAVE_VERSION_UNSUPPORTED');
    if (state.quality_mode !== undefined) choice(state.quality_mode, QUALITY_MODES, null, 'Consistency quality mode');
    list(state.cast, 24, 'cast').forEach((person) => record(person, ['id', 'name', 'description', 'motive'], 'Character'));
    state.cast.forEach((person) => { savedText(person.description, 'description', 2000); savedText(person.motive, 'motive', 1000); });
    const cast = normalizeCast(state.cast);
    if (state.library !== undefined) validateLibrary(state.library, cast.map((person) => person.id));
    if (state.visuals !== undefined) { validateVisuals(state.visuals, state); state.visuals.forEach((item) => ref(assets, item.asset_id)); }
    if (state.play_style !== undefined) {
      choice(state.play_style, STYLES, null, 'Play style');
      normalizeChallenges(state.challenges, cast.map((person) => person.id), { keys, text, fail });
      const seen = new Set();
      for (const decision of list(state.adjudications, 12, 'adjudication')) {
        record(decision, ['challenge_id', 'approach_id', 'basis', 'outcome', 'explanation', 'evidence_fact_ids', 'beat_id'], 'Adjudication');
        const challenge = state.challenges.find((entry) => entry.id === decision.challenge_id);
        if (!challenge?.approaches.some((entry) => entry.id === decision.approach_id) || seen.has(decision.challenge_id)) fail('Invalid adjudication target.', 'INVALID_SAVE');
        seen.add(decision.challenge_id);
        if (typeof decision.basis !== 'string' || !/^[a-f0-9]{64}$/.test(decision.basis)) fail('Invalid adjudication basis.', 'INVALID_SAVE');
        choice(decision.outcome, ['granted', 'refused'], null, 'Outcome'); text(decision.explanation, 'Outcome explanation', 800);
        list(decision.evidence_fact_ids, 6, 'decision evidence').forEach(idOf); evidence(head, decision.beat_id);
        if (beats.get(decision.beat_id)?.kind !== 'scene') fail('An adjudication must refer to its scene.', 'INVALID_SAVE');
      }
    }
    for (const item of list(state.facts, 128, 'fact')) fact(item, cast, head);
    if (new Set(state.facts.map((entry) => entry.id)).size !== state.facts.length) fail('Duplicate fact IDs.', 'INVALID_SAVE');
    keys(state.control, ['character_id'], 'Control');
    if (state.control.character_id !== null && !cast.some((person) => person.id === state.control.character_id)) fail('Control refers to an unknown character.', 'INVALID_SAVE');
    choice(state.pacing, ['reflective', 'balanced', 'brisk'], null, 'Pacing');
    choice(state.consequences, ['gentle', 'dramatic'], null, 'Consequences');
    for (const [key, max] of [['boundaries', 2000], ['voice', 1500], ['focus', 1500]]) savedText(state[key], key, max);
    record(state.episode, ['number', 'title', 'status', 'summary', ...(Object.hasOwn(state.episode, 'question') ? ['question', 'goal_ids', 'phase', 'payoff_beat_id'] : [])], 'Episode');
    integer(state.episode.number, 1, 1000000, 'episode'); text(state.episode.title, 'Episode title', 200); savedText(state.episode.summary, 'Episode summary', 2000);
    if (state.episode.question !== undefined) {
      savedText(state.episode.question, 'Episode question', 500);
      list(state.episode.goal_ids, 6, 'episode goals').forEach(idOf);
      if (new Set(state.episode.goal_ids).size !== state.episode.goal_ids.length) fail('Duplicate episode goals.', 'INVALID_SAVE');
      if (state.episode.goal_ids.some((id) => !(goalOrigins.get(id) || []).some((at) => ancestor(head, at)))) fail('Episode goals must be public goals established on this path.', 'INVALID_SAVE');
      choice(state.episode.phase, ['opening', 'developing', 'payoff', 'aftermath'], null, 'Episode phase');
      evidence(head, state.episode.payoff_beat_id);
      const paidOff = ['payoff', 'aftermath'].includes(state.episode.phase);
      if (paidOff !== Boolean(state.episode.payoff_beat_id) || (paidOff && beats.get(state.episode.payoff_beat_id)?.kind !== 'scene')) fail('Invalid episode payoff evidence.', 'INVALID_SAVE');
    }
    choice(state.episode.status, ['active', 'ended'], null, 'Episode status'); integer(state.scene_count, 0, 1000000, 'scene count');
    if (state.fourth_wall !== undefined) {
      choice(state.fourth_wall, FOURTH_WALL_MODES, null, 'Fourth-wall setting');
      if (state.last_fourth_wall_scene !== null) integer(state.last_fourth_wall_scene, 1, state.scene_count, 'fourth-wall scene');
    }
    for (const entry of list(state.scene_history, 12, 'director history')) {
      record(entry, ['kind', 'fact_ids', 'beat_id', 'episode'], 'Director history');
      choice(entry.kind, ['response', 'commitment', 'quiet', 'opportunity', 'rest', 'discovery', 'connection', 'exploration', 'relationship'], null, 'Scene kind');
      list(entry.fact_ids, 128, 'planned fact').forEach(idOf); evidence(head, entry.beat_id);
      if (beats.get(entry.beat_id)?.kind !== 'scene') fail('Director history must refer to a narrated scene.', 'INVALID_SAVE');
      integer(entry.episode, 1, state.episode.number, 'director episode');
    }
    const targets = new Set();
    for (const entry of list(state.illustrations, 200, 'illustration')) {
      record(entry, ['beat_id', 'asset_id', 'alt_text', 'caption'], 'Illustration'); ref(assets, entry.asset_id); evidence(head, entry.beat_id);
      if (!['opening', 'scene'].includes(beats.get(entry.beat_id)?.kind) || targets.has(entry.beat_id)) fail('Invalid illustration anchor.', 'INVALID_SAVE');
      targets.add(entry.beat_id); text(entry.alt_text, 'Image description', 1000); savedText(entry.caption, 'Caption', 500);
    }
  }
  state(game.initial_state, null);
  for (const beat of beats.values()) {
    const branch = branches.get(beat.branch_id); const parent = beats.get(beat.parent_id);
    if ((!parent || parent.branch_id !== branch.id) && beat.parent_id !== branch.fork_beat_id) fail('A moment crosses paths outside the fork.', 'INVALID_SAVE');
    choice(beat.kind, ['opening', 'scene', 'clarification', 'correction', 'control', 'episode'], null, 'Moment kind');
    savedText(beat.prose, 'Prose', 24000); savedText(beat.summary, 'Summary', 2000);
    if (['opening', 'scene', 'clarification'].includes(beat.kind)) text(beat.prose, 'Prose', 24000);
    keys(beat.input, ['kind', 'text', 'character_id', 'reason', 'challenge_id', 'approach_id', 'direction_scope'], 'Saved input');
    if (beat.input.direction_scope !== undefined) {
      if (beat.input.kind !== 'steer') fail('Only direction inputs have a scope.', 'INVALID_SAVE');
      choice(beat.input.direction_scope, ['moment', 'ongoing'], null, 'Direction scope');
    }
    if (beat.input.kind !== undefined) choice(beat.input.kind, ['follow', 'steer', 'act', 'say', 'ask'], null, 'Input kind');
    if (beat.input.text !== undefined) savedText(beat.input.text, 'Direction', 4000);
    if (beat.input.reason !== undefined) savedText(beat.input.reason, 'Reason', 1500);
    if (beat.input.challenge_id !== undefined || beat.input.approach_id !== undefined) {
      idOf(beat.input.challenge_id); idOf(beat.input.approach_id);
      if (!beat.state.challenges?.some((entry) => entry.id === beat.input.challenge_id && entry.approaches.some((approach) => approach.id === beat.input.approach_id))) fail('Invalid challenge input.', 'INVALID_SAVE');
    }
    if (beat.input.character_id != null && !beat.state.cast?.some((person) => person.id === beat.input.character_id)) fail('Invalid input character.', 'INVALID_SAVE');
    state(beat.state, beat.id);
    for (const change of list(beat.changes, 12, 'state change')) {
      record(change, change.op === 'introduce' ? ['op', 'character'] : ['op', 'fact', ...(Object.hasOwn(change, 'prior_evidence_beat_id') ? ['prior_evidence_beat_id'] : [])], 'State change');
      if (Object.hasOwn(change, 'prior_evidence_beat_id')) evidence(beat.parent_id, change.prior_evidence_beat_id);
      choice(change.op, ['remember', 'resolve', 'reveal', 'adjust', 'develop', 'correct', 'remove', 'introduce'], null, 'State change');
      if (change.op === 'introduce') { keys(change.character, ['id', 'name', 'description'], 'Introduced character'); normalizeCast([change.character]); }
      else fact(change.fact, beat.state.cast, beat.id);
    }
  }
  record(value.spend, ['known_usd', 'unknown_attempts'], 'Spend');
  if (!Number.isFinite(value.spend.known_usd) || value.spend.known_usd < 0 || value.spend.known_usd > 1000000000) fail('Invalid known spend.', 'INVALID_SAVE');
  integer(value.spend.unknown_attempts, 0, 10000000, 'unknown attempt count');
  return { branches, beats, assets };
}

module.exports={validateSave};
