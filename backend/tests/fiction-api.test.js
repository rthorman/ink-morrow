'use strict';

const request = require('supertest');
const { createTestApp: createFixture, setupOwner } = require('./helpers');
const createTestApp = (options = {}) => createFixture({ ...options, legacyEnabled: false });

describe('playable-fiction API boundary', () => {
  let fixture;
  afterEach(() => fixture?.close());
  test('all story reads and writes are sealed before setup', async () => {
    fixture = createTestApp({ authRequired: true });
    for (const method of ['get', 'post']) {
      const response = await request(fixture.app)[method]('/api/fiction').send({ title: 'Private', premise: 'Private.' });
      expect(response.status).toBe(401);
    }
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_games').get().n).toBe(0);
  });
  test('authenticated mutations require CSRF and preserve ownership boundaries', async () => {
    fixture = createTestApp({ authRequired: true });
    const agent = request.agent(fixture.app);
    const owner = await setupOwner(agent, fixture.app);
    expect((await agent.post('/api/fiction').send({ title: 'Story', premise: 'A reunion.' })).status).toBe(403);
    const started = await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ title: 'Story', premise: 'A reunion.', cast: [{ id: 'mara', name: 'Mara' }] });
    expect(started.status).toBe(201);
    const story = started.body.story;
    const response = await agent.put(`/api/fiction/${story.id}/control`).set('X-InkMorrow-CSRF', owner.csrf_token).send({ expected_revision: story.revision, character_id: 'mara' });
    expect(response.status).toBe(200);
    expect(response.body.story.state.control.character_id).toBe('mara');
    const stale = await agent.put(`/api/fiction/${story.id}/control`).set('X-InkMorrow-CSRF', owner.csrf_token).send({ expected_revision: story.revision, character_id: null });
    expect(stale.status).toBe(409);
  });
  test('validates bodies and does not reveal secret initial facts', async () => {
    fixture = createTestApp();
    expect((await request(fixture.app).post('/api/fiction').send({ title: 'Story', premise: 'A reunion.', surprise: true })).status).toBe(400);
    const started = await request(fixture.app).post('/api/fiction').send({ title: 'Story', premise: 'A reunion.', facts: [{ id: 'truth', text: 'Hidden culprit.', visibility: 'secret' }] });
    expect(started.status).toBe(201);
    expect(JSON.stringify(started.body)).not.toContain('Hidden culprit');
    const reread = await request(fixture.app).get(`/api/fiction/${started.body.story.id}`);
    expect(JSON.stringify(reread.body)).not.toContain('Hidden culprit');
    const paid = await request(fixture.app).post(`/api/fiction/${started.body.story.id}/replies`).send({ expected_revision: 0, input: { kind: 'follow' } });
    expect(paid.status).toBe(400);
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n).toBe(0);
  });

  test('manual passage writing is not a supported game endpoint', async () => {
    fixture = createTestApp();
    const started = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain' });
    expect(started.status).toBe(201);
    const before = fixture.db.prepare('SELECT count(*) AS n FROM fiction_beats').get().n;
    const response = await request(fixture.app).post(`/api/fiction/${started.body.story.id}/passages`).send({ expected_revision: started.body.story.revision, prose: 'Not a writing tool.', summary: 'No.' });
    expect(response.status).toBe(404);
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_beats').get().n).toBe(before);
  });
  test('the preference API records and validates the selected play style', async () => {
    fixture = createTestApp();
    const started = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain' });
    const story = started.body.story;
    const changed = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: story.revision, play_style: 'living-world' });
    expect(changed.status).toBe(200); expect(changed.body.story.state.play_style).toBe('living-world');
    const invalid = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: changed.body.story.revision, play_style: 'always-refuse' });
    expect(invalid.status).toBe(400);
  });
  test('quality choices expose every reviewed role and reject stale authority before dispatch', async () => {
    fixture = createTestApp();
    const started = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain' });
    let story = started.body.story; expect(story.quality_generation).toMatchObject({ mode: 'off', max_calls: 1 });
    for (const mode of ['standard', 'memory', 'both']) {
      const changed = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: story.revision, quality_mode: mode });
      expect(changed.status).toBe(200); story = changed.body.story;
      expect(story.quality_generation).toMatchObject({ mode, max_calls: mode === 'both' ? 6 : 4 });
      expect(story.quality_generation.roles.map((role) => role.role)).toEqual(mode === 'standard' ? ['scribe'] : ['scribe', 'archivist']);
      expect(story.quality_generation.review_id).toMatch(/^[a-f0-9]{64}$/);
    }
    const invalid = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: story.revision, quality_mode: 'infinite' }); expect(invalid.status).toBe(400);
    const paid = await request(fixture.app).post(`/api/fiction/${story.id}/replies`).send({ expected_revision: story.revision, idempotency_key: 'missing-quality-review', input: { kind: 'follow' } });
    expect(paid.status).toBe(409); expect(paid.body).toMatchObject({ code: 'STORY_QUALITY_REVIEW_CHANGED' });
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_calls').get().n).toBe(0);
  });
  test('fourth-wall settings cross the real API without making a paid request', async () => {
    fixture = createTestApp();
    const started = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain', play_style: 'living-world', fourth_wall: 'freely' });
    expect(started.status).toBe(201); expect(started.body.story.state.fourth_wall).toBe('freely');
    const story = started.body.story;
    const changed = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: story.revision, fourth_wall: 'rarely' });
    expect(changed.status).toBe(200); expect(changed.body.story.state.fourth_wall).toBe('rarely');
    const invalid = await request(fixture.app).put(`/api/fiction/${story.id}/preferences`).send({ expected_revision: changed.body.story.revision, fourth_wall: 'always' });
    expect(invalid.status).toBe(400);
    const reread = await request(fixture.app).get(`/api/fiction/${story.id}`);
    expect(reread.body.story.state.fourth_wall).toBe('rarely');
    expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n).toBe(0);
  });
});
