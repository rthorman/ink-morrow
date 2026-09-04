'use strict';

const express = require('express');
const { fail, keys, text } = require('./model');
const { parseReasoningEffort } = require('../../core/validation');

function createFictionRouter({ store, service }) {
  const router = express.Router();
  const revision = (req) => req.body?.expected_revision;
  router.get('/api/fiction', (req, res) => res.json({ stories: store.list() }));
  router.post('/api/fiction', (req, res) => res.status(201).json({ story: store.create(req.body) }));
  router.get('/api/fiction/:id', (req, res) => res.json({ story: store.view(req.params.id, { before: req.query.before || null, limit: req.query.limit ? Number(req.query.limit) : 60 }) }));
  router.post('/api/fiction/:id/branches', (req, res) => {
    keys(req.body, ['expected_revision', 'name', 'beat_id'], 'Alternate path');
    res.status(201).json({ story: store.fork(req.params.id, revision(req), { name: req.body.name, beat_id: req.body.beat_id }) });
  });
  router.put('/api/fiction/:id/branch', (req, res) => {
    keys(req.body, ['expected_revision', 'branch_id'], 'Select path');
    res.json({ story: store.selectBranch(req.params.id, revision(req), text(req.body.branch_id, 'Path ID', 80)) });
  });
  router.put('/api/fiction/:id/control', (req, res) => {
    keys(req.body, ['expected_revision', 'character_id'], 'Character control');
    res.json({ story: store.control(req.params.id, revision(req), req.body.character_id) });
  });
  router.post('/api/fiction/:id/corrections', (req, res) => {
    keys(req.body, ['expected_revision', 'fact', 'remove_id', 'reason'], 'Correction');
    res.status(201).json({ story: store.correct(req.params.id, revision(req), { fact: req.body.fact, remove_id: req.body.remove_id, reason: req.body.reason }) });
  });
  router.post('/api/fiction/:id/episodes', (req, res) => {
    keys(req.body, ['expected_revision', 'action', 'title', 'summary'], 'Episode');
    res.status(201).json({ story: store.episode(req.params.id, revision(req), { action: req.body.action, title: req.body.title, summary: req.body.summary }) });
  });
  router.post('/api/fiction/:id/replies', async (req, res, next) => {
    try {
      keys(req.body, ['expected_revision', 'idempotency_key', 'input', 'model', 'reasoning_effort'], 'Continue story');
      const model = req.body.model === undefined ? undefined : text(req.body.model, 'Model', 300);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort != null && !reasoningEffort) fail('The reasoning effort is not supported.');
      const result = await service.reply({ gameId: req.params.id, expectedRevision: revision(req), idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key, input: req.body.input, model, reasoningEffort });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createFictionRouter };
