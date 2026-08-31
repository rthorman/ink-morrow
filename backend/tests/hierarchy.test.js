'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createTestApp, createStory, addPage } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

describe('PR 02 manuscript hierarchy', () => {
  let fixture;
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-hierarchy-'));
    fixture = createTestApp({
      imageDir: path.join(root, 'images'),
      audioDir: path.join(root, 'audio'),
    });
  });

  afterEach(() => {
    fixture.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates Volume I and Chapter I atomically with every story', async () => {
    const story = await createStory(fixture.app, null, [], { title: 'Structured Tale' });
    expect(story.hierarchy).toMatchObject({
      summary: {
        volume_count: 1,
        chapter_count: 1,
        page_count: 0,
      },
      volumes: [{ ordinal: 1, title: 'Volume I', chapters: [{ ordinal: 1, title: 'Chapter I', pages: [] }] }],
    });
    expect(story.hierarchy.summary.active_tail).toMatchObject({
      volume_id: story.hierarchy.volumes[0].id,
      chapter_id: story.hierarchy.volumes[0].chapters[0].id,
      page_id: null,
    });
    expect(fixture.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scenes'").get())
      .toBeUndefined();
    expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps stable page identities across volumes, chapters, renames, and indexed neighbor reads', async () => {
    const story = await createStory(fixture.app);
    const volumeOne = story.hierarchy.volumes[0];
    const chapterOne = volumeOne.chapters[0];
    const pageOne = await addPage(fixture.app, story.id, 'First page.');
    const pageTwo = await addPage(fixture.app, story.id, 'Second page.');

    const chapterTwoResponse = await request(fixture.app)
      .post(`/api/stories/${story.id}/volumes/${volumeOne.id}/chapters`)
      .send({ title: 'A Deeper Passage' })
      .expect(201);
    const chapterTwo = chapterTwoResponse.body.chapter;
    const pageThree = await addPage(fixture.app, story.id, 'Third page.');

    const volumeTwoResponse = await request(fixture.app)
      .post(`/api/stories/${story.id}/volumes`)
      .send({ title: 'The Second Book', chapter_title: 'Arrival' })
      .expect(201);
    const volumeTwo = volumeTwoResponse.body.volume;
    const pageFour = await addPage(fixture.app, story.id, 'Fourth page.');

    let hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}/hierarchy`).expect(200)).body.hierarchy;
    expect(hierarchy.summary).toMatchObject({ volume_count: 2, chapter_count: 3, page_count: 4 });
    expect(hierarchy.volumes.map((volume) => volume.ordinal)).toEqual([1, 2]);
    expect(hierarchy.volumes[0].chapters.map((chapter) => chapter.ordinal)).toEqual([1, 2]);
    expect(hierarchy.volumes[0].chapters[0].pages.map((page) => page.id)).toEqual([pageOne.id, pageTwo.id]);
    expect(hierarchy.volumes[0].chapters[1].pages.map((page) => page.id)).toEqual([pageThree.id]);
    expect(hierarchy.volumes[1].chapters[0].pages.map((page) => page.id)).toEqual([pageFour.id]);
    expect(hierarchy.volumes.flatMap((volume) => volume.chapters)
      .flatMap((chapter) => chapter.pages).map((page) => page.display_number)).toEqual([1, 2, 3, 4]);

    const stable = (await request(fixture.app).get(`/api/stories/${story.id}/pages/${pageTwo.id}`).expect(200)).body.page;
    expect(stable).toMatchObject({
      id: pageTwo.id,
      content: 'Second page.',
      position: {
        volume: { id: volumeOne.id, ordinal: 1, title: 'Volume I' },
        chapter: { id: chapterOne.id, ordinal: 1, title: 'Chapter I' },
        ordinal: 2,
        display_number: 2,
      },
      neighbors: { previous_page_id: pageOne.id, next_page_id: pageThree.id },
      is_active_tail: false,
    });
    expect((await request(fixture.app).get(`/api/stories/${story.id}/pages/${pageFour.id}`).expect(200)).body.page)
      .toMatchObject({ is_active_tail: true, neighbors: { previous_page_id: pageThree.id, next_page_id: null } });

    await request(fixture.app).put(`/api/stories/${story.id}/volumes/${volumeOne.id}`)
      .send({ title: 'Renamed First Book' }).expect(200);
    await request(fixture.app).put(`/api/stories/${story.id}/chapters/${chapterOne.id}`)
      .send({ title: 'Renamed First Chapter' }).expect(200);
    hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}`).expect(200)).body.story.hierarchy;
    expect(hierarchy.volumes[0]).toMatchObject({ id: volumeOne.id, title: 'Renamed First Book' });
    expect(hierarchy.volumes[0].chapters[0]).toMatchObject({ id: chapterOne.id, title: 'Renamed First Chapter' });
    expect(hierarchy.volumes[0].chapters[0].pages.map((page) => page.id)).toEqual([pageOne.id, pageTwo.id]);
    expect(volumeTwo.id).toBe(hierarchy.volumes[1].id);
    expect(chapterTwo.id).toBe(hierarchy.volumes[0].chapters[1].id);
  });

  it('mirrors insertion, deletion, and truncation without changing surviving page ids', async () => {
    const story = await createStory(fixture.app);
    const first = await addPage(fixture.app, story.id, 'First.');
    const second = await addPage(fixture.app, story.id, 'Second.');
    const third = await addPage(fixture.app, story.id, 'Third.');

    const image = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/1/image-page`)
      .send({ media_type: 'image/png', image: Buffer.from('paint').toString('base64'), prompt: 'A plate' })
      .expect(201);
    let hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}/hierarchy`).expect(200)).body.hierarchy;
    expect(hierarchy.volumes[0].chapters[0].pages.map((page) => [page.id, page.ordinal, page.kind]))
      .toEqual([
        [first.id, 1, 'text'], [image.body.page.id, 2, 'image'],
        [second.id, 3, 'text'], [third.id, 4, 'text'],
      ]);

    await request(fixture.app).delete(`/api/stories/${story.id}/pages/3`).expect(204);
    hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}/hierarchy`).expect(200)).body.hierarchy;
    expect(hierarchy.volumes[0].chapters[0].pages.map((page) => [page.id, page.ordinal]))
      .toEqual([[first.id, 1], [image.body.page.id, 2], [third.id, 3]]);

    await request(fixture.app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}/hierarchy`).expect(200)).body.hierarchy;
    expect(hierarchy.summary.page_count).toBe(1);
    expect(hierarchy.volumes[0].chapters[0].pages[0].id).toBe(first.id);
    expect(fixture.db.prepare('SELECT COUNT(*) AS value FROM pages').get().value).toBe(1);
  });

  it('allows only empty active-tail structure to be removed', async () => {
    const story = await createStory(fixture.app);
    const volumeOne = story.hierarchy.volumes[0];
    const chapterOne = volumeOne.chapters[0];

    await request(fixture.app).delete(`/api/stories/${story.id}/volumes/${volumeOne.id}`).expect(409);
    await request(fixture.app).delete(`/api/stories/${story.id}/chapters/${chapterOne.id}`).expect(409);

    const chapterTwo = (await request(fixture.app)
      .post(`/api/stories/${story.id}/volumes/${volumeOne.id}/chapters`).send({}).expect(201)).body.chapter;
    await request(fixture.app).delete(`/api/stories/${story.id}/chapters/${chapterOne.id}`).expect(409);
    await request(fixture.app).delete(`/api/stories/${story.id}/chapters/${chapterTwo.id}`).expect(204);

    const volumeTwo = (await request(fixture.app).post(`/api/stories/${story.id}/volumes`).send({}).expect(201)).body.volume;
    await request(fixture.app)
      .post(`/api/stories/${story.id}/volumes/${volumeOne.id}/chapters`).send({}).expect(409);
    await addPage(fixture.app, story.id, 'The active tail is no longer empty.');
    await request(fixture.app).delete(`/api/stories/${story.id}/volumes/${volumeTwo.id}`).expect(409);
  });

  it('serializes competing tail inserts and keeps every scoped ordinal unique', async () => {
    const story = await createStory(fixture.app);
    const volume = story.hierarchy.volumes[0];
    const responses = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      request(fixture.app)
        .post(`/api/stories/${story.id}/volumes/${volume.id}/chapters`)
        .send({ title: `Chapter ${index + 2}` })
    ));
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const ordinals = fixture.db.prepare('SELECT ordinal FROM chapters WHERE volume_id = ? ORDER BY ordinal').all(volume.id)
      .map((row) => row.ordinal);
    expect(ordinals).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it('reads a deterministic 3,000-page hierarchy through indexed scoped order', async () => {
    const story = await createStory(fixture.app);
    fixture.db.exec('BEGIN IMMEDIATE');
    try {
      fixture.db.prepare('DELETE FROM volumes WHERE story_id = ?').run(story.id);
      const insertVolume = fixture.db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, ?, ?)');
      const insertChapter = fixture.db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, ?, ?)');
      const insertPage = fixture.db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)');
      for (let volumeOrdinal = 1; volumeOrdinal <= 10; volumeOrdinal += 1) {
        const volumeId = `large-volume-${volumeOrdinal}`;
        insertVolume.run(volumeId, story.id, volumeOrdinal, `Volume ${volumeOrdinal}`);
        for (let chapterOrdinal = 1; chapterOrdinal <= 10; chapterOrdinal += 1) {
          const chapterId = `${volumeId}-chapter-${chapterOrdinal}`;
          insertChapter.run(chapterId, volumeId, chapterOrdinal, `Chapter ${chapterOrdinal}`);
          for (let pageOrdinal = 1; pageOrdinal <= 30; pageOrdinal += 1) {
            insertPage.run(`${chapterId}-page-${pageOrdinal}`, chapterId, pageOrdinal);
          }
        }
      }
      fixture.db.exec('COMMIT');
    } catch (error) {
      fixture.db.exec('ROLLBACK');
      throw error;
    }

    const hierarchy = (await request(fixture.app).get(`/api/stories/${story.id}/hierarchy`).expect(200)).body.hierarchy;
    expect(hierarchy.summary).toMatchObject({ volume_count: 10, chapter_count: 100, page_count: 3000 });
    expect(hierarchy.volumes[9].chapters[9].pages[29]).toMatchObject({ ordinal: 30, display_number: 3000 });

    const plans = [
      fixture.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM volumes WHERE story_id = ? ORDER BY ordinal DESC LIMIT 1').all(story.id),
      fixture.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM chapters WHERE volume_id = ? ORDER BY ordinal DESC LIMIT 1').all('large-volume-10'),
      fixture.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM pages WHERE chapter_id = ? ORDER BY ordinal DESC LIMIT 1').all('large-volume-10-chapter-10'),
      fixture.db.prepare('EXPLAIN QUERY PLAN SELECT id FROM story_pages WHERE story_id = ? AND page_number = ?').all(story.id, 1),
    ].flat().map((row) => row.detail).join('\n');
    expect(plans).toContain('idx_volumes_story_order');
    expect(plans).toContain('idx_chapters_volume_order');
    expect(plans).toContain('idx_pages_chapter_order');
    expect(plans).toMatch(/SEARCH story_pages USING INDEX .*\(story_id=\? AND page_number=\?\)/);
  });
});
