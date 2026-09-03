'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const yazl = require('yazl');
const yauzl = require('yauzl');
const sharp = require('sharp');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');
const {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  jsonBuffer,
  sha256,
  semanticHash,
} = require('../src/modules/transfer/format');
const { createWorld, createCharacter, createStory, addPage } = require('./helpers');
const { hashDocument } = require('../src/modules/publication/document');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

function isolatedApp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `im-transfer-${label}-`));
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

async function rewriteStoryBundle(bytes, mutate) {
  const entries = await readZipEntries(bytes);
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
  const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
  mutate(bundle);
  const bundleBuffer = jsonBuffer(bundle);
  storyMeta.size_bytes = bundleBuffer.length;
  storyMeta.sha256 = sha256(bundleBuffer);
  storyMeta.semantic_sha256 = semanticHash('story', bundle);
  return zipFixture(manifest, [...entries]
    .filter(([entryPath]) => entryPath !== 'manifest.json')
    .map(([entryPath, content]) => ({
      path: entryPath,
      content: entryPath === storyMeta.path ? bundleBuffer : content,
    })));
}

function preflight(app, bytes, settings = null) {
  let call = request(app).post('/api/transfers/imports/preflight');
  if (settings) call = call.field('current_settings', JSON.stringify(settings));
  return call.attach('archive', bytes, 'portable.inkmorrow');
}

function manifestFixture(overrides = {}) {
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    manifest_schema_version: ARCHIVE_MANIFEST_SCHEMA_VERSION,
    database_schema: { family: DATABASE_FAMILY, version: DATABASE_SCHEMA_VERSION },
    created_at: new Date().toISOString(),
    created_by: { application: 'Ink Morrow', version: 'test' },
    scope: 'full',
    options: { include_visuals: false, include_audio: false, include_working_history: false },
    settings: null,
    entities: [],
    assets: [],
    exposure: {},
    ...overrides,
  };
}

function zipFixture(manifest, extraEntries = []) {
  const zip = new yazl.ZipFile();
  const chunks = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    for (const entry of extraEntries) zip.addBuffer(Buffer.from(entry.content), entry.path);
    zip.end();
  });
}

function readZipEntries(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
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

  it('round-trips normalized art and stable placements without carrying provider consent', async () => {
    const story = await createStory(source.app, null, [], { title: 'Portable Art' });
    const page = await addPage(source.app, story.id, 'The anchor remains prose.');
    const bytes = await sharp({
      create: { width: 9, height: 7, channels: 4, background: '#553355' },
    }).png().toBuffer();
    const uploaded = await request(source.app)
      .post(`/api/stories/${story.id}/assets/upload`)
      .field('after_page_id', page.id)
      .field('title', 'Portable illustration')
      .field('alt_text', 'An owner-authored portable image.')
      .field('provider_reference_allowed', 'true')
      .attach('image', bytes, { filename: 'private-subject.png', contentType: 'image/png' })
      .expect(201);
    const publication = source.app.locals.publications.snapshot(story.id, {
      art: { asset_ids: [uploaded.body.asset.id] },
    });

    const exported = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: true,
      include_audio: false, include_working_history: true,
    });
    expect(exported.plan.exposure).toMatchObject({
      publication_snapshots: 1,
      publication_snapshot_images: 1,
    });
    const entries = await readZipEntries(exported.bytes);
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
    const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
    expect(bundle.art_assets).toHaveLength(1);
    expect(bundle.art_assets[0]).toMatchObject({
      id: uploaded.body.asset.id,
      source: 'uploaded',
      media_type: 'image/webp',
      provider_reference_allowed: false,
    });
    expect(bundle.art_assets[0]).not.toHaveProperty('storage_key');
    expect(bundle.asset_placements).toEqual([
      expect.objectContaining({ asset_id: uploaded.body.asset.id, after_page_id: page.id, ordinal: 1 }),
    ]);
    expect(bundle.publication_snapshots).toHaveLength(1);
    expect(JSON.parse(bundle.publication_snapshots[0].document_json).assets[0].sha256)
      .toBe(publication.document.assets[0].sha256);
    expect(manifest.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'image', owner_kind: 'asset', owner_id: uploaded.body.asset.id, story_id: story.id }),
    ]));

    const reviewed = await preflight(destination.app, exported.bytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const imported = await request(destination.app).get(`/api/stories/${story.id}/assets`).expect(200);
    expect(imported.body.assets).toHaveLength(1);
    expect(imported.body.assets[0]).toMatchObject({
      id: uploaded.body.asset.id,
      title: 'Portable illustration',
      provider_reference_allowed: false,
    });
    expect(imported.body.placements).toEqual([
      expect.objectContaining({ asset_id: uploaded.body.asset.id, after_page_id: page.id, ordinal: 1 }),
    ]);
    await request(destination.app).get(imported.body.assets[0].content_url).expect(200)
      .expect('Content-Type', /image\/webp/);
    const importedPublication = destination.db.prepare(
      'SELECT id FROM publication_snapshots WHERE story_id = ?'
    ).get(story.id);
    expect(destination.app.locals.publications.get(importedPublication.id).document.assets[0].content_base64)
      .toBe(publication.document.assets[0].content_base64);
    expect(destination.db.prepare('SELECT COUNT(*) AS value FROM manuscript_pages WHERE story_id = ?').get(story.id).value)
      .toBe(1);
  });

  it('round-trips a story with its world, external cast home world, snapshots, continuity and visuals', async () => {
    const storyWorld = await createWorld(source.app, { name: 'Story World', generate_image: false });
    const visitorWorld = await createWorld(source.app, { name: 'Visitor World', generate_image: false });
    const lead = await createCharacter(source.app, storyWorld.id, { name: 'Lead', generate_image: false });
    const visitor = await createCharacter(source.app, visitorWorld.id, { name: 'Visitor', generate_image: false });
    const scribe = (await request(source.app).post('/api/scribes').send({
      name: 'Portable Scribe', scene_tempo: 'brisk', focus_areas: ['consequences'], generate_image: false,
    }).expect(201)).body.scribe;
    const story = await createStory(source.app, storyWorld.id, [
      { id: lead.id, role: 'mc', relation: null, state: null },
      { id: visitor.id, role: 'supporting', relation: 'new arrival', state: null },
    ], { title: 'The Portable Tale', tone: 'romantic', scribe_id: scribe.id });
    const page = await addPage(source.app, story.id, 'The visitor crosses the threshold.', 'Make the visitor arrive');
    const volumeOne = story.hierarchy.volumes[0];
    const secondChapter = (await request(source.app)
      .post(`/api/stories/${story.id}/volumes/${volumeOne.id}/chapters`)
      .send({ title: 'Consequences' }).expect(201)).body.chapter;
    const secondPage = await addPage(source.app, story.id, 'The threshold closes.');
    const openingScene = (await request(source.app)
      .post(`/api/stories/${story.id}/chapters/${volumeOne.chapters[0].id}/scenes`)
      .send({
        title: 'The crossing', mode: 'hybrid', status: 'complete',
        viewpoint_character_id: lead.id, location: 'The threshold',
        purpose: 'Bring the visitor inside.', page_ids: [page.id],
      }).expect(201)).body.scene;
    const plannedScene = (await request(source.app)
      .post(`/api/stories/${story.id}/chapters/${secondChapter.id}/scenes`)
      .send({ title: 'Consequences gather', mode: 'author', status: 'planned' })
      .expect(201)).body.scene;
    const secondVolume = (await request(source.app).post(`/api/stories/${story.id}/volumes`)
      .send({ title: 'Beyond', chapter_title: 'The Road' }).expect(201)).body.volume;
    const thirdPage = await addPage(source.app, story.id, 'The road begins.');
    await request(source.app)
      .post(`/api/stories/${story.id}/pages/${page.id}/copyedits`)
      .send({ content: 'The visitor carefully crosses the threshold.' })
      .expect(201);
    // Canonical manuscript pages have no embedded image metadata; art travels
    // only through the normalized asset store.
    const canonicalRevision = source.db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(page.id).canonical_revision_id;
    source.db.prepare(`
      INSERT INTO continuity_deltas
        (revision_id, story_id, status, schema_version, delta_json, content_hash, summary)
      VALUES (?, ?, 'ready', 1, ?, ?, ?)
    `).run(canonicalRevision, story.id, JSON.stringify({
      summary: 'The visitor arrived.', events: [{ text: 'Arrival', character_ids: [visitor.id] }],
      character_updates: [], goal_updates: [], thread_updates: [], world_fact_updates: [],
    }), 'a'.repeat(64), 'The visitor arrived.');
    source.db.prepare(`
      INSERT INTO continuity_corrections (id, story_id, scope, subject_id, correction_json)
      VALUES (?, ?, 'character', ?, ?)
    `).run(randomUUID(), story.id, visitor.id, JSON.stringify({
      schema_version: 1,
      field: 'condition',
      value: 'weary',
      reason: 'Author correction',
      evidence: [{ page_revision_id: canonicalRevision, quote: 'crosses the threshold' }],
      source: 'author',
    }));
    const authorEntryId = randomUUID();
    source.db.prepare(`
      INSERT INTO author_canon_entries (id, story_id, kind, subject_id)
      VALUES (?, ?, 'character_fact', ?)
    `).run(authorEntryId, story.id, visitor.id);
    source.db.prepare(`
      INSERT INTO author_canon_revisions
        (id, entry_id, revision_number, title, value_json, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), authorEntryId, 1, 'Visitor oath', JSON.stringify('The visitor serves the tide.'), 'First wording');
    source.db.prepare(`
      INSERT INTO author_canon_revisions
        (id, entry_id, revision_number, title, value_json, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), authorEntryId, 2, 'Visitor oath', JSON.stringify('The visitor opposes the tide.'), 'Revised by author');
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
    expect(plan.exposure).toMatchObject({ worlds: 2, characters: 2, stories: 1, pages: 3, continuity_rows: 1, author_canon_entries: 1, images: 3, audio_files: 0 });
    expect(plan.exposure.external_worlds.map((row) => row.name)).toEqual(['Visitor World']);
    expect(plan.exposure.excluded).toContain('API keys');

    const reviewed = await preflight(destination.app, bytes).expect(200);
    expect(reviewed.body.summary).toMatchObject({ entities: 6, assets: 3, conflicts: 0 });
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM stories').get().c).toBe(0); // preflight never writes

    const committed = await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    expect(committed.body.counts.imported).toBe(6);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(2);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM characters').get().c).toBe(2);
    expect(destination.db.prepare('SELECT name, entity_kind FROM scribes WHERE id = ?').get(scribe.id))
      .toEqual({ name: 'Portable Scribe', entity_kind: 'catgirl' });
    const importedBinding = destination.db.prepare(`
      SELECT source_scribe_id, snapshot_json FROM story_scribe_bindings WHERE story_id = ?
    `).get(story.id);
    expect(importedBinding.source_scribe_id).toBe(scribe.id);
    expect(JSON.parse(importedBinding.snapshot_json).scene_tempo).toBe('brisk');
    const importedStory = destination.db.prepare('SELECT * FROM stories WHERE id = ?').get(story.id);
    expect(JSON.parse(importedStory.characters).map((entry) => entry.id)).toEqual([lead.id, visitor.id]);
    const importedPage = destination.db.prepare('SELECT * FROM manuscript_pages WHERE id = ?').get(page.id);
    expect(importedPage.content).toBe('The visitor carefully crosses the threshold.');
    expect(importedPage.user_input).toBeNull(); // portable history switch was off
    expect(importedPage.image_media_type).toBeNull();
    expect(destination.db.prepare(`
      SELECT delta.summary FROM continuity_deltas delta
      JOIN pages page ON page.canonical_revision_id = delta.revision_id
      WHERE page.id = ?
    `).get(page.id).summary).toBe('The visitor arrived.');
    const importedRevisionPointers = destination.db.prepare('SELECT * FROM pages WHERE id = ?').get(page.id);
    expect(importedRevisionPointers.display_revision_id).not.toBe(importedRevisionPointers.canonical_revision_id);
    expect(destination.db.prepare('SELECT content FROM page_revisions WHERE id = ?')
      .get(importedRevisionPointers.canonical_revision_id).content).toBe('The visitor crosses the threshold.');
    expect(destination.db.prepare('SELECT content FROM page_revisions WHERE id = ?')
      .get(importedRevisionPointers.display_revision_id).content).toBe('The visitor carefully crosses the threshold.');
    expect(destination.db.prepare('SELECT status FROM continuity_deltas WHERE revision_id = ?')
      .get(importedRevisionPointers.canonical_revision_id).status).toBe('ready');
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM template_snapshots WHERE story_id = ?')
      .get(story.id).count).toBe(3);
    const importedCorrection = destination.db.prepare('SELECT * FROM continuity_corrections WHERE story_id = ?').get(story.id);
    expect(importedCorrection.subject_id).toBe(visitor.id);
    expect(JSON.parse(importedCorrection.correction_json).evidence[0].page_revision_id)
      .toBe(importedRevisionPointers.canonical_revision_id);
    const importedAuthor = destination.db.prepare('SELECT * FROM author_canon_entries WHERE story_id = ?').get(story.id);
    expect(importedAuthor).toMatchObject({ kind: 'character_fact', subject_id: visitor.id, status: 'active' });
    expect(destination.db.prepare('SELECT revision_number, title, value_json FROM author_canon_revisions WHERE entry_id = ? ORDER BY revision_number')
      .all(importedAuthor.id)).toEqual([
      { revision_number: 1, title: 'Visitor oath', value_json: JSON.stringify('The visitor serves the tide.') },
      { revision_number: 2, title: 'Visitor oath', value_json: JSON.stringify('The visitor opposes the tide.') },
    ]);
    const importedVolumes = destination.db.prepare('SELECT id, ordinal, title FROM volumes WHERE story_id = ? ORDER BY ordinal').all(story.id);
    expect(importedVolumes).toEqual([
      { id: volumeOne.id, ordinal: 1, title: 'Volume I' },
      { id: secondVolume.id, ordinal: 2, title: 'Beyond' },
    ]);
    expect(destination.db.prepare(`
      SELECT c.id, c.title FROM chapters c JOIN volumes v ON v.id = c.volume_id
      WHERE v.story_id = ? ORDER BY v.ordinal, c.ordinal
    `).all(story.id).map((row) => row.title)).toEqual(['Chapter I', 'Consequences', 'The Road']);
    const importedPlacements = destination.db.prepare(`
      SELECT p.id FROM pages p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN volumes v ON v.id = c.volume_id
      WHERE v.story_id = ? ORDER BY v.ordinal, c.ordinal, p.ordinal
    `).all(story.id).map((row) => row.id);
    expect(importedPlacements).toEqual([page.id, secondPage.id, thirdPage.id]);
    expect(destination.db.prepare(`
      SELECT id, chapter_id, ordinal, title, mode, status, viewpoint_character_id, location, purpose
        FROM scenes
       WHERE id IN (?, ?)
       ORDER BY title
    `).all(openingScene.id, plannedScene.id)).toEqual([
      {
        id: plannedScene.id, chapter_id: secondChapter.id, ordinal: 1,
        title: 'Consequences gather', mode: 'author', status: 'planned',
        viewpoint_character_id: null, location: null, purpose: null,
      },
      {
        id: openingScene.id, chapter_id: volumeOne.chapters[0].id, ordinal: 1,
        title: 'The crossing', mode: 'hybrid', status: 'complete',
        viewpoint_character_id: lead.id, location: 'The threshold', purpose: 'Bring the visitor inside.',
      },
    ]);
    expect(destination.db.prepare('SELECT scene_id, page_id FROM scene_pages').all())
      .toEqual([{ scene_id: openingScene.id, page_id: page.id }]);
    expect(secondChapter.volume_id).toBe(volumeOne.id);
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
    expect(destination.db.prepare('SELECT user_input FROM manuscript_pages WHERE id = ?').get(page.id).user_input).toBe('A private author direction');
    expect(fs.readFileSync(path.join(destination.audioDir, `${story.id}.mp3`), 'utf8')).toBe('mp3 bytes');
    await request(destination.app).get(committed.body.safety_backup.download_url).expect(200);
  });

  it('round-trips immutable publication snapshots while excluding credentials, recovery, and shares', async () => {
    const story = await createStory(source.app, null, [], { title: 'Release Archive' });
    const page = await addPage(source.app, story.id, 'The publication-safe paragraph.', 'PRIVATE-DIRECTION-CANARY');
    const snapshot = source.app.locals.publications.snapshot(story.id, {
      metadata: { author: 'Archive Author' },
    });
    const share = source.app.locals.publicationShares.create(snapshot.id, { expires_in_seconds: 604800 });
    const capability = new URL(`http://localhost${share.share_url}`).hash.slice(1);
    const storedShare = source.db.prepare('SELECT capability_hash FROM shares WHERE id = ?').get(share.id);
    const now = new Date();
    source.db.prepare(`
      INSERT INTO recovery_suffixes
        (id, story_id, anchor_page_id, status, payload_json, created_at, expires_at)
      VALUES (?, ?, ?, 'recoverable', ?, ?, ?)
    `).run(randomUUID(), story.id, page.id, JSON.stringify({ deleted_prose: 'RECOVERY-PRIVATE-CANARY' }),
      now.toISOString(), new Date(now.getTime() + 86400000).toISOString());
    const providerId = randomUUID();
    const secretId = randomUUID();
    source.db.prepare(`
      INSERT INTO provider_profiles
        (id, display_name, base_url, capabilities_json, credential_source)
      VALUES (?, 'Private provider', 'https://provider.invalid', '{}', 'none')
    `).run(providerId);
    source.db.prepare(`
      INSERT INTO provider_secrets (id, profile_id, nonce, ciphertext, auth_tag)
      VALUES (?, ?, ?, ?, ?)
    `).run(secretId, providerId, Buffer.from('nonce'), Buffer.from('CREDENTIAL-PRIVATE-CANARY'), Buffer.from('tag'));
    source.db.prepare(`
      UPDATE provider_profiles SET credential_source = 'vault', secret_ref = ? WHERE id = ?
    `).run(secretId, providerId);

    const exported = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    expect(exported.plan.exposure.publication_snapshots).toBe(1);
    expect(exported.plan.exposure.excluded).toEqual(expect.arrayContaining([
      'credentials',
      'authentication owner and sessions',
      'recovery suffixes and undo credentials',
      'publication share capabilities and share records',
    ]));
    const entries = await readZipEntries(exported.bytes);
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
    const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
    expect(bundle.publication_snapshots).toHaveLength(1);
    expect(bundle.publication_snapshots[0]).toMatchObject({
      story_id: story.id,
      schema_version: 1,
      sha256: snapshot.sha256,
    });
    expect(bundle).not.toHaveProperty('recovery_suffixes');
    const archiveText = [...entries.values()].map((entry) => entry.toString('utf8')).join('\n');
    for (const canary of [
      'RECOVERY-PRIVATE-CANARY', 'CREDENTIAL-PRIVATE-CANARY', capability,
      storedShare.capability_hash,
    ]) expect(archiveText).not.toContain(canary);

    const reviewed = await preflight(destination.app, exported.bytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const importedSnapshots = destination.db.prepare(`
      SELECT * FROM publication_snapshots WHERE story_id = ? ORDER BY created_at, id
    `).all(story.id);
    expect(importedSnapshots).toHaveLength(1);
    expect(importedSnapshots[0].sha256).toBe(snapshot.sha256);
    expect(destination.app.locals.publications.get(importedSnapshots[0].id).document).toEqual(snapshot.document);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM shares').get().count).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM recovery_suffixes').get().count).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM provider_secrets').get().count).toBe(0);

    const restored = await downloadPlan(destination.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const restoredEntries = await readZipEntries(restored.bytes);
    const restoredManifest = JSON.parse(restoredEntries.get('manifest.json').toString('utf8'));
    expect(restoredManifest.entities.find((entity) => entity.kind === 'story').semantic_sha256)
      .toBe(storyMeta.semantic_sha256);
  });

  it('round-trips durable writing history and an exact restart-safe prepared page', async () => {
    const story = await createStory(source.app, null, [], { title: 'Prepared Archive' });
    const operationId = randomUUID();
    const previewId = 'P'.repeat(43);
    const context = source.app.locals.writingTransactions.contextSnapshot(story.id, { model: 'test/writer' });
    const timestamp = new Date().toISOString();
    const provider = JSON.stringify({
      complete: true,
      content: 'Prepared prose survives the archive.',
      model: 'test/writer',
      usage: { prompt_tokens: 10, completion_tokens: 6 },
      cost_usd: 0.004,
      billed_attempts: 1,
    });
    source.db.prepare(`
      INSERT INTO writing_operations
        (id, story_id, sequence, idempotency_key, request_hash, kind, status,
         writer_session_id, expected_tail_page_id, expected_tail_revision_id,
         context_fingerprint, request_json, provider_result_json, result_json,
         spend_usd, billed_attempts, created_at, updated_at, finished_at)
      VALUES (?, ?, 1, 'archive-prepare', ?, 'prepare', 'succeeded', 'private-tab-id',
              NULL, NULL, ?, '{}', ?, ?, 0.004, 1, ?, ?, ?)
    `).run(operationId, story.id, 'a'.repeat(64), context.fingerprint, provider,
      JSON.stringify({ preview: { preview_id: previewId } }), timestamp, timestamp, timestamp);
    source.db.prepare(`
      INSERT INTO prepared_pages
        (story_id, id, operation_id, expected_page, expected_tail_page_id,
         expected_tail_revision_id, context_fingerprint, context_json, content,
         provider_result_json, spend_usd, created_at, updated_at)
      VALUES (?, ?, ?, 1, NULL, NULL, ?, ?, ?, ?, 0.004, ?, ?)
    `).run(story.id, previewId, operationId, context.fingerprint, context.json,
      'Prepared prose survives the archive.', provider, timestamp, timestamp);

    const { bytes } = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const entries = await readZipEntries(bytes);
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
    const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
    expect(bundle.writing_operations).toHaveLength(1);
    expect(bundle.writing_operations[0].writer_session_id).toBeUndefined();
    expect(bundle.writing_operations[0].lease_token).toBeUndefined();
    expect(bundle.prepared_page.content).toBe('Prepared prose survives the archive.');

    const reviewed = await preflight(destination.app, bytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const imported = destination.db.prepare('SELECT * FROM prepared_pages WHERE story_id = ?').get(story.id);
    expect(imported).toBeTruthy();
    expect(imported.id).not.toBe(previewId);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM writing_operations WHERE story_id = ?')
      .get(story.id).count).toBe(1);

    const preview = await request(destination.app)
      .get(`/api/stories/${story.id}/pages/preview`)
      .expect(200);
    expect(preview.body.preview.preview_id).toBe(imported.id);
    const restoredArchive = await downloadPlan(destination.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const restoredEntries = await readZipEntries(restoredArchive.bytes);
    const restoredManifest = JSON.parse(restoredEntries.get('manifest.json').toString('utf8'));
    expect(restoredManifest.entities.find((entity) => entity.kind === 'story').semantic_sha256)
      .toBe(storyMeta.semantic_sha256);
    const promoted = await request(destination.app)
      .post(`/api/stories/${story.id}/pages/commit-preview`)
      .set('Idempotency-Key', 'promote-imported-preview')
      .set('X-InkMorrow-Writer-Session', 'destination-tab')
      .send({ preview_id: imported.id })
      .expect(201);
    expect(promoted.body.page.content).toBe('Prepared prose survives the archive.');
    expect(promoted.body.page.cost_usd).toBe(0.004);
  });

  it('round-trips optional Play contracts, turns, and failed request accounting as working history', async () => {
    const lead = await createCharacter(source.app, null, { name: 'Mara Vale' });
    const story = await createStory(source.app, null, [
      { id: lead.id, role: 'mc', relation: 'self', state: null },
    ], { title: 'Play Archive' });
    const chapter = story.hierarchy.volumes[0].chapters[0];
    const scene = (await request(source.app)
      .post(`/api/stories/${story.id}/chapters/${chapter.id}/scenes`)
      .send({ title: 'At the threshold', mode: 'play', viewpoint_character_id: lead.id })
      .expect(201)).body.scene;
    const session = (await request(source.app)
      .post(`/api/stories/${story.id}/scenes/${scene.id}/play-sessions`)
      .send({
        participants: [{ character_id: lead.id, controller: 'owner' }],
        scribe_initiative: 'balanced', challenge: 'gentle', pacing: 'reflective',
        consequences: 'guarded', allow_character_death: false,
        suggestions: 'on_request', player_interiority: 'owner_only',
      }).expect(201)).body.session;
    const ownerTurn = (await request(source.app)
      .post(`/api/stories/${story.id}/play-sessions/${session.id}/turns`)
      .set('Idempotency-Key', 'portable-owner-turn')
      .send({ kind: 'act', character_id: lead.id, content: 'I listen at the threshold.' })
      .expect(201)).body.turn;
    source.db.prepare(`
      INSERT INTO play_ai_requests
        (session_id, idempotency_key, request_hash, contract_json, owner_turn_id, status,
         spend_usd, cost_known, billed_attempts, error_code, error_message, finished_at)
      VALUES (?, 'portable-failed-reply', ?, ?, ?, 'failed', 0.003, 1, 1,
              'PROVIDER_FAILED', 'The provider declined the reply.', CURRENT_TIMESTAMP)
    `).run(session.id, 'b'.repeat(64), JSON.stringify({ participants: session.participants }), ownerTurn.id);
    const campaignEntry = (await request(source.app).post(`/api/stories/${story.id}/campaign-state`).send({
      kind: 'knowledge_boundary', title: 'Mara heard the threshold', details: { summary: 'She heard scratching beyond it.' },
      subject_character_id: lead.id, source_type: 'play_turn', source_id: ownerTurn.id,
    }).expect(201)).body.entry;
    source.db.prepare(`INSERT INTO campaign_ai_requests
      (id, story_id, scene_id, idempotency_key, request_hash, status, result_json,
       spend_usd, cost_known, billed_attempts, finished_at)
      VALUES ('portable-campaign-request', ?, ?, 'portable-campaign', ?, 'succeeded', '[]', 0.002, 1, 1, CURRENT_TIMESTAMP)`)
      .run(story.id, scene.id, 'c'.repeat(64));

    const { bytes } = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const entries = await readZipEntries(bytes);
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
    const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
    expect(bundle.play_sessions).toHaveLength(1);
    expect(bundle.play_sessions[0].participants_json[0]).toMatchObject({
      character_id: lead.id, controller: 'owner', name: 'Mara Vale', role: 'mc',
    });
    expect(bundle.play_turns).toHaveLength(1);
    expect(bundle.play_ai_requests).toHaveLength(1);
    expect(bundle.campaign_entries).toHaveLength(1);
    expect(bundle.campaign_revisions[0]).toMatchObject({ entry_id: campaignEntry.id, source_id: ownerTurn.id });
    expect(bundle.campaign_ai_requests).toHaveLength(1);

    const reviewed = await preflight(destination.app, bytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const importedSession = destination.db.prepare(`
      SELECT session.* FROM play_sessions session
      JOIN scenes scene ON scene.id = session.scene_id
      JOIN chapters chapter ON chapter.id = scene.chapter_id
      JOIN volumes volume ON volume.id = chapter.volume_id
      WHERE volume.story_id = ?
    `).get(story.id);
    expect(JSON.parse(importedSession.participants_json)[0].character_id).toBe(lead.id);
    expect(destination.db.prepare('SELECT content FROM play_turns WHERE session_id = ?').get(importedSession.id).content)
      .toBe('I listen at the threshold.');
    expect(destination.db.prepare('SELECT status, spend_usd, billed_attempts FROM play_ai_requests WHERE session_id = ?')
      .get(importedSession.id)).toEqual({ status: 'failed', spend_usd: 0.003, billed_attempts: 1 });
    const importedCampaign = destination.db.prepare('SELECT * FROM campaign_entries WHERE story_id = ?').get(story.id);
    expect(importedCampaign).toMatchObject({ kind: 'knowledge_boundary', status: 'active' });
    const importedCampaignRevision = destination.db.prepare('SELECT * FROM campaign_entry_revisions WHERE entry_id = ?').get(importedCampaign.id);
    expect(importedCampaignRevision.source_id).toBe(destination.db.prepare('SELECT id FROM play_turns WHERE session_id = ?').get(importedSession.id).id);
    expect(destination.db.prepare('SELECT spend_usd FROM campaign_ai_requests WHERE story_id = ?').get(story.id).spend_usd).toBe(0.002);

    const restored = await downloadPlan(destination.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const restoredEntries = await readZipEntries(restored.bytes);
    const restoredManifest = JSON.parse(restoredEntries.get('manifest.json').toString('utf8'));
    expect(restoredManifest.entities.find((entity) => entity.kind === 'story').semantic_sha256)
      .toBe(storyMeta.semantic_sha256);
  });

  it('upgrades a schema-1 4.0 kernel archive to the default hierarchy on import', async () => {
    const story = await createStory(source.app, null, [], { title: 'Kernel Archive' });
    const page = await addPage(source.app, story.id, 'Compatibility prose.');
    const { bytes } = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: false,
    });
    const entries = await readZipEntries(bytes);
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    const storyMeta = manifest.entities.find((entity) => entity.kind === 'story');
    const bundle = JSON.parse(entries.get(storyMeta.path).toString('utf8'));
    delete bundle.hierarchy;
    const bundleBuffer = jsonBuffer(bundle);
    storyMeta.size_bytes = bundleBuffer.length;
    storyMeta.sha256 = sha256(bundleBuffer);
    storyMeta.semantic_sha256 = semanticHash('story', bundle, { includeHierarchy: false });
    manifest.database_schema.version = 1;
    const legacyBytes = await zipFixture(manifest, [{ path: storyMeta.path, content: bundleBuffer }]);

    const reviewed = await preflight(destination.app, legacyBytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const volume = destination.db.prepare('SELECT * FROM volumes WHERE story_id = ?').get(story.id);
    const chapter = destination.db.prepare('SELECT * FROM chapters WHERE volume_id = ?').get(volume.id);
    expect(volume).toMatchObject({ ordinal: 1, title: 'Volume I' });
    expect(chapter).toMatchObject({ ordinal: 1, title: 'Chapter I' });
    expect(destination.db.prepare('SELECT id, ordinal FROM pages WHERE chapter_id = ?').get(chapter.id))
      .toEqual({ id: page.id, ordinal: 1 });
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
    const sourceChapter = source.db.prepare(`
      SELECT chapter.id FROM chapters chapter
      JOIN volumes volume ON volume.id = chapter.volume_id
      WHERE volume.story_id = ?
    `).get(story.id);
    const sourceScene = (await request(source.app)
      .post(`/api/stories/${story.id}/chapters/${sourceChapter.id}/scenes`)
      .send({
        title: 'Graph scene', mode: 'hybrid', viewpoint_character_id: character.id,
        page_ids: [page.id],
      })
      .expect(201)).body.scene;
    await request(source.app)
      .put(`/api/stories/${story.id}/pages/${page.id}/revisions`)
      .send({ content: 'The hero changes decisively.', direction: 'Strengthen the change' })
      .expect(200);
    const sourceRevisionIds = source.db.prepare('SELECT id FROM page_revisions WHERE page_id = ? ORDER BY created_at, rowid')
      .all(page.id).map((row) => row.id);
    const canonicalRevisionId = source.db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(page.id).canonical_revision_id;
    source.db.prepare(`
      INSERT INTO continuity_deltas
        (revision_id, story_id, content_hash, status, schema_version, summary, delta_json)
      VALUES (?, ?, ?, 'ready', 2, 'Changed.', ?)
    `).run(canonicalRevisionId, story.id, 'b'.repeat(64), JSON.stringify({
      summary: 'Changed.', events: [],
      character_updates: [{ character_id: character.id, condition: 'changed' }],
      goal_updates: [], thread_updates: [], world_fact_updates: [],
    }));
    source.db.prepare(`
      INSERT INTO continuity_corrections (id, story_id, scope, subject_id, correction_json)
      VALUES (?, ?, 'story', ?, ?)
    `).run(randomUUID(), story.id, story.id, JSON.stringify({
      schema_version: 1, field: 'premise', value: 'A remapped story correction.', source: 'author',
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
    const importedPage = destination.db.prepare('SELECT * FROM manuscript_pages WHERE story_id = ?').get(importedStory.id);
    expect(importedPage.id).not.toBe(page.id);
    const sourceVolume = source.db.prepare('SELECT * FROM volumes WHERE story_id = ?').get(story.id);
    const importedVolume = destination.db.prepare('SELECT * FROM volumes WHERE story_id = ?').get(importedStory.id);
    const importedHierarchyPage = destination.db.prepare(`
      SELECT p.id, c.volume_id FROM pages p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN volumes v ON v.id = c.volume_id
      WHERE v.story_id = ?
    `).get(importedStory.id);
    expect(importedVolume.id).not.toBe(sourceVolume.id);
    expect(importedHierarchyPage).toMatchObject({ id: importedPage.id, volume_id: importedVolume.id });
    const importedScene = destination.db.prepare(`
      SELECT scene.* FROM scenes scene
      JOIN chapters chapter ON chapter.id = scene.chapter_id
      JOIN volumes volume ON volume.id = chapter.volume_id
      WHERE volume.story_id = ?
    `).get(importedStory.id);
    expect(importedScene).toMatchObject({
      title: 'Graph scene', viewpoint_character_id: importedCharacter.id,
    });
    expect(importedScene.id).not.toBe(sourceScene.id);
    expect(destination.db.prepare('SELECT page_id FROM scene_pages WHERE scene_id = ?').get(importedScene.id).page_id)
      .toBe(importedPage.id);
    const importedRevisions = destination.db.prepare('SELECT * FROM page_revisions WHERE page_id = ? ORDER BY created_at, rowid')
      .all(importedPage.id);
    expect(importedRevisions).toHaveLength(2);
    expect(importedRevisions.every((revision) => !sourceRevisionIds.includes(revision.id))).toBe(true);
    expect(importedRevisions[1].parent_revision_id).toBe(importedRevisions[0].id);
    const snapshot = destination.db.prepare('SELECT * FROM story_character_snapshots WHERE story_id = ?').get(importedStory.id);
    expect(snapshot.character_id).toBe(importedCharacter.id);
    const memory = destination.db.prepare(`
      SELECT delta.* FROM continuity_deltas delta
      JOIN pages page ON page.canonical_revision_id = delta.revision_id
      WHERE page.id = ?
    `).get(importedPage.id);
    expect(JSON.parse(memory.delta_json).character_updates[0].character_id).toBe(importedCharacter.id);
    const correction = destination.db.prepare('SELECT * FROM continuity_corrections WHERE story_id = ?').get(importedStory.id);
    expect(correction.subject_id).toBe(importedStory.id);
  });

  it('rejects tampered publication snapshots and injected recovery data before writes', async () => {
    const story = await createStory(source.app, null, [], { title: 'Strict Archive' });
    await addPage(source.app, story.id, 'A stable page.');
    source.app.locals.publications.snapshot(story.id, {});
    const exported = await downloadPlan(source.app, {
      scope: 'story', id: story.id, include_visuals: false,
      include_audio: false, include_working_history: true,
    });
    const tamperedSnapshot = await rewriteStoryBundle(exported.bytes, (bundle) => {
      const document = JSON.parse(bundle.publication_snapshots[0].document_json);
      document.metadata.title = 'Tampered after hashing';
      bundle.publication_snapshots[0].document_json = JSON.stringify(document);
    });
    let response = await preflight(destination.app, tamperedSnapshot).expect(400);
    expect(response.body.error).toMatch(/invalid publication snapshot/i);

    const schemaBypass = await rewriteStoryBundle(exported.bytes, (bundle) => {
      const row = bundle.publication_snapshots[0];
      const document = JSON.parse(row.document_json);
      document.private_state = { canary: 'RECOMPUTED-HASH-CANARY' };
      row.document_json = JSON.stringify(document);
      row.sha256 = hashDocument(document);
    });
    response = await preflight(destination.app, schemaBypass).expect(400);
    expect(response.body.error).toMatch(/invalid publication snapshot/i);

    const injectedRecovery = await rewriteStoryBundle(exported.bytes, (bundle) => {
      bundle.recovery_suffixes = [{ payload_json: 'RECOVERY-INJECTION' }];
    });
    response = await preflight(destination.app, injectedRecovery).expect(400);
    expect(response.body.error).toMatch(/unknown field/i);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM stories').get().count).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM publication_snapshots').get().count).toBe(0);
  });

  it('rejects undeclared ZIP entries without changing the database', async () => {
    const bytes = await zipFixture(manifestFixture(), [
      { path: 'assets/undeclared.txt', content: 'undeclared' },
    ]);
    const response = await preflight(destination.app, bytes).expect(400);
    expect(response.body.error).toMatch(/undeclared file/);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(0);
  });

  it('refuses an unrelated archive during preflight without changing the database', async () => {
    const bytes = await zipFixture({
      format: 'unrelated-project-archive',
      version: 1,
      created_at: new Date().toISOString(),
      scope: 'full',
      options: { include_visuals: false, include_audio: false, include_working_history: false },
      settings: null,
      entities: [],
      assets: [],
      exposure: {},
    });

    const response = await preflight(destination.app, bytes).expect(400);
    expect(response.body.error).toMatch(/not a supported Ink Morrow project archive/i);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM stories').get().c).toBe(0);
  });

  it('fails closed on future archive and database schema versions', async () => {
    const futureArchive = await zipFixture(manifestFixture({ version: ARCHIVE_VERSION + 1 }));
    let response = await preflight(destination.app, futureArchive).expect(400);
    expect(response.body.error).toMatch(/newer Ink Morrow version/i);

    const futureDatabase = await zipFixture(manifestFixture({
      database_schema: { family: DATABASE_FAMILY, version: DATABASE_SCHEMA_VERSION + 1 },
    }));
    response = await preflight(destination.app, futureDatabase).expect(400);
    expect(response.body.error).toMatch(/newer Ink Morrow database schema/i);

    const futureManifest = await zipFixture(manifestFixture({
      manifest_schema_version: ARCHIVE_MANIFEST_SCHEMA_VERSION + 1,
    }));
    response = await preflight(destination.app, futureManifest).expect(400);
    expect(response.body.error).toMatch(/newer manifest schema/i);
    expect(destination.db.prepare('SELECT COUNT(*) AS c FROM worlds').get().c).toBe(0);
  });
});
