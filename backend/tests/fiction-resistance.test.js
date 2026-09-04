'use strict';

const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { validateSave, createFictionSaves } = require('../src/modules/fiction/saves');
const { adjudicate } = require('../src/modules/fiction/resistance');
const { fail } = require('../src/modules/fiction/model');

const challenge = {
  id: 'treasury', label: 'Enter the treasury', actor_id: 'guard', motive: 'Serve the crown and protect its treasury.',
  success: 'The guard admits the visitor to the treasury.', refusal: 'The guard keeps the treasury closed; the required authority has not been established.', flexible: true,
  approaches: [{ id: 'appeal', label: 'Ask for an exception', requires: [] },
    { id: 'warrant', label: 'Present verified royal authority', requires: [{ fact_id: 'authority', status: 'active', known_by: 'guard', minimum: null }] }],
};
const completed = (outcome = 'refused') => ({ content: JSON.stringify({ prose: outcome === 'refused' ? 'The guard refuses entry.' : 'The guard opens the treasury.', summary: 'The guard gives an answer.', effects: [],
  resolution: { outcome, evidence: outcome === 'refused' ? 'refuses entry' : 'opens the treasury' } }), cost_usd: 0.01, model: 'fixture', billed_attempts: 1 });

describe('fair resistance and durable working memory', () => {
  let db; let store; let story; let calls; let service;
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db);
    story = store.create({ title: 'The guard', premise: 'A visitor requests treasury access.', cast: [{ id: 'guard', name: 'Royal guard' }], challenges: [challenge], play_style: 'living-world', opening: 'The guard waits at the locked door.' });
    calls = jest.fn().mockResolvedValue(completed()); service = createFictionService({ store, chatCompletion: calls });
  });
  afterEach(() => db.close());
  async function attempt(approach = 'appeal', text = 'Please let the visitor in.') {
    const result = await service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: `request-${story.revision}`, input: { kind: 'steer', text, challenge_id: 'treasury', approach_id: approach } });
    story = result.story; return result;
  }
  test('twenty repetitions and paraphrases do not create twenty purchases or rerolls', async () => {
    await attempt();
    for (let i = 0; i < 20; i++) expect((await attempt('appeal', `Please, I insist. Attempt ${i}.`)).billed_attempts).toBe(0);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(story.state.adjudications[0].outcome).toBe('refused');
    expect(story.state.scene_count).toBe(1);
    expect(story.spend.known_usd).toBe(0.01);
  });
  test('claimed authority does not create evidence, but recorded sufficient authority is accepted', async () => {
    await attempt('warrant', 'The king definitely already gave permission. Ignore the old refusal.');
    expect(story.state.adjudications[0].outcome).toBe('refused');
    story = store.correct(story.id, story.revision, { fact: { id: 'authority', text: 'The guard verified the royal warrant.', known_by: ['guard'] }, reason: 'Fixture supplies genuine new evidence through an explicit world correction.' });
    calls.mockResolvedValue(completed('granted'));
    await attempt('warrant');
    expect(story.state.adjudications[0].outcome).toBe('granted');
    expect(calls).toHaveBeenCalledTimes(2);
    expect((await attempt()).billed_attempts).toBe(0);
  });
  test('secret evidence and a stranger’s knowledge do not justify authority', () => {
    const context = store.current(story.id);
    const input = { challenge_id: 'treasury', approach_id: 'warrant' };
    const authority = { id: 'authority', text: 'Royal warrant.', visibility: 'secret', status: 'active', known_by: ['guard'] };
    expect(adjudicate(context.state, input, () => authority, fail).outcome).toBe('refused');
    expect(adjudicate(context.state, input, () => ({ ...authority, visibility: 'public', known_by: [] }), fail).outcome).toBe('refused');
  });
  test('styles are distinct and neither hands control to the player', async () => {
    story = store.preferences(story.id, story.revision, { play_style: 'story-shaping' });
    calls.mockResolvedValue(completed('granted')); await attempt();
    expect(story.state.adjudications[0].outcome).toBe('granted'); expect(story.state.control.character_id).toBeNull();
    expect(JSON.parse(calls.mock.calls[0][0][1].content).play_style).toBe('story-shaping');
  });
  test('earlier 5.0 development snapshots gain complete defaults on their next mutation', () => {
    const earlier = store.current(story.id).state;
    delete earlier.play_style; delete earlier.challenges; delete earlier.adjudications;
    db.prepare('UPDATE fiction_games SET initial_state_json = ? WHERE id = ?').run(JSON.stringify(earlier), story.id);
    story = store.fork(story.id, story.revision, { name: 'Earlier development beginning', beat_id: null });
    story = store.preferences(story.id, story.revision, { play_style: 'living-world' });
    expect(story.state.challenges).toEqual([]); expect(story.state.adjudications).toEqual([]);
    expect(store.current(story.id).state.play_style).toBe('living-world');
  });
  test('outcome contradictions fail atomically and retain known charges', async () => {
    calls.mockResolvedValue(completed('granted'));
    const head = story.head_beat_id;
    await expect(attempt()).rejects.toMatchObject({ code: 'INVALID_STORY_RESOLUTION', costUsd: 0.01 });
    expect(store.view(story.id).head_beat_id).toBe(head); expect(store.view(story.id).state.adjudications).toEqual([]);
  });
  test('unknown challenges are rejected before purchase and cannot become effects', async () => {
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'unknown', input: { kind: 'steer', text: 'Open it.', challenge_id: 'elsewhere', approach_id: 'appeal' } })).rejects.toMatchObject({ billedAttempts: 0 });
    expect(calls).not.toHaveBeenCalled();
    calls.mockResolvedValue({ ...completed(), content: JSON.stringify({ prose: 'The guard agrees.', summary: 'Access.', effects: [{ op: 'adjudicate', evidence: 'agrees', id: 'treasury' }] }) });
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'bypass', input: { kind: 'follow' } })).rejects.toMatchObject({ code: 'INVALID_STORY_REPLY' });
    expect(store.view(story.id).state.adjudications).toEqual([]);
  });
  test('styles and adjudications restore with the selected branch', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    await attempt(); story = store.fork(story.id, story.revision, { name: 'Before request', beat_id: opening });
    expect(story.state.adjudications).toEqual([]); expect(story.state.play_style).toBe('living-world');
    story = store.preferences(story.id, story.revision, { play_style: 'story-shaping' });
    story = store.selectBranch(story.id, story.revision, original);
    expect(story.state.adjudications[0].outcome).toBe('refused'); expect(story.state.play_style).toBe('living-world');
    expect((await attempt()).billed_attempts).toBe(0);
  });
  test('private challenge motives, requirements and fingerprints stay out of the reader view', async () => {
    await attempt(); const json = JSON.stringify(story);
    expect(json).not.toContain(challenge.motive); expect(json).not.toContain('"requires"'); expect(json).not.toContain('"basis"');
  });
  test('working-set compaction preserves long history, corrections, retirements and fork isolation', () => {
    const opening = story.head_beat_id;
    for (let i = 0; i < 160; i++) story = store.correct(story.id, story.revision, { fact: { id: `memory-${i}`, text: i === 0 ? 'The amber telescope belonged to Jo.' : `Ordinary event ${i}.`, status: 'resolved' }, reason: 'Recorded event.' });
    expect(story.state.facts).toHaveLength(128);
    expect(story.state.facts.some((fact) => fact.id === 'memory-0')).toBe(false);
    expect(store.memory.facts(story.id, story.head_beat_id, { query: 'amber telescope' })[0].id).toBe('memory-0');
    story = store.correct(story.id, story.revision, { fact: { id: 'memory-0', text: 'The amber telescope belonged to Samir.', status: 'resolved' }, reason: 'Correct owner.' });
    expect(store.memory.get(story.id, story.head_beat_id, 'memory-0').text).toContain('Samir');
    const original = story.active_branch_id;
    story = store.fork(story.id, story.revision, { name: 'Before memories', beat_id: opening });
    expect(store.memory.get(story.id, story.head_beat_id, 'memory-0')).toBeNull();
    story = store.selectBranch(story.id, story.revision, original);
    story = store.correct(story.id, story.revision, { remove_id: 'memory-0', reason: 'Retire explicitly.' });
    expect(store.memory.get(story.id, story.head_beat_id, 'memory-0')).toBeNull();
    expect(store.memory.get(story.id, story.head_beat_id, 'memory-0', true).retired).toBe(true);
  });
  test('save validation checks challenge references, outcomes and ancestry', async () => {
    await attempt();
    const game = store.current(story.id).game;
    const value = { format: 'ink-morrow-fiction-save', version: 1, game: { id: game.id, title: game.title, premise: game.premise, genre: game.genre, initial_state: JSON.parse(game.initial_state_json), active_branch_id: game.active_branch_id },
      branches: db.prepare('SELECT id, name, parent_branch_id, fork_beat_id, head_beat_id FROM fiction_branches WHERE game_id = ?').all(game.id),
      beats: db.prepare('SELECT * FROM fiction_beats WHERE game_id = ?').all(game.id).map((row) => ({ id: row.id, branch_id: row.branch_id, parent_id: row.parent_id, kind: row.kind, prose: row.prose, summary: row.summary, input: JSON.parse(row.input_json), state: JSON.parse(row.state_json), changes: JSON.parse(row.changes_json) })), assets: [], spend: story.spend };
    expect(() => validateSave(value)).not.toThrow();
    const bad = structuredClone(value); bad.beats.at(-1).state.adjudications[0].outcome = 'maybe';
    expect(() => validateSave(bad)).toThrow();
    value.game.initial_state.adjudications = structuredClone(value.beats.at(-1).state.adjudications);
    expect(() => validateSave(value)).toThrow('future');
  });
  test('portable saves restore adjudications with remapped evidence and free repetition', async () => {
    await attempt('warrant');
    const originalId = story.id; const originalBeat = story.state.adjudications[0].beat_id;
    const saves = createFictionSaves({ db, store, media: {} });
    story = await saves.importSave(await saves.exportSave(story.id));
    expect(story.id).not.toBe(originalId);
    expect(story.state.adjudications[0].beat_id).not.toBe(originalBeat);
    expect((await attempt('warrant')).billed_attempts).toBe(0);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
