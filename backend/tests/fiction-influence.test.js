'use strict';

const request = require('supertest');
const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionSaves } = require('../src/modules/fiction/saves');
const { validateIntent } = require('../src/modules/fiction/model');
const { createTestApp } = require('./helpers');

describe('clear influence and reader-safe evidence', () => {
  let db; let store; let story; let completion; let service;
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db);
    story = store.create({ scenario_id: 'garden-after-rain' });
    completion = jest.fn().mockResolvedValue({ content: JSON.stringify({ prose: 'The neighbours pause beside the gate.', summary: 'A quiet moment.', effects: [] }), cost_usd: 0.01, billed_attempts: 1 });
    service = createFictionService({ store, chatCompletion: completion });
  });
  afterEach(() => db.close());
  const reply = async (input) => { const result = await service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: `r-${story.revision}`, input }); story = result.story; return result; };
  test('one-moment direction does not become a lasting instruction, while explicit ongoing direction does', async () => {
    await reply({ kind: 'steer', text: 'Let Jo notice a bird.' }); expect(story.state.focus).toBe('');
    await reply({ kind: 'steer', text: 'Keep attention on belonging.', direction_scope: 'ongoing' });
    expect(story.state.focus).toBe('Keep attention on belonging.');
    await reply({ kind: 'steer', text: 'Look at the seedlings.', direction_scope: 'moment' });
    expect(story.state.focus).toBe('Keep attention on belonging.');
    expect(JSON.parse(completion.mock.calls.at(-1)[0][1].content).input.direction_scope).toBe('moment');
    const before = completion.mock.calls.length;
    story = store.preferences(story.id, story.revision, { focus: '' }); expect(story.state.focus).toBe(''); expect(completion).toHaveBeenCalledTimes(before);
  });
  test('only Steer can set focus and invalid scopes fail before purchase', async () => {
    expect(() => validateIntent({ kind: 'ask', text: 'Who is Jo?', direction_scope: 'ongoing' }, story.state)).toThrow('Only Steer');
    await expect(reply({ kind: 'steer', text: 'Watch Jo.', direction_scope: 'forever' })).rejects.toThrow('not supported');
    expect(completion).not.toHaveBeenCalled();
  });
  test('failed ongoing directions never change focus', async () => {
    completion.mockResolvedValue({ content: 'bad JSON', billed_attempts: 1 });
    await expect(reply({ kind: 'steer', text: 'Follow Samir.', direction_scope: 'ongoing' })).rejects.toThrow('unreadable');
    expect(store.current(story.id).state.focus).toBe('');
  });
  test('recall finds older public facts, excludes retired and secret facts, and cannot cross paths', () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    story = store.correct(story.id, story.revision, { fact: { id: 'hidden', text: 'Secret amber telescope.', visibility: 'secret' }, reason: 'Private.' });
    for (let i = 0; i < 140; i++) story = store.correct(story.id, story.revision, { fact: { id: `f-${i}`, text: i ? `Old event ${i}.` : 'The amber telescope belonged to Jo.', status: 'resolved' }, reason: 'Record.' });
    expect(story.state.facts.some((fact) => fact.id === 'f-0')).toBe(false);
    const recalled = store.recall(story.id, 'amber telescope'); expect(recalled[0].id).toBe('f-0'); expect(JSON.stringify(recalled)).not.toContain('Secret');
    const evidence = recalled[0].evidence_beat_id; expect(store.evidence(story.id, evidence).changes[0].fact.id).toBe('f-0');
    story = store.fork(story.id, story.revision, { name: 'Before telescope', beat_id: opening });
    expect(store.recall(story.id, 'amber telescope').some((fact) => fact.id === 'f-0')).toBe(false);
    expect(() => store.evidence(story.id, evidence)).toThrow('not on this path');
    story = store.selectBranch(story.id, story.revision, original);
    story = store.correct(story.id, story.revision, { remove_id: 'f-0', reason: 'Retire.' });
    expect(store.recall(story.id, 'amber telescope').some((fact) => fact.id === 'f-0')).toBe(false);
  });
  test('changed facts link to real prior evidence and saves remap those links and direction scope', async () => {
    story = store.correct(story.id, story.revision, { fact: { id: 'promise', kind: 'commitment', text: 'Nell promised to bring seedlings.', actor_id: 'nell' }, reason: 'Record promise.' });
    const promiseBeat = story.head_beat_id;
    completion.mockResolvedValue({ content: JSON.stringify({ prose: 'Nell brought the seedlings.', summary: 'The promise was kept.', effects: [{ op: 'resolve', id: 'promise', evidence: 'Nell brought' }] }), billed_attempts: 1 });
    await reply({ kind: 'steer', text: 'Stay with the garden.', direction_scope: 'ongoing' });
    expect(story.beats.at(-1).changes[0].prior_evidence_beat_id).toBe(promiseBeat);
    const saves = createFictionSaves({ db, store, media: {} });
    const restored = await saves.importSave(await saves.exportSave(story.id));
    const last = restored.beats.at(-1); expect(last.input.direction_scope).toBe('ongoing');
    expect(last.changes[0].prior_evidence_beat_id).not.toBe(promiseBeat);
    expect(store.evidence(restored.id, last.changes[0].prior_evidence_beat_id).changes[0].fact.id).toBe('promise');
    expect(restored.state.focus).toBe('Stay with the garden.');
  });
  test('challenge reviews are free, disclose only an existing ruling, and repeated replies survive provider changes', async () => {
    story = store.create({ title: 'The garden gate', premise: 'A neighbour requests a key.', play_style: 'living-world', cast: [{ id: 'jo', name: 'Jo' }], challenges: [{ id: 'key', label: 'Borrow the key', actor_id: 'jo', motive: 'A private reason.', success: 'Jo lends the key.', refusal: 'Jo keeps the key for now.', flexible: true, approaches: [{ id: 'ask', label: 'Ask for the key', requires: [] }] }] });
    const input = { kind: 'steer', text: 'Ask Jo.', challenge_id: 'key', approach_id: 'ask' };
    expect(service.reviewChallenge(story.id, story.revision, input)).toEqual({ requires_generation: true, explanation: null, revision: story.revision }); expect(completion).not.toHaveBeenCalled();
    completion.mockResolvedValue({ content: JSON.stringify({ prose: 'Jo keeps the key.', summary: 'Not yet.', effects: [], resolution: { outcome: 'refused', evidence: 'keeps the key' } }), billed_attempts: 1 });
    await reply(input);
    expect(service.reviewChallenge(story.id, story.revision, input).requires_generation).toBe(false);
    const changedProvider = createFictionService({ store, chatCompletion: completion, providers: { exposure: () => { throw new Error('No provider available.'); } } });
    const result = await changedProvider.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'repeat', providerId: 'old-provider', input });
    expect(result.billed_attempts).toBe(0); expect(completion).toHaveBeenCalledTimes(1);
    expect(() => service.reviewChallenge(story.id, story.revision, input)).toThrow('story changed');
  });
});

describe('bounded influence API surfaces', () => {
  let fixture; afterEach(() => fixture?.close());
  test('memory, evidence and challenge reviews remain behind the auth boundary', async () => {
    fixture = createTestApp({ authRequired: true });
    for (const path of ['/api/fiction/one/memory', '/api/fiction/one/evidence/beat']) expect((await request(fixture.app).get(path)).status).toBe(401);
    expect((await request(fixture.app).post('/api/fiction/one/challenge-review').send({})).status).toBe(401);
  });
  test('shelf pagination keeps stories beyond the former 200-item cutoff reachable', async () => {
    fixture = createTestApp(); const store = createFictionStore(fixture.db);
    for (let i = 0; i < 205; i++) store.create({ title: `Story ${i}`, premise: 'A place.' });
    const ids = new Set();
    for (const offset of [0, 80, 160]) {
      const result = await request(fixture.app).get(`/api/fiction?offset=${offset}`);
      expect(result.status).toBe(200); expect(result.body.stories.length).toBeLessThanOrEqual(80);
      for (const story of result.body.stories) ids.add(story.id);
      expect(result.body.next_offset).toBe(offset === 160 ? null : offset + 80);
    }
    expect(ids.size).toBe(205); expect((await request(fixture.app).get('/api/fiction?offset=-1')).status).toBe(400);
  });
});
