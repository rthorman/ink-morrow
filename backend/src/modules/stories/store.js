'use strict';

// Stories feature store: story/page/preview SQL and the transactions that
// keep numbering, timestamps, and speculative-preview invalidation honest.

const { randomUUID } = require('node:crypto');
const { optionalText, asString, TONES } = require('../../core/validation');
const { normalizeCast, validateCastPayload, parseCastJson } = require('./cast');
const { createHierarchyStore } = require('./hierarchy');
const { createRevisionStore } = require('./revisions');
const { createSceneStore } = require('./scenes');

function createStoriesStore(db, { getWorld, scribes = null, recoveryRetentionDays, clock }) {
  const hierarchy = createHierarchyStore(db);
  const scenes = createSceneStore(db, { hierarchy });
  const getStory = (id) => db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  const storyPages = (storyId) =>
    db.prepare(`
      SELECT projected.*, membership.scene_id, scene.title AS scene_title,
             scene.mode AS scene_mode, scene.status AS scene_status
        FROM manuscript_pages projected
        LEFT JOIN scene_pages membership ON membership.page_id = projected.id
        LEFT JOIN scenes scene ON scene.id = membership.scene_id
       WHERE projected.story_id = ? ORDER BY projected.page_number
    `).all(storyId);
  const getPageByNumber = (storyId, number) =>
    db.prepare(`
      SELECT projected.*, membership.scene_id, scene.title AS scene_title,
             scene.mode AS scene_mode, scene.status AS scene_status
        FROM manuscript_pages projected
        LEFT JOIN scene_pages membership ON membership.page_id = projected.id
        LEFT JOIN scenes scene ON scene.id = membership.scene_id
       WHERE projected.story_id = ? AND projected.page_number = ?
    `).get(storyId, number);
  const getPageById = (id) => db.prepare(`
    SELECT projected.*, membership.scene_id, scene.title AS scene_title,
           scene.mode AS scene_mode, scene.status AS scene_status
      FROM manuscript_pages projected
      LEFT JOIN scene_pages membership ON membership.page_id = projected.id
      LEFT JOIN scenes scene ON scene.id = membership.scene_id
     WHERE projected.id = ?
  `).get(id);
  // In-flight preview generation cannot be cancelled at the provider. Keep a
  // process-local context revision so a reply produced against an invalidated
  // story can be billed honestly without being allowed to resurrect itself in
  // story_previews. A restart also ends every in-flight request, so this does
  // not need to be durable.
  const previewRevisions = new Map();

  const storyWithMeta = (story) => ({
    ...story,
    characters: normalizeCast(JSON.parse(story.characters || '[]')),
    continuity_overrides: JSON.parse(story.continuity_overrides || '{}'),
    page_count: db.prepare('SELECT COUNT(*) AS c FROM manuscript_pages WHERE story_id = ?').get(story.id).c,
    scene_count: db.prepare(`
      SELECT COUNT(*) AS c
        FROM scenes scene
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE volume.story_id = ?
    `).get(story.id).c,
    total_cost_usd:
      db.prepare(
        'SELECT COALESCE(SUM(COALESCE(cost_usd, 0) + COALESCE(continuity_cost_usd, 0)), 0) AS s FROM manuscript_pages WHERE story_id = ?'
      ).get(story.id).s +
      db.prepare(
        "SELECT COALESCE(SUM(spend_usd), 0) AS s FROM assets WHERE story_id = ? AND status = 'ready' AND source = 'ai-generated'"
      ).get(story.id).s,
    scribe: scribes?.forStory(story.id) || null,
  });

  const storyWithHierarchy = (story) => ({
    ...storyWithMeta(story),
    hierarchy: hierarchy.buildHierarchy(story.id),
  });

  const insertSnapshot = db.prepare(`
    INSERT OR IGNORE INTO story_character_snapshots
      (story_id, character_id, name, description, personality, appearance, background, source_updated_at)
    SELECT ?, id, name, description, personality, appearance, background, updated_at
      FROM characters WHERE id = ?
  `);
  const insertCharacterTemplateSnapshot = db.prepare(`
    INSERT INTO template_snapshots
      (id, story_id, template_kind, source_template_id, source_revision, snapshot_json)
    SELECT ?, ?, 'character', character.id, character.updated_at,
           json_object('name', character.name, 'description', character.description,
                       'personality', character.personality, 'appearance', character.appearance,
                       'background', character.background)
      FROM characters character
     WHERE character.id = ?
       AND NOT EXISTS (
         SELECT 1 FROM template_snapshots snapshot
          WHERE snapshot.story_id = ? AND snapshot.template_kind = 'character'
            AND snapshot.source_template_id = character.id
       )
  `);
  const insertWorldTemplateSnapshot = db.prepare(`
    INSERT INTO template_snapshots
      (id, story_id, template_kind, source_template_id, source_revision, snapshot_json)
    SELECT ?, ?, 'world', world.id, world.updated_at,
           json_object('name', world.name, 'description', world.description,
                       'genre', world.genre, 'setting', world.setting, 'lore', world.lore)
      FROM worlds world
     WHERE world.id = ?
       AND NOT EXISTS (
         SELECT 1 FROM template_snapshots snapshot
          WHERE snapshot.story_id = ? AND snapshot.template_kind = 'world'
            AND snapshot.source_template_id = world.id
       )
  `);

  // A cast member is copied once. Catalogue edits can improve the reusable
  // template without silently rewriting the identity already cast in a tale.
  function ensureCastSnapshots(storyId, cast) {
    for (const entry of cast || []) {
      insertSnapshot.run(storyId, entry.id);
      insertCharacterTemplateSnapshot.run(randomUUID(), storyId, entry.id, storyId);
    }
  }

  function ensureWorldSnapshot(storyId, worldId) {
    if (worldId) insertWorldTemplateSnapshot.run(randomUUID(), storyId, worldId, storyId);
  }

  function syncSceneViewpoints(storyId, cast) {
    const castIds = new Set((cast || []).map((entry) => typeof entry === 'string' ? entry : entry.id));
    const rows = db.prepare(`
      SELECT scene.id, scene.viewpoint_character_id
        FROM scenes scene
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE volume.story_id = ? AND scene.viewpoint_character_id IS NOT NULL
    `).all(storyId);
    const clear = db.prepare(`
      UPDATE scenes SET viewpoint_character_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    for (const row of rows) {
      if (!castIds.has(row.viewpoint_character_id)) clear.run(row.id);
    }
  }

  // -- speculative previews ------------------------------------------------
  // One prepared-but-unsaved next page per story, in the DATABASE so it
  // survives restarts. Single-use, invalidated by every live write.
  const upsertPreview = db.prepare(
    'INSERT OR REPLACE INTO story_previews (story_id, expected_page, raw_content, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const getPreview = db.prepare('SELECT * FROM story_previews WHERE story_id = ?');
  const deletePreview = db.prepare('DELETE FROM story_previews WHERE story_id = ?');
  const deletePreparedPage = db.prepare('DELETE FROM prepared_pages WHERE story_id = ?');
  const supersedePreparing = db.prepare(`
    UPDATE writing_operations
       SET status = 'superseded', error_code = 'CONTEXT_CHANGED',
           error_message = 'The story context changed before this operation finished.',
           updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP
     WHERE story_id = ? AND kind = 'prepare' AND status IN ('requested', 'running')
  `);

  function markPreviewInvalidated(storyId) {
    previewRevisions.set(storyId, (previewRevisions.get(storyId) || 0) + 1);
  }

  function invalidatePreview(storyId) {
    deletePreview.run(storyId);
    deletePreparedPage.run(storyId);
    supersedePreparing.run(storyId);
    markPreviewInvalidated(storyId);
  }

  function previewRevision(storyId) {
    return previewRevisions.get(storyId) || 0;
  }

  const revisions = createRevisionStore(db, {
    hierarchy,
    invalidatePreview,
    recoveryRetentionDays,
    clock,
  });

  function invalidatePreviewsForWorld(worldId) {
    const storyIds = db.prepare('SELECT id FROM stories WHERE world_id = ?').all(worldId);
    for (const { id } of storyIds) invalidatePreview(id);
  }

  // -- payload validation ----------------------------------------------------
  function validateStoryPayload(body, { partial = false, existing = null } = {}) {
    const title = body.title === undefined
      ? (partial ? existing.title : null)
      : optionalText(body.title, { max: 300 });
    if (title === null || title === undefined) return { error: '"title" is required' };

    let world_id = existing ? existing.world_id : null;
    if (body.world_id !== undefined) {
      world_id = body.world_id === null || body.world_id === '' ? null : asString(body.world_id);
      if (world_id && !getWorld(world_id)) return { error: 'world_id does not reference an existing world' };
    }

    let tone = existing ? existing.tone : 'fade-to-black';
    if (body.tone !== undefined) {
      tone = asString(body.tone);
      if (!TONES.includes(tone)) return { error: `"tone" must be one of: ${TONES.join(', ')}` };
    }

    let cast = existing ? parseCastJson(existing.characters) : [];
    if (body.characters !== undefined) {
      const result = validateCastPayload(body.characters, (id) =>
        Boolean(db.prepare('SELECT id FROM characters WHERE id = ?').get(id))
      );
      if (result.error) return { error: result.error };
      cast = result.cast;
    }

    let scribe_id = existing && scribes ? scribes.forStory(existing.id)?.source_scribe_id || null : null;
    if (body.scribe_id !== undefined) {
      scribe_id = body.scribe_id === null || body.scribe_id === '' ? null : asString(body.scribe_id);
      if (scribe_id && (!scribes || !scribes.getScribe(scribe_id))) {
        return { error: 'scribe_id does not reference an existing Scribe' };
      }
    }

    return { title, world_id, tone, cast, scribe_id, scribe_changed: body.scribe_id !== undefined };
  }

  // -- story CRUD ------------------------------------------------------------
  function listStories(worldId = null) {
    return worldId
      ? db.prepare('SELECT * FROM stories WHERE world_id = ? ORDER BY updated_at DESC').all(worldId)
      : db.prepare('SELECT * FROM stories ORDER BY updated_at DESC').all();
  }

  function deleteStoryCascade(storyId) {
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
  }

  function createStory(payload) {
    const id = randomUUID();
    hierarchy.inImmediateTransaction(() => {
      db.prepare('INSERT INTO stories (id, title, world_id, characters, tone) VALUES (?, ?, ?, ?, ?)').run(
        id, payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone
      );
      ensureCastSnapshots(id, payload.cast);
      ensureWorldSnapshot(id, payload.world_id);
      if (payload.scribe_id) scribes?.bindStoryInTransaction(id, payload.scribe_id);
      hierarchy.ensureDefaultInTransaction(id);
    });
    return getStory(id);
  }

  function updateStory(storyId, payload) {
    hierarchy.inImmediateTransaction(() => {
      db.prepare(
        'UPDATE stories SET title = ?, world_id = ?, characters = ?, tone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone, storyId);
      ensureCastSnapshots(storyId, payload.cast);
      ensureWorldSnapshot(storyId, payload.world_id);
      syncSceneViewpoints(storyId, payload.cast);
      if (payload.scribe_changed) scribes?.bindStoryInTransaction(storyId, payload.scribe_id);
    });
    invalidatePreview(storyId);
    return getStory(storyId);
  }

  function bindScribe(storyId, scribeId) {
    hierarchy.inImmediateTransaction(() => scribes?.bindStoryInTransaction(storyId, scribeId));
    invalidatePreview(storyId);
    return scribes?.forStory(storyId) || null;
  }

  function setImageDeleted(storyId) {
    db.prepare(
      "UPDATE stories SET image_status = 'deleted', image_media_type = NULL, image_cost_usd = NULL, image_updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(storyId);
  }

  // -- pages ------------------------------------------------------------------
  function nextPageNumber(storyId) {
    return db.prepare('SELECT COUNT(*) + 1 AS n FROM manuscript_pages WHERE story_id = ?').get(storyId).n;
  }

  function insertGeneratedPageInTransaction(storyId, {
    content, userInput, model, promptTokens, completionTokens, costUsd, pageNumber, scribeBindingId = null,
  }) {
    const id = randomUUID();
    const expectedPage = pageNumber ?? nextPageNumber(storyId);
    if (expectedPage !== nextPageNumber(storyId)) throw new Error('The manuscript tail changed before the page could be stored');
    hierarchy.insertTailPageInTransaction(storyId, id);
    const revision = revisions.createInitialRevisionInTransaction(id, {
      content,
      direction: userInput ?? null,
      source: model ? 'ai' : 'author',
      model: model ?? null,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      costUsd,
      scribeBindingId,
    });
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    revisions.journalInTransaction('page.create', storyId, 'page', id, {
      source: model ? 'ai' : 'author',
    }, { page_id: id, revision_id: revision.id });
    return { page: getPageById(id), revision };
  }

  function insertGeneratedPage(storyId, input) {
    let result;
    hierarchy.inImmediateTransaction(() => {
      result = insertGeneratedPageInTransaction(storyId, input);
    });
    return result.page;
  }

  function insertManualPage(storyId, content, userInput) {
    const id = randomUUID();
    hierarchy.inImmediateTransaction(() => {
      hierarchy.insertTailPageInTransaction(storyId, id);
      const revision = revisions.createInitialRevisionInTransaction(id, {
        content,
        direction: userInput,
        source: 'author',
      });
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      revisions.journalInTransaction('page.create', storyId, 'page', id, {
        source: 'author',
      }, { page_id: id, revision_id: revision.id });
    });
    return getPageById(id);
  }

  // Replace a generated page only after its successor text exists. The old
  // page and memory remain intact during the paid call; this transaction is
  // the regeneration boundary. The UPDATE trigger invalidates its old delta.
  function replaceGeneratedPage(pageId, { content, model, promptTokens, completionTokens, costUsd }) {
    const old = getPageById(pageId);
    if (!old) return null;
    const edited = revisions.tailEdit(old.story_id, pageId, {
      content,
      direction: old.user_input,
      source: 'ai',
      model: model ?? null,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      costUsd,
    });
    return edited?.page || null;
  }

  // Delete one page and renumber every later page DOWN one slot inside a
  // single transaction, so numbering stays contiguous 1..N. Later rows are
  // decremented one-by-one in page_number ASC order — a bulk UPDATE's row
  // order can violate UNIQUE(story_id, page_number). Surviving page IDs (and
  // the plate files keyed by them) keep their identity; only the deleted
  // page's plate file is removed (by the route, after this commits).
  function deletePage(page) {
    hierarchy.inImmediateTransaction(() => {
      hierarchy.removePageInTransaction(page.id);
      deletePreview.run(page.story_id);
      deletePreparedPage.run(page.story_id);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(page.story_id);
      revisions.journalInTransaction('page.delete', page.story_id, 'page', page.id, {
        page_number: page.page_number,
      }, { page_id: page.id, deleted: true });
    });
    previewRevisions.set(page.story_id, (previewRevisions.get(page.story_id) || 0) + 1);
  }

  // Delete every page AFTER the given page number. Plate files are cleaned
  // by the caller (imagery store) via the onPlate callback.
  function truncateAfter(storyId, after, options) {
    return revisions.truncateAfter(storyId, after, options);
  }

  // Remove a deleted character from every story cast that references it.
  function removeCharacterFromCasts(characterId) {
    const stories = db.prepare('SELECT id, characters FROM stories').all();
    const update = db.prepare('UPDATE stories SET characters = ? WHERE id = ?');
    for (const story of stories) {
      const cast = JSON.parse(story.characters || '[]');
      const idOf = (entry) => (typeof entry === 'string' ? entry : entry && entry.id);
      if (cast.some((entry) => idOf(entry) === characterId)) {
        update.run(JSON.stringify(cast.filter((entry) => idOf(entry) !== characterId)), story.id);
        syncSceneViewpoints(story.id, cast.filter((entry) => idOf(entry) !== characterId));
        invalidatePreview(story.id);
        db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(story.id);
      }
    }
  }

  return {
    getStory,
    listStories,
    deleteStoryCascade,
    storyPages,
    getPageByNumber,
    getPageById,
    storyWithMeta,
    storyWithHierarchy,
    hierarchy,
    scenes,
    revisions,
    upsertPreview,
    getPreview,
    invalidatePreview,
    markPreviewInvalidated,
    invalidatePreviewsForWorld,
    bindScribe,
    previewRevision,
    validateStoryPayload,
    createStory,
    updateStory,
    ensureCastSnapshots,
    setImageDeleted,
    nextPageNumber,
    insertGeneratedPage,
    insertGeneratedPageInTransaction,
    insertManualPage,
    replaceGeneratedPage,
    deletePage,
    truncateAfter,
    removeCharacterFromCasts,
  };
}

module.exports = { createStoriesStore };
