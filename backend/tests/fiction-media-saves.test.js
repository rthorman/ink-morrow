'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync, gunzipSync } = require('node:zlib');
const sharp = require('sharp');
const request = require('supertest');
const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionMedia } = require('../src/modules/fiction/media');
const { createFictionPublication } = require('../src/modules/fiction/publication');
const { createFictionSaves, validateSave, SAVE_MIME, MAX_PACKED, MAX_EXPANDED } = require('../src/modules/fiction/saves');
const { storedZipEntries, validateEpub, rereadPublication } = require('../src/modules/publication/adapters');
const { createTestApp, setupOwner } = require('./helpers');

describe('5.0 illustrated paths, books and playable saves', () => {
  let directory; let db; let store; let media; let saves; let publication; let story; let png; let generate; let providers;
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkmorrow-fiction-media-'));
    db = createDb(':memory:'); store = createFictionStore(db);
    png = await sharp({ create: { width: 20, height: 16, channels: 3, background: '#634064' } }).png().toBuffer();
    generate = jest.fn().mockResolvedValue({ buffer: png, mediaType: 'image/png', cost: 0.03 });
    providers = { exposure: () => ({ provider: { id: 'image-profile' }, model_id: 'image-model' }), resolve: jest.fn() };
    media = createFictionMedia({ db, store, rootDir: directory, generateIllustration: generate, providers });
    saves = createFictionSaves({ db, store, media }); publication = createFictionPublication({ store, media });
    story = store.create({ scenario_id: 'drowned-bell' });
  });
  afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const imageInput = (story) => ({ beat_id: story.beats[0].id, direction: 'A gentle watercolor.', alt_text: 'Two sisters on a quay.', provider_id: 'image-profile', model: 'image-model' });
  async function upload(target = story) {
    const file = path.join(directory, 'source.png'); fs.writeFileSync(file, png);
    return media.upload(target.id, target.revision, { path: file, mediaType: 'image/png' }, { beat_id: target.beats[0].id, alt_text: 'Two sisters on a quay.' });
  }
  async function scene(prose = 'Iona carries tea to the quay.') {
    const completion = jest.fn().mockResolvedValue({ content: JSON.stringify({ prose, summary: 'A shared pause.', effects: [] }), cost_usd: 0.01, billed_attempts: 1, model: 'test' });
    const service = createFictionService({ store, chatCompletion: completion });
    story = (await service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: `scene-${story.revision}`, input: { kind: 'follow' } })).story;
  }
  test('upload normalizes locally, belongs to one story and follows branch snapshots', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    story = await upload(); const placed = story.state.illustrations[0];
    expect(generate).not.toHaveBeenCalled();
    expect(media.read(story.id, placed.asset_id).media_type).toBe('image/webp');
    expect(story.spend).toEqual({ known_usd: 0, unknown_attempts: 0 });
    expect(() => media.read('another-story', placed.asset_id)).toThrow('not found');
    story = store.fork(story.id, story.revision, { name: 'Without the picture', beat_id: opening });
    expect(story.state.illustrations).toEqual([]);
    story = store.selectBranch(story.id, story.revision, original); expect(story.state.illustrations).toEqual([placed]);
    story = store.removeIllustration(story.id, story.revision, opening); expect(story.state.illustrations).toEqual([]);
    expect(media.read(story.id, placed.asset_id).buffer.length).toBeGreaterThan(0);
  });
  test('image description corrections are local, branch-safe and do not purchase another image', async () => {
    story = await upload(); const placed = story.state.illustrations[0]; const before = story.head_beat_id;
    story = store.describeIllustration(story.id, story.revision, { beat_id: placed.beat_id, alt_text: 'A corrected description.' });
    expect(story.state.illustrations[0]).toEqual({ ...placed, alt_text: 'A corrected description.' });
    story = store.fork(story.id, story.revision, { name: 'Earlier description', beat_id: before });
    expect(story.state.illustrations[0]).toEqual(placed); expect(generate).not.toHaveBeenCalled();
  });
  test('book export rejects a changed path instead of downloading a different reading', () => {
    expect(() => publication.document(story.id, { expected_revision: String(story.revision + 1), branch_id: story.active_branch_id })).toThrow('path changed');
    expect(() => publication.document(story.id, { expected_revision: String(story.revision), branch_id: 'other' })).toThrow('path changed');
  });
  test('unsafe uploads and stale placement never leave an asset behind', async () => {
    const file = path.join(directory, 'source.svg'); fs.writeFileSync(file, '<svg onload="alert(1)"/>');
    await expect(media.upload(story.id, story.revision, { path: file, mediaType: 'image/svg+xml' }, { beat_id: story.head_beat_id, alt_text: 'Unsafe' })).rejects.toThrow();
    const old = story; story = store.preferences(story.id, story.revision, { voice: 'Warm.' });
    await expect(upload(old)).rejects.toThrow('changed');
    expect(db.prepare('SELECT count(*) AS n FROM fiction_assets').get().n).toBe(0);
    expect(fs.readdirSync(media.directory)).toEqual([]);
  });
  test('AI image uses one reviewed provider and only the selected passage, and replays for free after a branch change', async () => {
    const input = imageInput(story); const revision = story.revision;
    const result = await media.generate(story.id, revision, 'paint', input); story = result.story;
    expect(generate).toHaveBeenCalledTimes(1); expect(result.cost_usd).toBe(0.03);
    const sent = JSON.stringify(generate.mock.calls[0][0]);
    expect(sent).toContain(story.beats[0].prose.slice(0, 40));
    expect(sent).not.toContain('survey crew'); expect(sent).not.toContain('inputReferences');
    story = store.fork(story.id, story.revision, { name: 'Fresh start', beat_id: null });
    expect((await media.generate(story.id, revision, 'paint', input)).reused).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(story.state.illustrations).toHaveLength(0);
  });
  test('changed provider and invalid targets fail before any image purchase', async () => {
    await expect(media.generate(story.id, story.revision, 'changed', { ...imageInput(story), model: 'changed-model' })).rejects.toMatchObject({ code: 'STORY_PROVIDER_CHANGED', billedAttempts: 0 });
    await expect(media.generate(story.id, story.revision, 'bad-target', { ...imageInput(story), beat_id: 'missing' })).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled(); expect(store.view(story.id).pending).toBe(false);
  });
  test('image failure is visible, charged honestly and never retried', async () => {
    generate.mockRejectedValue(new Error('Connection lost.'));
    await expect(media.generate(story.id, story.revision, 'lost', imageInput(story))).rejects.toMatchObject({ billedAttempts: 1, costUsd: null });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.view(story.id).spend.unknown_attempts).toBe(1);
    expect(store.view(story.id).state.illustrations).toEqual([]);
  });
  test('known image cost survives a rejected provider result', async () => {
    generate.mockResolvedValue({ buffer: Buffer.from('not an image'), mediaType: 'image/png', cost: 0.07 });
    await expect(media.generate(story.id, story.revision, 'bad-image', imageInput(story))).rejects.toMatchObject({ billedAttempts: 1, costUsd: 0.07 });
    expect(store.view(story.id).spend.known_usd).toBe(0.07);
    expect(store.view(story.id).pending).toBe(false);
  });
  test('EPUB gives each image its own spine page immediately before the associated prose', async () => {
    story = await upload(); await scene();
    const document = publication.document(story.id);
    expect(document.volumes[0].chapters[0].pages[0].blocks[0].type).toBe('art');
    const exported = await publication.export(story.id, 'epub');
    expect(validateEpub(exported.buffer)).toEqual({ valid: true, errors: [] });
    const entries = storedZipEntries(exported.buffer); const opf = entries.get('EPUB/package.opf').toString();
    expect(opf).toContain('<itemref idref="image-2" properties="rendition:layout-pre-paginated rendition:spread-none"/><itemref idref="text-3"/>');
    const imagePage = entries.get('EPUB/image-2.xhtml').toString(); const textPage = entries.get('EPUB/text-3.xhtml').toString();
    expect(imagePage).toContain('width=1200,height=1600'); expect(imagePage).toContain('<img');
    expect(imagePage).not.toContain(story.beats[0].prose); expect(textPage).not.toContain('<img');
    expect(textPage).toContain(story.beats[0].prose.slice(0, 40));
    expect(entries.has('EPUB/images/asset-1.png')).toBe(true);
    const sequence = rereadPublication('epub', exported.buffer);
    expect(sequence.findIndex((text) => text.startsWith('[Illustration:'))).toBeLessThan(sequence.findIndex((text) => text.includes(story.beats[0].prose.slice(0, 40))));
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('survey crew'); expect(serialized).not.toContain('scene_history'); expect(serialized).not.toContain('motive');
    const html = (await publication.export(story.id, 'html')).buffer.toString();
    expect(html.indexOf('<figure>')).toBeLessThan(html.indexOf(story.beats[0].prose.slice(0, 40)));
  });
  test('book export fails honestly when a placed file is missing', async () => {
    story = await upload(); const image = media.read(story.id, story.state.illustrations[0].asset_id); fs.unlinkSync(media.assetPath(image.storage_key));
    expect(() => publication.document(story.id)).toThrow();
  });
  test('complete saves round-trip all paths, state, director history, images and known/unknown spend', async () => {
    const opening = story.head_beat_id;
    story = await upload(); await scene();
    story = store.control(story.id, story.revision, 'mara');
    story = store.correct(story.id, story.revision, { fact: { id: 'promise', text: 'Mara will return.', kind: 'commitment', actor_id: 'mara' }, reason: 'PRIVATE correction note' });
    story = store.episode(story.id, story.revision, { action: 'end', summary: 'They can rest.' });
    story = store.fork(story.id, story.revision, { name: 'The other decision', beat_id: opening });
    const pending = store.beginRequest(story.id, story.revision, 'interrupted', {}); store.dispatchRequest(pending.request.id, 'test'); store.reconcile();
    const original = store.current(story.id).state;
    const buffer = await saves.exportSave(story.id); const raw = gunzipSync(buffer).toString();
    expect(raw).toContain('PRIVATE correction note'); expect(raw).toContain('motive');
    expect(raw).not.toContain('idempotency_key'); expect(raw).not.toContain('storage_key'); expect(raw).not.toContain('credential');
    expect((await saves.preview(buffer)).paths).toBe(2);
    const copy = await saves.importSave(buffer);
    expect(copy.id).not.toBe(story.id); expect(copy.pending).toBe(false); expect(copy.branches).toHaveLength(2);
    expect(copy.spend).toEqual(store.view(story.id).spend); expect(copy.spend).toEqual({ known_usd: 0.01, unknown_attempts: 1 });
    expect(store.current(copy.id).state).toEqual(original);
    const full = store.selectBranch(copy.id, copy.revision, copy.branches.find((branch) => branch.name === 'Original path').id);
    expect(full.state.control.character_id).toBe('mara'); expect(full.state.episode.status).toBe('ended');
    const privateState = store.current(copy.id).state;
    expect(privateState.scene_history).toHaveLength(1); expect(privateState.facts.find((item) => item.id === 'promise').evidence_beat_id).not.toBeNull();
    expect(full.state.illustrations).toHaveLength(1); expect(media.read(copy.id, full.state.illustrations[0].asset_id).buffer.length).toBeGreaterThan(0);
    expect(() => validateSave(JSON.parse(gunzipSync(buffer)))).not.toThrow();
    expect((await saves.preview(await saves.exportSave(copy.id))).moments).toBeGreaterThan(3);
    story = store.episode(copy.id, full.revision, { action: 'start', title: 'The next visit' });
    await scene('Iona sets a fresh cup on the table.');
    expect(story.beats.at(-1).prose).toBe('Iona sets a fresh cup on the table.');
  });
  test('cross-path evidence is refused even when the referenced moment exists', async () => {
    const opening = story.head_beat_id; await scene(); const otherHead = story.head_beat_id;
    story = store.fork(story.id, story.revision, { name: 'Different afternoon', beat_id: opening }); await scene('Iona waits in the garden.');
    const value = JSON.parse(gunzipSync(await saves.exportSave(story.id)));
    value.beats.find((beat) => beat.id === story.head_beat_id).state.facts[0].evidence_beat_id = otherHead;
    await expect(saves.importSave(gzipSync(JSON.stringify(value)))).rejects.toThrow('another path');
    expect(store.list()).toHaveLength(1);
  });
  test('compressed and expanded size ceilings reject oversized imports before writes', async () => {
    await expect(saves.preview(Buffer.alloc(MAX_PACKED + 1))).rejects.toMatchObject({ code: 'SAVE_TOO_LARGE' });
    const bomb = gzipSync(Buffer.alloc(MAX_EXPANDED + 1, 32));
    await expect(saves.importSave(bomb)).rejects.toThrow('expanded limit');
    expect(store.list()).toHaveLength(1);
  });
  test.each(['cycle', 'dangling', 'foreign-fact', 'duplicate', 'version', 'private-field', 'missing-state'])('rejects %s saves before writing', async (fault) => {
    const value = JSON.parse(gunzipSync(await saves.exportSave(story.id)));
    if (fault === 'cycle') value.beats[0].parent_id = value.beats[0].id;
    if (fault === 'dangling') value.branches[0].head_beat_id = 'missing';
    if (fault === 'foreign-fact') value.beats[0].state.facts[0].evidence_beat_id = 'foreign';
    if (fault === 'duplicate') value.beats.push(value.beats[0]);
    if (fault === 'version') value.version = 9;
    if (fault === 'private-field') value.api_key = 'must-not-import';
    if (fault === 'missing-state') delete value.beats[0].state.focus;
    await expect(saves.importSave(gzipSync(JSON.stringify(value)))).rejects.toThrow();
    expect(store.list()).toHaveLength(1); expect(db.prepare('SELECT count(*) AS n FROM fiction_assets').get().n).toBe(0);
  });
  test('pending requests cannot be exported and corrupt image digests cannot be imported', async () => {
    story = await upload(); const value = JSON.parse(gunzipSync(await saves.exportSave(story.id)));
    value.assets[0].sha256 = '0'.repeat(64);
    await expect(saves.importSave(gzipSync(JSON.stringify(value)))).rejects.toThrow('integrity');
    store.beginRequest(story.id, story.revision, 'pending', {});
    await expect(saves.exportSave(story.id)).rejects.toMatchObject({ code: 'STORY_BUSY' });
    expect(store.list()).toHaveLength(1);
  });
  test('failed database import rolls back the graph and cleans only its newly staged image', async () => {
    story = await upload(); const buffer = await saves.exportSave(story.id); const files = fs.readdirSync(media.directory);
    db.exec("CREATE TRIGGER refuse_import BEFORE INSERT ON fiction_beats BEGIN SELECT RAISE(ABORT, 'test import failure'); END;");
    await expect(saves.importSave(buffer)).rejects.toThrow('test import failure');
    expect(store.list()).toHaveLength(1); expect(fs.readdirSync(media.directory)).toEqual(files);
    expect(media.read(story.id, story.state.illustrations[0].asset_id).buffer.length).toBeGreaterThan(0);
  });
});

describe('fiction media and save HTTP boundary', () => {
  let fixture; let directory;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkmorrow-media-api-')); fixture = createTestApp({ authRequired: true, imageDir: directory }); });
  afterEach(() => { fixture.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  test('upload, save preflight/import and image reads stay behind auth and CSRF before parsing', async () => {
    expect((await request(fixture.app).post('/api/fiction/saves/import').set('Content-Type', SAVE_MIME).send(Buffer.from('bad'))).status).toBe(401);
    expect((await request(fixture.app).get('/api/fiction/private/images/private')).status).toBe(401);
    const agent = request.agent(fixture.app); const owner = await setupOwner(agent, fixture.app);
    expect((await agent.post('/api/fiction/saves/preview').set('Content-Type', SAVE_MIME).send(Buffer.from('bad'))).status).toBe(403);
    const created = await agent.post('/api/fiction').set('X-InkMorrow-CSRF', owner.csrf_token).send({ scenario_id: 'garden-after-rain' });
    const story = created.body.story;
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } }).png().toBuffer();
    const uploaded = await agent.post(`/api/fiction/${story.id}/images/upload`).set('X-InkMorrow-CSRF', owner.csrf_token)
      .field('expected_revision', story.revision).field('beat_id', story.head_beat_id).field('alt_text', 'A garden.').attach('image', png, 'garden.png');
    expect(uploaded.status).toBe(201);
    const asset = uploaded.body.story.state.illustrations[0];
    expect((await agent.get(`/api/fiction/${story.id}/images/${asset.asset_id}`)).headers['content-type']).toContain('image/webp');
    expect((await agent.get(`/api/fiction/${story.id}/book/epub`)).status).toBe(200);
    expect((await agent.post('/api/fiction/saves/import').set('X-InkMorrow-CSRF', owner.csrf_token).set('Content-Type', SAVE_MIME).send(Buffer.from('bad'))).status).toBe(400);
  });
});
