'use strict';

const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { chooseScene, recordScene } = require('../src/modules/fiction/director');
const { catalogue } = require('../src/modules/fiction/scenarios');
const { applyEffects } = require('../src/modules/fiction/model');

describe('history-driven playable scenes', () => {
  let db; let store; let story;
  const follow = { kind: 'follow', text: '' };
  beforeEach(() => { db = createDb(':memory:'); store = createFictionStore(db); story = store.create({ scenario_id: 'drowned-bell' }); });
  afterEach(() => db.close());
  const plan = () => { const c = store.current(story.id); return chooseScene(c.game, c.state, follow); };

  test('authored mystery keeps a fixed culprit out of catalogue and reader state', () => {
    expect(story.state.cast.map((entry) => entry.id)).toEqual(['mara', 'iona', 'vale']);
    expect(story.state.control.character_id).toBeNull();
    expect(JSON.stringify(story)).not.toContain('Vale is the buyer');
    expect(JSON.stringify(catalogue())).not.toContain('Vale is the buyer');
    expect(store.current(story.id).state.facts.find((fact) => fact.id === 'chart-sale').text).toContain('Vale is the buyer');
    expect(story.state.cast[0].motive).toBeUndefined();
  });

  test('a commitment changes future possibilities only on its own path', () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    expect(plan().kind).not.toBe('commitment');
    story = store.correct(story.id, story.revision, { fact: { id: 'promise', kind: 'commitment', actor_id: 'mara', text: 'Mara promised to help Iona find the records.' }, reason: 'Keep the promise.' });
    expect(plan()).toMatchObject({ kind: 'commitment', fact_ids: ['promise'] });
    story = store.fork(story.id, story.revision, { name: 'Without that promise', beat_id: opening });
    expect(plan().kind).not.toBe('commitment');
    story = store.selectBranch(story.id, story.revision, original);
    expect(plan().kind).toBe('commitment');
  });

  test('plans have cooldowns, remain provisional and never fulfil facts', () => {
    const c = store.current(story.id); const before = JSON.stringify(c.state);
    const next = chooseScene(c.game, c.state, follow);
    expect(JSON.stringify(c.state)).toBe(before);
    recordScene(c.state, next, 'beat');
    expect(chooseScene(c.game, c.state, follow).kind).not.toBe(next.kind);
    expect(c.state.facts.find((fact) => fact.id === 'iona-chart').status).toBe('active');
  });

  test('explicit direction and clarification take precedence over a pattern', () => {
    const c = store.current(story.id);
    expect(chooseScene(c.game, c.state, { kind: 'steer', text: 'Stay with the tea.' }).kind).toBe('response');
    const ask = chooseScene(c.game, c.state, { kind: 'ask', text: 'Who is Iona?' });
    const before = JSON.stringify(c.state); recordScene(c.state, ask, 'ask');
    expect(JSON.stringify(c.state)).toBe(before);
  });

  test('cozy quiet play does not require a quest, catastrophe, or avatar', () => {
    const game = store.create({ scenario_id: 'garden-after-rain' });
    const c = store.current(game.id); c.state.facts = []; c.state.pacing = 'reflective';
    const first = chooseScene(c.game, c.state, follow); expect(first.kind).toBe('connection');
    recordScene(c.state, first, 'one'); expect(chooseScene(c.game, c.state, follow).kind).toBe('quiet');
    expect(c.state.control.character_id).toBeNull();
  });

  test('history remains bounded and quiet cadence continues after the window fills', () => {
    const c = store.current(story.id); c.state.facts = [];
    for (let i = 0; i < 20; i++) recordScene(c.state, { kind: 'relationship', fact_ids: [] }, `beat-${i}`);
    expect(c.state.scene_history).toHaveLength(12); expect(c.state.scene_count).toBe(20);
    expect(chooseScene(c.game, c.state, follow).kind).toBe('quiet');
  });

  test('a resolved thread can invite rest without ending the episode automatically', () => {
    const c = store.current(story.id);
    c.state.facts = [{ id: 'done', kind: 'goal', visibility: 'public', status: 'resolved', text: 'They found the chart.' }];
    for (let i = 0; i < 3; i++) recordScene(c.state, { kind: 'discovery', fact_ids: [] }, `b${i}`);
    expect(chooseScene(c.game, c.state, follow).kind).toBe('rest');
    expect(c.state.episode.status).toBe('active');
  });

  test('new people become inhabitable without assigning them to the reader', () => {
    const c = store.current(story.id);
    const result = applyEffects(c.state, [{ op: 'introduce', character: { id: 'ada', name: 'Ada', description: 'The archivist.', motive: 'Keep the records safe.' }, evidence: 'Ada arrived.' }], { prose: 'Ada arrived.', input: follow, beatId: 'ada-beat' });
    expect(result.state.cast.at(-1).name).toBe('Ada'); expect(result.state.control.character_id).toBeNull();
    expect(() => applyEffects(result.state, [{ op: 'introduce', character: { id: 'ada-again', name: 'Ada' }, evidence: 'Ada arrived.' }], { prose: 'Ada arrived.', input: follow, beatId: 'duplicate' })).toThrow('duplicates');
  });

  test('preferences, private motives and cast additions are local branch snapshots', () => {
    const opening = story.head_beat_id;
    story = store.preferences(story.id, story.revision, { pacing: 'reflective', voice: 'Spare, warm prose.', focus: 'Mara', boundaries: 'No combat.' });
    story = store.addCast(story.id, story.revision, { id: 'ada', name: 'Ada', motive: 'A private plan.' });
    expect(JSON.stringify(story)).not.toContain('A private plan');
    story = store.fork(story.id, story.revision, { name: 'Original tone', beat_id: opening });
    expect(story.state.pacing).toBe('balanced'); expect(story.state.cast).toHaveLength(3);
  });

  test('failed narration does not advance scene cooldowns or mutate hidden truth', async () => {
    const before = JSON.stringify(store.current(story.id).state);
    const service = createFictionService({ store, chatCompletion: async () => ({ content: 'not JSON', billed_attempts: 1, cost_usd: 0.01 }) });
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'failure', input: follow })).rejects.toThrow('unreadable');
    expect(JSON.stringify(store.current(story.id).state)).toBe(before);
  });

  test('successful narration commits the plan only as director history', async () => {
    const completion = jest.fn().mockResolvedValue({ content: JSON.stringify({ prose: 'Iona accepted the tea.', summary: 'A pause on the quay.', effects: [] }), billed_attempts: 1 });
    const service = createFictionService({ store, chatCompletion: completion });
    await service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'success', input: follow });
    const state = store.current(story.id).state;
    expect(state.scene_count).toBe(1); expect(state.facts.find((fact) => fact.id === 'iona-chart').status).toBe('active');
    const prompt = JSON.parse(completion.mock.calls[0][0][1].content);
    expect(prompt.scene_plan.kind).toBe('opportunity'); expect(prompt.remaining_fact_slots).toBe(12);
    expect(completion.mock.calls[0][1].maxBillableAttempts).toBe(1);
  });
});
