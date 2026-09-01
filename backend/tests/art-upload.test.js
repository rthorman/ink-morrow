'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const axios = require('axios');
const { createTestApp, createStory, addPage } = require('./helpers');

jest.mock('axios');

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function image(format = 'png', { metadataCanary = false } = {}) {
  let pipeline = sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 92, g: 31, b: 77, alpha: 1 },
    },
  });
  if (metadataCanary) {
    pipeline = pipeline.withMetadata({ exif: { IFD0: { Make: 'GPS-DEVICE-CANARY' } } });
  }
  if (format === 'jpeg') return pipeline.jpeg().toBuffer();
  if (format === 'webp') return pipeline.webp().toBuffer();
  if (format === 'gif') return pipeline.gif().toBuffer();
  if (format === 'avif') return pipeline.avif().toBuffer();
  return pipeline.png().toBuffer();
}

function mimeFor(format) {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function upload(app, storyId, buffer, {
  mediaType = 'image/png',
  filename = 'owner-subject.png',
  afterPageId,
  title = 'Owner artwork',
  altText = 'A private, owner-authored image.',
  approveReference = false,
} = {}) {
  let call = request(app)
    .post(`/api/stories/${storyId}/assets/upload`)
    .field('title', title)
    .field('alt_text', altText)
    .field('provider_reference_allowed', String(approveReference));
  if (afterPageId !== undefined) call = call.field('after_page_id', afterPageId || '');
  return call.attach('image', buffer, { filename, contentType: mediaType });
}

describe('PR 07 noncanonical art and safe upload', () => {
  let fixture;
  let imageDir;

  beforeEach(() => {
    axios.post.mockReset();
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-art-upload-'));
    fixture = createTestApp({
      imageDir,
      providerOptions: { env: { OPENROUTER_API_KEY: 'art-upload-test-key' } },
    });
  });

  afterEach(() => {
    fixture.close();
    fs.rmSync(imageDir, { recursive: true, force: true });
  });

  async function storyWithPages(count = 3) {
    const story = await createStory(fixture.app, null, [], { title: 'Illustrated Tale' });
    const pages = [];
    for (let index = 1; index <= count; index += 1) {
      pages.push(await addPage(fixture.app, story.id, `Canonical prose page ${index}.`));
    }
    return { story, pages };
  }

  it('streams arbitrary-subject art without a provider call or narrative mutation', async () => {
    const { story, pages } = await storyWithPages();
    const beforeDeltas = fixture.db.prepare('SELECT COUNT(*) AS value FROM continuity_deltas').get().value;
    const originalReadFileSync = fs.readFileSync;
    const readFile = jest.spyOn(fs, 'readFileSync').mockImplementation((target, ...args) => {
      if (String(target).endsWith('.upload')) throw new Error('staged upload was read wholesale');
      return originalReadFileSync(target, ...args);
    });
    let response;
    try {
      response = await upload(fixture.app, story.id, await image('png'), {
        afterPageId: pages[0].id,
        filename: 'whatever-the-owner-chose.png',
      }).expect(201);
    } finally {
      readFile.mockRestore();
    }

    expect(response.body.asset).toMatchObject({
      story_id: story.id,
      source: 'uploaded',
      status: 'ready',
      source_media_type: 'image/png',
      media_type: 'image/webp',
      width: 12,
      height: 8,
      spend_usd: 0,
      provider_reference_allowed: false,
    });
    expect(response.body.asset).not.toHaveProperty('storage_key');
    expect(response.body.placement).toMatchObject({ after_page_id: pages[0].id, ordinal: 1 });
    expect(axios.post).not.toHaveBeenCalled();
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM story_pages WHERE story_id = ?').get(story.id).value).toBe(3);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM continuity_deltas').get().value).toBe(beforeDeltas);
    expect(fs.readdirSync(path.join(imageDir, 'assets'))).toHaveLength(1);
    expect(fs.readdirSync(path.join(imageDir, 'assets'))[0]).not.toContain('whatever-the-owner-chose');
  });

  it('accepts supported decoders and always serves a normalized raster derivative', async () => {
    const { story } = await storyWithPages(1);
    const formats = ['png', 'jpeg', 'webp'];
    if (sharp.format.gif?.input?.buffer && sharp.format.gif?.output?.buffer) formats.push('gif');
    if (sharp.format.heif?.input?.buffer && sharp.format.heif?.output?.buffer) formats.push('avif');

    for (const format of formats) {
      const response = await upload(fixture.app, story.id, await image(format), {
        mediaType: mimeFor(format),
        filename: `fixture.${format}`,
      }).expect(201);
      expect(response.body.asset.source_media_type).toBe(mimeFor(format));
      expect(response.body.asset.media_type).toBe('image/webp');
      if (format === 'gif') expect(response.body.asset.metadata.animation_flattened).toBe(false);
      const served = await request(fixture.app)
        .get(response.body.asset.content_url)
        .buffer(true)
        .parse(binaryParser)
        .expect('Content-Type', /image\/webp/)
        .expect(200);
      expect(served.headers['cache-control']).toBe('private, no-store');
      expect((await sharp(served.body).metadata()).format).toBe('webp');
    }
  });

  it('strips EXIF device and location canaries from the stored derivative', async () => {
    const { story } = await storyWithPages(1);
    const source = await image('png', { metadataCanary: true });
    expect(source.includes(Buffer.from('GPS-DEVICE-CANARY'))).toBe(true);
    const response = await upload(fixture.app, story.id, source).expect(201);
    const stored = fixture.app.locals.artStore.readAsset(story.id, response.body.asset.id);
    expect(stored.buffer.includes(Buffer.from('GPS-DEVICE-CANARY'))).toBe(false);
    const metadata = await sharp(stored.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(response.body.asset.metadata.metadata_stripped).toBe(true);
  });

  it('rejects malformed, false-MIME, polyglot, oversized, pixel-bomb, and active inputs', async () => {
    const { story } = await storyWithPages(1);
    const png = await image('png');
    await upload(fixture.app, story.id, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), {
      mediaType: 'image/png',
    }).expect(400);
    const falseMime = await upload(fixture.app, story.id, png, { mediaType: 'image/jpeg' }).expect(400);
    expect(falseMime.body.code).toBe('FALSE_IMAGE_TYPE');
    const polyglot = await upload(fixture.app, story.id, Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]))
      .expect(400);
    expect(polyglot.body.code).toBe('IMAGE_POLYGLOT_REJECTED');
    await upload(fixture.app, story.id, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(20 * 1024 * 1024),
    ])).expect(413);
    const active = await upload(fixture.app, story.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), {
      mediaType: 'image/png',
      filename: 'active.png',
    }).expect(400);
    expect(active.body.code).toBe('ACTIVE_IMAGE_REJECTED');

    const bomb = Buffer.from(png);
    bomb.writeUInt32BE(50000, 16);
    bomb.writeUInt32BE(50000, 20);
    const pixelBomb = await upload(fixture.app, story.id, bomb).expect(413);
    expect(pixelBomb.body.code).toBe('IMAGE_PIXEL_LIMIT');
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM assets').get().value).toBe(0);
    expect(fs.readdirSync(fixture.app.locals.artStore.stagingDir)).toEqual([]);
  });

  it('keeps placements stable through display renumbering and unplaces truncated anchors', async () => {
    const { story, pages } = await storyWithPages();
    const created = await upload(fixture.app, story.id, await image('png'), { afterPageId: pages[1].id }).expect(201);
    await request(fixture.app).delete(`/api/stories/${story.id}/pages/1`).expect(204);
    let listing = await request(fixture.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.placements[0].after_page_id).toBe(pages[1].id);
    expect(fixture.db.prepare('SELECT page_number FROM story_pages WHERE id = ?').get(pages[1].id).page_number).toBe(1);

    await request(fixture.app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    listing = await request(fixture.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.assets.map((asset) => asset.id)).toContain(created.body.asset.id);
    // The placement was anchored to the surviving page, so it remains.
    expect(listing.body.placements).toHaveLength(1);

    const tail = await addPage(fixture.app, story.id, 'A replacement tail.');
    const moved = await request(fixture.app)
      .patch(`/api/stories/${story.id}/placements/${created.body.placement.id}`)
      .send({ after_page_id: tail.id, ordinal: 1 })
      .expect(200);
    expect(moved.body.placement.after_page_id).toBe(tail.id);
    await request(fixture.app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    listing = await request(fixture.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.assets).toHaveLength(1);
    expect(listing.body.placements).toEqual([]);
  });

  it('orders, moves, unplaces, and deletes art without touching prose numbering', async () => {
    const { story, pages } = await storyWithPages(2);
    const first = await upload(fixture.app, story.id, await image('png'), { afterPageId: null }).expect(201);
    const second = await upload(fixture.app, story.id, await image('jpeg'), {
      mediaType: 'image/jpeg', filename: 'second.jpg', afterPageId: null,
    }).expect(201);
    expect(first.body.placement.ordinal).toBe(1);
    expect(second.body.placement.ordinal).toBe(2);

    const moved = await request(fixture.app)
      .patch(`/api/stories/${story.id}/placements/${second.body.placement.id}`)
      .send({ after_page_id: null, ordinal: 1 })
      .expect(200);
    expect(moved.body.placement.ordinal).toBe(1);
    let listing = await request(fixture.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.placements.map((placement) => placement.asset_id)).toEqual([
      second.body.asset.id, first.body.asset.id,
    ]);

    await request(fixture.app).delete(`/api/stories/${story.id}/placements/${first.body.placement.id}`).expect(204);
    await request(fixture.app).delete(`/api/stories/${story.id}/assets/${second.body.asset.id}`).expect(204);
    listing = await request(fixture.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(listing.body.assets.map((asset) => asset.id)).toEqual([first.body.asset.id]);
    expect(listing.body.placements).toEqual([]);
    expect(fixture.db.prepare('SELECT group_concat(page_number) AS value FROM story_pages WHERE story_id = ? ORDER BY page_number')
      .get(story.id).value).toBe('1,2');
    expect(pages).toHaveLength(2);
  });

  it('requires explicit selection and approval before uploaded art crosses the provider boundary', async () => {
    const { story } = await storyWithPages(1);
    const created = await upload(fixture.app, story.id, await image('png')).expect(201);
    const blocked = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'Use the selected owner art.', reference_asset_ids: [created.body.asset.id] })
      .expect(409);
    expect(blocked.body.code).toBe('ASSET_REFERENCE_NOT_APPROVED');
    expect(axios.post).not.toHaveBeenCalled();

    const updated = await request(fixture.app)
      .patch(`/api/stories/${story.id}/assets/${created.body.asset.id}`)
      .send({ provider_reference_allowed: true })
      .expect(200);
    expect(updated.body.asset.provider_reference_allowed).toBe(true);
    axios.post.mockResolvedValue({
      data: {
        data: [{ b64_json: (await image('png')).toString('base64'), media_type: 'image/png' }],
        usage: { cost: 0.04 },
      },
    });
    const rendered = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/1/scene-image`)
      .send({ prompt: 'Use the selected owner art.', reference_asset_ids: [created.body.asset.id] })
      .expect(200);
    expect(rendered.body.asset_references).toEqual([created.body.asset.id]);
    const providerBody = axios.post.mock.calls[0][1];
    expect(providerBody.input_references).toHaveLength(1);
    expect(providerBody.input_references[0].image_url.url).toMatch(/^data:image\/webp;base64,/);
  });

  it('reconciles interrupted staging and removes residue on the next boot', async () => {
    fixture.close();
    const dbPath = path.join(imageDir, 'restart.db');
    fixture = createTestApp({
      imageDir,
      dbPath,
      providerOptions: { env: { OPENROUTER_API_KEY: 'art-upload-test-key' } },
    });
    await fixture.app.locals.artStore.ready;
    const story = await createStory(fixture.app);
    const staged = path.join(fixture.app.locals.artStore.stagingDir, 'interrupted.upload');
    fs.writeFileSync(staged, 'partial');
    fixture.db.prepare(`
      INSERT INTO assets (id, story_id, source, status, source_media_type, storage_key)
      VALUES ('interrupted', ?, 'uploaded', 'staging', 'image/png', 'interrupted.webp')
    `).run(story.id);
    fixture.close();

    fixture = createTestApp({
      imageDir,
      dbPath,
      providerOptions: { env: { OPENROUTER_API_KEY: 'art-upload-test-key' } },
    });
    await fixture.app.locals.artStore.ready;
    expect(fs.existsSync(staged)).toBe(false);
    expect(fixture.db.prepare("SELECT id FROM assets WHERE status = 'staging'").get()).toBeUndefined();
  });
});
