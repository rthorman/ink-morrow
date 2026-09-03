'use strict';

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { modelOverrideOf, parseReasoningEffort, parseWordTarget } = require('../../core/validation');

function createPlayRouter({ stories, store, service, transactions = null }) {
  const router = express.Router();

  const idempotencyKey = (req) => {
    const value = req.get('Idempotency-Key') || req.body?.idempotency_key;
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;
  };
  const writerSessionId = (req) => {
    const value = req.get('X-InkMorrow-Writer-Session') || req.body?.writer_session_id;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
    const authenticated = req.authSession?.tokenHash;
    return typeof authenticated === 'string' && authenticated.trim()
      ? `compat:${authenticated.trim()}`.slice(0, 300)
      : 'legacy-client';
  };
  const acquireWriter = (req, storyId) => transactions?.acquireLease(storyId, writerSessionId(req));

  router.get('/api/stories/:id/scenes/:sceneId/play-sessions', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    if (!stories.scenes.get(story.id, req.params.sceneId)) return notFound(res, 'Scene not found');
    const sessions = store.listForScene(story.id, req.params.sceneId);
    res.json({ sessions, active: sessions.find((session) => session.status === 'active') || null });
  });

  router.post('/api/stories/:id/scenes/:sceneId/play-sessions', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const contract = store.validateContract(req.body || {}, story.id);
    if (contract.error) return badRequest(res, contract.error);
    const session = store.create(story.id, req.params.sceneId, contract);
    if (!session) return notFound(res, 'Scene not found');
    res.status(201).json({ session });
  });

  router.get('/api/stories/:id/play-sessions/:sessionId', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const session = store.get(story.id, req.params.sessionId, { turns: true });
    if (!session) return notFound(res, 'Play session not found');
    res.json({ session });
  });

  router.post('/api/stories/:id/play-sessions/:sessionId/branches', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      acquireWriter(req, req.params.id);
      const session = store.createBranch(req.params.id, req.params.sessionId, req.body?.fork_turn_id, req.body?.name);
      if (!session) return notFound(res, 'Play session not found');
      res.status(201).json({ session });
    } catch (error) { next(error); }
  });

  router.put('/api/stories/:id/play-sessions/:sessionId/branch', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      acquireWriter(req, req.params.id);
      const session = store.chooseBranch(req.params.id, req.params.sessionId, req.body?.branch_id);
      if (!session) return notFound(res, 'Play session not found');
      res.json({ session });
    } catch (error) { next(error); }
  });

  router.put('/api/stories/:id/play-sessions/:sessionId/branches/:branchId/successor', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      acquireWriter(req, req.params.id);
      const session = store.selectSuccessor(req.params.id, req.params.sessionId, req.params.branchId, req.body?.turn_id);
      if (!session) return notFound(res, 'Play session not found');
      res.json({ session });
    } catch (error) { next(error); }
  });

  router.put('/api/stories/:id/play-sessions/:sessionId/contract', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const existing = store.get(story.id, req.params.sessionId);
    if (!existing) return notFound(res, 'Play session not found');
    acquireWriter(req, story.id);
    const contract = store.validateContract(req.body || {}, story.id, existing);
    if (contract.error) return badRequest(res, contract.error);
    res.json({ session: store.updateContract(story.id, existing.id, contract) });
  });

  router.post('/api/stories/:id/play-sessions/:sessionId/turns', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const session = store.get(story.id, req.params.sessionId);
    if (!session) return notFound(res, 'Play session not found');
    const turn = store.validateTurn(req.body || {}, session);
    if (turn.error) return badRequest(res, turn.error);
    acquireWriter(req, story.id);
    const result = store.recordOwnerTurn(story.id, session.id, turn, idempotencyKey(req));
    res.status(result.reused ? 200 : 201).json(result);
  });

  router.post('/api/stories/:id/play-sessions/:sessionId/replies', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const session = store.get(story.id, req.params.sessionId);
      if (!session) return notFound(res, 'Play session not found');
      const turn = store.validateTurn(req.body || {}, session);
      if (turn.error) return badRequest(res, turn.error);
      const model = req.body.model === undefined ? null : modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !model) return badRequest(res, '"model" must be a non-empty model identifier');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort !== undefined && req.body.reasoning_effort !== null && !reasoningEffort) {
        return badRequest(res, '"reasoning_effort" is not supported');
      }
      acquireWriter(req, story.id);
      const result = await service.reply({
        storyId: story.id,
        sessionId: session.id,
        turn,
        idempotencyKey: idempotencyKey(req),
        model,
        reasoningEffort,
      });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/play-sessions/:sessionId/prepare-prose', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const model = req.body.model === undefined ? null : modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !model) return badRequest(res, '"model" must be a non-empty model identifier');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort !== undefined && req.body.reasoning_effort !== null && !reasoningEffort) return badRequest(res, '"reasoning_effort" is not supported');
      const key = idempotencyKey(req);
      if (!key) return badRequest(res, 'An Idempotency-Key is required for paid Play-to-Prose preparation.');
      const result = await service.prepareProse({
        storyId: story.id, sessionId: req.params.sessionId,
        idempotencyKey: key, writerSessionId: writerSessionId(req),
        model, reasoningEffort, words: parseWordTarget(req.body.words),
      });
      if (!result) return notFound(res, 'Play session not found');
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });

  router.post('/api/stories/:id/play-sessions/:sessionId/end', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const session = store.end(story.id, req.params.sessionId);
    if (!session) return notFound(res, 'Play session not found');
    res.json({ session });
  });

  return router;
}

module.exports = { createPlayRouter };
