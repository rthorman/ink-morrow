'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { beginOperation, settleOperation } = require('../../core/operation-journal');

const DEFAULT_RECOVERY_DAYS = 30;
const UNDO_WINDOW_MS = 10 * 60 * 1000;

function conflict(message, code = 'REVISION_CONFLICT') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function continuitySearchText(row) {
  const delta = parseJson(row.delta_json, {}) || {};
  return [
    row.summary,
    ...(delta.events || []).map((item) => item.text),
    ...(delta.goal_updates || []).map((item) => item.text),
    ...(delta.thread_updates || []).map((item) => item.text),
    ...(delta.world_fact_updates || []).map((item) => item.text),
    ...(delta.arc_updates || []).map((item) => item.text),
  ].filter((value) => typeof value === 'string' && value.trim()).join('\n');
}

function retentionDays(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 3650
    ? parsed
    : DEFAULT_RECOVERY_DAYS;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function createRevisionStore(db, {
  hierarchy,
  invalidatePreview,
  recoveryRetentionDays = process.env.RECOVERY_RETENTION_DAYS,
  clock = () => new Date(),
} = {}) {
  const days = retentionDays(recoveryRetentionDays);

  const getPlacement = db.prepare(`
    SELECT p.*, sp.story_id, sp.page_number, sp.content, sp.user_input,
           sp.model, sp.prompt_tokens, sp.completion_tokens, sp.cost_usd,
           sp.image_media_type, sp.image_prompt
      FROM pages p
      JOIN chapters c ON c.id = p.chapter_id
      JOIN volumes v ON v.id = c.volume_id
      JOIN story_pages sp ON sp.id = p.id AND sp.story_id = v.story_id
     WHERE v.story_id = ? AND p.id = ?
  `);
  const getRevision = db.prepare('SELECT * FROM page_revisions WHERE id = ?');
  const insertRevision = db.prepare(`
    INSERT INTO page_revisions
      (id, page_id, parent_revision_id, kind, content, direction, source,
       model, prompt_tokens, completion_tokens, cost_usd, scribe_binding_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setPointers = db.prepare(`
    UPDATE pages
       SET canonical_revision_id = ?, display_revision_id = ?, updated_at = ?
     WHERE id = ?
  `);

  function now() {
    return clock().toISOString();
  }

  function internalIdempotencyKey(storyId, value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    return `${storyId}:${value.trim().slice(0, 300)}`;
  }

  function replay(kind, storyId, idempotencyKey) {
    const key = internalIdempotencyKey(storyId, idempotencyKey);
    if (!key) return null;
    const operation = db.prepare(`
      SELECT * FROM operation_journal WHERE kind = ? AND idempotency_key = ?
    `).get(kind, key);
    if (!operation) return null;
    if (operation.status !== 'committed') {
      throw conflict('An operation with this idempotency key did not commit.', 'IDEMPOTENCY_CONFLICT');
    }
    return { ...(parseJson(operation.result_json, {}) || {}), replayed: true };
  }

  function journalInTransaction(kind, storyId, subjectType, subjectId, request, result, idempotencyKey = null) {
    const operation = beginOperation(db, {
      kind,
      subjectType,
      subjectId,
      idempotencyKey: internalIdempotencyKey(storyId, idempotencyKey),
      requestJson: JSON.stringify(request || {}),
    }, { clock });
    settleOperation(db, operation.id, 'committed', {
      resultJson: JSON.stringify(result || {}),
    }, { clock });
    return operation.id;
  }

  function createInitialRevisionInTransaction(pageId, {
    content = '', direction = null, source = 'author', model = null,
    promptTokens = null, completionTokens = null, costUsd = 0, scribeBindingId = null, createdAt = null,
  } = {}) {
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
    if (!page) throw new Error(`Hierarchy page ${pageId} does not exist`);
    if (page.canonical_revision_id) return getRevision.get(page.canonical_revision_id);
    const id = randomUUID();
    const timestamp = createdAt || now();
    insertRevision.run(
      id, pageId, null, 'canonical', content, direction,
      ['author', 'ai', 'import', 'migration'].includes(source) ? source : 'author',
      model, promptTokens, completionTokens, Number(costUsd) || 0, scribeBindingId, timestamp
    );
    setPointers.run(id, id, timestamp, pageId);
    return getRevision.get(id);
  }

  function chainFingerprint(storyId) {
    const structure = {
      volumes: db.prepare(`
        SELECT id, ordinal, title FROM volumes WHERE story_id = ? ORDER BY ordinal
      `).all(storyId),
      chapters: db.prepare(`
        SELECT c.id, c.volume_id, c.ordinal, c.title
          FROM chapters c JOIN volumes v ON v.id = c.volume_id
         WHERE v.story_id = ? ORDER BY v.ordinal, c.ordinal
      `).all(storyId),
      pages: db.prepare(`
        SELECT p.id, p.chapter_id, p.ordinal, p.canonical_revision_id, p.display_revision_id
          FROM pages p
          JOIN chapters c ON c.id = p.chapter_id
          JOIN volumes v ON v.id = c.volume_id
         WHERE v.story_id = ? ORDER BY v.ordinal, c.ordinal, p.ordinal
      `).all(storyId),
    };
    return sha256(JSON.stringify(structure));
  }

  function revisionState(storyId, pageId) {
    const page = getPlacement.get(storyId, pageId);
    if (!page) return null;
    return {
      canonical: page.canonical_revision_id ? getRevision.get(page.canonical_revision_id) : null,
      display: page.display_revision_id ? getRevision.get(page.display_revision_id) : null,
      diverges_from_canon: Boolean(page.canonical_revision_id && page.display_revision_id &&
        page.canonical_revision_id !== page.display_revision_id),
    };
  }

  function listPageRevisions(storyId, pageId) {
    const page = getPlacement.get(storyId, pageId);
    if (!page) return null;
    return {
      page_id: pageId,
      canonical_revision_id: page.canonical_revision_id,
      display_revision_id: page.display_revision_id,
      revisions: db.prepare(`
        SELECT * FROM page_revisions WHERE page_id = ? ORDER BY created_at, rowid
      `).all(pageId),
    };
  }

  function activeTailId(storyId) {
    return db.prepare(`
      SELECT sp.id FROM story_pages sp
       WHERE sp.story_id = ?
       ORDER BY sp.page_number DESC LIMIT 1
    `).get(storyId)?.id || null;
  }

  function tailEdit(storyId, pageId, {
    content, direction = null, source = 'author', model = null,
    promptTokens = null, completionTokens = null, costUsd = 0,
    idempotencyKey = null, scribeBindingId = null,
  }) {
    const kind = 'page.tail_edit';
    const repeated = replay(kind, storyId, idempotencyKey);
    if (repeated) return repeated;
    let result;
    hierarchy.inImmediateTransaction(() => {
      result = tailEditInTransaction(storyId, pageId, {
        content, direction, source, model, promptTokens, completionTokens, costUsd, idempotencyKey, scribeBindingId,
      });
    });
    if (!result) return null;
    invalidatePreview(storyId);
    return result;
  }

  function tailEditInTransaction(storyId, pageId, {
    content, direction = null, source = 'author', model = null,
    promptTokens = null, completionTokens = null, costUsd = 0,
    idempotencyKey = null, scribeBindingId = null,
  }) {
    const page = getPlacement.get(storyId, pageId);
    if (!page) return null;
    if (activeTailId(storyId) !== pageId) {
      throw conflict('Only the active tail page can be substantively edited.', 'TAIL_ONLY');
    }
    if (page.image_media_type) throw conflict('A painted plate has no canonical prose to edit.', 'IMAGE_PAGE');
    const current = page.canonical_revision_id
      ? getRevision.get(page.canonical_revision_id)
      : createInitialRevisionInTransaction(pageId, page);
    const revisionId = randomUUID();
    const timestamp = now();
    insertRevision.run(
      revisionId, pageId, current.id, 'canonical', content, direction,
      source === 'ai' ? 'ai' : 'author', model, promptTokens, completionTokens,
      Number(costUsd) || 0, scribeBindingId, timestamp
    );
    setPointers.run(revisionId, revisionId, timestamp, pageId);
    db.prepare(`
      UPDATE story_pages
         SET content = ?, user_input = ?, model = ?, prompt_tokens = ?,
             completion_tokens = ?, cost_usd = ?,
             continuity_model = NULL, continuity_prompt_tokens = NULL,
             continuity_completion_tokens = NULL, continuity_cost_usd = 0
       WHERE id = ?
    `).run(content, direction, model, promptTokens, completionTokens, Number(costUsd) || 0, pageId);
    db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
    db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
    db.prepare('UPDATE stories SET updated_at = ? WHERE id = ?').run(timestamp, storyId);
    const result = {
      page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(pageId),
      revision: getRevision.get(revisionId),
      canonical_revision_id: revisionId,
      display_revision_id: revisionId,
      continuity_recalculated: false,
    };
    journalInTransaction('page.tail_edit', storyId, 'page', pageId, {
      parent_revision_id: current.id,
    }, {
      page_id: pageId,
      revision_id: revisionId,
    }, idempotencyKey);
    return result;
  }

  function copyedit(storyId, pageId, { content, idempotencyKey = null }) {
    const kind = 'page.copyedit';
    const repeated = replay(kind, storyId, idempotencyKey);
    if (repeated) return repeated;
    let result;
    hierarchy.inImmediateTransaction(() => {
      const page = getPlacement.get(storyId, pageId);
      if (!page) return;
      if (activeTailId(storyId) === pageId) {
        throw conflict('Use a canonical tail edit for the active page.', 'TAIL_COPYEDIT');
      }
      if (page.image_media_type) throw conflict('A painted plate has no prose to copyedit.', 'IMAGE_PAGE');
      const canonical = page.canonical_revision_id
        ? getRevision.get(page.canonical_revision_id)
        : createInitialRevisionInTransaction(pageId, page);
      const parent = page.display_revision_id ? getRevision.get(page.display_revision_id) : canonical;
      const revisionId = randomUUID();
      const timestamp = now();
      insertRevision.run(
        revisionId, pageId, parent.id, 'copyedit', content, null,
        'author', null, null, null, 0, null, timestamp
      );
      setPointers.run(canonical.id, revisionId, timestamp, pageId);
      // story_pages is the temporary read/export projection. The v3 trigger
      // sees differing canonical/display pointers and deliberately preserves
      // the established continuity row for this display-only edit.
      db.prepare('UPDATE story_pages SET content = ? WHERE id = ?').run(content, pageId);
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
      db.prepare('UPDATE stories SET updated_at = ? WHERE id = ?').run(timestamp, storyId);
      result = {
        page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(pageId),
        revision: getRevision.get(revisionId),
        canonical_revision_id: canonical.id,
        display_revision_id: revisionId,
        continuity_recalculated: false,
        notice: 'Displayed prose changed; established continuity was not recalculated.',
      };
      journalInTransaction(kind, storyId, 'page', pageId, {
        parent_revision_id: parent.id,
      }, {
        page_id: pageId,
        revision_id: revisionId,
        canonical_revision_id: canonical.id,
      }, idempotencyKey);
    });
    if (!result) return null;
    invalidatePreview(storyId);
    return result;
  }

  function recoveryMetadata(row, currentFingerprint = null) {
    const payload = parseJson(row.payload_json, {});
    let restoreState = row.status;
    if (row.status === 'recoverable') {
      restoreState = currentFingerprint && payload.head_fingerprint &&
        safeEqual(currentFingerprint, payload.head_fingerprint)
        ? 'safe'
        : 'unsafe';
    }
    return {
      id: row.id,
      story_id: row.story_id,
      anchor_page_id: row.anchor_page_id,
      status: row.status,
      page_count: payload.page_count || 0,
      removed_range: payload.removed_range || null,
      head_fingerprint: payload.head_fingerprint || null,
      created_at: row.created_at,
      expires_at: row.expires_at,
      resolved_at: row.resolved_at,
      restore: {
        state: restoreState,
        available: restoreState === 'safe',
        reason: restoreState === 'unsafe'
          ? 'The surviving manuscript changed after this recovery was made. Export it for manual reconciliation.'
          : restoreState === 'expired'
            ? 'This recovery expired and its private payload was scrubbed.'
            : restoreState === 'restored'
              ? 'This recovery has already been restored.'
              : null,
      },
    };
  }

  function expireRecoveries(storyId = null, onPlate = null) {
    const timestamp = now();
    const rows = storyId
      ? db.prepare(`
          SELECT * FROM recovery_suffixes
           WHERE story_id = ? AND status = 'recoverable' AND expires_at <= ?
        `).all(storyId, timestamp)
      : db.prepare(`
          SELECT * FROM recovery_suffixes
           WHERE status = 'recoverable' AND expires_at <= ?
        `).all(timestamp);
    const plateIds = new Set();
    if (rows.length) {
      hierarchy.inImmediateTransaction(() => {
        const expire = db.prepare(`
          UPDATE recovery_suffixes
             SET status = 'expired', payload_json = ?, resolved_at = ?
           WHERE id = ? AND status = 'recoverable'
        `);
        for (const row of rows) {
          const payload = parseJson(row.payload_json, {});
          for (const page of payload.pages || []) {
            if (page.image_media_type) plateIds.add(page.id);
          }
          expire.run(JSON.stringify({
            version: payload.version || 1,
            story_id: row.story_id,
            anchor_page_id: row.anchor_page_id,
            page_count: payload.page_count || 0,
            removed_range: payload.removed_range || null,
            expired: true,
          }), timestamp, row.id);
        }
      });
    }
    if (typeof onPlate === 'function') {
      for (const pageId of plateIds) onPlate(pageId);
    }
    return rows.length;
  }

  function collectRecoveryPayload(storyId, anchor, doomed, undoHash, undoExpiresAt) {
    const ids = doomed.map((page) => page.id);
    const placeholders = ids.map(() => '?').join(',');
    const select = (sql) => ids.length ? db.prepare(sql.replace('PAGE_IDS', placeholders)).all(...ids) : [];
    return {
      version: 1,
      story_id: storyId,
      anchor_page_id: anchor.id,
      anchor_page_number: anchor.page_number,
      page_count: doomed.length,
      removed_range: { first: doomed[0].page_number, last: doomed.at(-1).page_number },
      undo_sha256: undoHash,
      undo_expires_at: undoExpiresAt,
      pages: doomed,
      placements: select(`SELECT * FROM pages WHERE id IN (PAGE_IDS) ORDER BY rowid`),
      revisions: select(`SELECT * FROM page_revisions WHERE page_id IN (PAGE_IDS) ORDER BY created_at, rowid`),
      memory: select(`SELECT * FROM story_memory_pages WHERE page_id IN (PAGE_IDS) ORDER BY created_at, page_id`),
      memory_search: select(`SELECT * FROM story_memory_search WHERE page_id IN (PAGE_IDS) ORDER BY page_id`),
      continuity_deltas: select(`SELECT * FROM continuity_deltas WHERE revision_id IN (
        SELECT id FROM page_revisions WHERE page_id IN (PAGE_IDS)
      ) ORDER BY created_at, revision_id`),
      private_operations: select(`SELECT * FROM operation_journal
        WHERE subject_type = 'page' AND subject_id IN (PAGE_IDS)
        ORDER BY started_at, id`),
    };
  }

  function truncateAfter(storyId, after, { idempotencyKey = null } = {}) {
    const kind = 'story.truncate';
    const repeated = replay(kind, storyId, idempotencyKey);
    if (repeated) return repeated;
    const recoveryId = randomUUID();
    const undoToken = randomUUID();
    let result;
    let mutated = false;
    hierarchy.inImmediateTransaction(() => {
      const anchor = db.prepare(`
        SELECT sp.* FROM story_pages sp WHERE sp.story_id = ? AND sp.page_number = ?
      `).get(storyId, after);
      if (!anchor) throw conflict('The selected page is not in the current canonical chain.', 'INVALID_ANCHOR');
      const doomed = db.prepare(`
        SELECT * FROM story_pages WHERE story_id = ? AND page_number > ? ORDER BY page_number
      `).all(storyId, after);
      if (!doomed.length) {
        result = { deleted: 0, remaining: after };
        return;
      }
      mutated = true;
      const started = clock();
      const expiresAt = new Date(started.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      const undoExpiresAt = new Date(started.getTime() + UNDO_WINDOW_MS).toISOString();
      const payload = collectRecoveryPayload(storyId, anchor, doomed, sha256(undoToken), undoExpiresAt);
      const clearPointers = db.prepare(`
        UPDATE pages SET canonical_revision_id = NULL, display_revision_id = NULL WHERE id = ?
      `);
      const deletePlacement = db.prepare('DELETE FROM pages WHERE id = ?');
      for (const page of doomed) clearPointers.run(page.id);
      for (const page of doomed) deletePlacement.run(page.id);
      db.prepare('DELETE FROM story_pages WHERE story_id = ? AND page_number > ?').run(storyId, after);
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
      payload.head_fingerprint = chainFingerprint(storyId);
      db.prepare(`
        INSERT INTO recovery_suffixes
          (id, story_id, anchor_page_id, status, payload_json, created_at, expires_at)
        VALUES (?, ?, ?, 'recoverable', ?, ?, ?)
      `).run(recoveryId, storyId, anchor.id, JSON.stringify(payload), started.toISOString(), expiresAt);
      db.prepare('UPDATE stories SET updated_at = ? WHERE id = ?').run(started.toISOString(), storyId);
      result = {
        deleted: doomed.length,
        remaining: after,
        removed_range: payload.removed_range,
        recovery: { id: recoveryId, expires_at: expiresAt },
        undo: { token: undoToken, expires_at: undoExpiresAt },
      };
      journalInTransaction(kind, storyId, 'story', storyId, {
        after_page_id: anchor.id,
        after_page_number: after,
      }, {
        deleted: doomed.length,
        remaining: after,
        removed_range: payload.removed_range,
        recovery: result.recovery,
        undo: { token: null, expires_at: undoExpiresAt },
      }, idempotencyKey);
    });
    if (mutated) invalidatePreview(storyId);
    return result;
  }

  function orderedRevisions(rows) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const emitted = new Set();
    const result = [];
    function visit(row, visiting = new Set()) {
      if (emitted.has(row.id)) return;
      if (visiting.has(row.id)) throw conflict('Recovery revision ancestry is cyclic.', 'INVALID_RECOVERY');
      visiting.add(row.id);
      if (row.parent_revision_id && byId.has(row.parent_revision_id)) visit(byId.get(row.parent_revision_id), visiting);
      visiting.delete(row.id);
      emitted.add(row.id);
      result.push(row);
    }
    for (const row of rows) visit(row);
    return result;
  }

  function restoreRecovery(storyId, recoveryId, {
    undoToken = null,
    idempotencyKey = null,
  } = {}) {
    const kind = undoToken ? 'story.truncate_undo' : 'story.recovery_restore';
    const repeated = replay(kind, storyId, idempotencyKey);
    if (repeated) return repeated;
    let result;
    hierarchy.inImmediateTransaction(() => {
      const row = db.prepare(`
        SELECT * FROM recovery_suffixes WHERE id = ? AND story_id = ?
      `).get(recoveryId, storyId);
      if (!row) return;
      if (row.status !== 'recoverable') {
        throw conflict(`This recovery suffix is ${row.status}.`, 'RECOVERY_UNAVAILABLE');
      }
      const timestamp = now();
      if (row.expires_at <= timestamp) {
        db.prepare(`
          UPDATE recovery_suffixes SET status = 'expired', resolved_at = ? WHERE id = ?
        `).run(timestamp, row.id);
        throw conflict('This recovery suffix has expired.', 'RECOVERY_EXPIRED');
      }
      const payload = parseJson(row.payload_json);
      if (!payload || payload.version !== 1) throw conflict('Recovery package is unreadable.', 'INVALID_RECOVERY');
      if (undoToken) {
        if (payload.undo_expires_at <= timestamp || !safeEqual(sha256(undoToken), payload.undo_sha256)) {
          throw conflict('The immediate undo token is invalid or expired.', 'UNDO_EXPIRED');
        }
      }
      if (!safeEqual(chainFingerprint(storyId), payload.head_fingerprint)) {
        throw conflict(
          'The surviving manuscript changed after truncation. Export this recovery package for manual reconciliation.',
          'UNSAFE_RESTORE'
        );
      }

      for (const page of payload.pages) {
        const fields = Object.keys(page);
        db.prepare(`INSERT INTO story_pages (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
          .run(...fields.map((field) => page[field]));
      }
      for (const placement of payload.placements) {
        db.prepare(`
          INSERT INTO pages (id, chapter_id, ordinal, canonical_revision_id, display_revision_id, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, ?, ?)
        `).run(placement.id, placement.chapter_id, placement.ordinal, placement.created_at, placement.updated_at);
      }
      for (const revision of orderedRevisions(payload.revisions)) {
        const fields = [
          'id', 'page_id', 'parent_revision_id', 'kind', 'content', 'direction',
          'source', 'model', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'scribe_binding_id', 'created_at',
        ];
        insertRevision.run(...fields.map((field) => revision[field]));
      }
      for (const placement of payload.placements) {
        setPointers.run(
          placement.canonical_revision_id,
          placement.display_revision_id,
          placement.updated_at,
          placement.id
        );
      }
      for (const memory of payload.memory || []) {
        const fields = Object.keys(memory);
        db.prepare(`INSERT INTO story_memory_pages (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
          .run(...fields.map((field) => memory[field]));
      }
      for (const search of payload.memory_search || []) {
        db.prepare('INSERT INTO story_memory_search (page_id, story_id, content) VALUES (?, ?, ?)')
          .run(search.page_id, search.story_id, search.content);
      }
      for (const delta of payload.continuity_deltas || []) {
        const fields = Object.keys(delta);
        db.prepare(`INSERT INTO continuity_deltas (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
          .run(...fields.map((field) => delta[field]));
        if (delta.status === 'ready') {
          const content = continuitySearchText(delta);
          db.prepare('INSERT OR REPLACE INTO continuity_search (revision_id, story_id, content) VALUES (?, ?, ?)')
            .run(delta.revision_id, storyId, content);
          try {
            db.prepare('DELETE FROM continuity_search_fts WHERE revision_id = ?').run(delta.revision_id);
            db.prepare('INSERT INTO continuity_search_fts (revision_id, story_id, content) VALUES (?, ?, ?)')
              .run(delta.revision_id, storyId, content);
          } catch { /* LIKE fallback remains correct */ }
        }
      }
      db.prepare(`
        UPDATE recovery_suffixes SET status = 'restored', resolved_at = ? WHERE id = ?
      `).run(timestamp, recoveryId);
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
      db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
      db.prepare('UPDATE stories SET updated_at = ? WHERE id = ?').run(timestamp, storyId);
      result = {
        restored: payload.page_count,
        restored_range: payload.removed_range,
        recovery: { id: recoveryId, status: 'restored', resolved_at: timestamp },
      };
      journalInTransaction(kind, storyId, 'story', storyId, {
        recovery_id: recoveryId,
      }, result, idempotencyKey);
    });
    if (!result) return null;
    invalidatePreview(storyId);
    return result;
  }

  function listRecoveries(storyId, onPlate = null) {
    expireRecoveries(storyId, onPlate);
    const fingerprint = chainFingerprint(storyId);
    return db.prepare(`
      SELECT * FROM recovery_suffixes WHERE story_id = ? ORDER BY created_at DESC, id DESC
    `).all(storyId).map((row) => recoveryMetadata(row, fingerprint));
  }

  function getRecovery(storyId, recoveryId, onPlate = null) {
    expireRecoveries(storyId, onPlate);
    const row = db.prepare('SELECT * FROM recovery_suffixes WHERE story_id = ? AND id = ?')
      .get(storyId, recoveryId);
    return row ? recoveryMetadata(row, chainFingerprint(storyId)) : null;
  }

  function exportRecovery(storyId, recoveryId, onPlate = null) {
    expireRecoveries(storyId, onPlate);
    const row = db.prepare('SELECT * FROM recovery_suffixes WHERE story_id = ? AND id = ?')
      .get(storyId, recoveryId);
    if (!row) return null;
    const payload = parseJson(row.payload_json, {});
    delete payload.undo_sha256;
    delete payload.undo_expires_at;
    return {
      format: 'ink-morrow-recovery-suffix',
      version: 1,
      recovery: recoveryMetadata(row, chainFingerprint(storyId)),
      payload,
    };
  }

  function recoveryPageIds(storyId) {
    const ids = new Set();
    for (const row of db.prepare('SELECT payload_json FROM recovery_suffixes WHERE story_id = ?').all(storyId)) {
      for (const page of parseJson(row.payload_json, {})?.pages || []) ids.add(page.id);
    }
    return [...ids];
  }

  return {
    createInitialRevisionInTransaction,
    revisionState,
    listPageRevisions,
    tailEdit,
    tailEditInTransaction,
    copyedit,
    truncateAfter,
    restoreRecovery,
    listRecoveries,
    getRecovery,
    exportRecovery,
    recoveryPageIds,
    expireRecoveries,
    chainFingerprint,
    journalInTransaction,
  };
}

module.exports = {
  DEFAULT_RECOVERY_DAYS,
  UNDO_WINDOW_MS,
  createRevisionStore,
};
