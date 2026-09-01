'use strict';

// Story, cast, and direct page CRUD + truncate routes. Paths and response
// shapes are unchanged from the monolith.

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText } = require('../../core/validation');

function createStoriesRouter({ store, imageStore, artStore = null, imageQueue, audio, transactions = null }) {
  const router = express.Router();

  function idempotencyKey(req) {
    const value = req.get('Idempotency-Key') || req.body?.idempotency_key;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function writerSessionId(req) {
    const explicit = req.get('X-ScribeTribe-Writer-Session') || req.body?.writer_session_id;
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 300);
    const authenticated = req.authSession?.tokenHash;
    return typeof authenticated === 'string' && authenticated.trim()
      ? `compat:${authenticated.trim()}`.slice(0, 300)
      : 'legacy-client';
  }

  function acquireWriter(req, storyId) {
    transactions?.acquireLease(storyId, writerSessionId(req));
  }

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
    acquireWriter(req, story.id);
    const payload = store.validateStoryPayload(req.body, { partial: true, existing: story });
    if (payload.error) return badRequest(res, payload.error);
    res.json({ story: store.storyWithHierarchy(store.updateStory(story.id, payload)) });
  });

  router.delete('/api/stories/:id', async (req, res, next) => {
    try {
      const story = store.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      acquireWriter(req, story.id);
      // Stop any audiobook work for this tale before the row cascade kills it
      // (the runner's per-page updates are guarded by status = 'pending').
      audio.abandonStory(story.id);
      for (const page of store.storyPages(story.id)) {
        if (page.image_media_type) imageStore.deleteImage('page', page.id); // pre-PR 07 recovery seam
      }
      for (const pageId of store.revisions.recoveryPageIds(story.id)) {
        imageStore.deleteImage('page', pageId);
      }
      imageStore.deleteImage('story', story.id);
      if (artStore) {
        await artStore.ready;
        for (const asset of artStore.list(story.id).assets) artStore.deleteAsset(story.id, asset.id);
      }
      store.deleteStoryCascade(story.id);
      store.invalidatePreview(story.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
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
    acquireWriter(req, story.id);
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
    acquireWriter(req, story.id);
    const title = requiredTitle(req.body.title);
    if (title.error) return badRequest(res, title.error);
    const volume = store.hierarchy.renameVolume(story.id, req.params.volumeId, title.value);
    if (!volume) return notFound(res, 'Volume not found');
    res.json({ volume });
  });

  router.delete('/api/stories/:id/volumes/:volumeId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const deleted = store.hierarchy.deleteVolume(story.id, req.params.volumeId);
    if (!deleted) return notFound(res, 'Volume not found');
    res.status(204).end();
  });

  router.post('/api/stories/:id/volumes/:volumeId/chapters', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const title = optionalTitle(req.body.title, 'title');
    if (title.error) return badRequest(res, title.error);
    const chapter = store.hierarchy.createChapter(story.id, req.params.volumeId, title.value);
    if (!chapter) return notFound(res, 'Volume not found');
    res.status(201).json({ chapter, hierarchy: store.hierarchy.buildHierarchy(story.id) });
  });

  router.put('/api/stories/:id/chapters/:chapterId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const title = requiredTitle(req.body.title);
    if (title.error) return badRequest(res, title.error);
    const chapter = store.hierarchy.renameChapter(story.id, req.params.chapterId, title.value);
    if (!chapter) return notFound(res, 'Chapter not found');
    res.json({ chapter });
  });

  router.delete('/api/stories/:id/chapters/:chapterId', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
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
    res.json({ page: { ...page, revisions: store.revisions.revisionState(story.id, page.id) } });
  });

  router.get('/api/stories/:id/pages/:pageId/revisions', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const history = store.revisions.listPageRevisions(story.id, req.params.pageId);
    if (!history) return notFound(res, 'Page not found');
    res.json(history);
  });

  // Substantive prose changes are canonical only at the active tail. The new
  // immutable revision becomes both canonical and displayed prose.
  router.put('/api/stories/:id/pages/:pageId/revisions', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const content = optionalText(req.body.content, { max: 500000 });
    if (!content) return badRequest(res, '"content" must be non-empty text of at most 500000 characters');
    const direction = optionalText(req.body.direction, { max: 10000 });
    const result = store.revisions.tailEdit(story.id, req.params.pageId, {
      content,
      direction,
      idempotencyKey: idempotencyKey(req),
    });
    if (!result) return notFound(res, 'Page not found');
    res.json(result);
  });

  // Historical copyedits alter only the display pointer. Canonical evidence
  // and the page's established continuity row stay intact.
  router.post('/api/stories/:id/pages/:pageId/copyedits', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    const content = optionalText(req.body.content, { max: 500000 });
    if (!content) return badRequest(res, '"content" must be non-empty text of at most 500000 characters');
    const result = store.revisions.copyedit(story.id, req.params.pageId, {
      content,
      idempotencyKey: idempotencyKey(req),
    });
    if (!result) return notFound(res, 'Page not found');
    res.status(201).json(result);
  });

  // -- truncation recovery -------------------------------------------------

  router.get('/api/stories/:id/recoveries', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({
      recoveries: store.revisions.listRecoveries(
        story.id,
        (pageId) => imageStore.deleteImage('page', pageId)
      ),
    });
  });

  router.post('/api/stories/:id/recoveries/:recoveryId/undo', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    if (typeof req.body.undo_token !== 'string' || !req.body.undo_token) {
      return badRequest(res, '"undo_token" is required');
    }
    store.revisions.expireRecoveries(story.id, (pageId) => imageStore.deleteImage('page', pageId));
    const result = store.revisions.restoreRecovery(story.id, req.params.recoveryId, {
      undoToken: req.body.undo_token,
      idempotencyKey: idempotencyKey(req),
    });
    if (!result) return notFound(res, 'Recovery suffix not found');
    res.json(result);
  });

  router.post('/api/stories/:id/recoveries/:recoveryId/restore', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    acquireWriter(req, story.id);
    store.revisions.expireRecoveries(story.id, (pageId) => imageStore.deleteImage('page', pageId));
    const result = store.revisions.restoreRecovery(story.id, req.params.recoveryId, {
      idempotencyKey: idempotencyKey(req),
    });
    if (!result) return notFound(res, 'Recovery suffix not found');
    res.json(result);
  });

  router.get('/api/stories/:id/recoveries/:recoveryId/export', (req, res) => {
    const story = store.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const recovery = store.revisions.exportRecovery(
      story.id,
      req.params.recoveryId,
      (pageId) => imageStore.deleteImage('page', pageId)
    );
    if (!recovery) return notFound(res, 'Recovery suffix not found');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="recovery-${req.params.recoveryId}.json"`);
    res.send(`${JSON.stringify(recovery, null, 2)}\n`);
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
    acquireWriter(req, story.id);
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
    acquireWriter(req, story.id);
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
    acquireWriter(req, story.id);
    const after = parseInt(req.query.after, 10);
    if (!Number.isFinite(after) || after < 1) return badRequest(res, '"after" must be a positive page number');
    const result = store.truncateAfter(story.id, after, {
      idempotencyKey: idempotencyKey(req),
    });
    res.json(result);
  });

  return router;
}

module.exports = { createStoriesRouter };
