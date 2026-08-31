'use strict';

// Story, cast, and direct page CRUD + truncate routes. Paths and response
// shapes are unchanged from the monolith.

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText } = require('../../core/validation');

function createStoriesRouter({ store, imageStore, imageQueue, audio }) {
  const router = express.Router();

  function optionalTitle(value, label) {
    if (value === undefined) return { value: null };
    const title = optionalText(value, { max: 500 });
    return title ? { value: title } : { error: `"${label}" must be non-empty text of at most 500 characters` };
  }

  function requiredTitle(value) {
    const title = optionalText(value, { max: 500 });
    return title ? { value: title } : { error: '"title" must be non-empty text of at most 500 characters' };
  }

  router.get('/api/stories', (req, res) => {
    const { world_id } = req.query;
    res.json({ stories: store.listStories(world_id).map(store.storyWithMeta) });
  });

  router.get('/api/stories/:id', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ story: store.storyWithHierarchy(story) });
  });

  router.post('/api/stories', (req, res) => {
    const payload = store.validateStoryPayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const story = store.createStory(payload);
    if (req.body.generate_image === true) imageQueue.enqueue('story', story.id, { auto: true });
    res.status(201).json({ story: store.storyWithHierarchy(store.getStory(story.id)) });
  });

  router.put('/api/stories/:id', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const payload = store.validateStoryPayload(req.body, { partial: true, existing: story });
    if (payload.error) return badRequest(res, payload.error);
    res.json({ story: store.storyWithHierarchy(store.updateStory(story.id, payload)) });
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
    imageStore.deleteImage('story', story.id);
    store.deleteStoryCascade(story.id);
    store.invalidatePreview(story.id);
    res.status(204).end();
  });

  router.get('/api/stories/:id/cover', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    if (story.image_status !== 'ready') return notFound(res, 'Story cover not found');
    const image = imageStore.readImage('story', story.id);
    if (!image) return notFound(res, 'Story cover file is missing');
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Cache-Control', 'no-cache'); // repaint keeps the same URL
    if (req.query.download === '1') {
      const ext = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType === 'image/webp' ? 'webp' : 'png';
      const slug = story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story';
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-cover.${ext}"`);
    }
    res.send(image.buffer);
  });

  router.post('/api/stories/:id/cover', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    imageQueue.enqueue('story', story.id);
    res.status(202).json({ story: store.storyWithMeta(store.getStory(story.id)) });
  });

  router.delete('/api/stories/:id/cover', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    imageStore.deleteImage('story', story.id);
    store.setImageDeleted(story.id);
    res.status(204).end();
  });

  // -- Story -> Volume -> Chapter -> Page hierarchy -------------------------

  router.get('/api/stories/:id/hierarchy', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ hierarchy: store.hierarchy.buildHierarchy(story.id) });
  });

  // A new volume is an immediately usable tail: its first empty chapter is
  // created in the same transaction. No setup wizard or second request is
  // needed before the next page can be written.
  router.post('/api/stories/:id/volumes', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const title = optionalTitle(req.body.title, 'title');
    if (title.error) return badRequest(res, title.error);
    const chapterTitle = optionalTitle(req.body.chapter_title, 'chapter_title');
    if (chapterTitle.error) return badRequest(res, chapterTitle.error);
    const created = store.hierarchy.createVolume(story.id, title.value, chapterTitle.value || 'Chapter I');
    res.status(201).json({ ...created, hierarchy: store.hierarchy.buildHierarchy(story.id) });
  });

  router.put('/api/stories/:id/volumes/:volumeId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const title = requiredTitle(req.body.title);
    if (title.error) return badRequest(res, title.error);
    const volume = store.hierarchy.renameVolume(story.id, req.params.volumeId, title.value);
    if (!volume) return notFound(res, 'Volume not found');
    res.json({ volume });
  });

  router.delete('/api/stories/:id/volumes/:volumeId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const deleted = store.hierarchy.deleteVolume(story.id, req.params.volumeId);
    if (!deleted) return notFound(res, 'Volume not found');
    res.status(204).end();
  });

  router.post('/api/stories/:id/volumes/:volumeId/chapters', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const title = optionalTitle(req.body.title, 'title');
    if (title.error) return badRequest(res, title.error);
    const chapter = store.hierarchy.createChapter(story.id, req.params.volumeId, title.value);
    if (!chapter) return notFound(res, 'Volume not found');
    res.status(201).json({ chapter, hierarchy: store.hierarchy.buildHierarchy(story.id) });
  });

  router.put('/api/stories/:id/chapters/:chapterId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const title = requiredTitle(req.body.title);
    if (title.error) return badRequest(res, title.error);
    const chapter = store.hierarchy.renameChapter(story.id, req.params.chapterId, title.value);
    if (!chapter) return notFound(res, 'Chapter not found');
    res.json({ chapter });
  });

  router.delete('/api/stories/:id/chapters/:chapterId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const deleted = store.hierarchy.deleteChapter(story.id, req.params.chapterId);
    if (!deleted) return notFound(res, 'Chapter not found');
    res.status(204).end();
  });

  // Stable-id page read. Legacy list/number routes remain until later PRs move
  // the frontend, while this response exposes durable hierarchy position and
  // indexed previous/next neighbors.
  router.get('/api/stories/:id/pages/:pageId', (req, res, next) => {
    // The writing router owns the pre-existing literal /pages/preview route
    // and is mounted after this router. Let that one reserved segment pass.
    if (req.params.pageId === 'preview') return next();
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const page = store.hierarchy.stablePage(story.id, req.params.pageId);
    if (!page) return notFound(res, 'Page not found');
    res.json({ page });
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
    store.deletePage(page); // transactional delete + renumber + preview invalidation
    if (page.image_media_type) imageStore.deleteImage('page', page.id);
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
