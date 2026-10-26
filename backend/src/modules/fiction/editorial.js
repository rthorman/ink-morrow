'use strict';
const express = require('express');
const { fail, keys, text } = require('./model');
const { canonical } = require('./drafts');
const { resolve } = require('./editorial-model');
function createEditorial({ db, store, queries, providers }) {
  const expose = require('./story-exposure').createStoryExposure(providers);
  function outline(game, head) {
    const rows = db
      .prepare(
        `WITH RECURSIVE path(id,parent_id,depth) AS (SELECT id,parent_id,0 FROM fiction_beats WHERE game_id=? AND id=? UNION ALL SELECT b.id,b.parent_id,p.depth+1 FROM fiction_beats b JOIN path p ON b.id=p.parent_id WHERE b.game_id=? AND p.depth<100000) SELECT b.id,substr(b.summary,1,160) AS summary,m.episode_number,m.episode_title FROM path p JOIN fiction_editorial_passages m ON m.beat_id=p.id JOIN fiction_beats b ON b.id=p.id ORDER BY p.depth DESC LIMIT 10001`,
      )
      .all(game, head, game);
    if (rows.length > 10000)
      fail(
        'Editorial organization supports up to 10,000 narrative passages.',
        'EDITORIAL_TOO_LARGE',
        413,
      );
    return rows;
  }
  const effective = store.editorialValue;
  function inspect(game, query = {}) {
    const ctx = queries.context(game, query);
    const rows = outline(game, ctx.head);
    const data = effective(game, ctx.state, rows, ctx.game.title);
    if (query.outline === '1') {
      const offset = Number(query.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000)
        fail('Invalid chapter page.');
      return {
        ...queries.metadata(ctx),
        virtual: data.virtual,
        revision_id: data.revision_id,
        volumes: data.layout.volumes,
        groups: data.groups.slice(offset, offset + 80),
        next_offset: offset + 80 < data.groups.length ? offset + 80 : null,
        passage_count: rows.length,
      };
    }
    if (
      data.layout.chapters.length > 512 ||
      Buffer.byteLength(canonical(data.layout)) > 65536
    )
      fail(
        'This automatic layout exceeds the editor’s 512-chapter / 64 KiB limit. Reading, the outline and book export remain available.',
        'EDITORIAL_TOO_LARGE',
        413,
      );
    return { ...queries.metadata(ctx), ...data, passage_count: rows.length };
  }

  function passages(game, query = {}) {
    const ctx = queries.context(game, query);
    const offset = Number(query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
      fail('Invalid passage page.');
    const search = text(query.q, 'Passage search', 200, {
      optional: true,
    }).toLowerCase();
    const rows = outline(game, ctx.head)
      .map((row, index) => ({ ...row, ordinal: index + 1 }))
      .filter(
        (row) =>
          !search ||
          `${row.summary} ${row.ordinal}`.toLowerCase().includes(search),
      );
    return {
      ...queries.metadata(ctx),
      passages: rows.slice(offset, offset + 80),
      next_offset: offset + 80 < rows.length ? offset + 80 : null,
    };
  }
  function apply(game, input) {
    return store.creativeRecords.command(
      game,
      input,
      'editorial',
      ['expected_editorial_id', 'layout'],
      (ctx, state, beatId, id) => {
        if (
          (state.editorial_revision_id || null) !== input.expected_editorial_id
        )
          fail(
            'The editorial layout changed. Compare the current version.',
            'EDITORIAL_CONFLICT',
            409,
          );
        const normalized = resolve(
          input.layout,
          outline(game, ctx.branch.head_beat_id),
        ).layout;
        db.prepare(
          'INSERT INTO fiction_editorial_revisions(id,game_id,parent_id,beat_id,value_json) VALUES(?,?,?,?,?)',
        ).run(
          id,
          game,
          state.editorial_revision_id || null,
          beatId,
          canonical(normalized),
        );
        state.editorial_revision_id = id;
        return {
          summary: 'Chapter and volume organization was revised.',
          result: { layout: normalized },
        };
      },
    );
  }
  const router = express.Router();
  router.post('/api/fiction/:id/editorial/preview', (req, res) => {
    keys(
      req.body,
      [
        'expected_revision',
        'target_branch_id',
        'expected_head_beat_id',
        'layout',
      ],
      'Editorial preview',
    );
    const ctx = store.current(req.params.id);
    if (
      ctx.game.revision !== req.body.expected_revision ||
      ctx.branch.id !== req.body.target_branch_id ||
      ctx.branch.head_beat_id !== req.body.expected_head_beat_id
    )
      fail(
        'The preview destination changed. Review the latest layout.',
        'STORY_TARGET_CHANGED',
        409,
      );
    res
      .set('Cache-Control', 'private, no-store')
      .json(
        resolve(
          req.body.layout,
          outline(req.params.id, ctx.branch.head_beat_id),
        ),
      );
  });
  router.get('/api/fiction/:id/editorial', (req, res) =>
    res
      .set('Cache-Control', 'private, no-store')
      .json(inspect(req.params.id, req.query)),
  );
  router.get('/api/fiction/:id/editorial/passages', (req, res) =>
    res
      .set('Cache-Control', 'private, no-store')
      .json(passages(req.params.id, req.query)),
  );
  router.post('/api/fiction/:id/commands/editorial', (req, res) => {
    keys(
      req.body,
      [
        'action_key',
        'expected_revision',
        'target_branch_id',
        'expected_head_beat_id',
        'expected_editorial_id',
        'layout',
      ],
      'Editorial command',
    );
    const result = apply(req.params.id, req.body);
    res.json({ ...result, story: expose(result.story) });
  });
  return { outline, effective, inspect, passages, apply, router };
}
module.exports = { createEditorial };
