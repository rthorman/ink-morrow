'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const request = require('supertest');
const sharp = require('sharp');
const {
  createDb,
  runMigrations,
  schemaIdentity,
  MIGRATIONS,
} = require('../src/db');
const {
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  SQLITE_APPLICATION_ID,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
} = require('../src/release');
const {
  beginOperation,
  settleOperation,
} = require('../src/core/operation-journal');
const { createTestApp } = require('./helpers');
const { createImageStore } = require('../src/images');
const { createArtStore } = require('../src/modules/imagery/art-store');

describe('ScribeTribe 4.0 kernel', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-kernel-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a branded, constrained schema and boots it repeatedly', () => {
    const dbPath = path.join(root, 'nested', 'scribe-tribe.db');
    let db = createDb(dbPath);
    expect(schemaIdentity(db)).toMatchObject({
      family: DATABASE_FAMILY,
      version: DATABASE_SCHEMA_VERSION,
    });
    expect(db.prepare('PRAGMA application_id').get().application_id).toBe(SQLITE_APPLICATION_ID);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(DATABASE_SCHEMA_VERSION);
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA quick_check').get().quick_check).toBe('ok');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    for (const table of [
      'volumes', 'chapters', 'pages', 'page_revisions', 'prepared_pages',
      'writing_operations', 'continuity_deltas', 'continuity_corrections',
      'continuity_issues', 'continuity_search', 'continuity_projection_checkpoints',
      'template_snapshots', 'recovery_suffixes', 'assets',
      'asset_placements', 'publication_snapshots', 'shares', 'operation_journal',
      'provider_profiles', 'provider_role_assignments', 'provider_vault', 'provider_secrets',
    ]) {
      expect(tables.has(table)).toBe(true);
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(MIGRATIONS.length);
    db.close();

    db = createDb(dbPath);
    expect(schemaIdentity(db).version).toBe(DATABASE_SCHEMA_VERSION);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(MIGRATIONS.length);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('refuses a 3.x database without changing its bytes or timestamp', () => {
    const dbPath = path.join(root, 'legacy.db');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
    legacy.prepare('INSERT INTO stories (id, title) VALUES (?, ?)').run('old', 'Legacy manuscript');
    legacy.close();
    const before = fs.readFileSync(dbPath);
    const beforeStat = fs.statSync(dbPath);

    let error;
    try { createDb(dbPath); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'LEGACY_DATABASE' });

    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(fs.statSync(dbPath).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it('fails closed on a future database before changing it', () => {
    const dbPath = path.join(root, 'future.db');
    const db = createDb(dbPath);
    db.prepare('UPDATE scribe_schema SET version = ? WHERE singleton = 1').run(DATABASE_SCHEMA_VERSION + 1);
    db.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = fs.readFileSync(dbPath);
    const beforeStat = fs.statSync(dbPath);

    let error;
    try { createDb(dbPath); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'FUTURE_DATABASE' });

    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(fs.statSync(dbPath).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('rolls a failed recognized migration back to the last valid version', () => {
    const db = createDb(':memory:');
    const interruptedVersion = DATABASE_SCHEMA_VERSION + 1;
    const migrations = [
      ...MIGRATIONS,
      {
        version: interruptedVersion,
        name: 'deliberately interrupted test migration',
        checksumSource: `interrupted-v${interruptedVersion}-fixture`,
        up(database) {
          database.exec('CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)');
          throw new Error('simulated interruption');
        },
      },
    ];

    expect(() => runMigrations(db, DATABASE_SCHEMA_VERSION, migrations)).toThrow('simulated interruption');
    expect(schemaIdentity(db).version).toBe(DATABASE_SCHEMA_VERSION);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(DATABASE_SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(MIGRATIONS.length);
    db.close();
  });

  it('transactionally backfills kernel-era stories and pages into the hierarchy', () => {
    const dbPath = path.join(root, 'schema-1.db');
    let db = createDb(dbPath, { migrations: [MIGRATIONS[0]], reconcileOperations: false });
    db.prepare("INSERT INTO stories (id, title) VALUES ('story-1', 'Kernel-era story')").run();
    db.prepare("INSERT INTO story_pages (id, story_id, page_number, content) VALUES ('page-a', 'story-1', 1, 'One')").run();
    db.prepare("INSERT INTO story_pages (id, story_id, page_number, content) VALUES ('page-b', 'story-1', 2, 'Two')").run();
    db.close();

    db = createDb(dbPath);
    expect(schemaIdentity(db).version).toBe(DATABASE_SCHEMA_VERSION);
    const volume = db.prepare("SELECT * FROM volumes WHERE story_id = 'story-1'").get();
    const chapter = db.prepare('SELECT * FROM chapters WHERE volume_id = ?').get(volume.id);
    expect(volume).toMatchObject({ ordinal: 1, title: 'Volume I' });
    expect(chapter).toMatchObject({ ordinal: 1, title: 'Chapter I' });
    expect(db.prepare('SELECT id, ordinal FROM pages WHERE chapter_id = ? ORDER BY ordinal').all(chapter.id))
      .toEqual([{ id: 'page-a', ordinal: 1 }, { id: 'page-b', ordinal: 2 }]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('migrates and reconciles schema-6 image pages into noncanonical art', async () => {
    const dbPath = path.join(root, 'schema-6-art.db');
    const imageDir = path.join(root, 'images');
    const imageStore = createImageStore(imageDir);
    let db = createDb(dbPath, { migrations: MIGRATIONS.slice(0, 6), reconcileOperations: false });
    db.prepare("INSERT INTO stories (id, title) VALUES ('story-art', 'Migration art')").run();
    db.prepare("INSERT INTO volumes (id, story_id, ordinal, title) VALUES ('volume-art', 'story-art', 1, 'Volume I')").run();
    db.prepare("INSERT INTO chapters (id, volume_id, ordinal, title) VALUES ('chapter-art', 'volume-art', 1, 'Chapter I')").run();
    db.prepare("INSERT INTO story_pages (id, story_id, page_number, content) VALUES ('prose-a', 'story-art', 1, 'One')").run();
    db.prepare(`
      INSERT INTO story_pages
        (id, story_id, page_number, content, image_media_type, image_prompt, cost_usd)
      VALUES ('old-plate', 'story-art', 2, '', 'image/png', 'A migration plate', 0.04)
    `).run();
    db.prepare("INSERT INTO story_pages (id, story_id, page_number, content) VALUES ('prose-b', 'story-art', 3, 'Two')").run();
    for (const [id, ordinal] of [['prose-a', 1], ['old-plate', 2], ['prose-b', 3]]) {
      db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)').run(id, 'chapter-art', ordinal);
    }
    imageStore.writeImage('page', 'old-plate', await sharp({
      create: { width: 8, height: 6, channels: 4, background: '#5c1f4d' },
    }).png().toBuffer(), 'image/png');
    db.close();

    db = createDb(dbPath, { reconcileOperations: false });
    expect(db.prepare("SELECT id, page_number FROM story_pages WHERE story_id = 'story-art' ORDER BY page_number").all())
      .toEqual([{ id: 'prose-a', page_number: 1 }, { id: 'prose-b', page_number: 2 }]);
    expect(db.prepare("SELECT id, ordinal FROM pages WHERE chapter_id = 'chapter-art' ORDER BY ordinal").all())
      .toEqual([{ id: 'prose-a', ordinal: 1 }, { id: 'prose-b', ordinal: 2 }]);
    expect(db.prepare("SELECT * FROM legacy_art_pages WHERE page_id = 'old-plate'").get())
      .toMatchObject({
        page_id: 'old-plate', story_id: 'story-art', after_page_id: 'prose-a',
        media_type: 'image/png', prompt: 'A migration plate', spend_usd: 0.04, ordinal: 1,
      });
    const artStore = createArtStore({
      db,
      rootDir: imageDir,
      legacyImageStore: imageStore,
      logger: { error: jest.fn() },
    });
    await artStore.ready;
    expect(db.prepare("SELECT * FROM legacy_art_pages WHERE page_id = 'old-plate'").get()).toBeUndefined();
    expect(artStore.getAsset('story-art', 'old-plate')).toMatchObject({
      source: 'ai-generated', status: 'ready', media_type: 'image/webp', spend_usd: 0.04,
    });
    expect(artStore.list('story-art').placements).toEqual([
      expect.objectContaining({ asset_id: 'old-plate', after_page_id: 'prose-a', ordinal: 1 }),
    ]);
    expect(imageStore.fileInfo('page', 'old-plate')).toBeNull();
    expect(fs.readdirSync(path.join(imageDir, 'assets'))).toHaveLength(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('enforces core relationships and operation state transitions', () => {
    const db = createDb(':memory:');
    expect(() => db.prepare(`
      INSERT INTO volumes (id, story_id, ordinal, title)
      VALUES ('volume-1', 'missing-story', 1, 'Volume I')
    `).run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`
      INSERT INTO operation_journal (id, kind, status, finished_at)
      VALUES ('bad', 'test', 'pending', CURRENT_TIMESTAMP)
    `).run()).toThrow(/CHECK constraint/);

    const pending = beginOperation(db, {
      id: 'operation-1',
      kind: 'kernel-test',
      idempotencyKey: 'one-action',
    });
    expect(pending.status).toBe('pending');
    const committed = settleOperation(db, pending.id, 'committed', { spendUsd: 0.25 });
    expect(committed).toMatchObject({ status: 'committed', spend_usd: 0.25 });
    expect(() => settleOperation(db, pending.id, 'failed')).toThrow(/already committed/);
    db.close();
  });

  it('marks unfinished journal rows interrupted on boot without inventing success', () => {
    const dbPath = path.join(root, 'journal.db');
    let db = createDb(dbPath);
    beginOperation(db, { id: 'pending-at-restart', kind: 'future-job' });
    beginOperation(db, { id: 'already-done', kind: 'future-job' });
    settleOperation(db, 'already-done', 'committed');
    db.close();

    db = createDb(dbPath);
    expect(db.prepare("SELECT status, error_code FROM operation_journal WHERE id='pending-at-restart'").get())
      .toMatchObject({ status: 'interrupted', error_code: 'process_restart' });
    expect(db.prepare("SELECT status FROM operation_journal WHERE id='already-done'").get().status).toBe('committed');
    db.close();
  });

  it('publishes truthful release capabilities only behind the auth boundary', async () => {
    const open = createTestApp();
    const response = await request(open.app).get('/api/capabilities').expect(200);
    expect(response.body).toMatchObject({
      release_train: '4.0.0-beta.1',
      database: { family: DATABASE_FAMILY, schema_version: DATABASE_SCHEMA_VERSION },
      archive: { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, status: 'scaffold' },
    });
    expect(response.body.features.find((feature) => feature.id === 'v4-kernel').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'manuscript-hierarchy').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'revisions-recovery').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'providers-vault').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'continuity-v2').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'writing-transactions').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'art-upload').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'grok-sanitization').status).toBe('available');
    expect(response.body.features.find((feature) => feature.id === 'adaptive-shell').status).toBe('available');
    open.close();

    const sealed = createTestApp({ authRequired: true });
    await request(sealed.app).get('/api/capabilities').expect(401);
    sealed.close();
  });
});
