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
  process.env.AI_RETRY_BASE_DELAY = '1';
});

beforeEach(() => {
  resetDb(db);
  axios.post.mockReset();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

function mockAi(
  content = 'A candlelit gothic hall in wide shot, two figures by the far door, frost creeping over black stone while gold light pools across the flagstones from a handful of guttering candles.'
) {
  axios.post.mockResolvedValue({
    data: { choices: [{ message: { content: ` ${content} ` } }] },
  });
}

async function addPage(storyId, content, user_input = 'go') {
  return request(app).post(`/api/stories/${storyId}/pages`).send({ content, user_input });
}

function promptFor(storyId, pageNumber, body = {}) {
  return request(app)
    .post(`/api/stories/${storyId}/pages/${pageNumber}/image-prompt`)
    .send(body);
}

async function storyWithCast(tone = 'fade-to-black') {
  const world = await createWorld(app, {
    name: 'Emberfall',
    description: 'A dying city of brass and ash',
    genre: 'Dark Fantasy',
    setting: 'Volcanic empire',
  });
  const mc = await createCharacter(app, world.id, {
    name: 'Vesna',
    description: 'Ash-mantled courier',
    appearance: 'Grey cloak, unscarred face',
  });
  const story = await createStory(
    app,
    world.id,
    [{ id: mc.id, role: 'mc', relation: null, state: null }],
    { tone }
  );
  return { world, mc, story };
}

describe('POST /api/stories/:id/pages/:n/image-prompt', () => {
  it('condenses the current page, world and cast state into a trimmed prompt', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const { world, story } = await storyWithCast();
    await addPage(story.id, 'Vesna crossed the brass bridge under falling ash.');
    await addPage(story.id, 'The ember gate opened. Her cloak caught fire and burned away.');

    const res = await promptFor(story.id, 2).expect(200);
    expect(res.body.prompt).toBe(
      'A candlelit gothic hall in wide shot, two figures by the far door, frost creeping over black stone while gold light pools across the flagstones from a handful of guttering candles.'
    ); // trimmed
    expect(res.body.cost_usd).toBeNull();
    expect(res.body.billed_attempts).toBe(1);

    const sent = axios.post.mock.calls[0];
    expect(sent[0]).toContain('/chat/completions');
    const [messages] = [sent[1].messages];
    const userPrompt = messages.find((m) => m.role === 'user').content;
    expect(messages[0].role).toBe('system');
    expect(userPrompt).toContain(world.name);
    expect(userPrompt).toContain(world.description);
    expect(userPrompt).toContain('The ember gate opened.'); // current page in context
    expect(userPrompt).toContain('brass bridge'); // previous page in context
  });

  it('describes cast through their in-story state, not just the base sheet', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const { mc, story } = await storyWithCast();
    // Evolve the MC's appearance mid-story through the state field
    const stateUpdate = [{ id: mc.id, role: 'mc', relation: null, state: { appearance: 'Face streaked with soot, cloak burned to rags' } }];
    await request(app).put(`/api/stories/${story.id}`).send({ characters: stateUpdate });
    await addPage(story.id, 'Vesna limped through the smoke, cloak gone.');

    await promptFor(story.id, 1).expect(200);
    const userPrompt = axios.post.mock.calls[0][1].messages.find((m) => m.role === 'user').content;
    expect(userPrompt).toContain('Face streaked with soot');
    expect(userPrompt).toContain('as the story has reshaped them');
    expect(userPrompt).toContain('AS THEY ARE IN THIS MOMENT');
  });

  it('honors the tone: fade-to-black forbids sex and gore, explicit allows them', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const tasteful = await storyWithCast('fade-to-black');
    await addPage(tasteful.story.id, 'They closed the door.');
    await promptFor(tasteful.story.id, 1).expect(200);
    let prompt = axios.post.mock.calls[0][1].messages.find((m) => m.role === 'user').content;
    expect(prompt).toContain('NEVER depict sex scenes');
    expect(prompt).toContain('gory');

    const adult = await storyWithCast('explicit');
    await addPage(adult.story.id, 'They closed the door.');
    await promptFor(adult.story.id, 1).expect(200);
    const lastCall = axios.post.mock.calls[axios.post.mock.calls.length - 1];
    prompt = lastCall[1].messages.find((m) => m.role === 'user').content;
    expect(prompt).toContain('18+');
    expect(prompt).not.toContain('NEVER depict sex scenes');
  });

  it('context stops at the requested page and windows older pages out', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const { story } = await storyWithCast();
    for (let i = 1; i <= 7; i++) {
      await addPage(story.id, `Page ${i} unfolds: unique marker number ${i} rises.`);
    }

    await promptFor(story.id, 6).expect(200);
    const userPrompt = axios.post.mock.calls[0][1].messages.find((m) => m.role === 'user').content;
    expect(userPrompt).toContain('unique marker number 6'); // the scene
    expect(userPrompt).toContain('unique marker number 2'); // windowed in
    expect(userPrompt).not.toContain('Page 1:'); // older than the window (only the opening nod remains)
    expect(userPrompt).toContain('began with: "Page 1 unfolds'); // the nod to the opening
    expect(userPrompt).not.toContain('unique marker number 7'); // after the scene
    expect(userPrompt).toContain('earlier page(s) omitted');
  });

  it('passes the model override and reasoning effort to the configured LLM', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const { story } = await storyWithCast();
    await addPage(story.id, 'A quiet page.');

    await promptFor(story.id, 1, { model: 'z-ai/glm-5.1', reasoning_effort: 'high' }).expect(200);
    const body = axios.post.mock.calls[0][1];
    expect(body.model).toBe('z-ai/glm-5.1');
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.max_tokens).toBeGreaterThanOrEqual(6000); // room to think
  });

  it('404s for unknown story or page', async () => {
    mockAi();
    const { story } = await storyWithCast();
    await addPage(story.id, 'The only page.');
    await promptFor(story.id, 5).expect(404);
    await promptFor('00000000-0000-4000-8000-000000000000', 1).expect(404);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects a malformed model override', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockAi();
    const { story } = await storyWithCast();
    await addPage(story.id, 'A quiet page.');
    const res = await promptFor(story.id, 1, { model: '' }).expect(400);
    expect(res.body.error).toContain('model');
  });
});
