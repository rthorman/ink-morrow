'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createDb, MIGRATIONS } = require('../src/db');
const { resetAuthentication } = require('../src/modules/auth/service');
const { createTestApp, setupOwner, createStory } = require('./helpers');

const PASSWORD = 'A long test password phrase';
const NEW_PASSWORD = 'A newer and longer test password phrase';
const CANARY = 'sk-provider-canary-NEVER-LEAK-998877';
const VAULT_OPTIONS = { scryptParams: { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 } };

function providerFixture(options = {}) {
  return createTestApp({
    ...options,
    providerOptions: { vaultOptions: VAULT_OPTIONS, ...(options.providerOptions || {}) },
  });
}

async function createProfile(client, csrf, overrides = {}) {
  let call = client.post('/api/providers');
  if (csrf) call = call.set('X-InkMorrow-CSRF', csrf);
  const response = await call.send({
    display_name: 'Local Compatible',
    base_url: 'https://provider.example/v1',
    capabilities: ['catalog', 'chat', 'speech'],
    timeout_ms: 9000,
    ...overrides,
  }).expect(201);
  return response.body.profile;
}

async function setCredential(client, csrf, profileId, body, status = 200) {
  let call = client.put(`/api/providers/${profileId}/credential`);
  if (csrf) call = call.set('X-InkMorrow-CSRF', csrf);
  return call.send(body).expect(status);
}

const binaryParser = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe('PR 04 provider profiles and role assignments', () => {
  it('upgrades schema 3 with isolated profile, role, envelope, and encrypted-entry tables', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-provider-migration-'));
    const dbPath = path.join(root, 'schema-3.db');
    try {
      let db = createDb(dbPath, { migrations: MIGRATIONS.slice(0, 3), reconcileOperations: false });
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(3);
      db.close();
      db = createDb(dbPath);
      expect(db.prepare('PRAGMA user_version').get().user_version).toBe(MIGRATIONS.length);
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      for (const table of ['provider_profiles', 'provider_role_assignments', 'provider_vault', 'provider_secrets']) {
        expect(tables.has(table)).toBe(true);
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      db.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes a read-only environment profile and performs no provider traffic for manual work', async () => {
    process.env.OPENROUTER_API_KEY = CANARY;
    const fixture = providerFixture();
    try {
      const status = await request(fixture.app).get('/api/providers').expect(200);
      const builtin = status.body.profiles.find((profile) => profile.id === 'openrouter-default');
      expect(builtin).toMatchObject({
        display_name: 'OpenRouter',
        builtin: true,
        credential: { source: 'environment', configured: true, read_only: true, state: 'ready' },
      });
      expect(JSON.stringify(status.body)).not.toContain(CANARY);
      expect(status.body.roles.map((entry) => entry.role).sort()).toEqual(['archivist', 'narrator', 'scribe']);
      expect(status.body.roles.find((entry) => entry.role === 'archivist')?.model_id)
        .toBe('google/gemini-2.5-flash-lite');

      const story = await createStory(fixture.app);
      await request(fixture.app)
        .post(`/api/stories/${story.id}/pages`)
        .send({ content: 'Written entirely by the owner.' })
        .expect(201);
      expect(axios.post).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();

      const custom = await createProfile(request(fixture.app), null);
      const refused = await setCredential(request(fixture.app), null, custom.id, { source: 'environment' }, 409);
      expect(refused.body.code).toBe('ENVIRONMENT_CREDENTIAL_READ_ONLY');
    } finally {
      fixture.close();
    }
  });

  it('uses a process-session credential and explicit Scribe assignment without returning the key', async () => {
    const fixture = providerFixture();
    try {
      const client = request(fixture.app);
      const profile = await createProfile(client, null);
      const credential = await setCredential(client, null, profile.id, { source: 'session', credential: CANARY });
      expect(credential.body.profile.credential).toMatchObject({ source: 'session', configured: true, state: 'ready' });
      expect(JSON.stringify(credential.body)).not.toContain(CANARY);
      await client.put('/api/providers/roles/scribe').send({
        profile_id: profile.id,
        model_id: 'vendor/story-model',
      }).expect(200);

      axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'The custom scribe answered.' } }] } });
      const story = await createStory(fixture.app);
      await client.post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Continue.' }).expect(201);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
      expect(axios.post.mock.calls[0][1].model).toBe('vendor/story-model');
      expect(axios.post.mock.calls[0][2].headers.Authorization).toBe(`Bearer ${CANARY}`);

      await client.put('/api/providers/roles/narrator').send({
        profile_id: profile.id,
        model_id: 'vendor/voice-model',
      }).expect(200);
      axios.get.mockResolvedValue({
        data: { data: [{ id: 'vendor/voice-model', supported_voices: ['moon_voice'], pricing: {} }] },
      });
      axios.post.mockReset();
      axios.post.mockRejectedValue({
        response: { status: 400, data: { error: { message: `refusal echoed ${CANARY}` } } },
      });
      const refused = await client.post(`/api/stories/${story.id}/pages/1/narrate`)
        .send({ model: 'vendor/voice-model', voice: 'moon_voice' })
        .expect(400);
      expect(JSON.stringify(refused.body)).not.toContain(CANARY);
      expect(JSON.stringify(fixture.logEntries)).not.toContain(CANARY);

      fixture.app.locals.providers.lockAll();
      const afterLock = await client.get('/api/providers').expect(200);
      expect(afterLock.body.profiles.find((entry) => entry.id === profile.id).credential.state).toBe('missing');
      expect(JSON.stringify(afterLock.body)).not.toContain(CANARY);
    } finally {
      fixture.close();
    }
  });

  it('preserves unavailable model choices and rejects role/capability mismatches', async () => {
    const fixture = providerFixture();
    try {
      const client = request(fixture.app);
      const profile = await createProfile(client, null, { capabilities: ['catalog', 'chat'] });
      await setCredential(client, null, profile.id, { source: 'session', credential: CANARY });
      await client.put('/api/providers/roles/scribe').send({
        profile_id: profile.id,
        model_id: 'vendor/removed-model',
      }).expect(200);
      await client.put('/api/providers/roles/archivist').send({
        profile_id: profile.id,
        model_id: 'vendor/removed-model',
      }).expect(200);
      const mismatch = await client.put('/api/providers/roles/narrator').send({
        profile_id: profile.id,
        model_id: 'vendor/voice',
      }).expect(409);
      expect(mismatch.body.code).toBe('PROVIDER_CAPABILITY_MISMATCH');

      axios.get.mockResolvedValue({ data: { data: [{ id: 'vendor/other-model', name: 'Other', pricing: {} }] } });
      await client.get(`/api/providers/${profile.id}/models`).expect(200);
      const state = await client.get('/api/providers').expect(200);
      for (const role of ['scribe', 'archivist']) {
        expect(state.body.roles.find((entry) => entry.role === role)).toMatchObject({
          profile_id: profile.id,
          model_id: 'vendor/removed-model',
          status: 'unavailable',
          model_verified: true,
        });
      }
    } finally {
      fixture.close();
    }
  });
});

describe('encrypted persistent provider vault', () => {
  it('encrypts profile-owned keys and excludes the canary from APIs, logs, and archives', async () => {
    const fixture = providerFixture({ authRequired: true });
    const agent = request.agent(fixture.app);
    try {
      const unlocked = await setupOwner(agent, fixture.app, PASSWORD);
      const first = await createProfile(agent, unlocked.csrf_token, { display_name: 'First Vault Profile' });
      const second = await createProfile(agent, unlocked.csrf_token, { display_name: 'Second Vault Profile' });
      await setCredential(agent, unlocked.csrf_token, first.id, {
        source: 'vault', credential: CANARY, password: PASSWORD,
      });
      await setCredential(agent, unlocked.csrf_token, second.id, {
        source: 'vault', credential: 'sk-second-provider-secret', password: PASSWORD,
      });

      const rows = fixture.db.prepare('SELECT * FROM provider_secrets ORDER BY profile_id').all();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => !Buffer.from(row.ciphertext).includes(Buffer.from('provider')))).toBe(true);
      expect(JSON.stringify(await agent.get('/api/providers').expect(200).then((res) => res.body))).not.toContain(CANARY);

      const firstRow = rows.find((row) => row.profile_id === first.id);
      const secondRow = rows.find((row) => row.profile_id === second.id);
      expect(() => fixture.db.prepare(`
        UPDATE provider_profiles SET credential_source = 'vault', secret_ref = ? WHERE id = ?
      `).run(secondRow.id, first.id)).toThrow(/belongs to another profile/);
      expect(() => fixture.db.prepare('UPDATE provider_secrets SET profile_id = ? WHERE id = ?')
        .run(second.id, firstRow.id)).toThrow(/ownership is immutable/);

      const planned = await agent
        .post('/api/transfers/exports/plan')
        .set('X-InkMorrow-CSRF', unlocked.csrf_token)
        .send({ scope: 'full', include_visuals: false, include_audio: false, include_working_history: true })
        .expect(200);
      expect(planned.body.exposure.excluded).toContain('credentials');
      const archive = await agent.get(planned.body.download_url).buffer().parse(binaryParser).expect(200);
      expect(archive.body.includes(Buffer.from(CANARY))).toBe(false);
      expect(JSON.stringify(fixture.logEntries)).not.toContain(CANARY);
    } finally {
      fixture.close();
    }
  });

  it('keeps a remembered web session usable after restart while the vault remains locked', async () => {
    const db = createDb(':memory:');
    const logger = { log: jest.fn(), error: jest.fn() };
    const appOptions = {
      staticDir: null,
      authRequired: true,
      authOptions: {
        setupCode: 'TEST-SETUP-CODE',
        scryptParams: { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 },
        delay: async () => {},
      },
      providerOptions: { vaultOptions: VAULT_OPTIONS },
      logger,
    };
    let first = createApp(db, appOptions);
    try {
      const setup = await request(first).post('/api/auth/setup').send({
        setup_code: 'TEST-SETUP-CODE', password: PASSWORD, remember: true,
      }).expect(201);
      const cookie = setup.headers['set-cookie'][0].split(';')[0];
      const csrf = setup.body.csrf_token;
      const created = await request(first).post('/api/providers')
        .set('Cookie', cookie).set('X-InkMorrow-CSRF', csrf)
        .send({
          display_name: 'Restart Vault',
          base_url: 'https://provider.example/v1',
          capabilities: ['catalog', 'chat'],
        })
        .expect(201);
      const profile = created.body.profile;
      await request(first).put(`/api/providers/${profile.id}/credential`)
        .set('Cookie', cookie).set('X-InkMorrow-CSRF', csrf)
        .send({ source: 'vault', credential: CANARY, password: PASSWORD }).expect(200);
      await request(first).put('/api/providers/roles/scribe')
        .set('Cookie', cookie).set('X-InkMorrow-CSRF', csrf)
        .send({ profile_id: profile.id, model_id: 'vendor/story-model' }).expect(200);

      first.locals.dispose();
      first = createApp(db, appOptions);
      const remembered = await request(first).get('/api/auth/status').set('Cookie', cookie).expect(200);
      expect(remembered.body).toMatchObject({ state: 'unlocked', vault: { state: 'locked' } });
      let lockedError;
      try { first.locals.providers.resolve('scribe'); } catch (error) { lockedError = error; }
      expect(lockedError).toMatchObject({ code: 'VAULT_LOCKED', statusCode: 423 });

      const relogin = await request(first).post('/api/auth/login').send({ password: PASSWORD, remember: true }).expect(200);
      expect(relogin.body.vault.state).toBe('unlocked');
      expect(first.locals.providers.resolve('scribe').apiKey).toBe(CANARY);
    } finally {
      first.locals.dispose();
      db.close();
    }
  });

  it('rewraps the data key on password change without re-encrypting entries', async () => {
    const fixture = providerFixture({ authRequired: true });
    const agent = request.agent(fixture.app);
    try {
      const unlocked = await setupOwner(agent, fixture.app, PASSWORD);
      const profile = await createProfile(agent, unlocked.csrf_token);
      await setCredential(agent, unlocked.csrf_token, profile.id, {
        source: 'vault', credential: CANARY, password: PASSWORD,
      });
      const beforeVault = fixture.db.prepare('SELECT wrapped_key FROM provider_vault WHERE id = 1').get().wrapped_key;
      const beforeSecret = fixture.db.prepare('SELECT ciphertext FROM provider_secrets WHERE profile_id = ?').get(profile.id).ciphertext;

      const changed = await agent.post('/api/auth/change-password')
        .set('X-InkMorrow-CSRF', unlocked.csrf_token)
        .send({ current_password: PASSWORD, new_password: NEW_PASSWORD })
        .expect(200);
      const afterVault = fixture.db.prepare('SELECT wrapped_key FROM provider_vault WHERE id = 1').get().wrapped_key;
      const afterSecret = fixture.db.prepare('SELECT ciphertext FROM provider_secrets WHERE profile_id = ?').get(profile.id).ciphertext;
      expect(Buffer.from(afterVault).equals(Buffer.from(beforeVault))).toBe(false);
      expect(Buffer.from(afterSecret).equals(Buffer.from(beforeSecret))).toBe(true);

      await agent.post('/api/auth/logout').set('X-InkMorrow-CSRF', changed.body.csrf_token).expect(200);
      await agent.post('/api/auth/login').send({ password: PASSWORD }).expect(401);
      const login = await agent.post('/api/auth/login').send({ password: NEW_PASSWORD }).expect(200);
      expect(login.body.vault.state).toBe('unlocked');
      expect(fixture.app.locals.providers.vault.decryptSecret(
        profile.id,
        fixture.db.prepare('SELECT secret_ref FROM provider_profiles WHERE id = ?').get(profile.id).secret_ref
      )).toBe(CANARY);
    } finally {
      fixture.close();
    }
  });

  it('fails closed on damaged ciphertext and terminal reset removes only auth/vault state', async () => {
    const fixture = providerFixture({ authRequired: true });
    const agent = request.agent(fixture.app);
    try {
      const unlocked = await setupOwner(agent, fixture.app, PASSWORD);
      const profile = await createProfile(agent, unlocked.csrf_token);
      await setCredential(agent, unlocked.csrf_token, profile.id, {
        source: 'vault', credential: CANARY, password: PASSWORD,
      });
      await agent.post('/api/worlds').set('X-InkMorrow-CSRF', unlocked.csrf_token)
        .send({ name: 'Preserved Realm' }).expect(201);
      await agent.post('/api/auth/logout').set('X-InkMorrow-CSRF', unlocked.csrf_token).expect(200);

      fixture.db.prepare("UPDATE provider_vault SET wrap_tag = zeroblob(length(wrap_tag)) WHERE id = 1").run();
      const login = await agent.post('/api/auth/login').send({ password: PASSWORD }).expect(200);
      expect(login.body.vault.state).toBe('error');
      const damaged = await agent.post('/api/providers/vault/unlock')
        .set('X-InkMorrow-CSRF', login.body.csrf_token)
        .send({ password: PASSWORD }).expect(503);
      expect(damaged.body).toMatchObject({ code: 'VAULT_DAMAGED' });
      expect(JSON.stringify(damaged.body)).not.toContain(CANARY);

      fixture.app.locals.dispose();
      resetAuthentication(fixture.db);
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM worlds').get().count).toBe(1);
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM provider_secrets').get().count).toBe(0);
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM provider_vault').get().count).toBe(0);
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM auth_owner').get().count).toBe(0);
    } finally {
      fixture.close();
    }
  });
});
