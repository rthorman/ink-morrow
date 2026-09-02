'use strict';

const request = require('supertest');
const { createTestApp, resetDb, createWorld, createCharacter, createStory } = require('./helpers');
const quality = require('../src/quality');

// Mock axios (used by src/ai.js) BEFORE requiring anything that pulls it in.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const { resetModelCache } = require('../src/ai');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
  process.env.AI_RETRY_BASE_DELAY = '1';
});

beforeEach(async () => {
  resetDb(db);
  axios.post.mockReset();
  axios.get.mockReset();
  resetModelCache();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

// -- the heuristics themselves -------------------------------------------------

describe('truncation heuristic', () => {
  it('accepts finished prose, rejects cut-offs', () => {
    expect(quality.isClearlyTruncated('The knight crossed the moat.')).toBe(false);
    expect(quality.isClearlyTruncated('…she was gone."')).toBe(false);
    expect(quality.isClearlyTruncated('The chapter ends here.)')).toBe(false);
    expect(quality.isClearlyTruncated('')).toBe(true);
    expect(quality.isClearlyTruncated('The knight crossed the moat and the dra')).toBe(true);
    expect(quality.isClearlyTruncated('She opened the door, and then—')).toBe(true);
    expect(quality.isClearlyTruncated('He raised the cup,')).toBe(true);
  });

  it('judges the prose, never the trailing character-state block', () => {
    const raw = 'A complete page of prose.\n\n<<<CHARACTER_STATE>>>\n{"halfway": "through a json';
    const prose = quality.stripStateBlock(raw);
    expect(prose).toBe('A complete page of prose.');
    expect(quality.isClearlyTruncated(prose)).toBe(false);
    // But a cut inside the prose itself is still caught even with a block after it
    const cut = 'A page that stops mid sent\n\n<<<CHARACTER_STATE>>>\n{}';
    expect(quality.isClearlyTruncated(quality.stripStateBlock(cut))).toBe(true);
  });
});

describe('language heuristic', () => {
  const ENGLISH_REF = 'The world description says the moat is frozen and the hall is dark.';
  const FRENCH_PAGE =
    "Elle marcha vers la forêt sombre tandis que les arbres murmuraient des secrets anciens que personne n'osait répéter depuis des siècles entiers autour du château.";
  const ENGLISH_PAGE = 'She walked toward the dark forest while the trees whispered old secrets that no one dared repeat around the castle for whole centuries at a time.';

  it('flags a clearly foreign reply to English material', () => {
    expect(quality.languageMismatch(ENGLISH_REF, FRENCH_PAGE)).toBe(true);
    expect(quality.languageMismatch(ENGLISH_REF, 'Однажды в холодную зимнюю ночь замок молчал и все двери были заперты изнутри давно и навсегда.')).toBe(true);
    expect(quality.languageMismatch(ENGLISH_REF, ENGLISH_PAGE)).toBe(false);
  });

  it('stays silent when it cannot judge', () => {
    // A user writing their own tale in French is never second-guessed
    expect(quality.languageMismatch(FRENCH_PAGE, FRENCH_PAGE)).toBe(false);
    // Too little text to judge
    expect(quality.languageMismatch(ENGLISH_REF, 'Wait.')).toBe(false);
    expect(quality.languageMismatch('', ENGLISH_PAGE)).toBe(false);
  });

  it('checkReply classifies empty, truncated, and short-of-target replies', () => {
    expect(quality.checkReply('   ', {}, ENGLISH_REF)).toBe('empty');
    expect(quality.checkReply('<<<CHARACTER_STATE>>>\n{}', {}, ENGLISH_REF)).toBe('empty'); // prose-less
    expect(quality.checkReply('She opened the door and the corridor', {}, ENGLISH_REF)).toBe('truncated');
    expect(quality.checkReply('A complete sentence that is far too short for the ask.', { minWords: 30 }, ENGLISH_REF)).toBe('truncated');
    expect(quality.checkReply('Hi.', {}, ENGLISH_REF)).toBeNull(); // terse but finished: minWords owns that call
    expect(quality.checkReply(ENGLISH_PAGE, { minWords: 10 }, ENGLISH_REF)).toBeNull();
  });
});

// -- through the API -------------------------------------------------------------

function mockSequence(contents) {
  let n = 0;
  axios.post.mockImplementation(() => {
    const content = contents[Math.min(n++, contents.length - 1)];
    return Promise.resolve({ data: { choices: [{ message: { content } }] } });
  });
}

function mockPricedSequence(contents, usages) {
  axios.get.mockResolvedValue({
    data: {
      data: [{
        id: 'z-ai/glm-5.1',
        name: 'GLM',
        pricing: { prompt: '0.000002', completion: '0.000004' },
      }],
    },
  });
  let n = 0;
  axios.post.mockImplementation(() => {
    const index = Math.min(n++, contents.length - 1);
    return Promise.resolve({
      data: {
        choices: [{ message: { content: contents[index] } }],
        usage: usages[Math.min(index, usages.length - 1)],
      },
    });
  });
}

async function seededStory() {
  const world = await createWorld(app, { name: 'Quality Realm' });
  const mc = await createCharacter(app, world.id, { name: 'Hero' });
  return createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);
}

const GOOD_PAGE =
  'She walked toward the dark forest while the trees whispered old secrets that no one dared repeat. ' +
  'The knight said nothing, but his hand never left the hilt of the sword, and the path narrowed with every step they took toward the castle gates.';

describe('quality enforcement on page generation', () => {
  it('accepts OpenAI-compatible text content parts instead of mistaking them for silence', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: [{ type: 'text', text: GOOD_PAGE }] }, finish_reason: 'stop' }] },
    });

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 })
      .expect(201);

    expect(res.body.page.content).toBe(GOOD_PAGE);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('treats a provider length finish reason as truncation even when the text looks complete', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: GOOD_PAGE }, finish_reason: 'length' }] },
    }).mockResolvedValueOnce({
      data: { choices: [{ message: { content: `${GOOD_PAGE} At last, the gate opened.` }, finish_reason: 'stop' }] },
    });

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 })
      .expect(201);

    expect(res.body.page.content).toContain('At last, the gate opened.');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('retries a truncated reply and saves the complete one', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    mockSequence(['She opened the door and the corridor stret', GOOD_PAGE]);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 });
    expect(res.status).toBe(201);
    expect(res.body.page.content).toBe(GOOD_PAGE);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('stores cumulative usage and cost for every billable quality attempt', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    mockPricedSequence(
      ['She opened the door and the corridor stret', GOOD_PAGE],
      [
        { prompt_tokens: 100, completion_tokens: 10 },
        { prompt_tokens: 120, completion_tokens: 40 },
      ]
    );

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 })
      .expect(201);

    expect(res.body.page.prompt_tokens).toBe(220);
    expect(res.body.page.completion_tokens).toBe(50);
    expect(res.body.page.cost_usd).toBeCloseTo((220 * 2 + 50 * 4) / 1e6, 8);
  });

  it('refuses to save a page that never arrives whole', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    mockSequence(['She opened the door and the corridor stret']);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('cut off');
    expect(res.body.error).toContain('Nothing was saved');
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(0);
    expect(axios.post).toHaveBeenCalledTimes(3); // every attempt was spent honestly
  });

  it('returns known incurred spend when all quality attempts are rejected', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    mockPricedSequence(
      ['She opened the door and the corridor stret'],
      [{ prompt_tokens: 100, completion_tokens: 20 }]
    );

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 })
      .expect(502);

    expect(res.body.billed_attempts).toBe(3);
    expect(res.body.cost_usd).toBeCloseTo(3 * ((100 * 2 + 20 * 4) / 1e6), 8);
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(0);
  });

  it('nudges a wrong-language reply back to English before giving up', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    const french =
      "Elle marcha vers la forêt sombre tandis que les arbres murmuraient des secrets anciens que personne n'osait répéter depuis des siècles entiers autour du château.";
    mockSequence([french, GOOD_PAGE]);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 });
    expect(res.status).toBe(201);
    expect(res.body.page.content).toBe(GOOD_PAGE);
    // The retry carried the explicit instruction
    const secondBody = axios.post.mock.calls[1][1];
    const languages = secondBody.messages.filter((m) => m.role === 'system').map((m) => m.content);
    expect(languages.some((c) => c.includes('in English only'))).toBe(true);
  });

  it('refuses to save a page that stays in the wrong language', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    const french =
      "Elle marcha vers la forêt sombre tandis que les arbres murmuraient des secrets anciens que personne n'osait répéter depuis des siècles entiers autour du château.";
    mockSequence([french]);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('language');
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(0);
  });

  it('fails honestly when the model returns nothing but silence', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    mockSequence(['   ']);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 50 });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('nothing but silence');
    expect(res.body.billed_attempts).toBe(3);
    expect(res.body.cost_usd).toBeNull();
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(0);
  });

  it('holds a page to a quarter of the requested length', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    // Complete sentence, right language - but 30 words for a 400-word ask
    mockSequence(['The knight crossed the moat slowly that night. '.repeat(3).trim()]);

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/generate`)
      .send({ user_input: 'go', words: 400 });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('cut off');
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages).toHaveLength(0);
  });
});

describe('quality enforcement on the scene-image prompt condense', () => {
  it('refuses a truncated condense instead of feeding it to the image model', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const story = await seededStory();
    await request(app)
      .post(`/api/stories/${story.id}/pages`)
      .send({ content: 'A long quiet scene in the frozen hall by the moat.' })
      .expect(201);
    mockSequence(['A candlelit hall, frost on black stone, two figures by the']); // cut mid-phrase

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/image-prompt`)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('cut off');
  });
});
