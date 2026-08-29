'use strict';

const request = require('supertest');
const {
  createTestApp,
  resetDb,
  createWorld,
  createCharacter,
  createStory,
} = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.AI_RETRY_BASE_DELAY = '1';
});

beforeEach(async () => {
  resetDb(db);
  axios.post.mockReset();
  let n = 0;
  axios.post.mockImplementation(() => {
    n += 1;
    return Promise.resolve({
      data: { choices: [{ message: { content: `Generated page ${n}: the tale unfolds.` } }] },
    });
  });
});

afterAll(() => close());

describe('End-to-end authoring workflow', () => {
  it('world -> characters -> story -> three pages -> export', async () => {
    // 1. World
    const world = await createWorld(app, {
      name: 'The Ashen Vale',
      description: 'A valley where the sun never quite rises',
      genre: 'Gothic Fantasy',
      setting: 'Late medieval',
    });

    // 2. Characters (one bound to the world, one free-floating)
    const knight = await createCharacter(app, world.id, { name: 'Ser Miren' });
    const witch = await createCharacter(app, null, { name: 'Old Ivy' });

    // 3. Story with an adult tone
    const story = await createStory(app, world.id, [knight.id, witch.id], {
      title: 'The Vale Remembers',
      tone: 'romantic',
    });

    // 4. Generate three pages interactively
    const directions = ['They meet at the shrine', 'Ivy offers a bargain', 'Miren hesitates'];
    for (const direction of directions) {
      const res = await request(app)
        .post(`/api/stories/${story.id}/pages/generate`)
        .send({ user_input: direction })
        .expect(201);
      expect(res.body.page.content).toMatch(/Generated page \d+/);
      expect(res.body.page.user_input).toBe(direction);
    }

    // Page numbering is sequential
    const pages = await request(app).get(`/api/stories/${story.id}/pages`).expect(200);
    expect(pages.body.pages.map((p) => p.page_number)).toEqual([1, 2, 3]);

    // 5. Context accumulates across calls
    const thirdPrompt = axios.post.mock.calls[2][1].messages[1].content;
    expect(thirdPrompt).toContain('The Ashen Vale');
    expect(thirdPrompt).toContain('Ser Miren');
    expect(thirdPrompt).toContain('Old Ivy');
    expect(thirdPrompt).toContain('Generated page 1:');
    expect(thirdPrompt).toContain('Generated page 2:');

    // 6. Regenerate the last page, keeping its direction
    await request(app).post(`/api/stories/${story.id}/pages/regenerate`).send({}).expect(200);
    const regenPrompt = axios.post.mock.calls[3][1].messages[1].content;
    expect(regenPrompt).toContain('Miren hesitates');
    expect(regenPrompt).not.toContain('Generated page 3');

    // 7. story meta reflects page count
    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.page_count).toBe(3);

    // 8. Export (EPUB, full story)
    const binaryParser = (res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const exportRes = await request(app).get(`/api/stories/${story.id}/export`).buffer().parse(binaryParser).expect(200);
    const exportText = exportRes.body.toString('utf8');
    expect(exportText).toContain('<dc:title>The Vale Remembers</dc:title>');
    expect(exportText).toContain('page-3.xhtml');

    // 9. Delete cascades
    await request(app).delete(`/api/stories/${story.id}`).expect(204);
    expect(db.prepare('SELECT COUNT(*) AS c FROM story_pages').get().c).toBe(0);
  });

  it('characters from different worlds can share a story', async () => {
    const w1 = await createWorld(app, { name: 'Realm One' });
    const w2 = await createWorld(app, { name: 'Realm Two' });
    const c1 = await createCharacter(app, w1.id, { name: 'Native of One' });
    const c2 = await createCharacter(app, w2.id, { name: 'Visitor from Two' });

    const story = await createStory(app, w1.id, [c1.id, c2.id], { title: 'Crossover' });
    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Begin' }).expect(201);

    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('Native of One');
    expect(prompt).toContain('Visitor from Two');
  });

  it('a deleted character cleanly drops out of casts and future prompts', async () => {
    const character = await createCharacter(app, null, { name: 'Doomed Soul' });
    const story = await createStory(app, null, [character.id], { title: 'After the Fall' });

    await request(app).delete(`/api/characters/${character.id}`).expect(204);

    const meta = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(meta.body.story.characters).toEqual([]);

    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Begin' }).expect(201);
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).not.toContain('Doomed Soul');
  });

  it('blocks referential-integrity violations end to end', async () => {
    const world = await createWorld(app);
    await createCharacter(app, world.id);

    // world in use -> 409
    const conflict = await request(app).delete(`/api/worlds/${world.id}`).expect(409);
    expect(conflict.body.error).toMatch(/referenced/);

    // bogus world on story -> 400
    const bad = await request(app).post('/api/stories').send({ title: 'X', world_id: 'bogus' }).expect(400);
    expect(bad.body.error).toContain('world_id');
  });
});