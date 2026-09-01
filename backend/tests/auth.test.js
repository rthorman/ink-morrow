'use strict';

const request = require('supertest');
const { resetAuthentication, passwordProblem } = require('../src/modules/auth/service');
const { createTestApp, setupOwner } = require('./helpers');

let app, db, close;

beforeEach(() => {
  ({ app, db, close } = createTestApp({ authRequired: true }));
});

afterEach(() => close());

describe('single-owner authentication', () => {
  it('starts sealed and rejects protected requests before parsing their bodies', async () => {
    await request(app).get('/api/auth/status').expect(200, { state: 'setup-required' });
    const blocked = await request(app)
      .post('/api/worlds')
      .set('Content-Type', 'application/json')
      .send('{ this is deliberately invalid and must not be parsed')
      .expect(401);
    expect(blocked.body).toMatchObject({ code: 'AUTH_REQUIRED', state: 'setup-required' });
    expect(db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(0);
  });

  it('requires the terminal setup code and a strong passphrase', async () => {
    await request(app)
      .post('/api/auth/setup')
      .send({ setup_code: 'WRONG', password: 'A long test password phrase' })
      .expect(401);
    await request(app)
      .post('/api/auth/setup')
      .send({ setup_code: app.locals.auth.setupCode, password: 'too short' })
      .expect(400);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_owner').get().c).toBe(0);
  });

  it('stores only a salted hash, issues a strict cookie, and enforces CSRF', async () => {
    const agent = request.agent(app);
    const unlocked = await setupOwner(agent, app);
    expect(unlocked.state).toBe('unlocked');
    expect(unlocked.csrf_token).toMatch(/^[A-Za-z0-9_-]+$/);

    const owner = db.prepare('SELECT * FROM auth_owner WHERE id = 1').get();
    expect(owner.password_hash).not.toContain('A long test password phrase');
    expect(owner.password_salt).toBeTruthy();

    const setupAgain = await agent
      .post('/api/auth/setup')
      .send({ setup_code: app.locals.auth.setupCode, password: 'Another lengthy password phrase' })
      .expect(409);
    expect(setupAgain.headers['set-cookie']).toBeUndefined();

    await agent.get('/api/worlds').expect(200);
    await agent.post('/api/worlds').send({ name: 'Unverified' }).expect(403);
    await agent
      .post('/api/worlds')
      .set('X-InkMorrow-CSRF', unlocked.csrf_token)
      .send({ name: 'Verified' })
      .expect(201);

    const cookie = (await request(app)
      .post('/api/auth/login')
      .send({ password: 'A long test password phrase', remember: true })
      .expect(200)).headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=');
    const rawToken = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    const storedSessions = db.prepare('SELECT token_hash FROM auth_sessions').all();
    expect(storedSessions.every((row) => row.token_hash !== rawToken)).toBe(true);
  });

  it('rejects cross-site mutations even when the CSRF value is present', async () => {
    const agent = request.agent(app);
    const unlocked = await setupOwner(agent, app);
    await agent
      .post('/api/worlds')
      .set('X-InkMorrow-CSRF', unlocked.csrf_token)
      .set('Origin', 'https://malicious.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ name: 'No' })
      .expect(403);
  });

  it('revokes sessions on lock and accepts the password again', async () => {
    const agent = request.agent(app);
    const unlocked = await setupOwner(agent, app);
    await agent
      .post('/api/auth/logout')
      .set('X-InkMorrow-CSRF', unlocked.csrf_token)
      .expect(200, { state: 'locked' });
    await agent.get('/api/worlds').expect(401);

    await agent.post('/api/auth/login').send({ password: 'incorrect but long enough' }).expect(401);
    const login = await agent
      .post('/api/auth/login')
      .send({ password: 'A long test password phrase', remember: false })
      .expect(200);
    expect(login.body.state).toBe('unlocked');
    expect(login.headers['set-cookie'][0]).not.toContain('Max-Age=');
    await agent.get('/api/worlds').expect(200);
  });

  it('changing the password revokes every other browser session', async () => {
    const first = request.agent(app);
    const firstSession = await setupOwner(first, app);
    const second = request.agent(app);
    const secondLogin = await second
      .post('/api/auth/login')
      .send({ password: 'A long test password phrase' })
      .expect(200);
    expect(secondLogin.body.state).toBe('unlocked');

    const changed = await first
      .post('/api/auth/change-password')
      .set('X-InkMorrow-CSRF', firstSession.csrf_token)
      .send({
        current_password: 'A long test password phrase',
        new_password: 'A newer and longer test password phrase',
      })
      .expect(200);
    expect(changed.body.state).toBe('unlocked');
    await second.get('/api/worlds').expect(401);
    await first.get('/api/worlds').expect(200);

    const third = request.agent(app);
    await third.post('/api/auth/login').send({ password: 'A long test password phrase' }).expect(401);
    await third.post('/api/auth/login').send({ password: 'A newer and longer test password phrase' }).expect(200);
  });

  it('a local recovery reset preserves manuscripts while removing credentials', async () => {
    const agent = request.agent(app);
    const unlocked = await setupOwner(agent, app);
    await agent
      .post('/api/worlds')
      .set('X-InkMorrow-CSRF', unlocked.csrf_token)
      .send({ name: 'Kept Realm' })
      .expect(201);

    resetAuthentication(db);
    expect(db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_owner').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get().c).toBe(0);
    await request(app).get('/api/auth/status').expect(200, { state: 'setup-required' });
  });

  it('applies response headers, host validation, and private API caching', async () => {
    const status = await request(app).get('/api/auth/status').expect(200);
    expect(status.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(status.headers['content-security-policy']).not.toContain('fonts.googleapis.com');
    expect(status.headers['x-content-type-options']).toBe('nosniff');
    await request(app).get('/api/auth/status').set('Host', 'rebinding.example').expect(421);

    const agent = request.agent(app);
    await setupOwner(agent, app);
    const protectedResponse = await agent.get('/api/worlds').expect(200);
    expect(protectedResponse.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects oversized ordinary JSON after authentication with a safe error', async () => {
    const agent = request.agent(app);
    const unlocked = await setupOwner(agent, app);
    const response = await agent
      .post('/api/worlds')
      .set('X-InkMorrow-CSRF', unlocked.csrf_token)
      .send({ name: 'x'.repeat(300 * 1024) })
      .expect(413);
    expect(response.body).toEqual({ error: 'The request is too large.' });
  });

  it('marks cookies secure and enables HSTS behind a trusted loopback HTTPS proxy', async () => {
    close();
    ({ app, db, close } = createTestApp({ authRequired: true, trustProxy: true }));
    const setup = await request(app)
      .post('/api/auth/setup')
      .set('X-Forwarded-Proto', 'https')
      .send({
        setup_code: app.locals.auth.setupCode,
        password: 'A long test password phrase',
        remember: true,
      })
      .expect(201);
    expect(setup.headers['set-cookie'][0]).toContain('Secure');
    expect(setup.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('expires idle sessions on the server even while the browser retains its cookie', async () => {
    let clock = 1_800_000_000_000;
    close();
    ({ app, db, close } = createTestApp({
      authRequired: true,
      authOptions: { now: () => clock },
    }));
    const agent = request.agent(app);
    await agent
      .post('/api/auth/setup')
      .send({
        setup_code: app.locals.auth.setupCode,
        password: 'A long test password phrase',
        remember: false,
      })
      .expect(201);
    await agent.get('/api/worlds').expect(200);
    clock += 8 * 60 * 60 * 1000 + 1;
    await agent.get('/api/worlds').expect(401);
    expect(db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get().c).toBe(0);
  });

  it('temporarily throttles repeated unlock failures without permanent lockout', async () => {
    const owner = request.agent(app);
    await setupOwner(owner, app);
    const visitor = request.agent(app);
    for (let attempt = 0; attempt < 10; attempt++) {
      await visitor.post('/api/auth/login').send({ password: 'wrong password attempt' }).expect(401);
    }
    const limited = await visitor
      .post('/api/auth/login')
      .send({ password: 'A long test password phrase' })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('password policy', () => {
  it('allows spaces and Unicode while enforcing length and common-password checks', () => {
    expect(passwordProblem('I write beneath moonlight')).toBeNull();
    expect(passwordProblem('Ég skrifa undir tunglsljósi')).toBeNull();
    expect(passwordProblem('short')).toMatch(/15/);
    expect(passwordProblem('passwordpassword')).toMatch(/commonly/);
  });
});
