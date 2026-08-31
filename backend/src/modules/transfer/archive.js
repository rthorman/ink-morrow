'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { randomUUID } = require('node:crypto');
const Busboy = require('busboy');
const yazl = require('yazl');
const yauzl = require('yauzl');
const {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  ARCHIVE_MANIFEST_SCHEMA,
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  ENTITY_KINDS,
  EXPORT_SCOPES,
  WORLD_FIELDS,
  CHARACTER_FIELDS,
  STORY_FIELDS,
  PAGE_FIELDS,
  SNAPSHOT_FIELDS,
  MEMORY_FIELDS,
  PREVIEW_FIELDS,
  AUDIOBOOK_FIELDS,
  semanticHash,
  validId,
} = require('./format');
const { hashFile, httpError } = require('./planner');

const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 20 * 1024 * 1024 * 1024,
  maxExpandedBytes: 40 * 1024 * 1024 * 1024,
  maxEntries: 100000,
  maxJsonBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 1000,
});

function writeArchive(plan, writable) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    zip.outputStream.on('error', done);
    writable.on('error', done);
    writable.on('finish', () => done());
    zip.outputStream.pipe(writable);
    zip.addBuffer(plan.manifestBuffer, 'manifest.json', { compress: true, mode: 0o100600 });
    for (const entity of plan.entities) {
      zip.addBuffer(entity.buffer, entity.path, { compress: true, mode: 0o100600 });
    }
    for (const asset of plan.assets) {
      zip.addFile(asset.source_path, asset.archive_path, { compress: false, mode: 0o100600 });
    }
    zip.end();
  });
}

async function writeArchiveFile(plan, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeArchive(plan, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    fs.renameSync(temporary, targetPath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* nothing written */ }
    throw error;
  }
  return targetPath;
}

function uploadArchive(req, uploadDir, limits = DEFAULT_LIMITS) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const uploadPath = path.join(uploadDir, `${randomUUID()}.upload`);
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: limits.maxArchiveBytes, fields: 4, fieldSize: 256 * 1024 },
      });
    } catch {
      reject(httpError('Import must be sent as multipart form data with one archive file'));
      return;
    }
    let sawFile = false;
    let tooLarge = false;
    let fileDone = Promise.resolve();
    const fields = {};

    const fail = (error) => {
      try { fs.unlinkSync(uploadPath); } catch { /* no file yet */ }
      reject(error);
    };

    bb.on('field', (name, value) => {
      if (name === 'current_settings') fields.current_settings = value;
    });
    bb.on('file', (name, file, info) => {
      if (sawFile) {
        file.resume();
        return;
      }
      sawFile = true;
      if (name !== 'archive') {
        file.resume();
        fileDone = Promise.reject(httpError('The uploaded file field must be named "archive"'));
        fileDone.catch(() => {});
        return;
      }
      const output = fs.createWriteStream(uploadPath, { flags: 'wx', mode: 0o600 });
      file.on('limit', () => {
        tooLarge = true;
        output.destroy(httpError('Archive is larger than the configured import limit', 413));
      });
      fileDone = pipeline(file, output);
      // Filename is informational only; ZIP validation owns trust.
      fields.original_name = String(info?.filename || '').slice(0, 300);
    });
    bb.on('filesLimit', () => fail(httpError('Upload exactly one archive file')));
    bb.on('error', fail);
    bb.on('close', async () => {
      try {
        await fileDone;
        if (!sawFile) throw httpError('Choose a ScribeTribe archive to import');
        if (tooLarge) throw httpError('Archive is larger than the configured import limit', 413);
        const stat = fs.statSync(uploadPath);
        if (!stat.isFile() || stat.size === 0) throw httpError('The uploaded archive is empty');
        resolve({ path: uploadPath, fields, size: stat.size });
      } catch (error) {
        fail(error.statusCode ? error : httpError(error.message || 'Could not save the uploaded archive'));
      }
    });
    req.pipe(bb);
  });
}

function safeEntryName(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const normalized = path.posix.normalize(name);
  return normalized === name && !normalized.startsWith('../') && normalized !== '..';
}

function isSymlink(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, autoClose: true }, (error, zip) => {
      if (error) reject(httpError(`This is not a readable ZIP archive: ${error.message}`));
      else resolve(zip);
    });
  });
}

function entryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
  });
}

function diskHasRoom(directory, additionalBytes) {
  if (typeof fs.statfsSync !== 'function') return true;
  try {
    const stat = fs.statfsSync(directory);
    const available = Number(stat.bavail) * Number(stat.bsize);
    return available - additionalBytes > 32 * 1024 * 1024;
  } catch {
    return true;
  }
}

async function extractZip(archivePath, destination, limits) {
  fs.mkdirSync(destination, { recursive: true });
  const zip = await openZip(archivePath);
  const files = new Map();
  let entries = 0;
  let expanded = 0;

  return new Promise((resolve, reject) => {
    let failed = false;
    const abort = (error) => {
      if (failed) return;
      failed = true;
      try { zip.close(); } catch { /* already closed */ }
      reject(error.statusCode ? error : httpError(error.message || 'Could not extract archive'));
    };

    zip.on('error', abort);
    zip.on('entry', async (entry) => {
      try {
        entries += 1;
        if (entries > limits.maxEntries) throw httpError('Archive contains too many files');
        if (!safeEntryName(entry.fileName) || isSymlink(entry)) throw httpError(`Unsafe archive entry: ${entry.fileName}`);
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        if (files.has(entry.fileName)) throw httpError(`Archive contains a duplicate path: ${entry.fileName}`);
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw httpError('Archive contains an invalid file size');
        expanded += entry.uncompressedSize;
        if (expanded > limits.maxExpandedBytes) throw httpError('Expanded archive is larger than the configured import limit', 413);
        if (entry.fileName.endsWith('.json') && entry.uncompressedSize > limits.maxJsonBytes) {
          throw httpError(`JSON entry is too large: ${entry.fileName}`, 413);
        }
        if (entry.compressedSize > 0 && entry.uncompressedSize > 1024 * 1024 &&
            entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
          throw httpError(`Archive entry expands suspiciously: ${entry.fileName}`);
        }
        if (!diskHasRoom(destination, entry.uncompressedSize)) throw httpError('Not enough free disk space to stage this import', 507);

        const target = path.join(destination, ...entry.fileName.split('/'));
        const resolved = path.resolve(target);
        const root = path.resolve(destination) + path.sep;
        if (!resolved.startsWith(root)) throw httpError(`Unsafe archive entry: ${entry.fileName}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const stream = await entryStream(zip, entry);
        await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        files.set(entry.fileName, { path: target, size: entry.uncompressedSize });
        zip.readEntry();
      } catch (error) {
        abort(error);
      }
    });
    zip.on('end', () => {
      if (!failed) resolve({ files, expandedBytes: expanded });
    });
    zip.readEntry();
  });
}

function readJsonFile(file, maxBytes) {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) throw httpError('Archive JSON exceeds the configured limit', 413);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw httpError(`Archive contains invalid JSON: ${error.message}`); }
}

function assertArchivePath(value, prefix) {
  if (typeof value !== 'string' || !safeEntryName(value) || !value.startsWith(prefix) || value.endsWith('/')) {
    throw httpError(`Invalid archive path: ${String(value)}`);
  }
}

function assertHash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw httpError('Archive contains an invalid SHA-256 hash');
}

function validateBundle(meta, bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || !bundle.record || typeof bundle.record !== 'object') {
    throw httpError(`Invalid ${meta.kind} record`);
  }
  if (bundle.record.id !== meta.id) throw httpError(`${meta.kind} record id does not match its manifest`);
  const assertKnown = (value, allowed, label) => {
    if (Object.keys(value || {}).some((key) => !allowed.includes(key))) throw httpError(`${label} contains an unknown field`);
  };
  assertKnown(bundle, meta.kind === 'story'
    ? ['record', 'pages', 'snapshots', 'memory', 'preview', 'audiobook']
    : ['record'], `${meta.kind} bundle`);
  assertKnown(bundle.record, meta.kind === 'world' ? WORLD_FIELDS : meta.kind === 'character' ? CHARACTER_FIELDS : STORY_FIELDS, `${meta.kind} record`);
  const name = meta.kind === 'story' ? bundle.record.title : bundle.record.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 300) throw httpError(`${meta.kind} has an invalid name`);
  if (meta.name !== name) throw httpError(`${meta.kind} display name does not match its record`);
  const boundedText = (value, max) => value === null || value === undefined || (typeof value === 'string' && value.length <= max);
  if (meta.kind === 'world') {
    if (!boundedText(bundle.record.description, 10000) || !boundedText(bundle.record.genre, 100) ||
        !boundedText(bundle.record.setting, 200) || !boundedText(bundle.record.lore, 20000) ||
        !boundedText(bundle.record.image_prompt, 2000)) throw httpError('World contains an invalid or oversized field');
    return;
  }
  if (meta.kind === 'character') {
    if (bundle.record.world_id !== null && bundle.record.world_id !== undefined && !validId(bundle.record.world_id)) {
      throw httpError('Character has an invalid world reference');
    }
    if (!boundedText(bundle.record.description, 10000) || !boundedText(bundle.record.personality, 10000) ||
        !boundedText(bundle.record.appearance, 10000) || !boundedText(bundle.record.background, 10000) ||
        !boundedText(bundle.record.image_prompt, 2000)) throw httpError('Character contains an invalid or oversized field');
    return;
  }
  if (!['fade-to-black', 'romantic', 'explicit'].includes(bundle.record.tone)) throw httpError('Story has an invalid maturity level');
  if (bundle.record.world_id !== null && bundle.record.world_id !== undefined && !validId(bundle.record.world_id)) {
    throw httpError('Story has an invalid world reference');
  }
  if (!Array.isArray(bundle.record.characters) || !Array.isArray(bundle.pages) || !Array.isArray(bundle.snapshots) || !Array.isArray(bundle.memory)) {
    throw httpError('Story archive is missing its cast, pages, snapshots, or continuity rows');
  }
  const castIds = new Set();
  let leadCount = 0;
  for (const cast of bundle.record.characters) {
    if (!cast || !validId(cast.id) || !['mc', 'supporting', 'background'].includes(cast.role) || castIds.has(cast.id)) {
      throw httpError('Story archive contains an invalid cast entry');
    }
    if (cast.role === 'mc') leadCount += 1;
    if (!boundedText(cast.relation, 2000) || (cast.state !== null && cast.state !== undefined &&
        (!cast.state || typeof cast.state !== 'object' || Array.isArray(cast.state)))) {
      throw httpError('Story archive contains an invalid cast note or override');
    }
    castIds.add(cast.id);
  }
  if (leadCount > 1) throw httpError('Story archive contains more than one lead');
  const pageIds = new Set();
  const numbers = new Set();
  for (const page of bundle.pages) {
    assertKnown(page, PAGE_FIELDS, 'Story page');
    if (!page || !validId(page.id) || page.story_id !== meta.id || pageIds.has(page.id) ||
        !Number.isSafeInteger(page.page_number) || page.page_number < 1 || numbers.has(page.page_number) ||
        typeof page.content !== 'string' || page.content.length > 500000) {
      throw httpError('Story archive contains an invalid page');
    }
    pageIds.add(page.id);
    numbers.add(page.page_number);
  }
  const ordered = [...numbers].sort((a, b) => a - b);
  if (ordered.some((number, index) => number !== index + 1)) throw httpError('Story page numbers must be contiguous');
  const snapshotIds = new Set();
  for (const snapshot of bundle.snapshots) {
    assertKnown(snapshot, SNAPSHOT_FIELDS, 'Character snapshot');
    if (!snapshot || snapshot.story_id !== meta.id || !castIds.has(snapshot.character_id) || snapshotIds.has(snapshot.character_id)) {
      throw httpError('Story archive contains an invalid character snapshot');
    }
    snapshotIds.add(snapshot.character_id);
  }
  if ([...castIds].some((id) => !snapshotIds.has(id))) throw httpError('Story archive is missing a character snapshot');
  for (const memory of bundle.memory) {
    assertKnown(memory, MEMORY_FIELDS, 'Continuity row');
    if (!memory || memory.story_id !== meta.id || !pageIds.has(memory.page_id) || !['pending', 'ready', 'failed'].includes(memory.status)) {
      throw httpError('Story archive contains an invalid continuity row');
    }
  }
  if (bundle.preview && (bundle.preview.story_id !== meta.id || !Number.isSafeInteger(bundle.preview.expected_page))) {
    throw httpError('Story archive contains an invalid prepared page');
  }
  if (bundle.preview) assertKnown(bundle.preview, PREVIEW_FIELDS, 'Prepared page');
  if (bundle.audiobook && (bundle.audiobook.story_id !== meta.id || bundle.audiobook.status !== 'ready')) {
    throw httpError('Story archive contains an invalid audiobook record');
  }
  if (bundle.audiobook) assertKnown(bundle.audiobook, AUDIOBOOK_FIELDS, 'Audiobook record');
}

function validateManifest(manifest, files) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw httpError('Archive manifest must be an object');
  }
  if (manifest.format === 'scribetribe-portable-archive' && manifest.version === 1) {
    throw httpError('This is a ScribeTribe 3.x archive. ScribeTribe 4.0 does not import 3.x archives; use 3.2.2 to open it.');
  }
  if (manifest.format !== ARCHIVE_FORMAT) {
    throw httpError('This is not a supported ScribeTribe project archive');
  }
  if (!Number.isSafeInteger(manifest.version)) throw httpError('Archive format version is invalid');
  if (manifest.version > ARCHIVE_VERSION) {
    throw httpError(`This archive was made by a newer ScribeTribe version (archive v${manifest.version}); this build supports v${ARCHIVE_VERSION}.`);
  }
  if (manifest.version !== ARCHIVE_VERSION) {
    throw httpError(`Archive v${manifest.version} is not supported by the 4.0 clean-break importer.`);
  }
  if (!Number.isSafeInteger(manifest.manifest_schema_version)) {
    throw httpError('Archive manifest schema version is invalid');
  }
  if (manifest.manifest_schema_version > ARCHIVE_MANIFEST_SCHEMA_VERSION) {
    throw httpError('This archive uses a newer manifest schema and cannot be safely read by this build.');
  }
  if (manifest.manifest_schema_version !== ARCHIVE_MANIFEST_SCHEMA_VERSION) {
    throw httpError('This archive uses an unsupported manifest schema.');
  }
  const databaseSchema = manifest.database_schema;
  if (!databaseSchema || typeof databaseSchema !== 'object' || Array.isArray(databaseSchema) ||
      Object.keys(databaseSchema).some((key) => !['family', 'version'].includes(key))) {
    throw httpError('Archive database schema identity is invalid');
  }
  if (databaseSchema.family !== DATABASE_FAMILY) {
    throw httpError('This archive belongs to a different ScribeTribe database family.');
  }
  if (!Number.isSafeInteger(databaseSchema.version)) throw httpError('Archive database schema version is invalid');
  if (databaseSchema.version > DATABASE_SCHEMA_VERSION) {
    throw httpError('This archive was made from a newer ScribeTribe database schema.');
  }
  if (databaseSchema.version !== DATABASE_SCHEMA_VERSION) {
    throw httpError('This archive database schema is not supported by the 4.0 clean-break importer.');
  }
  const allowedManifestFields = Object.keys(ARCHIVE_MANIFEST_SCHEMA.properties);
  if (Object.keys(manifest).some((key) => !allowedManifestFields.includes(key)) ||
      ARCHIVE_MANIFEST_SCHEMA.required.some((key) => !Object.prototype.hasOwnProperty.call(manifest, key))) {
    throw httpError('Archive manifest has missing or unknown fields');
  }
  if (!manifest.created_by || typeof manifest.created_by !== 'object' ||
      Object.keys(manifest.created_by).some((key) => !['application', 'version'].includes(key)) ||
      manifest.created_by.application !== 'ScribeTribe' || typeof manifest.created_by.version !== 'string' ||
      !manifest.created_by.version || manifest.created_by.version.length > 100) {
    throw httpError('Archive creator identity is invalid');
  }
  if (typeof manifest.created_at !== 'string' || manifest.created_at.length > 50 ||
      !Number.isFinite(Date.parse(manifest.created_at))) {
    throw httpError('Archive creation time is invalid');
  }
  if ((manifest.settings !== null &&
       (!manifest.settings || typeof manifest.settings !== 'object' || Array.isArray(manifest.settings))) ||
      !manifest.exposure || typeof manifest.exposure !== 'object' || Array.isArray(manifest.exposure)) {
    throw httpError('Archive settings or exposure summary is invalid');
  }
  if (!EXPORT_SCOPES.has(manifest.scope) || !manifest.options || typeof manifest.options !== 'object') {
    throw httpError('Archive manifest has an invalid scope or options block');
  }
  const optionKeys = ['include_visuals', 'include_audio', 'include_working_history'];
  if (Object.keys(manifest.options).some((key) => !optionKeys.includes(key)) ||
      optionKeys.some((key) => typeof manifest.options[key] !== 'boolean')) {
    throw httpError('Archive manifest has invalid export options');
  }
  if (!Array.isArray(manifest.entities) || !Array.isArray(manifest.assets)) throw httpError('Archive manifest is incomplete');
  const expected = new Set(['manifest.json']);
  const entityKeys = new Set();
  for (const entity of manifest.entities) {
    const entityFields = Object.keys(ARCHIVE_MANIFEST_SCHEMA.properties.entities.items.properties);
    if (!entity || typeof entity !== 'object' || Object.keys(entity).some((key) => !entityFields.includes(key)) ||
        !ENTITY_KINDS.has(entity.kind) || !validId(entity.id) || typeof entity.name !== 'string' ||
        !entity.name.trim() || entity.name.length > 300 || !Number.isSafeInteger(entity.size_bytes) || entity.size_bytes < 0) {
      throw httpError('Archive contains invalid entity metadata');
    }
    assertArchivePath(entity.path, 'objects/');
    assertHash(entity.sha256);
    assertHash(entity.semantic_sha256);
    const key = `${entity.kind}:${entity.id}`;
    if (entityKeys.has(key) || expected.has(entity.path)) throw httpError('Archive contains duplicate entity metadata');
    entityKeys.add(key);
    expected.add(entity.path);
    if (!files.has(entity.path)) throw httpError(`Archive is missing ${entity.path}`);
    if (!Array.isArray(entity.dependencies)) throw httpError('Archive entity dependencies are invalid');
    for (const dependency of entity.dependencies) {
      if (!dependency || typeof dependency !== 'object' ||
          Object.keys(dependency).some((key) => !['kind', 'id'].includes(key)) ||
          !ENTITY_KINDS.has(dependency.kind) || !validId(dependency.id)) {
        throw httpError('Archive dependency is invalid');
      }
    }
  }
  for (const asset of manifest.assets) {
    const assetFields = Object.keys(ARCHIVE_MANIFEST_SCHEMA.properties.assets.items.properties);
    if (!asset || typeof asset !== 'object' || Object.keys(asset).some((key) => !assetFields.includes(key)) ||
        !['image', 'audio'].includes(asset.kind) || !validId(asset.owner_id) ||
        !['world', 'character', 'story', 'page'].includes(asset.owner_kind)) {
      throw httpError('Archive contains invalid media metadata');
    }
    if ((asset.story_id !== null && !validId(asset.story_id)) ||
        (asset.page_number !== null && (!Number.isSafeInteger(asset.page_number) || asset.page_number < 1)) ||
        (asset.owner_kind === 'page' && (!validId(asset.story_id) || !Number.isSafeInteger(asset.page_number))) ||
        (asset.owner_kind !== 'page' && asset.page_number !== null) ||
        (['story', 'page'].includes(asset.owner_kind) && !validId(asset.story_id)) ||
        (['world', 'character'].includes(asset.owner_kind) && asset.story_id !== null)) {
      throw httpError('Archive media ownership metadata is invalid');
    }
    assertArchivePath(asset.archive_path, 'assets/');
    assertHash(asset.sha256);
    if (!Number.isSafeInteger(asset.size_bytes) || asset.size_bytes < 0 || expected.has(asset.archive_path)) {
      throw httpError('Archive media size or path is invalid');
    }
    if (asset.kind === 'audio' && asset.media_type !== 'audio/mpeg') throw httpError('Only MP3 audiobook assets are supported');
    if (asset.kind === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(asset.media_type)) {
      throw httpError('Archive contains an unsupported image type');
    }
    expected.add(asset.archive_path);
    if (!files.has(asset.archive_path)) throw httpError(`Archive is missing ${asset.archive_path}`);
  }
  for (const name of files.keys()) if (!expected.has(name)) throw httpError(`Archive contains an undeclared file: ${name}`);
}

async function stageAndReadArchive(uploadPath, stageRoot, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const extractionDir = path.join(stageRoot, 'contents');
  const extracted = await extractZip(uploadPath, extractionDir, limits);
  const manifestFile = extracted.files.get('manifest.json');
  if (!manifestFile) throw httpError('Archive has no manifest.json');
  const manifest = readJsonFile(manifestFile.path, limits.maxJsonBytes);
  validateManifest(manifest, extracted.files);

  const entities = [];
  for (const meta of manifest.entities) {
    const file = extracted.files.get(meta.path);
    if (file.size !== meta.size_bytes) throw httpError(`Size check failed for ${meta.path}`);
    if (await hashFile(file.path) !== meta.sha256) throw httpError(`Integrity check failed for ${meta.path}`);
    const bundle = readJsonFile(file.path, limits.maxJsonBytes);
    validateBundle(meta, bundle);
    if (semanticHash(meta.kind, bundle) !== meta.semantic_sha256) {
      throw httpError(`Semantic integrity check failed for ${meta.path}`);
    }
    entities.push({ ...meta, bundle, staged_path: file.path });
  }
  const assets = [];
  for (const meta of manifest.assets) {
    const file = extracted.files.get(meta.archive_path);
    if (file.size !== meta.size_bytes) throw httpError(`Size check failed for ${meta.archive_path}`);
    if (await hashFile(file.path) !== meta.sha256) throw httpError(`Integrity check failed for ${meta.archive_path}`);
    assets.push({ ...meta, staged_path: file.path });
  }
  return { manifest, entities, assets, expandedBytes: extracted.expandedBytes };
}

module.exports = {
  DEFAULT_LIMITS,
  writeArchive,
  writeArchiveFile,
  uploadArchive,
  stageAndReadArchive,
  validateManifest,
  validateBundle,
  safeEntryName,
};
