'use strict';

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { CATGIRL_CANON, ENUMS, FOCUS_AREAS } = require('./store');

function createScribeRouter({ store, imageQueue, imageStore, stories }) {
  const router = express.Router();

  router.get('/api/scribes/meta', (req, res) => res.json({
    canon: CATGIRL_CANON,
    options: ENUMS,
    focus_areas: FOCUS_AREAS,
  }));
  router.get('/api/scribes', (req, res) => res.json({ scribes: store.listScribes() }));
  router.get('/api/scribes/:id', (req, res) => {
    const scribe = store.getScribe(req.params.id);
    if (!scribe) return notFound(res, 'Scribe not found');
    return res.json({ scribe, revisions: store.revisionsFor(scribe.id) });
  });
  router.post('/api/scribes', (req, res) => {
    const payload = store.validatePayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const scribe = store.createScribe(payload);
    if (req.body.generate_image !== false) imageQueue.enqueue('scribe', scribe.id, { auto: true });
    return res.status(201).json({ scribe: store.getScribe(scribe.id) });
  });
  router.put('/api/scribes/:id', (req, res) => {
    const existing = store.getScribe(req.params.id);
    if (!existing) return notFound(res, 'Scribe not found');
    const payload = store.validatePayload(req.body, { partial: true, existing });
    if (payload.error) return badRequest(res, payload.error);
    return res.json({ scribe: store.updateScribe(existing.id, payload) });
  });
  router.delete('/api/scribes/:id', (req, res) => {
    const scribe = store.getScribe(req.params.id);
    if (!scribe) return notFound(res, 'Scribe not found');
    store.deleteScribe(scribe.id);
    imageStore.deleteImage('scribe', scribe.id);
    return res.status(204).end();
  });
  router.get('/api/scribes/:id/image', (req, res) => {
    const scribe = store.getScribe(req.params.id);
    if (!scribe) return notFound(res, 'Scribe not found');
    if (scribe.image_status !== 'ready') return notFound(res, 'Scribe has no portrait yet.');
    const image = imageStore.readImage('scribe', scribe.id);
    if (!image) return notFound(res, 'Scribe portrait file is missing');
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(image.buffer);
  });
  router.post('/api/scribes/:id/image', (req, res) => {
    const scribe = store.getScribe(req.params.id);
    if (!scribe) return notFound(res, 'Scribe not found');
    imageQueue.enqueue('scribe', scribe.id);
    return res.status(202).json({ image_status: 'pending' });
  });
  router.delete('/api/scribes/:id/image', (req, res) => {
    const scribe = store.getScribe(req.params.id);
    if (!scribe) return notFound(res, 'Scribe not found');
    imageStore.deleteImage('scribe', scribe.id);
    store.setImageDeleted(scribe.id);
    return res.status(204).end();
  });
  router.put('/api/stories/:id/scribe', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const id = req.body.scribe_id === null || req.body.scribe_id === '' ? null : req.body.scribe_id;
    if (id !== null && typeof id !== 'string') return badRequest(res, '"scribe_id" must be a string or null');
    stories.bindScribe(story.id, id);
    return res.json({ story: stories.storyWithHierarchy(stories.getStory(story.id)) });
  });

  return router;
}

module.exports = { createScribeRouter };
