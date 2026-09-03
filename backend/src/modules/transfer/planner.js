'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCastJson } = require('../stories/cast');
const { portablePublicationSnapshotRow } = require('../publication/document');
const {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  EXPORT_SCOPES,
  jsonBuffer,
  sha256,
  archiveFilename,
  worldRecord,
  characterRecord,
  scribeRecord,
  scribeRevisionRecord,
  scribeBindingRecord,
  storyRecord,
  pageRecord,
  volumeRecord,
  chapterRecord,
  sceneRecord,
  scenePageRecord,
  playSessionRecord,
  playTurnRecord,
  playAiRequestRecord,
  hierarchyPageRecord,
  revisionRecord,
  snapshotRecord,
  memoryRecord,
  continuityDeltaRecord,
  authorCanonEntryRecord,
  authorCanonRevisionRecord,
  templateSnapshotRecord,
  correctionRecord,
  previewRecord,
  writingOperationRecord,
  preparedPageRecord,
  audiobookRecord,
  ART_ASSET_FIELDS,
  ASSET_PLACEMENT_FIELDS,
  PUBLICATION_SNAPSHOT_FIELDS,
  pick,
  semanticHash,
  sanitizeSettings,
  validId,
} = require('./format');

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function objectPath(kind, id) {
  const plural = kind === 'story' ? 'stories' : `${kind}s`;
  return `objects/${plural}/${sha256(`${kind}:${id}`).slice(0, 24)}.json`;
}

function mediaArchivePath(ownerKind, ownerId, filePath) {
  const extension = path.extname(filePath).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const bucket = ownerKind === 'story' ? 'covers' : ownerKind === 'page' ? 'pages' : `${ownerKind}s`;
  return `assets/images/${bucket}/${sha256(`${ownerKind}:${ownerId}`).slice(0, 24)}${extension}`;
}

function createExportPlanner({ db, imageStore, artStore, audioDir, appVersion = '4.1.0' }) {
  const worldById = db.prepare('SELECT * FROM worlds WHERE id = ?');
  const characterById = db.prepare('SELECT * FROM characters WHERE id = ?');
  const storyById = db.prepare('SELECT * FROM stories WHERE id = ?');

  function normalizeOptions(input) {
    const scope = input?.scope;
    if (!EXPORT_SCOPES.has(scope)) throw httpError('scope must be world, character, scribe, story, or full');
    const includeVisuals = input.include_visuals !== false;
    const includeAudio = input.include_audio === undefined ? scope === 'full' : input.include_audio === true;
    const includeWorkingHistory = input.include_working_history === undefined
      ? scope === 'full'
      : input.include_working_history === true;
    return {
      scope,
      id: input.id,
      characterIds: input.character_ids,
      includeVisuals,
      includeAudio,
      includeWorkingHistory,
      settings: scope === 'full' ? sanitizeSettings(input.settings) : null,
    };
  }

  function selectedIds(options) {
    const worlds = new Set();
    const characters = new Set();
    const scribes = new Set();
    const stories = new Set();
    let rootName = null;

    if (options.scope === 'full') {
      for (const row of db.prepare('SELECT id FROM worlds').all()) worlds.add(row.id);
      for (const row of db.prepare('SELECT id FROM characters').all()) characters.add(row.id);
      for (const row of db.prepare('SELECT id FROM scribes').all()) scribes.add(row.id);
      for (const row of db.prepare('SELECT id FROM stories').all()) stories.add(row.id);
      rootName = 'ink-morrow-backup';
      return { worlds, characters, scribes, stories, rootName, externalWorlds: [] };
    }
    if (!validId(options.id)) throw httpError('id is required for this export scope');

    if (options.scope === 'world') {
      const world = worldById.get(options.id);
      if (!world) throw httpError('World not found', 404);
      worlds.add(world.id);
      rootName = world.name;
      const residents = db.prepare('SELECT id FROM characters WHERE world_id = ? ORDER BY name').all(world.id);
      const chosen = options.characterIds === undefined ? residents.map((row) => row.id) : options.characterIds;
      if (!Array.isArray(chosen) || chosen.some((id) => !validId(id))) {
        throw httpError('character_ids must be an array of character ids');
      }
      const allowed = new Set(residents.map((row) => row.id));
      for (const id of chosen) {
        if (!allowed.has(id)) throw httpError('A selected character does not belong to this world');
        characters.add(id);
      }
      return { worlds, characters, scribes, stories, rootName, externalWorlds: [] };
    }

    if (options.scope === 'character') {
      const character = characterById.get(options.id);
      if (!character) throw httpError('Character not found', 404);
      characters.add(character.id);
      if (character.world_id) worlds.add(character.world_id);
      rootName = character.name;
      return { worlds, characters, scribes, stories, rootName, externalWorlds: [] };
    }

    if (options.scope === 'scribe') {
      const scribe = db.prepare('SELECT * FROM scribes WHERE id = ?').get(options.id);
      if (!scribe) throw httpError('Scribe not found', 404);
      scribes.add(scribe.id);
      rootName = scribe.name;
      return { worlds, characters, scribes, stories, rootName, externalWorlds: [] };
    }

    const story = storyById.get(options.id);
    if (!story) throw httpError('Story not found', 404);
    stories.add(story.id);
    rootName = story.title;
    if (story.world_id) worlds.add(story.world_id);
    const externalWorldIds = new Set();
    for (const cast of parseCastJson(story.characters)) {
      const character = characterById.get(cast.id);
      if (!character) continue;
      characters.add(character.id);
      if (character.world_id) {
        worlds.add(character.world_id);
        if (character.world_id !== story.world_id) externalWorldIds.add(character.world_id);
      }
    }
    const externalWorlds = [...externalWorldIds]
      .map((id) => worldById.get(id))
      .filter(Boolean)
      .map((row) => ({ id: row.id, name: row.name }));
    for (const binding of db.prepare(`
      SELECT DISTINCT source_scribe_id FROM story_scribe_bindings
       WHERE story_id = ? AND source_scribe_id IS NOT NULL
    `).all(story.id)) scribes.add(binding.source_scribe_id);
    return { worlds, characters, scribes, stories, rootName, externalWorlds };
  }

  function imageFor(kind, id, enabled) {
    return enabled ? imageStore.fileInfo(kind, id) : null;
  }

  function buildWorldBundle(id, options) {
    const row = worldById.get(id);
    if (!row) throw httpError('Archive dependency world is missing', 409);
    const image = imageFor('world', id, options.includeVisuals);
    const record = worldRecord(row, { hasVisual: Boolean(image), includeWorkingHistory: options.includeWorkingHistory });
    if (image) record.image_media_type = image.mediaType;
    return { bundle: { record }, image };
  }

  function buildCharacterBundle(id, options) {
    const row = characterById.get(id);
    if (!row) throw httpError('Archive dependency character is missing', 409);
    const image = imageFor('character', id, options.includeVisuals);
    const record = characterRecord(row, { hasVisual: Boolean(image), includeWorkingHistory: options.includeWorkingHistory });
    if (image) record.image_media_type = image.mediaType;
    return { bundle: { record }, image };
  }

  function buildScribeBundle(id, options) {
    const row = db.prepare('SELECT * FROM scribes WHERE id = ?').get(id);
    if (!row) throw httpError('Archive dependency Scribe is missing', 409);
    const image = imageFor('scribe', id, options.includeVisuals);
    const record = scribeRecord(row, { hasVisual: Boolean(image), includeWorkingHistory: options.includeWorkingHistory });
    if (image) record.image_media_type = image.mediaType;
    const revisions = db.prepare(`
      SELECT * FROM scribe_revisions WHERE scribe_id = ? ORDER BY revision_number
    `).all(id).map(scribeRevisionRecord);
    return { bundle: { record, revisions }, image };
  }

  function buildStoryBundle(id, options) {
    const row = storyById.get(id);
    if (!row) throw httpError('Archive story is missing', 409);
    const cover = imageFor('story', id, options.includeVisuals);
    const record = storyRecord(row, { hasVisual: Boolean(cover), includeWorkingHistory: options.includeWorkingHistory });
    if (cover) record.image_media_type = cover.mediaType;
    const pageImages = new Map();
    const hierarchy = {
      volumes: db.prepare('SELECT * FROM volumes WHERE story_id = ? ORDER BY ordinal').all(id).map(volumeRecord),
      chapters: db.prepare(`
        SELECT c.* FROM chapters c
        JOIN volumes v ON v.id = c.volume_id
        WHERE v.story_id = ?
        ORDER BY v.ordinal, c.ordinal
      `).all(id).map(chapterRecord),
      scenes: db.prepare(`
        SELECT scene.* FROM scenes scene
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
        WHERE volume.story_id = ?
        ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, scene.id
      `).all(id).map(sceneRecord),
      scene_pages: db.prepare(`
        SELECT membership.* FROM scene_pages membership
        JOIN scenes scene ON scene.id = membership.scene_id
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
        JOIN pages page ON page.id = membership.page_id
        WHERE volume.story_id = ?
        ORDER BY volume.ordinal, chapter.ordinal, page.ordinal, page.id
      `).all(id).map(scenePageRecord),
      pages: db.prepare(`
        SELECT p.* FROM pages p
        JOIN chapters c ON c.id = p.chapter_id
        JOIN volumes v ON v.id = c.volume_id
        WHERE v.story_id = ?
        ORDER BY v.ordinal, c.ordinal, p.ordinal
      `).all(id).map(hierarchyPageRecord),
    };
    const pages = db.prepare('SELECT * FROM manuscript_pages WHERE story_id = ? ORDER BY page_number').all(id)
      .map((page) => {
        const record = pageRecord(page, options);
        const image = page.image_media_type ? imageFor('page', page.id, options.includeVisuals) : null;
        record.image_media_type = image?.mediaType || null;
        if (image) pageImages.set(page.id, image);
        return record;
      });
    const revisions = db.prepare(`
      SELECT r.* FROM page_revisions r
      JOIN pages p ON p.id = r.page_id
      JOIN chapters c ON c.id = p.chapter_id
      JOIN volumes v ON v.id = c.volume_id
      WHERE v.story_id = ?
      ORDER BY v.ordinal, c.ordinal, p.ordinal, r.created_at, r.rowid
    `).all(id).map((revision) => revisionRecord(revision, options));
    const scribeBindings = db.prepare(`
      SELECT * FROM story_scribe_bindings WHERE story_id = ? ORDER BY created_at, rowid
    `).all(id).map(scribeBindingRecord);
    const castIds = new Set(parseCastJson(row.characters).map((entry) => entry.id));
    const snapshots = db.prepare('SELECT * FROM story_character_snapshots WHERE story_id = ? ORDER BY character_id').all(id)
      .filter((snapshot) => castIds.has(snapshot.character_id))
      .map(snapshotRecord);
    // The stable archive-v2 page-keyed continuity projection is now derived
    // from canonical revision rows instead of a second writable database copy.
    const memoryRows = db.prepare(`
      SELECT page.id AS page_id, delta.story_id, delta.content_hash, delta.status,
             delta.summary, delta.delta_json, delta.model, delta.prompt_tokens,
             delta.completion_tokens, delta.spend_usd AS cost_usd, delta.error,
             delta.schema_version, delta.created_at, delta.updated_at
        FROM continuity_deltas delta
        JOIN pages page ON page.canonical_revision_id = delta.revision_id
       WHERE delta.story_id = ? ${options.includeWorkingHistory ? '' : "AND delta.status = 'ready'"}
       ORDER BY delta.created_at, page.id
    `).all(id);
    const memory = memoryRows.map((memoryRow) => memoryRecord(memoryRow, options));
    const deltaRows = options.includeWorkingHistory
      ? db.prepare('SELECT * FROM continuity_deltas WHERE story_id = ? ORDER BY created_at, revision_id').all(id)
      : db.prepare(`
          SELECT delta.* FROM continuity_deltas delta
          JOIN pages page ON page.canonical_revision_id = delta.revision_id
          WHERE delta.story_id = ? AND delta.status = 'ready'
          ORDER BY delta.created_at, delta.revision_id
        `).all(id);
    const continuityDeltas = deltaRows.map((deltaRow) => continuityDeltaRecord(deltaRow, options));
    const templateSnapshots = db.prepare(`
      SELECT * FROM template_snapshots WHERE story_id = ? ORDER BY created_at, rowid
    `).all(id).map(templateSnapshotRecord);
    const corrections = db.prepare(`
      SELECT * FROM continuity_corrections WHERE story_id = ? ORDER BY created_at, rowid
    `).all(id).map(correctionRecord);
    const authorCanonEntries = db.prepare(`
      SELECT * FROM author_canon_entries WHERE story_id = ? ORDER BY created_at, id
    `).all(id).map(authorCanonEntryRecord);
    const authorCanonRevisions = db.prepare(`
      SELECT revision.* FROM author_canon_revisions revision
      JOIN author_canon_entries entry ON entry.id = revision.entry_id
      WHERE entry.story_id = ? ORDER BY entry.created_at, revision.revision_number
    `).all(id).map(authorCanonRevisionRecord);
    // `preview` remains readable on import for schema-1..5 beta archives.
    // Schema 6 writes the durable operation and prepared-page forms instead.
    const preview = options.includeWorkingHistory
      ? (() => {
          const value = db.prepare('SELECT * FROM story_previews WHERE story_id = ?').get(id);
          return value ? previewRecord(value) : null;
        })()
      : null;
    const writingOperations = options.includeWorkingHistory
      ? db.prepare('SELECT * FROM writing_operations WHERE story_id = ? ORDER BY sequence').all(id)
        .map(writingOperationRecord)
      : [];
    const playSessions = options.includeWorkingHistory
      ? db.prepare(`
          SELECT session.* FROM play_sessions session
          JOIN scenes scene ON scene.id = session.scene_id
          JOIN chapters chapter ON chapter.id = scene.chapter_id
          JOIN volumes volume ON volume.id = chapter.volume_id
          WHERE volume.story_id = ?
          ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, session.ordinal
        `).all(id).map(playSessionRecord)
      : [];
    const playTurns = options.includeWorkingHistory
      ? db.prepare(`
          SELECT turn.* FROM play_turns turn
          JOIN play_sessions session ON session.id = turn.session_id
          JOIN scenes scene ON scene.id = session.scene_id
          JOIN chapters chapter ON chapter.id = scene.chapter_id
          JOIN volumes volume ON volume.id = chapter.volume_id
          WHERE volume.story_id = ?
          ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, session.ordinal, turn.ordinal
        `).all(id).map(playTurnRecord)
      : [];
    const playAiRequests = options.includeWorkingHistory
      ? db.prepare(`
          SELECT request.* FROM play_ai_requests request
          JOIN play_sessions session ON session.id = request.session_id
          JOIN scenes scene ON scene.id = session.scene_id
          JOIN chapters chapter ON chapter.id = scene.chapter_id
          JOIN volumes volume ON volume.id = chapter.volume_id
          WHERE volume.story_id = ?
          ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, session.ordinal, request.created_at
        `).all(id).map(playAiRequestRecord)
      : [];
    const preparedPage = options.includeWorkingHistory
      ? (() => {
          const value = db.prepare('SELECT * FROM prepared_pages WHERE story_id = ?').get(id);
          return value ? preparedPageRecord(value) : null;
        })()
      : null;
    let audiobook = null;
    let audioFile = null;
    if (options.includeAudio) {
      const rowAudio = db.prepare("SELECT * FROM audiobooks WHERE story_id = ? AND status = 'ready'").get(id);
      const candidate = path.join(audioDir, `${id}.mp3`);
      if (rowAudio && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        audiobook = audiobookRecord(rowAudio, options);
        audioFile = { path: candidate, size: fs.statSync(candidate).size, mediaType: 'audio/mpeg' };
      }
    }
    const artAssets = options.includeVisuals
      ? db.prepare("SELECT * FROM assets WHERE story_id = ? AND status = 'ready' ORDER BY created_at, id")
        .all(id)
        .filter((asset) => Boolean(artStore.fileInfo(id, asset.id)))
        .map((asset) => ({
          ...pick(asset, ART_ASSET_FIELDS),
          provider_result_json: options.includeWorkingHistory ? asset.provider_result_json : null,
          spend_usd: options.includeWorkingHistory ? asset.spend_usd : 0,
          provider_reference_allowed: false,
        }))
      : [];
    const includedAssetIds = new Set(artAssets.map((asset) => asset.id));
    const assetPlacements = options.includeVisuals
      ? db.prepare(`
          SELECT * FROM asset_placements WHERE story_id = ?
           ORDER BY CASE WHEN after_page_id IS NULL THEN 0 ELSE 1 END,
                    after_page_id, ordinal, id
        `).all(id)
        .filter((placement) => includedAssetIds.has(placement.asset_id))
        .map((placement) => pick(placement, ASSET_PLACEMENT_FIELDS))
      : [];
    const publicationSnapshots = db.prepare(`
      SELECT * FROM publication_snapshots WHERE story_id = ? ORDER BY created_at, id
    `).all(id).map((row) => pick(portablePublicationSnapshotRow(db, row), PUBLICATION_SNAPSHOT_FIELDS));
    return {
      bundle: {
        record,
        hierarchy,
        pages,
        revisions,
        scribe_bindings: scribeBindings,
        snapshots,
        template_snapshots: templateSnapshots,
        memory,
        continuity_deltas: continuityDeltas,
        corrections,
        author_canon_entries: authorCanonEntries,
        author_canon_revisions: authorCanonRevisions,
        writing_operations: writingOperations,
        play_sessions: playSessions,
        play_turns: playTurns,
        play_ai_requests: playAiRequests,
        prepared_page: preparedPage,
        preview,
        audiobook,
        art_assets: artAssets,
        asset_placements: assetPlacements,
        publication_snapshots: publicationSnapshots,
      },
      cover,
      pageImages,
      audioFile,
      artAssets,
    };
  }

  async function addImageAsset(assets, { ownerKind, ownerId, storyId = null, pageNumber = null, file }) {
    if (!file) return;
    assets.push({
      kind: 'image',
      owner_kind: ownerKind,
      owner_id: ownerId,
      story_id: storyId,
      page_number: pageNumber,
      archive_path: mediaArchivePath(ownerKind, ownerId, file.path),
      media_type: file.mediaType,
      size_bytes: file.size,
      sha256: await hashFile(file.path),
      source_path: file.path,
    });
  }

  async function createEntity(kind, id, bundle, dependencies) {
    const buffer = jsonBuffer(bundle);
    return {
      kind,
      id,
      name: kind === 'story' ? bundle.record.title : bundle.record.name,
      path: objectPath(kind, id),
      sha256: sha256(buffer),
      semantic_sha256: semanticHash(kind, bundle, { includeScribes: true }),
      size_bytes: buffer.length,
      dependencies,
      buffer,
      bundle,
    };
  }

  async function planExport(rawInput) {
    const options = normalizeOptions(rawInput || {});
    const selection = selectedIds(options);
    const entities = [];
    const assets = [];

    for (const id of selection.worlds) {
      const { bundle, image } = buildWorldBundle(id, options);
      entities.push(await createEntity('world', id, bundle, []));
      await addImageAsset(assets, { ownerKind: 'world', ownerId: id, file: image });
    }
    for (const id of selection.characters) {
      const { bundle, image } = buildCharacterBundle(id, options);
      const dependencies = bundle.record.world_id ? [{ kind: 'world', id: bundle.record.world_id }] : [];
      entities.push(await createEntity('character', id, bundle, dependencies));
      await addImageAsset(assets, { ownerKind: 'character', ownerId: id, file: image });
    }
    for (const id of selection.scribes) {
      const { bundle, image } = buildScribeBundle(id, options);
      entities.push(await createEntity('scribe', id, bundle, []));
      await addImageAsset(assets, { ownerKind: 'scribe', ownerId: id, file: image });
    }
    for (const id of selection.stories) {
      const { bundle, cover, pageImages, audioFile, artAssets } = buildStoryBundle(id, options);
      const dependencies = [];
      if (bundle.record.world_id) dependencies.push({ kind: 'world', id: bundle.record.world_id });
      for (const cast of bundle.record.characters) dependencies.push({ kind: 'character', id: cast.id });
      for (const binding of bundle.scribe_bindings || []) {
        if (binding.source_scribe_id && selection.scribes.has(binding.source_scribe_id)) {
          dependencies.push({ kind: 'scribe', id: binding.source_scribe_id });
        }
      }
      entities.push(await createEntity('story', id, bundle, dependencies));
      await addImageAsset(assets, { ownerKind: 'story', ownerId: id, storyId: id, file: cover });
      for (const page of bundle.pages) {
        if (!page.image_media_type || !options.includeVisuals) continue;
        await addImageAsset(assets, {
          ownerKind: 'page',
          ownerId: page.id,
          storyId: id,
          pageNumber: page.page_number,
          file: pageImages.get(page.id),
        });
      }
      for (const asset of artAssets) {
        await addImageAsset(assets, {
          ownerKind: 'asset',
          ownerId: asset.id,
          storyId: id,
          file: artStore.fileInfo(id, asset.id),
        });
      }
      if (audioFile) {
        assets.push({
          kind: 'audio',
          owner_kind: 'story',
          owner_id: id,
          story_id: id,
          page_number: null,
          archive_path: `assets/audio/${sha256(`story:${id}`).slice(0, 24)}.mp3`,
          media_type: 'audio/mpeg',
          size_bytes: audioFile.size,
          sha256: await hashFile(audioFile.path),
          source_path: audioFile.path,
        });
      }
    }

    const pages = entities
      .filter((entity) => entity.kind === 'story')
      .reduce((sum, entity) => sum + entity.bundle.pages.length, 0);
    const memory = entities
      .filter((entity) => entity.kind === 'story')
      .reduce((sum, entity) => sum + (entity.bundle.continuity_deltas?.length || entity.bundle.memory.length), 0);
    const authorCanonEntries = entities
      .filter((entity) => entity.kind === 'story')
      .reduce((sum, entity) => sum + (entity.bundle.author_canon_entries?.length || 0), 0);
    const publicationSnapshots = entities.reduce((sum, entity) => sum + (entity.bundle.publication_snapshots?.length || 0), 0);
    const publicationSnapshotImages = entities.reduce((sum, entity) => sum +
      (entity.bundle.publication_snapshots || []).reduce((snapshotSum, snapshot) => {
        try {
          const document = JSON.parse(snapshot.document_json);
          return snapshotSum + (Array.isArray(document.assets) ? document.assets.length : 0);
        } catch { return snapshotSum; }
      }, 0), 0);
    const exposure = {
      worlds: selection.worlds.size,
      characters: selection.characters.size,
      scribes: selection.scribes.size,
      stories: selection.stories.size,
      pages,
      continuity_rows: memory,
      author_canon_entries: authorCanonEntries,
      images: assets.filter((asset) => asset.kind === 'image').length,
      audio_files: assets.filter((asset) => asset.kind === 'audio').length,
      includes_author_directions: options.includeWorkingHistory,
      publication_snapshots: publicationSnapshots,
      publication_snapshot_images: publicationSnapshotImages,
      includes_model_and_cost_history: options.includeWorkingHistory,
      includes_device_settings: Boolean(options.settings),
      excluded: [
        'API keys', 'credentials', 'secret vault material', 'passwords',
        'authentication owner and sessions', 'paid-action consent',
        'recovery suffixes and undo credentials',
        'publication share capabilities and share records',
      ],
      external_worlds: selection.externalWorlds,
    };

    const manifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      manifest_schema_version: ARCHIVE_MANIFEST_SCHEMA_VERSION,
      database_schema: {
        family: DATABASE_FAMILY,
        version: DATABASE_SCHEMA_VERSION,
      },
      created_at: new Date().toISOString(),
      created_by: { application: 'Ink Morrow', version: appVersion },
      scope: options.scope,
      options: {
        include_visuals: options.includeVisuals,
        include_audio: options.includeAudio,
        include_working_history: options.includeWorkingHistory,
      },
      settings: options.settings,
      entities: entities.map(({ buffer, bundle, ...entity }) => entity),
      assets: assets.map(({ source_path, ...asset }) => asset),
      exposure,
    };
    const manifestBuffer = jsonBuffer(manifest);
    const estimatedBytes = manifestBuffer.length +
      entities.reduce((sum, entity) => sum + entity.size_bytes, 0) +
      assets.reduce((sum, asset) => sum + asset.size_bytes, 0);
    const filename = archiveFilename(options.scope, selection.rootName);
    return {
      options,
      filename,
      manifest,
      manifestBuffer,
      entities,
      assets,
      estimatedBytes,
      publicPlan: {
        filename,
        scope: options.scope,
        options: manifest.options,
        exposure,
        estimated_bytes: estimatedBytes,
        entity_count: entities.length,
        asset_count: assets.length,
      },
    };
  }

  function localBundle(kind, id, archiveOptions = {}) {
    const options = {
      includeVisuals: archiveOptions.include_visuals !== false,
      includeAudio: archiveOptions.include_audio === true,
      includeWorkingHistory: archiveOptions.include_working_history === true,
    };
    if (kind === 'world') return buildWorldBundle(id, options).bundle;
    if (kind === 'character') return buildCharacterBundle(id, options).bundle;
    if (kind === 'scribe') return buildScribeBundle(id, options).bundle;
    if (kind === 'story') return buildStoryBundle(id, options).bundle;
    return null;
  }

  return { planExport, localBundle, normalizeOptions };
}

module.exports = { createExportPlanner, hashFile, httpError };
