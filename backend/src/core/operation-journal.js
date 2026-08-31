'use strict';

const { randomUUID } = require('node:crypto');

function now(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}

function beginOperation(db, {
  id = randomUUID(),
  kind,
  subjectType = null,
  subjectId = null,
  idempotencyKey = null,
  requestJson = null,
} = {}, { clock } = {}) {
  const timestamp = now(clock);
  db.prepare(`
    INSERT INTO operation_journal
      (id, kind, subject_type, subject_id, idempotency_key, status,
       request_json, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    requireText(id, 'id'),
    requireText(kind, 'kind'),
    subjectType,
    subjectId,
    idempotencyKey,
    requestJson,
    timestamp,
    timestamp
  );
  return getOperation(db, id);
}

function getOperation(db, id) {
  return db.prepare('SELECT * FROM operation_journal WHERE id = ?').get(id) || null;
}

function settleOperation(db, id, status, {
  resultJson = null,
  errorCode = null,
  errorMessage = null,
  spendUsd = 0,
} = {}, { clock } = {}) {
  if (!['committed', 'failed', 'cancelled'].includes(status)) {
    throw new TypeError('status must be committed, failed, or cancelled');
  }
  if (typeof spendUsd !== 'number' || !Number.isFinite(spendUsd) || spendUsd < 0) {
    throw new TypeError('spendUsd must be a non-negative finite number');
  }
  const timestamp = now(clock);
  const result = db.prepare(`
    UPDATE operation_journal
       SET status = ?, result_json = ?, error_code = ?, error_message = ?,
           spend_usd = ?, updated_at = ?, finished_at = ?
     WHERE id = ? AND status = 'pending'
  `).run(status, resultJson, errorCode, errorMessage, spendUsd, timestamp, timestamp, id);
  if (Number(result.changes) !== 1) {
    const existing = getOperation(db, id);
    if (!existing) throw new Error(`Operation ${id} does not exist`);
    throw new Error(`Operation ${id} is already ${existing.status}`);
  }
  return getOperation(db, id);
}

function reconcileInterruptedOperations(db, { clock } = {}) {
  const timestamp = now(clock);
  const result = db.prepare(`
    UPDATE operation_journal
       SET status = 'interrupted',
           error_code = COALESCE(error_code, 'process_restart'),
           error_message = COALESCE(error_message, 'Interrupted by a process restart; no success was assumed.'),
           updated_at = ?,
           finished_at = ?
     WHERE status = 'pending'
  `).run(timestamp, timestamp);
  return Number(result.changes);
}

module.exports = {
  beginOperation,
  getOperation,
  settleOperation,
  reconcileInterruptedOperations,
};
