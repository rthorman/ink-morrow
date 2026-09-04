'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { normalizeImage, normalizeImageFile } = require('../imagery/art-store');
const { keys, text, fail } = require('./model');

function createFictionMedia({ db, store, rootDir, generateIllustration, providers }) {
  const directory = path.join(rootDir, 'fiction');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const assetPath = (key) => {
    if (!/^[a-f0-9-]{36}\.webp$/.test(key)) fail('Invalid illustration storage key.', 'INVALID_IMAGE', 400);
    return path.join(directory, key);
  };
  function persist(normalized) {
    const id = randomUUID(); const key = `${id}.webp`;
    fs.writeFileSync(assetPath(key), normalized.buffer, { flag: 'wx', mode: 0o600 });
    return { id, storage_key: key, media_type: normalized.mediaType, width: normalized.width, height: normalized.height,
      sha256: createHash('sha256').update(normalized.buffer).digest('hex'), byte_size: normalized.buffer.length };
  }
  function discard(asset) { if (asset) { try { fs.unlinkSync(assetPath(asset.storage_key)); } catch { /* own uncommitted file only */ } } }
  function read(gameId, assetId) {
    const asset = db.prepare('SELECT * FROM fiction_assets WHERE id = ? AND game_id = ?').get(assetId, gameId);
    if (!asset) fail('Illustration not found.', 'IMAGE_NOT_FOUND', 404);
    const filename = assetPath(asset.storage_key);
    if (fs.statSync(filename).size !== asset.byte_size) fail('Illustration integrity check failed.', 'IMAGE_INTEGRITY_FAILED', 500);
    const buffer = fs.readFileSync(filename);
    if (buffer.length !== asset.byte_size || createHash('sha256').update(buffer).digest('hex') !== asset.sha256) fail('Illustration integrity check failed.', 'IMAGE_INTEGRITY_FAILED', 500);
    return { ...asset, buffer };
  }
  async function upload(gameId, expected, upload, placement) {
    store.illustrationTarget(gameId, placement.beat_id);
    const normalized = await normalizeImageFile(upload.path, upload.mediaType);
    let asset;
    try { asset = persist(normalized); return store.illustrate(gameId, expected, { ...placement, asset }); }
    catch (error) { if (!asset || !db.prepare('SELECT id FROM fiction_assets WHERE id = ?').get(asset.id)) discard(asset); throw error; }
  }
  async function generate(gameId, expected, key, input) {
    keys(input, ['beat_id', 'direction', 'alt_text', 'caption', 'aspect_ratio', 'provider_id', 'model'], 'Illustrate story');
    const direction = text(input.direction, 'Art direction', 2000, { optional: true });
    const alt = text(input.alt_text, 'Image description', 1000);
    const caption = text(input.caption, 'Caption', 500, { optional: true });
    const ratio = input.aspect_ratio || '4:3';
    if (!['16:9', '4:3', '1:1', '3:4'].includes(ratio)) fail('Choose a supported image shape.');
    const started = store.beginRequest(gameId, expected, key, { operation: 'image', input });
    if (started.reused) return { story: store.view(gameId), ...store.requestResult(started.request), reused: true };
    const { request } = started;
    let asset; let usage = { costUsd: null, billedAttempts: 0, model: input.model || null };
    try {
      const target = store.illustrationTarget(gameId, input.beat_id);
      const selected = providers.exposure('illustrator');
      if (!input.provider_id || selected.provider?.id !== input.provider_id || selected.model_id !== input.model) fail('The illustrator changed. Refresh and review the provider before purchasing.', 'STORY_PROVIDER_CHANGED', 409);
      providers.resolve('illustrator', { capability: 'image' }); // credential check precedes dispatch
      const prompt = `Illustrate this fictional passage. Depict only what is present in the passage, not undiscovered secrets. No text overlays.\nPassage:\n${target.prose.slice(0, 12000)}\nArt direction:\n${direction}`;
      store.dispatchRequest(request.id, input.model); usage.billedAttempts = 1;
      const result = await generateIllustration({ prompt, aspectRatio: ratio, resolution: '1K', quality: 'low' });
      usage.costUsd = Number.isFinite(result.cost) && result.cost >= 0 ? result.cost : null;
      const normalized = await normalizeImage(result.buffer, result.mediaType);
      asset = persist(normalized);
      const story = store.illustrate(gameId, expected, { asset, beat_id: input.beat_id, alt_text: alt, caption }, request, usage);
      return { story, cost_usd: usage.costUsd, billed_attempts: 1, reused: false };
    } catch (error) {
      if (!asset || !db.prepare('SELECT id FROM fiction_assets WHERE id = ?').get(asset.id)) discard(asset);
      if (Number.isInteger(error.billedAttempts)) usage.billedAttempts = error.billedAttempts;
      if (Number.isFinite(error.costUsd)) usage.costUsd = error.costUsd;
      store.failRequest(request.id, error.code || 'IMAGE_FAILED', usage);
      error.billedAttempts = usage.billedAttempts; error.costUsd = usage.costUsd; throw error;
    }
  }
  return { read, upload, generate, persist, discard, assetPath, directory };
}

module.exports = { createFictionMedia };
