'use strict';

// Stories feature store: story/page/preview SQL and the transactions that
// keep numbering, timestamps, and speculative-preview invalidation honest.

const { v4: uuidv4 } = require('uuid');
const { optionalText, asString, TONES } = require('../../core/validation');
const { normalizeCast, validateCastPayload, parseCastJson } = require('./cast');

function createStoriesStore(db, { getWorld }) {
  const getStory = (id) => db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  const storyPages = (storyId) =>
    db.prepare('SELECT * FROM story_pages WHERE story_id = ? ORDER BY page_number').all(storyId);
  const getPageByNumber = (storyId, number) =>
    db.prepare('SELECT * FROM story_pages WHERE story_id = ? AND page_number = ?').get(storyId, number);
  const getPageById = (id) => db.prepare('SELECT * FROM story_pages WHERE id = ?').get(id);

  const storyWithMeta = (story) => ({
    ...story,
    characters: normalizeCast(JSON.parse(story.characters || '[]')),
    page_count: db.prepare('SELECT COUNT(*) AS c FROM story_pages WHERE story_id = ?').get(story.id).c,
    total_cost_usd: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM story_pages WHERE story_id = ?').get(story.id).s,
  });

  // -- speculative previews ------------------------------------------------
  // One prepared-but-unsaved next page per story, in the DATABASE so it
  // survives restarts. Single-use, invalidated by every live write.
  const upsertPreview = db.prepare(
    'INSERT OR REPLACE INTO story_previews (story_id, expected_page, raw_content, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const getPreview = db.prepare('SELECT * FROM story_previews WHERE story_id = ?');
  const deletePreview = db.prepare('DELETE FROM story_previews WHERE story_id = ?');

  function invalidatePreview(storyId) {
    deletePreview.run(storyId);
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

    return { title, world_id, tone, cast };
  }

  // -- story CRUD ------------------------------------------------------------
  function listStories(worldId = null) {
    return worldId
      ? db.prepare('SELECT * FROM stories WHERE world_id = ? ORDER BY updated_at DESC').all(worldId)
      : db.prepare('SELECT * FROM stories ORDER BY updated_at DESC').all();
  }

  function deleteStoryCascade(storyId) {
    db.prepare('DELETE FROM story_pages WHERE story_id = ?').run(storyId);
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
  }

  function createStory(payload) {
    const id = uuidv4();
    db.prepare('INSERT INTO stories (id, title, world_id, characters, tone) VALUES (?, ?, ?, ?, ?)').run(
      id, payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone
    );
    return getStory(id);
  }

  function updateStory(storyId, payload) {
    db.prepare(
      'UPDATE stories SET title = ?, world_id = ?, characters = ?, tone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone, storyId);
    return getStory(storyId);
  }

  // -- pages ------------------------------------------------------------------
  function nextPageNumber(storyId) {
    return db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM story_pages WHERE story_id = ?').get(storyId).n;
  }

  function insertGeneratedPage(storyId, { content, userInput, model, promptTokens, completionTokens, costUsd, pageNumber }) {
    const id = uuidv4();
    db.prepare(
      'INSERT INTO story_pages (id, story_id, page_number, content, user_input, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, storyId, pageNumber ?? nextPageNumber(storyId), content, userInput ?? null,
      model ?? null, promptTokens ?? null, completionTokens ?? null, costUsd ?? null);
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return getPageById(id);
  }

  function insertManualPage(storyId, content, userInput) {
    const id = uuidv4();
    db.prepare('INSERT INTO story_pages (id, story_id, page_number, content, user_input) VALUES (?, ?, ?, ?, ?)').run(
      id, storyId, nextPageNumber(storyId), content, userInput
    );
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return getPageById(id);
  }

  // Delete one page and renumber every later page DOWN one slot inside a
  // single transaction, so numbering stays contiguous 1..N. Later rows are
  // decremented one-by-one in page_number ASC order — a bulk UPDATE's row
  // order can violate UNIQUE(story_id, page_number). Surviving page IDs (and
  // the plate files keyed by them) keep their identity; only the deleted
  // page's plate file is removed (by the route, after this commits).
  function deletePage(page) {
    const later = db
      .prepare('SELECT id FROM story_pages WHERE story_id = ? AND page_number > ? ORDER BY page_number ASC')
      .all(page.story_id, page.page_number);
    const bump = db.prepare('UPDATE story_pages SET page_number = page_number - 1 WHERE id = ?');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM story_pages WHERE id = ?').run(page.id);
      for (const row of later) bump.run(row.id);
      deletePreview.run(page.story_id);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(page.story_id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  // Delete every page AFTER the given page number. Plate files are cleaned
  // by the caller (imagery store) via the onPlate callback.
  function truncateAfter(storyId, after, onPlate) {
    const doomed = db
      .prepare('SELECT id, image_media_type FROM story_pages WHERE story_id = ? AND page_number > ?')
      .all(storyId, after);
    for (const page of doomed) {
      if (page.image_media_type) onPlate(page.id);
    }
    const result = db
      .prepare('DELETE FROM story_pages WHERE story_id = ? AND page_number > ?')
      .run(storyId, after);
    return { deleted: result.changes, remaining: storyPages(storyId).length };
  }

  // Insert a painted plate row after page `after`, renumbering later pages
  // one-by-one from the highest down so the UNIQUE(story_id, page_number)
  // constraint never sees a collision.
  function insertImagePage(storyId, after, { mediaType, imagePrompt, cost }) {
    const id = uuidv4();
    const insert = db.prepare(
      'INSERT INTO story_pages (id, story_id, page_number, content, user_input, cost_usd, image_media_type, image_prompt) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)'
    );
    const bump = db.prepare('UPDATE story_pages SET page_number = page_number + 1 WHERE id = ?');
    const later = db
      .prepare('SELECT id FROM story_pages WHERE story_id = ? AND page_number > ? ORDER BY page_number DESC')
      .all(storyId, after);
    db.exec('BEGIN');
    try {
      for (const row of later) bump.run(row.id);
      insert.run(id, storyId, after + 1, '', typeof cost === 'number' ? cost : null, mediaType, imagePrompt);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return getPageById(id);
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
    upsertPreview,
    getPreview,
    invalidatePreview,
    validateStoryPayload,
    createStory,
    updateStory,
    nextPageNumber,
    insertGeneratedPage,
    insertManualPage,
    deletePage,
    truncateAfter,
    insertImagePage,
    removeCharacterFromCasts,
  };
}

module.exports = { createStoriesStore };
