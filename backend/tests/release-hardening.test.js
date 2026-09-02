'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const request = require('supertest');
const sharp = require('sharp');
const yauzl = require('yauzl');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.setTimeout(180000);

const PAGE_COUNT = 3000;
const WORDS_PER_PAGE = 400;
const CHARACTER_COUNT = 150;
const CONTINUITY_FACT_COUNT = 10000;
const ASSET_COUNT = 500;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function isolatedApp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `im-release-${label}-`));
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
    root, imageDir, db, app,
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

async function downloadArchive(app, payload) {
  const planned = await request(app).post('/api/transfers/exports/plan').send(payload).expect(200);
  const downloaded = await request(app).get(planned.body.download_url)
    .buffer().parse(binaryParser).expect(200);
  return { plan: planned.body, bytes: downloaded.body };
}

function preflight(app, bytes) {
  return request(app).post('/api/transfers/imports/preflight')
    .attach('archive', bytes, 'release-fixture.inkmorrow');
}

function readManifest(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        if (entry.fileName !== 'manifest.json') {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            zip.close();
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          });
        });
      });
      zip.readEntry();
    });
  });
}

function neutralPage(number) {
  return `${Array.from({ length: WORDS_PER_PAGE - 2 }, () => 'neutral').join(' ')} page ${number}`;
}

function portableDatabaseDigest(db, storyId) {
  const queries = [
    ['story', `SELECT id, title, world_id, characters, tone FROM stories WHERE id = ?`, [storyId]],
    ['pages', `SELECT id, story_id, page_number, content, user_input FROM manuscript_pages WHERE story_id = ? ORDER BY page_number`, [storyId]],
    ['volumes', `SELECT id, story_id, ordinal, title FROM volumes WHERE story_id = ? ORDER BY ordinal`, [storyId]],
    ['chapters', `SELECT chapter.id, chapter.volume_id, chapter.ordinal, chapter.title
                    FROM chapters chapter JOIN volumes volume ON volume.id = chapter.volume_id
                   WHERE volume.story_id = ? ORDER BY volume.ordinal, chapter.ordinal`, [storyId]],
    ['hierarchy_pages', `SELECT page.id, page.chapter_id, page.ordinal, page.canonical_revision_id, page.display_revision_id
                          FROM pages page JOIN chapters chapter ON chapter.id = page.chapter_id
                          JOIN volumes volume ON volume.id = chapter.volume_id
                         WHERE volume.story_id = ? ORDER BY volume.ordinal, chapter.ordinal, page.ordinal`, [storyId]],
    ['revisions', `SELECT revision.id, revision.page_id, revision.parent_revision_id, revision.kind,
                           revision.content, revision.direction, revision.source
                      FROM page_revisions revision JOIN pages page ON page.id = revision.page_id
                      JOIN chapters chapter ON chapter.id = page.chapter_id
                      JOIN volumes volume ON volume.id = chapter.volume_id
                     WHERE volume.story_id = ? ORDER BY page.id, revision.created_at, revision.rowid`, [storyId]],
    ['continuity', `SELECT revision_id, story_id, status, schema_version, delta_json, content_hash, summary
                      FROM continuity_deltas WHERE story_id = ? ORDER BY revision_id`, [storyId]],
    ['assets', `SELECT id, story_id, source, status, media_type, sha256, size_bytes, width, height,
                       title, alt_text, metadata_json FROM assets WHERE story_id = ? ORDER BY id`, [storyId]],
    ['placements', `SELECT id, story_id, asset_id, after_page_id, ordinal
                       FROM asset_placements WHERE story_id = ? ORDER BY id`, [storyId]],
    ['publications', `SELECT schema_version, document_json, sha256
                        FROM publication_snapshots WHERE story_id = ? ORDER BY sha256`, [storyId]],
  ];
  const sections = Object.fromEntries(queries.map(([name, sql, params]) => {
    const rows = db.prepare(sql).all(...params);
    if (name === 'story') rows.forEach((row) => { row.characters = JSON.parse(row.characters); });
    return [name, sha256(JSON.stringify(stableValue(rows)))];
  }));
  return { sections, combined: sha256(JSON.stringify(sections)) };
}

function mediaDigest(fixture, storyId) {
  const rows = fixture.db.prepare(`
    SELECT id, sha256 FROM assets WHERE story_id = ? AND status = 'ready' ORDER BY id
  `).all(storyId);
  return sha256(rows.map((row) => {
    const stored = fixture.app.locals.artStore.readAsset(storyId, row.id);
    expect(stored).toBeTruthy();
    return `${row.id}:${row.sha256}:${sha256(stored.buffer)}`;
  }).join('\n'));
}

async function buildReleaseFixture(fixture) {
  const { db } = fixture;
  const storyId = 'release-story';
  const worldId = 'release-world';
  const characterIds = Array.from({ length: CHARACTER_COUNT }, (_, index) =>
    `release-character-${String(index + 1).padStart(3, '0')}`);
  const cast = characterIds.map((id, index) => ({
    id,
    role: index === 0 ? 'mc' : 'supporting',
    relation: `recurring fixture character ${index + 1}`,
    state: null,
  }));
  const insertCharacter = db.prepare(`
    INSERT INTO characters
      (id, name, description, personality, appearance, background, world_id)
    VALUES (?, ?, ?, 'Measured', 'Neutral attire', 'Synthetic fixture', ?)
  `);
  const insertSnapshot = db.prepare(`
    INSERT INTO story_character_snapshots
      (story_id, character_id, name, description, personality, appearance, background)
    VALUES (?, ?, ?, ?, 'Measured', 'Neutral attire', 'Synthetic fixture')
  `);
  const insertVolume = db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, ?, ?)');
  const insertChapter = db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, ?, ?)');
  const insertPage = db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)');
  const insertRevision = db.prepare(`
    INSERT INTO page_revisions (id, page_id, kind, content, direction, source, cost_usd)
    VALUES (?, ?, 'canonical', ?, ?, 'migration', 0)
  `);
  const pointPage = db.prepare('UPDATE pages SET canonical_revision_id = ?, display_revision_id = ? WHERE id = ?');
  const insertDelta = db.prepare(`
    INSERT INTO continuity_deltas
      (revision_id, story_id, status, schema_version, delta_json, content_hash, summary)
    VALUES (?, ?, 'ready', 2, ?, ?, ?)
  `);
  const pageIds = [];
  const revisionIds = [];

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO worlds (id, name, description, genre, setting, lore)
      VALUES (?, 'Release Fixture World', 'Synthetic world.', 'Neutral', 'Measured', 'Generated test-only lore.')
    `).run(worldId);
    for (let index = 0; index < CHARACTER_COUNT; index += 1) {
      const name = `Fixture Character ${String(index + 1).padStart(3, '0')}`;
      insertCharacter.run(characterIds[index], name, `Recurring synthetic character ${index + 1}.`, worldId);
    }
    db.prepare(`
      INSERT INTO stories (id, title, world_id, characters, tone, continuity_overrides)
      VALUES (?, 'Release Scale Fixture', ?, ?, 'fade-to-black', '{}')
    `).run(storyId, worldId, JSON.stringify(cast));
    for (let index = 0; index < CHARACTER_COUNT; index += 1) {
      const name = `Fixture Character ${String(index + 1).padStart(3, '0')}`;
      insertSnapshot.run(storyId, characterIds[index], name, `Recurring synthetic character ${index + 1}.`);
    }

    let pageNumber = 0;
    for (let volumeNumber = 1; volumeNumber <= 10; volumeNumber += 1) {
      const volumeId = `release-volume-${String(volumeNumber).padStart(2, '0')}`;
      insertVolume.run(volumeId, storyId, volumeNumber, `Volume ${volumeNumber}`);
      for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) {
        const globalChapter = (volumeNumber - 1) * 10 + chapterNumber;
        const chapterId = `release-chapter-${String(globalChapter).padStart(3, '0')}`;
        insertChapter.run(chapterId, volumeId, chapterNumber, `Chapter ${globalChapter}`);
        for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
          pageNumber += 1;
          const pageId = `release-page-${String(pageNumber).padStart(4, '0')}`;
          const revisionId = `release-revision-${String(pageNumber).padStart(4, '0')}`;
          const content = neutralPage(pageNumber);
          const factCount = pageNumber <= 1000 ? 4 : 3;
          const facts = Array.from({ length: factCount }, (_, index) => ({
            text: `Fixture fact ${(pageNumber - 1) * 4 + index + 1}.`,
            character_ids: [characterIds[(pageNumber + index) % CHARACTER_COUNT]],
          }));
          const delta = {
            schema_version: 2,
            summary: `Fixture page ${pageNumber}.`,
            events: facts,
            character_updates: [], world_fact_updates: [], goal_updates: [], thread_updates: [], arc_updates: [],
          };
          insertPage.run(pageId, chapterId, ordinal);
          insertRevision.run(revisionId, pageId, content, pageNumber === 1 ? 'Synthetic opening.' : null);
          pointPage.run(revisionId, revisionId, pageId);
          insertDelta.run(revisionId, storyId, JSON.stringify(delta), sha256(content), delta.summary);
          pageIds.push(pageId);
          revisionIds.push(revisionId);
        }
      }
    }

    const copyeditId = 'release-copyedit-0001';
    const copyedited = `${neutralPage(1)} revised`;
    db.prepare(`
      INSERT INTO page_revisions
        (id, page_id, parent_revision_id, kind, content, direction, source, cost_usd)
      VALUES (?, ?, ?, 'copyedit', ?, 'Release fixture copyedit.', 'author', 0)
    `).run(copyeditId, pageIds[0], revisionIds[0], copyedited);
    db.prepare('UPDATE pages SET display_revision_id = ? WHERE id = ?').run(copyeditId, pageIds[0]);
    db.prepare(`
      INSERT INTO continuity_corrections (id, story_id, scope, subject_id, correction_json)
      VALUES ('release-correction', ?, 'story', ?, ?)
    `).run(storyId, storyId, JSON.stringify({
      schema_version: 1, field: 'premise', value: 'Synthetic correction.', source: 'author',
    }));

    const operationId = 'release-prepare-operation';
    const preparedId = 'release-prepared-page-0001';
    const contextJson = JSON.stringify({ generation: { model: 'fixture/writer', words: WORDS_PER_PAGE } });
    const providerJson = JSON.stringify({
      complete: true, content: 'Synthetic prepared prose.', model: 'fixture/writer',
      usage: { prompt_tokens: 10, completion_tokens: 4 }, cost_usd: 0, billed_attempts: 1,
    });
    db.prepare(`
      INSERT INTO writing_operations
        (id, story_id, sequence, idempotency_key, request_hash, kind, status,
         writer_session_id, expected_tail_page_id, expected_tail_revision_id,
         context_fingerprint, request_json, provider_result_json, result_json,
         spend_usd, billed_attempts, created_at, updated_at, finished_at)
      VALUES (?, ?, 1, 'release-fixture-prepare', ?, 'prepare', 'succeeded',
              'fixture-session', ?, ?, ?, '{}', ?, ?, 0, 1,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(operationId, storyId, 'a'.repeat(64), pageIds.at(-1), revisionIds.at(-1),
      'b'.repeat(64), providerJson, JSON.stringify({ preview: { preview_id: preparedId } }));
    db.prepare(`
      INSERT INTO prepared_pages
        (story_id, id, operation_id, expected_page, expected_tail_page_id,
         expected_tail_revision_id, context_fingerprint, context_json, content,
         provider_result_json, spend_usd, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Synthetic prepared prose.', ?, 0,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(storyId, preparedId, operationId, PAGE_COUNT + 1, pageIds.at(-1), revisionIds.at(-1),
      'b'.repeat(64), contextJson, providerJson);
    db.prepare(`
      INSERT INTO recovery_suffixes
        (id, story_id, anchor_page_id, status, payload_json, expires_at)
      VALUES ('release-recovery', ?, ?, 'recoverable', ?, '2099-01-01T00:00:00.000Z')
    `).run(storyId, pageIds.at(-1), JSON.stringify({ deleted_prose: 'PRIVATE-RECOVERY-CANARY' }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const tinyWebp = await sharp({
    create: { width: 1, height: 1, channels: 4, background: '#664466' },
  }).webp({ lossless: true }).toBuffer();
  const mediaSha = sha256(tinyWebp);
  const insertAsset = db.prepare(`
    INSERT INTO assets
      (id, story_id, source, status, source_media_type, media_type, storage_key,
       sha256, size_bytes, width, height, title, alt_text, metadata_json)
    VALUES (?, ?, 'uploaded', 'ready', 'image/webp', 'image/webp', ?, ?, ?, 1, 1, ?, ?, ?)
  `);
  const insertPlacement = db.prepare(`
    INSERT INTO asset_placements (id, story_id, asset_id, after_page_id, ordinal)
    VALUES (?, ?, ?, ?, 1)
  `);
  db.exec('BEGIN');
  try {
    for (let index = 1; index <= ASSET_COUNT; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const assetId = `release-asset-${suffix}`;
      const storageKey = `release-asset-${suffix}.webp`;
      insertAsset.run(assetId, storyId, storageKey, mediaSha, tinyWebp.length,
        `Fixture image ${index}`, `Synthetic one-pixel image ${index}.`, JSON.stringify({ fixture_index: index }));
      fs.writeFileSync(path.join(fixture.imageDir, 'assets', storageKey), tinyWebp);
      if (index <= ASSET_COUNT / 2) {
        insertPlacement.run(`release-placement-${suffix}`, storyId, assetId, pageIds[index - 1]);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const publication = fixture.app.locals.publications.snapshot(storyId, {
    metadata: { author: 'Synthetic Release Fixture' },
  });
  const share = fixture.app.locals.publicationShares.create(publication.id, {});
  return {
    storyId,
    publication,
    shareCapability: new URL(`http://localhost${share.share_url}`).hash.slice(1),
  };
}

describe('PR 18 release-scale hardening fixture', () => {
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

  it('round-trips the complete portable release state at the accepted manuscript scale', async () => {
    const builtAt = performance.now();
    const fixture = await buildReleaseFixture(source);
    const buildMs = performance.now() - builtAt;
    expect(source.db.prepare('SELECT COUNT(*) AS count FROM volumes WHERE story_id = ?').get(fixture.storyId).count).toBe(10);
    expect(source.db.prepare(`
      SELECT COUNT(*) AS count FROM chapters chapter
      JOIN volumes volume ON volume.id = chapter.volume_id WHERE volume.story_id = ?
    `).get(fixture.storyId).count).toBe(100);
    expect(source.db.prepare('SELECT COUNT(*) AS count FROM manuscript_pages WHERE story_id = ?').get(fixture.storyId).count).toBe(PAGE_COUNT);
    const wordCount = source.db.prepare('SELECT content FROM manuscript_pages WHERE story_id = ?').all(fixture.storyId)
      .reduce((sum, row) => sum + row.content.trim().split(/\s+/).length, 0);
    expect(wordCount).toBe(PAGE_COUNT * WORDS_PER_PAGE + 1);
    expect(source.db.prepare('SELECT COUNT(*) AS count FROM characters').get().count).toBe(CHARACTER_COUNT);
    const factCount = source.db.prepare('SELECT delta_json FROM continuity_deltas WHERE story_id = ?').all(fixture.storyId)
      .reduce((sum, row) => sum + JSON.parse(row.delta_json).events.length, 0);
    expect(factCount).toBe(CONTINUITY_FACT_COUNT);
    expect(source.db.prepare('SELECT COUNT(*) AS count FROM assets WHERE story_id = ?').get(fixture.storyId).count).toBe(ASSET_COUNT);
    expect(source.db.prepare('SELECT COUNT(*) AS count FROM asset_placements WHERE story_id = ?').get(fixture.storyId).count).toBe(ASSET_COUNT / 2);

    const sourceDatabaseHash = portableDatabaseDigest(source.db, fixture.storyId);
    const sourceMediaHash = mediaDigest(source, fixture.storyId);
    const exportStarted = performance.now();
    const exported = await downloadArchive(source.app, {
      scope: 'story', id: fixture.storyId, include_visuals: true,
      include_audio: false, include_working_history: true,
    });
    const exportMs = performance.now() - exportStarted;
    expect(exported.plan.exposure).toMatchObject({
      worlds: 1,
      characters: CHARACTER_COUNT,
      stories: 1,
      pages: PAGE_COUNT,
      continuity_rows: PAGE_COUNT,
      images: ASSET_COUNT,
      publication_snapshots: 1,
    });
    expect(exported.bytes.includes(Buffer.from('PRIVATE-RECOVERY-CANARY'))).toBe(false);
    expect(exported.bytes.includes(Buffer.from(fixture.shareCapability))).toBe(false);
    const sourceManifest = await readManifest(exported.bytes);
    const sourceStory = sourceManifest.entities.find((entity) => entity.kind === 'story');

    const importStarted = performance.now();
    const reviewed = await preflight(destination.app, exported.bytes).expect(200);
    await request(destination.app)
      .post(`/api/transfers/imports/${reviewed.body.token}/commit`)
      .send({ mode: 'merge' })
      .expect(200);
    const importMs = performance.now() - importStarted;
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM recovery_suffixes').get().count).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM shares').get().count).toBe(0);
    expect(destination.db.prepare('SELECT COUNT(*) AS count FROM prepared_pages').get().count).toBe(1);
    const destinationDatabaseHash = portableDatabaseDigest(destination.db, fixture.storyId);
    expect(destinationDatabaseHash.sections).toEqual(sourceDatabaseHash.sections);
    expect(destinationDatabaseHash.combined).toBe(sourceDatabaseHash.combined);
    expect(mediaDigest(destination, fixture.storyId)).toBe(sourceMediaHash);

    const reexported = await downloadArchive(destination.app, {
      scope: 'story', id: fixture.storyId, include_visuals: true,
      include_audio: false, include_working_history: true,
    });
    const destinationManifest = await readManifest(reexported.bytes);
    expect(destinationManifest.entities.find((entity) => entity.kind === 'story').semantic_sha256)
      .toBe(sourceStory.semantic_sha256);
    expect(buildMs).toBeLessThan(60000);
    expect(exportMs).toBeLessThan(60000);
    expect(importMs).toBeLessThan(60000);
    if (process.env.RELEASE_EVIDENCE === '1') {
      process.stdout.write(`${JSON.stringify({
        fixture: {
          volumes: 10,
          chapters: 100,
          pages: PAGE_COUNT,
          words: wordCount,
          characters: CHARACTER_COUNT,
          continuity_facts: factCount,
          assets: ASSET_COUNT,
        },
        build_ms: Math.round(buildMs),
        export_ms: Math.round(exportMs),
        import_ms: Math.round(importMs),
      })}\n`);
    }
  });
});
