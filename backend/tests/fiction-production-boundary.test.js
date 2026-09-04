'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');
const { setupOwner } = require('./helpers');

describe('5.0 production surface', () => {
  let root, db, app;
  beforeEach(() => {
    axios.post.mockReset(); axios.get.mockReset();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-production-boundary-'));
    db = createDb(':memory:');
    app = createApp(db, {
      authRequired: true,
      imageDir: path.join(root, 'images'),
      logger: { log() {}, error() {} },
      providerOptions: { env: { CONTINUITY_MODEL: 'invalid-retired-setting', OPENROUTER_API_KEY: 'fixture-key' } },
      authOptions: { setupCode: 'BOUNDARY-FIXTURE', scryptParams: { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 }, delay: async () => {} },
    });
  });
  afterEach(() => { app.locals.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

  test('startup and local play instantiate no retired queues and make no provider calls', async () => {
    await app.locals.validateStartup();
    for (const key of ['continuity', 'writing', 'publicationShares', 'audiobookQueue', 'imageQueue']) expect(app.locals[key]).toBeUndefined();
    const agent = request.agent(app);
    const owner = await setupOwner(agent, app);
    const created = await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ scenario_id: 'drowned-bell' }).expect(201);
    expect(created.body.story.state.scene_count).toBe(0);
    await agent.get(`/api/fiction/${created.body.story.id}/recap`).expect(200);
    expect(axios.post).not.toHaveBeenCalled(); expect(axios.get).not.toHaveBeenCalled();
  });

  test('new private APIs remain sealed and retired APIs/public shares are not available', async () => {
    for (const route of ['/api/fiction', '/api/providers', '/api/capabilities', '/api/stories', '/api/share/anything']) await request(app).get(route).expect(401);
    for (const route of ['/share', '/share/', '/share.html']) await request(app).get(route).expect(404);
    const agent = request.agent(app); const owner = await setupOwner(agent, app);
    for (const route of ['/api/stories', '/api/worlds', '/api/characters', '/api/scribes', '/api/storage', '/api/disk', '/api/share/anything']) await agent.get(route).expect(404);
    for (const route of ['/api/stories', '/api/ai/world', '/api/stories/old/pages/generate', '/api/stories/old/pages', '/api/stories/old/audiobook']) await agent.post(route).set('X-InkMorrow-CSRF', owner.csrf_token).send({}).expect(404);
    const capabilities = (await agent.get('/api/capabilities').expect(200)).body;
    expect(capabilities).toMatchObject({ release_train: '5.0.0', database: { family: 'ink-morrow-5' }, archive: { status: 'retired' }, playable_save: { status: 'available' } });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('raw opening prose cannot bypass the new-product boundary', async () => {
    const agent = request.agent(app); const owner = await setupOwner(agent, app);
    for (const body of [{ title: 'No editor', premise: 'A reunion.', opening: 'Hand-written scene.' }, { scenario_id: 'drowned-bell', opening: 'Replacement prose.' }, { scenario_id: 'drowned-bell', opening: '' }]) {
      await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send(body).expect(400);
    }
    expect((await agent.get('/api/fiction')).body.stories).toHaveLength(0);
    await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ title: 'A new situation', premise: 'Two friends meet again.' }).expect(201);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('terminal recovery uses the same 5.0 storage selection', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-reset-v5-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const reset = (dataDir, dbPath = '') => spawnSync(process.execPath, [path.resolve(__dirname, '../reset-password.js'), '--yes'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, DATA_DIR: dataDir, DB_PATH: dbPath, OPENROUTER_API_KEY: 'fixture-key', NODE_ENV: 'test' },
  });
  async function owned(file) {
    const database = createDb(file);
    const application = createApp(database, { staticDir: null, authRequired: true, imageDir: path.join(root, 'images'), logger: { log() {}, error() {} }, authOptions: { setupCode: 'RESET-FIXTURE', scryptParams: { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 } } });
    const agent = request.agent(application); const owner = await setupOwner(agent, application);
    await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ scenario_id: 'garden-after-rain' }).expect(201);
    application.locals.dispose(); database.close();
  }
  test('DATA_DIR-only reset clears the selected owner and preserves playable stories', async () => {
    const file = path.join(root, 'ink-morrow-5.db'); await owned(file);
    const result = reset(root); expect(result.status).toBe(0);
    const database = createDb(file);
    try { expect(database.prepare('SELECT COUNT(*) AS n FROM auth_owner').get().n).toBe(0); expect(database.prepare('SELECT COUNT(*) AS n FROM fiction_games').get().n).toBe(1); }
    finally { database.close(); }
  });
  test('an explicit DB_PATH takes precedence without resetting the other data directory', async () => {
    const first = path.join(root, 'ink-morrow-5.db'); const chosen = path.join(root, 'chosen.db'); await owned(first); await owned(chosen);
    expect(reset(root, chosen).status).toBe(0);
    const untouched = createDb(first); const changed = createDb(chosen);
    try { expect(untouched.prepare('SELECT COUNT(*) AS n FROM auth_owner').get().n).toBe(1); expect(changed.prepare('SELECT COUNT(*) AS n FROM auth_owner').get().n).toBe(0); }
    finally { untouched.close(); changed.close(); }
  });
  test('a missing database or in-memory configuration is refused without creating storage', () => {
    const missing = path.join(root, 'missing');
    const result = reset(missing); expect(result.status).toBe(2); expect(result.stderr).toContain('Nothing was removed'); expect(fs.existsSync(missing)).toBe(false);
    expect(reset(root, ':memory:').status).toBe(2); expect(fs.readdirSync(root)).toEqual([]);
  });
});
