'use strict';

const request = require('supertest');
const {
  createTestApp,
  resetDb,
  createWorld,
  createCharacter,
  createStory,
} = require('./helpers');

// Mock axios (used by src/ai.js) BEFORE requiring anything that pulls it in.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
  process.env.AI_RETRY_BASE_DELAY = '1'; // fast retries in tests
});

beforeEach(async () => {
  resetDb(db);
  axios.post.mockReset();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

function mockAi(content = 'Generated story text.') {
  axios.post.mockResolvedValue({
    data: { choices: [{ message: { content: ` ${content} ` } }] },
  });
}

async function generatePage(storyId, userInput) {
  const res = await request(app).post(`/api/stories/${storyId}/pages/generate`).send({ user_input: userInput });
  return res;
}

// ---------------------------------------------------------------------------

describe('POST /api/stories/:id/pages/generate', () => {
  it('generates, saves, and numbers a page', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('The knight crossed the moat.');

    const story = await createStory(app);
    const res = await generatePage(story.id, 'Cross the moat');
    expect(res.status).toBe(201);

    expect(res.body.page.content).toBe('The knight crossed the moat.');
    expect(res.body.page.page_number).toBe(1);
    expect(res.body.page.user_input).toBe('Cross the moat');

    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(1);
  });

  it('builds the prompt with world, characters, tone and direction', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();

    const world = await createWorld(app, { name: 'Prompt Realm', genre: 'Gothic' });
    const hero = await createCharacter(app, world.id, { name: 'Prompt Hero' });
    const story = await createStory(app, world.id, [hero.id], { tone: 'explicit' });

    const res = await generatePage(story.id, 'Enter the shadowed hall');
    expect(res.status).toBe(201);

    const sent = axios.post.mock.calls[0][1];
    const prompt = sent.messages[1].content;
    expect(prompt).toContain('Prompt Realm');
    expect(prompt).toContain('Prompt Hero');
    expect(prompt).toContain('Enter the shadowed hall');
    expect(prompt).toContain('explicit'); // tone instruction included
    expect(sent.max_tokens).toBeGreaterThanOrEqual(1500);
  });

  it('keeps tone instructions for non-explicit stories too', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();

    const story = await createStory(app, null, [], { tone: 'fade-to-black' });
    const res = await generatePage(story.id, 'Begin');
    expect(res.status).toBe(201);

    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('fade to black');
    expect(prompt).not.toContain('explicit, graphic');
  });

  it('windows long histories instead of sending everything', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();

    const story = await createStory(app);
    // Seed 12 pages directly (bypassing AI) so we control history size
    const insert = db.prepare('INSERT INTO story_pages (id, story_id, page_number, content) VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 12; i++) {
      insert.run(`seed-${i}`, story.id, i, `Seeded page ${i} content.`);
    }

    const res = await generatePage(story.id, 'Continue');
    expect(res.status).toBe(201);

    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    // Default window is 5: the last five seeded pages (8..12) appear in full
    expect(prompt).toContain('Page 8:');
    expect(prompt).toContain('Page 12:');
    expect(prompt).toContain('omitted'); // earlier pages are summarized away
    expect(prompt).toContain('Seeded page 1 content.'); // first page still referenced
    expect(prompt).not.toContain('Page 2:'); // middle pages dropped
  });

  it('returns 503 with a helpful message when no API key is set', async () => {
    const story = await createStory(app);
    const res = await generatePage(story.id, 'Hello');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('OPENROUTER_API_KEY');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('retries transient AI failures and eventually fails cleanly', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockRejectedValue({ response: { status: 429, data: { error: 'rate limited' } } });

    const story = await createStory(app);
    const res = await generatePage(story.id, 'Hello');
    expect(res.status).toBe(504);

    expect(axios.post).toHaveBeenCalledTimes(3); // retried
    expect(res.body.error).toMatch(/429|rate|AI API/i);
  });

  it('does not retry non-retryable AI failures', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockRejectedValue({ response: { status: 401, data: { error: 'bad key' } } });

    const story = await createStory(app);
    const res = await generatePage(story.id, 'Hello');
    expect(res.status).toBe(502);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('404s for unknown stories', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    await request(app).post('/api/stories/nope/pages/generate').send({ user_input: 'x' }).expect(404);
  });
});

describe('POST /api/stories/:id/pages/regenerate', () => {
  it('regenerates the last page using its stored user_input', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('First attempt.');
    const story = await createStory(app);
    await generatePage(story.id, 'Open the gates');

    mockAi('Much better second attempt.');
    const res = await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(200);

    expect(res.body.page.content).toBe('Much better second attempt.');
    expect(res.body.page.page_number).toBe(1);
    // The original direction is reused, not lost
    const prompt = axios.post.mock.calls[1][1].messages[1].content;
    expect(prompt).toContain('Open the gates');
  });

  it('excludes the page being regenerated from its own context', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const story = await createStory(app);
    await generatePage(story.id, 'Page one');
    await generatePage(story.id, 'Page two');

    await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(200);

    const prompt = axios.post.mock.calls[2][1].messages[1].content;
    expect(prompt).toContain('Page 1:'); // page 1 in context
    expect(prompt).toContain('Generated story text.');
    expect(prompt).not.toMatch(/Page 2:\s*\n?/); // page 2 (being redone) excluded
  });

  it('400s when the story has no pages', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const story = await createStory(app);
    await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(400);
  });
});
// ---------------------------------------------------------------------------

describe('Model selection, usage and cost accounting', () => {
  const { resetModelCache } = require('../src/ai');

  beforeEach(() => {
    resetModelCache();
    axios.get.mockReset();
  });

  function mockModels(models) {
    axios.get.mockResolvedValue({ data: { data: models } });
  }

  it('uses the requested model override for generation', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('Overridden.');
    const story = await createStory(app);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', model: 'vendor/model-x' });

    expect(res.status).toBe(201);
    expect(axios.post.mock.calls[0][1].model).toBe('vendor/model-x');
    expect(res.body.page.model).toBe('vendor/model-x');
  });

  it('records usage and computed cost per page and sums the story total', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockModels([
      {
        id: 'z-ai/glm-5.1',
        name: 'GLM',
        context_length: 128000,
        pricing: { prompt: '0.0000015', completion: '0.000002' },
      },
    ]);
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'Costly.' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    });
    const story = await createStory(app);

    const res = await generatePage(story.id, 'go');
    expect(res.status).toBe(201);
    expect(res.body.page.model).toBe('z-ai/glm-5.1');
    expect(res.body.page.prompt_tokens).toBe(1000);
    expect(res.body.page.completion_tokens).toBe(500);
    // 1000 * $1.50/1M + 500 * $2.00/1M = $0.0025
    expect(res.body.page.cost_usd).toBeCloseTo(0.0025, 8);

    const list = await request(app).get('/api/stories').expect(200);
    expect(list.body.stories[0].total_cost_usd).toBeCloseTo(0.0025, 8);
  });

  it('updates usage and cost when regenerating the last page', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('First.');
    const story = await createStory(app);
    await generatePage(story.id, 'go');

    mockModels([
      { id: 'z-ai/glm-5.1', name: 'GLM', context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000004' } },
    ]);
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'Redone.' } }],
        usage: { prompt_tokens: 2000, completion_tokens: 1000 },
      },
    });
    const res = await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(200);

    expect(res.body.page.content).toBe('Redone.');
    expect(res.body.page.prompt_tokens).toBe(2000);
    // 2000 * $2/1M + 1000 * $4/1M = $0.008
    expect(res.body.page.cost_usd).toBeCloseTo(0.008, 8);
  });

  it('stores null cost when usage or pricing is unavailable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('No usage.'); // axios mock has no usage field
    const story = await createStory(app);

    const res = await generatePage(story.id, 'go');
    expect(res.status).toBe(201);
    expect(res.body.page.prompt_tokens).toBeNull();
    expect(res.body.page.cost_usd).toBeNull();

    const list = await request(app).get('/api/stories').expect(200);
    expect(list.body.stories[0].total_cost_usd).toBe(0);
  });

  it('GET /api/models returns the normalized catalog', async () => {
    mockModels([
      { id: 'a/b', name: 'B Model', context_length: 8, pricing: { prompt: '0.000001', completion: '0.000002' } },
    ]);
    const res = await request(app).get('/api/models').expect(200);
    expect(res.body.models).toEqual([
      { id: 'a/b', name: 'B Model', context_length: 8, pricing: { prompt_per_mtok: 1, completion_per_mtok: 2 } },
    ]);
  });

  it('rejects an empty model override', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const story = await createStory(app);
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', model: '   ' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('Words-per-page target', () => {
  it('puts the requested target in the prompt and scales the token budget', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('A longer page.');
    const story = await createStory(app);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 800 });
    expect(res.status).toBe(201);

    const body = axios.post.mock.calls[0][1];
    expect(body.messages[1].content).toContain('approximately 800 words');
    expect(body.max_tokens).toBe(800 * 2 + 250);
  });

  it('keeps the default wording and token budget when no target is sent', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('Default page.');
    const story = await createStory(app);

    await generatePage(story.id, 'go');
    const body = axios.post.mock.calls[0][1];
    expect(body.messages[1].content).toContain('roughly 300-500 words');
    expect(body.max_tokens).toBe(1500); // AI_MAX_TOKENS default
  });

  it('clamps out-of-range targets', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('Clamped.');
    const story = await createStory(app);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 99999 });
    expect(res.status).toBe(201);
    const body = axios.post.mock.calls[0][1];
    expect(body.messages[1].content).toContain('approximately 2000 words');
    expect(body.max_tokens).toBe(2000 * 2 + 250);
  });
});

// ---------------------------------------------------------------------------

describe('Three-tier cast (MC / supporting / background)', () => {
  async function createTieredStory(app, worldId) {
    const mc = await createCharacter(app, worldId, { name: 'Mira Vane', description: 'A cartographer of forbidden places. She maps what should stay lost.' });
    const ally = await createCharacter(app, worldId, { name: 'Corvin', description: 'Her reluctant bodyguard. Owes her a debt he will not name.' });
    const extra = await createCharacter(app, worldId, { name: 'Innkeeper Hodge', description: 'A stout man who sees everything and says little. Keeps a loaded crossbow under the bar.' });
    const story = await createStory(app, worldId, [
      { id: mc.id, role: 'mc' },
      { id: ally.id, role: 'supporting' },
      { id: extra.id, role: 'background' },
    ]);
    return { story, mc, ally, extra };
  }

  it('builds tiered prompt sections: protagonist, supporting, background', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('Tiered.');
    const world = await createWorld(app, { name: 'Tier Realm' });
    const { story, mc, ally, extra } = await createTieredStory(app, world.id);

    await generatePage(story.id, 'go');
    const prompt = axios.post.mock.calls[0][1].messages[1].content;

    expect(prompt).toContain('PROTAGONIST (the story follows this character');
    expect(prompt).toContain(`- ${mc.name}:`);
    expect(prompt).toContain('SUPPORTING CAST');
    expect(prompt).toContain(`- ${ally.name}:`);
    expect(prompt).toContain('BACKGROUND FIGURES');
    expect(prompt).toContain(`- ${extra.name}: A stout man who sees everything and says little.`);
    // Background tier is one line: no full detail block for Hodge
    expect(prompt).not.toContain(`- ${extra.name}: A stout man who sees everything and says little.\n  Personality:`);

    // Protagonist section precedes supporting, which precedes background
    const order = ['PROTAGONIST', 'SUPPORTING CAST', 'BACKGROUND FIGURES'].map((s) => prompt.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('accepts legacy plain-id casts as supporting', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const world = await createWorld(app, { name: 'Legacy Realm' });
    const hero = await createCharacter(app, world.id, { name: 'Old Hero' });
    const story = await createStory(app, world.id, [hero.id]); // plain ids

    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters).toEqual([{ id: hero.id, role: 'supporting' }]);
  });

  it('rejects two main characters in one story', async () => {
    const world = await createWorld(app, { name: 'MC Realm' });
    const a = await createCharacter(app, world.id, { name: 'First Lead' });
    const b = await createCharacter(app, world.id, { name: 'Second Lead' });
    const res = await request(app)
      .post('/api/stories')
      .send({ title: 'Crowded', world_id: world.id, characters: [{ id: a.id, role: 'mc' }, { id: b.id, role: 'mc' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('one main character');
  });

  it('rejects unknown roles', async () => {
    const world = await createWorld(app, { name: 'Role Realm' });
    const a = await createCharacter(app, world.id, { name: 'Mystery Role' });
    const res = await request(app)
      .post('/api/stories')
      .send({ title: 'Bad Role', world_id: world.id, characters: [{ id: a.id, role: 'villain' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('characters[].role');
  });
});
