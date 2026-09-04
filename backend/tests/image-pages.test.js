'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { resetDb, createWorld, createStory, addPage } = require('./helpers');

let app, db, imageDir;

beforeAll(() => {
  imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-art-pages-'));
  db = createDb(':memory:');
  app = createApp(db, { staticDir: null, imageDir });
});

beforeEach(() => {
  resetDb(db);
  const assetsDir = path.join(imageDir, 'assets');
  for (const name of fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []) {
    fs.unlinkSync(path.join(assetsDir, name));
  }
});

afterAll(() => {
  app.locals.dispose();
  db.close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});

async function png() {
  return sharp({
    create: { width: 12, height: 8, channels: 4, background: '#5c1f4d' },
  }).png().toBuffer();
}

async function seedStory() {
  const world = await createWorld(app, { name: 'Plate Realm' });
  const story = await createStory(app, world.id, [], { title: 'Plated Tale' });
  const pages = [];
  for (const content of ['First page body.', 'Second page body.', 'Third page body.']) {
    pages.push(await addPage(app, story.id, content));
  }
  return { story, pages };
}

async function placeGenerated(storyId, after, overrides = {}, status = 201) {
  return request(app)
    .post(`/api/stories/${storyId}/pages/${after}/image-page`)
    .send({
      image: (await png()).toString('base64'),
      media_type: 'image/png',
      prompt: 'A candlelit hall, shadows leaning in.',
      cost_usd: 0.04,
      ...overrides,
    })
    .expect(status);
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Noncanonical generated art compatibility', () => {
  it('saves generated art Gallery-only with bounded provider provenance and stable anchors', async () => {
    const { story, pages } = await seedStory();
    const response = await placeGenerated(story.id, 2, {
      gallery_only: true,
      title: 'Moonlit gallery study',
      alt_text: 'A silver-lit study of the second scene.',
      provider: { adapter: 'grok', model: 'grok-imagine', profile_name: 'Grok Imagine' },
      references: ['asset-reference-1'],
    });

    expect(response.body.placement).toBeNull();
    expect(response.body.asset).toMatchObject({
      title: 'Moonlit gallery study',
      alt_text: 'A silver-lit study of the second scene.',
      provider_provenance: {
        prompt: 'A candlelit hall, shadows leaning in.',
        provider: { adapter: 'grok', model: 'grok-imagine', profile_name: 'Grok Imagine' },
        references: ['asset-reference-1'],
      },
    });
    const listing = await request(app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.assets).toHaveLength(1);
    expect(listing.body.placements).toEqual([]);
    const anchors = await request(app).get(`/api/stories/${story.id}/assets/anchors`).expect(200);
    expect(anchors.body).toEqual({
      anchors: pages.map((page, index) => ({ page_id: page.id, page_number: index + 1 })),
    });
    expect(JSON.stringify(anchors.body)).not.toContain('page body');
    expect((await request(app).get(`/api/stories/${story.id}/pages`).expect(200)).body.pages).toHaveLength(3);
  });

  it('places a normalized asset after a stable prose page without renumbering canon', async () => {
    const { story, pages } = await seedStory();
    const response = await placeGenerated(story.id, 1);
    expect(response.body.asset).toMatchObject({
      story_id: story.id,
      source: 'ai-generated',
      status: 'ready',
      source_media_type: 'image/png',
      media_type: 'image/webp',
      spend_usd: 0.04,
    });
    expect(response.body.placement).toMatchObject({ after_page_id: pages[0].id, ordinal: 1 });

    const list = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(list.body.pages.map((page) => [page.id, page.page_number, page.content])).toEqual([
      [pages[0].id, 1, 'First page body.'],
      [pages[1].id, 2, 'Second page body.'],
      [pages[2].id, 3, 'Third page body.'],
    ]);
    expect(db.prepare('SELECT COUNT(*) AS value FROM pages').get().value).toBe(3);
    expect((await request(app).get(`/api/stories/${story.id}`).expect(200)).body.story.total_cost_usd)
      .toBeCloseTo(0.04);
  });

  it('does not invalidate a prepared next page or add continuity rows', async () => {
    const { story } = await seedStory();
    db.prepare('INSERT INTO story_previews (story_id, expected_page, raw_content) VALUES (?, ?, ?)')
      .run(story.id, 4, 'A prepared page.');
    const before = db.prepare('SELECT COUNT(*) AS value FROM continuity_deltas').get().value;
    await placeGenerated(story.id, 2);
    expect(db.prepare('SELECT raw_content FROM story_previews WHERE story_id = ?').get(story.id))
      .toEqual({ raw_content: 'A prepared page.' });
    expect(db.prepare('SELECT COUNT(*) AS value FROM continuity_deltas').get().value).toBe(before);
  });

  it('serves the normalized derivative and exports it as a separate EPUB image page', async () => {
    const { story } = await seedStory();
    const placed = await placeGenerated(story.id, 2);
    const asset = placed.body.asset;
    const media = await request(app).get(asset.content_url).buffer().parse(binaryParser).expect(200);
    expect(media.headers['content-type']).toMatch(/image\/webp/);
    expect(media.headers['cache-control']).toContain('private');
    expect((await sharp(media.body).metadata()).format).toBe('webp');

    const epub = await request(app).get(`/api/stories/${story.id}/export`).buffer().parse(binaryParser).expect(200);
    const text = epub.body.toString('utf8');
    expect(text).toContain('EPUB/images/asset-1.png');
    expect(text).toContain('rendition:layout-pre-paginated');
    expect(text).toContain('A candlelit hall, shadows leaning in.');
    expect(text).toContain('Second page body.');
    expect(text).toContain('EPUB/book.xhtml');
    // EPUB uses the same normalized pixels in a core-media PNG container.
    expect(epub.body.includes(await sharp(media.body).png().toBuffer())).toBe(true);
  });

  it('unplaces art when its anchor is deleted while retaining the asset', async () => {
    const { story } = await seedStory();
    const placed = await placeGenerated(story.id, 2);
    await request(app).delete(`/api/stories/${story.id}/pages/2`).expect(204);
    const art = await request(app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(art.body.assets.map((asset) => asset.id)).toContain(placed.body.asset.id);
    expect(art.body.placements).toEqual([]);
    expect((await request(app).get(`/api/stories/${story.id}/pages`).expect(200)).body.pages)
      .toHaveLength(2);
  });

  it('rejects malformed generated bytes and invalid metadata without touching prose', async () => {
    const { story } = await seedStory();
    await request(app).post(`/api/stories/${story.id}/pages/1/image-page`)
      .send({ image: Buffer.from('not-png').toString('base64'), media_type: 'image/png' }).expect(400);
    await placeGenerated(story.id, 1, { media_type: 'image/gif' }, 400);
    await placeGenerated(story.id, 1, { cost_usd: -1 }, 400);
    await placeGenerated(story.id, 1, { gallery_only: 'yes' }, 400);
    await placeGenerated(story.id, 1, { title: 'x'.repeat(501) }, 400);
    expect(db.prepare('SELECT COUNT(*) AS value FROM assets').get().value).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS value FROM manuscript_pages WHERE story_id = ?').get(story.id).value).toBe(3);
  });

  it('deletes asset media with its story and reports the art filesystem capacity', async () => {
    const { story } = await seedStory();
    await placeGenerated(story.id, 1);
    expect(fs.readdirSync(path.join(imageDir, 'assets'))).toHaveLength(1);
    await request(app).delete(`/api/stories/${story.id}`).expect(204);
    expect(fs.readdirSync(path.join(imageDir, 'assets'))).toHaveLength(0);
    const disk = await request(app).get('/api/disk').expect(200);
    expect(disk.body.free_bytes).toBeGreaterThan(0);
    expect(disk.body.total_bytes).toBeGreaterThanOrEqual(disk.body.free_bytes);
  });
});
