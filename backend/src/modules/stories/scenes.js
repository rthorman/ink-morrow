'use strict';

// Scenes are an optional layer over the canonical chapter/page hierarchy.
// They group existing pages and hold bounded planning/play metadata; neither
// creating nor deleting one changes prose, revision ancestry, or page order.

const { randomUUID } = require('node:crypto');
const { optionalText, asString } = require('../../core/validation');

const SCENE_MODES = Object.freeze(['author', 'play', 'hybrid']);
const SCENE_STATUSES = Object.freeze(['planned', 'in_progress', 'complete']);

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function createSceneStore(db, { hierarchy }) {
  const getStatement = db.prepare(`
    SELECT scene.*
      FROM scenes scene
      JOIN chapters chapter ON chapter.id = scene.chapter_id
      JOIN volumes volume ON volume.id = chapter.volume_id
     WHERE scene.id = ? AND volume.story_id = ?
  `);

  function get(storyId, sceneId) {
    return getStatement.get(sceneId, storyId) || null;
  }

  function scenePages(sceneId) {
    return db.prepare(`
      SELECT page.id, page.ordinal, projected.page_number AS display_number
        FROM scene_pages membership
        JOIN pages page ON page.id = membership.page_id
        JOIN manuscript_pages projected ON projected.id = page.id
       WHERE membership.scene_id = ?
       ORDER BY page.ordinal, page.id
    `).all(sceneId);
  }

  function withPages(row) {
    if (!row) return null;
    const scene = row;
    const pages = scenePages(scene.id);
    const playSessionCount = db.prepare('SELECT COUNT(*) AS value FROM play_sessions WHERE scene_id = ?')
      .get(scene.id).value;
    const toolRecordCount = db.prepare('SELECT COUNT(*) AS value FROM play_tool_records WHERE scene_id = ?')
      .get(scene.id).value;
    const latestToolRecord = db.prepare(`SELECT summary, tool_name, created_at FROM play_tool_records
      WHERE scene_id = ? ORDER BY created_at DESC, ordinal DESC LIMIT 1`).get(scene.id) || null;
    return {
      ...scene,
      play_session_count: Number(playSessionCount) || 0,
      tool_record_count: Number(toolRecordCount) || 0,
      latest_tool_record: latestToolRecord,
      page_ids: pages.map((page) => page.id),
      page_range: pages.length ? {
        first: pages[0].display_number,
        last: pages.at(-1).display_number,
        count: pages.length,
      } : null,
    };
  }

  function list(storyId) {
    return db.prepare(`
      SELECT scene.*
        FROM scenes scene
        JOIN chapters chapter ON chapter.id = scene.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
       WHERE volume.story_id = ?
       ORDER BY volume.ordinal, chapter.ordinal, scene.ordinal, scene.id
    `).all(storyId).map(withPages);
  }

  function validate(body, { existing = null, create = false } = {}) {
    const title = body.title === undefined
      ? existing?.title || null
      : optionalText(body.title, { max: 300 });
    if ((create || body.title !== undefined) && !title) {
      return { error: '"title" must be non-empty text of at most 300 characters' };
    }

    const mode = body.mode === undefined ? existing?.mode || 'author' : asString(body.mode);
    if (!SCENE_MODES.includes(mode)) {
      return { error: `"mode" must be one of: ${SCENE_MODES.join(', ')}` };
    }
    const status = body.status === undefined ? existing?.status || 'planned' : asString(body.status);
    if (!SCENE_STATUSES.includes(status)) {
      return { error: `"status" must be one of: ${SCENE_STATUSES.join(', ')}` };
    }

    const textField = (name, max) => {
      if (body[name] === undefined) return existing?.[name] ?? null;
      const value = optionalText(body[name], { max });
      if (value === undefined) throw new TypeError(`"${name}" must be text of at most ${max} characters`);
      return value;
    };

    let pageIds;
    if (body.page_ids !== undefined) {
      if (!Array.isArray(body.page_ids) || body.page_ids.length > 10000 ||
          body.page_ids.some((id) => typeof id !== 'string' || !id.trim()) ||
          new Set(body.page_ids).size !== body.page_ids.length) {
        return { error: '"page_ids" must be an array of unique page identifiers' };
      }
      pageIds = body.page_ids;
    }

    try {
      return {
        title,
        mode,
        status,
        viewpoint_character_id: textField('viewpoint_character_id', 200),
        location: textField('location', 500),
        story_time: textField('story_time', 500),
        purpose: textField('purpose', 4000),
        stakes: textField('stakes', 4000),
        page_ids: pageIds,
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  function assertViewpointInCast(storyId, characterId) {
    if (!characterId) return;
    const row = db.prepare('SELECT characters FROM stories WHERE id = ?').get(storyId);
    let cast = [];
    try { cast = JSON.parse(row?.characters || '[]'); } catch { cast = []; }
    if (!cast.some((entry) => (typeof entry === 'string' ? entry : entry?.id) === characterId)) {
      throw conflict('The scene viewpoint must be a member of this manuscript cast.');
    }
  }

  function replacePagesInTransaction(storyId, scene, pageIds) {
    if (pageIds === undefined) return;
    const rows = pageIds.length ? db.prepare(`
      SELECT page.id, page.chapter_id, page.ordinal, membership.scene_id
        FROM pages page
        JOIN chapters chapter ON chapter.id = page.chapter_id
        JOIN volumes volume ON volume.id = chapter.volume_id
        LEFT JOIN scene_pages membership ON membership.page_id = page.id
       WHERE volume.story_id = ? AND page.id IN (${pageIds.map(() => '?').join(',')})
       ORDER BY page.ordinal, page.id
    `).all(storyId, ...pageIds) : [];
    if (rows.length !== pageIds.length || rows.some((page) => page.chapter_id !== scene.chapter_id)) {
      throw conflict('Every selected page must belong to the scene chapter.');
    }
    if (rows.some((page) => page.scene_id && page.scene_id !== scene.id)) {
      throw conflict('A selected page already belongs to another scene.');
    }
    if (rows.some((page, index) => index > 0 && page.ordinal !== rows[index - 1].ordinal + 1)) {
      throw conflict('Scene pages must form one contiguous range within their chapter.');
    }
    db.prepare('DELETE FROM scene_pages WHERE scene_id = ?').run(scene.id);
    const insert = db.prepare('INSERT INTO scene_pages (scene_id, page_id) VALUES (?, ?)');
    for (const page of rows) insert.run(scene.id, page.id);
  }

  function create(storyId, chapterId, input) {
    const chapter = hierarchy.getChapter(storyId, chapterId);
    if (!chapter) return null;
    assertViewpointInCast(storyId, input.viewpoint_character_id);
    const id = randomUUID();
    hierarchy.inImmediateTransaction(() => {
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM scenes WHERE chapter_id = ?')
        .get(chapterId).value;
      db.prepare(`
        INSERT INTO scenes
          (id, chapter_id, ordinal, title, mode, status, viewpoint_character_id,
           location, story_time, purpose, stakes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, chapterId, ordinal, input.title, input.mode, input.status,
        input.viewpoint_character_id, input.location, input.story_time, input.purpose, input.stakes);
      replacePagesInTransaction(storyId, get(storyId, id), input.page_ids);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    });
    return withPages(get(storyId, id));
  }

  function update(storyId, sceneId, input) {
    const existing = get(storyId, sceneId);
    if (!existing) return null;
    assertViewpointInCast(storyId, input.viewpoint_character_id);
    hierarchy.inImmediateTransaction(() => {
      db.prepare(`
        UPDATE scenes
           SET title = ?, mode = ?, status = ?, viewpoint_character_id = ?,
               location = ?, story_time = ?, purpose = ?, stakes = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `).run(input.title, input.mode, input.status, input.viewpoint_character_id,
        input.location, input.story_time, input.purpose, input.stakes, sceneId);
      replacePagesInTransaction(storyId, get(storyId, sceneId), input.page_ids);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    });
    return withPages(get(storyId, sceneId));
  }

  function remove(storyId, sceneId) {
    const existing = get(storyId, sceneId);
    if (!existing) return null;
    if (db.prepare('SELECT 1 FROM play_sessions WHERE scene_id = ? LIMIT 1').get(sceneId)) {
      throw conflict('A scene with Play history cannot be removed. Its transcript is preserved as working history.');
    }
    let pagesUngrouped = 0;
    hierarchy.inImmediateTransaction(() => {
      pagesUngrouped = db.prepare('SELECT COUNT(*) AS value FROM scene_pages WHERE scene_id = ?')
        .get(sceneId).value;
      db.prepare('DELETE FROM scenes WHERE id = ?').run(sceneId);
      const later = db.prepare('SELECT id FROM scenes WHERE chapter_id = ? AND ordinal > ? ORDER BY ordinal')
        .all(existing.chapter_id, existing.ordinal);
      const shift = db.prepare('UPDATE scenes SET ordinal = ordinal - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const row of later) shift.run(row.id);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    });
    return { deleted: true, pages_ungrouped: pagesUngrouped };
  }

  return { get, list, withPages, validate, create, update, remove };
}

module.exports = { SCENE_MODES, SCENE_STATUSES, createSceneStore };
