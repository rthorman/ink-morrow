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
  return {
    summary: 'A durable page summary.',
    events: [],
    character_updates: [],
    goal_updates: [],
    thread_updates: [],
    world_fact_updates: [],
    arc_updates: [],
    ...overrides,
  };
}

function wireDelta(pageContent, value = delta()) {
  const quote = pageContent.slice(0, 500);
  const character_changes = [];
  for (const update of value.character_updates || []) {
    for (const field of ['location', 'condition', 'personality', 'appearance']) {
      if (update[field]) character_changes.push({ character_id: update.character_id, field, value: update[field], related_character_id: null, evidence_quote: quote });
    }
    for (const [source, field] of [['knowledge_gained', 'knowledge_gain'], ['knowledge_lost', 'knowledge_loss'], ['possessions_gained', 'possession_gain'], ['possessions_lost', 'possession_loss']]) {
      for (const item of update[source] || []) character_changes.push({ character_id: update.character_id, field, value: item, related_character_id: null, evidence_quote: quote });
    }
  }
  const story_changes = [
    ...(value.goal_updates || []).map((item) => ({ kind: 'goal', id: item.id ?? null, character_id: item.character_id ?? null, text: item.text ?? null, state: item.status, evidence_quote: quote })),
    ...(value.thread_updates || []).map((item) => ({ kind: 'thread', id: item.id ?? null, character_id: null, text: item.text ?? null, state: item.status, evidence_quote: quote })),
    ...(value.world_fact_updates || []).map((item) => ({ kind: 'world_fact', id: item.id ?? null, character_id: null, text: item.text ?? null, state: item.status, evidence_quote: quote })),
    ...(value.arc_updates || []).map((item) => ({ kind: 'arc', id: item.id ?? null, character_id: item.character_id ?? null, text: item.text, state: item.movement, evidence_quote: quote })),
  ];
  const events = (value.events || []).map((item) => ({
    text: item.text, character_ids: item.character_ids || [], importance: item.importance || 'minor',
    type: item.type || 'action', evidence_quote: quote,
  }));
  if (!events.length && !character_changes.length && !story_changes.length) {
    events.push({ text: value.summary, character_ids: [], importance: 'minor', type: 'transition', evidence_quote: quote });
  }
  let summary = value.summary;
  const pageWords = new Set((pageContent.toLowerCase().match(/[a-z0-9]{4,}/g) || []));
  if (!(summary.toLowerCase().match(/[a-z0-9]{4,}/g) || []).some((word) => pageWords.has(word))) {
    summary = `${summary} ${pageContent}`;
  }
  return JSON.stringify({
    schema_version: 2, summary, summary_evidence: [quote], events, character_changes, story_changes,
  });
}

async function generate(storyId, author, memory) {
  axios.post.mockResolvedValueOnce(reply(author)).mockResolvedValueOnce(reply(wireDelta(author, memory)));
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
    // Canon returns before the optional Archivist. A client sync joins the
    // already scheduled per-revision job instead of starting another charge.
    const synced = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${generated.body.page.id}/sync`)
      .send({})
      .expect(200);
    expect(synced.body.page.continuity_model).toBe('google/gemini-2.5-flash-lite');

    const authorRequest = axios.post.mock.calls[0][1];
    expect(authorRequest.messages[1].content).toContain('Will intends to join the adventurers guild');
    expect(authorRequest.messages[1].content).not.toContain('catalogue was edited');
    expect(authorRequest.messages[1].content).toContain('not orders to repeat them on each page');
    const clerkRequest = axios.post.mock.calls[1][1];
    expect(clerkRequest.response_format.type).toBe('json_schema');
    expect(clerkRequest.response_format.json_schema.schema.properties.schema_version)
      .toMatchObject({ type: 'integer', enum: [2] });
    expect(clerkRequest.response_format.json_schema.schema.properties.character_changes).toBeDefined();
    expect(clerkRequest.response_format.json_schema.schema.properties.character_updates).toBeUndefined();
    expect(clerkRequest.max_tokens).toBe(4000);
    expect(clerkRequest.provider).toEqual({ require_parameters: true });
    expect(clerkRequest.reasoning).toEqual({ effort: 'none' });
    expect(clerkRequest.messages[0].content).toContain('plans, desires, hypothetical language');

    const view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });
    expect(view.body.continuity.characters[0].current.location).toBe('outside the guild');
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters[0].state).toBeNull(); // no destructive cast mutation
  });

  it('keeps the Scribe model out of memory and bounds heavy cast detail by relevance and role', async () => {
    const cast = [];
    const main = await createCharacter(app, null, { name: 'Unspoken Main' });
    const support = await createCharacter(app, null, { name: 'First Support' });
    cast.push({ id: main.id, role: 'mc' }, { id: support.id, role: 'supporting' });
    let namedBackground;
    for (let index = 1; index <= 25; index += 1) {
      const character = await createCharacter(app, null, {
        name: `Background ${index}`,
        personality: `Background state ${index} `.repeat(60),
      });
      cast.push({ id: character.id, role: 'background' });
      if (index === 25) namedBackground = character;
    }
    const story = await createStory(app, null, cast);
    const pageText = 'Background 25 crosses the moonlit court.';
    axios.post.mockResolvedValueOnce(reply(pageText))
      .mockResolvedValueOnce(reply(wireDelta(pageText, delta({ summary: 'A background figure crosses the court.' }))));
    const generated = await request(app).post(`/api/stories/${story.id}/pages/generate`).send({
      user_input: 'Continue.',
      model: 'vendor/browser-scribe',
    }).expect(201);
    await request(app).post(`/api/stories/${story.id}/continuity/pages/${generated.body.page.id}/sync`).send({}).expect(200);

    expect(axios.post.mock.calls[0][1].model).toBe('vendor/browser-scribe');
    expect(axios.post.mock.calls[1][1].model).toBe('google/gemini-2.5-flash-lite');
    const prompt = axios.post.mock.calls[1][1].messages[1].content;
    const detail = prompt.split('DETAILED STATE FOR PAGE-RELEVANT CAST')[1].split('GOALS BEFORE')[0];
    expect(detail).toContain('Unspoken Main');
    expect(detail).toContain(namedBackground.name);
    expect(detail.length).toBeLessThan(33000);
    expect(prompt.indexOf('Unspoken Main')).toBeLessThan(prompt.indexOf('First Support'));
  });

  it('keeps a prepared page inert until commit', async () => {
    const story = await createStory(app);
    await generate(story.id, 'The first page ends.', delta({ summary: 'The tale begins.' }));

    axios.post.mockResolvedValueOnce(reply('The prepared page waits.'));
    const prepared = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);
    expect(axios.post).toHaveBeenCalledTimes(3); // author + clerk + preview author; no preview clerk
    let view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });

    axios.post.mockResolvedValueOnce(reply(wireDelta(
      'The prepared page waits.',
      delta({ summary: 'The prepared page is now committed.' })
    )));
    const committed = await request(app).post(`/api/stories/${story.id}/pages/commit-preview`)
      .send({ preview_id: prepared.body.preview.preview_id }).expect(201);
    await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${committed.body.page.id}/sync`)
      .send({})
      .expect(200);
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 2, ready: 2 });
  });

  it('returns a prepared commit before continuity finishes and deduplicates the client join', async () => {
    const story = await createStory(app);
    axios.post.mockResolvedValueOnce(reply('The prepared page appears at once.'));
    const prepared = await request(app).post(`/api/stories/${story.id}/pages/preview`).send({}).expect(200);

    let resolveMemory;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { resolveMemory = resolve; }));
    const committed = await request(app)
      .post(`/api/stories/${story.id}/pages/commit-preview`)
      .send({ preview_key: prepared.body.preview.preview_key })
      .expect(201);
    expect(committed.body.continuity_pending).toBe(true);
    expect(committed.body.page.content).toContain('appears at once');

    const joined = request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${committed.body.page.id}/sync`)
      .send({})
      .then((res) => res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(axios.post).toHaveBeenCalledTimes(2); // one author + one shared clerk call

    resolveMemory(reply(wireDelta(
      'The prepared page appears at once.',
      delta({ summary: 'The prepared page is remembered once.' })
    )));
    const synced = await joined;
    expect(synced.status).toBe(200);
    expect(synced.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(reply(wireDelta('Mara leaves for the winter inn.', at('winter inn'))));
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
    expect(sync.body.memory).toMatchObject({
      error_code: 'INVALID_CONTINUITY_JSON',
      error: expect.stringContaining('did not return one complete JSON object'),
    });
    expect(sync.body.page.content).toContain('sealed door');
    expect(axios.post).toHaveBeenCalledTimes(2);

    axios.post.mockResolvedValueOnce(reply(wireDelta(
      'A hand opens the sealed door.',
      delta({ summary: 'The sealed door is open.' })
    )));
    sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .expect(200);
    expect(sync.body.memory.status).toBe('ready');
    const repaired = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(repaired.body.continuity.coverage).toMatchObject({ total: 1, ready: 1 });

    // A billable empty completion receives one evidence-directed repair, not
    // the AI adapter's ordinary prose retry loop.
    const emptyPage = await addPage(app, story.id, 'A second page waits for memory.');
    axios.post.mockReset();
    axios.post.mockResolvedValueOnce(reply('')).mockResolvedValueOnce(reply(wireDelta(
      'A second page waits for memory.',
      delta({ summary: 'The second page is remembered after a silent response.' })
    )));
    sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${emptyPage.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1].messages.at(-1).content).toMatch(/no final answer/i);
  });

  it('falls back cleanly when a provider rejects JSON Schema capability', async () => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'A plain page becomes memory.');
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'response_format unsupported' } } })
      .mockResolvedValueOnce(reply(wireDelta(
        'A plain page becomes memory.',
        delta({ summary: 'The plain page is remembered.' })
      )));
    const sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][1].response_format).toBeDefined();
    expect(axios.post.mock.calls[0][1].provider).toEqual({ require_parameters: true });
    expect(axios.post.mock.calls[1][1].response_format).toEqual({ type: 'json_object' });
    expect(axios.post.mock.calls[1][1].provider).toEqual({ require_parameters: true });
    expect(axios.post.mock.calls[1][1].reasoning).toEqual({ effort: 'none' });
  });

  it.each([404, 422])('uses strict plain JSON when structured-output routing returns %i', async (status) => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'A routed page becomes memory.');
    axios.post.mockRejectedValueOnce({ response: { status, data: { error: 'structured output unavailable' } } })
      .mockResolvedValueOnce(reply(wireDelta(
        'A routed page becomes memory.',
        delta({ summary: 'The routed page is remembered.' })
      )));

    const sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);

    expect(sync.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
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
      id: 'google/gemini-2.5-flash-lite', pricing: { prompt: '0.000001', completion: '0.000002' },
    }] } });
    axios.post.mockResolvedValueOnce(reply(wireDelta('The costed page closes.', delta()), {
      prompt_tokens: 1000, completion_tokens: 500,
    }));
    const sync = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);
    expect(sync.body.page.continuity_cost_usd).toBeCloseTo(0.002, 8);
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.total_cost_usd).toBeCloseTo(0.002, 8);
  });
});
