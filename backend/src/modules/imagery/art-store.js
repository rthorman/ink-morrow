'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createHash, randomUUID } = require('node:crypto');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
const MAX_DISPLAY_DIMENSION = 4096;
const INPUT_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);

function artError(message, code = 'INVALID_IMAGE', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sniffMediaType(buffer) {
  const head = buffer.subarray(0, 64);
  const text = head.toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    throw artError('Active SVG uploads are not accepted; upload a raster image instead.', 'ACTIVE_IMAGE_REJECTED');
  }
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (head.length >= 6 && ['GIF87a', 'GIF89a'].includes(head.toString('ascii', 0, 6))) return 'image/gif';
  if (head.length >= 16 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brands = head.toString('ascii', 8);
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
  }
  throw artError('The file signature is not a supported raster image.', 'UNSUPPORTED_IMAGE');
}

function pngContainerEnd(buffer) {
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + size;
    if (end > buffer.length) return null;
    offset = end;
    if (type === 'IEND') return size === 0 ? offset : null;
  }
  return null;
}

function avifContainerEnd(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return null;
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) return null;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < header || offset + size > buffer.length) return null;
    offset += size;
  }
  return offset;
}

function containerEnd(buffer, mediaType) {
  if (mediaType === 'image/png') return pngContainerEnd(buffer);
  if (mediaType === 'image/webp') {
    if (buffer.length < 12) return null;
    return 8 + buffer.readUInt32LE(4);
  }
  if (mediaType === 'image/jpeg') {
    for (let index = buffer.length - 2; index >= 2; index -= 1) {
      if (buffer[index] === 0xff && buffer[index + 1] === 0xd9) return index + 2;
    }
    return null;
  }
  if (mediaType === 'image/gif') {
    for (let index = buffer.length - 1; index >= 6; index -= 1) {
      if (buffer[index] === 0x3b) return index + 1;
    }
    return null;
  }
  if (mediaType === 'image/avif') return avifContainerEnd(buffer);
  return null;
}

function assertTechnicalInput(buffer, declaredMediaType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw artError('The image is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw artError('The image exceeds the 20 MB limit.', 'IMAGE_TOO_LARGE', 413);
  }
  const declared = String(declaredMediaType || '').toLowerCase();
  if (!INPUT_MEDIA_TYPES.has(declared)) {
    throw artError('The declared image type is not supported.', 'UNSUPPORTED_IMAGE');
  }
  const detected = sniffMediaType(buffer);
  if (detected !== declared) {
    throw artError(`The declared image type (${declared}) does not match its signature (${detected}).`, 'FALSE_IMAGE_TYPE');
  }
  const end = containerEnd(buffer, detected);
  if (!end || end !== buffer.length) {
    throw artError('The image contains malformed or trailing polyglot data.', 'IMAGE_POLYGLOT_REJECTED');
  }
  return detected;
}

function readAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const bytes = fs.readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, bytes);
}

// Validate a staged upload without loading the source payload into JS memory.
// Decoding below also receives the file path so libvips can read it
// incrementally. Only the bounded normalized display derivative is buffered.
function assertTechnicalFile(filePath, declaredMediaType) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) throw artError('The image is empty.');
  if (stat.size > MAX_IMAGE_BYTES) {
    throw artError('The image exceeds the 20 MB limit.', 'IMAGE_TOO_LARGE', 413);
  }
  const declared = String(declaredMediaType || '').toLowerCase();
  if (!INPUT_MEDIA_TYPES.has(declared)) {
    throw artError('The declared image type is not supported.', 'UNSUPPORTED_IMAGE');
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = readAt(fd, Math.min(64, stat.size), 0);
    const detected = sniffMediaType(head);
    if (detected !== declared) {
      throw artError(`The declared image type (${declared}) does not match its signature (${detected}).`, 'FALSE_IMAGE_TYPE');
    }
    let exactContainer = false;
    if (detected === 'image/png') {
      let offset = 8;
      while (offset + 12 <= stat.size) {
        const chunkHead = readAt(fd, 8, offset);
        if (chunkHead.length !== 8) break;
        const size = chunkHead.readUInt32BE(0);
        const type = chunkHead.toString('ascii', 4, 8);
        const end = offset + 12 + size;
        if (!Number.isSafeInteger(end) || end > stat.size) break;
        offset = end;
        if (type === 'IEND') {
          exactContainer = size === 0 && offset === stat.size;
          break;
        }
      }
    } else if (detected === 'image/webp') {
      exactContainer = head.length >= 12 && 8 + head.readUInt32LE(4) === stat.size;
    } else if (detected === 'image/jpeg') {
      exactContainer = stat.size >= 2 && readAt(fd, 2, stat.size - 2).equals(Buffer.from([0xff, 0xd9]));
    } else if (detected === 'image/gif') {
      exactContainer = stat.size >= 1 && readAt(fd, 1, stat.size - 1)[0] === 0x3b;
    } else if (detected === 'image/avif') {
      let offset = 0;
      exactContainer = true;
      while (offset < stat.size) {
        const box = readAt(fd, Math.min(16, stat.size - offset), offset);
        if (box.length < 8) { exactContainer = false; break; }
        let size = box.readUInt32BE(0);
        let header = 8;
        if (size === 1) {
          if (box.length < 16) { exactContainer = false; break; }
          const large = box.readBigUInt64BE(8);
          if (large > BigInt(Number.MAX_SAFE_INTEGER)) { exactContainer = false; break; }
          size = Number(large);
          header = 16;
        } else if (size === 0) {
          size = stat.size - offset;
        }
        if (size < header || offset + size > stat.size) { exactContainer = false; break; }
        offset += size;
      }
      exactContainer = exactContainer && offset === stat.size;
    }
    if (!exactContainer) {
      throw artError('The image contains malformed or trailing polyglot data.', 'IMAGE_POLYGLOT_REJECTED');
    }
    return detected;
  } finally {
    fs.closeSync(fd);
  }
}

async function normalizeSource(source, detected) {
  const decoder = () => {
    const options = {
      animated: false,
      failOn: 'warning',
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    };
    if (Buffer.isBuffer(source)) return sharp(source, options);
    const pipeline = sharp(options);
    fs.createReadStream(source).pipe(pipeline);
    return pipeline;
  };
  let inputMetadata;
  try {
    inputMetadata = await decoder().metadata();
  } catch (error) {
    if (/pixel limit|exceeds.*pixels/i.test(String(error.message || ''))) {
      throw artError('The decoded image exceeds the 40 megapixel limit.', 'IMAGE_PIXEL_LIMIT', 413);
    }
    throw artError('The image could not be safely decoded within the pixel limit.', 'IMAGE_DECODE_FAILED');
  }
  const expectedFormat = detected === 'image/avif' ? 'heif' : detected.replace('image/', '');
  if (!inputMetadata.width || !inputMetadata.height || inputMetadata.width * inputMetadata.height > MAX_IMAGE_PIXELS) {
    throw artError('The decoded image exceeds the 40 megapixel limit.', 'IMAGE_PIXEL_LIMIT', 413);
  }
  if (inputMetadata.format !== expectedFormat) {
    throw artError('The decoder disagrees with the file signature.', 'FALSE_IMAGE_TYPE');
  }
  let output;
  try {
    output = await decoder()
      .rotate()
      .resize({
        width: MAX_DISPLAY_DIMENSION,
        height: MAX_DISPLAY_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw artError('The image could not be normalized to a safe display derivative.', 'IMAGE_NORMALIZE_FAILED');
  }
  const outputMetadata = await sharp(output.data).metadata();
  if (outputMetadata.exif || outputMetadata.xmp || outputMetadata.iptc || outputMetadata.icc) {
    throw artError('The normalized derivative retained embedded metadata.', 'METADATA_STRIP_FAILED', 500);
  }
  return {
    buffer: output.data,
    mediaType: 'image/webp',
    width: output.info.width,
    height: output.info.height,
    sourceMediaType: detected,
    metadata: {
      normalized: true,
      metadata_stripped: true,
      animation_flattened: Number(inputMetadata.pages || 1) > 1,
      source_width: inputMetadata.width,
      source_height: inputMetadata.height,
      source_pages: Number(inputMetadata.pages || 1),
    },
  };
}

async function normalizeImage(buffer, declaredMediaType) {
  const detected = assertTechnicalInput(buffer, declaredMediaType);
  return normalizeSource(buffer, detected);
}

async function normalizeImageFile(filePath, declaredMediaType) {
  const detected = assertTechnicalFile(filePath, declaredMediaType);
  return normalizeSource(filePath, detected);
}

function createArtStore({ db, rootDir, legacyImageStore = null, logger = console }) {
  const assetsDir = path.join(rootDir, 'assets');
  const stagingDir = path.join(rootDir, '.staging');
  fs.mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

  function finalPath(storageKey) {
    if (typeof storageKey !== 'string' || path.basename(storageKey) !== storageKey || !storageKey.endsWith('.webp')) {
      throw artError('Asset storage identity is invalid.', 'INVALID_ASSET_STORAGE', 500);
    }
    return path.join(assetsDir, storageKey);
  }

  function publicAsset(row) {
    return {
      id: row.id,
      story_id: row.story_id,
      source: row.source,
      status: row.status,
      source_media_type: row.source_media_type,
      media_type: row.media_type,
      sha256: row.sha256,
      size_bytes: row.size_bytes,
      width: row.width,
      height: row.height,
      title: row.title,
      alt_text: row.alt_text,
      metadata: parseJson(row.metadata_json, {}),
      provider_provenance: parseJson(row.provider_result_json, null),
      spend_usd: row.spend_usd,
      provider_reference_allowed: Boolean(row.provider_reference_allowed),
      error_code: row.error_code,
      content_url: row.status === 'ready'
        ? `/api/stories/${row.story_id}/assets/${row.id}/content`
        : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  function getAsset(storyId, assetId) {
    const row = db.prepare('SELECT * FROM assets WHERE story_id = ? AND id = ?').get(storyId, assetId);
    return row ? publicAsset(row) : null;
  }

  function assetRow(storyId, assetId) {
    return db.prepare('SELECT * FROM assets WHERE story_id = ? AND id = ?').get(storyId, assetId) || null;
  }

  function list(storyId) {
    return {
      assets: db.prepare('SELECT * FROM assets WHERE story_id = ? ORDER BY created_at, id')
        .all(storyId).map(publicAsset),
      placements: db.prepare(`
        SELECT * FROM asset_placements WHERE story_id = ?
         ORDER BY CASE WHEN after_page_id IS NULL THEN 0 ELSE 1 END, after_page_id, ordinal, id
      `).all(storyId),
    };
  }

  function inImmediateTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* original error wins */ }
      throw error;
    }
  }

  function rowsAtAnchor(storyId, afterPageId) {
    return afterPageId === null
      ? db.prepare('SELECT * FROM asset_placements WHERE story_id = ? AND after_page_id IS NULL ORDER BY ordinal').all(storyId)
      : db.prepare('SELECT * FROM asset_placements WHERE story_id = ? AND after_page_id = ? ORDER BY ordinal')
        .all(storyId, afterPageId);
  }

  function makeRoom(storyId, afterPageId, requestedOrdinal) {
    const rows = rowsAtAnchor(storyId, afterPageId);
    const ordinal = Number.isSafeInteger(requestedOrdinal) && requestedOrdinal >= 1
      ? Math.min(requestedOrdinal, rows.length + 1)
      : rows.length + 1;
    const bump = db.prepare('UPDATE asset_placements SET ordinal = ordinal + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const row of rows.slice(ordinal - 1).reverse()) bump.run(row.id);
    return ordinal;
  }

  function compactAnchor(storyId, afterPageId) {
    const rows = rowsAtAnchor(storyId, afterPageId);
    const offset = db.prepare('UPDATE asset_placements SET ordinal = ordinal + 1000000 WHERE id = ?');
    for (const row of rows) offset.run(row.id);
    const set = db.prepare('UPDATE asset_placements SET ordinal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    rows.forEach((row, index) => set.run(index + 1, row.id));
  }

  function place(storyId, assetId, { afterPageId = null, ordinal = null, placementId = randomUUID() } = {}) {
    return inImmediateTransaction(() => {
      const position = makeRoom(storyId, afterPageId, ordinal);
      db.prepare(`
        INSERT INTO asset_placements (id, story_id, asset_id, after_page_id, ordinal)
        VALUES (?, ?, ?, ?, ?)
      `).run(placementId, storyId, assetId, afterPageId, position);
      return db.prepare('SELECT * FROM asset_placements WHERE id = ?').get(placementId);
    });
  }

  function movePlacement(storyId, placementId, { afterPageId = null, ordinal = null } = {}) {
    return inImmediateTransaction(() => {
      const current = db.prepare('SELECT * FROM asset_placements WHERE story_id = ? AND id = ?')
        .get(storyId, placementId);
      if (!current) return null;
      db.prepare('DELETE FROM asset_placements WHERE id = ?').run(current.id);
      compactAnchor(storyId, current.after_page_id);
      const position = makeRoom(storyId, afterPageId, ordinal);
      db.prepare(`
        INSERT INTO asset_placements
          (id, story_id, asset_id, after_page_id, ordinal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(current.id, storyId, current.asset_id, afterPageId, position, current.created_at);
      return db.prepare('SELECT * FROM asset_placements WHERE id = ?').get(current.id);
    });
  }

  function unplace(storyId, placementId) {
    return inImmediateTransaction(() => {
      const current = db.prepare('SELECT * FROM asset_placements WHERE story_id = ? AND id = ?')
        .get(storyId, placementId);
      if (!current) return false;
      db.prepare('DELETE FROM asset_placements WHERE id = ?').run(current.id);
      compactAnchor(storyId, current.after_page_id);
      return true;
    });
  }

  async function createNormalized({
    storyId,
    source,
    declaredMediaType,
    title = null,
    altText = null,
    providerResult = null,
    spendUsd = 0,
    providerReferenceAllowed = false,
    afterPageId,
    ordinal = null,
    assetId = randomUUID(),
  }, normalizer) {
    if (!['uploaded', 'ai-generated'].includes(source)) throw artError('Asset source is invalid.');
    const storageKey = `${randomUUID()}.webp`;
    const stagedDerivative = path.join(stagingDir, `${randomUUID()}.webp.tmp`);
    db.prepare(`
      INSERT INTO assets
        (id, story_id, source, status, source_media_type, storage_key, title, alt_text,
         metadata_json, provider_result_json, spend_usd, provider_reference_allowed)
      VALUES (?, ?, ?, 'staging', ?, ?, ?, ?, '{}', ?, ?, ?)
    `).run(
      assetId, storyId, source, declaredMediaType, storageKey, title, altText,
      providerResult ? JSON.stringify(providerResult) : null,
      Number(spendUsd) || 0, providerReferenceAllowed ? 1 : 0
    );
    try {
      const normalized = await normalizer();
      fs.writeFileSync(stagedDerivative, normalized.buffer, { flag: 'wx', mode: 0o600 });
      fs.renameSync(stagedDerivative, finalPath(storageKey));
      db.prepare(`
        UPDATE assets
           SET status = 'ready', source_media_type = ?, media_type = ?, sha256 = ?,
               size_bytes = ?, width = ?, height = ?, metadata_json = ?,
               error_code = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `).run(
        normalized.sourceMediaType,
        normalized.mediaType,
        sha256(normalized.buffer),
        normalized.buffer.length,
        normalized.width,
        normalized.height,
        JSON.stringify(normalized.metadata),
        assetId
      );
      let placement = null;
      if (afterPageId !== undefined) placement = place(storyId, assetId, { afterPageId, ordinal });
      return { asset: getAsset(storyId, assetId), placement };
    } catch (error) {
      try { fs.unlinkSync(stagedDerivative); } catch { /* no derivative */ }
      try { fs.unlinkSync(finalPath(storageKey)); } catch { /* not promoted */ }
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
      throw error;
    }
  }

  async function createFromBuffer(input) {
    return createNormalized(input, () => normalizeImage(input.buffer, input.declaredMediaType));
  }

  async function createFromFile(input) {
    return createNormalized(input, () => normalizeImageFile(input.path, input.declaredMediaType));
  }

  function updateAsset(storyId, assetId, { title, altText, providerReferenceAllowed }) {
    const current = assetRow(storyId, assetId);
    if (!current) return null;
    db.prepare(`
      UPDATE assets SET title = ?, alt_text = ?, provider_reference_allowed = ?, updated_at = CURRENT_TIMESTAMP
       WHERE story_id = ? AND id = ?
    `).run(
      title === undefined ? current.title : title,
      altText === undefined ? current.alt_text : altText,
      providerReferenceAllowed === undefined
        ? current.provider_reference_allowed
        : providerReferenceAllowed ? 1 : 0,
      storyId,
      assetId
    );
    return getAsset(storyId, assetId);
  }

  function deleteAsset(storyId, assetId) {
    const row = assetRow(storyId, assetId);
    if (!row) return false;
    db.prepare('DELETE FROM assets WHERE story_id = ? AND id = ?').run(storyId, assetId);
    try { fs.unlinkSync(finalPath(row.storage_key)); } catch { /* missing files are already deleted */ }
    return true;
  }

  function readAsset(storyId, assetId) {
    const row = assetRow(storyId, assetId);
    if (!row || row.status !== 'ready') return null;
    let buffer;
    try { buffer = fs.readFileSync(finalPath(row.storage_key)); } catch { return null; }
    if (sha256(buffer) !== row.sha256) throw artError('The stored asset failed its integrity check.', 'ASSET_INTEGRITY_FAILED', 500);
    return { buffer, mediaType: row.media_type, asset: publicAsset(row) };
  }

  function fileInfo(storyId, assetId) {
    const row = assetRow(storyId, assetId);
    if (!row || row.status !== 'ready') return null;
    const target = finalPath(row.storage_key);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
    return { path: target, size: fs.statSync(target).size, mediaType: row.media_type };
  }

  function importTarget(storageKey) {
    return finalPath(storageKey);
  }

  function pathsForStory(storyId) {
    return db.prepare("SELECT storage_key FROM assets WHERE story_id = ? AND status = 'ready'")
      .all(storyId)
      .map((row) => finalPath(row.storage_key));
  }

  function resolveReferences(storyId, ids) {
    if (!Array.isArray(ids) || ids.length > 3 || ids.some((id) => typeof id !== 'string' || !id.trim())) {
      throw artError('"reference_asset_ids" must contain at most three asset IDs.');
    }
    const references = [];
    for (const id of ids) {
      const row = assetRow(storyId, id);
      if (!row || row.status !== 'ready') throw artError(`Reference asset ${id} is unavailable.`, 'ASSET_REFERENCE_UNAVAILABLE');
      if (!row.provider_reference_allowed) {
        throw artError(`Reference asset ${id} has not been explicitly approved for provider use.`, 'ASSET_REFERENCE_NOT_APPROVED', 409);
      }
      const image = readAsset(storyId, id);
      if (!image) throw artError(`Reference asset ${id} is missing.`, 'ASSET_REFERENCE_UNAVAILABLE');
      references.push({
        id,
        input: { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.buffer.toString('base64')}` } },
      });
    }
    return references;
  }

  function cleanStaging() {
    for (const name of fs.readdirSync(stagingDir)) {
      try { fs.unlinkSync(path.join(stagingDir, name)); } catch { /* boot cleanup is best effort */ }
    }
    db.prepare("DELETE FROM assets WHERE status = 'staging'").run();
    const known = new Set(db.prepare("SELECT storage_key FROM assets WHERE status = 'ready'").all().map((row) => row.storage_key));
    for (const name of fs.readdirSync(assetsDir)) {
      if (!known.has(name)) try { fs.unlinkSync(path.join(assetsDir, name)); } catch { /* next boot retries */ }
    }
  }

  async function reconcileLegacyPages() {
    if (!legacyImageStore) return;
    const rows = db.prepare('SELECT * FROM legacy_art_pages ORDER BY story_id, ordinal, page_id').all();
    for (const row of rows) {
      let image = null;
      try { image = legacyImageStore.readImage('page', row.page_id); } catch { image = null; }
      if (!image) {
        db.prepare(`
          INSERT OR IGNORE INTO assets
            (id, story_id, source, status, source_media_type, storage_key, title,
             alt_text, metadata_json, provider_result_json, spend_usd, error_code)
          VALUES (?, ?, 'ai-generated', 'failed', ?, ?, ?, ?, ?, ?, ?, 'LEGACY_MEDIA_MISSING')
        `).run(
          row.page_id, row.story_id, row.media_type, `${randomUUID()}.webp`,
          'Recovered illustration', row.prompt,
          JSON.stringify({ migrated_from_image_page: true }),
          JSON.stringify({ legacy_image_page_id: row.page_id, prompt: row.prompt }),
          row.spend_usd
        );
        db.prepare('DELETE FROM legacy_art_pages WHERE page_id = ?').run(row.page_id);
        continue;
      }
      try {
        await createFromBuffer({
          storyId: row.story_id,
          source: 'ai-generated',
          buffer: image.buffer,
          declaredMediaType: image.mediaType,
          title: 'Recovered illustration',
          altText: row.prompt,
          providerResult: { legacy_image_page_id: row.page_id, prompt: row.prompt },
          spendUsd: row.spend_usd,
          afterPageId: row.after_page_id,
          ordinal: row.ordinal,
          assetId: row.page_id,
        });
        legacyImageStore.deleteImage('page', row.page_id);
        db.prepare('DELETE FROM legacy_art_pages WHERE page_id = ?').run(row.page_id);
      } catch (error) {
        logger.error(`Legacy art ${row.page_id} could not be normalized: ${error.code || error.message}`);
      }
    }
  }

  const ready = (async () => {
    cleanStaging();
    await reconcileLegacyPages();
  })();

  return {
    assetsDir,
    stagingDir,
    ready,
    list,
    getAsset,
    createFromBuffer,
    createFromFile,
    updateAsset,
    deleteAsset,
    readAsset,
    fileInfo,
    importTarget,
    pathsForStory,
    place,
    movePlacement,
    unplace,
    resolveReferences,
    publicAsset,
  };
}

module.exports = {
  createArtStore,
  normalizeImage,
  normalizeImageFile,
  sniffMediaType,
  artError,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  INPUT_MEDIA_TYPES,
};
