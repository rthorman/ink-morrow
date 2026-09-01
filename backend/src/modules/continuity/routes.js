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

  // Rebuilds only local projections/checkpoints from already validated
  // revision deltas. It never calls a provider or changes manuscript prose.
  router.post('/api/stories/:id/continuity/rebuild', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const rebuilt = store.rebuild(story.id);
      res.json({ rebuilt, continuity: continuity.view(story) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/continuity/templates', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      res.json({ templates: store.templateReview(story) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/continuity/templates/:kind/:sourceId/import', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const fields = req.body?.fields;
      const snapshot = store.importTemplateFields(story, req.params.kind, req.params.sourceId, fields);
      stories.invalidatePreview(story.id);
      res.status(201).json({ snapshot, continuity: continuity.view(stories.getStory(story.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/stories/:id/continuity/templates/:kind/:sourceId', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const snapshot = store.updateTemplateFields(
        story, req.params.kind, req.params.sourceId, req.body?.values
      );
      stories.invalidatePreview(story.id);
      res.json({ snapshot, continuity: continuity.view(stories.getStory(story.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/continuity/author-canon', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const entry = store.createAuthorCanon(story, req.body);
      stories.invalidatePreview(story.id);
      res.status(201).json({ entry, continuity: continuity.view(stories.getStory(story.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/stories/:id/continuity/author-canon/:entryId', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const entry = store.reviseAuthorCanon(story, req.params.entryId, req.body);
      if (!entry) return notFound(res, 'Author canon entry not found');
      stories.invalidatePreview(story.id);
      res.json({ entry, continuity: continuity.view(stories.getStory(story.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/stories/:id/continuity/author-canon/:entryId', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      if (!store.retireAuthorCanon(story.id, req.params.entryId)) {
        return notFound(res, 'Author canon entry not found');
      }
      stories.invalidatePreview(story.id);
      res.json({ continuity: continuity.view(stories.getStory(story.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/continuity/corrections', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const result = store.createCorrection(story, req.body);
      stories.invalidatePreview(story.id);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/api/stories/:id/continuity/issues/:issueId', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const issue = store.setIssueStatus(story.id, req.params.issueId, req.body?.status);
      if (!issue) return notFound(res, 'Continuity issue not found');
      res.json({ issue });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/continuity/issues/summary', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const model = modelOverrideOf(req.body?.model);
      if (req.body?.model !== undefined && !model) return badRequest(res, '"model" must be a non-empty string');
      res.json(await continuity.summarizeImpact(story, req.body?.issue_ids, { model }));
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
