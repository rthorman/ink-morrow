'use strict';

const request = require('supertest');
const { createTestApp, resetDb, createWorld } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const { resetModelCache } = require('../src/ai');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
  process.env.AI_RETRY_BASE_DELAY = '1';
});

beforeEach(() => {
  resetDb(db);
  axios.post.mockReset();
  axios.get.mockReset();
  resetModelCache();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

function mockAiJson(obj, extra = {}) {
  axios.post.mockResolvedValue({
    data: {
      choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }],
      usage: extra.usage || null,
      ...extra,
    },
  });
}

describe('POST /api/ai/world', () => {
  it('fleshes out a world from the seeds and returns parsed JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAiJson({
      name: 'The Ashen Marches',
      description: 'A drowned kingdom where the tide remembers names.',
      genre: 'Gothic fantasy',
      setting: 'Tidal ruins',
    });

    const res = await request(app)
      .post('/api/ai/world')
      .send({ name: 'Ashen', description: 'drowned kingdom', length: 'medium' })
      .expect(200);

    expect(res.body.world.name).toBe('The Ashen Marches');
    expect(res.body.world.genre).toBe('Gothic fantasy');

    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('name: Ashen');
    expect(prompt).toContain('description: drowned kingdom');
    expect(prompt).toContain('roughly 120-180 words');
    expect(prompt).toContain('strict JSON');
  });

  it('scales the length and asks for a different take on variant > 1', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAiJson({ name: 'V2', description: 'x', genre: 'g', setting: 's' });

    await request(app).post('/api/ai/world').send({ length: 'long', variant: 3 }).expect(200);
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('roughly 300-450 words');
    expect(prompt).toContain('take 3');
    expect(prompt).toContain('DISTINCTLY different');
  });

  it('rejects a non-JSON answer with a friendly 502', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: 'Once upon a time there was no JSON at all.' } }] },
    });
    const res = await request(app).post('/api/ai/world').send({}).expect(502);
    expect(res.body.error).toContain('illegible');
    expect(res.body.billed_attempts).toBe(2);
    expect(res.body.cost_usd).toBeNull();
  });

  it('returns the cost of both invalid JSON attempts when pricing is known', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.get.mockResolvedValue({
      data: {
        data: [{ id: 'z-ai/glm-5.1', name: 'GLM', pricing: { prompt: '0.000002', completion: '0.000004' } }],
      },
    });
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'Still not a JSON object.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
    });

    const res = await request(app).post('/api/ai/world').send({ model: 'z-ai/glm-5.1' }).expect(502);
    expect(res.body.billed_attempts).toBe(2);
    expect(res.body.cost_usd).toBeCloseTo(2 * ((100 * 2 + 50 * 4) / 1e6), 8);
  });

  it('passes model override and cost through', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.get.mockResolvedValue({
      data: {
        data: [{ id: 'z-ai/glm-5.1', name: 'GLM', context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000004' } }],
      },
    });
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: JSON.stringify({ name: 'W', description: 'd', genre: 'g', setting: 's' }) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    });

    const res = await request(app).post('/api/ai/world').send({ model: 'z-ai/glm-5.1' }).expect(200);
    expect(axios.post.mock.calls[0][1].model).toBe('z-ai/glm-5.1');
    expect(res.body.model).toBe('z-ai/glm-5.1');
    expect(res.body.cost_usd).toBeCloseTo((1000 * 2 + 500 * 4) / 1e6, 8);
  });
});

describe('POST /api/ai/character', () => {
  it('fleshes out a psychologically believable, unusual character', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAiJson({
      name: 'Quist',
      description: 'A locksmith who cannot stop opening things she should leave shut.',
      personality: 'Precise, dryly funny, quietly obsessive',
      appearance: 'Small, ink-stained fingers, a coat of mismatched keys',
      background: 'Former vault-keeper, dismissed for asking why locks exist',
    });

    const res = await request(app)
      .post('/api/ai/character')
      .send({ name: 'locksmith', personality: 'obsessive', length: 'short' })
      .expect(200);

    expect(res.body.character.name).toBe('Quist');
    expect(res.body.character.description).toContain('locksmith');

    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('statistically unusual');
    expect(prompt).toContain('NEVER a caricature');
    expect(prompt).toContain('Psychological believability');
    expect(prompt).toContain('name: locksmith');
    expect(prompt).toContain('personality: obsessive');
    expect(prompt).toContain('1-2 sentences');
  });

  it('includes the world for consistency when world_id is given', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Consistency Realm', genre: 'Gothic' });
    mockAiJson({ name: 'N', description: 'd', personality: 'p', appearance: 'a', background: 'b' });

    await request(app).post('/api/ai/character').send({ world_id: world.id }).expect(200);
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('THE WORLD they live in');
    expect(prompt).toContain('Consistency Realm');
    expect(prompt).toContain('Gothic');
  });

  it('rejects an unknown world_id', async () => {
    const res = await request(app).post('/api/ai/character').send({ world_id: 'nope' }).expect(400);
    expect(res.body.error).toContain('world_id');
  });
});
describe('Draft JSON repair', () => {
  it('retries once with a corrective system note when the first answer is not JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const good = JSON.stringify({ name: 'W', description: 'd', genre: 'g', setting: 's' });
    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'Ah yes, a world! Let me tell you about...' } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: good } }] } });

    const res = await request(app).post('/api/ai/world').send({}).expect(200);
    expect(res.body.world.name).toBe('W');
    expect(axios.post).toHaveBeenCalledTimes(2);
    const secondSystem = axios.post.mock.calls[1][1].messages[0].content;
    expect(secondSystem).toContain('not a valid JSON object');
  });

  it('gives up with 502 after two invalid answers', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: 'no json here at all' } }] },
    });
    const res = await request(app).post('/api/ai/world').send({}).expect(502);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(res.body.error).toContain('illegible');
  });
});
