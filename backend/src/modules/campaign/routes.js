'use strict';

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { modelOverrideOf, parseReasoningEffort } = require('../../core/validation');

function createCampaignRouter({ stories, campaign, service, transactions = null }) {
  const router = express.Router();
  const writerSessionId = (req) => {
    const value = req.get('X-InkMorrow-Writer-Session') || req.body?.writer_session_id;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
    const authenticated = req.authSession?.tokenHash;
    return authenticated ? `compat:${authenticated}`.slice(0, 300) : 'legacy-client';
  };
  const mutate = (req, storyId) => {
    transactions?.acquireLease(storyId, writerSessionId(req));
    stories.invalidatePreview(storyId);
  };
  const idempotencyKey = (req) => {
    const value = req.get('Idempotency-Key') || req.body?.idempotency_key;
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;
  };

  router.get('/api/stories/:id/campaign-state', (req, res) => {
    const state = campaign.list(req.params.id, { includeRetired: req.query.include_retired === 'true' });
    if (!state) return notFound(res, 'Story not found');
    res.json(state);
  });

  router.get('/api/stories/:id/scenes/:sceneId/recap', (req, res) => {
    const recap = campaign.recap(req.params.id, req.params.sceneId);
    if (!recap) return notFound(res, 'Story or scene not found');
    res.json({ recap });
  });

  router.post('/api/stories/:id/scenes/:sceneId/campaign-suggestions', async (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      const model = req.body?.model === undefined ? null : modelOverrideOf(req.body.model);
      if (req.body?.model !== undefined && !model) return badRequest(res, '"model" must be a non-empty model identifier');
      const reasoningEffort = parseReasoningEffort(req.body?.reasoning_effort);
      if (req.body?.reasoning_effort !== undefined && req.body.reasoning_effort !== null && !reasoningEffort) {
        return badRequest(res, '"reasoning_effort" is not supported');
      }
      transactions?.acquireLease(req.params.id, writerSessionId(req));
      const result = await service.suggest({
        storyId: req.params.id, sceneId: req.params.sceneId,
        idempotencyKey: idempotencyKey(req), model, reasoningEffort,
      });
      if (!result) return notFound(res, 'Story or scene not found');
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });

  router.post('/api/stories/:id/campaign-state', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      mutate(req, req.params.id);
      res.status(201).json({ entry: campaign.create(req.params.id, req.body || {}) });
    } catch (error) { next(error); }
  });

  router.put('/api/stories/:id/campaign-state/:entryId', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      mutate(req, req.params.id);
      const entry = campaign.revise(req.params.id, req.params.entryId, req.body || {});
      if (!entry) return notFound(res, 'Campaign entry not found');
      res.json({ entry });
    } catch (error) { next(error); }
  });

  router.delete('/api/stories/:id/campaign-state/:entryId', (req, res, next) => {
    try {
      if (!stories.getStory(req.params.id)) return notFound(res, 'Story not found');
      mutate(req, req.params.id);
      if (!campaign.retire(req.params.id, req.params.entryId)) return notFound(res, 'Campaign entry not found');
      res.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createCampaignRouter };
