'use strict';

const request = require('supertest');
const { gunzipSync } = require('node:zlib');
const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionSaves, validateSave } = require('../src/modules/fiction/saves');
const { normalizeFact } = require('../src/modules/fiction/model');
const { createTestApp } = require('./helpers');

describe('people, complete episodes and returning to play', () => {
  let db; let store; let story; let completion; let service; let n;
  const follow = { kind: 'follow', text: '' };
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db); n = 0;
    story = store.create({ scenario_id: 'drowned-bell', play_style: 'living-world' });
    completion = jest.fn(); service = createFictionService({ store, chatCompletion: completion });
  });
  afterEach(() => db.close());
  const reply = async (prose, effects = [], input = follow, extra = {}) => {
    completion.mockResolvedValue({ content: JSON.stringify({ prose, summary: prose, effects, ...extra }), cost_usd: 0.01, billed_attempts: 1 });
    const result = await service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: `episode-${++n}`, input });
    story = result.story; return result;
  };
  const resolve = (id, evidence) => ({ op: 'resolve', id, evidence });
  const reveal = (id, evidence, known_by) => ({ op: 'reveal', id, evidence, known_by });

  test('an authored mystery can develop, pay off and have aftermath without ending automatically', async () => {
    expect(story.state.episode.question).toContain('why the bell rang');
    await reply('Iona listens beside the quay.');
    expect(story.state.episode.phase).toBe('opening');
    const sale = 'Mara tells Iona that she sold the chart to Vale for diving equipment.';
    await reply(sale, [reveal('chart-sale', sale, ['iona']), resolve('iona-chart', sale)]);
    expect(story.state.episode.phase).toBe('developing');
    const bell = 'The public survey log confirms that Vale’s crew disturbed the bell.';
    await reply(bell, [reveal('bell-cause', bell, ['iona', 'mara']), resolve('bell-question', bell)]);
    const together = 'The sisters agree to inspect the records together, with Iona deciding her own next dive.';
    await reply(together, [resolve('sisters-next-step', together), { op: 'develop', id: 'iona-trust', text: 'Iona will try deciding the next step with Mara, while still wanting future choices discussed.', evidence: together }]);
    const payoff = story.head_beat_id;
    expect(story.state.episode).toMatchObject({ phase: 'payoff', payoff_beat_id: payoff, status: 'active' });
    expect(story.state.facts.find((fact) => fact.id === 'iona-affection').text).toContain('cares deeply');
    expect(story.state.facts.find((fact) => fact.id === 'iona-trust')).toMatchObject({ facet: 'trust', actor_id: 'iona', toward_id: 'mara' });
    await reply('They finish the now-cold tea and watch the harbour lights.');
    expect(story.state.episode).toMatchObject({ phase: 'aftermath', payoff_beat_id: payoff, status: 'active' });
    expect(JSON.parse(completion.mock.calls.at(-1)[0][1].content).scene_plan.kind).toBe('rest');
    expect(story.state.control.character_id).toBeNull();
  });

  test('the garden supports credible refusal, new grounds, quiet cooperation and a resting payoff', async () => {
    story = store.create({ scenario_id: 'garden-after-rain', play_style: 'living-world' });
    const challenge = { kind: 'steer', text: 'Ask Jo to lead.', challenge_id: 'jo-leading', approach_id: 'insist' };
    const no = 'Jo declines the group role but stays by the seedlings.';
    await reply(no, [], challenge, { resolution: { outcome: 'refused', evidence: no } });
    const calls = completion.mock.calls.length; await reply('Unused.', [], challenge);
    expect(completion).toHaveBeenCalledTimes(calls);
    const offer = 'Jo and Nell agree that Jo can label seedlings quietly, with no speech or obligation to stay.';
    await reply(offer, [{ op: 'remember', fact: { id: 'quiet-role-agreed', text: 'Jo and Nell agreed on quiet seedling labels, with no group speech or obligation.', known_by: ['jo', 'nell'] }, evidence: offer }]);
    const yes = 'Jo accepts the quiet seedling-label task, and the neighbours agree on a welcoming shared layout.';
    await reply(yes, [{ op: 'develop', id: 'jo-cooperation', text: 'Jo willingly helps Nell with quiet seedling labels, without taking a standing leadership role.', evidence: yes }, resolve('open-garden', yes)],
      { ...challenge, text: 'Offer the agreed quiet role.', approach_id: 'quiet-offer' }, { resolution: { outcome: 'granted', evidence: yes } });
    const tea = 'Samir brings tea from his kitchen; Nell sits nearby, and Jo chooses a quiet seat beside them.';
    await reply(tea, [resolve('shared-pause', tea)]);
    expect(story.state.episode).toMatchObject({ phase: 'payoff', status: 'active' });
    expect(story.state.facts.find((fact) => fact.id === 'jo-expectation').text).toContain('quiet answer');
    await reply('Rain beads on the new leaves while the neighbours rest.');
    expect(story.state.episode.phase).toBe('aftermath');
    expect(story.state.control.character_id).toBeNull();
  });

  test('an evidenced relationship development cannot rewrite fixed truth or invent owned feelings', async () => {
    const before = store.current(story.id);
    await expect(reply('Mara explains.', [{ op: 'develop', id: 'chart-sale', text: 'A different buyer.', evidence: 'Mara explains.' }])).rejects.toMatchObject({ code: 'INVALID_STORY_REPLY' });
    expect(store.current(story.id)).toEqual(before);
    story = store.control(story.id, story.revision, 'iona');
    await expect(reply('Iona trusts Mara completely.', [{ op: 'develop', id: 'iona-trust', text: 'Iona trusts Mara completely.', evidence: 'Iona trusts Mara completely.' }])).rejects.toMatchObject({ code: 'OWNED_CHARACTER_BOUNDARY' });
    const intent = { kind: 'act', text: 'Iona decides to trust Mara with the map.' };
    await reply('Mara nods.', [{ op: 'develop', id: 'iona-trust', text: 'Iona trusts Mara with the map.', evidence: intent.text }], intent);
    expect(story.state.facts.find((fact) => fact.id === 'iona-trust').text).toBe('Iona trusts Mara with the map.');
    expect(story.spend.known_usd).toBeCloseTo(0.03);
  });

  test('relationships require a valid aspect and target and never use affection meters', () => {
    const base = { id: 'r', kind: 'relationship', text: 'Iona trusts Mara.', actor_id: 'iona', toward_id: 'mara', facet: 'trust' };
    expect(normalizeFact(base, ['iona', 'mara'])).toMatchObject(base);
    for (const change of [{ facet: 'score' }, { toward_id: 'stranger' }, { toward_id: 'iona' }, { actor_id: null }, { value: 7 }]) expect(() => normalizeFact({ ...base, ...change }, ['iona', 'mara'])).toThrow();
    expect(() => normalizeFact({ ...base, kind: 'fact' }, ['iona', 'mara'])).toThrow('Only relationships');
  });

  test('quiet time and out-of-story clarification cannot buy a fake payoff', async () => {
    const before = story.state.episode;
    for (let i = 0; i < 8; i++) await reply('The sisters sit quietly.');
    await reply('Iona is Mara’s sister.', [], { kind: 'ask', text: 'Who is Iona?' });
    expect(story.state.episode).toEqual(before);
    for (const id of story.state.episode.goal_ids) {
      const fact = store.current(story.id).state.facts.find((fact) => fact.id === id);
      story = store.correct(story.id, story.revision, { fact: { ...fact, status: 'resolved' }, reason: 'Local correction, not a played payoff.' });
    }
    await reply('The sisters keep sitting quietly.');
    expect(story.state.episode.payoff_beat_id).toBeNull();
  });

  test('relationship and episode evidence survives reload and save-copy but not a rewind before the events', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    const prose = 'The sisters understand the chart sale, the survey’s bell strike and agree to decide the next step together.';
    await reply(prose, [...story.state.episode.goal_ids.map((id) => resolve(id, prose)), { op: 'develop', id: 'iona-trust', text: 'Iona will make the next decision alongside Mara.', evidence: prose }]);
    const payoff = story.head_beat_id;
    expect(createFictionStore(db).view(story.id).state.episode.payoff_beat_id).toBe(payoff);
    const saves = createFictionSaves({ db, store, media: {} }); const packed = await saves.exportSave(story.id);
    const copied = await saves.importSave(packed);
    expect(copied.state.episode.phase).toBe('payoff'); expect(copied.state.episode.payoff_beat_id).not.toBe(payoff);
    expect(copied.state.episode.payoff_beat_id).toBe(copied.head_beat_id);
    expect(copied.state.facts.find((fact) => fact.id === 'iona-trust').evidence_beat_id).toBe(copied.head_beat_id);
    const invalid = JSON.parse(gunzipSync(packed)); invalid.beats.at(-1).state.episode.payoff_beat_id = 'missing';
    expect(() => validateSave(invalid)).toThrow();
    const invalidGoal = JSON.parse(gunzipSync(packed)); invalidGoal.beats.at(-1).state.episode.goal_ids = ['not-established'];
    expect(() => validateSave(invalidGoal)).toThrow('public goals established on this path');
    story = store.fork(story.id, story.revision, { name: 'Before the answer', beat_id: opening });
    expect(story.state.episode.phase).toBe('opening'); expect(story.state.facts.find((fact) => fact.id === 'iona-trust').text).toContain('honest explanation');
    story = store.selectBranch(story.id, story.revision, original); expect(story.state.episode.payoff_beat_id).toBe(payoff);
  });

  test('a bounded return recap includes older live commitments and only the current path', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    await reply('Mara promises to bring tea.', [{ op: 'remember', fact: { id: 'tea-promise', kind: 'commitment', actor_id: 'mara', text: 'Mara promised tea.' }, evidence: 'Mara promises to bring tea.' }]);
    for (let i = 0; i < 35; i++) story = store.correct(story.id, story.revision, { fact: { id: `noise-${i}`, text: `Later detail ${i}.` }, reason: 'A private repair note.' });
    const result = store.recap(story.id);
    expect(result.commitments.map((entry) => entry.id)).toEqual(['tea-promise']);
    expect(result.recent.at(-1).summary).toContain('promises');
    expect(result.relationships.some((entry) => entry.facet === 'affection')).toBe(true);
    expect(result.recent.length).toBeLessThanOrEqual(3); expect(result.relationships.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(result)).not.toMatch(/Vale is the buyer|private repair|Protect Iona/);
    const calls = completion.mock.calls.length;
    story = store.fork(story.id, story.revision, { name: 'Without tea', beat_id: opening });
    expect(store.recap(story.id).commitments).toEqual([]);
    story = store.selectBranch(story.id, story.revision, original);
    story = store.correct(story.id, story.revision, { remove_id: 'tea-promise', reason: 'Retire this promise.' });
    expect(store.recap(story.id).commitments).toEqual([]); expect(completion).toHaveBeenCalledTimes(calls);
  });

  test('ending early and beginning another question preserves the cast without a paid call', () => {
    const goals = story.state.episode.goal_ids;
    story = store.episode(story.id, story.revision, { action: 'end', summary: 'A pause before the answer.' });
    expect(story.state.episode.phase).toBe('opening');
    story = store.episode(story.id, story.revision, { action: 'start', title: 'After tea', question: 'What can they agree on?' });
    expect(story.state.episode).toMatchObject({ number: 2, question: 'What can they agree on?', phase: 'opening' });
    expect(new Set(story.state.episode.goal_ids)).toEqual(new Set(goals)); expect(completion).not.toHaveBeenCalled();
  });
});

test('recap is authenticated and an episode question survives the actual API', async () => {
  const locked = createTestApp({ authRequired: true });
  try { expect((await request(locked.app).get('/api/fiction/missing/recap')).status).toBe(401); }
  finally { locked.close(); }
  const fixture = createTestApp();
  try {
    const started = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain' });
    let story = started.body.story;
    const recap = await request(fixture.app).get(`/api/fiction/${story.id}/recap`);
    expect(recap.status).toBe(200); expect(recap.body.recap.question).toContain('welcoming');
    story = (await request(fixture.app).post(`/api/fiction/${story.id}/episodes`).send({ expected_revision: story.revision, action: 'end' })).body.story;
    const next = await request(fixture.app).post(`/api/fiction/${story.id}/episodes`).send({ expected_revision: story.revision, action: 'start', title: 'Another day', question: 'Who returns?' });
    expect(next.status).toBe(201); expect(next.body.story.state.episode.question).toBe('Who returns?');
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n).toBe(0);
  } finally { fixture.close(); }
});
