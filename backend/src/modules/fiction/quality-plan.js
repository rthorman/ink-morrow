'use strict';

const { createHash } = require('node:crypto');
const { reviewRoles, callLimit } = require('./quality');

function qualityPlan(state, providers) {
  const mode = state.quality_mode || 'off'; const reviewers = reviewRoles(mode);
  const roles = [...new Set(['scribe', ...reviewers])].map((role) => {
    const exposure = providers?.exposure(role) || { role, provider: null, model_id: null };
    let config = null; let available = !providers?.resolve;
    try { config = providers?.resolve?.(role, { capability: 'chat', credentialOptional: true }); if (config) available = Boolean(config.apiKey); }
    catch { available = false; }
    return { ...exposure, role, label: role === 'scribe' ? 'Standard storyteller' : 'Memory support',
      operation_count: mode === 'off' ? 1 : (role === 'scribe' ? 2 : 0) + (reviewers.includes(role) ? 2 : 0),
      available, endpoint: config?.baseUrl || null, timeout: config?.timeout || null };
  });
  const reviewId = createHash('sha256').update(JSON.stringify({ version: 1, mode, max_calls: callLimit(mode), roles: roles.map((role) => ({
    role: role.role, provider_id: role.provider?.id || null, model_id: role.model_id, endpoint: role.endpoint, timeout: role.timeout, operation_count: role.operation_count,
  })) })).digest('hex');
  return { mode, max_calls: callLimit(mode), calls_without_repair: 1 + reviewers.length, review_id: reviewId,
    available: roles.every((role) => role.available),
    roles: roles.map(({ endpoint: _endpoint, timeout: _timeout, ...role }) => role) };
}

module.exports = { qualityPlan };
