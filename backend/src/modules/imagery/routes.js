'use strict';

// Imagery routes: image-prompt condensing, scene render, painted plate
// binding/fetch, and the disk-space status the low-storage banner polls.

const fs = require('fs');
const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText, asString, modelOverrideOf, parseReasoningEffort } = require('../../core/validation');
const { receiveImageUpload } = require('./upload');

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function createImageryRouter({ stories, imagery, imageStore, artStore, imageDir }) {
  const router = express.Router();

  function textField(value, label, max) {
    const clean = optionalText(value, { max });
    if (value !== undefined && clean === undefined) {
      const error = new Error(`"${label}" must be text of at most ${max} characters`);
      error.statusCode = 400;
      throw error;
    }
    return clean;
  }

  function anchorOf(story, value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !value.trim()) {
      const error = new Error('"after_page_id" must be a stable page ID or null');
      error.statusCode = 400;
      throw error;
    }
    const page = stories.hierarchy.stablePage(story.id, value.trim());
    if (!page) {
      const error = new Error('The placement anchor is not a page in this story.');
      error.statusCode = 400;
      error.code = 'INVALID_ART_ANCHOR';
      throw error;
    }
    return page.id;
  }

  function ordinalOf(value) {
    if (value === undefined || value === null || value === '') return null;
    const ordinal = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      const error = new Error('"ordinal" must be a positive integer');
      error.statusCode = 400;
      throw error;
    }
    return ordinal;
  }

  router.post('/api/stories/:id/pages/:number/image-prompt', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      res.json(await imagery.condensePrompt({ story, page, modelOverride, reasoningEffort }));
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

  // Compatibility path for the existing scene-painting client. PR 07 changes
  // its semantics: the image becomes an AI-generated asset placed after the
  // stable prose page. It never inserts or renumbers a narrative page.
  router.post('/api/stories/:id/pages/:number/image-page', async (req, res, next) => {
    try {
      await artStore.ready;
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

      const result = await artStore.createFromBuffer({
        storyId: story.id,
        source: 'ai-generated',
        buffer,
        declaredMediaType: mediaType,
        title: 'Scene illustration',
        altText: imagePrompt,
        providerResult: { prompt: imagePrompt },
        spendUsd: typeof cost === 'number' ? cost : 0,
        afterPageId: stories.hierarchy.stablePage(story.id, page.id).id,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/assets', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      res.json(artStore.list(story.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/assets/upload', async (req, res, next) => {
    let uploaded = null;
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      uploaded = await receiveImageUpload(req, artStore.stagingDir);
      const title = textField(uploaded.fields.title, 'title', 500);
      const altText = textField(uploaded.fields.alt_text, 'alt_text', 2000);
      const hasPlacement = Object.prototype.hasOwnProperty.call(uploaded.fields, 'after_page_id');
      const result = await artStore.createFromFile({
        storyId: story.id,
        source: 'uploaded',
        path: uploaded.path,
        declaredMediaType: uploaded.mediaType,
        title,
        altText,
        providerReferenceAllowed: uploaded.fields.provider_reference_allowed === 'true',
        ...(hasPlacement ? { afterPageId: anchorOf(story, uploaded.fields.after_page_id) } : {}),
        ordinal: ordinalOf(uploaded.fields.ordinal),
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    } finally {
      if (uploaded?.path) try { fs.unlinkSync(uploaded.path); } catch { /* normalized or already cleaned */ }
    }
  });

  router.patch('/api/stories/:id/assets/:assetId', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      if (req.body.provider_reference_allowed !== undefined && typeof req.body.provider_reference_allowed !== 'boolean') {
        return badRequest(res, '"provider_reference_allowed" must be a boolean');
      }
      const asset = artStore.updateAsset(story.id, req.params.assetId, {
        ...(req.body.title !== undefined ? { title: textField(req.body.title, 'title', 500) } : {}),
        ...(req.body.alt_text !== undefined ? { altText: textField(req.body.alt_text, 'alt_text', 2000) } : {}),
        ...(req.body.provider_reference_allowed !== undefined
          ? { providerReferenceAllowed: req.body.provider_reference_allowed }
          : {}),
      });
      if (!asset) return notFound(res, 'Asset not found');
      res.json({ asset });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/stories/:id/assets/:assetId', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      if (!artStore.deleteAsset(story.id, req.params.assetId)) return notFound(res, 'Asset not found');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/assets/:assetId/placements', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      if (!artStore.getAsset(story.id, req.params.assetId)) return notFound(res, 'Asset not found');
      const placement = artStore.place(story.id, req.params.assetId, {
        afterPageId: anchorOf(story, req.body.after_page_id),
        ordinal: ordinalOf(req.body.ordinal),
      });
      res.status(201).json({ placement });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/api/stories/:id/placements/:placementId', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const placement = artStore.movePlacement(story.id, req.params.placementId, {
        afterPageId: anchorOf(story, req.body.after_page_id),
        ordinal: ordinalOf(req.body.ordinal),
      });
      if (!placement) return notFound(res, 'Placement not found');
      res.json({ placement });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/stories/:id/placements/:placementId', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      if (!artStore.unplace(story.id, req.params.placementId)) return notFound(res, 'Placement not found');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/assets/:assetId/content', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const image = artStore.readAsset(story.id, req.params.assetId);
      if (!image) return notFound(res, 'Asset file not found');
      res.setHeader('Content-Type', image.mediaType);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (req.query.download === '1') {
        const slug = String(image.asset.title || story.title || 'story-art')
          .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'story-art';
        res.setHeader('Content-Disposition', `attachment; filename="${slug}.webp"`);
      }
      res.send(image.buffer);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/pages/:number/image', async (req, res, next) => {
    try {
      await artStore.ready;
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page image not found');
      const placement = artStore.list(story.id).placements.find((item) => item.after_page_id === page.id);
      if (!placement) return notFound(res, 'Page image not found');
      const image = artStore.readAsset(story.id, placement.asset_id);
      if (!image) return notFound(res, 'Image file is missing');
      res.setHeader('Content-Type', image.mediaType);
      if (req.query.download === '1') {
        const ext = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType === 'image/webp' ? 'webp' : 'png';
        const slug = story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story';
        res.setHeader('Content-Disposition', `attachment; filename="${slug}-page-${page.page_number}.${ext}"`);
      }
      res.send(image.buffer);
    } catch (error) {
      next(error);
    }
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
