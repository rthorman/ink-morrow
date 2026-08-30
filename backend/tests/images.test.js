'use strict';

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const {
  resetDb,
  createWorld,
  createCharacter,
  createStory,
} = require('./helpers');

// Mock axios (used by src/images.js) BEFORE requiring anything that pulls it in.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let app, db, close, imageDir;

beforeAll(() => {
  process.env.ENABLE_BACKGROUND_IMAGES = '1'; // opt into auto-enqueue in this suite
  process.env.OPENROUTER_API_KEY = 'test-key';
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-images-'));
  db = createDb(':memory:');
  app = createApp(db, { staticDir: null, imageDir });
  close = () => db.close();
});

beforeEach(async () => {
  resetDb(db);
  // Stored image files must not leak between tests
  for (const kind of ['characters', 'worlds']) {
    const dir = path.join(imageDir, kind);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) fs.unlinkSync(path.join(dir, f));
  }
  axios.post.mockReset();
  mockImageOk();
});

afterAll(() => {
  close();
  fs.rmSync(imageDir, { recursive: true, force: true });
  delete process.env.ENABLE_BACKGROUND_IMAGES;
});

function mockImageOk({ cost = 0.06 } = {}) {
  axios.post.mockResolvedValue({
    data: {
      data: [{ b64_json: PNG_BYTES.toString('base64'), media_type: 'image/png' }],
      usage: { cost },
    },
  });
}

async function waitForImageStatus(table, id, status, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const row = db.prepare(`SELECT image_status FROM ${table} WHERE id = ?`).get(id);
    if (row && row.image_status === status) return row;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${table} ${id} -> ${status} (now ${row && row.image_status})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Waits until an image call with the given prompt substring has actually hit
// the (mocked) upstream - avoids races against a previous still-valid status.
async function waitForImageCall(promptSubstring, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const call = [...axios.post.mock.calls].reverse().find((c) => String(c[1]?.prompt || '').includes(promptSubstring));
    if (call) return call;
    if (Date.now() - started > timeoutMs) throw new Error(`expected image call never happened: ${promptSubstring}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Character & world reference images', () => {
  it('auto-generates a character portrait in the background on creation', async () => {
    const res = await request(app).post('/api/characters').send({ name: 'Vesna', appearance: 'Ash cloak' }).expect(201);
    expect(res.body.character.image_status).toBe('pending');

    await waitForImageStatus('characters', res.body.character.id, 'ready');
    const row = db.prepare('SELECT image_cost_usd, image_media_type FROM characters WHERE id = ?').get(res.body.character.id);
    expect(row.image_cost_usd).toBe(0.06);
    expect(row.image_media_type).toBe('image/png');

    // The prompt sent upstream is a plain single-figure reference portrait
    const body = axios.post.mock.calls[0][1];
    expect(body.model).toBe('x-ai/grok-imagine-image-2.0');
    expect(body.aspect_ratio).toBe('3:4');
    expect(body.prompt).toContain('Vesna');
    expect(body.prompt).toContain('Ash cloak');
    expect(body.prompt).toContain('no other people');

    // The image is served back with its media type
    const image = await request(app).get(`/api/characters/${res.body.character.id}/image`).expect(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(image.body)).toBe(true);
  });

  it('auto-generates a world image with no creatures or people', async () => {
    const res = await request(app).post('/api/worlds').send({ name: 'Emberfall', description: 'Brass city of ash', genre: 'Dark Fantasy' }).expect(201);
    await waitForImageStatus('worlds', res.body.world.id, 'ready');

    const body = axios.post.mock.calls[0][1];
    expect(body.prompt).toContain('NO people');
    expect(body.prompt).toContain('no creatures');
    expect(body.prompt).toContain('Emberfall');
    expect(body.quality).toBe('low'); // worlds set the mood, cheaply

    await request(app).get(`/api/worlds/${res.body.world.id}/image`).expect(200);
  });

  it('generate_image:false creates without painting; omitted/true preserves old-client behavior', async () => {
    // Explicit false: no image work at all
    const quiet = await request(app).post('/api/characters').send({ name: 'Quiet One', generate_image: false }).expect(201);
    expect(quiet.body.character.image_status).toBe("none");
    const callsAfterQuiet = axios.post.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(axios.post.mock.calls.length).toBe(callsAfterQuiet);

    const quietWorld = await request(app).post('/api/worlds').send({ name: 'Quiet Vale', generate_image: false }).expect(201);
    expect(quietWorld.body.world.image_status).toBe("none");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(axios.post.mock.calls.length).toBe(callsAfterQuiet);

    // Omitted (old clients) and explicit true both keep create-and-paint
    const chatty = await request(app).post('/api/characters').send({ name: 'Painted One' }).expect(201);
    expect(chatty.body.character.image_status).toBe('pending');
    await waitForImageStatus('characters', chatty.body.character.id, 'ready');
    const paintedCalls = axios.post.mock.calls.length;
    expect(paintedCalls).toBeGreaterThan(callsAfterQuiet);

    const explicit = await request(app).post('/api/worlds').send({ name: 'Loud Vale', generate_image: true }).expect(201);
    expect(explicit.body.world.image_status).toBe('pending');
    await waitForImageStatus('worlds', explicit.body.world.id, 'ready');
  });

  it('redo regenerates the portrait, and only one job per entity queues', async () => {
    const character = await createCharacter(app, null, { name: 'Rex' });
    await waitForImageStatus('characters', character.id, 'ready');
    const callsAfterCreate = axios.post.mock.calls.length;

    // Double-tap redo while the first job is still painting: deduped
    axios.post.mockImplementation(() => new Promise((resolve) => setTimeout(
      () => resolve({
        data: {
          data: [{ b64_json: PNG_BYTES.toString('base64'), media_type: 'image/png' }],
          usage: { cost: 0.06 },
        },
      }),
      60
    )));
    const [first, second] = await Promise.all([
      request(app).post(`/api/characters/${character.id}/image`).expect(200),
      request(app).post(`/api/characters/${character.id}/image`).expect(200),
    ]);
    expect(first.body.image_status).toBe('pending');
    expect(second.body.image_status).toBe('pending');
    await waitForImageStatus('characters', character.id, 'ready', 3000);
    expect(axios.post.mock.calls.length).toBe(callsAfterCreate + 1); // one regeneration

    const row = db.prepare('SELECT image_cost_usd, image_updated_at FROM characters WHERE id = ?').get(character.id);
    expect(row.image_cost_usd).not.toBeNull();
    expect(row.image_updated_at).not.toBeNull();
  });

  it('marks failed when the upstream image call fails, and redo can recover', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: '{"error":{"message":"bad key"}}' } });
    const character = await createCharacter(app, null, { name: 'Doomed' });
    await waitForImageStatus('characters', character.id, 'failed');
    await request(app).get(`/api/characters/${character.id}/image`).expect(404);

    mockImageOk();
    await request(app).post(`/api/characters/${character.id}/image`).expect(200);
    await waitForImageStatus('characters', character.id, 'ready');
  });

  it('deletes the stored image with the entity', async () => {
    const character = await createCharacter(app, null, { name: 'Ephemeral' });
    await waitForImageStatus('characters', character.id, 'ready');
    expect(fs.readdirSync(path.join(imageDir, 'characters')).length).toBe(1);

    await request(app).delete(`/api/characters/${character.id}`).expect(204);
    expect(fs.readdirSync(path.join(imageDir, 'characters')).length).toBe(0);
    await request(app).get(`/api/characters/${character.id}/image`).expect(404);
  });

  it('backfills entities that predate the feature when the server boots', async () => {
    // Fresh DB with a pre-existing (image-less) world, then boot a new app
    const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-images-boot-'));
    const bootDb = createDb(':memory:');
    const worldId = 'legacy-world-0001';
    bootDb.prepare("INSERT INTO worlds (id, name) VALUES (?, 'Legacy')").run(worldId);
    try {
      const bootApp = createApp(bootDb, { staticDir: null, imageDir: bootDir });
      const started = Date.now();
      for (;;) {
        const row = bootDb.prepare('SELECT image_status FROM worlds WHERE id = ?').get(worldId);
        if (row && row.image_status === 'ready') break;
        if (Date.now() - started > 3000) throw new Error('boot backfill never became ready (now ' + (row && row.image_status) + ')');
        await new Promise((r) => setTimeout(r, 10));
      }
      const image = await request(bootApp).get(`/api/worlds/${worldId}/image`).expect(200);
      expect(Buffer.isBuffer(image.body)).toBe(true);
    } finally {
      bootDb.close();
      fs.rmSync(bootDir, { recursive: true, force: true });
    }
  });

  it('404s redo/serve for unknown entities', async () => {
    await request(app).post('/api/characters/00000000-0000-4000-8000-000000000000/image').expect(404);
    await request(app).get('/api/worlds/00000000-0000-4000-8000-000000000000/image').expect(404);
  });

  it('uses the edited image blurb instead of the auto-composed one', async () => {
    const character = await createCharacter(app, null, { name: 'Custom Blurb' });
    await waitForImageStatus('characters', character.id, 'ready');

    await request(app)
      .put(`/api/characters/${character.id}`)
      .send({ image_prompt: 'A stained-glass saint in profile, gold and oxblood.' })
      .expect(200);
    await request(app).post(`/api/characters/${character.id}/image`).expect(200);
    const characterCall = await waitForImageCall('stained-glass saint');
    expect(characterCall[1].prompt).toBe('A stained-glass saint in profile, gold and oxblood.');

    // World blurbs too
    const world = await createWorld(app, { name: 'Blurb Realm' });
    await waitForImageStatus('worlds', world.id, 'ready');
    await request(app)
      .put(`/api/worlds/${world.id}`)
      .send({ image_prompt: 'A salt plain under twin moons, no people.' })
      .expect(200);
    await request(app).post(`/api/worlds/${world.id}/image`).expect(200);
    const worldCall = await waitForImageCall('salt plain');
    expect(worldCall[1].prompt).toBe('A salt plain under twin moons, no people.');
  });

  it('serves 404 honestly when a ready image file is missing (legacy copies)', async () => {
    const character = await createCharacter(app, null, { name: 'Ghost Portrait' });
    await waitForImageStatus('characters', character.id, 'ready');
    const file = path.join(imageDir, 'characters', fs.readdirSync(path.join(imageDir, 'characters')).find((f) => f.startsWith(character.id + '.')));
    fs.unlinkSync(file); // the DB says ready, the disk says otherwise

    const res = await request(app).get(`/api/characters/${character.id}/image`).expect(404);
    expect(res.body.error).toContain('missing');
  });

  it('skips ready-but-missing portraits as scene references without crashing', async () => {
    const world = await createWorld(app, { name: 'Ghost Realm' });
    const mc = await createCharacter(app, world.id, { name: 'Ghost Mc' });
    const story = await createStory(app, world.id, [{ id: mc.id, role: 'mc', relation: null, state: null }]);
    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: 'The hall.', user_input: 'go' });
    await waitForImageStatus('characters', mc.id, 'ready');
    fs.unlinkSync(path.join(imageDir, 'characters', fs.readdirSync(path.join(imageDir, 'characters')).find((f) => f.startsWith(mc.id + '.'))));

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'An empty hall.' })
      .expect(200);
    expect(res.body.references).toEqual([]); // no refs, no crash
  });

  it('feeds world lore into the world image prompt (places only, still unpopulated)', async () => {
    const world = await createWorld(app, { name: 'Lored Realm', description: 'Brass city' });
    await request(app)
      .put(`/api/worlds/${world.id}`)
      .send({ lore: 'The Ashfall district burns eternally beneath the aqueduct of teeth.' })
      .expect(200);
    await request(app).post(`/api/worlds/${world.id}/image`).expect(200); // redo with lore in place
    const call = await waitForImageCall('Ashfall district');
    expect(call[1].prompt).toContain('NO people'); // lore never smuggles creatures in
  });
});

describe('POST /api/stories/:id/pages/:n/scene-image', () => {
  let world, mc, ally, story;

  beforeEach(async () => {
    world = await createWorld(app, { name: 'Scene Realm' });
    mc = await createCharacter(app, world.id, { name: 'Hero Prime' });
    ally = await createCharacter(app, world.id, { name: 'Second Fiddle' });
    story = await createStory(app, world.id, [
      { id: mc.id, role: 'mc', relation: null, state: null },
      { id: ally.id, role: 'supporting', relation: 'rival', state: null },
    ]);
    await request(app).post(`/api/stories/${story.id}/pages`).send({ content: 'They met in the hall.', user_input: 'go' });
    // Let the background portraits land
    await waitForImageStatus('characters', mc.id, 'ready');
    await waitForImageStatus('characters', ally.id, 'ready');
  });

  it('renders the scene with the cast portraits as identity references, MC first', async () => {
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'A candlelit hall, two figures, tense composition.' })
      .expect(200);

    expect(res.body.media_type).toBe('image/png');
    expect(Buffer.from(res.body.image, 'base64').equals(PNG_BYTES)).toBe(true);
    expect(res.body.cost_usd).toBe(0.06);
    expect(res.body.references).toEqual([mc.id, ally.id]);

    const body = axios.post.mock.calls[axios.post.mock.calls.length - 1][1];
    expect(body.prompt).toBe('A candlelit hall, two figures, tense composition.');
    expect(body.aspect_ratio).toBe('2:3');
    expect(body.quality).toBe('low'); // default render variant: 1K low
    expect(body.resolution).toBe('1K');
    expect(body.input_references.length).toBe(2);
    // Both cast portraits ride along as base64 identity references
    expect(body.input_references[0].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(body.input_references[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('honors the chosen render variant and rejects unknown ones', async () => {
    await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'A tall hall.', render: 'medium_2k' })
      .expect(200);
    const body = axios.post.mock.calls[axios.post.mock.calls.length - 1][1];
    expect(body.quality).toBe('medium');
    expect(body.resolution).toBe('2K');

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'A tall hall.', render: 'ultra_8k' })
      .expect(400);
    expect(res.body.error).toContain('low_1k, medium_2k');
  });

  it('caps references at three, casting background figures last', async () => {
    const extra = await createCharacter(app, world.id, { name: 'Third Wheel' });
    const fourth = await createCharacter(app, world.id, { name: 'Crowd Extra' });
    await request(app)
      .put(`/api/stories/${story.id}`)
      .send({
        characters: [
          { id: mc.id, role: 'mc', relation: null, state: null },
          { id: ally.id, role: 'supporting', relation: 'rival', state: null },
          { id: extra.id, role: 'supporting', relation: 'friend', state: null },
          { id: fourth.id, role: 'background', relation: null, state: null },
        ],
      });
    await waitForImageStatus('characters', extra.id, 'ready');
    await waitForImageStatus('characters', fourth.id, 'ready');

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'A busy hall.' })
      .expect(200);
    expect(res.body.references).toEqual([mc.id, ally.id, extra.id]);
    expect(res.body.references).not.toContain(fourth.id); // background figure out of ref budget
  });

  it('generates without references when no portraits are ready', async () => {
    // Wipe both portraits behind the API's back
    for (const id of [mc.id, ally.id]) {
      db.prepare("UPDATE characters SET image_status = 'none' WHERE id = ?").run(id);
    }
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'An empty hall.' })
      .expect(200);
    expect(res.body.references).toEqual([]);
    const body = axios.post.mock.calls[axios.post.mock.calls.length - 1][1];
    expect(body.input_references).toBeUndefined();
  });

  it('requires a prompt and validates the page', async () => {
    await request(app).post(`/api/stories/${story.id}/pages/1/scene-image`).send({}).expect(400);
    await request(app)
      .post(`/api/stories/${story.id}/pages/9/scene-image`)
      .send({ prompt: 'Nothing here.' })
      .expect(404);
    await request(app)
      .post('/api/stories/00000000-0000-4000-8000-000000000000/pages/1/scene-image')
      .send({ prompt: 'Nothing here.' })
      .expect(404);
  });

  it('a moderation refusal announces a rewritten prompt and WAITS - no silent repaint', async () => {
    // Only the scene's own prompt gets refused; entity-portrait jobs pass.
    const SCENE_PROMPT = 'An explicitly unrenderable scene.';
    let sceneImageCalls = 0;
    axios.post.mockImplementation((url, body) => {
      if (String(url).includes('/images')) {
        if (body && body.prompt === SCENE_PROMPT) {
          sceneImageCalls++;
          return Promise.reject({
            response: { status: 400, data: '{"error":{"message":"the nude figures offend moderation"}}' },
          });
        }
        return Promise.resolve({
          data: {
            data: [{ b64_json: PNG_BYTES.toString('base64'), media_type: 'image/png' }],
            usage: { cost: 0.04 },
          },
        });
      }
      if (String(url).includes('/chat/completions')) {
        return Promise.resolve({
          data: {
            choices: [
              {
                message: {
                  content:
                    ' A fully clothed and draped take on the same scene: the hall keeps its place and mood, the figures keep their identity, everything composed safely for strict moderation. ',
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: SCENE_PROMPT })
      .expect(200);

    // The refusal is announced, the rewritten prompt is handed back, and NO
    // image is painted - the user reviews and presses Generate again.
    expect(res.body).toEqual({
      refused: true,
      reason: 'the nude figures offend moderation',
      sanitized_prompt:
        'A fully clothed and draped take on the same scene: the hall keeps its place and mood, the figures keep their identity, everything composed safely for strict moderation.',
      rewrite_cost_usd: 0,
    });
    expect(res.body.image).toBeUndefined();
    expect(sceneImageCalls).toBe(1); // exactly one attempt, no silent retry
    const rewritePrompt = axios.post.mock.calls.find(([url]) => String(url).includes('/chat/completions'))[1]
      .messages[1].content;
    expect(rewritePrompt).toContain('the nude figures offend moderation'); // the actual reason steers the rewrite
    expect(rewritePrompt).toContain('ZERO nudity');
    expect(rewritePrompt).toContain(SCENE_PROMPT);
  });

  it('drop_references paints without the cast portraits entirely', async () => {
    const res = await request(app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'A quiet hall.', drop_references: true })
      .expect(200);
    expect(res.body.references).toEqual([]);
    const body = axios.post.mock.calls[axios.post.mock.calls.length - 1][1];
    expect(body.input_references).toBeUndefined(); // the portraits never ride along
  });
});
