'use strict';

const request = require('supertest');
const {
  createTestApp,
  resetDb,
  createWorld,
  createCharacter,
  createStory,
  addPage,
} = require('./helpers');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
});

beforeEach(async () => {
  resetDb(db);
});

afterAll(() => close());

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

describe('Worlds API', () => {
  it('lists worlds as an array', async () => {
    const res = await request(app).get('/api/worlds').expect(200);
    expect(Array.isArray(res.body.worlds)).toBe(true);
    expect(res.body.worlds).toEqual([]);
  });

  it('creates a world with all fields', async () => {
    const res = await request(app)
      .post('/api/worlds')
      .send({ name: 'Gothic City', description: 'A dark place', genre: 'Gothic', setting: 'Victorian' })
      .expect(201);
    expect(res.body.world.id).toBeDefined();
    expect(res.body.world.name).toBe('Gothic City');
    expect(res.body.world.genre).toBe('Gothic');
  });

  it('rejects a world with no name (400, not 500)', async () => {
    const res = await request(app).post('/api/worlds').send({ description: 'no name' }).expect(400);
    expect(res.body.error).toContain('name');
  });

  it('rejects non-string fields', async () => {
    await request(app).post('/api/worlds').send({ name: 'X', description: 42 }).expect(400);
  });

  it('gets a single world and 404s for unknown ids', async () => {
    const world = await createWorld(app);
    const res = await request(app).get(`/api/worlds/${world.id}`).expect(200);
    expect(res.body.world.name).toBe('Test World');
    await request(app).get('/api/worlds/nope').expect(404);
  });

  it('updates a world via PUT', async () => {
    const world = await createWorld(app);
    const res = await request(app)
      .put(`/api/worlds/${world.id}`)
      .send({ name: 'Renamed Realm' })
      .expect(200);
    expect(res.body.world.name).toBe('Renamed Realm');
    expect(res.body.world.genre).toBe('Fantasy'); // untouched fields preserved
  });

  it('refuses to delete a world in use (409) and deletes an empty one', async () => {
    const world = await createWorld(app);
    await createCharacter(app, world.id);
    const conflict = await request(app).delete(`/api/worlds/${world.id}`).expect(409);
    expect(conflict.body.error).toMatch(/referenced by 1 character/);

    const empty = await createWorld(app, { name: 'Empty' });
    await request(app).delete(`/api/worlds/${empty.id}`).expect(204);
    await request(app).get(`/api/worlds/${empty.id}`).expect(404);
  });
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

describe('Characters API', () => {
  it('creates a character with and without a world', async () => {
    const world = await createWorld(app);
    const withWorld = await createCharacter(app, world.id);
    expect(withWorld.world_id).toBe(world.id);

    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'Wanderer' })
      .expect(201);
    expect(res.body.character.world_id).toBeNull();
  });

  it('rejects a character referencing a non-existent world', async () => {
    const res = await request(app)
      .post('/api/characters')
      .send({ name: 'Ghost', world_id: 'does-not-exist' })
      .expect(400);
    expect(res.body.error).toContain('world_id');
  });

  it('filters characters by world_id', async () => {
    const w1 = await createWorld(app, { name: 'One' });
    const w2 = await createWorld(app, { name: 'Two' });
    await createCharacter(app, w1.id, { name: 'Belongs to One' });
    await createCharacter(app, w2.id, { name: 'Belongs to Two' });
    await createCharacter(app, null, { name: 'Worldless' });

    const res = await request(app).get(`/api/characters?world_id=${w1.id}`).expect(200);
    expect(res.body.characters).toHaveLength(1);
    expect(res.body.characters[0].name).toBe('Belongs to One');
  });

  it('removes a deleted character from story casts', async () => {
    const character = await createCharacter(app);
    const story = await createStory(app, null, [character.id]);
    expect(story.characters).toEqual([{ id: character.id, role: 'supporting' }]);

    await request(app).delete(`/api/characters/${character.id}`).expect(204);

    const updated = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(updated.body.story.characters).toEqual([]);
  });

  it('updates a character via PUT', async () => {
    const character = await createCharacter(app);
    const res = await request(app)
      .put(`/api/characters/${character.id}`)
      .send({ personality: 'Now grumpy' })
      .expect(200);
    expect(res.body.character.personality).toBe('Now grumpy');
    expect(res.body.character.name).toBe('Sir Gideon');
  });
});

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

describe('Stories API', () => {
  it('creates a story and returns parsed characters + page_count', async () => {
    const world = await createWorld(app);
    const c1 = await createCharacter(app, world.id);
    const c2 = await createCharacter(app, world.id);

    const res = await request(app)
      .post('/api/stories')
      .send({ title: 'Two Heroes', world_id: world.id, characters: [c1.id, c2.id] })
      .expect(201);

    expect(res.body.story.characters).toEqual([
      { id: c1.id, role: 'supporting' },
      { id: c2.id, role: 'supporting' },
    ]); // parsed {id, role} cast, not a JSON string
    expect(res.body.story.page_count).toBe(0);
    expect(res.body.story.tone).toBe('fade-to-black'); // default
  });

  it('validates tone values', async () => {
    await request(app).post('/api/stories').send({ title: 'X', tone: 'spicy' }).expect(400);
    const ok = await request(app)
      .post('/api/stories')
      .send({ title: 'X', tone: 'explicit' })
      .expect(201);
    expect(ok.body.story.tone).toBe('explicit');
  });

  it('validates that cast members exist', async () => {
    const res = await request(app)
      .post('/api/stories')
      .send({ title: 'X', characters: ['nonexistent'] })
      .expect(400);
    expect(res.body.error).toContain('unknown id');
  });

  it('updates title/tone via PUT', async () => {
    const story = await createStory(app);
    const res = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ title: 'New Title', tone: 'romantic' })
      .expect(200);
    expect(res.body.story.title).toBe('New Title');
    expect(res.body.story.tone).toBe('romantic');
  });

  it('deletes a story and cascades its pages', async () => {
    const story = await createStory(app);
    await addPage(app, story.id, 'Page one');
    await addPage(app, story.id, 'Page two');

    await request(app).delete(`/api/stories/${story.id}`).expect(204);
    expect(db.prepare('SELECT COUNT(*) AS c FROM story_pages').get().c).toBe(0);
    await request(app).get(`/api/stories/${story.id}`).expect(404);
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

describe('Story pages', () => {
  it('assigns sequential page numbers', async () => {
    const story = await createStory(app);
    const p1 = await addPage(app, story.id, 'One');
    const p2 = await addPage(app, story.id, 'Two');
    const p3 = await addPage(app, story.id, 'Three');
    expect([p1.page_number, p2.page_number, p3.page_number]).toEqual([1, 2, 3]);
  });

  it('stores user_input alongside content', async () => {
    const story = await createStory(app);
    const page = await addPage(app, story.id, 'The knight rode forth.', 'Enter the forest');
    expect(page.user_input).toBe('Enter the forest');
  });

  it('requires content', async () => {
    const story = await createStory(app);
    await request(app).post(`/api/stories/${story.id}/pages`).send({}).expect(400);
  });

  it('deletes a single page by number', async () => {
    const story = await createStory(app);
    await addPage(app, story.id, 'One');
    await addPage(app, story.id, 'Two');

    await request(app).delete(`/api/stories/${story.id}/pages/1`).expect(204);
    const res = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0].page_number).toBe(2); // historic numbering preserved
    await request(app).delete(`/api/stories/${story.id}/pages/99`).expect(404);
  });

  it('404s pages for an unknown story', async () => {
    await request(app).get('/api/stories/nope/pages').expect(404);
  });
});

// ---------------------------------------------------------------------------
// Referential integrity + export
// ---------------------------------------------------------------------------

describe('Database integrity and export', () => {
  it('enforces foreign keys', () => {
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(() =>
      db.prepare("INSERT INTO stories (id, title, world_id) VALUES ('s1', 'Bad', 'no-such-world')").run()
    ).toThrow();
  });

  it('exports a story as a valid EPUB of the full story', async () => {
    const world = await createWorld(app, { name: 'Export Realm' });
    const character = await createCharacter(app, world.id, { name: 'Hero of Exports' });
    const story = await createStory(app, world.id, [character.id], { title: 'Exported Tale' });
    await addPage(app, story.id, 'First page body.');
    await addPage(app, story.id, 'Second page body.');

    const binaryParser = (res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const res = await request(app).get(`/api/stories/${story.id}/export`).buffer().parse(binaryParser).expect(200);
    expect(res.headers['content-type']).toMatch(/epub\+zip/);
    expect(res.headers['content-disposition']).toContain('exported_tale.epub');

    const buf = res.body; // supertest gives a Buffer for binary responses
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // PK\x03\x04

    // The mimetype entry (stored, first) must be exactly the epub type.
    const text = buf.toString('latin1');
    const mimetypeIndex = text.indexOf('application/epub+zip');
    expect(mimetypeIndex).toBeGreaterThan(0);

    // Content is present: package, manifest, pages, credits.
    const asText = buf.toString('utf8');
    expect(asText).toContain('<dc:title>Exported Tale</dc:title>');
    expect(asText).toContain('Export Realm');
    expect(asText).toContain('Hero of Exports');
    expect(asText).toContain('First page body.');
    expect(asText).toContain('Second page body.');
    expect(asText).toContain('page-1.xhtml');
    expect(asText).toContain('page-2.xhtml');
  });
});

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------

describe('API hygiene', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/definitely-not-a-route').expect(404);
    expect(res.body.error).toBe('Not found');
  });
});
// ---------------------------------------------------------------------------
// Truncate after page
// ---------------------------------------------------------------------------

describe('DELETE /api/stories/:id/pages?after=N', () => {
  it('deletes every page after N and reports what remains', async () => {
    const story = await createStory(app, { title: 'Truncation Tale' });
    for (let i = 1; i <= 4; i++) await addPage(app, story.id, `Body ${i}.`);

    const res = await request(app).delete(`/api/stories/${story.id}/pages?after=2`).expect(200);
    expect(res.body).toEqual({ deleted: 2, remaining: 2 });

    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages.map((p) => p.page_number)).toEqual([1, 2]);
  });

  it('is a no-op when N is the last page', async () => {
    const story = await createStory(app, { title: 'Tail Tale' });
    await addPage(app, story.id, 'Only page.');

    const res = await request(app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    expect(res.body).toEqual({ deleted: 0, remaining: 1 });
  });

  it('400s on a bad after value', async () => {
    const story = await createStory(app, { title: 'Bad After' });
    await request(app).delete(`/api/stories/${story.id}/pages?after=zero`).expect(400);
    await request(app).delete(`/api/stories/${story.id}/pages`).expect(400);
  });
});
