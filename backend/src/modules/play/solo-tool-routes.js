'use strict';

const express = require('express');
const { notFound } = require('../../core/http');

function createSoloToolRouter({ stories, store, transactions = null }) {
  const router = express.Router();
  const writerSessionId = (req) => {
    const value = req.get('X-InkMorrow-Writer-Session') || req.body?.writer_session_id;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
    const authenticated = req.authSession?.tokenHash;
    return typeof authenticated === 'string' && authenticated.trim()
      ? `compat:${authenticated.trim()}`.slice(0, 300)
      : 'legacy-client';
  };
  const lease = (req, storyId) => transactions?.acquireLease(storyId, writerSessionId(req));

  router.get('/api/stories/:id/solo-tools', (req, res) => {
    const tools = store.list(req.params.id, { includeArchived: req.query.archived === '1' });
    if (!tools) return notFound(res, 'Story not found');
    res.json({ tools, kinds: store.KINDS });
  });
  router.post('/api/stories/:id/solo-tools', (req, res, next) => {
    try { lease(req, req.params.id); const tool = store.create(req.params.id, req.body || {}); if (!tool) return notFound(res, 'Story not found'); res.status(201).json({ tool }); }
    catch (error) { next(error); }
  });
  router.put('/api/stories/:id/solo-tools/:toolId', (req, res, next) => {
    try { lease(req, req.params.id); const tool = store.update(req.params.id, req.params.toolId, req.body || {}); if (!tool) return notFound(res, 'Solo tool not found'); res.json({ tool }); }
    catch (error) { next(error); }
  });
  router.delete('/api/stories/:id/solo-tools/:toolId', (req, res, next) => {
    try { lease(req, req.params.id); if (!store.archive(req.params.id, req.params.toolId)) return notFound(res, 'Solo tool not found'); res.status(204).end(); }
    catch (error) { next(error); }
  });
  router.get('/api/stories/:id/scenes/:sceneId/tool-results', (req, res) => {
    const records = store.listForScene(req.params.id, req.params.sceneId);
    if (!records) return notFound(res, 'Scene not found');
    res.json({ records });
  });
  router.get('/api/stories/:id/play-sessions/:sessionId/tool-results', (req, res) => {
    const records = store.listForPath(req.params.id, req.params.sessionId);
    if (!records) return notFound(res, 'Play session not found');
    res.json({ records });
  });
  router.post('/api/stories/:id/play-sessions/:sessionId/tool-results', (req, res, next) => {
    try { lease(req, req.params.id); const result = store.run(req.params.id, req.params.sessionId, req.body?.tool_id, req.body?.input || {}); if (!result) return notFound(res, 'Play session not found'); res.status(201).json(result); }
    catch (error) { next(error); }
  });
  return router;
}

module.exports = { createSoloToolRouter };
