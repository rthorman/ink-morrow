'use strict';

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { modelOverrideOf } = require('../../core/validation');

function createContinuityRouter({ stories, store, continuity }) {
  const router = express.Router();

  router.get('/api/stories/:id/continuity', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ continuity: continuity.view(story) });
  });

  router.post('/api/stories/:id/continuity/pages/:pageId/sync', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageById(req.params.pageId);
      if (!page || page.story_id !== story.id) return notFound(res, 'Page not found');
      const body = req.body || {};
      const model = modelOverrideOf(body.model);
      if (body.model !== undefined && !model) return badRequest(res, '"model" must be a non-empty string');
      const result = await continuity.syncPage(story, page, { model, force: body.force === true });
      // A sequential rebuild may contain hundreds of calls. Returning the
      // full folded inspector each time turns that flow into needless O(n²)
      // JSON and DOM-adjacent work; the client fetches one final view instead.
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Clears only derived records. Manuscript pages, cast snapshots, explicit
  // corrections, and the honest historical cost ledger remain untouched.
  router.delete('/api/stories/:id/continuity', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    store.clear(story.id);
    stories.invalidatePreview(story.id);
    res.status(204).end();
  });

  router.put('/api/stories/:id/continuity/overrides', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return badRequest(res, 'Continuity corrections must be an object');
    }
    const overrides = store.saveOverrides(story, req.body);
    stories.invalidatePreview(story.id);
    res.json({ overrides, continuity: continuity.view(stories.getStory(story.id)) });
  });

  return router;
}

module.exports = { createContinuityRouter };
