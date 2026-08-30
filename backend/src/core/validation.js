'use strict';

// Bounded validation helpers shared by every feature router. All user text
// is trimmed, length-capped, and never interpolated into SQL.

const TONES = ['fade-to-black', 'romantic', 'explicit'];
const CAST_ROLES = ['mc', 'supporting', 'background'];
// OpenRouter's complete effort vocabulary. Individual model catalog entries
// expose their own supported subset; this is the transport-level allow-list.
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function asString(value) {
  return typeof value === 'string' ? value.trim() : null;
}

function optionalText(value, { max = 10000 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined; // wrong type
  const s = value.trim();
  if (s.length > max) return undefined;
  return s || null;
}

// Model ids from clients are bounded and forwarded verbatim to OpenRouter.
function modelOverrideOf(value) {
  const model = asString(value);
  return model && model.length <= 200 ? model : null;
}

function parseReasoningEffort(value) {
  if (value === undefined || value === null || value === '') return null;
  const effort = asString(value);
  return REASONING_EFFORTS.includes(effort) ? effort : null;
}

// Approximate page length requested by the client (50-2000 words).
function parseWordTarget(value) {
  if (value === undefined || value === null) return null;
  const words = parseInt(value, 10);
  if (!Number.isFinite(words)) return null;
  return Math.min(Math.max(words, 50), 2000);
}

module.exports = {
  TONES,
  CAST_ROLES,
  REASONING_EFFORTS,
  asString,
  optionalText,
  modelOverrideOf,
  parseReasoningEffort,
  parseWordTarget,
};
