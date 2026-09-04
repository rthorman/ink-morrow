'use strict';

const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { validateIntent, applyEffects } = require('../src/modules/fiction/model');

describe('5.0 playable-fiction foundations', () => {
  let db; let store; let story;
  const fact = (id, value, more = {}) => ({ id, text: value, ...more });
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db);
    story = store.create({ title: 'The Drowned Bell', premise: 'Mara sold a map.', cast: [{ id: 'mara', name: 'Mara' }, { id: 'sister', name: 'The sister' }], opening: 'Mara waits at the quay.', facts: [fact('culprit', 'The buyer is the mayor.', { visibility: 'secret', known_by: ['mara'] })] });
  });
  afterEach(() => db.close());

  test('reader-director default needs no avatar and keeps secrets out of API state', () => {
    expect(story.state.control.character_id).toBeNull();
    expect(story.state.facts).toEqual([]);
    expect(JSON.stringify(story)).not.toContain('mayor');
    expect(validateIntent({ kind: 'follow' }, store.current(story.id).state).kind).toBe('follow');
    expect(() => validateIntent({ kind: 'act', text: 'I wave.' }, story.state)).toThrow('Take control');
  });

  test('forking restores promises, resources, secrets and control together', () => {
    const openingId = story.head_beat_id; const original = story.active_branch_id;
    story = store.control(story.id, story.revision, 'mara');
    story = store.correct(story.id, story.revision, { fact: fact('promise', 'Mara promised to keep the sale secret.', { kind: 'commitment', actor_id: 'mara' }), reason: 'Record the promise.' });
    story = store.correct(story.id, story.revision, { fact: fact('coins', 'Coins', { kind: 'resource', value: 4 }), reason: 'Starting purse.' });
    const originalHead = story.head_beat_id;
    story = store.fork(story.id, story.revision, { name: 'No promise', beat_id: openingId });
    expect(story.state.control.character_id).toBeNull();
    expect(story.state.facts).toEqual([]);
    expect(store.current(story.id).state.facts[0].text).toBe('The buyer is the mayor.');
    story = store.selectBranch(story.id, story.revision, original);
    expect(story.head_beat_id).toBe(originalHead);
    expect(story.state.facts.map((entry) => entry.id)).toEqual(['promise', 'coins']);
    expect(story.state.control.character_id).toBe('mara');
  });

  test('corrections preserve earlier evidence and hide private reasons', () => {
    story = store.correct(story.id, story.revision, { fact: fact('culprit', 'The buyer is the mayor.', { visibility: 'secret' }), reason: 'A private spoiler.' });
    expect(JSON.stringify(story)).not.toContain('private spoiler');
    expect(JSON.stringify(story)).not.toContain('mayor');
    expect(story.beats[0].prose).toBe('Mara waits at the quay.');
    expect(() => db.prepare('UPDATE fiction_beats SET prose = ? WHERE id = ?').run('rewrite', story.head_beat_id)).toThrow('immutable');
  });

  test('rejects stale and cross-story path mutations', () => {
    expect(() => store.control(story.id, 0, 'mara')).toThrow('changed');
    const other = store.create({ title: 'Elsewhere', premise: 'Elsewhere.' });
    expect(() => store.selectBranch(story.id, story.revision, other.active_branch_id)).toThrow('Path not found');
    expect(() => store.fork(story.id, story.revision, { name: 'Wrong', beat_id: 'missing' })).toThrow('current path');
  });

  test('paged history stays on the selected ancestry', () => {
    for (let i = 0; i < 4; i++) story = store.control(story.id, story.revision, i % 2 ? null : 'mara');
    const tail = store.view(story.id, { limit: 2 });
    expect(tail.beats).toHaveLength(2); expect(tail.has_earlier).toBe(true);
    const earlier = store.view(story.id, { before: tail.beats[0].id, limit: 2 });
    expect(earlier.beats).toHaveLength(2);
    expect(earlier.beats.map((entry) => entry.id)).not.toContain(tail.beats[0].id);
  });

  test('ending an episode is local and returning never advances time', () => {
    story = store.episode(story.id, story.revision, { action: 'end', summary: 'They reached an understanding.' });
    expect(store.current(story.id).state.episode.status).toBe('ended');
    expect(() => store.beginRequest(story.id, story.revision, 'end', {})).toThrow('episode has ended');
    expect(store.view(story.id).revision).toBe(story.revision);
    story = store.episode(story.id, story.revision, { action: 'start', title: 'The visit' });
    expect(story.state.episode.number).toBe(2);
  });

  test('effects require evidence and cannot overwrite truth or invent owned promises', () => {
    const context = store.current(story.id);
    const args = { prose: 'Mara promised to help.', input: { text: 'I listen.' }, beatId: 'next' };
    expect(() => applyEffects(context.state, [{ op: 'remember', fact: fact('new', 'A promise.'), evidence: 'not present' }], args)).toThrow('evidence');
    expect(() => applyEffects(context.state, [{ op: 'remember', fact: fact('culprit', 'A different buyer.'), evidence: 'Mara promised' }], args)).toThrow('overwrite');
    context.state.control.character_id = 'mara';
    expect(() => applyEffects(context.state, [{ op: 'remember', fact: fact('promise', 'Mara promised to help.', { kind: 'commitment', actor_id: 'mara' }), evidence: 'Mara promised' }], args)).toThrow('invent a commitment');
  });

  test('commits a generated beat and its effects atomically; replay never purchases again', async () => {
    const completion = jest.fn().mockResolvedValue({ content: JSON.stringify({ prose: 'Mara promised to help.', summary: 'Mara offers help.', effects: [{ op: 'remember', fact: fact('promise', 'Mara promised to help.', { kind: 'commitment', actor_id: 'mara' }), evidence: 'Mara promised to help.' }] }), model: 'test', cost_usd: 0.01, billed_attempts: 1 });
    const service = createFictionService({ store, chatCompletion: completion });
    const request = { gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'one', input: { kind: 'follow' } };
    const result = await service.reply(request);
    expect(result.story.state.facts[0].id).toBe('promise');
    expect(result.story.beats.at(-1).prose).toBe('Mara promised to help.');
    expect((await service.reply(request)).reused).toBe(true);
    expect(completion).toHaveBeenCalledTimes(1);
    await expect(service.reply({ ...request, input: { kind: 'steer', text: 'Something else.' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('a changed provider snapshot stops before purchasing', async () => {
    const completion = jest.fn();
    const service = createFictionService({ store, chatCompletion: completion, providers: { exposure: () => ({ provider: { id: 'different' }, model_id: 'test' }) } });
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'changed-provider', input: { kind: 'follow' }, providerId: 'reviewed', model: 'test' })).rejects.toMatchObject({ code: 'STORY_PROVIDER_CHANGED', billedAttempts: 0 });
    expect(completion).not.toHaveBeenCalled();
    expect(store.view(story.id).head_beat_id).toBe(story.head_beat_id);
  });

  test('completed replay stays free even after provider settings change', async () => {
    const exposure = jest.fn().mockReturnValue({ provider: { id: 'reviewed' }, model_id: 'test' });
    const completion = jest.fn().mockResolvedValue({ content: JSON.stringify({ prose: 'Mara waits.', summary: 'A pause.', effects: [] }), model: 'test', cost_usd: 0.01, billed_attempts: 1 });
    const service = createFictionService({ store, chatCompletion: completion, providers: { exposure } });
    const request = { gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'reviewed', input: { kind: 'follow' }, providerId: 'reviewed', model: 'test' };
    await service.reply(request);
    exposure.mockReturnValue({ provider: { id: 'different' }, model_id: 'other' });
    expect((await service.reply(request)).reused).toBe(true);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  test('rejects overlapping actions while a paid response is pending', async () => {
    let release;
    const service = createFictionService({ store, chatCompletion: () => new Promise((resolve) => { release = resolve; }) });
    const pending = service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'pending', input: { kind: 'follow' } });
    expect(() => store.control(story.id, story.revision, 'mara')).toThrow('in progress');
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'other', input: { kind: 'follow' } })).rejects.toMatchObject({ code: 'STORY_BUSY' });
    release({ content: JSON.stringify({ prose: 'Mara looks away.', summary: 'A quiet moment.', effects: [] }), cost_usd: 0.02 });
    await pending;
  });

  test('malformed paid results retain charges but save neither prose nor partial effects', async () => {
    const service = createFictionService({ store, chatCompletion: async () => ({ content: JSON.stringify({ prose: 'Mara leaves.', summary: 'She leaves.', effects: [{ op: 'remember', fact: fact('ok', 'Mara leaves.'), evidence: 'Mara leaves.' }, { op: 'remember', fact: fact('bad', 'She pays.'), evidence: 'absent' }] }), cost_usd: 0.03, billed_attempts: 1 }) });
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'bad', input: { kind: 'follow' } })).rejects.toMatchObject({ statusCode: 502, costUsd: 0.03 });
    expect(store.view(story.id).head_beat_id).toBe(story.head_beat_id);
    expect(store.current(story.id).state.facts).toHaveLength(1);
    expect(db.prepare('SELECT status, cost_usd FROM fiction_requests').get()).toMatchObject({ status: 'failed', cost_usd: 0.03 });
  });

  test('restart interruption prevents late commits and cannot be silently retried', () => {
    const request = store.beginRequest(story.id, story.revision, 'restart', {});
    expect(store.reconcile()).toBe(1);
    expect(() => store.completeRequest(request.request, {})).toThrow('no longer active');
    expect(() => store.beginRequest(story.id, story.revision, 'restart', {})).toThrow('new explicit action');
    expect(store.view(story.id).head_beat_id).toBe(story.head_beat_id);
  });
});
