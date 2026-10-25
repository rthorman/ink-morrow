'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { keys, text, fail, normalizeCast } = require('./model');
const { templateSeed } = require('./library-model');
const canonical = (value) =>
  JSON.stringify(value, (key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((name) => [name, item[name]])
        )
      : item
  );
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('Invalid draft identity.');
  return value;
};
function createOwnerDrafts(db) {
  function scope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Choose a typed draft scope.');
    if (value.type === 'setup') {
      keys(value, ['type', 'id'], 'Setup draft');
      identifier(value.id);
    } else if (value.type === 'catalogue') {
      keys(value, ['type', 'kind', 'id', 'resource_id'], 'Catalogue draft');
      identifier(value.id);
      if (!['world', 'character', 'scribe'].includes(value.kind)) fail('Invalid catalogue draft kind.');
      if (
        value.resource_id !== undefined &&
        !db
          .prepare('SELECT id FROM fiction_templates WHERE id=? AND kind=? AND deleted=0')
          .get(identifier(value.resource_id), value.kind)
      )
        fail('Draft reference not found.', 'DRAFT_RESOURCE_MISSING', 404);
    } else if (value.type === 'contribution') {
      keys(value, ['type', 'game_id', 'branch_id', 'head_id', 'kind'], 'Contribution draft');
      identifier(value.game_id);
      identifier(value.branch_id);
      if (value.head_id !== null) identifier(value.head_id);
      if (!['follow', 'steer', 'ask', 'act', 'say'].includes(value.kind)) fail('Invalid contribution kind.');
      if (!db.prepare('SELECT id FROM fiction_branches WHERE game_id=? AND id=?').get(value.game_id, value.branch_id))
        fail('Draft path not found.', 'DRAFT_RESOURCE_MISSING', 404);
      if (
        value.head_id !== null &&
        !db
          .prepare(
            'WITH RECURSIVE path(id,parent_id) AS (SELECT b.id,b.parent_id FROM fiction_beats b JOIN fiction_branches p ON p.head_beat_id=b.id WHERE p.game_id=? AND p.id=? UNION ALL SELECT b.id,b.parent_id FROM fiction_beats b JOIN path ON b.id=path.parent_id) SELECT id FROM path WHERE id=?'
          )
          .get(value.game_id, value.branch_id, value.head_id)
      )
        fail('Draft moment not found.', 'DRAFT_RESOURCE_MISSING', 404);
    } else fail('Unsupported private draft scope.');
    return value;
  }
  function content(value, target) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Draft content must be an object.');
    if (Buffer.byteLength(canonical(value)) > 240 * 1024)
      fail('This private draft exceeds 240 KiB.', 'DRAFT_TOO_LARGE', 413);
    if (target.type === 'contribution') {
      keys(value, ['text', 'direction_scope'], 'Contribution content');
      text(value.text, 'Draft direction', 4000, { optional: true });
      if (value.direction_scope !== undefined && !['moment', 'ongoing'].includes(value.direction_scope))
        fail('Invalid direction scope.');
    } else if (target.type === 'catalogue') {
      keys(value, ['form', 'candidate', 'seed', 'length', 'base_revision'], 'Catalogue content');
      for (const name of ['form', 'candidate', 'seed'])
        if (value[name] !== undefined && value[name] !== null) templateSeed(target.kind, value[name]);
      if (value.length !== undefined && !['short', 'medium', 'long'].includes(value.length))
        fail('Invalid development depth.');
      if (value.base_revision !== undefined && (!Number.isSafeInteger(value.base_revision) || value.base_revision < 0))
        fail('Invalid reference base.');
    } else {
      keys(
        value,
        [
          'title',
          'premise',
          'genre',
          'play_style',
          'fourth_wall',
          'cast',
          'pacing',
          'consequences',
          'boundaries',
          'voice',
          'scenario_id',
          'library'
        ],
        'Setup content'
      );
      for (const [name, max] of [
        ['title', 200],
        ['premise', 4000],
        ['boundaries', 2000],
        ['voice', 1500],
        ['scenario_id', 80]
      ])
        if (value[name] !== undefined && value[name] !== null) text(value[name], name, max, { optional: true });
      if (value.cast !== undefined) {
        if (!Array.isArray(value.cast) || value.cast.length > 24) fail('Invalid setup cast.');
        // Unsaved rows may have blank names, but retain the published field bounds.
        normalizeCast(value.cast.map((person) => ({ ...person, name: person.name || 'Unnamed' })));
      }
      for (const [name, values] of Object.entries({
        genre: ['drama', 'mystery', 'exploration', 'cozy'],
        play_style: ['story-shaping', 'living-world'],
        fourth_wall: ['never', 'rarely', 'freely'],
        pacing: ['reflective', 'balanced', 'brisk'],
        consequences: ['gentle', 'dramatic']
      }))
        if (value[name] !== undefined && !values.includes(value[name])) fail(`Invalid setup ${name}.`);
      if (value.library !== undefined) {
        keys(value.library, ['world_id', 'scribe_id', 'character_ids'], 'Setup selections');
        for (const name of ['world_id', 'scribe_id']) if (value.library[name]) identifier(value.library[name]);
        if (
          value.library.character_ids !== undefined &&
          (!Array.isArray(value.library.character_ids) || value.library.character_ids.length > 24)
        )
          fail('Invalid selected cast.');
        (value.library.character_ids || []).forEach(identifier);
      }
    }
    return value;
  }
  const expose = (row) => ({
    id: row.id,
    scope: JSON.parse(row.scope_json),
    revision: row.revision,
    content: JSON.parse(row.content_json),
    submitted: row.submitted_json ? JSON.parse(row.submitted_json) : null,
    expires_at: row.expires_at
  });
  const find = (id) =>
    db
      .prepare("SELECT * FROM fiction_owner_drafts WHERE id=? AND deleted=0 AND expires_at>datetime('now')")
      .get(identifier(id)) || fail('This private draft is unavailable or expired.', 'DRAFT_NOT_FOUND', 404);
  function create(input) {
    keys(input, ['id', 'scope', 'content'], 'New private draft');
    const id = identifier(input.id || randomUUID());
    const target = scope(input.scope);
    const value = content(input.content, target);
    db.prepare(
      "UPDATE fiction_owner_drafts SET deleted=1,content_json='{}',submitted_json=NULL WHERE deleted=0 AND expires_at<=datetime('now')"
    ).run();
    const prior = db
      .prepare('SELECT * FROM fiction_owner_drafts WHERE id=? OR (scope_key=? AND deleted=0)')
      .get(id, digest(target));
    if (prior) {
      if (prior.id !== id || prior.scope_json !== canonical(target))
        fail('This draft identity belongs to another scope.', 'DRAFT_CONFLICT', 409);
      return expose(find(id)); // Replay never overwrites a newer acknowledged revision.
    }
    if (
      db.prepare("SELECT count(*) AS n FROM fiction_owner_drafts WHERE deleted=0 AND expires_at>datetime('now')").get()
        .n >= 1000
    )
      fail('Keep at most 1,000 active private drafts.', 'DRAFT_LIMIT', 413);
    db.prepare(
      "INSERT INTO fiction_owner_drafts(id,scope_key,scope_json,content_json,revision,expires_at) VALUES(?,?,?,?,1,datetime('now','+30 days'))"
    ).run(id, digest(target), canonical(target), canonical(value));
    return expose(find(id));
  }
  function patch(id, input) {
    keys(input, ['expected_revision', 'content', 'submitted', 'clear_submission'], 'Private draft update');
    const prior = find(id);
    if (prior.revision !== input.expected_revision)
      fail('This draft changed in another tab. Compare the saved and local versions.', 'DRAFT_CONFLICT', 409);
    const target = JSON.parse(prior.scope_json);
    const value = input.content === undefined ? JSON.parse(prior.content_json) : content(input.content, target);
    let submitted = prior.submitted_json;
    if (input.clear_submission === true) submitted = null;
    if (input.submitted !== undefined) {
      if (prior.submitted_json)
        fail('Review the previous submitted action before preparing another.', 'DRAFT_SUBMISSION_PENDING', 409);
      keys(input.submitted, ['action_key', 'target'], 'Submitted draft identity');
      const actionKey = text(input.submitted.action_key, 'Action key', 200);
      const destination = input.submitted.target;
      keys(destination, ['game_id', 'branch_id', 'head_beat_id', 'revision', 'purpose'], 'Submitted destination');
      if (target.type === 'contribution') {
        if (
          destination.game_id !== target.game_id ||
          destination.branch_id !== target.branch_id ||
          destination.head_beat_id !== target.head_id ||
          !Number.isSafeInteger(destination.revision)
        )
          fail('The submitted destination does not match this draft.', 'DRAFT_TARGET_CHANGED', 409);
      } else if (!['catalogue-development', 'story-creation', 'catalogue-save'].includes(destination.purpose))
        fail('Invalid submitted draft purpose.');
      submitted = canonical({
        action_key: actionKey,
        target: destination,
        content_revision: prior.revision,
        content: value
      });
    }
    const result = db
      .prepare(
        "UPDATE fiction_owner_drafts SET content_json=?,submitted_json=?,revision=revision+1,expires_at=datetime('now','+30 days'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND deleted=0"
      )
      .run(canonical(value), submitted, id, input.expected_revision);
    if (!result.changes) fail('This draft changed.', 'DRAFT_CONFLICT', 409);
    return expose(find(id));
  }
  function remove(id, expected) {
    const row = find(id);
    if (row.revision !== expected) fail('This draft changed before discard.', 'DRAFT_CONFLICT', 409);
    db.prepare(
      "UPDATE fiction_owner_drafts SET deleted=1,revision=revision+1,content_json='{}',submitted_json=NULL WHERE id=? AND revision=?"
    ).run(id, expected);
    return { removed: true };
  }
  function list(query = {}) {
    const rows = db
      .prepare(
        "SELECT id,scope_json,revision,expires_at FROM fiction_owner_drafts WHERE deleted=0 AND expires_at>datetime('now') ORDER BY updated_at DESC,rowid DESC LIMIT 1000"
      )
      .all();
    return rows
      .filter((row) => {
        const s = JSON.parse(row.scope_json);
        return (
          (!query.type || s.type === query.type) &&
          (!query.game_id || s.game_id === query.game_id) &&
          (!query.resource_id || s.resource_id === query.resource_id)
        );
      })
      .slice(0, 80)
      .map((row) => ({
        id: row.id,
        scope: JSON.parse(row.scope_json),
        revision: row.revision,
        expires_at: row.expires_at
      }));
  }
  function prepareCreation(kind, action, payload) {
    keys(action, ['draft_id', 'draft_revision', 'action_key'], 'Creation identity');
    const key = text(action.action_key, 'Action key', 200);
    const fingerprint = digest({ kind, payload, draft_id: action.draft_id, draft_revision: action.draft_revision });
    const receipt = db.prepare('SELECT * FROM fiction_local_receipts WHERE action_key=?').get(key);
    if (receipt) {
      if (receipt.kind !== kind || receipt.fingerprint !== fingerprint)
        fail('This action key belongs to different content.', 'IDEMPOTENCY_CONFLICT', 409);
      return { replayed: true, result_id: receipt.result_id };
    }
    const draft = find(action.draft_id);
    const stored = JSON.parse(draft.content_json);
    const target = JSON.parse(draft.scope_json);
    if (
      (kind === 'story' && digest(stored) !== digest(payload)) ||
      (kind === 'catalogue' &&
        (target.kind !== payload.kind || !stored.form || digest(stored.form) !== digest(payload.entry)))
    )
      fail('Creation must consume the exact acknowledged draft content.', 'DRAFT_CONTENT_CHANGED', 409);
    if (
      draft.revision !== action.draft_revision ||
      JSON.parse(draft.scope_json).type !== (kind === 'story' ? 'setup' : 'catalogue')
    )
      fail('Review the current draft before creating this resource.', 'DRAFT_CONFLICT', 409);
    return {
      finish(resultId) {
        const changed = db
          .prepare(
            "UPDATE fiction_owner_drafts SET deleted=1,revision=revision+1,content_json='{}',submitted_json=NULL WHERE id=? AND revision=? AND deleted=0"
          )
          .run(draft.id, action.draft_revision);
        if (!changed.changes) fail('The setup draft changed.', 'DRAFT_CONFLICT', 409);
        db.prepare(
          'INSERT INTO fiction_local_receipts(action_key,kind,fingerprint,result_id,scope_key) VALUES(?,?,?,?,?)'
        ).run(key, kind, fingerprint, resultId, digest(target));
      }
    };
  }
  return {
    create,
    patch,
    remove,
    list,
    get: (id) => expose(find(id)),
    prepareCreation,
    lastCreation: (target) => {
      scope(target);
      const row = db
        .prepare(
          'SELECT action_key,kind,result_id FROM fiction_local_receipts WHERE scope_key=? AND acknowledged=0 ORDER BY rowid DESC LIMIT 1'
        )
        .get(digest(target));
      return row || null;
    },
    byScope: (target) => {
      scope(target);
      const row = db
        .prepare("SELECT id FROM fiction_owner_drafts WHERE scope_key=? AND deleted=0 AND expires_at>datetime('now')")
        .get(digest(target));
      return row ? expose(find(row.id)) : null;
    }
  };
}
module.exports = { createOwnerDrafts, canonical, digest };
