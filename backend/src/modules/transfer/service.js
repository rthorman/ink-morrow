'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('node:crypto');
const { normalizeNarrationText } = require('../audio/narration');
const {
  WORLD_FIELDS,
  CHARACTER_FIELDS,
  STORY_FIELDS,
  PAGE_FIELDS,
  VOLUME_FIELDS,
  CHAPTER_FIELDS,
  HIERARCHY_PAGE_FIELDS,
  REVISION_FIELDS,
  SNAPSHOT_FIELDS,
  MEMORY_FIELDS,
  CONTINUITY_DELTA_FIELDS,
  TEMPLATE_SNAPSHOT_FIELDS,
  CORRECTION_FIELDS,
  PREVIEW_FIELDS,
  WRITING_OPERATION_FIELDS,
  PREPARED_PAGE_FIELDS,
  AUDIOBOOK_FIELDS,
  ART_ASSET_FIELDS,
  ASSET_PLACEMENT_FIELDS,
  PUBLICATION_SNAPSHOT_FIELDS,
  ARCHIVE_EXTENSION,
  semanticHash,
  sanitizeSettings,
  validId,
} = require('./format');
const {
  DEFAULT_LIMITS,
  writeArchive,
  writeArchiveFile,
  uploadArchive,
  stageAndReadArchive,
} = require('./archive');
const { httpError, hashFile } = require('./planner');

const TOKEN_TTL_MS = 15 * 60 * 1000;

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanBinding(value) {
  return value === undefined ? null : value;
}

function mapObjectIds(value, map) {
  if (Array.isArray(value)) return value.map((item) => mapObjectIds(item, map));
  if (!value || typeof value !== 'object') return typeof value === 'string' && map.has(value) ? map.get(value) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[map.get(key) || key] = mapObjectIds(item, map);
  }
  return result;
}

function insertOrUpdate(db, table, row, fields, key = 'id') {
  const columns = fields.filter((field) => Object.prototype.hasOwnProperty.call(row, field));
  const updates = columns.filter((field) => field !== key).map((field) => `${field}=excluded.${field}`);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ` +
    `ON CONFLICT(${key}) DO UPDATE SET ${updates.join(', ')}`;
  db.prepare(sql).run(...columns.map((field) => cleanBinding(row[field])));
}

function insertOrReplace(db, table, row, fields) {
  const columns = fields.filter((field) => Object.prototype.hasOwnProperty.call(row, field));
  db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map((field) => cleanBinding(row[field])));
}

function searchTextForMemory(row) {
  const delta = parseJson(row.delta_json, {});
  return [
    row.summary,
    ...(delta.events || []).map((entry) => entry.text),
    ...(delta.goal_updates || []).map((entry) => entry.text),
    ...(delta.thread_updates || []).map((entry) => entry.text),
    ...(delta.world_fact_updates || []).map((entry) => entry.text),
    ...(delta.arc_updates || []).map((entry) => entry.text),
  ].filter((value) => typeof value === 'string' && value.trim()).join('\n');
}

function audiobookFingerprint(model, voice, pages) {
  const hash = crypto.createHash('sha256');
  hash.update(`${model}\n${voice}\n`);
  for (const page of pages.filter((entry) => !entry.image_media_type && normalizeNarrationText(entry.content))) {
    hash.update(`${page.id}\n${normalizeNarrationText(page.content)}\n`);
  }
  return hash.digest('hex');
}

function listFilesRecursive(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFilesRecursive(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

function removeTree(directory) {
  try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort staging cleanup */ }
}

function createTransferService({
  db,
  planner,
  imageStore,
  artStore,
  audioDir,
  audiobooks,
  writingTransactions,
  transferDir,
  limits = {},
}) {
  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const uploadsDir = path.join(transferDir, 'uploads');
  const stagingDir = path.join(transferDir, 'staging');
  const backupsDir = path.join(transferDir, 'backups');
  for (const directory of [uploadsDir, stagingDir, backupsDir]) fs.mkdirSync(directory, { recursive: true });

  const exportTokens = new Map();
  const importTokens = new Map();

  // Interrupted imports are disposable; safety backups are deliberately not.
  for (const directory of [uploadsDir, stagingDir]) {
    for (const name of fs.readdirSync(directory)) removeTree(path.join(directory, name));
  }

  function tokenEntry(value) {
    return { value, expiresAt: Date.now() + TOKEN_TTL_MS };
  }

  function sweep() {
    const now = Date.now();
    for (const [token, entry] of exportTokens) if (entry.expiresAt <= now) exportTokens.delete(token);
    for (const [token, entry] of importTokens) {
      if (entry.expiresAt <= now) {
        removeTree(entry.value.stageRoot);
        importTokens.delete(token);
      }
    }
  }
  const sweepTimer = setInterval(sweep, 60 * 1000);
  sweepTimer.unref?.();

  async function createExport(input) {
    const plan = await planner.planExport(input);
    const token = randomUUID();
    exportTokens.set(token, tokenEntry(plan));
    return { token, ...plan.publicPlan, download_url: `/api/transfers/exports/${token}` };
  }

  function exportPlan(token) {
    sweep();
    const entry = exportTokens.get(token);
    if (!entry) throw httpError('This export plan expired. Review the export again.', 404);
    entry.expiresAt = Date.now() + TOKEN_TTL_MS;
    return entry.value;
  }

  function finishExport(token) {
    exportTokens.delete(token);
  }

  async function streamExport(token, writable) {
    const plan = exportPlan(token);
    await writeArchive(plan, writable);
    finishExport(token);
  }

  function localRows(kind) {
    if (kind === 'world') return db.prepare('SELECT * FROM worlds').all();
    if (kind === 'character') return db.prepare('SELECT * FROM characters').all();
    return db.prepare('SELECT * FROM stories').all();
  }

  function localRow(kind, id) {
    const table = kind === 'world' ? 'worlds' : kind === 'character' ? 'characters' : 'stories';
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  }

  function localName(kind, row) {
    return kind === 'story' ? row.title : row.name;
  }

  function replacementImpact(kind, id) {
    if (kind === 'world') {
      return {
        characters: db.prepare('SELECT COUNT(*) AS c FROM characters WHERE world_id = ?').get(id).c,
        stories: db.prepare('SELECT COUNT(*) AS c FROM stories WHERE world_id = ?').get(id).c,
      };
    }
    if (kind === 'character') {
      const stories = db.prepare('SELECT characters FROM stories').all()
        .filter((row) => parseJson(row.characters, []).some((entry) => entry.id === id)).length;
      return { stories };
    }
    return {
      pages: db.prepare('SELECT COUNT(*) AS c FROM story_pages WHERE story_id = ?').get(id).c,
      continuity_rows: db.prepare('SELECT COUNT(*) AS c FROM story_memory_pages WHERE story_id = ?').get(id).c,
      has_audiobook: Boolean(db.prepare('SELECT 1 FROM audiobooks WHERE story_id = ?').get(id)),
    };
  }

  function validateDependencies(imported) {
    const keys = new Set(imported.entities.map((entity) => `${entity.kind}:${entity.id}`));
    const byKey = new Map(imported.entities.map((entity) => [`${entity.kind}:${entity.id}`, entity]));
    for (const entity of imported.entities) {
      for (const dependency of entity.dependencies) {
        if (!keys.has(`${dependency.kind}:${dependency.id}`)) {
          throw httpError(`Archive is missing ${dependency.kind} dependency ${dependency.id}`);
        }
      }
      if (entity.kind === 'character' && entity.bundle.record.world_id &&
          !keys.has(`world:${entity.bundle.record.world_id}`)) {
        throw httpError('Archive is missing a character home world');
      }
      if (entity.kind === 'story') {
        const record = entity.bundle.record;
        if (record.world_id && !keys.has(`world:${record.world_id}`)) throw httpError('Archive is missing the story world');
        for (const cast of record.characters) {
          if (!keys.has(`character:${cast.id}`)) throw httpError(`Archive is missing cast member ${cast.id}`);
        }
      }
    }
    const mediaOwners = new Set();
    for (const asset of imported.assets) {
      const ownerKey = `${asset.kind}:${asset.owner_kind}:${asset.owner_id}`;
      if (mediaOwners.has(ownerKey)) throw httpError('Archive declares more than one media file for the same object');
      mediaOwners.add(ownerKey);
      if (asset.kind === 'audio') {
        const story = byKey.get(`story:${asset.story_id || asset.owner_id}`);
        if (!story || asset.owner_kind !== 'story' || !story.bundle.audiobook) {
          throw httpError('Archive audiobook is not attached to an imported story');
        }
        continue;
      }
      if (asset.owner_kind === 'page') {
        const story = byKey.get(`story:${asset.story_id}`);
        const page = story?.bundle.pages.find((entry) => entry.id === asset.owner_id);
        if (!page || page.image_media_type !== asset.media_type) throw httpError('Archive plate is not attached to a matching story page');
      } else if (asset.owner_kind === 'asset') {
        const story = byKey.get(`story:${asset.story_id}`);
        const art = story?.bundle.art_assets?.find((entry) => entry.id === asset.owner_id);
        if (!art || asset.kind !== 'image' || art.media_type !== asset.media_type ||
            art.sha256 !== asset.sha256 || art.size_bytes !== asset.size_bytes) {
          throw httpError('Archive art media is not attached to a matching story asset');
        }
      } else {
        const entity = byKey.get(`${asset.owner_kind}:${asset.owner_id}`);
        if (!entity || entity.bundle.record.image_media_type !== asset.media_type) {
          throw httpError('Archive image is not attached to a matching entity');
        }
      }
    }
    for (const entity of imported.entities.filter((item) => item.kind === 'story')) {
      if (entity.bundle.audiobook && !mediaOwners.has(`audio:story:${entity.id}`)) {
        throw httpError('Archive audiobook metadata has no audio file');
      }
      for (const art of entity.bundle.art_assets || []) {
        if (!mediaOwners.has(`image:asset:${art.id}`)) {
          throw httpError('Archive art metadata has no normalized media file');
        }
      }
    }
  }

  async function entityAssetFingerprint(kind, id, entity, imported, { local = false } = {}) {
    const options = imported.manifest.options;
    const descriptors = [];
    if (options.include_visuals) {
      if (kind === 'world' || kind === 'character') {
        const asset = local ? imageStore.fileInfo(kind, id) : imported.assets.find((item) =>
          item.kind === 'image' && item.owner_kind === kind && item.owner_id === entity.id);
        descriptors.push(['image', asset ? (local ? await hashFile(asset.path) : asset.sha256) : null]);
      } else {
        const cover = local ? imageStore.fileInfo('story', id) : imported.assets.find((item) =>
          item.kind === 'image' && item.owner_kind === 'story' && item.owner_id === entity.id);
        descriptors.push(['cover', cover ? (local ? await hashFile(cover.path) : cover.sha256) : null]);
        const pages = local
          ? db.prepare('SELECT id, page_number, image_media_type FROM story_pages WHERE story_id = ? ORDER BY page_number').all(id)
          : entity.bundle.pages;
        for (const page of pages.filter((item) => item.image_media_type)) {
          const asset = local ? imageStore.fileInfo('page', page.id) : imported.assets.find((item) =>
            item.kind === 'image' && item.owner_kind === 'page' && item.story_id === entity.id && item.page_number === page.page_number);
          descriptors.push([`page:${page.page_number}`, asset ? (local ? await hashFile(asset.path) : asset.sha256) : null]);
        }
        const artAssets = local
          ? db.prepare("SELECT id FROM assets WHERE story_id = ? AND status = 'ready' ORDER BY created_at, id").all(id)
          : (entity.bundle.art_assets || []);
        for (const [index, art] of artAssets.entries()) {
          const asset = local ? artStore.fileInfo(id, art.id) : imported.assets.find((item) =>
            item.kind === 'image' && item.owner_kind === 'asset' && item.owner_id === art.id &&
            item.story_id === entity.id);
          descriptors.push([`art:${index + 1}`, asset ? (local ? await hashFile(asset.path) : asset.sha256) : null]);
        }
      }
    }
    if (kind === 'story' && options.include_audio) {
      let hash = null;
      if (local) {
        const row = db.prepare("SELECT 1 FROM audiobooks WHERE story_id = ? AND status = 'ready'").get(id);
        const file = path.join(audioDir, `${id}.mp3`);
        if (row && fs.existsSync(file) && fs.statSync(file).isFile()) hash = await hashFile(file);
      } else {
        hash = imported.assets.find((item) => item.kind === 'audio' && item.story_id === entity.id)?.sha256 || null;
      }
      descriptors.push(['audio', hash]);
    }
    return JSON.stringify(descriptors);
  }

  async function classifyImport(imported) {
    const options = imported.manifest.options;
    const hashes = new Map();
    function localHash(kind, id) {
      const key = `${kind}:${id}`;
      if (!hashes.has(key)) {
        const bundle = planner.localBundle(kind, id, options);
        hashes.set(key, semanticHash(kind, bundle, {
          includeHierarchy: imported.manifest.database_schema.version >= 2,
          includeArtStore: imported.manifest.database_schema.version >= 7,
        }));
      }
      return hashes.get(key);
    }

    const result = [];
    for (const entity of imported.entities) {
      const key = `${entity.kind}:${entity.id}`;
      const sameId = localRow(entity.kind, entity.id);
      const incomingName = entity.name || (entity.kind === 'story' ? entity.bundle.record.title : entity.bundle.record.name);
      const incomingAssets = await entityAssetFingerprint(entity.kind, entity.id, entity, imported);
      const sameNames = localRows(entity.kind)
        .filter((row) => localName(entity.kind, row).trim().toLowerCase() === String(incomingName).trim().toLowerCase())
        .map((row) => ({ id: row.id, name: localName(entity.kind, row) }));
      if (sameId) {
        const exact = localHash(entity.kind, sameId.id) === entity.semantic_sha256 &&
          await entityAssetFingerprint(entity.kind, sameId.id, entity, imported, { local: true }) === incomingAssets;
        result.push({
          key,
          kind: entity.kind,
          id: entity.id,
          name: incomingName,
          status: exact ? 'identical' : 'conflict',
          local_id: sameId.id,
          local_name: localName(entity.kind, sameId),
          recommended: exact ? 'keep' : 'copy',
          choices: exact ? ['keep', 'copy'] : ['keep', 'copy', 'replace'],
          same_name_matches: sameNames,
          replace_impact: replacementImpact(entity.kind, entity.id),
        });
        continue;
      }
      let exactOther = null;
      for (const row of localRows(entity.kind)) {
        if (localHash(entity.kind, row.id) !== entity.semantic_sha256) continue;
        if (await entityAssetFingerprint(entity.kind, row.id, entity, imported, { local: true }) !== incomingAssets) continue;
        exactOther = row;
        break;
      }
      if (exactOther) {
        result.push({
          key,
          kind: entity.kind,
          id: entity.id,
          name: incomingName,
          status: 'identical',
          local_id: exactOther.id,
          local_name: localName(entity.kind, exactOther),
          recommended: 'keep',
          choices: ['keep', 'copy'],
          same_name_matches: sameNames,
          replace_impact: null,
        });
        continue;
      }
      result.push({
        key,
        kind: entity.kind,
        id: entity.id,
        name: incomingName,
        status: sameNames.length ? 'same-name' : 'new',
        local_id: null,
        local_name: null,
        recommended: 'import',
        choices: ['import', 'copy'],
        same_name_matches: sameNames,
        replace_impact: null,
      });
    }
    return result;
  }

  function parseCurrentSettings(value) {
    if (!value) return null;
    try { return sanitizeSettings(JSON.parse(value)); }
    catch { return null; }
  }

  async function preflight(req) {
    const stageRoot = path.join(stagingDir, randomUUID());
    fs.mkdirSync(stageRoot, { recursive: true });
    let uploaded;
    try {
      uploaded = await uploadArchive(req, uploadsDir, effectiveLimits);
      const imported = await stageAndReadArchive(uploaded.path, stageRoot, effectiveLimits);
      try { fs.unlinkSync(uploaded.path); } catch { /* already gone */ }
      validateDependencies(imported);
      const collisions = await classifyImport(imported);
      const token = randomUUID();
      const session = {
        stageRoot,
        imported,
        collisions,
        currentSettings: parseCurrentSettings(uploaded.fields.current_settings),
      };
      importTokens.set(token, tokenEntry(session));
      return {
        token,
        format_version: imported.manifest.version,
        scope: imported.manifest.scope,
        created_at: imported.manifest.created_at,
        created_by: imported.manifest.created_by,
        options: imported.manifest.options,
        exposure: imported.manifest.exposure,
        settings_available: Boolean(imported.manifest.settings),
        expanded_bytes: imported.expandedBytes,
        collisions,
        summary: {
          entities: imported.entities.length,
          assets: imported.assets.length,
          conflicts: collisions.filter((item) => item.status === 'conflict').length,
          identical: collisions.filter((item) => item.status === 'identical').length,
          same_name_warnings: collisions.filter((item) => item.status === 'same-name').length,
        },
      };
    } catch (error) {
      if (uploaded?.path) try { fs.unlinkSync(uploaded.path); } catch { /* cleanup */ }
      removeTree(stageRoot);
      throw error;
    }
  }

  function importSession(token) {
    sweep();
    const entry = importTokens.get(token);
    if (!entry) throw httpError('This import review expired. Choose the archive again.', 404);
    entry.expiresAt = Date.now() + TOKEN_TTL_MS;
    return entry.value;
  }

  function uniqueCopyName(kind, base, reserved) {
    const table = kind === 'world' ? 'worlds' : kind === 'character' ? 'characters' : 'stories';
    const column = kind === 'story' ? 'title' : 'name';
    const existing = new Set(db.prepare(`SELECT LOWER(${column}) AS name FROM ${table}`).all().map((row) => row.name));
    for (const value of reserved) existing.add(value.toLowerCase());
    let candidate = `${base} (Imported)`;
    let n = 2;
    while (existing.has(candidate.toLowerCase())) candidate = `${base} (Imported ${n++})`;
    reserved.add(candidate);
    return candidate;
  }

  function resolutionPlan(session, request) {
    const mode = request?.mode === 'replace_all' ? 'replace_all' : 'merge';
    if (mode === 'replace_all' && session.imported.manifest.scope !== 'full') {
      throw httpError('Only a full backup can replace all local data');
    }
    const requested = request?.resolutions && typeof request.resolutions === 'object' ? request.resolutions : {};
    const actions = new Map();
    for (const collision of session.collisions) {
      const selected = mode === 'replace_all' ? 'import' : (requested[collision.key] || collision.recommended);
      if (mode !== 'replace_all' && !collision.choices.includes(selected)) {
        throw httpError(`Invalid collision choice for ${collision.name}`);
      }
      actions.set(collision.key, { ...collision, action: selected });
    }

    const maps = {
      world: new Map(), character: new Map(), story: new Map(),
      volume: new Map(), chapter: new Map(), page: new Map(), revision: new Map(),
      asset: new Map(), placement: new Map(), assetStorage: new Map(),
    };
    const reservedNames = { world: new Set(), character: new Set(), story: new Set() };
    const copiedNames = new Map();
    for (const kind of ['world', 'character', 'story']) {
      for (const entity of session.imported.entities.filter((item) => item.kind === kind)) {
        const action = actions.get(`${kind}:${entity.id}`);
        let targetId;
        if (action.action === 'keep') targetId = action.local_id;
        else if (action.action === 'copy') targetId = randomUUID();
        else targetId = entity.id;
        if (!validId(targetId)) throw httpError(`Could not resolve ${entity.name}`);
        maps[kind].set(entity.id, targetId);
        if (action.action === 'copy') copiedNames.set(`${kind}:${entity.id}`, uniqueCopyName(kind, entity.name, reservedNames[kind]));
      }
    }
    for (const entity of session.imported.entities.filter((item) => item.kind === 'story')) {
      const action = actions.get(`story:${entity.id}`);
      for (const volume of entity.bundle.hierarchy?.volumes || []) {
        let id = volume.id;
        const existing = mode === 'replace_all' ? null : db.prepare('SELECT story_id FROM volumes WHERE id = ?').get(id);
        if (action.action === 'copy' || (existing && existing.story_id !== entity.id)) id = randomUUID();
        maps.volume.set(volume.id, id);
      }
      for (const chapter of entity.bundle.hierarchy?.chapters || []) {
        let id = chapter.id;
        const existing = mode === 'replace_all' ? null : db.prepare(`
          SELECT v.story_id FROM chapters c JOIN volumes v ON v.id = c.volume_id WHERE c.id = ?
        `).get(id);
        if (action.action === 'copy' || (existing && existing.story_id !== entity.id)) id = randomUUID();
        maps.chapter.set(chapter.id, id);
      }
      for (const page of entity.bundle.pages) {
        let id = page.id;
        const compatibilityOwner = mode === 'replace_all' ? null : db.prepare('SELECT story_id FROM story_pages WHERE id = ?').get(id);
        const hierarchyOwner = mode === 'replace_all' ? null : db.prepare(`
          SELECT v.story_id FROM pages p
          JOIN chapters c ON c.id = p.chapter_id
          JOIN volumes v ON v.id = c.volume_id
          WHERE p.id = ?
        `).get(id);
        if (action.action === 'copy' ||
            (compatibilityOwner && compatibilityOwner.story_id !== entity.id) ||
            (hierarchyOwner && hierarchyOwner.story_id !== entity.id)) {
          id = randomUUID();
        }
        maps.page.set(page.id, id);
      }
      for (const revision of entity.bundle.revisions || []) {
        let id = revision.id;
        const existing = mode === 'replace_all' ? null : db.prepare('SELECT page_id FROM page_revisions WHERE id = ?').get(id);
        if (action.action === 'copy' || (existing && existing.page_id !== revision.page_id)) id = randomUUID();
        maps.revision.set(revision.id, id);
      }
      const targetStoryId = maps.story.get(entity.id);
      for (const asset of entity.bundle.art_assets || []) {
        let id = asset.id;
        const existing = mode === 'replace_all' ? null : db.prepare('SELECT story_id FROM assets WHERE id = ?').get(id);
        if (action.action === 'copy' || (existing && existing.story_id !== targetStoryId)) id = randomUUID();
        maps.asset.set(asset.id, id);
        maps.assetStorage.set(asset.id, `${randomUUID()}.webp`);
      }
      for (const placement of entity.bundle.asset_placements || []) {
        let id = placement.id;
        const existing = mode === 'replace_all' ? null : db.prepare('SELECT story_id FROM asset_placements WHERE id = ?').get(id);
        if (action.action === 'copy' || (existing && existing.story_id !== targetStoryId)) id = randomUUID();
        maps.placement.set(placement.id, id);
      }
    }
    return { mode, actions, maps, copiedNames };
  }

  function targetForAsset(asset, maps) {
    if (asset.kind === 'audio') {
      const storyId = maps.story.get(asset.story_id || asset.owner_id);
      return storyId ? path.join(audioDir, `${storyId}.mp3`) : null;
    }
    if (asset.owner_kind === 'asset') {
      const storageKey = maps.assetStorage.get(asset.owner_id);
      return storageKey ? artStore.importTarget(storageKey) : null;
    }
    const mappedId = asset.owner_kind === 'page'
      ? maps.page.get(asset.owner_id)
      : maps[asset.owner_kind]?.get(asset.owner_id);
    return mappedId ? imageStore.targetPath(asset.owner_kind, mappedId, asset.media_type) : null;
  }

  function affectedOldFiles(session, resolved) {
    if (resolved.mode === 'replace_all') return [
      ...listFilesRecursive(imageStore.rootDir),
      ...listFilesRecursive(audioDir),
    ];
    const paths = [];
    for (const entity of session.imported.entities) {
      const action = resolved.actions.get(`${entity.kind}:${entity.id}`);
      if (action.action !== 'replace') continue;
      if (entity.kind === 'world' || entity.kind === 'character') paths.push(...imageStore.pathsFor(entity.kind, entity.id));
      if (entity.kind === 'story') {
        paths.push(...imageStore.pathsFor('story', entity.id));
        const oldPages = db.prepare('SELECT id FROM story_pages WHERE story_id = ?').all(entity.id);
        for (const page of oldPages) paths.push(...imageStore.pathsFor('page', page.id));
        paths.push(...artStore.pathsForStory(entity.id));
        paths.push(path.join(audioDir, `${entity.id}.mp3`), path.join(audioDir, `${entity.id}.mp3.tmp`));
      }
    }
    for (const asset of session.imported.assets) {
      const target = targetForAsset(asset, resolved.maps);
      if (target) paths.push(target);
    }
    return [...new Set(paths.filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()))];
  }

  function stageMedia(session, resolved) {
    const operations = [];
    try {
      for (const asset of session.imported.assets) {
        const ownerKey = ['page', 'asset'].includes(asset.owner_kind)
          ? `story:${asset.story_id}`
          : `${asset.owner_kind}:${asset.owner_id}`;
        const action = resolved.actions.get(ownerKey);
        if (!action || action.action === 'keep') continue;
        const target = targetForAsset(asset, resolved.maps);
        if (!target) throw httpError(`Could not map media dependency ${asset.archive_path}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.import`;
        fs.copyFileSync(asset.staged_path, temporary, fs.constants.COPYFILE_EXCL);
        operations.push({ temporary, target });
      }
    } catch (error) {
      for (const operation of operations) {
        try { fs.unlinkSync(operation.temporary); } catch { /* partial staging */ }
      }
      throw error;
    }
    return operations;
  }

  function moveOldFiles(files, rollbackDir) {
    fs.mkdirSync(rollbackDir, { recursive: true });
    return files.map((source, index) => {
      const saved = path.join(rollbackDir, `${index}-${path.basename(source)}`);
      fs.renameSync(source, saved);
      return { source, saved };
    });
  }

  function installMedia(operations) {
    for (const operation of operations) fs.renameSync(operation.temporary, operation.target);
  }

  function undoMedia(operations, moved) {
    for (const operation of operations) {
      try { fs.unlinkSync(operation.temporary); } catch { /* already renamed */ }
      try { fs.unlinkSync(operation.target); } catch { /* absent */ }
    }
    for (const item of [...moved].reverse()) {
      fs.mkdirSync(path.dirname(item.source), { recursive: true });
      try { fs.renameSync(item.saved, item.source); } catch { /* best effort; safety backup remains for replace-all */ }
    }
  }

  function hasAsset(session, ownerKind, ownerId, kind = 'image') {
    return session.imported.assets.some((asset) => asset.kind === kind && asset.owner_kind === ownerKind && asset.owner_id === ownerId);
  }

  function importRows(session, resolved) {
    const { actions, maps, copiedNames } = resolved;
    if (resolved.mode === 'replace_all') {
      db.exec('DELETE FROM stories; DELETE FROM characters; DELETE FROM worlds;');
    } else {
      for (const entity of session.imported.entities.filter((item) => item.kind === 'story')) {
        if (actions.get(`story:${entity.id}`).action === 'replace') db.prepare('DELETE FROM stories WHERE id = ?').run(entity.id);
      }
    }

    for (const entity of session.imported.entities.filter((item) => item.kind === 'world')) {
      const action = actions.get(`world:${entity.id}`);
      if (action.action === 'keep') continue;
      const record = { ...entity.bundle.record, id: maps.world.get(entity.id) };
      if (copiedNames.has(`world:${entity.id}`)) record.name = copiedNames.get(`world:${entity.id}`);
      const hasImage = hasAsset(session, 'world', entity.id);
      record.image_status = hasImage ? 'ready' : 'none';
      if (!hasImage) record.image_media_type = null;
      insertOrUpdate(db, 'worlds', record, WORLD_FIELDS);
    }

    for (const entity of session.imported.entities.filter((item) => item.kind === 'character')) {
      const action = actions.get(`character:${entity.id}`);
      if (action.action === 'keep') continue;
      const record = {
        ...entity.bundle.record,
        id: maps.character.get(entity.id),
        world_id: entity.bundle.record.world_id ? maps.world.get(entity.bundle.record.world_id) : null,
      };
      if (copiedNames.has(`character:${entity.id}`)) record.name = copiedNames.get(`character:${entity.id}`);
      const hasImage = hasAsset(session, 'character', entity.id);
      record.image_status = hasImage ? 'ready' : 'none';
      if (!hasImage) record.image_media_type = null;
      insertOrUpdate(db, 'characters', record, CHARACTER_FIELDS);
    }

    for (const entity of session.imported.entities.filter((item) => item.kind === 'story')) {
      const action = actions.get(`story:${entity.id}`);
      if (action.action === 'keep') continue;
      const storyId = maps.story.get(entity.id);
      const characterMap = maps.character;
      const cast = entity.bundle.record.characters.map((entry) => ({ ...entry, id: characterMap.get(entry.id) }));
      const overrides = mapObjectIds(entity.bundle.record.continuity_overrides || {}, characterMap);
      const record = {
        ...entity.bundle.record,
        id: storyId,
        world_id: entity.bundle.record.world_id ? maps.world.get(entity.bundle.record.world_id) : null,
        characters: JSON.stringify(cast),
        continuity_overrides: JSON.stringify(overrides),
      };
      if (copiedNames.has(`story:${entity.id}`)) record.title = copiedNames.get(`story:${entity.id}`);
      const hasCover = hasAsset(session, 'story', entity.id);
      record.image_status = hasCover ? 'ready' : 'none';
      if (!hasCover) record.image_media_type = null;
      insertOrUpdate(db, 'stories', record, STORY_FIELDS);

      const importedPages = [];
      for (const pageSource of entity.bundle.pages) {
        const page = {
          ...pageSource,
          id: maps.page.get(pageSource.id),
          story_id: storyId,
        };
        insertOrUpdate(db, 'story_pages', page, PAGE_FIELDS);
        importedPages.push(page);
      }
      if (entity.bundle.hierarchy) {
        for (const volumeSource of entity.bundle.hierarchy.volumes) {
          insertOrUpdate(db, 'volumes', {
            ...volumeSource,
            id: maps.volume.get(volumeSource.id),
            story_id: storyId,
          }, VOLUME_FIELDS);
        }
        for (const chapterSource of entity.bundle.hierarchy.chapters) {
          insertOrUpdate(db, 'chapters', {
            ...chapterSource,
            id: maps.chapter.get(chapterSource.id),
            volume_id: maps.volume.get(chapterSource.volume_id),
          }, CHAPTER_FIELDS);
        }
        for (const pageSource of entity.bundle.hierarchy.pages) {
          insertOrUpdate(db, 'pages', {
            ...pageSource,
            id: maps.page.get(pageSource.id),
            chapter_id: maps.chapter.get(pageSource.chapter_id),
            canonical_revision_id: null,
            display_revision_id: null,
          }, HIERARCHY_PAGE_FIELDS);
        }
      } else {
        // Schema-1 archives came from the kernel scaffold before hierarchy
        // behavior existed. They carry no structural choices to preserve, so
        // importing them into schema 2 creates the accepted default manuscript.
        const volumeId = randomUUID();
        const chapterId = randomUUID();
        db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, 1, ?)')
          .run(volumeId, storyId, 'Volume I');
        db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, 1, ?)')
          .run(chapterId, volumeId, 'Chapter I');
        const insertPage = db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)');
        importedPages.forEach((page, index) => insertPage.run(page.id, chapterId, index + 1));
      }
      if (entity.bundle.revisions?.length && entity.bundle.hierarchy) {
        const pending = new Map(entity.bundle.revisions.map((revision) => [revision.id, revision]));
        while (pending.size) {
          let progressed = false;
          for (const [sourceId, revisionSource] of [...pending]) {
            if (revisionSource.parent_revision_id && pending.has(revisionSource.parent_revision_id)) continue;
            const revision = {
              ...revisionSource,
              id: maps.revision.get(sourceId),
              page_id: maps.page.get(revisionSource.page_id),
              parent_revision_id: revisionSource.parent_revision_id
                ? maps.revision.get(revisionSource.parent_revision_id)
                : null,
            };
            insertOrUpdate(db, 'page_revisions', revision, REVISION_FIELDS);
            pending.delete(sourceId);
            progressed = true;
          }
          if (!progressed) throw httpError('Imported page revision ancestry is cyclic');
        }
        for (const pageSource of entity.bundle.hierarchy.pages) {
          db.prepare(`
            UPDATE pages SET canonical_revision_id = ?, display_revision_id = ? WHERE id = ?
          `).run(
            maps.revision.get(pageSource.canonical_revision_id),
            maps.revision.get(pageSource.display_revision_id),
            maps.page.get(pageSource.id)
          );
        }
      } else {
        // Schema-1/2 archives predate immutable revisions. Their compatibility
        // prose is unambiguous, so it becomes one imported canonical/display
        // revision per page without inventing history.
        const placementFor = db.prepare('SELECT id FROM pages WHERE id = ?');
        const insertRevision = db.prepare(`
          INSERT INTO page_revisions
            (id, page_id, parent_revision_id, kind, content, direction, source,
             model, prompt_tokens, completion_tokens, cost_usd, created_at)
          VALUES (?, ?, NULL, 'canonical', ?, ?, 'import', ?, ?, ?, ?, ?)
        `);
        const setPointers = db.prepare(`
          UPDATE pages SET canonical_revision_id = ?, display_revision_id = ? WHERE id = ?
        `);
        for (const page of importedPages) {
          if (!placementFor.get(page.id)) continue;
          const revisionId = randomUUID();
          insertRevision.run(
            revisionId, page.id, page.content, page.user_input, page.model,
            page.prompt_tokens, page.completion_tokens, page.cost_usd || 0,
            page.created_at
          );
          setPointers.run(revisionId, revisionId, page.id);
        }
      }
      for (const assetSource of entity.bundle.art_assets || []) {
        const asset = {
          ...assetSource,
          id: maps.asset.get(assetSource.id),
          story_id: storyId,
          storage_key: maps.assetStorage.get(assetSource.id),
          provider_reference_allowed: 0,
        };
        insertOrUpdate(db, 'assets', asset, [
          ...ART_ASSET_FIELDS, 'storage_key', 'provider_reference_allowed',
        ]);
      }
      for (const placementSource of entity.bundle.asset_placements || []) {
        const placement = {
          ...placementSource,
          id: maps.placement.get(placementSource.id),
          story_id: storyId,
          asset_id: maps.asset.get(placementSource.asset_id),
          after_page_id: placementSource.after_page_id
            ? maps.page.get(placementSource.after_page_id)
            : null,
        };
        insertOrUpdate(db, 'asset_placements', placement, ASSET_PLACEMENT_FIELDS);
      }
      for (const snapshotSource of entity.bundle.snapshots) {
        const snapshot = {
          ...snapshotSource,
          story_id: storyId,
          character_id: characterMap.get(snapshotSource.character_id),
        };
        insertOrReplace(db, 'story_character_snapshots', snapshot, SNAPSHOT_FIELDS);
      }
      for (const templateSource of entity.bundle.template_snapshots || []) {
        const sourceId = templateSource.template_kind === 'world'
          ? maps.world.get(templateSource.source_template_id)
          : maps.character.get(templateSource.source_template_id);
        const snapshot = {
          ...templateSource,
          id: randomUUID(),
          story_id: storyId,
          source_template_id: sourceId,
        };
        insertOrReplace(db, 'template_snapshots', snapshot, TEMPLATE_SNAPSHOT_FIELDS);
      }
      for (const memorySource of entity.bundle.memory) {
        const memory = {
          ...memorySource,
          page_id: maps.page.get(memorySource.page_id),
          story_id: storyId,
          delta_json: memorySource.delta_json
            ? JSON.stringify(mapObjectIds(parseJson(memorySource.delta_json, {}), characterMap))
            : null,
        };
        insertOrUpdate(db, 'story_memory_pages', memory, MEMORY_FIELDS, 'page_id');
        if (memory.status === 'ready') {
          const content = searchTextForMemory(memory);
          db.prepare('INSERT OR REPLACE INTO story_memory_search (page_id, story_id, content) VALUES (?, ?, ?)')
            .run(memory.page_id, storyId, content);
          try {
            db.prepare('DELETE FROM story_memory_fts WHERE page_id = ?').run(memory.page_id);
            db.prepare('INSERT INTO story_memory_fts (page_id, story_id, content) VALUES (?, ?, ?)')
              .run(memory.page_id, storyId, content);
          } catch { /* LIKE search remains correct */ }
        }
      }
      const importedDeltas = entity.bundle.continuity_deltas || [];
      if (importedDeltas.length) {
        for (const deltaSource of importedDeltas) {
          const delta = {
            ...deltaSource,
            revision_id: maps.revision.get(deltaSource.revision_id),
            story_id: storyId,
            delta_json: deltaSource.delta_json
              ? JSON.stringify(mapObjectIds(parseJson(deltaSource.delta_json, {}), characterMap))
              : null,
          };
          insertOrUpdate(db, 'continuity_deltas', delta, CONTINUITY_DELTA_FIELDS, 'revision_id');
          if (delta.status === 'ready') {
            const content = searchTextForMemory(delta);
            db.prepare('INSERT OR REPLACE INTO continuity_search (revision_id, story_id, content) VALUES (?, ?, ?)')
              .run(delta.revision_id, storyId, content);
            try {
              db.prepare('DELETE FROM continuity_search_fts WHERE revision_id = ?').run(delta.revision_id);
              db.prepare('INSERT INTO continuity_search_fts (revision_id, story_id, content) VALUES (?, ?, ?)')
                .run(delta.revision_id, storyId, content);
            } catch { /* LIKE search remains correct */ }
          }
        }
      } else {
        // Pre-schema-5 archives carry current ready continuity by page. Bind
        // those rows to the imported canonical revisions without inventing
        // any additional extraction.
        for (const memorySource of entity.bundle.memory) {
          const pageId = maps.page.get(memorySource.page_id);
          const revisionId = db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(pageId)?.canonical_revision_id;
          if (!revisionId) continue;
          const delta = {
            revision_id: revisionId,
            story_id: storyId,
            status: memorySource.status,
            schema_version: memorySource.schema_version || 1,
            delta_json: memorySource.delta_json
              ? JSON.stringify(mapObjectIds(parseJson(memorySource.delta_json, {}), characterMap))
              : null,
            provider_result_json: null,
            spend_usd: memorySource.cost_usd || 0,
            error_code: memorySource.status === 'failed' ? 'IMPORTED_EXTRACTION_FAILED' : null,
            content_hash: memorySource.content_hash,
            summary: memorySource.summary,
            model: memorySource.model,
            prompt_tokens: memorySource.prompt_tokens,
            completion_tokens: memorySource.completion_tokens,
            error: memorySource.error,
            created_at: memorySource.created_at,
            updated_at: memorySource.updated_at,
          };
          insertOrUpdate(db, 'continuity_deltas', delta, CONTINUITY_DELTA_FIELDS, 'revision_id');
          if (delta.status === 'ready') {
            const content = searchTextForMemory(delta);
            db.prepare('INSERT OR REPLACE INTO continuity_search (revision_id, story_id, content) VALUES (?, ?, ?)')
              .run(revisionId, storyId, content);
          }
        }
      }
      const combinedMap = new Map([
        ...maps.world, ...maps.character, ...maps.story, ...maps.volume,
        ...maps.chapter, ...maps.page, ...maps.revision, ...maps.asset, ...maps.placement,
      ]);
      for (const correctionSource of entity.bundle.corrections || []) {
        const subjectId = correctionSource.subject_id ? (combinedMap.get(correctionSource.subject_id) || correctionSource.subject_id) : null;
        const correction = {
          ...correctionSource,
          id: randomUUID(),
          story_id: storyId,
          subject_id: subjectId,
          correction_json: JSON.stringify(mapObjectIds(parseJson(correctionSource.correction_json, {}), combinedMap)),
        };
        insertOrReplace(db, 'continuity_corrections', correction, CORRECTION_FIELDS);
      }
      const operationSources = entity.bundle.writing_operations || [];
      const operationMap = new Map(operationSources.map((operation) => [operation.id, randomUUID()]));
      const preparedSource = entity.bundle.prepared_page || null;
      const preparedId = preparedSource ? randomUUID() : null;
      const workingMap = new Map([
        ...combinedMap,
        ...operationMap,
        ...(preparedSource ? [[preparedSource.id, preparedId]] : []),
      ]);
      const importedContext = preparedSource
        ? mapObjectIds(parseJson(preparedSource.context_json, {}), workingMap)
        : null;
      const freshPreparedContext = importedContext && writingTransactions
        ? writingTransactions.contextSnapshot(storyId, importedContext.generation || {})
        : null;
      const importedAt = new Date().toISOString();
      const writingOperationDbFields = [...WRITING_OPERATION_FIELDS, 'writer_session_id', 'lease_token'];
      for (const operationSource of operationSources) {
        const interrupted = ['requested', 'running'].includes(operationSource.status);
        const isPreparedOperation = Boolean(preparedSource && operationSource.id === preparedSource.operation_id);
        const operation = {
          ...operationSource,
          id: operationMap.get(operationSource.id),
          story_id: storyId,
          writer_session_id: `archive-import:${randomUUID()}`,
          lease_token: null,
          expected_tail_page_id: operationSource.expected_tail_page_id
            ? maps.page.get(operationSource.expected_tail_page_id)
            : null,
          expected_tail_revision_id: operationSource.expected_tail_revision_id
            ? maps.revision.get(operationSource.expected_tail_revision_id)
            : null,
          context_fingerprint: isPreparedOperation && freshPreparedContext
            ? freshPreparedContext.fingerprint
            : operationSource.context_fingerprint,
          request_json: JSON.stringify(mapObjectIds(parseJson(operationSource.request_json, {}), workingMap)),
          provider_result_json: operationSource.provider_result_json
            ? JSON.stringify(mapObjectIds(parseJson(operationSource.provider_result_json, {}), workingMap))
            : null,
          result_json: operationSource.result_json
            ? JSON.stringify(mapObjectIds(parseJson(operationSource.result_json, {}), workingMap))
            : null,
          status: interrupted ? 'failed' : operationSource.status,
          error_code: interrupted ? 'RESTART_INTERRUPTED' : operationSource.error_code,
          error_message: interrupted
            ? 'The archived provider operation was interrupted before import.'
            : operationSource.error_message,
          updated_at: interrupted ? importedAt : operationSource.updated_at,
          finished_at: interrupted ? importedAt : operationSource.finished_at,
        };
        insertOrUpdate(db, 'writing_operations', operation, writingOperationDbFields);
      }
      if (preparedSource) {
        const prepared = {
          ...preparedSource,
          story_id: storyId,
          id: preparedId,
          operation_id: operationMap.get(preparedSource.operation_id),
          expected_tail_page_id: preparedSource.expected_tail_page_id
            ? maps.page.get(preparedSource.expected_tail_page_id)
            : null,
          expected_tail_revision_id: preparedSource.expected_tail_revision_id
            ? maps.revision.get(preparedSource.expected_tail_revision_id)
            : null,
          context_fingerprint: freshPreparedContext
            ? freshPreparedContext.fingerprint
            : preparedSource.context_fingerprint,
          context_json: freshPreparedContext
            ? freshPreparedContext.json
            : JSON.stringify(importedContext),
          provider_result_json: JSON.stringify(mapObjectIds(
            parseJson(preparedSource.provider_result_json, {}), workingMap
          )),
        };
        insertOrUpdate(db, 'prepared_pages', prepared, PREPARED_PAGE_FIELDS, 'story_id');
        // The operation response carries the public opaque identity. Rebuild
        // it after assigning the imported identity so idempotent replay agrees
        // with GET /preview and exact promotion.
        const publicPrepared = writingTransactions
          ? writingTransactions.publicPrepared(prepared)
          : { id: prepared.id, preview_id: prepared.id, preview_key: prepared.id,
              expected_page: prepared.expected_page, operation_id: prepared.operation_id,
              created_at: prepared.created_at };
        db.prepare('UPDATE writing_operations SET result_json = ? WHERE id = ?')
          .run(JSON.stringify({ preview: publicPrepared }), prepared.operation_id);
      }
      for (const publicationSource of entity.bundle.publication_snapshots || []) {
        insertOrReplace(db, 'publication_snapshots', {
          ...publicationSource,
          id: randomUUID(),
          story_id: storyId,
        }, PUBLICATION_SNAPSHOT_FIELDS);
      }
      if (entity.bundle.preview) {
        insertOrUpdate(db, 'story_previews', { ...entity.bundle.preview, story_id: storyId }, PREVIEW_FIELDS, 'story_id');
      }
      if (entity.bundle.audiobook && hasAsset(session, 'story', entity.id, 'audio')) {
        const audiobook = {
          ...entity.bundle.audiobook,
          story_id: storyId,
          status: 'ready',
          fingerprint: audiobookFingerprint(entity.bundle.audiobook.model, entity.bundle.audiobook.voice, importedPages),
        };
        insertOrUpdate(db, 'audiobooks', audiobook, AUDIOBOOK_FIELDS, 'story_id');
      }
    }
  }

  function diskHasRoom(bytes) {
    if (typeof fs.statfsSync !== 'function') return true;
    try {
      const stat = fs.statfsSync(transferDir);
      return Number(stat.bavail) * Number(stat.bsize) - bytes > 64 * 1024 * 1024;
    } catch { return true; }
  }

  async function safetyBackup(settings) {
    const plan = await planner.planExport({
      scope: 'full',
      include_visuals: true,
      include_audio: true,
      include_working_history: true,
      settings,
    });
    if (!diskHasRoom(plan.estimatedBytes)) throw httpError('Not enough disk space to create the required safety backup', 507);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `safety-before-import-${stamp}${ARCHIVE_EXTENSION}`;
    await writeArchiveFile(plan, path.join(backupsDir, filename));
    return { filename, download_url: `/api/transfers/safety-backups/${encodeURIComponent(filename)}` };
  }

  async function commit(token, request = {}) {
    const session = importSession(token);
    const resolved = resolutionPlan(session, request);
    let safety = null;
    if (resolved.mode === 'replace_all') safety = await safetyBackup(session.currentSettings);

    // Resolve old paths before staging `.import` siblings into those same
    // directories; replace-all must never mistake a new temp file for old data.
    const oldFiles = affectedOldFiles(session, resolved);
    const mediaOperations = stageMedia(session, resolved);
    const rollbackDir = path.join(session.stageRoot, 'rollback');
    let moved = [];
    let transaction = false;
    try {
      moved = moveOldFiles(oldFiles, rollbackDir);
      if (resolved.mode === 'replace_all') {
        for (const row of db.prepare('SELECT id FROM stories').all()) audiobooks.abandonStory(row.id);
      }
      for (const entity of session.imported.entities.filter((item) => item.kind === 'story')) {
        const action = resolved.actions.get(`story:${entity.id}`);
        if (resolved.mode !== 'replace_all' && action.action === 'replace') audiobooks.abandonStory(entity.id);
      }
      installMedia(mediaOperations);
      db.exec('BEGIN IMMEDIATE');
      transaction = true;
      importRows(session, resolved);
      db.exec('COMMIT');
      transaction = false;
    } catch (error) {
      if (transaction) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      }
      undoMedia(mediaOperations, moved);
      throw error;
    }

    const counts = { imported: 0, copied: 0, replaced: 0, kept: 0 };
    for (const action of resolved.actions.values()) {
      const key = action.action === 'import' ? 'imported' : action.action === 'copy' ? 'copied' : action.action === 'replace' ? 'replaced' : 'kept';
      counts[key] += 1;
    }
    const settings = request.restore_settings === true ? sanitizeSettings(session.imported.manifest.settings) : null;
    removeTree(session.stageRoot);
    importTokens.delete(token);
    return {
      mode: resolved.mode,
      counts,
      settings,
      safety_backup: safety,
      message: resolved.mode === 'replace_all' ? 'Full backup restored.' : 'Archive imported.',
    };
  }

  function cancelImport(token) {
    const entry = importTokens.get(token);
    if (!entry) return false;
    removeTree(entry.value.stageRoot);
    importTokens.delete(token);
    return true;
  }

  function safetyBackupPath(filename) {
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename.endsWith(ARCHIVE_EXTENSION)) {
      throw httpError('Safety backup not found', 404);
    }
    const target = path.join(backupsDir, filename);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw httpError('Safety backup not found', 404);
    return target;
  }

  function dispose() {
    clearInterval(sweepTimer);
    for (const entry of importTokens.values()) removeTree(entry.value.stageRoot);
    importTokens.clear();
    exportTokens.clear();
  }

  return {
    createExport,
    exportPlan,
    streamExport,
    finishExport,
    preflight,
    commit,
    cancelImport,
    safetyBackupPath,
    dispose,
  };
}

module.exports = { createTransferService, mapObjectIds, searchTextForMemory, audiobookFingerprint };
