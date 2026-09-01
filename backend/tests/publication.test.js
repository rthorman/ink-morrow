'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const { createTestApp, createStory, addPage } = require('./helpers');
const {
  semanticView, renderPublication, rereadPublication, publicationChunks, validateEpub, validatePdf,
} = require('../src/modules/publication/adapters');
const schema = require('../src/modules/publication/publication-document.schema.json');

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function tinyPng() {
  return sharp({
    create: { width: 8, height: 6, channels: 4, background: { r: 30, g: 50, b: 90, alpha: 1 } },
  }).png().toBuffer();
}

describe('PR 15 PublicationDocument and core adapters', () => {
  let fixture;
  let imageDir;

  beforeEach(() => {
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-publication-'));
    fixture = createTestApp({ imageDir });
  });

  afterEach(() => {
    fixture.close();
    fs.rmSync(imageDir, { recursive: true, force: true });
  });

  async function manuscript() {
    const story = await createStory(fixture.app, null, [], { title: 'A Tale: Unicode' });
    const first = await addPage(fixture.app, story.id, 'Canonical prose must not escape.', 'PRIVATE-DIRECTION-CANARY');
    await addPage(fixture.app, story.id, 'Tail prose.');
    await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${first.id}/copyedits`)
      .set('Idempotency-Key', 'publication-copyedit')
      .send({ content: 'Café — “quoted” & <clean>.\n\n***\n\nSecond paragraph.' })
      .expect(201);
    const hierarchy = fixture.app.locals.publications ?
      fixture.db.prepare('SELECT id FROM volumes WHERE story_id = ? ORDER BY ordinal').get(story.id) : null;
    await request(fixture.app)
      .post(`/api/stories/${story.id}/volumes/${hierarchy.id}/chapters`)
      .send({ title: 'An Empty Chapter' })
      .expect(201);
    const uploaded = await request(fixture.app)
      .post(`/api/stories/${story.id}/assets/upload`)
      .field('title', 'Midnight plate')
      .field('alt_text', 'Moonlight above a quiet tower.')
      .field('after_page_id', first.id)
      .attach('image', await tinyPng(), { filename: 'plate.png', contentType: 'image/png' })
      .expect(201);
    return { story, first, asset: uploaded.body.asset };
  }

  it('freezes one allowlisted snapshot with display copyedits, hierarchy, scene breaks, and selected art', async () => {
    const { story, asset } = await manuscript();
    fixture.db.prepare("UPDATE stories SET image_prompt = 'PRIVATE-PROMPT-CANARY', image_cost_usd = 999 WHERE id = ?").run(story.id);

    const response = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({
        metadata: { author: 'Ada Author', language: 'en-GB', rights: 'Copyright Ada' },
        front_matter: [{ role: 'dedication', title: 'For readers', text: 'With gratitude.' }],
        back_matter: [{ role: 'about-author', title: 'About Ada', text: 'Ada writes.' }],
        art: { asset_ids: [asset.id] },
      })
      .expect(201);

    const snapshot = response.body.snapshot;
    expect(snapshot.formats).toEqual(['docx', 'odt', 'rtf', 'epub', 'pdf', 'html', 'md', 'txt', 'json']);
    expect(snapshot.document).toMatchObject({
      format: 'ink-morrow-publication-document',
      schema_version: 1,
      metadata: { title: 'A Tale: Unicode', author: 'Ada Author', language: 'en-GB' },
    });
    expect(snapshot.document.volumes[0].chapters).toHaveLength(2);
    expect(snapshot.document.volumes[0].chapters[1]).toMatchObject({ title: 'An Empty Chapter', pages: [] });
    const blocks = snapshot.document.volumes[0].chapters[0].pages[0].blocks;
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Café — “quoted” & <clean>.' },
      { type: 'scene_break' },
      { type: 'paragraph', text: 'Second paragraph.' },
      { type: 'art', asset_key: 'asset-1', alt_text: 'Moonlight above a quiet tower.', position: 'after' },
    ]);
    expect(snapshot.document.assets[0]).toMatchObject({
      key: 'asset-1', media_type: 'image/webp', title: 'Midnight plate', alt_text: 'Moonlight above a quiet tower.',
    });
    const serialized = JSON.stringify(snapshot.document);
    expect(serialized).not.toContain('Canonical prose must not escape.');
    expect(serialized).not.toContain('PRIVATE-DIRECTION-CANARY');
    expect(serialized).not.toContain('PRIVATE-PROMPT-CANARY');
    expect(serialized).not.toContain('999');
    expect(serialized).not.toContain(story.id);
    expect(Object.keys(snapshot.document).sort()).toEqual(['assets', 'back_matter', 'format', 'front_matter', 'metadata', 'schema_version', 'volumes']);
    expect(schema.additionalProperties).toBe(false);

    expect(() => fixture.db.prepare("UPDATE publication_snapshots SET document_json = '{}' WHERE id = ?").run(snapshot.id))
      .toThrow(/immutable/);
    const fetched = await request(fixture.app).get(`/api/publications/${snapshot.id}`).expect(200);
    expect(fetched.body.snapshot.sha256).toBe(snapshot.sha256);
    expect(fetched.body.snapshot.document).toEqual(snapshot.document);
  });

  it('renders every adapter from the exact same immutable semantic view and emits parseable packages', async () => {
    const { story, asset } = await manuscript();
    const created = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({ metadata: { author: 'Ada Author' }, art: { asset_ids: [asset.id] } })
      .expect(201);
    const { id, sha256, document } = created.body.snapshot;
    const semantics = semanticView(document);
    const semanticText = semantics.map((item) => item.text);
    expect(semantics.map((item) => item.text)).toEqual(expect.arrayContaining([
      'A Tale: Unicode', 'Ada Author', 'Café — “quoted” & <clean>.', '* * *',
      '[Illustration: Moonlight above a quiet tower.]', 'An Empty Chapter',
    ]));

    for (const format of ['docx', 'odt', 'rtf', 'epub', 'pdf', 'html', 'md', 'txt', 'json']) {
      const response = await request(fixture.app)
        .get(`/api/publications/${id}/formats/${format}`)
        .buffer()
        .parse(binaryParser)
        .expect(200);
      expect(response.headers['content-disposition']).toContain(`a-tale-unicode.${format}`);
      expect(response.headers['x-publication-snapshot']).toBe(sha256);
      expect(response.body.length).toBeGreaterThan(20);
      const bytesAsText = response.body.toString('utf8');
      expect(bytesAsText).not.toContain('PRIVATE-DIRECTION-CANARY');
      if (format === 'docx') {
        expect(response.body.subarray(0, 2).toString()).toBe('PK');
        expect(bytesAsText).toContain('word/document.xml');
        expect(bytesAsText).toContain('Caf');
        expect(bytesAsText).toContain('word/media/asset-1.png');
      } else if (format === 'odt') {
        expect(response.body.subarray(0, 2).toString()).toBe('PK');
        expect(bytesAsText).toContain('application/vnd.oasis.opendocument.text');
        expect(bytesAsText).toContain('Pictures/asset-1.png');
      } else if (format === 'rtf') {
        expect(bytesAsText).toMatch(/^\{\\rtf1/);
        expect(bytesAsText).toContain('Illustration: Moonlight above a quiet tower.');
        expect(bytesAsText).toContain('\\pngblip');
      } else if (format === 'epub') {
        expect(response.body.subarray(0, 2).toString()).toBe('PK');
        expect(bytesAsText).toContain('application/epub+zip');
        expect(bytesAsText).toContain('EPUB/images/asset-1.webp');
        expect(validateEpub(response.body)).toEqual({ valid: true, errors: [] });
      } else if (format === 'pdf') {
        expect(bytesAsText).toMatch(/^%PDF-1\.7/);
        expect(bytesAsText).toContain('/FontFile2');
        expect(bytesAsText).toContain('/Subtype /Image');
        expect(validatePdf(response.body)).toEqual({ valid: true, errors: [] });
      } else if (format === 'html') {
        expect(bytesAsText).toContain('<!doctype html>');
        expect(bytesAsText).toContain('data:image/webp;base64,');
        expect(bytesAsText).not.toContain('<script');
        expect(bytesAsText).toContain('&lt;clean&gt;');
      } else if (format === 'md') {
        expect(bytesAsText).toContain('data:image/webp;base64,');
        expect(bytesAsText).toContain('## Volume I');
      } else if (format === 'txt') {
        expect(bytesAsText).toContain('Café — “quoted” & <clean>.');
      } else {
        expect(JSON.parse(bytesAsText)).toEqual(document);
      }
      expect(rereadPublication(format, response.body)).toEqual(semanticText);
    }

    const firstJson = await renderPublication(document, 'json');
    const secondJson = await renderPublication(document, 'json');
    expect(firstJson.buffer.equals(secondJson.buffer)).toBe(true);
  });

  it('fails closed on overpublication fields, stale review, missing art, and format forks', async () => {
    const story = await createStory(fixture.app, null, [], { title: 'Private Draft' });
    await addPage(fixture.app, story.id, 'Public prose.');

    const privateField = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({ continuity: { canary: 'DO-NOT-PUBLISH' } })
      .expect(400);
    expect(privateField.body.code).toBe('PUBLICATION_FIELD_NOT_ALLOWED');
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM publication_snapshots').get().value).toBe(0);

    const stale = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({ expected_story_updated_at: '1900-01-01T00:00:00Z' })
      .expect(409);
    expect(stale.body.code).toBe('PUBLICATION_STORY_CHANGED');

    const art = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({ art: { asset_ids: ['missing-asset'] } })
      .expect(400);
    expect(art.body.code).toBe('PUBLICATION_ART_MISSING');

    const snapshot = fixture.app.locals.publications.snapshot(story.id, {});
    const unsupported = await request(fixture.app)
      .get(`/api/publications/${snapshot.id}/formats/mobi`)
      .expect(400);
    expect(unsupported.body.code).toBe('PUBLICATION_FORMAT_UNSUPPORTED');
  });

  it('warns without blocking when selected art has no accessible description', async () => {
    const story = await createStory(fixture.app, null, [], { title: 'Art Warning' });
    const page = await addPage(fixture.app, story.id, 'A page.');
    const uploaded = await request(fixture.app)
      .post(`/api/stories/${story.id}/assets/upload`)
      .field('after_page_id', page.id)
      .attach('image', await tinyPng(), { filename: 'plate.png', contentType: 'image/png' })
      .expect(201);
    const response = await request(fixture.app)
      .post(`/api/stories/${story.id}/publications`)
      .send({ art: { asset_ids: [uploaded.body.asset.id] } })
      .expect(201);
    expect(response.body.snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'ART_ALT_TEXT_MISSING', asset_key: 'asset-1' }),
    ]);
  });

  it('streams a long plain-text manuscript in bounded semantic chunks', async () => {
    const document = {
      format: 'ink-morrow-publication-document',
      schema_version: 1,
      metadata: { title: 'Long Work', subtitle: null, author: '', language: 'en', description: null, publisher: null, rights: null, date: null },
      front_matter: [],
      volumes: [{
        ordinal: 1,
        title: 'Volume I',
        chapters: [{
          ordinal: 1,
          title: 'Chapter I',
          pages: Array.from({ length: 3000 }, (_, index) => ({
            ordinal: index + 1,
            blocks: [{ type: 'paragraph', text: `Page ${index + 1} ${'prose '.repeat(80)}` }],
          })),
        }],
      }],
      back_matter: [],
      assets: [],
    };
    const chunks = [];
    for await (const chunk of publicationChunks(document, 'txt')) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(3000);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(1024);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('Page 3000');
  });
});
