'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const request = require('supertest');
const { createTestApp, resetDb, createCharacter, createStory, addPage } = require('./helpers');
const { stableId } = require('../src/modules/continuity/store');
const { resetModelCache } = require('../src/ai');

let app, db, close;

function reply(content, usage = null) {
  return {
    data: {
      choices: [{ message: { content } }],
      ...(usage ? { usage } : {}),
    },
  };
}

function delta(overrides = {}) {
  return JSON.stringify({
    summary: 'A durable page summary.',
    events: [],
    character_updates: [],
    goal_updates: [],
    thread_updates: [],
    world_fact_updates: [],
    ...overrides,
  });
}

async function generate(storyId, author, memory) {
  axios.post.mockResolvedValueOnce(reply(author)).mockResolvedValueOnce(reply(memory));
  return request(app).post(`/api/stories/${storyId}/pages/generate`).send({ user_input: 'Continue carefully' });
}

beforeAll(() => {
  process.env.ENABLE_CONTINUITY_EXTRACTION = '1';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.AI_RETRY_BASE_DELAY = '1';
  ({ app, db, close } = createTestApp());
});

beforeEach(() => {
  resetDb(db);
  resetModelCache();
  axios.post.mockReset();
  axios.get.mockReset();
});

afterAll(() => {
  close();
  delete process.env.ENABLE_CONTINUITY_EXTRACTION;
  delete process.env.OPENROUTER_API_KEY;
});

describe('page-provenanced continuity ledger', () => {
  it('freezes the cast sheet, keeps intentions non-authoritative, and extracts state separately', async () => {
    const character = await createCharacter(app, null, {
      name: 'Will',
      description: 'Will intends to join the adventurers guild when he is ready.',
    });
    const story = await createStory(app, null, [{ id: character.id, role: 'mc', relation: null, state: null }]);

    await request(app).put(`/api/characters/${character.id}`).send({
      description: 'The catalogue was edited after casting and must not rewrite this tale.',
    }).expect(200);

    const memory = delta({
      summary: 'Will waits outside the guild.',
      character_updates: [{
        character_id: character.id,
        location: 'outside the guild',
        condition: null,
        knowledge_gained: [], knowledge_lost: [], possessions_gained: [], possessions_lost: [],
        personality: null, appearance: null, relationship_to_mc: null,
      }],
    });
    const generated = await generate(story.id, 'Will waits beneath the rain-dark sign.', memory);
    expect(generated.status).toBe(201);
    expect(generated.body.page.continuity_model).toBe('z-ai/glm-5.1');

    const authorRequest = axios.post.mock.calls[0][1];
    expect(authorRequest.messages[1].content).toContain('Will intends to join the adventurers guild');
    expect(authorRequest.messages[1].content).not.toContain('catalogue was edited');
    expect(authorRequest.messages[1].content).toContain('not orders to repeat them on each page');
    const clerkRequest = axios.post.mock.calls[1][1];
    expect(clerkRequest.response_format.type).toBe('json_schema');
    expect(clerkRequest.messages[0].content).toContain('plans, desires, hypothetical language');

    const view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });
    expect(view.body.continuity.characters[0].current.location).toBe('outside the guild');
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters[0].state).toBeNull(); // no destructive cast mutation
  });

  it('keeps a prepared page inert until commit', async () => {
    const story = await createStory(app);
    await generate(story.id, 'The first page ends.', delta({ summary: 'The tale begins.' }));

    axios.post.mockResolvedValueOnce(reply('The prepared page waits.'));
    await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);
    expect(axios.post).toHaveBeenCalledTimes(3); // author + clerk + preview author; no preview clerk
    let view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });

    axios.post.mockResolvedValueOnce(reply(delta({ summary: 'The prepared page is now committed.' })));
    await request(app).post(`/api/stories/${story.id}/pages/commit-preview`).send({}).expect(201);
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 2, ready: 2 });
  });

  it('replays surviving deltas after delete and excludes old state during regeneration', async () => {
    const character = await createCharacter(app, null, { name: 'Mara' });
    const story = await createStory(app, null, [{ id: character.id, role: 'mc', relation: null, state: null }]);
    const at = (place) => delta({
      summary: `Mara reaches ${place}.`,
      events: [{ text: `Mara reached ${place}.`, character_ids: [character.id], importance: 'major', type: 'transition' }],
      character_updates: [{
        character_id: character.id, location: place, condition: null,
        knowledge_gained: [], knowledge_lost: [], possessions_gained: [], possessions_lost: [],
        personality: null, appearance: null, relationship_to_mc: null,
      }],
    });
    await generate(story.id, 'Mara enters Tower A.', at('Tower A'));
    await generate(story.id, 'Mara enters Tower B.', at('Tower B'));

    await request(app).delete(`/api/stories/${story.id}/pages/2`).expect(204);
    let view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0].current.location).toBe('Tower A');

    await generate(story.id, 'Mara enters Tower B again.', at('Tower B'));
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: { error: 'bad key' } } });
    await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(502);
    let pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages[1].content).toContain('Tower B again');
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0].current.location).toBe('Tower B');

    axios.post.mockResolvedValueOnce(reply('Mara leaves for the winter inn.'))
      .mockResolvedValueOnce(reply(at('winter inn')));
    const rewritten = await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(200);
    expect(rewritten.body.page.content).toContain('winter inn');
    const rewritePrompt = axios.post.mock.calls[axios.post.mock.calls.length - 2][1].messages[1].content;
    expect(rewritePrompt).toContain('Tower A');
    expect(rewritePrompt).not.toContain('Tower B');
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0].current.location).toBe('winter inn');
    expect(view.body.continuity.events.some((event) => event.text.includes('Tower B'))).toBe(false);
  });

  it('marks malformed extraction as failed without losing the page, then repairs it explicitly', async () => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'A hand opens the sealed door.');
    axios.post.mockResolvedValueOnce(reply('not json.')).mockResolvedValueOnce(reply('still not json.'));
    let sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.memory.status).toBe('failed');
    expect(sync.body.page.content).toContain('sealed door');
    expect(axios.post).toHaveBeenCalledTimes(2);

    axios.post.mockResolvedValueOnce(reply(delta({ summary: 'The sealed door is open.' })));
    sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .expect(200);
    expect(sync.body.memory.status).toBe('ready');
    const repaired = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(repaired.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });

    // A billable empty completion must not trigger the AI adapter's ordinary
    // three-attempt prose retry loop; the advertised clerk ceiling stays true.
    const emptyPage = await addPage(app, story.id, 'A second page waits for memory.');
    axios.post.mockReset();
    axios.post.mockResolvedValueOnce(reply('')).mockResolvedValueOnce(reply(delta()));
    sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${emptyPage.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.memory.status).toBe('failed');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('falls back cleanly when a provider rejects JSON Schema capability', async () => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'A plain page becomes memory.');
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'response_format unsupported' } } })
      .mockResolvedValueOnce(reply(delta({ summary: 'The plain page is remembered.' })));
    const sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][1].response_format).toBeDefined();
    expect(axios.post.mock.calls[1][1].response_format).toBeUndefined();
  });

  it('rolls goal status back with the page that resolved it', async () => {
    const character = await createCharacter(app, null, { name: 'Ilex' });
    const story = await createStory(app, null, [{ id: character.id, role: 'mc', relation: null, state: null }]);
    const goalId = stableId('goal', character.id, 'Find the bell');
    await generate(story.id, 'Ilex begins searching.', delta({
      summary: 'The search begins.',
      goal_updates: [{ id: null, character_id: character.id, text: 'Find the bell', status: 'active' }],
    }));
    await generate(story.id, 'Ilex finds the bell.', delta({
      summary: 'The bell is found.',
      goal_updates: [{ id: goalId, character_id: character.id, text: 'Find the bell', status: 'fulfilled' }],
    }));
    let view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.goals[0].status).toBe('fulfilled');
    await request(app).delete(`/api/stories/${story.id}/pages/2`).expect(204);
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.goals[0].status).toBe('active');
  });

  it('adds extraction usage to the persisted story total', async () => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'The costed page closes.');
    axios.get.mockResolvedValue({ data: { data: [{
      id: 'z-ai/glm-5.1', pricing: { prompt: '0.000001', completion: '0.000002' },
    }] } });
    axios.post.mockResolvedValueOnce(reply(delta(), { prompt_tokens: 1000, completion_tokens: 500 }));
    const sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.page.continuity_cost_usd).toBeCloseTo(0.002, 8);
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.total_cost_usd).toBeCloseTo(0.002, 8);
  });
});
