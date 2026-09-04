'use strict';

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const sharp = require('sharp');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createWorld, createCharacter, createStory } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const { resetModelCache } = require('../src/ai');

const SPEECH_MODELS = [
  { id: 'or/voice-1', name: 'Voice One', supported_voices: ['amber'], pricing: { prompt: '0.000015', completion: '0' } },
  { id: 'google/gemini-tts', name: 'Gemini TTS', supported_voices: ['sage'], pricing: { prompt: '0' } },
];

async function validPng() {
  return sharp({
    create: { width: 6, height: 4, channels: 4, background: '#442244' },
  }).png().toBuffer();
}

let db, app, close, audioDir;

beforeAll(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-audiobooks-'));
});

beforeEach(async () => {
  resetModelCache();
  axios.post.mockReset();
  axios.get.mockReset();
  db = createDb(':memory:');
  app = createApp(db, { legacyEnabled: true, staticDir: null, imageDir: fs.mkdtempSync(path.join(os.tmpdir(), 'im-ab-images-')), audioDir });
  close = () => db.close();
  for (const f of fs.existsSync(audioDir) ? fs.readdirSync(audioDir) : []) fs.unlinkSync(path.join(audioDir, f));

  // Catalogue + authoritative generation costs, both through axios.get
  axios.get.mockImplementation((url) => {
    if (String(url).includes('/generation')) {
      return Promise.resolve({ data: { data: { total_cost: 0.01 } } });
    }
    return Promise.resolve({ data: { data: SPEECH_MODELS } });
  });
});

afterEach(() => {
  close();
});

afterAll(() => {
  fs.rmSync(audioDir, { recursive: true, force: true });
  delete process.env.OPENROUTER_API_KEY;
});

// -- helpers ----------------------------------------------------------------

function fakeSpeechStream(chunks, opts = {}) {
  const stream = new PassThrough();
  setImmediate(() => {
    for (const c of chunks) stream.write(c);
    stream.end();
  });
  return { headers: { 'content-type': 'audio/mpeg', ...(opts.generationId ? { 'x-generation-id': opts.generationId } : {}) }, data: stream };
}

function mockAutoSpeech(prefix) {
  let n = 0;
  axios.post.mockImplementation(() => {
    n++;
    return Promise.resolve(fakeSpeechStream([Buffer.from(`${prefix}-page-${n}-mp3 `)], { generationId: `gen-${prefix}${n}` }));
  });
}

async function seededStory(title, pageTexts) {
  const world = await createWorld(app, { name: 'Audio Realm' });
  const mc = await createCharacter(app, world.id, { name: 'Reader' });
  const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }], { title });
  for (const text of pageTexts) {
    const res = await request(app).post(`/api/stories/${story.id}/pages`).send({ content: text });
    if (res.status !== 201) throw new Error('seed page failed');
  }
  return story;
}

async function startAudiobook(story, appArg = app) {
  const res = await request(appArg).post(`/api/stories/${story.id}/audiobook`).send({ model: 'or/voice-1', voice: 'amber' });
  if (res.status !== 201) throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.audiobook;
}

async function waitForStatus(storyId, status, timeoutMs = 4000) {
  const started = Date.now();
  for (;;) {
    const row = db.prepare('SELECT * FROM audiobooks WHERE story_id = ?').get(storyId);
    if (row && row.status === status) return row;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for audiobook ${storyId} -> ${status} (now ${row && row.status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function speechCalls() {
  return axios.post.mock.calls.filter(([url]) => String(url).includes('/audio/speech')).length;
}

function audioBytes(storyId) {
  return fs.readFileSync(path.join(audioDir, `${storyId}.mp3`));
}

// -- validation --------------------------------------------------------------

describe('Audiobook validation', () => {
  it('rejects pcm-only narrators with the reason up front', async () => {
    const story = await seededStory('Pcm Tale', ['Words to read.']);
    const res = await request(app).post(`/api/stories/${story.id}/audiobook`).send({ model: 'google/gemini-tts', voice: 'sage' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('WAV-only');
    expect(speechCalls()).toBe(0);
  });

  it('rejects unconfigured narrators, empty tales, unknown stories, and double starts', async () => {
    const story = await seededStory('Guard Tale', ['Words to read.']);
    await request(app).post(`/api/stories/${story.id}/audiobook`).send({ model: 'or/voice-1' }).expect(400);
    await request(app).post(`/api/stories/${story.id}/audiobook`).send({ model: 'no-such-model', voice: 'amber' }).expect(400);
    await request(app).post('/api/stories/no-such/audiobook').send({ model: 'or/voice-1', voice: 'amber' }).expect(404);

    // A tale with no narratable pages has nothing to read
    const world = await createWorld(app, { name: 'Quiet Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Mute' });
    const empty = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }], { title: 'Empty Tale' });
    const res = await request(app).post(`/api/stories/${empty.id}/audiobook`).send({ model: 'or/voice-1', voice: 'amber' }).expect(400);
    expect(res.body.error).toContain('no narratable pages');

    // Hold the tale mid-read so the pending row genuinely blocks a restart
    const gate = new PassThrough();
    axios.post.mockImplementation(() => Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate }));
    await startAudiobook(story);
    const again = await request(app).post(`/api/stories/${story.id}/audiobook`).send({ model: 'or/voice-1', voice: 'amber' });
    expect(again.status).toBe(409);
    gate.end(Buffer.from('audio'));
    await waitForStatus(story.id, 'ready');
  });
});

// -- the job itself ----------------------------------------------------------

describe('Audiobook generation', () => {
  it('reads every text page in order, skips plates, and assembles one mp3', async () => {
    const story = await seededStory('Full Tale', ['First page words.', 'Second page words.']);
    // Place art after page 1: it never enters the narration sequence.
    await request(app)
      .post(`/api/stories/${story.id}/pages/1/image-page`)
      .send({ image: (await validPng()).toString('base64'), media_type: 'image/png' })
      .expect(201);
    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: 'Third page words.' }).expect(201);

    mockAutoSpeech('f');
    const pending = await startAudiobook(story);
    expect(pending.status).toBe('pending');
    expect(pending.pages_total).toBe(3); // the plate is not narratable

    const row = await waitForStatus(story.id, 'ready');
    expect(row.pages_done).toBe(3);
    expect(row.size_bytes).toBe(audioBytes(story.id).length);
    expect(row.duration_s).toBeGreaterThan(0);
    expect(row.cost_usd).toBeCloseTo(0.03); // one billed segment per page from the /generation mock

    const text = audioBytes(story.id).toString('utf8');
    expect(text).toContain('f-page-1-mp3');
    expect(text).toContain('f-page-2-mp3');
    expect(text).toContain('f-page-3-mp3');
    expect(speechCalls()).toBe(3);
  });

  it('serves the finished book as an attachment', async () => {
    const story = await seededStory('Serve Tale', ['Serve me.']);
    mockAutoSpeech('s');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');

    const binaryParser = (res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const res = await request(app).get(`/api/stories/${story.id}/audiobook/audio`).buffer().parse(binaryParser).expect(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.headers['content-disposition']).toContain('serve_tale-audiobook.mp3');
    expect(res.body.toString('utf8')).toContain('s-page-1-mp3');
  });

  it('regenerates for free when nothing changed (the per-page cache remembers)', async () => {
    const story = await seededStory('Cache Tale', ['Cached words one.', 'Cached words two.']);
    mockAutoSpeech('c');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');
    const firstRunCalls = speechCalls();
    expect(firstRunCalls).toBe(2);

    const row2 = await startAudiobook(story); // same tale, same narrator
    // All pages are cache hits, so the reading is finished before the 201 lands
    expect(row2.status).toBe('ready');
    expect(speechCalls()).toBe(firstRunCalls); // nothing re-billed
    expect(row2.cost_usd).toBeCloseTo(0); // replays are free
  });

  it('re-bills only the pages that changed', async () => {
    const story = await seededStory('Edit Tale', ['Stable words.', 'Mutable words.']);
    mockAutoSpeech('e');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');
    const firstRunCalls = speechCalls();

    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: 'A brand new ending.' }).expect(201);
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');
    expect(speechCalls()).toBe(firstRunCalls + 1); // only the new page spoke
    const text = audioBytes(story.id).toString('utf8');
    expect(text).toContain('e-page-3-mp3'); // the new page is in the book
    expect((text.match(/e-page-\d+-mp3/g) || []).length).toBe(3);
  });

  it('marks a book stale when the tale changed after it was read', async () => {
    const story = await seededStory('Stale Tale', ['Original words.']);
    mockAutoSpeech('t');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');

    let res = await request(app).get(`/api/stories/${story.id}/audiobook`).expect(200);
    expect(res.body.audiobook.stale).toBe(false);

    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: 'The tale grew.' }).expect(201);
    res = await request(app).get(`/api/stories/${story.id}/audiobook`).expect(200);
    expect(res.body.audiobook.stale).toBe(true);
    // Still downloadable, just flagged
    await request(app).get(`/api/stories/${story.id}/audiobook/audio`).expect(200);
  });
});

// -- queue discipline --------------------------------------------------------

describe('Audiobook queue and cancellation', () => {
  it('queues tales behind the running one and reports the position', async () => {
    const first = await seededStory('First Tale', ['One.', 'Two.']);
    const second = await seededStory('Second Tale', ['Three.']);
    // Each segment's stream trickles in shortly after it starts, so the
    // first tale is still reading when the second is queued behind it.
    axios.post.mockImplementation(() => {
      const gate = new PassThrough();
      setTimeout(() => {
        gate.write(Buffer.from('q-audio '));
        gate.end();
      }, 60);
      return Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate });
    });

    await startAudiobook(first);
    const secondPending = await startAudiobook(second);
    expect(secondPending.queue_position).toBeGreaterThanOrEqual(1); // behind the running tale

    await waitForStatus(first.id, 'ready', 8000);
    await waitForStatus(second.id, 'ready', 8000);
    expect(fs.existsSync(path.join(audioDir, `${first.id}.mp3`))).toBe(true);
    expect(fs.existsSync(path.join(audioDir, `${second.id}.mp3`))).toBe(true);
  });

  it('cancels a queued tale immediately', async () => {
    const first = await seededStory('Runner Tale', ['Slow.', 'Slow.']);
    const second = await seededStory('Waiting Tale', ['Waiting.']);
    // Hold the running tale's first stream so it cannot finish
    const gate = new PassThrough();
    axios.post.mockImplementation(() => Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate }));

    await startAudiobook(first);
    await startAudiobook(second);

    const res = await request(app).post(`/api/stories/${second.id}/audiobook/cancel`).expect(200);
    expect(res.body.audiobook.status).toBe('failed');
    expect(res.body.audiobook.error).toBe('Cancelled.');
    expect(fs.existsSync(path.join(audioDir, `${second.id}.mp3.tmp`))).toBe(false);

    // Release the gate: the running tale completes normally
    gate.write(Buffer.from('audio'));
    gate.end();
    await waitForStatus(first.id, 'ready');
  });

  it('cancels the running tale between pages, keeping no partial file', async () => {
    const story = await seededStory('Cancel Tale', ['Page one.', 'Page two.']);
    const gates = [new PassThrough(), new PassThrough()];
    let call = 0;
    axios.post.mockImplementation(() => {
      const gate = gates[Math.min(call++, 1)];
      return Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate });
    });

    await startAudiobook(story);
    await new Promise((r) => setTimeout(r, 50)); // stuck collecting page one

    const res = await request(app).post(`/api/stories/${story.id}/audiobook/cancel`).expect(200);
    expect(res.body.audiobook.status).toBe('pending'); // page one still finishing

    gates[0].end(Buffer.from('page-one ')); // release page one
    const row = await waitForStatus(story.id, 'failed');
    expect(row.error).toBe('Cancelled.'); // the between-pages check caught it
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3`))).toBe(false);
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3.tmp`))).toBe(false);
  });

  it('cancels the running tale mid-page, before the bytes are written', async () => {
    const story = await seededStory('Midpage Tale', ['Page one.', 'Page two.']);
    const gates = [new PassThrough(), new PassThrough()];
    let call = 0;
    axios.post.mockImplementation(() => {
      const gate = gates[Math.min(call++, 1)];
      return Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate });
    });

    await startAudiobook(story);
    gates[0].end(Buffer.from('page-one ')); // page one flows
    await new Promise((r) => setTimeout(r, 50)); // stuck collecting page two

    await request(app).post(`/api/stories/${story.id}/audiobook/cancel`).expect(200);
    gates[1].end(Buffer.from('page-two ')); // the page completes - but is never written
    const row = await waitForStatus(story.id, 'failed');
    expect(row.error).toBe('Cancelled.'); // the post-collect check caught it
    expect(row.pages_done).toBe(1); // page one counted, page two discarded
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3.tmp`))).toBe(false);
  });

  it('marks a pending row failed when a new server instance boots', async () => {
    const fileDb = path.join(os.tmpdir(), `im-ab-boot-${Date.now()}.db`);
    const bootDb = createDb(fileDb);
    const bootImages = fs.mkdtempSync(path.join(os.tmpdir(), 'im-ab-b-'));
    const bootApp = createApp(bootDb, { legacyEnabled: true, staticDir: null, imageDir: bootImages, audioDir });
    const world = await createWorld(bootApp, { name: 'Boot Realm' });
    const story = await createStory(bootApp, world.id, [], { title: 'Boot Tale' });
    await request(bootApp).post(`/api/stories/${story.id}/pages`).send({ content: 'Interrupted words.' }).expect(201);

    // Hold the tale mid-read so the row is still pending when the server "restarts"
    const gate = new PassThrough();
    axios.post.mockImplementation(() => Promise.resolve({ headers: { 'content-type': 'audio/mpeg' }, data: gate }));
    await startAudiobook(story, bootApp);
    bootDb.close();

    // Simulate the restart: a fresh app on the same database
    const reopened = createDb(fileDb);
    const reopenedApp = createApp(reopened, { legacyEnabled: true, staticDir: null, imageDir: bootImages, audioDir });
    const res = await request(reopenedApp).get(`/api/stories/${story.id}/audiobook`).expect(200);
    expect(res.body.audiobook.status).toBe('failed');
    expect(res.body.audiobook.error).toContain('Interrupted');
    reopened.close();
    fs.rmSync(fileDb, { force: true });
  });
});

// -- cleanup and the storage endpoint ----------------------------------------

describe('Audiobook cleanup and storage listing', () => {
  it('deleting the audiobook removes row and file', async () => {
    const story = await seededStory('Delete Tale', ['Delete me.']);
    mockAutoSpeech('d');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3`))).toBe(true);

    await request(app).delete(`/api/stories/${story.id}/audiobook`).expect(204);
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3`))).toBe(false);
    const res = await request(app).get(`/api/stories/${story.id}/audiobook`).expect(200);
    expect(res.body.audiobook).toBeNull();
    await request(app).delete(`/api/stories/${story.id}/audiobook`).expect(404);
  });

  it('deleting the story removes the audiobook file too', async () => {
    const story = await seededStory('Orphan Tale', ['Orphan words.']);
    mockAutoSpeech('o');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');
    await request(app).delete(`/api/stories/${story.id}`).expect(204);
    expect(fs.existsSync(path.join(audioDir, `${story.id}.mp3`))).toBe(false);
  });

  it('lists per-story audiobooks and plates with sizes for the Bookshelf', async () => {
    const story = await seededStory('Shelf Tale', ['Shelf words one.', 'Shelf words two.']);
    const placed = await request(app)
      .post(`/api/stories/${story.id}/pages/1/image-page`)
      .send({ image: (await validPng()).toString('base64'), media_type: 'image/png', prompt: 'A shelf scene.' })
      .expect(201);
    mockAutoSpeech('h');
    await startAudiobook(story);
    await waitForStatus(story.id, 'ready');

    const res = await request(app).get('/api/storage').expect(200);
    const entry = res.body.stories.find((s) => s.id === story.id);
    expect(entry.title).toBe('Shelf Tale');
    expect(entry.audiobook.status).toBe('ready');
    expect(entry.audiobook.size_bytes).toBeGreaterThan(0);
    expect(entry.plates).toHaveLength(1);
    expect(entry.plates[0]).toMatchObject({
      asset_id: placed.body.asset.id,
      source: 'ai-generated',
      alt_text: 'A shelf scene.',
      size_bytes: placed.body.asset.size_bytes,
      placements: [{ after_page_number: 1, ordinal: 1 }],
    });
  });
});
