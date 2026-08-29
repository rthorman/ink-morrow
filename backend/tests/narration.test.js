'use strict';

const request = require('supertest');
const { Readable, PassThrough } = require('stream');
const { createTestApp, resetDb, createWorld, createCharacter, createStory, addPage } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const { resetModelCache } = require('../src/ai');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
});

beforeEach(() => {
  resetDb(db);
  axios.post.mockReset();
  axios.get.mockReset();
  resetModelCache();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

function mockSpeechCatalog(models) {
  axios.get.mockImplementation((url, options) => {
    if (String(url).includes('/models')) {
      return Promise.resolve({ data: { data: models } });
    }
    return Promise.resolve({ data: {} });
  });
}

function fakeSpeechStream(chunks, opts = {}) {
  const stream = new PassThrough();
  setImmediate(() => {
    for (const c of chunks) stream.write(c);
    stream.end();
  });
  if (opts.generationId !== undefined) stream.generationId = opts.generationId;
  return stream;
}

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function narratableStory(pageText = 'The tide came in, whispering of distant bells.') {
  const world = await createWorld(app, { name: 'Sound Realm' });
  const mc = await createCharacter(app, world.id, { name: 'Speaker' });
  const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);
  await generatePage(app, story.id, pageText);
  return story;
}

async function generatePage(appOrStory, storyId, content) {
  return request(appOrStory).post(`/api/stories/${storyId}/pages`).send({ content, user_input: 'go' });
}

describe('GET /api/speech-models', () => {
  it('lists only speech models with published voices, voices humanized', async () => {
    mockSpeechCatalog([
      { id: 'or/voice-1', name: 'Voice One', supported_voices: ['amber', 'sapphire_blue'] },
      { id: 'or/no-voices', name: 'Silent', supported_voices: [] },
      { id: 'or/not-speech', name: 'Text Model' },
    ]);
    const res = await request(app).get('/api/speech-models').expect(200);
    expect(res.body.models).toEqual([
      {
        id: 'or/voice-1',
        name: 'Voice One',
        voices: [
          { id: 'amber', label: 'Amber' },
          { id: 'sapphire_blue', label: 'Sapphire Blue' },
        ],
      },
    ]);
  });

  it('caches the catalogue for subsequent calls', async () => {
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'Voice One', supported_voices: ['amber'] }]);
    await request(app).get('/api/speech-models').expect(200);
    await request(app).get('/api/speech-models').expect(200);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/stories/:id/pages/:number/narrate', () => {
  it('streams upstream audio through with the generation id', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const story = await narratableStory('Streaming tide one.');

    const first = Buffer.from('ID3 mp3 first bytes');
    const last = Buffer.from(' final bytes');
    axios.post.mockResolvedValue({
      headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-abc123def' },
      data: fakeSpeechStream([first, last]),
    });

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(res.body.equals(Buffer.concat([first, last]))).toBe(true);
    expect(res.headers['x-generation-id']).toBe('gen-abc123def');
    expect(res.headers['content-type']).toContain('audio/mpeg');
    const sent = axios.post.mock.calls[0];
    expect(sent[0]).toContain('/audio/speech');
    expect(sent[1].response_format).toBe('mp3');
    expect(sent[1].input).toContain('Streaming tide one.');
  });

  it('delivers the first bytes to the client before the upstream finishes', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const story = await narratableStory('Streaming tide two, slower.');

    const upstream = new PassThrough();
    let upstreamEndedAt = 0;
    upstream.on('end', () => { upstreamEndedAt = Date.now(); });

    axios.post.mockResolvedValue({
      headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-slow123' },
      data: upstream,
    });

    let firstClientByteAt = 0;
    const resPromise = request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .buffer()
      .parse((res, cb) => {
        res.on('data', () => { if (!firstClientByteAt) firstClientByteAt = Date.now(); });
        binaryParser(res, cb);
      })
      .expect(200);
    resPromise.catch(() => {}); // fire the request now, not at first await

    await new Promise((r) => setTimeout(r, 30));
    upstream.write(Buffer.from('early bytes'));
    await new Promise((r) => setTimeout(r, 120)); // client must already have them
    upstream.end(Buffer.from('late bytes'));
    const res = await resPromise;

    expect(res.body.length).toBeGreaterThan(0);
    expect(firstClientByteAt).toBeGreaterThan(0);
    expect(firstClientByteAt).toBeLessThan(upstreamEndedAt);
  });

  it('replays from the session cache without a second upstream request', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const story = await narratableStory('A cacheable page of tide and memory.');
    axios.post.mockResolvedValue({
      headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-cache01' },
      data: fakeSpeechStream([Buffer.from('cached mp3')]),
    });

    await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .buffer().parse(binaryParser).expect(200);

    const replay = await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .buffer().parse(binaryParser).expect(200);

    expect(replay.headers['x-narration-cache']).toBe('hit');
    expect(replay.body.toString()).toBe('cached mp3');
    expect(axios.post).toHaveBeenCalledTimes(1); // no second billable request
  });

  it('rejects invalid model/voice combinations with guidance', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const story = await narratableStory('An invalid-voice page.');

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'not-a-voice' })
      .expect(400);
    expect(res.body.error).toContain('Settings');

    await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'unknown/model', voice: 'amber' })
      .expect(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refuses pages that are too long to narrate', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const world = await createWorld(app, { name: 'Big Realm' });
    const story = await createStory(app, world.id);
    const huge = 'word '.repeat(3500); // ~17.5k chars: narratable cap is 16k
    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: huge });

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .expect(413);
    expect(res.body.error).toContain('too long');
  });

  it('404s for a missing page', async () => {
    mockSpeechCatalog([{ id: 'or/voice-1', name: 'V', supported_voices: ['amber'] }]);
    const world = await createWorld(app, { name: 'Empty Realm' });
    const story = await createStory(app, world.id);
    await request(app)
      .post(`/api/stories/${story.id}/pages/1/narrate`)
      .send({ model: 'or/voice-1', voice: 'amber' })
      .expect(404);
  });
});

describe('GET /api/ai/generation-cost', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  it('returns the authoritative total_cost and caches per generation id', async () => {
    axios.get.mockResolvedValue({
      data: { data: { total_cost: 0.0075, model: 'or/voice-1', provider_name: 'OpenAI', latency: 800 } },
    });

    const res = await request(app).get('/api/ai/generation-cost?id=gen-cost01').expect(200);
    expect(res.body.cost_usd).toBe(0.0075);
    expect(res.body.model).toBe('or/voice-1');

    await request(app).get('/api/ai/generation-cost?id=gen-cost01').expect(200);
    expect(axios.get).toHaveBeenCalledTimes(1); // idempotent refetch guard
  });

  it('signals retry when metadata is not ready', async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    await request(app).get('/api/ai/generation-cost?id=gen-notyet').expect(202);
  });

  it('rejects malformed ids', async () => {
    await request(app).get('/api/ai/generation-cost?id=../etc').expect(400);
    await request(app).get('/api/ai/generation-cost').expect(400);
  });
});