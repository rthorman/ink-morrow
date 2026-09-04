'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const request = require('supertest');
const { createTestApp } = require('./helpers');

describe('quality through the real API and role-specific AI client', () => {
  let fixture;
  const providerResponse = (content) => ({ data: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] } });
  beforeEach(() => {
    axios.post.mockReset(); axios.get.mockReset();
    fixture = createTestApp({ legacyEnabled: false, providerOptions: { env: { OPENROUTER_API_KEY: 'fixture-only-key' } } });
  });
  afterEach(() => fixture.close());
  async function start() {
    const settings = await request(fixture.app).get('/api/providers');
    for (const [role, model] of [['scribe', 'standard-fixture'], ['archivist', 'memory-fixture']]) {
      const assigned = await request(fixture.app).put(`/api/providers/roles/${role}`).send({ profile_id: settings.body.roles.find((entry) => entry.role === role).profile_id, model_id: model });
      expect(assigned.status).toBe(200);
    }
    const response = await request(fixture.app).post('/api/fiction').send({ scenario_id: 'garden-after-rain', quality_mode: 'memory' });
    expect(response.status).toBe(201); return response.body.story;
  }
  const purchase = (story) => request(fixture.app).post(`/api/fiction/${story.id}/replies`).send({ expected_revision: story.revision, idempotency_key: 'reviewed-purchase', quality_review: story.quality_generation.review_id, input: { kind: 'follow' } });
  test('Memory review actually reaches the memory model and exposes only safe call metadata', async () => {
    const story = await start();
    axios.post.mockResolvedValueOnce(providerResponse({ prose: 'Jo waters the seedlings.', summary: 'Quiet work.', effects: [] })).mockResolvedValueOnce(providerResponse({ approved: true, issues: [] }));
    const result = await purchase(story); expect(result.status).toBe(201);
    expect(axios.post.mock.calls.map(([, body]) => body.model)).toEqual(['standard-fixture', 'memory-fixture']);
    expect(result.body).toMatchObject({ billed_attempts: 2, known_cost_usd: 0, unknown_attempts: 2, cost_usd: null });
    expect(result.body.story.state.scene_count).toBe(1); expect(result.body.calls.map((call) => call.role)).toEqual(['scribe', 'archivist']);
    expect(JSON.stringify(result.body)).not.toContain('fixture-only-key'); expect(JSON.stringify(result.body)).not.toContain('"approved"');
    const replay = await purchase(story); expect(replay.status).toBe(200); expect(replay.body.reused).toBe(true); expect(axios.post).toHaveBeenCalledTimes(2);
  });
  test('review transport failure reports both attempts without retries or a saved draft', async () => {
    const story = await start();
    axios.post.mockResolvedValueOnce(providerResponse({ prose: 'Jo waters the seedlings.', summary: 'Quiet work.', effects: [] })).mockRejectedValueOnce(new Error('Fixture transport disconnected.'));
    const result = await purchase(story); expect(result.status).toBe(504);
    expect(result.body).toMatchObject({ billed_attempts: 2, cost_usd: null, known_cost_usd: 0, unknown_attempts: 2 });
    expect(axios.post).toHaveBeenCalledTimes(2);
    const reread = await request(fixture.app).get(`/api/fiction/${story.id}`); expect(reread.body.story.state.scene_count).toBe(0); expect(reread.body.story.spend.unknown_attempts).toBe(2);
  });
});
