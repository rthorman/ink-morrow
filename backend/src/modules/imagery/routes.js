'use strict';

// Imagery routes: image-prompt condensing, scene render, painted plate
// binding/fetch, and the disk-space status the low-storage banner polls.

const fs = require('fs');
const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText, asString, modelOverrideOf, parseReasoningEffort } = require('../../core/validation');

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function createImageryRouter({ stories, imagery, imageStore, imageDir }) {
  const router = express.Router();

  router.post('/api/stories/:id/pages/:number/image-prompt', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      res.json({ prompt: await imagery.condensePrompt({ story, page, modelOverride, reasoningEffort }) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/pages/:number/scene-image', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');
      const result = await imagery.renderScene({ story, page, body: req.body });
      if (result.error) return badRequest(res, result.error);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Bind a painted scene into the story as a page of its own right after the
  // page it illustrates. The bytes arrive from the client (it just painted
  // them), land on disk keyed by the new page id, and every later page is
  // renumbered to make room.
  router.post('/api/stories/:id/pages/:number/image-page', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const after = parseInt(req.params.number, 10);
    const page = stories.getPageByNumber(story.id, after);
    if (!page) return notFound(res, 'Page not found');
    const mediaType = asString(req.body.media_type);
    if (!IMAGE_MEDIA_TYPES.includes(mediaType)) {
      return badRequest(res, `"media_type" must be one of: ${IMAGE_MEDIA_TYPES.join(', ')}`);
    }
    const base64 = asString(req.body.image);
    if (!base64) return badRequest(res, '"image" (base64) is required');
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return badRequest(res, '"image" is not valid base64');
    }
    if (buffer.length === 0) return badRequest(res, '"image" is empty');
    let imagePrompt = null;
    if (req.body.prompt !== undefined && req.body.prompt !== null) {
      imagePrompt = optionalText(req.body.prompt, { max: 4000 });
      if (imagePrompt === undefined) return badRequest(res, '"prompt" must be text of at most 4000 characters');
    }
    const cost = req.body.cost_usd;
    if (cost !== undefined && cost !== null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) {
      return badRequest(res, '"cost_usd" must be a non-negative number');
    }

    const inserted = stories.insertImagePage(story.id, after, { mediaType, imagePrompt, cost });
    imageStore.writeImage('page', inserted.id, buffer, mediaType);
    stories.invalidatePreview(story.id); // a live write: any speculative page is stale now
    res.status(201).json({ page: stories.getPageById(inserted.id) });
  });

  router.get('/api/stories/:id/pages/:number/image', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
    if (!page || !page.image_media_type) return notFound(res, 'Page image not found');
    const image = imageStore.readImage('page', page.id);
    if (!image) return notFound(res, 'Image file is missing');
    res.setHeader('Content-Type', image.mediaType);
    if (req.query.download === '1') {
      const ext = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType === 'image/webp' ? 'webp' : 'png';
      const slug = story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story';
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-page-${page.page_number}.${ext}"`);
    }
    res.send(image.buffer);
  });

  // Plates, portraits and the database all grow on the same filesystem. The
  // frontend shows a persistent banner when free room runs low (nulls when
  // the filesystem won't say).
  router.get('/api/disk', (req, res) => {
    try {
      const stats = fs.statfsSync(imageDir);
      res.json({ free_bytes: stats.bsize * stats.bavail, total_bytes: stats.bsize * stats.blocks });
    } catch {
      res.json({ free_bytes: null, total_bytes: null });
    }
  });

  return router;
}

module.exports = { createImageryRouter };
