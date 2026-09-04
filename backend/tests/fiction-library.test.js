'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync, gzipSync } = require('node:zlib');
const sharp = require('sharp');
const request = require('supertest');
const { createDb, MIGRATIONS, schemaIdentity } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionMedia } = require('../src/modules/fiction/media');
const { createFictionLibrary } = require('../src/modules/fiction/library');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionSaves } = require('../src/modules/fiction/saves');
const { createFictionPublication } = require('../src/modules/fiction/publication');
const { storedZipEntries, validateEpub } = require('../src/modules/publication/adapters');
const { createTestApp, setupOwner } = require('./helpers');

describe('frozen visual catalogues', () => {
  let root; let db; let store; let media; let library; let generate; let providers; let png; let file;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-visual-library-')); db = createDb(':memory:'); store = createFictionStore(db);
    png = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#674064' } }).png().toBuffer();
    file = path.join(root, 'upload.png'); fs.writeFileSync(file, png);
    generate = jest.fn().mockResolvedValue({ buffer: png, mediaType: 'image/png', cost: 0.04 });
    providers = { exposure: jest.fn(() => ({ provider: { id: 'illustrator', display_name: 'Test images' }, model_id: 'image-model' })), resolve: jest.fn() };
    media = createFictionMedia({ db, store, rootDir: root, providers, generateIllustration: generate });
    library = createFictionLibrary({ db, store, media, providers, generateIllustration: generate });
  });
  afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const input = () => ({ direction: 'Watercolour', alt_text: 'A quiet place.', provider_id: 'illustrator', model: 'image-model' });
  const make = (kind) => library.create(kind, { name: `${kind} reference`, description: 'Visible detail.', data: kind === 'world' ? { setting: 'A harbour.', lore: 'PRIVATE world truth' } : kind === 'character' ? { appearance: 'Silver coat', personality: 'Patient', background: 'PRIVATE history', motive: 'PRIVATE ambition' } : { appearance: 'Silver ears', diction: 'ornate' } });
  const upload = (entry) => library.upload(entry.id, entry.revision, { path: file, mediaType: 'image/png' }, `${entry.kind} picture`);
  test.each(['world', 'character', 'scribe'])('%s CRUD and upload are local, revision-bound and image-owned', async (kind) => {
    let entry = make(kind); expect(entry.pending).toBe(false);
    entry = library.update(entry.id, entry.revision, { name: 'Renamed', description: entry.description, data: entry.data });
    await expect(upload({ ...entry, revision: 0 })).rejects.toMatchObject({ code: 'CATALOG_CHANGED' });
    entry = await upload(entry); const old = library.read(entry.id, entry.image_id);
    expect(old.media_type).toBe('image/webp'); expect(old.buffer.length).toBeGreaterThan(0);
    const other = make(kind); expect(() => library.read(other.id, entry.image_id)).toThrow('not found');
    entry = library.describeImage(entry.id, entry.revision, 'Revised description'); expect(entry.image_alt).toBe('Revised description');
    entry = await upload(entry); expect(fs.existsSync(media.assetPath(old.storage_key))).toBe(false);
    entry = library.removeImage(entry.id, entry.revision); expect(entry.image_id).toBeNull();
    library.remove(entry.id, entry.revision); expect(() => library.get(entry.id)).toThrow('not found');
    expect(library.list(kind).entries).toHaveLength(1); expect(generate).not.toHaveBeenCalled(); expect(library.spend()).toEqual({ known_usd: 0, unknown_attempts: 0 });
  });
  test.each(['world', 'character', 'scribe'])('%s painting buys one safe image and idempotent replay buys nothing', async (kind) => {
    const entry = make(kind); const result = await library.generate(entry.id, entry.revision, 'paint-once', input());
    expect(result.entry.image_id).toBeTruthy(); expect(generate).toHaveBeenCalledTimes(1);
    const prompt = generate.mock.calls[0][0].prompt; expect(prompt).toContain('Visible detail'); expect(prompt).not.toContain('PRIVATE');
    if (kind === 'scribe') expect(prompt).toContain('adult human woman');
    expect((await library.generate(entry.id, entry.revision, 'paint-once', input())).reused).toBe(true); expect(generate).toHaveBeenCalledTimes(1);
    await expect(library.generate(entry.id, entry.revision, 'paint-once', { ...input(), direction: 'Different' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    library.remove(entry.id, result.entry.revision); expect(library.spend().known_usd).toBe(0.04);
    expect(db.prepare('SELECT name, description, data_json FROM fiction_templates WHERE id = ?').get(entry.id)).toEqual({ name: '', description: '', data_json: '{}' });
  });
  test('pending work blocks edits and duplicate purchases; interrupted late results preserve spend, not art', async () => {
    const entry = make('world'); let finish;
    generate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = library.generate(entry.id, entry.revision, 'slow', input());
    expect(library.get(entry.id).pending).toBe(true); expect(() => library.remove(entry.id, entry.revision)).toThrow('already being painted');
    expect(() => library.update(entry.id, entry.revision, { name: 'Changed' })).toThrow('already being painted');
    await expect(library.generate(entry.id, entry.revision, 'another', input())).rejects.toMatchObject({ code: 'CATALOG_BUSY' });
    library.reconcile(); finish({ buffer: png, mediaType: 'image/png', cost: 0.07 });
    await expect(pending).rejects.toMatchObject({ code: 'CATALOG_REQUEST_STALE', costUsd: 0.07, billedAttempts: 1 });
    expect(library.get(entry.id).image_id).toBeNull(); expect(library.spend()).toEqual({ known_usd: 0.07, unknown_attempts: 0 });
    expect(fs.readdirSync(media.directory)).toEqual([]); expect(generate).toHaveBeenCalledTimes(1);
  });
  test('a provider change before dispatch is free; late changes and invalid images keep known cost', async () => {
    const entry = make('character');
    await expect(library.generate(entry.id, 0, 'wrong-provider', { ...input(), model: 'wrong' })).rejects.toMatchObject({ billedAttempts: 0 }); expect(generate).not.toHaveBeenCalled();
    generate.mockResolvedValueOnce({ buffer: Buffer.from('invalid'), mediaType: 'image/png', cost: 0.09 });
    await expect(library.generate(entry.id, 0, 'invalid-art', input())).rejects.toMatchObject({ costUsd: 0.09, billedAttempts: 1 });
    generate.mockImplementationOnce(async () => { providers.exposure.mockReturnValue({ provider: { id: 'changed' }, model_id: 'image-model' }); return { buffer: png, mediaType: 'image/png', cost: 0.03 }; });
    await expect(library.generate(entry.id, 0, 'changed-during-paint', input())).rejects.toMatchObject({ code: 'STORY_PROVIDER_CHANGED', costUsd: 0.03 });
    expect(library.spend().known_usd).toBeCloseTo(0.12); expect(library.get(entry.id).image_id).toBeNull();
  });
  test('unknown transport failure and unsafe upload retain the old image without retries', async () => {
    const entry = await upload(make('scribe'));
    generate.mockRejectedValue(new Error('Connection lost'));
    await expect(library.generate(entry.id, entry.revision, 'lost', input())).rejects.toMatchObject({ billedAttempts: 1, costUsd: null });
    expect(library.spend().unknown_attempts).toBe(1); expect(library.get(entry.id).image_id).toBe(entry.image_id);
    fs.writeFileSync(file, '<svg onload="alert(1)"/>'); await expect(upload(entry)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  test('setup copies all images and private references atomically; later catalogue changes cannot alter the story', async () => {
    const world = await upload(make('world')); const character = await upload(make('character')); const scribe = await upload(make('scribe'));
    const story = library.createStory({ scenario_id: 'garden-after-rain' }, { world_id: world.id, scribe_id: scribe.id, character_ids: [character.id] });
    expect(story.state.visuals).toHaveLength(3); expect(story.state.cast.some((person) => person.id === character.id)).toBe(true);
    expect(JSON.stringify(story)).not.toContain('PRIVATE');
    const original = store.current(story.id).state;
    const service = createFictionService({ store, chatCompletion: jest.fn() });
    const context = JSON.stringify(service.buildMessages(store.current(story.id), { kind: 'follow', text: '' }));
    expect(context).toContain('PRIVATE world truth'); expect(context).toContain('PRIVATE history'); expect(context).toContain('ornate');
    for (const entry of [world, character, scribe]) {
      const copy = story.state.visuals.find((item) => item.kind === entry.kind);
      expect(copy.asset_id).not.toBe(entry.image_id); expect(media.read(story.id, copy.asset_id).buffer).toEqual(library.read(entry.id, entry.image_id).buffer);
      library.remove(entry.id, entry.revision); expect(media.read(story.id, copy.asset_id).buffer.length).toBeGreaterThan(0);
    }
    expect(store.current(story.id).state).toEqual(original); expect(generate).not.toHaveBeenCalled();
  });
  test('failed story creation cleans only new copies and validates selected kinds and cast', async () => {
    const entry = await upload(make('world')); const files = fs.readdirSync(media.directory);
    expect(() => library.createStory({ title: '', premise: 'No title' }, { world_id: entry.id })).toThrow();
    expect(fs.readdirSync(media.directory)).toEqual(files); expect(store.list()).toHaveLength(0);
    expect(() => library.createStory({ scenario_id: 'garden-after-rain' }, { character_ids: [entry.id] })).toThrow('wrong kind');
    expect(() => library.createStory({ scenario_id: 'garden-after-rain', cast: {} }, {})).toThrow('list');
    expect(() => library.create('world', { name: 'Bad', data: null })).toThrow();
  });
  test('cover and all reference image surfaces support upload/generation, branch history and portable copies', async () => {
    const world = make('world'); const character = make('character'); const scribe = make('scribe');
    let story = library.createStory({ scenario_id: 'garden-after-rain' }, { world_id: world.id, scribe_id: scribe.id, character_ids: [character.id] });
    const opening = story.head_beat_id; const branch = story.active_branch_id;
    for (const kind of ['cover', 'world', 'character', 'scribe']) {
      const target = { kind, ...(kind === 'character' ? { subject_id: character.id } : {}) };
      story = await media.upload(story.id, story.revision, { path: file, mediaType: 'image/png' }, { ...target, alt_text: `${kind} uploaded` });
      story = (await media.generate(story.id, story.revision, `story-${kind}`, { ...input(), ...target, alt_text: `${kind} painted` })).story;
    }
    expect(generate).toHaveBeenCalledTimes(4); expect(JSON.stringify(generate.mock.calls)).not.toContain('PRIVATE');
    expect(story.state.visuals).toHaveLength(4); expect(store.list()[0].cover.alt_text).toBe('cover painted');
    const saves = createFictionSaves({ db, store, media }); const buffer = await saves.exportSave(story.id);
    const copy = await saves.importSave(buffer); expect(copy.state.visuals).toHaveLength(4);
    for (const item of copy.state.visuals) expect(story.state.visuals.some((old) => old.asset_id === item.asset_id)).toBe(false);
    expect(store.current(copy.id).state.library).toEqual(store.current(story.id).state.library);
    const publication = createFictionPublication({ store, media }); const doc = publication.document(story.id);
    expect(doc.front_matter[0].blocks[0].type).toBe('art'); expect(doc.assets).toHaveLength(1); expect(JSON.stringify(doc)).not.toContain('PRIVATE');
    const epub = await publication.export(story.id, 'epub'); expect(validateEpub(epub.buffer).valid).toBe(true);
    const entries = storedZipEntries(epub.buffer); const imagePage = [...entries].find(([name]) => /image-\d+\.xhtml/.test(name))[1].toString();
    expect(entries.get('EPUB/package.opf').toString()).toContain('properties="cover-image"');
    expect(imagePage).toContain('cover painted'); expect(imagePage).not.toContain(story.beats[0].prose);
    story = store.fork(story.id, story.revision, { name: 'Before images', beat_id: opening }); expect(story.state.visuals).toEqual([]);
    story = store.selectBranch(story.id, story.revision, branch); expect(story.state.visuals).toHaveLength(4);
    story = store.editVisual(story.id, story.revision, { kind: 'cover', alt_text: 'New cover description' }); expect(store.list().find((row) => row.id === story.id).cover.alt_text).toBe('New cover description');
    story = store.editVisual(story.id, story.revision, { kind: 'cover' }, true); expect(story.state.visuals).toHaveLength(3);
    const invalid = JSON.parse(gunzipSync(buffer)); invalid.beats.at(-1).state.visuals[0].asset_id = 'missing';
    await expect(saves.importSave(gzipSync(JSON.stringify(invalid)))).rejects.toThrow('dangling');
    const incomplete = JSON.parse(gunzipSync(buffer)); delete incomplete.game.initial_state.library.world.data;
    await expect(saves.importSave(gzipSync(JSON.stringify(incomplete)))).rejects.toThrow('Incomplete');
    const nullText = JSON.parse(gunzipSync(buffer)); nullText.game.initial_state.library.characters[0].snapshot.data.appearance = null;
    await expect(saves.importSave(gzipSync(JSON.stringify(nullText)))).rejects.toThrow('must be a string');
    const incompleteVisual = JSON.parse(gunzipSync(buffer)); delete incompleteVisual.beats.at(-1).state.visuals[0].subject_id;
    await expect(saves.importSave(gzipSync(JSON.stringify(incompleteVisual)))).rejects.toThrow('Incomplete story image');
  });
  test('a late story-image result after reconciliation settles spend without attaching', async () => {
    const story = store.create({ scenario_id: 'garden-after-rain' }); let finish;
    generate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = media.generate(story.id, story.revision, 'late-cover', { ...input(), kind: 'cover' });
    store.reconcile(); finish({ buffer: png, mediaType: 'image/png', cost: 0.06 });
    await expect(pending).rejects.toMatchObject({ code: 'STORY_REQUEST_STALE', costUsd: 0.06 });
    expect(store.view(story.id).spend.known_usd).toBe(0.06); expect(store.view(story.id).state.visuals).toEqual([]);
  });
  test('migration 22 preserves existing 5.0 stories and all earlier migration checksums', () => {
    const filename = path.join(root, 'schema21.db'); let old = createDb(filename, { migrations: MIGRATIONS.slice(0, 21) });
    const prior = createFictionStore(old).create({ scenario_id: 'garden-after-rain' });
    const ledger = old.prepare('SELECT * FROM schema_migrations ORDER BY version').all(); old.close(); old = createDb(filename);
    expect(schemaIdentity(old).version).toBe(22); expect(createFictionStore(old).view(prior.id).title).toBe(prior.title);
    expect(old.prepare('SELECT * FROM schema_migrations WHERE version <= 21 ORDER BY version').all()).toEqual(ledger); old.close();
  });
});

describe('visual catalogue production boundary', () => {
  let fixture;
  afterEach(() => fixture?.close());
  test('auth and CSRF guard new catalogues, uploads and selection while retired routes stay retired', async () => {
    fixture = createTestApp({ authRequired: true, legacyEnabled: false });
    expect((await request(fixture.app).get('/api/fiction/catalog/metadata')).status).toBe(401);
    const agent = request.agent(fixture.app); const owner = await setupOwner(agent, fixture.app);
    expect((await agent.post('/api/fiction/catalog').send({ kind: 'world', entry: { name: 'Local world' } })).status).toBe(403);
    for (const endpoint of ['worlds', 'characters', 'scribes']) expect((await agent.get(`/api/${endpoint}`)).status).toBe(404);
    const created = await agent.post('/api/fiction/catalog').set('X-InkMorrow-CSRF', owner.csrf_token).send({ kind: 'world', entry: { name: 'Local world', data: { lore: 'PRIVATE lore' } } });
    expect(created.status).toBe(201); const entry = created.body.entry;
    expect((await agent.get('/api/fiction/catalog?kind=world')).body.entries).toHaveLength(1);
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } }).png().toBuffer();
    const uploaded = await agent.post(`/api/fiction/catalog/${entry.id}/images/upload`).set('X-InkMorrow-CSRF', owner.csrf_token).field('expected_revision', 0).field('alt_text', 'A world').attach('image', png, 'world.png');
    expect(uploaded.status).toBe(201);
    const started = await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ scenario_id: 'garden-after-rain', library: { world_id: entry.id } });
    expect(started.status).toBe(201); expect(started.body.story.state.visuals).toHaveLength(1); expect(JSON.stringify(started.body)).not.toContain('PRIVATE lore');
    expect((await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ title: 'Manual', premise: 'No', opening: 'Forbidden', library: {} })).status).toBe(400);
  });
});
