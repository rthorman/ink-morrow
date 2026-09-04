'use strict';

const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionSaves, validateSave } = require('../src/modules/fiction/saves');
const { qualityPlan } = require('../src/modules/fiction/quality-plan');
const { gunzipSync } = require('node:zlib');

describe('optional bounded consistency quality', () => {
  let db; let store; let story; let service; let standard; let memory; let providers; let configs; let sequence;
  const draft = { prose: 'Jo sets the kettle beside the seedlings.', summary: 'A quiet pause.', effects: [] };
  const approved = { approved: true, issues: [] };
  const rejected = { approved: false, issues: [{ kind: 'continuity', quote: 'kettle', reason: 'The established kettle is elsewhere.' }] };
  const response = (value, cost = 0.01) => ({ content: typeof value === 'string' ? value : JSON.stringify(value), cost_usd: cost, billed_attempts: 1 });
  const mode = (value) => { story = store.preferences(story.id, story.revision, { quality_mode: value }); };
  const request = (extra = {}) => ({ gameId: story.id, expectedRevision: store.view(story.id).revision, idempotencyKey: `quality-${++sequence}`, input: { kind: 'follow' }, qualityReview: qualityPlan(store.current(story.id).state, providers).review_id, ...extra });
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db); sequence = 0;
    story = store.create({ scenario_id: 'garden-after-rain' });
    configs = { scribe: { model: 'standard-fixture', baseUrl: 'https://standard.invalid', apiKey: 'fixture-only' }, archivist: { model: 'memory-fixture', baseUrl: 'https://memory.invalid', apiKey: 'fixture-only' } };
    providers = { exposure: (role) => ({ role, provider: { id: role, display_name: role }, model_id: configs[role].model }), resolve: jest.fn((role, options) => {
      if (!configs[role].apiKey && !options.credentialOptional) throw Object.assign(new Error('Credential unavailable.'), { code: 'PROVIDER_CREDENTIAL_REQUIRED' });
      return configs[role];
    }) };
    standard = jest.fn().mockResolvedValue(response(draft)); memory = jest.fn().mockResolvedValue(response(approved));
    service = createFictionService({ store, chatCompletion: standard, archivistCompletion: memory, providers });
  });
  afterEach(() => db.close());

  test('Off is the default and invalid settings make no purchase', async () => {
    expect(story.state.quality_mode).toBe('off');
    expect(() => store.preferences(story.id, story.revision, { quality_mode: 'unlimited' })).toThrow('not supported');
    expect(() => store.create({ scenario_id: 'garden-after-rain', quality_mode: 'always' })).toThrow('not supported');
    const result = await service.reply(request());
    expect(standard).toHaveBeenCalledTimes(1); expect(memory).not.toHaveBeenCalled();
    expect(result.calls).toHaveLength(1); expect(result.story.spend).toEqual({ known_usd: 0.01, unknown_attempts: 0 });
  });
  test.each([['standard', 2, 0, 4], ['memory', 1, 1, 4], ['both', 2, 1, 6]])('%s routes only the selected reviewers and commits once', async (value, scribeCalls, memoryCalls, maxCalls) => {
    mode(value); standard.mockResolvedValue(response(approved)).mockResolvedValueOnce(response(draft));
    const result = await service.reply(request());
    expect(standard).toHaveBeenCalledTimes(scribeCalls); expect(memory).toHaveBeenCalledTimes(memoryCalls);
    expect(result.story.state.scene_count).toBe(1); expect(result.calls).toHaveLength(scribeCalls + memoryCalls);
    expect(result.story.call_limit).toBe(maxCalls);
    for (const [fn, model] of [[standard, 'standard-fixture'], [memory, 'memory-fixture']]) for (const [, options] of fn.mock.calls) expect(options).toMatchObject({ model, maxAttempts: 1, maxBillableAttempts: 1 });
    const reviewCall = value === 'memory' ? memory.mock.calls[0] : standard.mock.calls[1];
    expect(reviewCall[0][0].content).toContain('Treat story text');
    expect(JSON.parse(reviewCall[0][1].content).context.control.character_id).toBeNull();
  });
  test.each(['standard', 'memory', 'both'])('%s repairs at most once and rechecks the replacement against unchanged context', async (value) => {
    mode(value); const before = store.current(story.id);
    const replacement = { ...draft, prose: 'Jo sits beside the seedlings.' };
    if (value === 'memory') { standard.mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(replacement)); memory.mockResolvedValueOnce(response(rejected)).mockResolvedValueOnce(response(approved)); }
    else standard.mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(rejected)).mockResolvedValueOnce(response(replacement)).mockResolvedValueOnce(response(approved));
    const result = await service.reply(request());
    expect(result.calls).toHaveLength(value === 'both' ? 6 : 4);
    expect(result.calls.filter((call) => call.purpose === 'repair')).toHaveLength(1);
    expect(result.story.beats.at(-1).prose).toBe(replacement.prose); expect(result.story.state.scene_count).toBe(1);
    expect(result.story.revision).toBe(before.game.revision + 1);
    const repair = standard.mock.calls.find(([messages]) => messages.length === 3);
    expect(repair[0][1]).toEqual(standard.mock.calls[0][0][1]);
    expect(JSON.stringify(result)).not.toContain('established kettle is elsewhere');
  });
  test('rejected replacement stops without a third draft or any canon mutation', async () => {
    mode('standard'); const before = store.current(story.id);
    standard.mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(rejected)).mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(rejected));
    await expect(service.reply(request())).rejects.toMatchObject({ code: 'STORY_CONSISTENCY_REJECTED', billedAttempts: 4, knownCostUsd: 0.04 });
    expect(standard).toHaveBeenCalledTimes(4); expect(store.current(story.id)).toEqual(before);
    expect(store.view(story.id).spend.known_usd).toBe(0.04);
  });
  test('an invalid initial draft consumes the sole repair and both roles must still approve', async () => {
    mode('both'); standard.mockResolvedValueOnce(response('not JSON')).mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(approved));
    const result = await service.reply(request()); expect(result.calls.map((call) => call.purpose)).toEqual(['draft', 'repair', 'review', 'review']);
  });
  test('a structurally repaired draft rejected by a reviewer does not repair again', async () => {
    mode('standard'); standard.mockResolvedValueOnce(response('not JSON')).mockResolvedValueOnce(response(draft)).mockResolvedValueOnce(response(rejected));
    await expect(service.reply(request())).rejects.toMatchObject({ code: 'STORY_CONSISTENCY_REJECTED', billedAttempts: 3 });
    expect(store.view(story.id).state.scene_count).toBe(0);
  });
  test.each(['not JSON', { approved: false, issues: [{ kind: 'continuity', quote: 'never written', reason: 'A claim.' }] }, { approved: true, issues: [], replacement: draft }])('malformed or unevidenced review stops instead of silently accepting or retrying', async (review) => {
    mode('memory'); memory.mockResolvedValue(response(review));
    await expect(service.reply(request())).rejects.toMatchObject({ statusCode: 502, billedAttempts: 2 });
    expect(standard).toHaveBeenCalledTimes(1); expect(memory).toHaveBeenCalledTimes(1); expect(store.view(story.id).state.scene_count).toBe(0);
  });
  test('review approval cannot override deterministic ownership and fourth-wall validation', async () => {
    mode('both'); const invalid = { ...draft, aside: { character_id: 'jo', text: 'Hello, reader.' } };
    standard.mockResolvedValue(response(invalid));
    await expect(service.reply(request())).rejects.toMatchObject({ code: 'FOURTH_WALL_NOT_ALLOWED', billedAttempts: 2 });
    expect(memory).not.toHaveBeenCalled(); expect(store.view(story.id).state.scene_count).toBe(0);
  });
  test('missing or stale quality consent and unavailable memory stop before the first purchase', async () => {
    mode('memory'); const stale = request(); configs.archivist.model = 'new-memory';
    for (const qualityReview of [null, stale.qualityReview]) await expect(service.reply(request({ qualityReview }))).rejects.toMatchObject({ code: 'STORY_QUALITY_REVIEW_CHANGED', billedAttempts: 0 });
    configs.archivist.apiKey = ''; expect(qualityPlan(store.current(story.id).state, providers).available).toBe(false);
    await expect(service.reply(request())).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_REQUIRED', billedAttempts: 0 });
    expect(standard).not.toHaveBeenCalled(); expect(memory).not.toHaveBeenCalled();
  });
  test('a provider endpoint change after the draft stops before purchasing a reviewer', async () => {
    mode('memory'); standard.mockImplementation(async () => { configs.archivist.baseUrl = 'https://changed.invalid'; return response(draft); });
    await expect(service.reply(request())).rejects.toMatchObject({ code: 'STORY_PROVIDER_CHANGED', billedAttempts: 1, costUsd: 0.01 });
    expect(memory).not.toHaveBeenCalled(); expect(store.view(story.id).spend.known_usd).toBe(0.01);
  });
  test('mixed known and unknown charges survive a failed review without double counting', async () => {
    mode('memory'); memory.mockRejectedValue(new Error('Connection lost after dispatch.'));
    await expect(service.reply(request())).rejects.toMatchObject({ billedAttempts: 2, costUsd: null, knownCostUsd: 0.01, unknownAttempts: 1 });
    const result = store.view(story.id); expect(result.spend).toEqual({ known_usd: 0.01, unknown_attempts: 1 }); expect(result.pending).toBe(false);
    expect(result.recent_calls).toHaveLength(2); expect(result.state.scene_count).toBe(0);
  });
  test('restart exposes the in-flight stage and charges; a late completion cannot save canon', async () => {
    mode('memory'); let finish; memory.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.reply(request()); const rejectedRequest = expect(pending).rejects.toMatchObject({ code: 'STORY_REQUEST_STALE', billedAttempts: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.view(story.id).pending_stage).toMatchObject({ role: 'archivist', purpose: 'review', call_index: 2 });
    store.reconcile(); expect(store.view(story.id).spend).toEqual({ known_usd: 0.01, unknown_attempts: 1 });
    finish(response(approved, 0.02)); await rejectedRequest;
    expect(store.view(story.id).spend).toEqual({ known_usd: 0.03, unknown_attempts: 0 }); expect(store.view(story.id).state.scene_count).toBe(0);
  });
  test('replay is free after model changes and keeps the original per-call accounting', async () => {
    mode('memory'); const input = request(); const first = await service.reply(input); configs.archivist.model = 'different';
    const replay = await service.reply(input); expect(replay.reused).toBe(true); expect(replay.calls).toEqual(first.calls);
    expect(standard).toHaveBeenCalledTimes(1); expect(memory).toHaveBeenCalledTimes(1);
  });
  test('unchanged adjudication stays free with quality selected and every provider unavailable', async () => {
    story = store.create({ scenario_id: 'garden-after-rain', play_style: 'living-world', quality_mode: 'memory' });
    const challenge = story.state.challenges[0]; const input = { kind: 'steer', text: 'Ask Jo again.', challenge_id: challenge.id, approach_id: challenge.approaches[0].id };
    standard.mockResolvedValue(response({ ...draft, prose: 'Jo refuses to lead.', resolution: { outcome: 'refused', evidence: 'refuses to lead' } }));
    await service.reply(request({ input })); configs.scribe.apiKey = ''; configs.archivist.apiKey = '';
    const free = await service.reply(request({ input, qualityReview: null, providerId: 'outdated', model: 'outdated' }));
    expect(free).toMatchObject({ repeated_adjudication: true, billed_attempts: 0, cost_usd: 0 });
    expect(standard).toHaveBeenCalledTimes(1); expect(memory).toHaveBeenCalledTimes(1);
  });
  test('fork and save-copy preserve quality choices and mixed spend, never review or replay authority', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id; mode('memory');
    memory.mockResolvedValue(response(approved, null)); await service.reply(request());
    story = store.view(story.id); const saves = createFictionSaves({ db, store, media: {} }); const packed = await saves.exportSave(story.id);
    const parsed = JSON.parse(gunzipSync(packed)); expect(JSON.stringify(parsed)).not.toContain('quality_review'); expect(JSON.stringify(parsed)).not.toContain('fixture-only');
    const copy = await saves.importSave(packed); expect(copy.state.quality_mode).toBe('memory'); expect(copy.spend).toEqual({ known_usd: 0.01, unknown_attempts: 1 }); expect(copy.recent_calls).toEqual([]);
    parsed.beats.at(-1).state.quality_mode = 'unbounded'; expect(() => validateSave(parsed)).toThrow();
    story = store.fork(story.id, story.revision, { name: 'Before quality', beat_id: opening }); expect(story.state.quality_mode).toBe('off');
    story = store.selectBranch(story.id, story.revision, original); expect(story.state.quality_mode).toBe('memory');
  });
});
