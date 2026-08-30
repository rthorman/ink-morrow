'use strict';

// Story, cast, and direct page CRUD + truncate routes. Paths and response
// shapes are unchanged from the monolith.

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText } = require('../../core/validation');

function createStoriesRouter({ store, imageStore, audio }) {
  const router = express.Router();

  router.get('/api/stories', (req, res) => {
    const { world_id } = req.query;
    res.json({ stories: store.listStories(world_id).map(store.storyWithMeta) });
  });

  router.get('/api/stories/:id', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ story: store.storyWithMeta(story) });
  });

  router.post('/api/stories', (req, res) => {
    const payload = store.validateStoryPayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    res.status(201).json({ story: store.storyWithMeta(store.createStory(payload)) });
  });

  router.put('/api/stories/:id', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const payload = store.validateStoryPayload(req.body, { partial: true, existing: story });
    if (payload.error) return badRequest(res, payload.error);
    res.json({ story: store.storyWithMeta(store.updateStory(story.id, payload)) });
  });

  router.delete('/api/stories/:id', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    // Stop any audiobook work for this tale before the row cascade kills it
    // (the runner's per-page updates are guarded by status = 'pending').
    audio.abandonStory(story.id);
    for (const page of store.storyPages(story.id)) {
      if (page.image_media_type) imageStore.deleteImage('page', page.id); // never leave orphans
    }
    store.deleteStoryCascade(story.id);
    store.invalidatePreview(story.id);
    res.status(204).end();
  });

  // -- direct page CRUD -------------------------------------------------------

  router.get('/api/stories/:id/pages', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ pages: store.storyPages(story.id) });
  });

  router.post('/api/stories/:id/pages', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const content = optionalText(req.body.content, { max: 50000 });
    if (content === null || content === undefined) return badRequest(res, '"content" is required');
    const user_input = optionalText(req.body.user_input, { max: 10000 });
    const page = store.insertManualPage(story.id, content, user_input);
    store.invalidatePreview(story.id);
    res.status(201).json({ page });
  });

  router.delete('/api/stories/:id/pages/:number', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const page = store.getPageByNumber(story.id, parseInt(req.params.number, 10));
    if (!page) return notFound(res, 'Page not found');
    store.deletePage(page);
    if (page.image_media_type) imageStore.deleteImage('page', page.id);
    store.invalidatePreview(story.id);
    res.status(204).end();
  });

  // Delete every page AFTER the given page number, making it the last page.
  router.delete('/api/stories/:id/pages', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const after = parseInt(req.query.after, 10);
    if (!Number.isFinite(after) || after < 1) return badRequest(res, '"after" must be a positive page number');
    const result = store.truncateAfter(story.id, after, (pageId) => imageStore.deleteImage('page', pageId));
    store.invalidatePreview(story.id);
    res.json(result);
  });

  return router;
}

module.exports = { createStoriesRouter };
