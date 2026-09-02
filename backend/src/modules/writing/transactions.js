'use strict';

// Durable PR 06 writing state machine. Provider work happens outside SQLite;
// every transition on either side of it is durable, idempotent and checked
// against the same story context plus an expiring single-writer lease.

const { createHash, randomBytes, randomUUID } = require('node:crypto');

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const TERMINAL = new Set(['succeeded', 'committed', 'failed', 'superseded']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function opaqueId() {
  return randomBytes(32).toString('base64url');
}

function transactionError(message, code, statusCode = 409, state = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (state) error.state = state;
  return error;
}

function knownCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function providerRecord(result, content) {
  return {
    complete: true,
    content,
    model: result?.model || null,
    usage: result?.usage || null,
    cost_usd: knownCost(result?.cost_usd),
    billed_attempts: Number.isInteger(result?.billed_attempts) ? result.billed_attempts : 1,
  };
}

function createWritingTransactions({
  db,
  stories,
  continuityStore,
  continuity,
  writing,
  clock = () => new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  autoSuccessorEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_SUCCESSOR_PREPARATION === '1',
  logger = console,
}) {
  let disposed = false;

  function nowDate() {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  }

  function nowIso() {
    return nowDate().toISOString();
  }

  function expiryIso() {
    return new Date(nowDate().getTime() + leaseMs).toISOString();
  }

  function inTransaction(work) {
    return stories.hierarchy.inImmediateTransaction(work);
  }

  function operationByKey(storyId, key) {
    return db.prepare('SELECT * FROM writing_operations WHERE story_id = ? AND idempotency_key = ?')
      .get(storyId, key);
  }

  function operationById(storyId, id) {
    return db.prepare('SELECT * FROM writing_operations WHERE story_id = ? AND id = ?').get(storyId, id);
  }

  function publicOperation(row) {
    if (!row) return null;
    return {
      id: row.id,
      sequence: row.sequence,
      idempotency_key: row.idempotency_key,
      kind: row.kind,
      status: row.status,
      spend_usd: row.spend_usd,
      billed_attempts: row.billed_attempts,
      error_code: row.error_code || null,
      error_message: row.error_message || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      finished_at: row.finished_at || null,
    };
  }

  function latestPrepared(storyId) {
    return db.prepare('SELECT * FROM prepared_pages WHERE story_id = ?').get(storyId);
  }

  function publicPrepared(row) {
    if (!row) return null;
    const provider = parseJson(row.provider_result_json, {}) || {};
    return {
      id: row.id,
      preview_id: row.id,
      preview_key: row.id,
      expected_page: row.expected_page,
      model: provider.model || null,
      cost_usd: knownCost(row.spend_usd),
      operation_id: row.operation_id,
      created_at: row.created_at,
    };
  }

  function contextSnapshot(storyId, generation = {}) {
    const story = db.prepare(`
      SELECT id, title, world_id, characters, tone
        FROM stories WHERE id = ?
    `).get(storyId);
    if (!story) return null;
    const pages = db.prepare(`
      SELECT sp.id, sp.page_number, p.canonical_revision_id, p.display_revision_id
        FROM story_pages sp
        JOIN pages p ON p.id = sp.id
       WHERE sp.story_id = ?
       ORDER BY sp.page_number
    `).all(storyId);
    const tail = pages.length ? pages[pages.length - 1] : null;
    const target = db.prepare(`
      SELECT v.id AS volume_id, v.ordinal AS volume_ordinal,
             c.id AS chapter_id, c.ordinal AS chapter_ordinal
        FROM volumes v
        JOIN chapters c ON c.volume_id = v.id
       WHERE v.story_id = ?
       ORDER BY v.ordinal DESC, c.ordinal DESC
       LIMIT 1
    `).get(storyId) || null;
    const recentDisplays = pages.slice(-8).map((page) => [page.id, page.display_revision_id]);
    const snapshotRows = db.prepare(`
      SELECT id, template_kind, source_template_id, source_revision, snapshot_json, created_at
        FROM template_snapshots WHERE story_id = ?
       ORDER BY template_kind, source_template_id, created_at, rowid
    `).all(storyId);
    const latestTemplates = new Map();
    for (const row of snapshotRows) latestTemplates.set(`${row.template_kind}:${row.source_template_id}`, row);
    const corrections = db.prepare(`
      SELECT id, scope, subject_id, correction_json, updated_at
        FROM continuity_corrections WHERE story_id = ? ORDER BY created_at, rowid
    `).all(storyId);
    const authorCanon = db.prepare(`
      SELECT entry.id, entry.kind, entry.subject_id, entry.status, entry.updated_at,
             revision.id AS revision_id, revision.revision_number,
             revision.title, revision.value_json, revision.note
        FROM author_canon_entries entry
        JOIN author_canon_revisions revision ON revision.entry_id = entry.id
       WHERE entry.story_id = ?
         AND revision.revision_number = (
           SELECT MAX(latest.revision_number)
             FROM author_canon_revisions latest WHERE latest.entry_id = entry.id
         )
       ORDER BY entry.created_at, entry.id
    `).all(storyId);
    const scribeBinding = db.prepare(`
      SELECT id, action, source_scribe_id, source_revision_number, snapshot_json, created_at
        FROM story_scribe_bindings WHERE story_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(storyId) || null;
    // Folded state is versioned by its canonical evidence chain and explicit
    // author corrections, not by asynchronous projection/checkpoint timing.
    const foldedStateVersion = sha256(stableJson({
      revisions: pages.map((page) => page.canonical_revision_id),
      corrections: corrections.map((row) => [row.id, row.updated_at, sha256(row.correction_json)]),
      author_canon: authorCanon.map((row) => [
        row.id, row.status, row.updated_at, row.revision_id,
        row.revision_number, sha256(`${row.kind}\n${row.subject_id || ''}\n${row.title}\n${row.value_json}\n${row.note || ''}`),
      ]),
    }));
    const context = {
      story: {
        id: story.id,
        title: story.title,
        world_id: story.world_id,
        characters: parseJson(story.characters, []),
        tone: story.tone,
      },
      tail: tail ? {
        page_id: tail.id,
        page_number: tail.page_number,
        canonical_revision_id: tail.canonical_revision_id,
        display_revision_id: tail.display_revision_id,
      } : null,
      target: target ? {
        volume_id: target.volume_id,
        volume_ordinal: target.volume_ordinal,
        chapter_id: target.chapter_id,
        chapter_ordinal: target.chapter_ordinal,
      } : null,
      recent_display_revisions: recentDisplays,
      templates: [...latestTemplates.values()].map((row) => ({
        kind: row.template_kind,
        source_id: row.source_template_id,
        source_revision: row.source_revision,
        snapshot_hash: sha256(row.snapshot_json),
      })),
      scribe: scribeBinding && scribeBinding.action === 'assigned' ? {
        binding_id: scribeBinding.id,
        source_scribe_id: scribeBinding.source_scribe_id,
        source_revision_number: scribeBinding.source_revision_number,
        snapshot_hash: sha256(scribeBinding.snapshot_json),
      } : null,
      folded_state_version: foldedStateVersion,
      generation: stableValue(generation),
    };
    return { context, json: stableJson(context), fingerprint: sha256(stableJson(context)), tail };
  }

  function leaseState(row) {
    return row ? {
      writer_session_id: row.writer_session_id,
      acquired_at: row.acquired_at,
      heartbeat_at: row.heartbeat_at,
      expires_at: row.expires_at,
      reconcile: 'Refresh the story and acquire the writer lease before retrying.',
    } : null;
  }

  function currentLease(storyId) {
    const row = db.prepare('SELECT * FROM writer_leases WHERE story_id = ?').get(storyId);
    if (!row) return null;
    if (Date.parse(row.expires_at) <= nowDate().getTime()) {
      db.prepare('DELETE FROM writer_leases WHERE story_id = ? AND lease_token = ?').run(storyId, row.lease_token);
      return null;
    }
    return row;
  }

  function acquireLeaseInTransaction(storyId, writerSessionId) {
    const current = db.prepare('SELECT * FROM writer_leases WHERE story_id = ?').get(storyId);
    const expired = current && Date.parse(current.expires_at) <= nowDate().getTime();
    const isCompatibilityWriter = (value) => value === 'legacy-client' || value.startsWith('compat:');
    // Pre-4.0 and implicit authenticated callers cannot present a stable tab
    // identity. Let an identified tab replace that compatibility lease once no
    // provider operation is using its token. A live provider call is never
    // preempted; its late reply still depends on the exact token.
    const compatibilityActive = current && isCompatibilityWriter(current.writer_session_id) &&
      db.prepare(`
        SELECT 1 FROM writing_operations
         WHERE story_id = ? AND lease_token = ? AND status IN ('requested', 'running')
         LIMIT 1
      `).get(storyId, current.lease_token);
    const replaceIdleCompatibility = current && !expired && isCompatibilityWriter(current.writer_session_id) &&
      !isCompatibilityWriter(writerSessionId) && !compatibilityActive;
    if (current && !expired && current.writer_session_id !== writerSessionId && !replaceIdleCompatibility) {
      throw transactionError(
        'Another writing session currently owns this story. Refresh to reconcile before writing.',
        'WRITER_LEASE_CONFLICT',
        409,
        leaseState(current)
      );
    }
    const timestamp = nowIso();
    const token = current && !expired && !replaceIdleCompatibility ? current.lease_token : opaqueId();
    db.prepare(`
      INSERT INTO writer_leases
        (story_id, writer_session_id, lease_token, acquired_at, heartbeat_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(story_id) DO UPDATE SET
        writer_session_id = excluded.writer_session_id,
        lease_token = excluded.lease_token,
        acquired_at = CASE
          WHEN writer_leases.writer_session_id = excluded.writer_session_id
            AND writer_leases.expires_at > excluded.heartbeat_at
          THEN writer_leases.acquired_at ELSE excluded.acquired_at END,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at
    `).run(storyId, writerSessionId, token, timestamp, timestamp, expiryIso());
    return db.prepare('SELECT * FROM writer_leases WHERE story_id = ?').get(storyId);
  }

  function acquireLease(storyId, writerSessionId) {
    let lease;
    inTransaction(() => { lease = acquireLeaseInTransaction(storyId, writerSessionId); });
    return leaseState(lease);
  }

  function releaseLease(storyId, writerSessionId) {
    const lease = currentLease(storyId);
    if (!lease) return false;
    if (lease.writer_session_id !== writerSessionId) {
      throw transactionError('This writing session does not own the story lease.', 'WRITER_LEASE_CONFLICT', 409, leaseState(lease));
    }
    return db.prepare('DELETE FROM writer_leases WHERE story_id = ? AND writer_session_id = ?')
      .run(storyId, writerSessionId).changes > 0;
  }

  function requestIdentity(kind, request) {
    return sha256(stableJson({ kind, request }));
  }

  function replayOrThrow(row, requestHash) {
    if (row.request_hash !== requestHash) {
      throw transactionError(
        'This idempotency key was already used for a different writing request.',
        'IDEMPOTENCY_KEY_REUSED'
      );
    }
    if (row.status === 'succeeded' || row.status === 'committed') {
      return { ...(parseJson(row.result_json, {}) || {}), operation: publicOperation(row), replayed: true };
    }
    if (row.status === 'requested' || row.status === 'running') {
      throw transactionError('This writing operation is already in progress.', 'OPERATION_IN_PROGRESS', 409, {
        operation: publicOperation(row),
        reconcile: 'Poll the operation or refresh the story before retrying.',
      });
    }
    const error = transactionError(
      row.error_message || 'This writing operation did not commit.',
      row.error_code || (row.status === 'superseded' ? 'OPERATION_SUPERSEDED' : 'OPERATION_FAILED')
    );
    error.costUsd = knownCost(row.spend_usd);
    error.billedAttempts = row.billed_attempts;
    throw error;
  }

  function nextSequence(storyId) {
    return db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM writing_operations WHERE story_id = ?')
      .get(storyId).value;
  }

  function insertOperationInTransaction({ storyId, key, kind, writerSessionId, request, snapshot, lease }) {
    const id = randomUUID();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO writing_operations
        (id, story_id, sequence, idempotency_key, request_hash, kind, status,
         writer_session_id, lease_token, expected_tail_page_id,
         expected_tail_revision_id, context_fingerprint, request_json,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, storyId, nextSequence(storyId), key, requestIdentity(kind, request), kind,
      writerSessionId, lease.lease_token, snapshot.tail?.id || null,
      snapshot.tail?.canonical_revision_id || null, snapshot.fingerprint,
      stableJson(request), timestamp, timestamp
    );
    return operationById(storyId, id);
  }

  function activePreparation(storyId, fingerprint) {
    return db.prepare(`
      SELECT * FROM writing_operations
       WHERE story_id = ? AND kind = 'prepare'
         AND status IN ('requested', 'running') AND context_fingerprint = ?
       ORDER BY sequence DESC LIMIT 1
    `).get(storyId, fingerprint);
  }

  function beginProviderOperation({ storyId, key, kind, writerSessionId, request, generation, consumePrepared = false }) {
    const hash = requestIdentity(kind, request);
    const existing = operationByKey(storyId, key);
    if (existing) return { replay: replayOrThrow(existing, hash) };
    const snapshot = contextSnapshot(storyId, generation);
    if (!snapshot) throw transactionError('Story not found.', 'STORY_NOT_FOUND', 404);
    let outcome;
    inTransaction(() => {
      const repeated = operationByKey(storyId, key);
      if (repeated) {
        outcome = { replay: replayOrThrow(repeated, hash) };
        return;
      }
      const lease = acquireLeaseInTransaction(storyId, writerSessionId);
      if (kind === 'prepare') {
        const prepared = latestPrepared(storyId);
        if (prepared && prepared.context_fingerprint === snapshot.fingerprint) {
          const operation = insertOperationInTransaction({
            storyId, key, kind, writerSessionId, request, snapshot, lease,
          });
          const result = { preview: publicPrepared(prepared), reused: true };
          const timestamp = nowIso();
          db.prepare(`
            UPDATE writing_operations SET status = 'succeeded', result_json = ?,
              updated_at = ?, finished_at = ? WHERE id = ?
          `).run(stableJson(result), timestamp, timestamp, operation.id);
          outcome = { replay: { ...result, operation: publicOperation(operationById(storyId, operation.id)) } };
          return;
        }
        const active = activePreparation(storyId, snapshot.fingerprint);
        if (active) {
          outcome = { joining: publicOperation(active) };
          return;
        }
      }
      const operation = insertOperationInTransaction({
        storyId, key, kind, writerSessionId, request, snapshot, lease,
      });
      if (consumePrepared) {
        db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
        db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
        db.prepare(`
          UPDATE writing_operations SET status = 'superseded', error_code = 'PREVIEW_SUPERSEDED',
            error_message = 'A directed write consumed this preparation.', updated_at = ?, finished_at = ?
           WHERE story_id = ? AND kind = 'prepare' AND status IN ('requested', 'running') AND id <> ?
        `).run(nowIso(), nowIso(), storyId, operation.id);
      }
      db.prepare("UPDATE writing_operations SET status = 'running', updated_at = ? WHERE id = ?")
        .run(nowIso(), operation.id);
      outcome = { operation: operationById(storyId, operation.id), snapshot };
    });
    return outcome;
  }

  function failedProviderOperation(operation, error) {
    const spend = knownCost(error?.costUsd) ?? 0;
    const attempts = Number.isInteger(error?.billedAttempts) ? error.billedAttempts : 0;
    inTransaction(() => {
      const current = operationById(operation.story_id, operation.id);
      if (!current || TERMINAL.has(current.status)) return;
      const timestamp = nowIso();
      db.prepare(`
        UPDATE writing_operations SET status = 'failed', spend_usd = ?, billed_attempts = ?,
          error_code = ?, error_message = ?, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(spend, attempts, error?.code || 'PROVIDER_FAILED', String(error?.message || 'Provider request failed').slice(0, 1000),
        timestamp, timestamp, operation.id);
    });
  }

  function heartbeatWhileRunning(operation) {
    const intervalMs = Math.max(1000, Math.min(30000, Math.floor(leaseMs / 3)));
    const timer = setInterval(() => {
      if (disposed) return;
      try {
        const timestamp = nowIso();
        db.prepare(`
          UPDATE writer_leases SET heartbeat_at = ?, expires_at = ?
           WHERE story_id = ? AND writer_session_id = ? AND lease_token = ?
        `).run(timestamp, expiryIso(), operation.story_id, operation.writer_session_id, operation.lease_token);
      } catch {
        // A closing database or lost lease is observed authoritatively when
        // the provider reply reaches the transaction boundary.
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  function staleReason(operation, snapshot, { requireLatestPrepare = false } = {}) {
    const current = operationById(operation.story_id, operation.id);
    if (!current || current.status !== 'running') {
      return { code: current?.error_code || 'OPERATION_CANCELLED', message: current?.error_message || 'The writing operation is no longer active.' };
    }
    const lease = db.prepare('SELECT * FROM writer_leases WHERE story_id = ?').get(operation.story_id);
    if (!lease || lease.lease_token !== operation.lease_token || lease.writer_session_id !== operation.writer_session_id ||
        Date.parse(lease.expires_at) <= nowDate().getTime()) {
      return { code: 'WRITER_LEASE_LOST', message: 'The writer lease expired or moved to another session. Refresh to reconcile.' };
    }
    const fresh = contextSnapshot(operation.story_id, snapshot.context.generation);
    if (!fresh || fresh.fingerprint !== operation.context_fingerprint) {
      return { code: 'CONTEXT_CHANGED', message: 'The story context changed while the provider was writing.' };
    }
    if (requireLatestPrepare) {
      const newer = db.prepare(`
        SELECT id FROM writing_operations
         WHERE story_id = ? AND kind = 'prepare' AND sequence > ?
         ORDER BY sequence LIMIT 1
      `).get(operation.story_id, operation.sequence);
      if (newer) return { code: 'PREPARATION_SUPERSEDED', message: 'A newer preparation replaced this request.' };
    }
    return null;
  }

  function persistLateSpend(operation, provider) {
    const timestamp = nowIso();
    db.prepare(`
      UPDATE writing_operations SET provider_result_json = ?, spend_usd = ?, billed_attempts = ?,
        updated_at = ?, finished_at = COALESCE(finished_at, ?)
       WHERE id = ?
    `).run(stableJson(provider), provider.cost_usd ?? 0, provider.billed_attempts, timestamp, timestamp, operation.id);
  }

  async function prepare({ story, key, writerSessionId, generation }) {
    const request = { generation };
    const begun = beginProviderOperation({
      storyId: story.id, key, kind: 'prepare', writerSessionId, request,
      generation: { ...generation, direction: 'Continue the story.' },
    });
    if (begun.replay) return begun.replay;
    if (begun.joining) return { preview: null, preparation: begun.joining, pending: true };
    const { operation, snapshot } = begun;
    const stopHeartbeat = heartbeatWhileRunning(operation);
    let result;
    let prose;
    try {
      result = await writing.completePage({
        story,
        userInput: 'Continue the story.',
        wordTarget: generation.words,
        modelOverride: generation.model,
        reasoningEffort: generation.reasoning_effort,
      });
      prose = writing.consumeStoryText(result.content);
    } catch (error) {
      failedProviderOperation(operation, error);
      throw error;
    } finally {
      stopHeartbeat();
    }
    const provider = providerRecord(result, prose);
    let outcome;
    inTransaction(() => {
      const reason = staleReason(operation, snapshot, { requireLatestPrepare: true });
      if (reason) {
        persistLateSpend(operation, provider);
        const current = operationById(story.id, operation.id);
        if (current && !TERMINAL.has(current.status)) {
          db.prepare(`
            UPDATE writing_operations SET status = 'superseded', error_code = ?, error_message = ?,
              updated_at = ?, finished_at = ? WHERE id = ?
          `).run(reason.code, reason.message, nowIso(), nowIso(), operation.id);
        }
        outcome = { error: reason };
        return;
      }
      const id = opaqueId();
      const timestamp = nowIso();
      db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(story.id);
      db.prepare(`
        INSERT INTO prepared_pages
          (story_id, id, operation_id, expected_page, expected_tail_page_id,
           expected_tail_revision_id, context_fingerprint, context_json, content,
           provider_result_json, spend_usd, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        story.id, id, operation.id, stories.nextPageNumber(story.id), snapshot.tail?.id || null,
        snapshot.tail?.canonical_revision_id || null, snapshot.fingerprint, snapshot.json,
        prose, stableJson(provider), provider.cost_usd ?? 0, timestamp, timestamp
      );
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(story.id);
      const prepared = latestPrepared(story.id);
      const response = { preview: publicPrepared(prepared) };
      db.prepare(`
        UPDATE writing_operations SET status = 'succeeded', provider_result_json = ?, result_json = ?,
          spend_usd = ?, billed_attempts = ?, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(stableJson(provider), stableJson(response), provider.cost_usd ?? 0,
        provider.billed_attempts, timestamp, timestamp, operation.id);
      outcome = { ...response, operation: publicOperation(operationById(story.id, operation.id)) };
    });
    if (outcome.error) {
      const error = transactionError(outcome.error.message, outcome.error.code);
      error.costUsd = provider.cost_usd;
      error.billedAttempts = provider.billed_attempts;
      throw error;
    }
    return outcome;
  }

  function enqueueContinuityInTransaction(page, revision) {
    if (!page?.content?.trim() || page.image_media_type) return;
    continuityStore.beginPage({
      ...page,
      revision_id: revision.id,
      canonical_revision_id: revision.id,
      content: revision.content,
    });
  }

  function commitGeneratedInTransaction({ operation, provider, direction, expectedPage, scribeBindingId = null }) {
    const inserted = stories.insertGeneratedPageInTransaction(operation.story_id, {
      content: provider.content,
      userInput: direction,
      model: provider.model,
      promptTokens: provider.usage?.prompt_tokens ?? null,
      completionTokens: provider.usage?.completion_tokens ?? null,
      costUsd: provider.cost_usd,
      pageNumber: expectedPage,
      scribeBindingId,
    });
    enqueueContinuityInTransaction(inserted.page, inserted.revision);
    db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(operation.story_id);
    db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(operation.story_id);
    db.prepare(`
      UPDATE writing_operations SET status = 'superseded', error_code = 'CANON_ADVANCED',
        error_message = 'Another writing action advanced this story.', updated_at = ?, finished_at = ?
       WHERE story_id = ? AND id <> ? AND status IN ('requested', 'running')
    `).run(nowIso(), nowIso(), operation.story_id, operation.id);
    return inserted;
  }

  function scheduleAfterCommit({ storyId, page, revision, writerSessionId, generation }) {
    if (disposed) return;
    setImmediate(() => {
      if (disposed) return;
      const currentStory = stories.getStory(storyId);
      if (!currentStory) return;
      if (continuity.isAutoEnabled()) {
        // The writing model belongs to the Scribe role. Page memory always
        // uses the independently configured Archivist role.
        void continuity.maybeSyncPage(currentStory, page).catch((error) => {
          logger.error(`Continuity background work failed for page ${page.id}: ${error.message}`);
        });
      }
      if (autoSuccessorEnabled) {
        void prepare({
          story: currentStory,
          key: `successor:${revision.id}`,
          writerSessionId,
          generation,
        }).catch((error) => {
          if (!['CONTEXT_CHANGED', 'WRITER_LEASE_LOST', 'OPERATION_IN_PROGRESS'].includes(error.code)) {
            logger.error(`Successor preparation failed for page ${page.id}: ${error.message}`);
          }
        });
      }
    });
  }

  async function directedGenerate({ story, key, writerSessionId, direction, generation }) {
    const request = { direction, generation };
    const contextGeneration = { ...generation, direction };
    const begun = beginProviderOperation({
      storyId: story.id, key, kind: 'directed_generate', writerSessionId,
      request, generation: contextGeneration, consumePrepared: true,
    });
    if (begun.replay) return begun.replay;
    const { operation, snapshot } = begun;
    const stopHeartbeat = heartbeatWhileRunning(operation);
    let result;
    let prose;
    try {
      result = await writing.completePage({
        story,
        userInput: direction,
        wordTarget: generation.words,
        modelOverride: generation.model,
        reasoningEffort: generation.reasoning_effort,
      });
      prose = writing.consumeStoryText(result.content);
    } catch (error) {
      failedProviderOperation(operation, error);
      throw error;
    } finally {
      stopHeartbeat();
    }
    const provider = providerRecord(result, prose);
    let outcome;
    inTransaction(() => {
      const reason = staleReason(operation, snapshot);
      if (reason) {
        persistLateSpend(operation, provider);
        const current = operationById(story.id, operation.id);
        if (current && !TERMINAL.has(current.status)) {
          db.prepare(`
            UPDATE writing_operations SET status = 'superseded', error_code = ?, error_message = ?,
              updated_at = ?, finished_at = ? WHERE id = ?
          `).run(reason.code, reason.message, nowIso(), nowIso(), operation.id);
        }
        outcome = { error: reason };
        return;
      }
      const inserted = commitGeneratedInTransaction({
        operation, provider, direction, expectedPage: stories.nextPageNumber(story.id),
        scribeBindingId: snapshot.context.scribe?.binding_id || null,
      });
      const response = {
        page: inserted.page,
        continuity_pending: continuity.isAutoEnabled(),
        successor_pending: autoSuccessorEnabled,
      };
      const timestamp = nowIso();
      db.prepare(`
        UPDATE writing_operations SET status = 'committed', provider_result_json = ?, result_json = ?,
          spend_usd = ?, billed_attempts = ?, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(stableJson(provider), stableJson(response), provider.cost_usd ?? 0,
        provider.billed_attempts, timestamp, timestamp, operation.id);
      outcome = {
        ...response,
        revision: inserted.revision,
        operation: publicOperation(operationById(story.id, operation.id)),
      };
    });
    if (outcome.error) {
      const error = transactionError(outcome.error.message, outcome.error.code);
      error.costUsd = provider.cost_usd;
      error.billedAttempts = provider.billed_attempts;
      throw error;
    }
    stories.markPreviewInvalidated(story.id);
    scheduleAfterCommit({
      storyId: story.id,
      page: outcome.page,
      revision: outcome.revision,
      writerSessionId,
      generation,
    });
    const response = { ...outcome };
    delete response.revision;
    return response;
  }

  async function regenerate({ story, key, writerSessionId, page, generation }) {
    const direction = page.user_input || 'Continue the story.';
    const request = { page_id: page.id, direction, generation };
    const contextGeneration = { ...generation, direction, exclude_last: true, page_id: page.id };
    const begun = beginProviderOperation({
      storyId: story.id, key, kind: 'regenerate', writerSessionId,
      request, generation: contextGeneration,
    });
    if (begun.replay) return begun.replay;
    const { operation, snapshot } = begun;
    const stopHeartbeat = heartbeatWhileRunning(operation);
    let result;
    let prose;
    try {
      result = await writing.completePage({
        story,
        userInput: direction,
        wordTarget: generation.words,
        modelOverride: generation.model,
        reasoningEffort: generation.reasoning_effort,
        excludeLast: true,
      });
      prose = writing.consumeStoryText(result.content);
    } catch (error) {
      failedProviderOperation(operation, error);
      throw error;
    } finally {
      stopHeartbeat();
    }
    const provider = providerRecord(result, prose);
    let outcome;
    inTransaction(() => {
      let reason = staleReason(operation, snapshot);
      if (reason?.code === 'CONTEXT_CHANGED') {
        const current = contextSnapshot(story.id, snapshot.context.generation);
        if (!current?.tail || current.tail.id !== operation.expected_tail_page_id ||
            current.tail.canonical_revision_id !== operation.expected_tail_revision_id) {
          reason = {
            code: 'REWRITE_SUPERSEDED',
            message: 'The tail page changed while its replacement was being written.',
          };
        }
      }
      if (reason) {
        persistLateSpend(operation, provider);
        const current = operationById(story.id, operation.id);
        if (current && !TERMINAL.has(current.status)) {
          db.prepare(`
            UPDATE writing_operations SET status = 'superseded', error_code = ?, error_message = ?,
              updated_at = ?, finished_at = ? WHERE id = ?
          `).run(reason.code, reason.message, nowIso(), nowIso(), operation.id);
        }
        outcome = { error: reason };
        return;
      }
      const edited = stories.revisions.tailEditInTransaction(story.id, page.id, {
        content: provider.content,
        direction,
        source: 'ai',
        model: provider.model,
        promptTokens: provider.usage?.prompt_tokens ?? null,
        completionTokens: provider.usage?.completion_tokens ?? null,
        costUsd: provider.cost_usd,
        scribeBindingId: snapshot.context.scribe?.binding_id || null,
      });
      enqueueContinuityInTransaction(edited.page, edited.revision);
      db.prepare(`
        UPDATE writing_operations SET status = 'superseded', error_code = 'CANON_ADVANCED',
          error_message = 'Another writing action advanced this story.', updated_at = ?, finished_at = ?
         WHERE story_id = ? AND id <> ? AND status IN ('requested', 'running')
      `).run(nowIso(), nowIso(), story.id, operation.id);
      const response = {
        page: edited.page,
        continuity_pending: continuity.isAutoEnabled(),
        successor_pending: autoSuccessorEnabled,
      };
      const timestamp = nowIso();
      db.prepare(`
        UPDATE writing_operations SET status = 'committed', provider_result_json = ?, result_json = ?,
          spend_usd = ?, billed_attempts = ?, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(stableJson(provider), stableJson(response), provider.cost_usd ?? 0,
        provider.billed_attempts, timestamp, timestamp, operation.id);
      outcome = {
        ...response,
        revision: edited.revision,
        operation: publicOperation(operationById(story.id, operation.id)),
      };
    });
    if (outcome.error) {
      const error = transactionError(outcome.error.message, outcome.error.code);
      error.costUsd = provider.cost_usd;
      error.billedAttempts = provider.billed_attempts;
      throw error;
    }
    stories.markPreviewInvalidated(story.id);
    scheduleAfterCommit({
      storyId: story.id,
      page: outcome.page,
      revision: outcome.revision,
      writerSessionId,
      generation,
    });
    const response = { ...outcome };
    delete response.revision;
    return response;
  }

  function promote({ story, key, writerSessionId, preparedId }) {
    const request = { prepared_id: preparedId };
    const hash = requestIdentity('promote', request);
    const existing = operationByKey(story.id, key);
    if (existing) return replayOrThrow(existing, hash);
    let outcome;
    let stale = null;
    inTransaction(() => {
      const repeated = operationByKey(story.id, key);
      if (repeated) {
        outcome = replayOrThrow(repeated, hash);
        return;
      }
      const prepared = latestPrepared(story.id);
      if (!prepared || prepared.id !== preparedId) {
        throw transactionError(
          'That prepared page is no longer available. Refresh before choosing Next Page.',
          prepared ? 'PREVIEW_REPLACED' : 'PREVIEW_MISSING'
        );
      }
      const context = parseJson(prepared.context_json, {}) || {};
      const fresh = contextSnapshot(story.id, context.generation || {});
      if (!fresh || fresh.fingerprint !== prepared.context_fingerprint ||
          stories.nextPageNumber(story.id) !== prepared.expected_page) {
        db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(story.id);
        stale = transactionError('The prepared page is stale because the story context changed.', 'PREVIEW_STALE');
        return;
      }
      const lease = acquireLeaseInTransaction(story.id, writerSessionId);
      const operation = insertOperationInTransaction({
        storyId: story.id, key, kind: 'promote', writerSessionId, request, snapshot: fresh, lease,
      });
      db.prepare("UPDATE writing_operations SET status = 'running', updated_at = ? WHERE id = ?")
        .run(nowIso(), operation.id);
      const provider = parseJson(prepared.provider_result_json, {}) || {};
      provider.content = prepared.content;
      const inserted = commitGeneratedInTransaction({
        operation,
        provider,
        direction: null,
        expectedPage: prepared.expected_page,
        scribeBindingId: fresh.context.scribe?.binding_id || null,
      });
      const response = {
        page: inserted.page,
        continuity_pending: continuity.isAutoEnabled(),
        successor_pending: autoSuccessorEnabled,
      };
      const timestamp = nowIso();
      db.prepare(`
        UPDATE writing_operations SET status = 'committed', provider_result_json = ?, result_json = ?,
          spend_usd = 0, billed_attempts = 0, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(stableJson(provider), stableJson(response), timestamp, timestamp, operation.id);
      outcome = {
        ...response,
        revision: inserted.revision,
        operation: publicOperation(operationById(story.id, operation.id)),
        generation: context.generation || {},
      };
    });
    if (stale) throw stale;
    stories.markPreviewInvalidated(story.id);
    scheduleAfterCommit({
      storyId: story.id,
      page: outcome.page,
      revision: outcome.revision,
      writerSessionId,
      generation: outcome.generation,
    });
    const response = { ...outcome };
    delete response.revision;
    delete response.generation;
    return response;
  }

  function cancel(storyId, key, writerSessionId) {
    let result;
    inTransaction(() => {
      const operation = operationByKey(storyId, key);
      if (!operation) return;
      const lease = acquireLeaseInTransaction(storyId, writerSessionId);
      if (operation.writer_session_id !== writerSessionId || operation.lease_token !== lease.lease_token) {
        throw transactionError('This session cannot cancel another writer\'s operation.', 'WRITER_LEASE_CONFLICT', 409, leaseState(lease));
      }
      if (operation.status === 'requested' || operation.status === 'running') {
        const timestamp = nowIso();
        db.prepare(`
          UPDATE writing_operations SET status = 'failed', error_code = 'CANCELLED',
            error_message = 'The author cancelled this writing operation.', updated_at = ?, finished_at = ?
           WHERE id = ?
        `).run(timestamp, timestamp, operation.id);
      }
      result = publicOperation(operationById(storyId, operation.id));
    });
    return result;
  }

  function operation(storyId, key) {
    return publicOperation(operationByKey(storyId, key));
  }

  function costs(storyId) {
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(spend_usd), 0) AS provider_spend_usd,
        COALESCE(SUM(CASE WHEN kind = 'prepare' THEN spend_usd ELSE 0 END), 0) AS speculative_spend_usd,
        COALESCE(SUM(CASE WHEN status IN ('failed', 'superseded') THEN spend_usd ELSE 0 END), 0) AS uncommitted_failed_spend_usd
      FROM writing_operations WHERE story_id = ?
    `).get(storyId);
    const committed = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(cost_usd, 0) + COALESCE(continuity_cost_usd, 0)), 0) AS value
        FROM story_pages WHERE story_id = ?
    `).get(storyId).value;
    const prepared = latestPrepared(storyId);
    return {
      ...totals,
      current_prepared_spend_usd: prepared ? prepared.spend_usd : 0,
      committed_story_total_usd: committed,
    };
  }

  function adoptLegacyPreview(storyId) {
    if (latestPrepared(storyId)) return latestPrepared(storyId);
    const legacy = db.prepare('SELECT * FROM story_previews WHERE story_id = ?').get(storyId);
    if (!legacy) return null;
    const snapshot = contextSnapshot(storyId, { direction: 'Continue the story.', legacy: true });
    if (!snapshot || stories.nextPageNumber(storyId) !== legacy.expected_page) {
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
      return null;
    }
    let prepared;
    inTransaction(() => {
      const request = { generation: snapshot.context.generation, imported_legacy_preview: true };
      const operation = insertOperationInTransaction({
        storyId, key: `legacy-preview:${sha256(`${legacy.created_at}:${legacy.raw_content}`)}`,
        kind: 'prepare', writerSessionId: 'legacy-preview-migration', request, snapshot,
        lease: { lease_token: 'legacy-preview-migration' },
      });
      const provider = {
        complete: true,
        content: legacy.raw_content,
        model: legacy.model || null,
        usage: { prompt_tokens: legacy.prompt_tokens, completion_tokens: legacy.completion_tokens },
        cost_usd: knownCost(legacy.cost_usd),
        billed_attempts: 1,
      };
      const timestamp = nowIso();
      db.prepare(`
        INSERT INTO prepared_pages
          (story_id, id, operation_id, expected_page, expected_tail_page_id,
           expected_tail_revision_id, context_fingerprint, context_json, content,
           provider_result_json, spend_usd, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(storyId, opaqueId(), operation.id, legacy.expected_page,
        snapshot.tail?.id || null, snapshot.tail?.canonical_revision_id || null,
        snapshot.fingerprint, snapshot.json, legacy.raw_content, stableJson(provider),
        provider.cost_usd ?? 0, timestamp, timestamp);
      const response = { preview: publicPrepared(latestPrepared(storyId)) };
      db.prepare(`
        UPDATE writing_operations SET status = 'succeeded', provider_result_json = ?, result_json = ?,
          spend_usd = ?, billed_attempts = 1, updated_at = ?, finished_at = ? WHERE id = ?
      `).run(stableJson(provider), stableJson(response), provider.cost_usd ?? 0,
        timestamp, timestamp, operation.id);
      db.prepare('DELETE FROM story_previews WHERE story_id = ?').run(storyId);
      prepared = latestPrepared(storyId);
    });
    return prepared;
  }

  function prepared(storyId) {
    let row = latestPrepared(storyId) || adoptLegacyPreview(storyId);
    if (!row) return null;
    const context = parseJson(row.context_json, {}) || {};
    const fresh = contextSnapshot(storyId, context.generation || {});
    if (!fresh || fresh.fingerprint !== row.context_fingerprint || stories.nextPageNumber(storyId) !== row.expected_page) {
      db.prepare('DELETE FROM prepared_pages WHERE story_id = ?').run(storyId);
      row = null;
    }
    return publicPrepared(row);
  }

  function reconcile() {
    const timestamp = nowIso();
    db.prepare('DELETE FROM writer_leases WHERE expires_at <= ?').run(timestamp);
    db.prepare(`
      UPDATE writing_operations SET status = 'failed', error_code = 'RESTART_INTERRUPTED',
        error_message = 'The server restarted before the provider operation completed.',
        updated_at = ?, finished_at = ?
       WHERE status IN ('requested', 'running')
    `).run(timestamp, timestamp);
    for (const { story_id } of db.prepare('SELECT story_id FROM story_previews ORDER BY story_id').all()) {
      try { adoptLegacyPreview(story_id); } catch (error) {
        logger.error(`Legacy prepared page reconciliation failed for story ${story_id}: ${error.message}`);
      }
    }
  }

  reconcile();

  return {
    acquireLease,
    releaseLease,
    currentLease: (storyId) => leaseState(currentLease(storyId)),
    contextSnapshot,
    publicPrepared,
    prepared,
    prepare,
    directedGenerate,
    regenerate,
    promote,
    cancel,
    operation,
    costs,
    reconcile,
    dispose() { disposed = true; },
  };
}

module.exports = {
  createWritingTransactions,
  stableJson,
  sha256,
  providerRecord,
  DEFAULT_LEASE_MS,
};
