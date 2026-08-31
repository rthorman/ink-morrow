'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createDb, MIGRATIONS } = require('../src/db');
const { createTestApp, createStory, addPage } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

describe('PR 03 immutable revisions and truncation recovery', () => {
  let fixture;
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-revisions-'));
    fixture = createTestApp({
      imageDir: path.join(root, 'images'),
      audioDir: path.join(root, 'audio'),
    });
  });

  afterEach(() => {
    fixture?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('upgrades schema 2 pages into immutable canonical/display revisions', () => {
    fixture.close();
    fixture = null;
    const dbPath = path.join(root, 'schema-2.db');
    let db = createDb(dbPath, { migrations: MIGRATIONS.slice(0, 2), reconcileOperations: false });
    db.prepare("INSERT INTO stories (id, title) VALUES ('story-1', 'Revision migration')").run();
    db.prepare("INSERT INTO volumes (id, story_id, ordinal, title) VALUES ('volume-1', 'story-1', 1, 'Volume I')").run();
    db.prepare("INSERT INTO chapters (id, volume_id, ordinal, title) VALUES ('chapter-1', 'volume-1', 1, 'Chapter I')").run();
    db.prepare(`
      INSERT INTO story_pages (id, story_id, page_number, content, user_input, model, prompt_tokens, completion_tokens, cost_usd)
      VALUES ('page-1', 'story-1', 1, 'Original prose.', 'Open the door', 'scribe/test', 10, 20, 0.25)
    `).run();
    db.prepare("INSERT INTO pages (id, chapter_id, ordinal) VALUES ('page-1', 'chapter-1', 1)").run();
    db.close();

    db = createDb(dbPath);
    const page = db.prepare("SELECT * FROM pages WHERE id = 'page-1'").get();
    expect(page.canonical_revision_id).toBeTruthy();
    expect(page.display_revision_id).toBe(page.canonical_revision_id);
    expect(db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(page.canonical_revision_id)).toMatchObject({
      page_id: 'page-1',
      kind: 'canonical',
      content: 'Original prose.',
      direction: 'Open the door',
      source: 'ai',
      model: 'scribe/test',
      cost_usd: 0.25,
    });
    expect(() => db.prepare("UPDATE page_revisions SET content = 'mutated' WHERE id = ?").run(page.canonical_revision_id))
      .toThrow(/immutable/i);
    db.close();
  });

  it('tail edits both pointers while historical copyedits preserve canon and continuity', async () => {
    const story = await createStory(fixture.app);
    const first = await addPage(fixture.app, story.id, 'First canonical page.', 'Begin');
    const tail = await addPage(fixture.app, story.id, 'Second canonical page.', 'Continue');
    fixture.db.prepare(`
      INSERT INTO story_memory_pages
        (page_id, story_id, content_hash, status, summary, delta_json)
      VALUES (?, ?, 'hash', 'ready', 'Established event', '{}')
    `).run(first.id, story.id);
    fixture.db.prepare(`
      INSERT INTO story_previews (story_id, expected_page, raw_content) VALUES (?, 3, 'Speculative prose')
    `).run(story.id);

    const firstBefore = fixture.db.prepare('SELECT * FROM pages WHERE id = ?').get(first.id);
    const copyedit = await request(fixture.app)
      .post(`/api/stories/${story.id}/pages/${first.id}/copyedits`)
      .set('Idempotency-Key', 'copyedit-first')
      .send({ content: 'First page, carefully copyedited.' })
      .expect(201);
    expect(copyedit.body).toMatchObject({
      canonical_revision_id: firstBefore.canonical_revision_id,
      continuity_recalculated: false,
    });
    expect(copyedit.body.display_revision_id).not.toBe(firstBefore.display_revision_id);
    expect(fixture.db.prepare('SELECT summary FROM story_memory_pages WHERE page_id = ?').get(first.id).summary)
      .toBe('Established event');
    expect(fixture.db.prepare('SELECT content FROM page_revisions WHERE id = ?').get(firstBefore.canonical_revision_id).content)
      .toBe('First canonical page.');

    await request(fixture.app)
      .put(`/api/stories/${story.id}/pages/${first.id}/revisions`)
      .send({ content: 'Illegal historical rewrite.' })
      .expect(409);

    const tailBefore = fixture.db.prepare('SELECT * FROM pages WHERE id = ?').get(tail.id);
    const edited = await request(fixture.app)
      .put(`/api/stories/${story.id}/pages/${tail.id}/revisions`)
      .set('Idempotency-Key', 'tail-edit')
      .send({ content: 'Second page with substantive changes.', direction: 'Change the consequence' })
      .expect(200);
    expect(edited.body.canonical_revision_id).toBe(edited.body.display_revision_id);
    expect(edited.body.canonical_revision_id).not.toBe(tailBefore.canonical_revision_id);
    expect(edited.body.revision).toMatchObject({
      parent_revision_id: tailBefore.canonical_revision_id,
      kind: 'canonical',
      source: 'author',
    });
    expect(fixture.db.prepare('SELECT * FROM story_previews WHERE story_id = ?').get(story.id)).toBeUndefined();

    const replayed = await request(fixture.app)
      .put(`/api/stories/${story.id}/pages/${tail.id}/revisions`)
      .set('Idempotency-Key', 'tail-edit')
      .send({ content: 'A duplicate must not commit.' })
      .expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM page_revisions WHERE page_id = ?').get(tail.id).c).toBe(2);

    const otherRevision = fixture.db.prepare('SELECT canonical_revision_id AS id FROM pages WHERE id = ?').get(first.id).id;
    expect(() => fixture.db.prepare('UPDATE pages SET canonical_revision_id = ?, display_revision_id = ? WHERE id = ?')
      .run(otherRevision, otherRevision, tail.id)).toThrow(/another page/i);
  });

  it('packages truncation and atomically restores revisions and private continuity through undo', async () => {
    const story = await createStory(fixture.app);
    const pages = [];
    for (let index = 1; index <= 4; index += 1) pages.push(await addPage(fixture.app, story.id, `Page ${index}.`));
    fixture.db.prepare(`
      INSERT INTO story_memory_pages
        (page_id, story_id, content_hash, status, summary, delta_json)
      VALUES (?, ?, 'hash', 'ready', 'Third page event', '{}')
    `).run(pages[2].id, story.id);

    const truncated = await request(fixture.app)
      .delete(`/api/stories/${story.id}/pages?after=2`)
      .set('Idempotency-Key', 'truncate-at-two')
      .expect(200);
    expect(truncated.body).toMatchObject({
      deleted: 2,
      remaining: 2,
      removed_range: { first: 3, last: 4 },
    });
    expect(truncated.body.undo.token).toBeTruthy();
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM story_pages WHERE story_id = ?').get(story.id).c).toBe(2);
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM page_revisions WHERE page_id IN (?, ?)')
      .get(pages[2].id, pages[3].id).c).toBe(0);

    const restored = await request(fixture.app)
      .post(`/api/stories/${story.id}/recoveries/${truncated.body.recovery.id}/undo`)
      .send({ undo_token: truncated.body.undo.token })
      .expect(200);
    expect(restored.body).toMatchObject({ restored: 2, restored_range: { first: 3, last: 4 } });
    expect(fixture.db.prepare('SELECT id FROM story_pages WHERE story_id = ? ORDER BY page_number').all(story.id)
      .map((row) => row.id)).toEqual(pages.map((page) => page.id));
    expect(fixture.db.prepare('SELECT summary FROM story_memory_pages WHERE page_id = ?').get(pages[2].id).summary)
      .toBe('Third page event');
    expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(fixture.db.prepare('SELECT status FROM recovery_suffixes WHERE id = ?').get(truncated.body.recovery.id).status)
      .toBe('restored');
  });

  it('refuses an unsafe restore, exports the suffix, and expires it without touching active canon', async () => {
    fixture.close();
    let current = new Date('2030-01-01T00:00:00.000Z');
    fixture = createTestApp({
      imageDir: path.join(root, 'images-clock'),
      audioDir: path.join(root, 'audio-clock'),
      recoveryRetentionDays: 1,
      clock: () => new Date(current),
    });
    const story = await createStory(fixture.app);
    await addPage(fixture.app, story.id, 'Anchor.');
    await addPage(fixture.app, story.id, 'Recoverable suffix.');
    const truncated = await request(fixture.app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    await addPage(fixture.app, story.id, 'A new incompatible future.');

    const unsafe = await request(fixture.app)
      .post(`/api/stories/${story.id}/recoveries/${truncated.body.recovery.id}/restore`)
      .send({})
      .expect(409);
    expect(unsafe.body.error).toMatch(/manual reconciliation/i);
    const exported = await request(fixture.app)
      .get(`/api/stories/${story.id}/recoveries/${truncated.body.recovery.id}/export`)
      .expect(200);
    expect(exported.body).toMatchObject({ format: 'scribetribe-recovery-suffix', version: 1 });
    expect(exported.body.payload.pages[0].content).toBe('Recoverable suffix.');
    expect(exported.body.payload.undo_sha256).toBeUndefined();

    const activeBefore = fixture.db.prepare('SELECT id, content FROM story_pages WHERE story_id = ? ORDER BY page_number')
      .all(story.id);
    current = new Date('2030-01-03T00:00:00.000Z');
    const listed = await request(fixture.app).get(`/api/stories/${story.id}/recoveries`).expect(200);
    expect(listed.body.recoveries[0].status).toBe('expired');
    const expiredPayload = JSON.parse(fixture.db.prepare('SELECT payload_json FROM recovery_suffixes WHERE id = ?')
      .get(truncated.body.recovery.id).payload_json);
    expect(expiredPayload).toMatchObject({ expired: true, page_count: 1 });
    expect(expiredPayload.pages).toBeUndefined();
    expect(fixture.db.prepare('SELECT id, content FROM story_pages WHERE story_id = ? ORDER BY page_number')
      .all(story.id)).toEqual(activeBefore);
  });

  it('preserves invariants across deterministic edit, copyedit, truncate, restore, and append sequences', async () => {
    const story = await createStory(fixture.app);
    for (let index = 1; index <= 5; index += 1) await addPage(fixture.app, story.id, `Seed ${index}.`);
    let state = 0x5eed1234;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };

    for (let step = 0; step < 24; step += 1) {
      const live = fixture.db.prepare('SELECT * FROM story_pages WHERE story_id = ? ORDER BY page_number').all(story.id);
      const choice = Math.floor(random() * 4);
      if (choice === 0 || live.length < 2) {
        await addPage(fixture.app, story.id, `Appended ${step}.`);
      } else if (choice === 1) {
        const historical = live[Math.floor(random() * (live.length - 1))];
        await request(fixture.app)
          .post(`/api/stories/${story.id}/pages/${historical.id}/copyedits`)
          .send({ content: `Copyedited ${step}.` })
          .expect(201);
      } else if (choice === 2) {
        const tail = live.at(-1);
        await request(fixture.app)
          .put(`/api/stories/${story.id}/pages/${tail.id}/revisions`)
          .send({ content: `Canonical tail edit ${step}.` })
          .expect(200);
      } else {
        const after = 1 + Math.floor(random() * (live.length - 1));
        const cut = await request(fixture.app).delete(`/api/stories/${story.id}/pages?after=${after}`).expect(200);
        await request(fixture.app)
          .post(`/api/stories/${story.id}/recoveries/${cut.body.recovery.id}/undo`)
          .send({ undo_token: cut.body.undo.token })
          .expect(200);
      }

      const rows = fixture.db.prepare(`
        SELECT sp.page_number, p.id, p.canonical_revision_id, p.display_revision_id,
               canonical.page_id AS canonical_owner, display.page_id AS display_owner
          FROM story_pages sp
          JOIN pages p ON p.id = sp.id
          JOIN page_revisions canonical ON canonical.id = p.canonical_revision_id
          JOIN page_revisions display ON display.id = p.display_revision_id
         WHERE sp.story_id = ? ORDER BY sp.page_number
      `).all(story.id);
      expect(rows.map((row) => row.page_number)).toEqual(rows.map((_, index) => index + 1));
      expect(rows.every((row) => row.id === row.canonical_owner && row.id === row.display_owner)).toBe(true);
      expect(fixture.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    }
  });
});
