'use strict';
const { keys, fail } = require('./model');
const { identifier } = require('./creative-model');
const { layout } = require('./editorial-model');
const { canonical } = require('./drafts');
function validateEditorialSave(value) {
  if (
    !Array.isArray(value.beats) ||
    value.beats.length > 10000 ||
    !value.game?.initial_state ||
    !value.beats.every(
      (beat) =>
        beat &&
        typeof beat === 'object' &&
        beat.state &&
        beat.input &&
        Array.isArray(beat.changes),
    )
  )
    fail('Invalid editorial save structure.', 'INVALID_SAVE');
  if (
    value.creative &&
    (!Array.isArray(value.creative.configurations) ||
      !Array.isArray(value.creative.references))
  )
    fail('Invalid creative collections.', 'INVALID_SAVE');
  keys(value.editorial, ['version', 'revisions'], 'Editorial collections');
  const rows = value.editorial.revisions;
  if (
    value.editorial.version !== 1 ||
    !Array.isArray(rows) ||
    rows.length > 10000 ||
    rows.length +
      (value.creative?.configurations.length || 0) +
      (value.creative?.references.length || 0) >
      Math.min(10000, value.beats.length)
  )
    fail('Invalid editorial collection count.', 'INVALID_SAVE');
  const beats = new Map(value.beats.map((beat) => [beat.id, beat])),
    children = new Map();
  for (const beat of beats.values()) {
    if (!children.has(beat.parent_id)) children.set(beat.parent_id, []);
    children.get(beat.parent_id).push(beat.id);
  }
  const starts = new Map(),
    ends = new Map(),
    depths = new Map();
  let time = 0;
  const stack = (children.get(null) || []).map((id) => ({
    id,
    depth: 0,
    done: false,
  }));
  while (stack.length) {
    const { id, depth, done } = stack.pop();
    if (done) {
      ends.set(id, time++);
      continue;
    }
    if (starts.has(id)) fail('Editorial ancestry is cyclic.', 'INVALID_SAVE');
    starts.set(id, time++);
    depths.set(id, depth);
    stack.push({ id, depth, done: true });
    for (const child of children.get(id) || [])
      stack.push({ id: child, depth: depth + 1, done: false });
  }
  if (starts.size !== beats.size)
    fail('Editorial ancestry is incomplete.', 'INVALID_SAVE');
  const ancestor = (head, id) =>
    id !== null &&
    starts.has(id) &&
    starts.has(head) &&
    starts.get(id) <= starts.get(head) &&
    ends.get(id) >= ends.get(head);
  const revisions = new Map(),
    produced = new Map();
  const creativeIds = new Set(
    [
      ...(value.creative?.configurations || []),
      ...(value.creative?.references || []),
    ].map((row) => row.id),
  );
  const creativeProducers = new Set(
    [
      ...(value.creative?.configurations || []),
      ...(value.creative?.references || []),
    ].map((row) => row.beat_id),
  );
  for (const row of rows) {
    keys(row, ['id', 'parent_id', 'beat_id', 'value'], 'Editorial revision');
    if (
      ['id', 'parent_id', 'beat_id', 'value'].some(
        (key) => !Object.hasOwn(row, key),
      )
    )
      fail('Incomplete editorial revision.', 'INVALID_SAVE');
    identifier(row.id);
    const beat = beats.get(row.beat_id);
    if (
      creativeIds.has(row.id) ||
      revisions.has(row.id) ||
      produced.has(row.beat_id) ||
      creativeProducers.has(row.beat_id) ||
      !beat ||
      beat.kind !== 'correction' ||
      beat.input.operation !== 'editorial' ||
      beat.changes.length ||
      beat.prose ||
      beat.state.version !== 2
    )
      fail('Invalid editorial producing record.', 'INVALID_SAVE');
    const normalized = layout(row.value, (id) => {
      const anchor = beats.get(id);
      if (
        !anchor ||
        !['opening', 'scene'].includes(anchor.kind) ||
        !ancestor(beat.parent_id, id)
      )
        fail(
          'An editorial anchor is foreign, future or non-narrative.',
          'INVALID_SAVE',
        );
      return depths.get(id);
    });
    if (canonical(normalized) !== canonical(row.value))
      fail('Noncanonical editorial layout.', 'INVALID_SAVE');
    revisions.set(row.id, row);
    produced.set(row.beat_id, row);
  }
  const used = new Set();
  if (
    value.game.initial_state.editorial_revision_id !== undefined &&
    value.game.initial_state.editorial_revision_id !== null
  )
    fail('Initial layout has no producing record.', 'INVALID_SAVE');
  for (const beat of beats.values()) {
    const prior =
      beat.parent_id === null
        ? value.game.initial_state
        : beats.get(beat.parent_id)?.state;
    const own = produced.get(beat.id);
    const selected = beat.state.editorial_revision_id ?? null;
    if (
      !prior ||
      selected !== (own?.id || prior.editorial_revision_id || null) ||
      (beat.input.operation === 'editorial' && !own) ||
      (beat.state.version !== 2 &&
        beat.state.editorial_revision_id !== undefined)
    )
      fail(
        'Editorial layout changed without a producing revision.',
        'INVALID_SAVE',
      );
    if (own) {
      const parent =
        own.parent_id === null ? null : revisions.get(own.parent_id);
      if (
        own.parent_id !== (prior.editorial_revision_id || null) ||
        (own.parent_id !== null &&
          (!parent || !ancestor(beat.parent_id, parent.beat_id)))
      )
        fail('Invalid editorial parent or branch.', 'INVALID_SAVE');
    }
    if (selected !== null) {
      const row = revisions.get(selected);
      if (!row || !ancestor(beat.id, row.beat_id))
        fail('Editorial head is outside this history.', 'INVALID_SAVE');
      let at = row;
      while (at && !used.has(at.id)) {
        used.add(at.id);
        at = revisions.get(at.parent_id);
      }
    }
  }
  if (used.size !== revisions.size)
    fail('Unreachable editorial revisions.', 'INVALID_SAVE');
  const strip = (state) => {
    const next = { ...state };
    delete next.editorial_revision_id;
    return next;
  };
  const projected = {
    ...value,
    game: { ...value.game, initial_state: strip(value.game.initial_state) },
    beats: value.beats.map((beat) => {
      const input = { ...beat.input };
      if (produced.has(beat.id)) delete input.operation;
      return { ...beat, input, state: strip(beat.state) };
    }),
  };
  delete projected.editorial;
  return projected;
}
module.exports = { validateEditorialSave };
