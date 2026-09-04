'use strict';

const request = require('supertest');
const { createTestApp, setupOwner } = require('./helpers');

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
});
