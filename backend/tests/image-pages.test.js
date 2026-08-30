'use strict';

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { buildPrompt } = require('../src/prompt');
const { resetDb, createWorld, createStory, addPage } = require('./helpers');

// Image pages never call the upstream (the client sends the painted bytes);
// axios stays unmocked so any surprise call would fail loudly.

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let app, db, close, imageDir;

beforeAll(() => {
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-image-pages-'));
  db = createDb(':memory:');
  app = createApp(db, { staticDir: null, imageDir });
  close = () => db.close();
});

beforeEach(async () => {
  resetDb(db);
  const pagesDir = path.join(imageDir, 'pages');
  for (const f of fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir) : []) {
    fs.unlinkSync(path.join(pagesDir, f));
  }
});

afterAll(() => {
  close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});

async function seedStory() {
  const world = await createWorld(app, { name: 'Plate Realm' });
  const story = await createStory(app, world.id, [], { title: 'Plated Tale' });
  await addPage(app, story.id, 'First page body.');
  await addPage(app, story.id, 'Second page body.');
  await addPage(app, story.id, 'Third page body.');
  return story;
}

function postImagePage(storyId, after, overrides = {}) {
  return request(app)
    .post(`/api/stories/${storyId}/pages/${after}/image-page`)
    .send({
      image: PNG_BYTES.toString('base64'),
      media_type: 'image/png',
      prompt: 'A candlelit hall, shadows leaning in.',
      cost_usd: 0.04,
      ...overrides,
    });
}

function storedPageFiles() {
  const dir = path.join(imageDir, 'pages');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe('Image pages', () => {
  it('inserts a painted plate after the given page and renumbers the rest', async () => {
    const story = await seedStory();
    const res = await postImagePage(story.id, 1).expect(201);
    const page = res.body.page;
    expect(page.page_number).toBe(2);
    expect(page.content).toBe('');
    expect(page.image_media_type).toBe('image/png');
    expect(page.image_prompt).toBe('A candlelit hall, shadows leaning in.');
    expect(page.cost_usd).toBeCloseTo(0.04);

    const list = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    const numbers = list.body.pages.map((p) => p.page_number);
    expect(numbers).toEqual([1, 2, 3, 4]);
    // The illustration sits between the first page and the old second page.
    expect(list.body.pages[1].image_media_type).toBe('image/png');
    expect(list.body.pages[2].content).toBe('Second page body.');
    expect(list.body.pages[2].page_number).toBe(3);
    expect(list.body.pages[3].content).toBe('Third page body.');
    expect(list.body.pages[3].page_number).toBe(4);

    // Story totals now include the paint cost; the file is on disk.
    const storyRes = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(storyRes.body.story.total_cost_usd).toBeCloseTo(0.04);
    expect(storedPageFiles()).toHaveLength(1);
  });

  it('appends when the illustrated page is the last one', async () => {
    const story = await seedStory();
    const res = await postImagePage(story.id, 3).expect(201);
    expect(res.body.page.page_number).toBe(4);
    const list = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(list.body.pages).toHaveLength(4);
    expect(list.body.pages[3].image_media_type).toBe('image/png');
  });

  it('serves the stored plate bytes with the right media type', async () => {
    const story = await seedStory();
    await postImagePage(story.id, 2).expect(201);
    const res = await request(app).get(`/api/stories/${story.id}/pages/3/image`).expect(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.equals(PNG_BYTES)).toBe(true);
  });

  it('rejects invalid payloads without touching the story', async () => {
    const story = await seedStory();
    await postImagePage(story.id, 1, { media_type: 'image/gif' }).expect(400);
    await postImagePage(story.id, 1, { image: '' }).expect(400);
    await postImagePage(story.id, 1, { prompt: 'x'.repeat(4001) }).expect(400);
    await postImagePage(story.id, 1, { cost_usd: -1 }).expect(400);
    await postImagePage(story.id, 99).expect(404);
    await request(app).post(`/api/stories/no-such-story/pages/1/image-page`).send({}).expect(404);
    const list = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(list.body.pages).toHaveLength(3);
    expect(storedPageFiles()).toHaveLength(0);
  });

  it('invalidates any speculative preview (a live write happened)', async () => {
    const story = await seedStory();
    db.prepare('INSERT INTO story_previews (story_id, expected_page, raw_content) VALUES (?, ?, ?)').run(
      story.id, 4, 'A prepared page.'
    );
    await postImagePage(story.id, 2).expect(201);
    const preview = db.prepare('SELECT * FROM story_previews WHERE story_id = ?').get(story.id);
    expect(preview).toBeUndefined();
  });

  it('embeds the plate in the exported EPUB', async () => {
    const story = await seedStory();
    await postImagePage(story.id, 2).expect(201);
    const binaryParser = (res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const res = await request(app).get(`/api/stories/${story.id}/export`).buffer().parse(binaryParser).expect(200);
    const asText = res.body.toString('utf8');
    expect(asText).toContain('<item id="img3" href="images/page-3.png" media-type="image/png"/>');
    expect(asText).toContain('<img src="images/page-3.png"');
    expect(asText).toContain('A candlelit hall, shadows leaning in.'); // alt text
    expect(res.body.includes(PNG_BYTES)).toBe(true); // the actual bytes
    // Text pages survive untouched around the plate.
    expect(asText).toContain('Second page body.');
    expect(asText).toContain('Third page body.');
  });

  it('exports cleanly when a plate file went missing (legacy grace)', async () => {
    const story = await seedStory();
    await postImagePage(story.id, 2).expect(201);
    for (const f of storedPageFiles()) fs.unlinkSync(path.join(imageDir, 'pages', f));
    const res = await request(app).get(`/api/stories/${story.id}/export`).expect(200);
    expect(res.body.toString('utf8')).not.toContain('<img src="images/');
  });

  it('removes the plate file when its page is deleted, truncated away, or the story dies', async () => {
    const story = await seedStory();
    await postImagePage(story.id, 1).expect(201); // plate on page 2
    await postImagePage(story.id, 2).expect(201); // plate on page 3
    expect(storedPageFiles()).toHaveLength(2);

    // Single page delete: the plate row (page 2) goes, its file with it.
    await request(app).delete(`/api/stories/${story.id}/pages/2`).expect(204);
    expect(storedPageFiles()).toHaveLength(1);

    // Truncate after page 1: the remaining plate (now page 2) is destroyed.
    await request(app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    expect(storedPageFiles()).toHaveLength(0);

    // Story delete leaves nothing behind either.
    await postImagePage(story.id, 1).expect(201);
    await request(app).delete(`/api/stories/${story.id}`).expect(204);
    expect(storedPageFiles()).toHaveLength(0);
  });

  it('serves 404 (not 500) for a text page or a missing plate file', async () => {
    const story = await seedStory();
    await request(app).get(`/api/stories/${story.id}/pages/1/image`).expect(404);
    await postImagePage(story.id, 1).expect(201);
    for (const f of storedPageFiles()) fs.unlinkSync(path.join(imageDir, 'pages', f));
    const res = await request(app).get(`/api/stories/${story.id}/pages/2/image`).expect(404);
    expect(res.body.error).toBe('Image file is missing');
  });

  it('represents an image page as an illustration marker in generation context', () => {
    const prompt = buildPrompt({
      story: { tone: 'fade-to-black' },
      world: null,
      characters: [],
      pages: {
        total: 2,
        firstContent: 'First page body.',
        included: [
          { page_number: 1, content: 'First page body.', image_media_type: null },
          { page_number: 2, content: '', image_media_type: 'image/png', image_prompt: 'A candlelit hall' },
        ],
      },
      userInput: 'go on',
    });
    expect(prompt).toContain('Page 1:\nFirst page body.');
    expect(prompt).toContain('Page 2:\n[an inserted illustration (painted from: A candlelit hall)]');
  });

  it('reports the free space of the filesystem that holds the plates', async () => {
    const res = await request(app).get('/api/disk').expect(200);
    expect(typeof res.body.free_bytes).toBe('number');
    expect(typeof res.body.total_bytes).toBe('number');
    expect(res.body.free_bytes).toBeGreaterThan(0);
    expect(res.body.total_bytes).toBeGreaterThan(0);
    expect(res.body.total_bytes).toBeGreaterThanOrEqual(res.body.free_bytes);
  });
});
