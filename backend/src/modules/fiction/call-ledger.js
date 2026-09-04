'use strict';

const { randomUUID } = require('node:crypto');
const { callLimit } = require('./quality');

function createCallLedger({ db, transaction, assertRequestCurrent, fail }) {
  const usage = (requestId) => {
    const value = db.prepare(`SELECT count(*) AS calls, coalesce(sum(cost_usd), 0) AS knownCostUsd,
      coalesce(sum(billed_attempts), 0) AS billedAttempts,
      coalesce(sum(CASE WHEN cost_usd IS NULL THEN billed_attempts ELSE 0 END), 0) AS unknownAttempts
      FROM fiction_calls WHERE request_id = ?`).get(requestId);
    return { ...value, costUsd: value.unknownAttempts ? null : value.knownCostUsd };
  };
  function dispatch(request, role, purpose, model) {
    return transaction(() => {
      const context = assertRequestCurrent(request);
      const next = db.prepare('SELECT coalesce(max(call_index), 0) + 1 AS n FROM fiction_calls WHERE request_id = ?').get(request.id).n;
      if (next > callLimit(context.state.quality_mode || 'off')) fail('The reviewed model-call limit has been reached.', 'STORY_CALL_LIMIT', 409);
      const id = randomUUID();
      db.prepare("INSERT INTO fiction_calls (id, request_id, call_index, role, purpose, model, status, billed_attempts) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1)")
        .run(id, request.id, next, role, purpose, model || null);
      return id;
    });
  }
  function finish(id, { costUsd = null, billedAttempts = 1, model = null } = {}, failed = false) {
    const cost = typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0 && costUsd <= 1000000000 ? costUsd : null;
    // A returned completion or an uncertain dispatched transport is one attempt.
    // No transport retry is enabled. Never turn missing billing data into zero.
    const attempts = Number.isInteger(billedAttempts) && billedAttempts >= 1 ? billedAttempts : 1;
    db.prepare("UPDATE fiction_calls SET status = ?, cost_usd = ?, billed_attempts = ?, model = coalesce(?, model), finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'interrupted')")
      .run(failed ? 'failed' : 'completed', cost, attempts, typeof model === 'string' ? model.slice(0, 500) : null, id);
  }
  const rows = (requestId) => db.prepare('SELECT call_index, role, purpose, model, status, cost_usd, billed_attempts FROM fiction_calls WHERE request_id = ? ORDER BY call_index').all(requestId);
  return { usage, dispatch, finish, rows };
}

module.exports = { createCallLedger };
