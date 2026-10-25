'use strict';
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const request = require('supertest');
const { createTestApp } = require('./helpers');
describe('reviewed narration plan through production composition', () => {
  let fixture, story, roles, plan;
  beforeEach(async () => {
    axios.post.mockReset();
    axios.get.mockReset();
    fixture = createTestApp({
      legacyEnabled: false,
      providerOptions: { env: { OPENROUTER_API_KEY: 'synthetic-plan-key' } },
    });
    roles = (await request(fixture.app).get('/api/providers')).body.roles;
    story = (
      await request(fixture.app)
        .post('/api/fiction')
        .send({ scenario_id: 'garden-after-rain' })
    ).body.story;
  });
  afterEach(() => fixture.close());
  const limits = async (context = 2000000, output = 16000) => {
    for (const role of roles.filter((role) =>
      ['scribe', 'archivist'].includes(role.role),
    ))
      expect(
        (
          await request(fixture.app)
            .put(`/api/providers/${role.profile_id}/model-limits`)
            .send({
              model_id: role.model_id,
              context_tokens: context,
              output_tokens: output,
            })
        ).status,
      ).toBe(200);
  };
  const prepare = () =>
    request(fixture.app)
      .post(`/api/fiction/${story.id}/operation-plans`)
      .send({
        expected_revision: story.revision,
        target_branch_id: story.active_branch_id,
        expected_head_beat_id: story.head_beat_id,
        input: { kind: 'follow' },
      });
  const purchase = (key = 'planned-action') =>
    request(fixture.app)
      .post(`/api/fiction/${story.id}/replies`)
      .send({
        expected_revision: story.revision,
        idempotency_key: key,
        input: { kind: 'follow' },
        ...(plan ? { operation_plan_id: plan.id } : {}),
      });
  test('unknown capacity is actionable and dispatches nothing', async () => {
    const result = await prepare();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('MODEL_CAPACITY_UNKNOWN');
    expect(result.body.error).toContain('Settings');
    expect(axios.post).not.toHaveBeenCalled();
    expect(
      fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n,
    ).toBe(0);
  });
  test('a direct unprepared purchase cannot bypass review', async () => {
    await limits();
    const result = await purchase();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('STORY_PLAN_REQUIRED');
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('an expired plan and a changed capacity fail without purchase', async () => {
    await limits();
    plan = (await prepare()).body.plan;
    fixture.db
      .prepare('UPDATE fiction_operation_plans SET expires_at=0 WHERE id=?')
      .run(plan.id);
    expect((await purchase('expired')).body.code).toBe('STORY_PLAN_EXPIRED');
    plan = (await prepare()).body.plan;
    await limits(1000000);
    expect((await purchase('changed-capacity')).body.code).toBe(
      'STORY_PLAN_CHANGED',
    );
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('exact replay survives later target changes without repeating a call', async () => {
    await limits();
    plan = (await prepare()).body.plan;
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_version: 2,
                prose: 'Jo waters the seedlings.',
                summary: 'A quiet moment.',
                effects: [],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const headerPurchase=()=>request(fixture.app).post(`/api/fiction/${story.id}/replies`).set('Idempotency-Key','header-only-replay').send({expected_revision:story.revision,target_branch_id:story.active_branch_id,expected_head_beat_id:story.head_beat_id,operation_plan_id:plan.id,input:{kind:'follow'}});
    const result = await headerPurchase();
    expect(result.status).toBe(201);
    const replay = await headerPurchase();
    expect(replay.status).toBe(200);
    expect(replay.body.reused).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const options = axios.post.mock.calls[0][1];
    expect(options.max_tokens).toBe(plan.stages[0].output_tokens);
  });
  test('oversized paid candidates retain their charge and cannot trigger reviews or repair', async () => {
    await limits();
    story = (
      await request(fixture.app)
        .put(`/api/fiction/${story.id}/preferences`)
        .send({ expected_revision: story.revision, quality_mode: 'both' })
    ).body.story;
    plan = (await prepare()).body.plan;
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: { content: 'x'.repeat(plan.max_candidate_bytes + 1) },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const result = await request(fixture.app)
      .post(`/api/fiction/${story.id}/replies`)
      .send({
        expected_revision: story.revision,
        idempotency_key: 'oversized',
        operation_plan_id: plan.id,
        quality_review: story.quality_generation.review_id,
        input: { kind: 'follow' },
      });
    expect(result.status).toBe(502);
    expect(result.body.code).toBe('STORY_CANDIDATE_TOO_LARGE');
    expect(result.body.billed_attempts).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(
      (await request(fixture.app).get(`/api/fiction/${story.id}`)).body.story
        .head_beat_id,
    ).toBe(story.head_beat_id);
  });
});
