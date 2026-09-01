'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTestApp, resetDb, createStory } = require('./helpers');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

const WRITER_A = 'writer-tab-a';
const WRITER_B = 'writer-tab-b';

function reply(content, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return { data: { choices: [{ message: { content } }], usage } };
}

function post(app, storyId, pathName, body, { key, writer = WRITER_A } = {}) {
  return request(app)
    .post(`/api/stories/${storyId}${pathName}`)
    .set('Idempotency-Key', key || `${pathName}:${Math.random()}`)
    .set('X-InkMorrow-Writer-Session', writer)
    .send(body || {});
}

describe('PR 06 transactional writing state machine', () => {
  let fixture;

  beforeAll(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_RETRY_BASE_DELAY = '1';
    fixture = createTestApp();
  });

  beforeEach(() => {
    resetDb(fixture.db);
    axios.post.mockReset();
    axios.get.mockReset();
  });

  afterAll(() => {
    fixture.close();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('promotes only the exact opaque prepared identity and never generates on Next Page', async () => {
    const story = await createStory(fixture.app);
    axios.post.mockResolvedValueOnce(reply('The exact prepared prose.'));
    const prepared = await post(fixture.app, story.id, '/pages/preview', {}, { key: 'prepare-one' }).expect(200);
    expect(prepared.body.preview.preview_id).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages').get().value).toBe(0);

    await post(fixture.app, story.id, '/pages/commit-preview', {
      preview_id: `${prepared.body.preview.preview_id}-wrong`,
    }, { key: 'promote-wrong' }).expect(409);
    expect(axios.post).toHaveBeenCalledTimes(1);

    const promoted = await post(fixture.app, story.id, '/pages/commit-preview', {
      preview_id: prepared.body.preview.preview_id,
    }, { key: 'promote-one' }).expect(201);
    expect(promoted.body.page.content).toBe('The exact prepared prose.');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(fixture.db.prepare('SELECT status FROM writing_operations WHERE idempotency_key = ?')
      .get('promote-one').status).toBe('committed');
  });

  it('replays repeated preparation and promotion keys without a second call or page', async () => {
    const story = await createStory(fixture.app);
    axios.post.mockResolvedValueOnce(reply('Prepared once.'));
    const first = await post(fixture.app, story.id, '/pages/preview', {}, { key: 'prepare-repeat' }).expect(200);
    const replay = await post(fixture.app, story.id, '/pages/preview', {}, { key: 'prepare-repeat' }).expect(200);
    expect(replay.body.preview.preview_id).toBe(first.body.preview.preview_id);
    expect(replay.body.replayed).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);

    const body = { preview_id: first.body.preview.preview_id };
    const committed = await post(fixture.app, story.id, '/pages/commit-preview', body, { key: 'promote-repeat' }).expect(201);
    const committedReplay = await post(fixture.app, story.id, '/pages/commit-preview', body, { key: 'promote-repeat' }).expect(201);
    expect(committedReplay.body.page.id).toBe(committed.body.page.id);
    expect(committedReplay.body.replayed).toBe(true);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(1);
  });

  it('consumes the preview when directed work starts and saves no partial page on failure', async () => {
    const story = await createStory(fixture.app);
    axios.post.mockResolvedValueOnce(reply('A prepared road.'));
    await post(fixture.app, story.id, '/pages/preview', {}, { key: 'prepare-before-direction' }).expect(200);
    axios.post.mockRejectedValueOnce(Object.assign(new Error('provider offline'), { response: { status: 400 } }));

    const failed = await post(fixture.app, story.id, '/pages/generate', {
      user_input: 'Take the dangerous road.',
    }, { key: 'directed-failure' }).expect(502);
    expect(failed.body.error).toContain('provider');
    expect((await request(fixture.app).get(`/api/stories/${story.id}/pages/preview`)).body.preview).toBeNull();
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(0);
    const operation = fixture.db.prepare('SELECT * FROM writing_operations WHERE idempotency_key = ?').get('directed-failure');
    expect(operation.status).toBe('failed');
    expect(JSON.parse(operation.request_json).direction).toBe('Take the dangerous road.');
  });

  it('lets only one reordered directed reply cross the canon boundary', async () => {
    const story = await createStory(fixture.app);
    const replies = [];
    axios.post.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    const first = post(fixture.app, story.id, '/pages/generate', { user_input: 'First road.' }, { key: 'direct-a' }).then((res) => res);
    while (replies.length < 1) await new Promise((resolve) => setImmediate(resolve));
    const second = post(fixture.app, story.id, '/pages/generate', { user_input: 'Second road.' }, { key: 'direct-b' }).then((res) => res);
    while (replies.length < 2) await new Promise((resolve) => setImmediate(resolve));

    replies[1](reply('The second reply landed first.'));
    expect((await second).status).toBe(201);
    replies[0](reply('The old reply arrived later.'));
    const stale = await first;
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CANON_ADVANCED');
    const pages = fixture.db.prepare('SELECT content FROM story_pages WHERE story_id = ?').all(story.id);
    expect(pages.map((row) => row.content)).toEqual(['The second reply landed first.']);
  });

  it('does not make a second provider call for a repeated in-flight key and honors cancellation', async () => {
    const story = await createStory(fixture.app);
    let resolveProvider;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { resolveProvider = resolve; }));
    const running = post(fixture.app, story.id, '/pages/generate', { user_input: 'Wait at the threshold.' }, {
      key: 'cancel-this-operation',
    }).then((res) => res);
    while (!resolveProvider) await new Promise((resolve) => setImmediate(resolve));

    const duplicate = await post(fixture.app, story.id, '/pages/generate', {
      user_input: 'Wait at the threshold.',
    }, { key: 'cancel-this-operation' }).expect(409);
    expect(duplicate.body.code).toBe('OPERATION_IN_PROGRESS');
    expect(axios.post).toHaveBeenCalledTimes(1);

    const cancelled = await request(fixture.app)
      .delete(`/api/stories/${story.id}/writing-operations/cancel-this-operation`)
      .set('X-InkMorrow-Writer-Session', WRITER_A)
      .expect(200);
    expect(cancelled.body.operation).toMatchObject({ status: 'failed', error_code: 'CANCELLED' });

    resolveProvider(reply('A complete reply that arrived after cancellation.'));
    const late = await running;
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CANCELLED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(0);
  });

  it('rejects a competing tab and lets it reconcile after lease expiry', async () => {
    let now = new Date('2026-08-31T10:00:00.000Z');
    const timed = createTestApp({ clock: () => now, writerLeaseMs: 1000 });
    try {
      const story = await createStory(timed.app);
      await request(timed.app).post(`/api/stories/${story.id}/writer-lease`)
        .set('X-InkMorrow-Writer-Session', WRITER_A).send({}).expect(200);
      const conflict = await request(timed.app).post(`/api/stories/${story.id}/writer-lease`)
        .set('X-InkMorrow-Writer-Session', WRITER_B).send({}).expect(409);
      expect(conflict.body.code).toBe('WRITER_LEASE_CONFLICT');
      expect(conflict.body.state.writer_session_id).toBe(WRITER_A);
      expect(conflict.body.state.reconcile).toContain('Refresh');

      now = new Date(now.getTime() + 1001);
      const acquired = await request(timed.app).post(`/api/stories/${story.id}/writer-lease`)
        .set('X-InkMorrow-Writer-Session', WRITER_B).send({}).expect(200);
      expect(acquired.body.lease.writer_session_id).toBe(WRITER_B);
    } finally {
      timed.close();
    }
  });

  it('applies the same writer lease to manual canon mutations', async () => {
    const story = await createStory(fixture.app);
    await request(fixture.app).post(`/api/stories/${story.id}/writer-lease`)
      .set('X-InkMorrow-Writer-Session', WRITER_A).send({}).expect(200);
    const conflict = await request(fixture.app).post(`/api/stories/${story.id}/pages`)
      .set('X-InkMorrow-Writer-Session', WRITER_B)
      .send({ content: 'A competing manual page.' })
      .expect(409);
    expect(conflict.body.code).toBe('WRITER_LEASE_CONFLICT');
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(0);
    await request(fixture.app).post(`/api/stories/${story.id}/volumes`)
      .set('X-InkMorrow-Writer-Session', WRITER_B)
      .send({ title: 'Competing structure' })
      .expect(409);
  });

  it('lets an identified tab replace an idle compatibility-client lease', async () => {
    const story = await createStory(fixture.app);
    await request(fixture.app).post(`/api/stories/${story.id}/pages`)
      .send({ content: 'Imported by an older client.' })
      .expect(201);
    expect(fixture.db.prepare('SELECT writer_session_id FROM writer_leases WHERE story_id = ?')
      .get(story.id).writer_session_id).toBe('legacy-client');
    const acquired = await request(fixture.app).post(`/api/stories/${story.id}/writer-lease`)
      .set('X-InkMorrow-Writer-Session', WRITER_A)
      .send({})
      .expect(200);
    expect(acquired.body.lease.writer_session_id).toBe(WRITER_A);

    await request(fixture.app).delete(`/api/stories/${story.id}/writer-lease`)
      .set('X-InkMorrow-Writer-Session', WRITER_A)
      .expect(204);
    fixture.app.locals.writingTransactions.acquireLease(story.id, 'compat:authenticated-api-client');
    const authenticatedCompatibility = await request(fixture.app)
      .post(`/api/stories/${story.id}/writer-lease`)
      .set('X-InkMorrow-Writer-Session', WRITER_B)
      .send({})
      .expect(200);
    expect(authenticatedCompatibility.body.lease.writer_session_id).toBe(WRITER_B);
  });

  it('binds a prepared page to the active manuscript destination', async () => {
    const story = await createStory(fixture.app);
    axios.post.mockResolvedValueOnce(reply('Prepared for the original chapter.'));
    const prepared = await post(fixture.app, story.id, '/pages/preview', {}, { key: 'target-bound-preview' }).expect(200);
    await request(fixture.app).delete(`/api/stories/${story.id}/writer-lease`)
      .set('X-InkMorrow-Writer-Session', WRITER_A)
      .expect(204);
    await request(fixture.app).post(`/api/stories/${story.id}/volumes`)
      .set('X-InkMorrow-Writer-Session', WRITER_B)
      .send({ title: 'A new destination' })
      .expect(201);
    const stale = await post(fixture.app, story.id, '/pages/commit-preview', {
      preview_id: prepared.body.preview.preview_id,
    }, { key: 'stale-target-promotion', writer: WRITER_B }).expect(409);
    expect(stale.body.code).toBe('PREVIEW_STALE');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(0);
  });

  it('rewrites the tail through one durable operation and replays its result', async () => {
    const story = await createStory(fixture.app);
    await request(fixture.app).post(`/api/stories/${story.id}/pages`)
      .set('X-InkMorrow-Writer-Session', WRITER_A)
      .send({ content: 'The original tail.', user_input: 'Begin.' })
      .expect(201);
    axios.post.mockResolvedValueOnce(reply('The rewritten tail.'));
    const first = await post(fixture.app, story.id, '/pages/regenerate', {}, { key: 'rewrite-once' }).expect(200);
    const replay = await post(fixture.app, story.id, '/pages/regenerate', {}, { key: 'rewrite-once' }).expect(200);
    expect(first.body.page.content).toBe('The rewritten tail.');
    expect(replay.body.page.id).toBe(first.body.page.id);
    expect(replay.body.replayed).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM page_revisions WHERE page_id = ?')
      .get(first.body.page.id).value).toBe(2);
    expect(fixture.db.prepare('SELECT kind, status FROM writing_operations WHERE idempotency_key = ?')
      .get('rewrite-once')).toEqual({ kind: 'regenerate', status: 'committed' });
  });

  it('records stale provider spend while keeping speculative and committed totals distinct', async () => {
    const story = await createStory(fixture.app);
    axios.post.mockResolvedValueOnce(reply('Speculative prose.'));
    await post(fixture.app, story.id, '/pages/preview', {}, { key: 'cost-preview' }).expect(200);
    const state = await request(fixture.app).get(`/api/stories/${story.id}/writing-state`).expect(200);
    expect(state.body.costs.speculative_spend_usd).toBeGreaterThanOrEqual(0);
    expect(state.body.costs.current_prepared_spend_usd).toBeGreaterThanOrEqual(0);
    expect(state.body.costs.committed_story_total_usd).toBe(0);
    expect(fixture.db.prepare('SELECT provider_result_json FROM writing_operations WHERE idempotency_key = ?')
      .get('cost-preview').provider_result_json).toContain('prompt_tokens');
  });

  it('marks an abandoned running operation failed on restart but keeps a completed prepared page', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-writing-restart-'));
    const dbPath = path.join(root, 'story.db');
    let firstDb;
    let secondDb;
    let firstApp;
    let secondApp;
    try {
      firstDb = createDb(dbPath);
      firstApp = createApp(firstDb, { staticDir: null, autoSuccessorEnabled: false });
      const story = await createStory(firstApp);
      axios.post.mockResolvedValueOnce(reply('Restart-safe prepared prose.'));
      const prepared = await post(firstApp, story.id, '/pages/preview', {}, { key: 'restart-ready' }).expect(200);
      const source = firstDb.prepare('SELECT * FROM writing_operations WHERE idempotency_key = ?').get('restart-ready');
      firstDb.prepare(`
        INSERT INTO writing_operations
          (id, story_id, sequence, idempotency_key, request_hash, kind, status,
           writer_session_id, lease_token, context_fingerprint, request_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'prepare', 'running', ?, ?, ?, '{}', ?, ?)
      `).run('abandoned-op', story.id, source.sequence + 1, 'abandoned-key', 'a'.repeat(64),
        WRITER_A, source.lease_token, source.context_fingerprint, source.created_at, source.updated_at);
      firstApp.locals.dispose();
      firstDb.close();
      firstDb = null;

      secondDb = createDb(dbPath);
      secondApp = createApp(secondDb, { staticDir: null, autoSuccessorEnabled: false });
      expect(secondDb.prepare('SELECT status, error_code FROM writing_operations WHERE id = ?').get('abandoned-op'))
        .toMatchObject({ status: 'failed', error_code: 'RESTART_INTERRUPTED' });
      const status = await request(secondApp).get(`/api/stories/${story.id}/pages/preview`).expect(200);
      expect(status.body.preview.preview_id).toBe(prepared.body.preview.preview_id);
    } finally {
      firstApp?.locals.dispose?.();
      secondApp?.locals.dispose?.();
      firstDb?.close?.();
      secondDb?.close?.();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('starts exactly one durable successor after a successful canon action', async () => {
    const automatic = createTestApp({ autoSuccessorEnabled: true });
    try {
      const story = await createStory(automatic.app);
      axios.post
        .mockResolvedValueOnce(reply('The directed canonical page.'))
        .mockResolvedValueOnce(reply('The one prepared successor.'));
      const committed = await post(automatic.app, story.id, '/pages/generate', {
        user_input: 'Open the gate.',
      }, { key: 'canon-with-successor' }).expect(201);
      expect(committed.body.page.content).toBe('The directed canonical page.');
      expect(committed.body.successor_pending).toBe(true);
      for (let attempt = 0; attempt < 30 && axios.post.mock.calls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(axios.post).toHaveBeenCalledTimes(2);
      const operations = automatic.db.prepare(`
        SELECT kind, status FROM writing_operations WHERE story_id = ? ORDER BY sequence
      `).all(story.id);
      expect(operations).toEqual([
        { kind: 'directed_generate', status: 'committed' },
        { kind: 'prepare', status: 'succeeded' },
      ]);
      expect(automatic.db.prepare('SELECT COUNT(*) AS value FROM prepared_pages WHERE story_id = ?').get(story.id).value).toBe(1);
    } finally {
      automatic.close();
    }
  });

  it('invalidates provider replies after lease loss without touching canon', async () => {
    let now = new Date('2026-08-31T12:00:00.000Z');
    const timed = createTestApp({ clock: () => now, writerLeaseMs: 1000 });
    try {
      const story = await createStory(timed.app);
      const replies = [];
      axios.post.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
      const old = post(timed.app, story.id, '/pages/generate', { user_input: 'Old tab writes.' }, {
        key: 'lease-old', writer: WRITER_A,
      }).then((res) => res);
      while (replies.length < 1) await new Promise((resolve) => setImmediate(resolve));
      now = new Date(now.getTime() + 1001);
      await request(timed.app).post(`/api/stories/${story.id}/writer-lease`)
        .set('X-InkMorrow-Writer-Session', WRITER_B).send({}).expect(200);
      replies[0](reply('This reply no longer owns the lease.'));
      const stale = await old;
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('WRITER_LEASE_LOST');
      expect(timed.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(0);
    } finally {
      timed.close();
    }
  });
});
