'use strict';

// Manuscript hierarchy owns stable structural identity. Prose and generation
// accounting live only in immutable revisions; manuscript_pages is the
// read-only ordered projection used at API boundaries.

const { randomUUID } = require('node:crypto');

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function romanNumeral(value) {
  if (!Number.isSafeInteger(value) || value < 1) return String(value);
  const numerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = value;
  let result = '';
  for (const [amount, glyph] of numerals) {
    while (remaining >= amount) {
      result += glyph;
      remaining -= amount;
    }
  }
  return result;
}

function createHierarchyStore(db) {
  const getVolumeStatement = db.prepare(`
    SELECT v.*
      FROM volumes v
     WHERE v.id = ? AND v.story_id = ?
  `);
  const getChapterStatement = db.prepare(`
    SELECT c.*, v.story_id
      FROM chapters c
      JOIN volumes v ON v.id = c.volume_id
     WHERE c.id = ? AND v.story_id = ?
  `);
  const activeVolumeStatement = db.prepare(`
    SELECT * FROM volumes
     WHERE story_id = ?
     ORDER BY ordinal DESC
     LIMIT 1
  `);
  const activeChapterStatement = db.prepare(`
    SELECT * FROM chapters
     WHERE volume_id = ?
     ORDER BY ordinal DESC
     LIMIT 1
  `);

  function inImmediateTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  function getVolume(storyId, volumeId) {
    return getVolumeStatement.get(volumeId, storyId);
  }

  function getChapter(storyId, chapterId) {
    return getChapterStatement.get(chapterId, storyId);
  }

  function activeVolume(storyId) {
    return activeVolumeStatement.get(storyId);
  }

  // Called inside the story-creation/page-write transaction. It also repairs
  // a story whose empty structural containers were removed manually.
  function ensureDefaultInTransaction(storyId) {
    let volume = activeVolume(storyId);
    if (!volume) {
      const id = randomUUID();
      db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, 1, ?)')
        .run(id, storyId, 'Volume I');
      volume = getVolume(storyId, id);
    }
    let chapter = activeChapterStatement.get(volume.id);
    if (!chapter) {
      const id = randomUUID();
      db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, 1, ?)')
        .run(id, volume.id, 'Chapter I');
      chapter = getChapter(storyId, id);
    }
    return { volume, chapter };
  }

  function insertTailPageInTransaction(storyId, pageId) {
    const { chapter } = ensureDefaultInTransaction(storyId);
    const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM pages WHERE chapter_id = ?')
      .get(chapter.id).value;
    db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)')
      .run(pageId, chapter.id, ordinal);
    return { chapter_id: chapter.id, ordinal };
  }

  function insertPageAfterInTransaction(storyId, afterPageId, pageId) {
    const anchor = db.prepare(`
      SELECT p.chapter_id, p.ordinal
        FROM pages p
        JOIN chapters c ON c.id = p.chapter_id
        JOIN volumes v ON v.id = c.volume_id
       WHERE p.id = ? AND v.story_id = ?
    `).get(afterPageId, storyId);
    if (!anchor) return insertTailPageInTransaction(storyId, pageId);
    const later = db.prepare('SELECT id FROM pages WHERE chapter_id = ? AND ordinal > ? ORDER BY ordinal DESC')
      .all(anchor.chapter_id, anchor.ordinal);
    const bump = db.prepare('UPDATE pages SET ordinal = ordinal + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    for (const row of later) bump.run(row.id);
    const ordinal = anchor.ordinal + 1;
    db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)')
      .run(pageId, anchor.chapter_id, ordinal);
    return { chapter_id: anchor.chapter_id, ordinal };
  }

  function removePageInTransaction(pageId) {
    const placement = db.prepare('SELECT chapter_id, ordinal FROM pages WHERE id = ?').get(pageId);
    if (!placement) return false;
    const later = db.prepare('SELECT id FROM pages WHERE chapter_id = ? AND ordinal > ? ORDER BY ordinal ASC')
      .all(placement.chapter_id, placement.ordinal);
    const bump = db.prepare('UPDATE pages SET ordinal = ordinal - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    db.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
    for (const row of later) bump.run(row.id);
    return true;
  }

  function buildHierarchy(storyId) {
    const volumes = db.prepare(`
      SELECT id, story_id, ordinal, title, created_at, updated_at
        FROM volumes
       WHERE story_id = ?
       ORDER BY ordinal
    `).all(storyId).map((volume) => ({ ...volume, chapters: [] }));
    const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
    const chapters = db.prepare(`
      SELECT c.id, c.volume_id, c.ordinal, c.title, c.created_at, c.updated_at
        FROM chapters c
        JOIN volumes v ON v.id = c.volume_id
       WHERE v.story_id = ?
       ORDER BY v.ordinal, c.ordinal
    `).all(storyId).map((chapter) => ({ ...chapter, scenes: [], pages: [] }));
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    for (const chapter of chapters) volumeById.get(chapter.volume_id)?.chapters.push(chapter);

    const scenes = db.prepare(`
      SELECT scene.id, scene.chapter_id, scene.ordinal, scene.title, scene.mode,
             scene.status, scene.viewpoint_character_id, scene.location,
             scene.story_time, scene.purpose, scene.stakes,
             scene.created_at, scene.updated_at
        FROM scenes scene
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE volume.story_id = ?
       ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, scene.id
    `).all(storyId).map((scene) => ({ ...scene, page_ids: [], page_range: null }));
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
    for (const scene of scenes) chapterById.get(scene.chapter_id)?.scenes.push(scene);

    const pages = db.prepare(`
       SELECT p.id, p.chapter_id, p.ordinal, p.created_at, p.updated_at,
              p.canonical_revision_id, p.display_revision_id, NULL AS image_media_type,
              SUBSTR(COALESCE(display_revision.content, ''), 1, 240) AS excerpt,
              COALESCE(delta.status, 'pending') AS continuity_status,
              delta.error AS continuity_error,
              delta.error_code AS continuity_error_code,
              delta.model AS continuity_model,
              membership.scene_id, scene.title AS scene_title,
              scene.mode AS scene_mode, scene.status AS scene_status,
             (SELECT COUNT(*)
                FROM asset_placements placement
               WHERE placement.story_id = v.story_id AND placement.after_page_id = p.id) AS art_count
        FROM pages p
        JOIN chapters c ON c.id = p.chapter_id
        JOIN volumes v ON v.id = c.volume_id
        LEFT JOIN page_revisions display_revision ON display_revision.id = p.display_revision_id
        LEFT JOIN continuity_deltas delta ON delta.revision_id = p.canonical_revision_id
        LEFT JOIN scene_pages membership ON membership.page_id = p.id
        LEFT JOIN scenes scene ON scene.id = membership.scene_id
       WHERE v.story_id = ?
       ORDER BY v.ordinal, c.ordinal, p.ordinal
    `).all(storyId);
    pages.forEach((page, index) => {
      const excerpt = String(page.excerpt || '');
      const projectedPage = {
        id: page.id,
        ordinal: page.ordinal,
        display_number: index + 1,
        kind: page.image_media_type ? 'image' : 'text',
        excerpt,
        has_scene_break: /(^|\n)\s*(?:\*{3,}|-{3,}|#(?:\s+#){2,})\s*(?:\n|$)/.test(excerpt),
        continuity_status: page.continuity_status,
        continuity_error: page.continuity_error || null,
        continuity_error_code: page.continuity_error_code || null,
        continuity_model: page.continuity_model || null,
        scene_id: page.scene_id || null,
        scene_title: page.scene_title || null,
        scene_mode: page.scene_mode || null,
        scene_status: page.scene_status || null,
        art_count: Number(page.art_count) || 0,
        is_copyedited: Boolean(page.canonical_revision_id &&
          page.display_revision_id !== page.canonical_revision_id),
        created_at: page.created_at,
        updated_at: page.updated_at,
      };
      chapterById.get(page.chapter_id)?.pages.push(projectedPage);
      const scene = page.scene_id ? sceneById.get(page.scene_id) : null;
      if (scene) {
        scene.page_ids.push(page.id);
        if (!scene.page_range) {
          scene.page_range = { first: index + 1, last: index + 1, count: 1 };
        } else {
          scene.page_range.last = index + 1;
          scene.page_range.count += 1;
        }
      }
    });

    const activeVolume = volumes.at(-1) || null;
    const activeChapter = activeVolume?.chapters.at(-1) || null;
    const activePage = pages.at(-1) || null;
    const prepared = db.prepare(`
      SELECT id, expected_page, spend_usd, created_at
        FROM prepared_pages WHERE story_id = ?
    `).get(storyId) || null;
    const readyCount = pages.filter((page) => page.continuity_status === 'ready').length;
    return {
      summary: {
        volume_count: volumes.length,
        chapter_count: chapters.length,
        scene_count: scenes.length,
        page_count: pages.length,
        continuity: { ready: readyCount, total: pages.length },
        placed_art_count: pages.reduce((sum, page) => sum + (Number(page.art_count) || 0), 0),
        prepared: prepared ? {
          id: prepared.id,
          expected_page: prepared.expected_page,
          cost_usd: Number(prepared.spend_usd) || 0,
          created_at: prepared.created_at,
        } : null,
        active_tail: activeVolume ? {
          volume_id: activeVolume.id,
          chapter_id: activeChapter?.id || null,
          page_id: activePage?.id || null,
        } : null,
      },
      volumes,
    };
  }

  function stablePage(storyId, pageId) {
    const row = db.prepare(`
      SELECT projected.*, p.ordinal AS hierarchy_ordinal,
             c.id AS chapter_id, c.ordinal AS chapter_ordinal, c.title AS chapter_title,
             v.id AS volume_id, v.ordinal AS volume_ordinal, v.title AS volume_title,
             membership.scene_id, scene.title AS scene_title, scene.mode AS scene_mode,
             scene.status AS scene_status
        FROM pages p
        JOIN chapters c ON c.id = p.chapter_id
        JOIN volumes v ON v.id = c.volume_id
        JOIN manuscript_pages projected ON projected.id = p.id AND projected.story_id = v.story_id
        LEFT JOIN scene_pages membership ON membership.page_id = p.id
        LEFT JOIN scenes scene ON scene.id = membership.scene_id
       WHERE v.story_id = ? AND p.id = ?
    `).get(storyId, pageId);
    if (!row) return null;
    const previous = row.page_number > 1
      ? db.prepare('SELECT id FROM manuscript_pages WHERE story_id = ? AND page_number = ?').get(storyId, row.page_number - 1)
      : null;
    const next = Number.isSafeInteger(row.page_number)
      ? db.prepare('SELECT id FROM manuscript_pages WHERE story_id = ? AND page_number = ?').get(storyId, row.page_number + 1)
      : null;
    const pageFields = [
      'id', 'story_id', 'page_number', 'content', 'user_input', 'model',
      'prompt_tokens', 'completion_tokens', 'cost_usd', 'image_media_type',
      'image_prompt', 'continuity_model', 'continuity_prompt_tokens',
      'continuity_completion_tokens', 'continuity_cost_usd', 'created_at',
    ];
    const page = {};
    for (const field of pageFields) page[field] = row[field] ?? null;
    page.id = page.id || pageId;
    page.story_id = page.story_id || storyId;
    return {
      ...page,
      position: {
        volume: { id: row.volume_id, ordinal: row.volume_ordinal, title: row.volume_title },
        chapter: { id: row.chapter_id, ordinal: row.chapter_ordinal, title: row.chapter_title },
        scene: row.scene_id ? {
          id: row.scene_id, title: row.scene_title, mode: row.scene_mode, status: row.scene_status,
        } : null,
        ordinal: row.hierarchy_ordinal,
        display_number: row.page_number ?? null,
      },
      neighbors: {
        previous_page_id: previous?.id || null,
        next_page_id: next?.id || null,
      },
      is_active_tail: !next,
    };
  }

  function createVolume(storyId, title, chapterTitle = 'Chapter I') {
    return inImmediateTransaction(() => {
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM volumes WHERE story_id = ?')
        .get(storyId).value;
      const volumeId = randomUUID();
      const chapterId = randomUUID();
      db.prepare('INSERT INTO volumes (id, story_id, ordinal, title) VALUES (?, ?, ?, ?)')
        .run(volumeId, storyId, ordinal, title || `Volume ${romanNumeral(ordinal)}`);
      db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, 1, ?)')
        .run(chapterId, volumeId, chapterTitle);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      return { volume: getVolume(storyId, volumeId), chapter: getChapter(storyId, chapterId) };
    });
  }

  function createChapter(storyId, volumeId, title) {
    return inImmediateTransaction(() => {
      const volume = getVolume(storyId, volumeId);
      if (!volume) return null;
      if (activeVolume(storyId)?.id !== volume.id) {
        throw conflict('New chapters can only begin in the active tail volume.');
      }
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM chapters WHERE volume_id = ?')
        .get(volume.id).value;
      const chapterId = randomUUID();
      db.prepare('INSERT INTO chapters (id, volume_id, ordinal, title) VALUES (?, ?, ?, ?)')
        .run(chapterId, volume.id, ordinal, title || `Chapter ${romanNumeral(ordinal)}`);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      return getChapter(storyId, chapterId);
    });
  }

  function renameVolume(storyId, volumeId, title) {
    const result = db.prepare(`
      UPDATE volumes SET title = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND story_id = ?
    `).run(title, volumeId, storyId);
    if (!result.changes) return null;
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return getVolume(storyId, volumeId);
  }

  function renameChapter(storyId, chapterId, title) {
    const chapter = getChapter(storyId, chapterId);
    if (!chapter) return null;
    db.prepare('UPDATE chapters SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(title, chapterId);
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return getChapter(storyId, chapterId);
  }

  function deleteVolume(storyId, volumeId) {
    return inImmediateTransaction(() => {
      const volume = getVolume(storyId, volumeId);
      if (!volume) return null;
      if (activeVolume(storyId)?.id !== volume.id) throw conflict('Only the active tail volume can be deleted.');
      const count = db.prepare('SELECT COUNT(*) AS value FROM volumes WHERE story_id = ?').get(storyId).value;
      if (count <= 1) throw conflict('A story must retain at least one volume.');
      const pages = db.prepare(`
        SELECT COUNT(*) AS value
          FROM pages p JOIN chapters c ON c.id = p.chapter_id
         WHERE c.volume_id = ?
      `).get(volumeId).value;
      if (pages > 0) throw conflict('A nonempty volume cannot be deleted.');
      db.prepare('DELETE FROM volumes WHERE id = ?').run(volumeId);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      return true;
    });
  }

  function deleteChapter(storyId, chapterId) {
    return inImmediateTransaction(() => {
      const chapter = getChapter(storyId, chapterId);
      if (!chapter) return null;
      const volume = activeVolume(storyId);
      const active = volume && activeChapterStatement.get(volume.id);
      if (!volume || chapter.volume_id !== volume.id || active?.id !== chapter.id) {
        throw conflict('Only the active tail chapter can be deleted.');
      }
      const count = db.prepare('SELECT COUNT(*) AS value FROM chapters WHERE volume_id = ?').get(volume.id).value;
      if (count <= 1) throw conflict('A volume must retain at least one chapter.');
      const pages = db.prepare('SELECT COUNT(*) AS value FROM pages WHERE chapter_id = ?').get(chapterId).value;
      if (pages > 0) throw conflict('A nonempty chapter cannot be deleted.');
      db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
      return true;
    });
  }

  return {
    inImmediateTransaction,
    ensureDefaultInTransaction,
    insertTailPageInTransaction,
    insertPageAfterInTransaction,
    removePageInTransaction,
    buildHierarchy,
    stablePage,
    getVolume,
    getChapter,
    createVolume,
    createChapter,
    renameVolume,
    renameChapter,
    deleteVolume,
    deleteChapter,
  };
}

module.exports = { createHierarchyStore, romanNumeral };
