'use strict';

// The cast contract: stories.characters JSON entries {id, role, relation,
// state}. role is mc|supporting|background (zero or one MC - zero means an
// ensemble tale); relation is free text (a tie to the MC at the story's
// start, or a starting note for ensemble tales); state holds the per-story
// mutable instance of a character as the story reshapes them.

const { CAST_ROLES, optionalText, asString } = require('../../core/validation');

const STATE_MARKER = '<<<CHARACTER_STATE>>>';
const STATE_FIELDS = ['personality', 'appearance', 'relationship_to_mc'];

function normalizeCastEntry(entry) {
  if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim()) {
    const role = entry.role === undefined || entry.role === null ? 'supporting' : asString(entry.role);
    if (!role || !CAST_ROLES.includes(role)) {
      return { error: `"characters[].role" must be one of: ${CAST_ROLES.join(', ')}` };
    }
    const relation = entry.relation === undefined || entry.relation === null ? null : optionalText(entry.relation, { max: 2000 });
    if (relation === undefined) return { error: '"characters[].relation" must be text' };
    const state = entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state) ? entry.state : null;
    return { id: entry.id.trim(), role, relation, state };
  }
  return { error: '"characters" must contain {id, role} cast entries' };
}

function normalizeCast(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => {
      const n = normalizeCastEntry(e);
      return n.error ? null : n;
    })
    .filter(Boolean);
}

// Validates a cast payload: entries exist, roles are legal, at most one MC.
// `characterExists` is injected by the catalog store.
function validateCastPayload(value, characterExists) {
  if (!Array.isArray(value)) return { error: '"characters" must be an array of character ids' };
  const cast = [];
  for (const entry of value) {
    const normalized = normalizeCastEntry(entry);
    if (normalized.error) return { error: normalized.error };
    if (!characterExists(normalized.id)) return { error: `characters contains unknown id: ${normalized.id}` };
    cast.push(normalized);
  }
  if (cast.filter((c) => c.role === 'mc').length > 1) {
    return { error: 'A story can follow only one main character. Move the others to supporting or background.' };
  }
  return { cast };
}

function parseCastJson(json) {
  return normalizeCast(JSON.parse(json || '[]'));
}

// The model appends a state block after the prose. Split it off so pages
// never store the marker; a missing block simply means "nothing changed".
function splitStateBlock(content) {
  const idx = content.indexOf(STATE_MARKER);
  if (idx === -1) return { prose: content.trim(), stateJson: null };
  return {
    prose: content.slice(0, idx).trim(),
    stateJson: content.slice(idx + STATE_MARKER.length).trim() || null,
  };
}

// Applies a model-emitted state update to the story's cast JSON.
function applyStateUpdate(db, story, stateObj) {
  if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) return false;
  const cast = parseCastJson(story.characters);
  let changed = false;
  for (const entry of cast) {
    const upd = stateObj[entry.id];
    if (!upd || typeof upd !== 'object' || Array.isArray(upd)) continue;
    const state = entry.state && typeof entry.state === 'object' ? { ...entry.state } : {};
    for (const field of STATE_FIELDS) {
      const value = upd[field];
      if (typeof value === 'string' && value.trim()) {
        state[field] = value.trim().slice(0, 2000);
        changed = true;
      }
    }
    if (Object.keys(state).length > 0) entry.state = state;
  }
  if (changed) {
    db.prepare('UPDATE stories SET characters = ? WHERE id = ?').run(JSON.stringify(cast), story.id);
  }
  return changed;
}

module.exports = {
  STATE_MARKER,
  normalizeCast,
  normalizeCastEntry,
  validateCastPayload,
  parseCastJson,
  splitStateBlock,
  applyStateUpdate,
};
