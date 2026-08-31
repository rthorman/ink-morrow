'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const yazl = require('yazl');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createWorld, createCharacter, createStory, addPage } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

function isolatedApp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `st-transfer-${label}-`));
  const imageDir = path.join(root, 'images');
  const audioDir = path.join(root, 'audio');
  const transferDir = path.join(root, 'transfers');
  const db = createDb(':memory:');
  const app = createApp(db, {
    staticDir: null,
    imageDir,
    audioDir,
    transferDir,
    logger: { log() {}, error() {} },
  });
  return {
    root, imageDir, audioDir, transferDir, db, app,
    close() {
      app.locals.dispose();
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

const binaryParser = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

async function downloadPlan(app, payload) {
  const planned = await request(app).post('/api/transfers/exports/plan').send(payload).expect(200);
  const downloaded = await request(app)
    .get(planned.body.download_url)
    .buffer()
    .parse(binaryParser)
    .expect(200);
  expect(downloaded.headers['content-type']).toMatch(/application\/zip/);
  return { plan: planned.body, bytes: downloaded.body };
}

function preflight(app, bytes, settings = null) {
  let call = request(app).post('/api/transfers/imports/preflight');
  if (settings) call = call.field('current_settings', JSON.stringify(settings));
  return call.attach('archive', bytes, 'portable.scribetribe.zip');
}

function storeImage(root, bucket, id, bytes = Buffer.from('image bytes')) {
  const directory = path.join(root, bucket);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${id}.png`), bytes);
}

describe('portable archives and backups', () => {
  let source;
  let destination;

  beforeEach(() => {
    source = isolatedApp('source');
    destination = isolatedApp('destination');
  });

  afterEach(() => {
    source.close();
    destination.close();
  });

  it('round-trips a story with its world, external cast home world, snapshots, continuity and visuals', async () => {
    const storyWorld = await createWorld(source.app, { name: 'Story World', generate_image: false });
    const visitorWorld = await createWorld(source.app, { name: 'Visitor World', generate_image: false });
    const lead = await createCharacter(source.app, storyWorld.id, { name: 'Lead', generate_image: false });
    const visitor = await createCharacter(source.app, visitorWorld.id, { name: 'Visitor', generate_image: false });
    const story = await createStory(source.app, storyWorld.id, [
      { id: lead.id, role: 'mc', relation: null, state: null },
      { id: visitor.id, role: 'supporting', relation: 'new arrival', state: null },
    ], { title: 'The Portable Tale', tone: 'romantic' });
    const page = await addPage(source.app, story.id, 'The visitor crosses the threshold.', 'Make the visitor arrive');
    // Stale database metadata without a file must not create a broken image
    // reference in the portable story.
    source.db.prepare("UPDATE story_pages SET image_media_type='image/png' WHERE id=?").run(page.id);
    source.db.prepare(`
      INSERT INTO story_memory_pages
        (page_id, story_id, content_hash, status, summary, delta_json, model, cost_usd)
      VALUES (?, ?, ?, 'ready', ?, ?, 'test/model', 0.001)
    `).run(page.id, story.id, 'a'.repeat(64), 'The visitor arrived.', JSON.stringify({
      summary: 'The visitor arrived.', events: [{ text: 'Arrival', character_ids: [visitor.id] }],
      character_updates: [], goal_updates: [], thread_updates: [], world_fact_updates: [],
    }));
    storeImage(source.imageDir, 'worlds', storyWorld.id);
    storeImage(source.imageDir, 'characters', lead.id);
    storeImage(source.imageDir, 'covers', story.id);
    source.db.prepare("UPDATE worlds SET image_status='ready', image_media_type='image/png' WHERE id=?").run(storyWorld.id);
    source.db.prepare("UPDATE characters SET image_status='ready', image_media_type='image/png' WHERE id=?").run(lead.id);
    source.db.prepare("UPDATE stories SET image_status='ready', image_media_type='image/png' WHERE id=?").run(story.id);

    const { plan, bytes } = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: true,
      include_audio: false, include_working_history: false,
    });
    expect(plan.exposure).toMatchObject({ worlds: 2, characters: 2, stories: 1, pages: 1, continuity_rows: 1, images: 3, audio_files: 0 });
    expect(plan.exposure.external_worlds.map((row) => row.name)).toEqual(['Visitor World']);
    expect(plan.exposure.excluded).toContain('API keys');

    const reviewed = await preflight(destination.app, bytes).expect(200);
    expect(reviewed.body.summary).toMatchObject({ entities: 5, assets: 3, conflicts: 0 });
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM stories').get().c).toBe(0); // preflight never writes

    const committed = await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    expect(committed.body.counts.imported).toBe(5);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(2);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM characters').get().c).toBe(2);
    const importedStory = destination.db.prepare('SELECT * FROM stories WHERE id = ?').get(story.id);
    expect(JSON.parse(importedStory.characters).map((entry) => entry.id)).toEqual([lead.id, visitor.id]);
    const importedPage = destination.db.prepare('SELECT * FROM story_pages WHERE story_id = ?').get(story.id);
    expect(importedPage.content).toContain('threshold');
    expect(importedPage.user_input).toBeNull(); // portable history switch was off
    expect(importedPage.image_media_type).toBeNull();
    expect(destination.db.prepare('SELECT summary FROM story_memory_pages WHERE page_id = ?').get(page.id).summary).toBe('The visitor arrived.');
    expect(fs.existsSync(path.join(destination.imageDir, 'covers', `${story.id}.png`))).toBe(true);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM audiobooks').get().c).toBe(0);
  });

  it('makes audio and working history explicit and restores sanitized device settings from a full backup', async () => {
    const story = await createStory(source.app, null, [], { title: 'Spoken Archive' });
    const page = await addPage(source.app, story.id, 'Read this page aloud.', 'A private author direction');
    fs.writeFileSync(path.join(source.audioDir, `${story.id}.mp3`), Buffer.from('mp3 bytes'));
    source.db.prepare(`
      INSERT INTO audiobooks
        (story_id, model, voice, status, pages_done, pages_total, size_bytes, duration_s, cost_usd, fingerprint)
      VALUES (?, 'voice/model', 'Vesper', 'ready', 1, 1, 9, 4, 0.02, 'old')
    `).run(story.id);

    const settings = {
      model: 'writer/model', storyFont: 'georgia', wordsPerPage: 700,
      costTicker: false, secretApiKey: 'must-not-travel',
    };
    const { plan, bytes } = await downloadPlan(source.app, {
      scope: 'full', include_visuals: false, include_audio: true,
      include_working_history: true, settings,
    });
    expect(plan.exposure.audio_files).toBe(1);
    expect(plan.exposure.includes_author_directions).toBe(true);
    expect(plan.exposure.includes_device_settings).toBe(true);

    await createWorld(destination.app, { name: 'Local Data To Replace', generate_image: false });
    const reviewed = await preflight(destination.app, bytes, { storyFont: 'inter' }).expect(200);
    expect(reviewed.body.settings_available).toBe(true);
    const committed = await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'replace_all', restore_settings: true })
      .expect(200);
    expect(committed.body.safety_backup.download_url).toMatch(/safety-backups/);
    expect(committed.body.settings).toMatchObject({ model: 'writer/model', storyFont: 'georgia', wordsPerPage: 700, costTicker: false });
    expect(committed.body.settings.secretApiKey).toBeUndefined();
    expect(destination.db.prepare('SELECT name FROM worlds').all()).toEqual([]);
    expect(destination.db.prepare('SELECT user_input FROM story_pages WHERE id = ?').get(page.id).user_input).toBe('A private author direction');
    expect(fs.readFileSync(path.join(destination.audioDir, `${story.id}.mp3`), 'utf8')).toBe('mp3 bytes');
    await request(destination.app).get(committed.body.safety_backup.download_url).expect(200);
  });

  it('preflights identical records, then offers copy/keep/replace for a divergent same-id world', async () => {
    const world = await createWorld(source.app, { name: 'Collision World', description: 'Original', generate_image: false });
    const { bytes } = await downloadPlan(source.app, {
      scope: 'world', id: world.id, character_ids: [], include_visuals: false,
    });

    // Put the exact same world in the destination first.
    const row = source.db.prepare('SELECT * FROM worlds WHERE id = ?').get(world.id);
    const fields = Object.keys(row);
    destination.db.prepare(`INSERT INTO worlds (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .run(...fields.map((field) => row[field]));
    const identical = await preflight(destination.app, bytes).expect(200);
    expect(identical.body.collisions[0]).toMatchObject({ status: 'identical', recommended: 'keep' });
    await request(destination.app).delete(`/api/transfers/imports/${identical.body.token}`).expect(204);

    destination.db.prepare("UPDATE worlds SET description='Diverged' WHERE id=?").run(world.id);
    const conflict = await preflight(destination.app, bytes).expect(200);
    expect(conflict.body.collisions[0]).toMatchObject({ status: 'conflict', recommended: 'copy' });
    expect(conflict.body.collisions[0].choices).toEqual(['keep', 'copy', 'replace']);
    await request(destination.app)
      .post(`/api/transfers/imports/${conflict.body.token}/commit`)
      .send({ mode: 'merge', resolutions: { [`world:${world.id}`]: 'copy' } })
      .expect(200);
    const worlds = destination.db.prepare('SELECT name, description FROM worlds ORDER BY name').all();
    expect(worlds).toHaveLength(2);
    expect(worlds.some((entry) => entry.name.includes('(Imported)') && entry.description === 'Original')).toBe(true);
    expect(worlds.some((entry) => entry.description === 'Diverged')).toBe(true);
  });

  it('treats different included media as a real collision even when fields match', async () => {
    const world = await createWorld(source.app, { name: 'Painted Collision', generate_image: false });
    storeImage(source.imageDir, 'worlds', world.id, Buffer.from('source painting'));
    source.db.prepare("UPDATE worlds SET image_status='ready', image_media_type='image/png' WHERE id=?").run(world.id);
    const { bytes } = await downloadPlan(source.app, {
      scope: 'world', id: world.id, character_ids: [], include_visuals: true,
    });

    const row = source.db.prepare('SELECT * FROM worlds WHERE id = ?').get(world.id);
    const fields = Object.keys(row);
    destination.db.prepare(`INSERT INTO worlds (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .run(...fields.map((field) => row[field]));
    storeImage(destination.imageDir, 'worlds', world.id, Buffer.from('different local painting'));

    const reviewed = await preflight(destination.app, bytes).expect(200);
    expect(reviewed.body.collisions[0]).toMatchObject({ status: 'conflict', recommended: 'copy' });
  });

  it('remaps a copied story, world, cast, pages, snapshots and continuity as one dependency graph', async () => {
    const world = await createWorld(source.app, { name: 'Graph World', generate_image: false });
    const character = await createCharacter(source.app, world.id, { name: 'Graph Hero', generate_image: false });
    const story = await createStory(source.app, world.id, [
      { id: character.id, role: 'mc', relation: 'self', state: null },
    ], { title: 'Graph Tale' });
    const page = await addPage(source.app, story.id, 'The hero changes.', 'Change them');
    source.db.prepare(`
      INSERT INTO story_memory_pages
        (page_id, story_id, content_hash, status, summary, delta_json)
      VALUES (?, ?, ?, 'ready', 'Changed.', ?)
    `).run(page.id, story.id, 'b'.repeat(64), JSON.stringify({
      summary: 'Changed.', events: [],
      character_updates: [{ character_id: character.id, condition: 'changed' }],
      goal_updates: [], thread_updates: [], world_fact_updates: [],
    }));
    const { bytes } = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: false,
    });

    destination.db.prepare('INSERT INTO worlds (id, name, description) VALUES (?, ?, ?)')
      .run(world.id, 'Local World', 'Different');
    destination.db.prepare('INSERT INTO characters (id, name, world_id, description) VALUES (?, ?, ?, ?)')
      .run(character.id, 'Local Hero', world.id, 'Different');
    destination.db.prepare('INSERT INTO stories (id, title, world_id, characters) VALUES (?, ?, ?, ?)')
      .run(story.id, 'Local Tale', world.id, JSON.stringify([{ id: character.id, role: 'mc' }]));

    const reviewed = await preflight(destination.app, bytes).expect(200);
    expect(reviewed.body.collisions.every((entry) => entry.status === 'conflict')).toBe(true);
    const resolutions = Object.fromEntries(reviewed.body.collisions.map((entry) => [entry.key, 'copy']));
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge', resolutions })
      .expect(200);

    const importedWorld = destination.db.prepare("SELECT * FROM worlds WHERE name LIKE 'Graph World (Imported%' ").get();
    const importedCharacter = destination.db.prepare("SELECT * FROM characters WHERE name LIKE 'Graph Hero (Imported%' ").get();
    const importedStory = destination.db.prepare("SELECT * FROM stories WHERE title LIKE 'Graph Tale (Imported%' ").get();
    expect(importedWorld.id).not.toBe(world.id);
    expect(importedCharacter.world_id).toBe(importedWorld.id);
    expect(importedStory.world_id).toBe(importedWorld.id);
    expect(JSON.parse(importedStory.characters)[0].id).toBe(importedCharacter.id);
    const importedPage = destination.db.prepare('SELECT * FROM story_pages WHERE story_id = ?').get(importedStory.id);
    expect(importedPage.id).not.toBe(page.id);
    const snapshot = destination.db.prepare('SELECT * FROM story_character_snapshots WHERE story_id = ?').get(importedStory.id);
    expect(snapshot.character_id).toBe(importedCharacter.id);
    const memory = destination.db.prepare('SELECT * FROM story_memory_pages WHERE page_id = ?').get(importedPage.id);
    expect(JSON.parse(memory.delta_json).character_updates[0].character_id).toBe(importedCharacter.id);
  });

  it('rejects undeclared ZIP entries without changing the database', async () => {
    const manifest = {
      format: 'scribetribe-portable-archive', version: 1,
      created_at: new Date().toISOString(), scope: 'full',
      options: { include_visuals: false, include_audio: false, include_working_history: false },
      settings: null, entities: [], assets: [], exposure: {},
    };
    const zip = new yazl.ZipFile();
    const chunks = [];
    const bytes = await new Promise((resolve, reject) => {
      zip.outputStream.on('data', (chunk) => chunks.push(chunk));
      zip.outputStream.on('error', reject);
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
      zip.addBuffer(Buffer.from('undeclared'), 'assets/undeclared.txt');
      zip.end();
    });
    const response = await preflight(destination.app, bytes).expect(400);
    expect(response.body.error).toMatch(/undeclared file/);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(0);
  });
});
