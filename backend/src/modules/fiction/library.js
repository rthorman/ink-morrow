'use strict';

const fs = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { normalizeImage, normalizeImageFile } = require('../imagery/art-store');
const { keys, text, choice, fail } = require('./model');
const { KINDS, templateInput, snapshot, imagePrompt } = require('./library-model');

function createFictionLibrary({ db, media, store, providers, generateIllustration }) {
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const row = (id) => db.prepare('SELECT * FROM fiction_templates WHERE id = ? AND deleted = 0').get(id) || fail('Catalogue entry not found.', 'CATALOG_NOT_FOUND', 404);
  const generation = () => providers.exposure('illustrator', { data_categories: ['selected entry name and visible description', 'appearance or setting', 'art direction'], operation_count: 1 });
  const expose = (entry) => ({ id: entry.id, kind: entry.kind, name: entry.name, description: entry.description, data: JSON.parse(entry.data_json), revision: entry.revision,
    image_id: entry.image_id, image_alt: entry.image_alt, updated_at: entry.updated_at,
    pending: Boolean(db.prepare("SELECT id FROM fiction_template_requests WHERE template_id = ? AND status = 'pending'").get(entry.id)),
    spend: db.prepare('SELECT coalesce(sum(cost_usd), 0) AS known_usd, coalesce(sum(CASE WHEN cost_usd IS NULL THEN billed_attempts ELSE 0 END), 0) AS unknown_attempts FROM fiction_template_requests WHERE template_id = ?').get(entry.id) });
  const get = (id) => expose(row(id));
  const assertRevision = (entry, expected) => {
    if (!Number.isSafeInteger(expected) || expected < 0) fail('The current catalogue revision is required.');
    if (entry.revision !== expected) fail('This catalogue entry changed. Reopen it before continuing.', 'CATALOG_CHANGED', 409);
  };
  const assertIdle = (id) => {
    if (db.prepare("SELECT id FROM fiction_template_requests WHERE template_id = ? AND status = 'pending'").get(id)) fail('An image is already being painted for this entry.', 'CATALOG_BUSY', 409);
  };
  function list(kind, offset = 0) {
    choice(kind, KINDS, null, 'Catalogue kind');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) fail('Invalid catalogue page.');
    const entries = db.prepare('SELECT * FROM fiction_templates WHERE kind = ? AND deleted = 0 ORDER BY updated_at DESC, rowid DESC LIMIT 81 OFFSET ?').all(kind, offset);
    return { entries: entries.slice(0, 80).map(expose), next_offset: entries.length > 80 ? offset + 80 : null };
  }
  function create(kind, input) {
    const value = templateInput(kind, input); const id = randomUUID();
    db.prepare('INSERT INTO fiction_templates (id, kind, name, description, data_json) VALUES (?, ?, ?, ?, ?)').run(id, kind, value.name, value.description, JSON.stringify(value.data));
    return get(id);
  }
  function update(id, expected, input) {
    transaction(() => {
      const entry = row(id); assertRevision(entry, expected); assertIdle(id);
      const value = templateInput(entry.kind, input);
      db.prepare('UPDATE fiction_templates SET name = ?, description = ?, data_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value.name, value.description, JSON.stringify(value.data), id);
    });
    return get(id);
  }
  function remove(id, expected) {
    let assets;
    transaction(() => {
      const entry = row(id); assertRevision(entry, expected); assertIdle(id);
      assets = db.prepare('SELECT * FROM fiction_template_assets WHERE template_id = ?').all(id);
      // Keep the spend journal, but scrub reusable content. Story copies are independent.
      db.prepare("UPDATE fiction_templates SET deleted = 1, name = '', description = '', data_json = '{}', image_id = NULL, image_alt = '', revision = revision + 1 WHERE id = ?").run(id);
      db.prepare('DELETE FROM fiction_template_assets WHERE template_id = ?').run(id);
    });
    assets.forEach(media.discard);
  }
  function read(id, assetId) {
    row(id);
    const asset = db.prepare('SELECT * FROM fiction_template_assets WHERE id = ? AND template_id = ?').get(assetId, id);
    if (!asset) fail('Catalogue image not found.', 'IMAGE_NOT_FOUND', 404);
    const filename = media.assetPath(asset.storage_key);
    if (fs.statSync(filename).size !== asset.byte_size) fail('Image integrity check failed.', 'IMAGE_INTEGRITY_FAILED', 500);
    const buffer = fs.readFileSync(filename);
    if (createHash('sha256').update(buffer).digest('hex') !== asset.sha256) fail('Image integrity check failed.', 'IMAGE_INTEGRITY_FAILED', 500);
    return { ...asset, buffer };
  }
  function attach(id, expected, asset, alt, request = null, usage = {}) {
    let previous;
    transaction(() => {
      const entry = row(id); assertRevision(entry, expected);
      if (request) {
        if (!db.prepare("SELECT id FROM fiction_template_requests WHERE id = ? AND status = 'pending'").get(request.id)) fail('This painting is no longer active.', 'CATALOG_REQUEST_STALE', 409);
      } else assertIdle(id);
      previous = entry.image_id ? db.prepare('SELECT * FROM fiction_template_assets WHERE id = ? AND template_id = ?').get(entry.image_id, id) : null;
      if (asset) db.prepare('INSERT INTO fiction_template_assets (id, template_id, storage_key, media_type, sha256, byte_size, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(asset.id, id, asset.storage_key, asset.media_type, asset.sha256, asset.byte_size, asset.width, asset.height);
      db.prepare('UPDATE fiction_templates SET image_id = ?, image_alt = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(asset?.id || null, alt, id);
      if (previous) db.prepare('DELETE FROM fiction_template_assets WHERE id = ?').run(previous.id);
      if (request) db.prepare("UPDATE fiction_template_requests SET status = 'succeeded', cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(usage.costUsd, usage.billedAttempts, request.id);
    });
    media.discard(previous); return get(id);
  }
  async function upload(id, expected, upload, altText) {
    const alt = text(altText, 'Image description', 1000);
    assertRevision(row(id), expected); assertIdle(id);
    const normalized = await normalizeImageFile(upload.path, upload.mediaType);
    let asset;
    try { asset = media.persist(normalized); return attach(id, expected, asset, alt); }
    catch (error) { if (!asset || !db.prepare('SELECT id FROM fiction_template_assets WHERE id = ?').get(asset.id)) media.discard(asset); throw error; }
  }
  function removeImage(id, expected) { return attach(id, expected, null, ''); }
  function describeImage(id, expected, altText) {
    const alt = text(altText, 'Image description', 1000);
    transaction(() => {
      const entry = row(id); assertRevision(entry, expected); assertIdle(id);
      if (!entry.image_id) fail('This entry has no image.', 'IMAGE_NOT_FOUND', 404);
      db.prepare('UPDATE fiction_templates SET image_alt = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(alt, id);
    }); return get(id);
  }
  async function generate(id, expected, key, input) {
    keys(input, ['direction', 'alt_text', 'aspect_ratio', 'provider_id', 'model'], 'Paint catalogue image');
    const direction = text(input.direction, 'Art direction', 2000, { optional: true });
    const alt = text(input.alt_text, 'Image description', 1000);
    const ratio = choice(input.aspect_ratio, ['16:9', '4:3', '1:1', '3:4'], '1:1', 'Image shape');
    const model = text(input.model, 'Image model', 300); text(input.provider_id, 'Image provider', 80);
    key = text(key, 'Idempotency key', 200);
    const fingerprint = createHash('sha256').update(JSON.stringify({ expected, input })).digest('hex');
    const started = transaction(() => {
      const entry = row(id);
      const prior = db.prepare('SELECT * FROM fiction_template_requests WHERE template_id = ? AND idempotency_key = ?').get(id, key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('This request key belongs to another action.', 'IDEMPOTENCY_CONFLICT', 409);
        if (prior.status === 'pending') fail('This painting is still in progress.', 'CATALOG_BUSY', 409);
        if (prior.status !== 'succeeded') fail('That painting did not complete. A new explicit action is required.', prior.error_code || 'IMAGE_FAILED', 409);
        return { request: prior, reused: true };
      }
      assertRevision(entry, expected); assertIdle(id);
      const request = { id: randomUUID() };
      db.prepare("INSERT INTO fiction_template_requests (id, template_id, idempotency_key, fingerprint, expected_revision, status, model) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(request.id, id, key, fingerprint, expected, model);
      return { request, entry: expose(entry), reused: false };
    });
    if (started.reused) return { entry: get(id), reused: true, cost_usd: started.request.cost_usd, billed_attempts: started.request.billed_attempts };
    const request = started.request; let asset; const usage = { costUsd: null, billedAttempts: 0 };
    const assertCurrent = () => {
      assertRevision(row(id), expected);
      if (!db.prepare("SELECT id FROM fiction_template_requests WHERE id = ? AND status = 'pending'").get(request.id)) fail('This painting is no longer active.', 'CATALOG_REQUEST_STALE', 409);
      const selected = generation();
      if (selected.provider?.id !== input.provider_id || selected.model_id !== model) fail('The illustrator changed. Review the current provider before purchasing.', 'STORY_PROVIDER_CHANGED', 409);
      providers.resolve('illustrator', { capability: 'image' });
    };
    try {
      assertCurrent();
      db.prepare('UPDATE fiction_template_requests SET billed_attempts = 1 WHERE id = ?').run(request.id); usage.billedAttempts = 1;
      const result = await generateIllustration({ prompt: imagePrompt(started.entry, direction), aspectRatio: ratio, resolution: '1K', quality: 'low' });
      usage.costUsd = Number.isFinite(result.cost) && result.cost >= 0 ? result.cost : null;
      const normalized = await normalizeImage(result.buffer, result.mediaType);
      assertCurrent(); asset = media.persist(normalized);
      return { entry: attach(id, expected, asset, alt, request, usage), reused: false, cost_usd: usage.costUsd, billed_attempts: usage.billedAttempts };
    } catch (error) {
      if (!asset || !db.prepare('SELECT id FROM fiction_template_assets WHERE id = ?').get(asset.id)) media.discard(asset);
      if (Number.isInteger(error.billedAttempts) && error.billedAttempts >= 0) usage.billedAttempts = error.billedAttempts;
      if (Number.isFinite(error.costUsd) && error.costUsd >= 0) usage.costUsd = error.costUsd;
      // A late reply may settle cost after boot reconciliation; it cannot attach art.
      db.prepare("UPDATE fiction_template_requests SET status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END, error_code = coalesce(error_code, ?), cost_usd = ?, billed_attempts = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'succeeded'")
        .run(error.code || 'IMAGE_FAILED', usage.costUsd, usage.billedAttempts, request.id);
      error.costUsd = usage.costUsd; error.billedAttempts = usage.billedAttempts; throw error;
    }
  }
  function createStory(input, selection) {
    keys(selection, ['world_id', 'scribe_id', 'character_ids'], 'Catalogue selection');
    const ids = selection.character_ids === undefined ? [] : selection.character_ids;
    if (!Array.isArray(ids) || ids.length > 24 || new Set(ids).size !== ids.length) fail('Choose at most 24 different catalogue characters.');
    if (input.cast !== undefined && !Array.isArray(input.cast)) fail('Cast must be a list.');
    const selected = (id, kind) => {
      if (id === null || id === undefined || id === '') return null;
      const entry = get(text(id, 'Catalogue ID', 80));
      if (entry.kind !== kind) fail('The selected catalogue entry has the wrong kind.');
      return entry;
    };
    const world = selected(selection.world_id, 'world'); const scribe = selected(selection.scribe_id, 'scribe');
    const characters = ids.map((id) => selected(id, 'character'));
    if (characters.some((entry) => !entry)) fail('Choose valid catalogue characters.');
    const library = { world: world && snapshot(world), scribe: scribe && snapshot(scribe), characters: characters.map((entry) => ({ character_id: entry.id, snapshot: snapshot(entry) })) };
    const assets = []; const visuals = [];
    try {
      for (const entry of [world, scribe, ...characters].filter(Boolean)) {
        if (!entry.image_id) continue;
        const source = read(entry.id, entry.image_id);
        const asset = media.persist({ buffer: source.buffer, mediaType: source.media_type, width: source.width, height: source.height });
        assets.push(asset); visuals.push({ kind: entry.kind, subject_id: entry.kind === 'character' ? entry.id : null, asset_id: asset.id, alt_text: entry.image_alt });
      }
      return store.create({ ...input, cast: [...(input.cast || []), ...characters.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, motive: entry.data.motive }))] }, { library, visuals, assets });
    } catch (error) { assets.filter((asset) => !db.prepare('SELECT id FROM fiction_assets WHERE id = ?').get(asset.id)).forEach(media.discard); throw error; }
  }
  function reconcile() { return db.prepare("UPDATE fiction_template_requests SET status = 'interrupted', error_code = 'IMAGE_INTERRUPTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'pending'").run().changes; }
  const spend = () => db.prepare('SELECT coalesce(sum(cost_usd), 0) AS known_usd, coalesce(sum(CASE WHEN cost_usd IS NULL THEN billed_attempts ELSE 0 END), 0) AS unknown_attempts FROM fiction_template_requests').get();
  return { get, list, create, update, remove, read, upload, generate, removeImage, describeImage, generation, createStory, reconcile, spend };
}

module.exports = { createFictionLibrary };
