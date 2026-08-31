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

// A compliant English page for tests that send an explicit words target
// (quality checks hold the reply to a quarter of it).
function longEnglishPage(sentences = 40) {
  return ('The cat sat on the mat and the quiet hall held its breath. ').repeat(sentences);
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

  it('feeds the canonical world lorebook into page generation as it evolves', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();

    const world = await createWorld(app, { name: 'Lore Realm' });
    const story = await createStory(app, world.id, []);

    await request(app).put(`/api/worlds/${world.id}`).send({ lore: 'The moon over Lore Realm never sets.' }).expect(200);
    const first = await generatePage(story.id, 'Walk outside');
    expect(first.status).toBe(201);
    let prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('LOREBOOK');
    expect(prompt).toContain('The moon over Lore Realm never sets.');

    // World edits are live: the canonical world, not a copy - later pages see changes
    await request(app).put(`/api/worlds/${world.id}`).send({ lore: 'The moon finally set; ash now falls instead.' }).expect(200);
    const second = await generatePage(story.id, 'Walk outside again');
    expect(second.status).toBe(201);
    prompt = axios.post.mock.calls[axios.post.mock.calls.length - 1][1].messages[1].content;
    expect(prompt).toContain('ash now falls instead');
    expect(prompt).not.toContain('The moon over Lore Realm never sets.');
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
    expect(prompt).toContain('MEMORY COVERAGE: 0 of 12'); // no expensive surprise backfill
    expect(prompt).not.toContain('Seeded page 1 content.'); // raw old prose is not smuggled back in
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

  it('does not save live prose produced against a story that changed in flight', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    let resolveAuthor;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { resolveAuthor = resolve; }));
    const generation = request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'continue' })
      .then((res) => res);
    while (!resolveAuthor) await new Promise((resolve) => setImmediate(resolve));

    await request(app)
      .post(`/api/stories/${story.id}/pages`)
      .send({ content: 'A page was added from another tab.' })
      .expect(201);
    resolveAuthor({ data: { choices: [{ message: { content: 'Stale generated prose.' } }] } });

    const stale = await generation;
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('WRITE_SUPERSEDED');
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages.map((page) => page.content)).toEqual(['A page was added from another tab.']);
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

  it('does not replace a last page that changed while its rewrite was in flight', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    await request(app)
      .post(`/api/stories/${story.id}/pages`)
      .send({ content: 'The original last page.', user_input: 'begin' })
      .expect(201);
    let resolveRewrite;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { resolveRewrite = resolve; }));
    const rewrite = request(app)
      .post(`/api/stories/${story.id}/pages/regenerate`)
      .send({})
      .then((res) => res);
    while (!resolveRewrite) await new Promise((resolve) => setImmediate(resolve));

    await request(app).delete(`/api/stories/${story.id}/pages/1`).expect(204);
    resolveRewrite({ data: { choices: [{ message: { content: 'A stale rewrite.' } }] } });
    const stale = await rewrite;
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REWRITE_SUPERSEDED');
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toEqual([]);
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
      {
        id: 'a/b',
        name: 'B Model',
        context_length: 8,
        reasoning: false,
        reasoning_efforts: [],
        reasoning_default: null,
        reasoning_mandatory: false,
        is_default: false,
        pricing: { prompt_per_mtok: 1, completion_per_mtok: 2 },
      },
    ]);
  });

  it('exposes the default model and its exact reasoning-effort ladder', async () => {
    process.env.OPENROUTER_MODEL = 'vendor/deep-thinker';
    mockModels([
      {
        id: 'vendor/deep-thinker',
        name: 'Deep Thinker',
        supported_parameters: ['reasoning'],
        reasoning: {
          mandatory: true,
          supported_efforts: ['max', 'high', 'low'],
          default_effort: 'max',
        },
        pricing: {},
      },
    ]);
    try {
      const res = await request(app).get('/api/models').expect(200);
      expect(res.body.models[0]).toMatchObject({
        id: 'vendor/deep-thinker',
        is_default: true,
        reasoning: true,
        reasoning_efforts: ['max', 'high', 'low'],
        reasoning_default: 'max',
        reasoning_mandatory: true,
      });
    } finally {
      delete process.env.OPENROUTER_MODEL;
    }
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
    mockAi(longEnglishPage(45));
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
    mockAi(longEnglishPage(120));
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

    expect(prompt).toContain('PROTAGONIST / MAIN CHARACTER');
    expect(prompt).toContain(`- ${mc.name} [id: ${mc.id}]:`);
    expect(prompt).not.toContain('<<<CHARACTER_STATE>>>');
    expect(prompt).toContain('REFERENCE-SHEET RULE');
    expect(prompt).toContain(`${mc.name} [id:`);
    expect(prompt).toContain('SUPPORTING CAST');
    expect(prompt).toContain(`- ${ally.name} [id: ${ally.id}]:`);
    expect(prompt).toContain('BACKGROUND FIGURES');
    expect(prompt).toContain(`- ${extra.name}: A stout man who sees everything and says little.`);
    // Background tier is one line: no full detail block for Hodge
    expect(prompt).not.toContain(`- ${extra.name}: A stout man who sees everything and says little.\n  Personality:`);

    // Protagonist section precedes supporting, which precedes background
    const order = ['PROTAGONIST', 'SUPPORTING CAST', 'BACKGROUND FIGURES'].map((s) => prompt.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('rejects plain-id casts - objects are required', async () => {
    const world = await createWorld(app, { name: 'Strict Realm' });
    const hero = await createCharacter(app, world.id, { name: 'Plain Hero' });
    const res = await request(app)
      .post('/api/stories')
      .send({ title: 'Legacy Shape', world_id: world.id, characters: [hero.id] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('{id, role}');
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

// ---------------------------------------------------------------------------

describe('Mutable per-story character state', () => {
  it('shows the relation to the MC without asking the author model to mutate state', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('Page one.');
    const world = await createWorld(app, { name: 'Relation Realm' });
    const mc = await createCharacter(app, world.id, { name: 'The Lead' });
    const ally = await createCharacter(app, world.id, { name: 'The Ally' });
    const story = await createStory(app, world.id, [
      { id: mc.id, role: 'mc', relation: null, state: null },
      { id: ally.id, role: 'supporting', relation: 'owes her a life-debt from the war', state: null },
    ]);

    await generatePage(story.id, 'go');
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('Relation to the main character: owes her a life-debt from the war');
    expect(prompt).not.toContain('<<<CHARACTER_STATE>>>');
    expect(prompt).toContain('plans, wants, vows, and intentions describe motivation');
  });

  it('strips legacy state blocks but never trusts them as continuity', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Evolution Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Hurtable' });
    const story = await createStory(app, world.id, [
      { id: mc.id, role: 'mc', relation: null, state: null },
    ]);

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content:
              'The bridge fell. She lost her left hand.\n\n<<<CHARACTER_STATE>>>\n' +
              JSON.stringify({ [mc.id]: { personality: 'Flint-eyed and slower to trust after the bridge', appearance: 'Missing her left hand, bandaged stump' } }),
          },
        }],
      },
    });
    const res = await generatePage(story.id, 'cross the bridge');
    expect(res.status).toBe(201);
    expect(res.body.page.content).toBe('The bridge fell. She lost her left hand.');
    expect(res.body.page.content).not.toContain('CHARACTER_STATE');

    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    const cast = meta.body.story.characters;
    expect(cast[0].state).toBeNull();

    // Ordinary unit tests intentionally disable paid extraction; the page is
    // valid and its memory is visibly pending instead of accepting the marker.
    const memory = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(memory.body.continuity.coverage.ready).toBe(0);
    expect(memory.body.continuity.coverage.pending_page_ids).toHaveLength(1);

    mockAi('Page two.');
    await generatePage(story.id, 'go on');
    const prompt2 = axios.post.mock.calls[1][1].messages[1].content;
    expect(prompt2).not.toContain('Flint-eyed and slower to trust after the bridge');
    expect(prompt2).toContain('The bridge fell. She lost her left hand.');
  });

  it('keeps prose and state intact when the state block is malformed', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Grace Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Steady' });
    const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: { content: 'A quiet page.\n\n<<<CHARACTER_STATE>>>\nnot json at all' },
        }],
      },
    });
    const res = await generatePage(story.id, 'go');
    expect(res.status).toBe(201);
    expect(res.body.page.content).toBe('A quiet page.');

    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters[0].state).toBeNull();
  });

  it('an explicit in-story sheet override replaces the seed relation in later prompts', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Drift Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Anchor' });
    const ally = await createCharacter(app, world.id, { name: 'Drifter' });
    const story = await createStory(app, world.id, [
      { id: mc.id, role: 'mc', relation: null, state: null },
      { id: ally.id, role: 'supporting', relation: 'childhood friends', state: null },
    ]);

    await request(app).put(`/api/stories/${story.id}`).send({
      characters: [
        { id: mc.id, role: 'mc', relation: null, state: null },
        { id: ally.id, role: 'supporting', relation: 'childhood friends', state: {
          relationship_to_mc: 'Openly hostile since the betrayal; the friendship is ash',
        } },
      ],
    }).expect(200);

    mockAi('Next page.');
    await generatePage(story.id, 'go');
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('Openly hostile since the betrayal; the friendship is ash (as the story has reshaped it; it began as: childhood friends)');
  });
});

// ---------------------------------------------------------------------------

describe('Speculative next-page preview', () => {
  it('exposes free restart-safe metadata without exposing prepared prose', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    mockAi('A secret prepared continuation.');

    const created = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);
    expect(created.body.preview.preview_key).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const status = await request(app).get(`/api/stories/${story.id}/pages/preview`).expect(200);
    expect(status.body.preview).toEqual(created.body.preview);
    expect(JSON.stringify(status.body)).not.toContain('secret prepared continuation');
  });

  it('rejects an old preview identity without deleting the newer prepared page', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    mockAi('Prepared version A.');
    const first = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

    mockAi('Prepared version B.');
    const second = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);
    expect(second.body.preview.preview_key).not.toBe(first.body.preview.preview_key);

    const staleCommit = await request(app)
      .post(`/api/stories/${story.id}/pages/commit-preview`)
      .send({ preview_key: first.body.preview.preview_key })
      .expect(409);
    expect(staleCommit.body.code).toBe('PREVIEW_REPLACED');

    const status = await request(app).get(`/api/stories/${story.id}/pages/preview`).expect(200);
    expect(status.body.preview.preview_key).toBe(second.body.preview.preview_key);
    const committed = await request(app)
      .post(`/api/stories/${story.id}/pages/commit-preview`)
      .send({ preview_key: second.body.preview.preview_key })
      .expect(201);
    expect(committed.body.page.content).toBe('Prepared version B.');
  });

  it('does not let an older overlapping request overwrite the newest preview', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    const replies = [];
    axios.post.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));

    const firstPromise = request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).then((res) => res);
    while (replies.length < 1) await new Promise((resolve) => setImmediate(resolve));
    const secondPromise = request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).then((res) => res);
    while (replies.length < 2) await new Promise((resolve) => setImmediate(resolve));

    replies[1]({ data: { choices: [{ message: { content: 'The newest prepared page.' } }] } });
    const second = await secondPromise;
    expect(second.status).toBe(200);

    replies[0]({ data: { choices: [{ message: { content: 'The late old page.' } }] } });
    const first = await firstPromise;
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('PREVIEW_SUPERSEDED');

    const committed = await request(app)
      .post(`/api/stories/${story.id}/pages/commit-preview`)
      .send({ preview_key: second.body.preview.preview_key })
      .expect(201);
    expect(committed.body.page.content).toBe('The newest prepared page.');
  });

  it('does not resurrect a preview that finishes after a live page advances the story', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await createStory(app);
    let resolvePreview;
    axios.post
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePreview = resolve; }))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'The directed live page.' } }] } });

    const previewPromise = request(app)
      .post(`/api/stories/${story.id}/pages/preview`)
      .send({})
      .then((res) => res);
    while (!resolvePreview) await new Promise((resolve) => setImmediate(resolve));

    const live = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'take the other road' })
      .expect(201);
    expect(live.body.page.content).toBe('The directed live page.');

    resolvePreview({ data: { choices: [{ message: { content: 'The obsolete prepared page.' } }] } });
    const late = await previewPromise;
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PREVIEW_SUPERSEDED');
    const status = await request(app).get(`/api/stories/${story.id}/pages/preview`).expect(200);
    expect(status.body.preview).toBeNull();
  });

  it('previews without saving, then commits instantly', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Preview Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Previewer' });
    const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);
    mockAi('The first page.');
    await generatePage(story.id, 'begin');

    // Preview: generated, NOT saved
    axios.post.mockResolvedValue({
      data: { choices: [{ message: { content: 'The prepared continuation.' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } },
    });
    const res = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);
    expect(res.body.preview.expected_page).toBe(2);
    const pagesAfterPreview = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pagesAfterPreview.body.pages).toHaveLength(1); // still just the first page

    // Commit: saved instantly, page 2 with accounting
    const commit = await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(201);
    expect(commit.body.page.page_number).toBe(2);
    expect(commit.body.page.content).toBe('The prepared continuation.');
    expect(commit.body.page.user_input).toBeNull();
    expect(commit.body.page.prompt_tokens).toBe(100);

    // Second commit without a fresh preview
    await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(404);
  });

  it('a prepared page survives a full server restart (the green button outlives it)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { createDb } = require('../src/db');
    const { createApp } = require('../src/app');
    const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-preview-')), 'preview.db');
    try {
      const db1 = createDb(dbFile);
      const app1 = createApp(db1, { staticDir: null });
      const world = await createWorld(app1, { name: 'Restart Realm' });
      const story = await createStory(app1, world.id, []);

      mockAi('The prepared continuation.');
      await request(app1).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

      // Full restart: new app instance on the same database file
      db1.close();
      const db2 = createDb(dbFile);
      const app2 = createApp(db2, { staticDir: null });

      // The prepared page is still there and commits as-is - no silent
      // fallback to a fresh (re-billed) generation
      const commit = await request(app2).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(201);
      expect(commit.body.page.page_number).toBe(1);
      expect(commit.body.page.content).toBe('The prepared continuation.');
      db2.close();
    } finally {
      fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
    }
  });

  it('a normal generate discards the prepared preview', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Stale Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Impatient' });
    const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);

    mockAi('The prepared page.');
    await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

    // The writer generates normally in the meantime -> the preview is discarded
    mockAi('The real page.');
    await generatePage(story.id, 'a real direction');

    await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(404);

    // And nothing was duplicated
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(1);
    expect(pages.body.pages[0].content).toBe('The real page.');
  });

  it('a canonical world edit invalidates prepared prose made from the old lore', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Changing Realm' });
    const story = await createStory(app, world.id, []);
    mockAi('A page based on the old world.');
    await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

    await request(app)
      .put(`/api/worlds/${world.id}`)
      .send({ lore: 'The old kingdom vanished overnight.' })
      .expect(200);
    const status = await request(app).get(`/api/stories/${story.id}/pages/preview`).expect(200);
    expect(status.body.preview).toBeNull();
  });

  it('preview honors model and word target, and its legacy state block stays inert on commit', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Stateful Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Evolving' });
    const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content:
              'She changed everything about the hall, its guards, its quiet hours and its stale air.\n\n<<<CHARACTER_STATE>>>\n' +
              JSON.stringify({ [mc.id]: { personality: 'Colder now' } }),
          },
        }],
      },
    });
    await request(app).post(`/api/stories/${story.id}/pages/preview`).send({ model: 'vendor/x', words: 50 }).expect(200);
    expect(axios.post.mock.calls[0][1].model).toBe('vendor/x');
    expect(axios.post.mock.calls[0][1].max_tokens).toBe(50 * 2 + 250);

    await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(201);
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters[0].state).toBeNull();
    const continuity = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(continuity.body.continuity.coverage.pending_page_ids).toHaveLength(1);
  });

  it('truncating invalidates a preview', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const world = await createWorld(app, { name: 'Burn Realm' });
    const story = await createStory(app, world.id);
    mockAi('First.');
    await generatePage(story.id, 'go');
    mockAi('Second.');
    await generatePage(story.id, 'more');

    mockAi('Prepared.');
    await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

    await request(app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(404);
  });
});

// ---------------------------------------------------------------------------

describe('Reasoning effort', () => {
  it('passes the effort through as OpenRouter reasoning config', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('A considered page.');
    const world = await createWorld(app, { name: 'Thought Realm' });
    const story = await createStory(app, world.id);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', reasoning_effort: 'high' });
    expect(res.status).toBe(201);

    const body = axios.post.mock.calls[0][1];
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.max_tokens).toBeGreaterThanOrEqual(6000); // room to think
  });

  it.each(['minimal', 'xhigh', 'max', 'none'])('accepts the full OpenRouter effort vocabulary: %s', async (effort) => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi('A calibrated page.');
    const story = await createStory(app);
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', reasoning_effort: effort });
    expect(res.status).toBe(201);
    const body = axios.post.mock.calls[0][1];
    expect(body.reasoning).toEqual({ effort });
    if (effort === 'none') expect(body.max_tokens).toBe(1500);
    else expect(body.max_tokens).toBeGreaterThanOrEqual(6000);
  });

  it('rejects unknown efforts', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const world = await createWorld(app, { name: 'Strict Thought Realm' });
    const story = await createStory(app, world.id);
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', reasoning_effort: 'maximum' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('reasoning_effort');
  });

  it('omits the reasoning field entirely when no effort is sent', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const world = await createWorld(app, { name: 'Plain Realm' });
    const story = await createStory(app, world.id);
    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'go' }).expect(201);
    expect(axios.post.mock.calls[0][1].reasoning).toBeUndefined();
  });
});
