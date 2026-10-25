'use strict';
const { createHash } = require('node:crypto');
const { fail, keys } = require('./model');
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
function sourceValue(beat, row) {
  if (row.source_field === 'prose' && row.source_kind === 'narration') return beat.prose;
  if (row.source_field === 'input.text' && row.source_kind === 'submitted_input') return beat.input.text || '';
  if (row.source_field === 'changes.fact.text' && row.source_kind === 'owner_assertion' && beat.kind === 'correction')
    return beat.changes[row.change_index]?.fact?.text || '';
  fail('Unsupported evidence source.', 'INVALID_EVIDENCE');
}
function validateEvidence(row, beat, gameId) {
  keys(
    row,
    ['beat_id', 'change_index', 'source_kind', 'source_beat_id', 'source_field', 'quote', 'sha256', 'visibility'],
    'Effect evidence'
  );
  if (
    row.beat_id !== beat.id ||
    row.source_beat_id !== beat.id ||
    !Number.isInteger(row.change_index) ||
    row.change_index < 0 ||
    row.change_index >= beat.changes.length
  )
    fail('Evidence must cite its own accepted change.', 'INVALID_EVIDENCE');
  const source = sourceValue(beat, row);
  if (
    typeof row.quote !== 'string' ||
    !row.quote.length ||
    row.quote.length > 1000 ||
    !source.includes(row.quote) ||
    row.sha256 !== sha(source)
  )
    fail('Evidence quotation or source hash is invalid.', 'INVALID_EVIDENCE');
  const change = beat.changes[row.change_index];
  const expectedVisibility =
    row.source_kind === 'narration' && (change.op === 'introduce' || change.fact?.visibility === 'public')
      ? 'public'
      : 'owner';
  if (row.visibility !== expectedVisibility) fail('Evidence has an invalid exposure.', 'INVALID_EVIDENCE');
  return { game_id: gameId, ...row };
}
function createEvidence(db) {
  function write(gameId, beat, supplied = []) {
    let rows = supplied;
    if (!rows.length && beat.kind === 'correction')
      rows = beat.changes.flatMap((change, index) =>
        change.fact
          ? [
              {
                change_index: index,
                source_kind: 'owner_assertion',
                source_field: 'changes.fact.text',
                quote: change.fact.text.slice(0, 1000)
              }
            ]
          : []
      );
    for (const draft of rows) {
      const row = { beat_id: beat.id, source_beat_id: beat.id, ...draft };
      row.sha256 = sha(sourceValue(beat, row));
      const change = beat.changes[row.change_index];
      row.visibility =
        row.source_kind === 'narration' && (change?.op === 'introduce' || change?.fact?.visibility === 'public')
          ? 'public'
          : 'owner';
      validateEvidence(row, beat, gameId);
      db.prepare(
        'INSERT INTO fiction_effect_evidence(game_id,beat_id,change_index,source_kind,source_beat_id,source_field,quote,sha256,visibility) VALUES(?,?,?,?,?,?,?,?,?)'
      ).run(
        gameId,
        row.beat_id,
        row.change_index,
        row.source_kind,
        row.source_beat_id,
        row.source_field,
        row.quote,
        row.sha256,
        row.visibility
      );
    }
  }
  const rows = (gameId, beatId, planning = false) =>
    db
      .prepare(
        `SELECT beat_id,change_index,source_kind,source_beat_id,source_field,quote,sha256,visibility FROM fiction_effect_evidence WHERE game_id=? AND beat_id=? ${planning ? '' : "AND visibility='public'"} ORDER BY change_index`
      )
      .all(gameId, beatId);
  return { write, rows };
}
module.exports = { createEvidence, validateEvidence, sourceValue, sha };
