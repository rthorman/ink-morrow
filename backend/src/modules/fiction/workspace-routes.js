'use strict';
const express = require('express');
const { keys, text, fail } = require('./model');
function createWorkspaceRouter({ db, store, queries, drafts }) {
  const router = express.Router();
  router.use('/api/fiction', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.get('/api/fiction/drafts', (req, res) => {
    if (req.query.scope) {
      let scope;
      try {
        scope = JSON.parse(req.query.scope);
      } catch {
        fail('Invalid draft scope.');
      }
      const row = drafts.byScope(scope);
      res.json({ draft: row, creation: drafts.lastCreation(scope) });
    } else res.json({ drafts: drafts.list(req.query) });
  });
  router.post('/api/fiction/drafts', (req, res) => res.status(201).json({ draft: drafts.create(req.body) }));
  router.get('/api/fiction/drafts/:draft', (req, res) => res.json({ draft: drafts.get(req.params.draft) }));
  router.patch('/api/fiction/drafts/:draft', (req, res) =>
    res.json({ draft: drafts.patch(req.params.draft, req.body) })
  );
  router.delete('/api/fiction/drafts/:draft', (req, res) => {
    keys(req.body, ['expected_revision'], 'Discard draft');
    res.json(drafts.remove(req.params.draft, req.body.expected_revision));
  });
  router.post('/api/fiction/local-actions/:key/ack', (req, res) => {
    db.prepare('UPDATE fiction_local_receipts SET acknowledged=1 WHERE action_key=?').run(
      text(req.params.key, 'Action key', 200)
    );
    res.json({ acknowledged: true });
  });
  function catalogueStatus(key) {
    const row = db
      .prepare('SELECT status,error_code,result_json FROM fiction_template_drafts WHERE idempotency_key=?')
      .get(key);
    if (row)
      return {
        status: row.status,
        error_code: row.error_code,
        can_start_new: row.status !== 'pending',
        ...(row.status === 'succeeded' ? { entry: JSON.parse(row.result_json) } : {})
      };
    if (db.prepare('SELECT 1 FROM fiction_catalogue_action_fences WHERE action_key=?').get(key))
      return { status: 'cancelled-before-dispatch', can_start_new: true };
    return { status: 'unknown', can_start_new: false };
  }
  router.get('/api/fiction/catalogue-actions/:key', (req, res) =>
    res.json(catalogueStatus(text(req.params.key, 'Action key', 200)))
  );
  router.post('/api/fiction/catalogue-actions/:key/cancel', (req, res) => {
    const key = text(req.params.key, 'Action key', 200);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (catalogueStatus(key).status === 'unknown')
        db.prepare('INSERT OR IGNORE INTO fiction_catalogue_action_fences(action_key) VALUES(?)').run(key);
      db.exec('COMMIT');
      res.json(catalogueStatus(key));
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  function actionStatus(gameId, key) {
    store.current(gameId);
    const request = db
      .prepare('SELECT id,status,beat_id,error_code FROM fiction_requests WHERE game_id=? AND idempotency_key=?')
      .get(gameId, key);
    if (request)
      return {
        status: request.status,
        beat_id: request.beat_id,
        error_code: request.error_code,
        can_start_new: request.status !== 'pending'
      };
    if (db.prepare('SELECT 1 FROM fiction_action_fences WHERE game_id=? AND action_key=?').get(gameId, key))
      return { status: 'cancelled-before-dispatch', can_start_new: true };
    return {
      status: 'unknown',
      can_start_new: false,
      explanation: 'No durable request is visible yet. This does not prove that a delayed submission cannot arrive.'
    };
  }
  router.get('/api/fiction/actions/:key', (req, res) =>
    res.json(actionStatus(text(req.query.game_id, 'Story ID', 80), text(req.params.key, 'Action key', 200)))
  );
  router.post('/api/fiction/actions/:key/cancel', (req, res) => {
    keys(req.body, ['game_id'], 'Cancel undispatched action');
    const id = text(req.body.game_id, 'Story ID', 80);
    const key = text(req.params.key, 'Action key', 200);
    db.exec('BEGIN IMMEDIATE');
    try {
      const status = actionStatus(id, key);
      if (status.status === 'unknown')
        db.prepare('INSERT OR IGNORE INTO fiction_action_fences(game_id,action_key) VALUES(?,?)').run(id, key);
      db.exec('COMMIT');
      res.json(actionStatus(id, key));
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  for (const [name, method] of [
    ['workspace', 'workspace'],
    ['timeline', 'timeline'],
    ['codex', 'codex'],
    ['planning', 'planning']
  ])
    router.get(`/api/fiction/:id/${name}`, (req, res) => res.json(queries[method](req.params.id, req.query)));
  router.get('/api/fiction/:id/passages/:beat', (req, res) =>
    res.json(queries.passages(req.params.id, req.params.beat, req.query))
  );
  router.get('/api/fiction/:id/evidence/:beat', (req, res) =>
    res.json(queries.evidence(req.params.id, req.params.beat, req.query))
  );
  return router;
}
module.exports = { createWorkspaceRouter };
