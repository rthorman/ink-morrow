'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { receiveImageUpload } = require('../imagery/upload');
const { SAVE_MIME, MAX_PACKED } = require('./saves');
const { fail, keys, text } = require('./model');
const { parseReasoningEffort } = require('../../core/validation');
const { catalogue } = require('./scenarios');

function createFictionRouter({ store, service, providers = null, media, publication, saves }) {
  const router = express.Router();
  const expose = (story) => ({ ...story, generation: providers?.exposure('scribe', {
    data_categories: ['story premise', 'selected cast', 'boundaries', 'relevant facts including hidden world truth', 'bounded recent prose', 'reader direction'],
    operation_count: 1,
  }) || null, illustration_generation: providers?.exposure('illustrator', {
    data_categories: ['selected story passage', 'art direction'], operation_count: 1,
  }) || null });
  const revision = (req) => req.body?.expected_revision;
  router.get('/api/fiction', (req, res) => {
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) fail('Invalid story page.');
    const stories = store.list(offset);
    res.json({ stories: stories.slice(0, 80), next_offset: stories.length > 80 ? offset + 80 : null });
  });
  router.post('/api/fiction', (req, res) => res.status(201).json({ story: expose(store.create(req.body)) }));
  router.get('/api/fiction/scenarios', (req, res) => res.json({ scenarios: catalogue() }));
  router.get('/api/fiction/:id/memory', (req, res) => res.json({ facts: store.recall(req.params.id, req.query.q || '') }));
  router.get('/api/fiction/:id/evidence/:beat', (req, res) => res.json({ beat: store.evidence(req.params.id, req.params.beat) }));
  router.post('/api/fiction/:id/challenge-review', (req, res) => {
    keys(req.body, ['expected_revision', 'input'], 'Review challenge');
    res.json({ review: service.reviewChallenge(req.params.id, revision(req), req.body.input) });
  });
  const saveBody = express.raw({ type: SAVE_MIME, limit: MAX_PACKED });
  router.post('/api/fiction/saves/preview', saveBody, async (req, res, next) => {
    try { res.json({ preview: await saves.preview(req.body) }); } catch (error) { next(error); }
  });
  router.post('/api/fiction/saves/import', saveBody, async (req, res, next) => {
    try { res.status(201).json({ story: expose(await saves.importSave(req.body)) }); } catch (error) { next(error); }
  });
  router.get('/api/fiction/:id/save', async (req, res, next) => {
    try { res.set('Cache-Control', 'private, no-store').attachment('InkMorrow-story.inkmorrow5').type(SAVE_MIME).send(await saves.exportSave(req.params.id)); }
    catch (error) { next(error); }
  });
  router.get('/api/fiction/:id/images/:asset', (req, res) => {
    const image = media.read(req.params.id, req.params.asset);
    res.set('Cache-Control', 'private, no-store').type(image.media_type).send(image.buffer);
  });
  router.post('/api/fiction/:id/images/upload', async (req, res, next) => {
    let upload;
    try {
      upload = await receiveImageUpload(req, path.join(media.directory, 'staging'));
      keys(upload.fields, ['expected_revision', 'beat_id', 'alt_text', 'caption'], 'Illustration upload');
      if (!/^\d+$/.test(upload.fields.expected_revision || '')) fail('The current story revision is required.');
      const { expected_revision, ...placement } = upload.fields;
      const story = await media.upload(req.params.id, Number(expected_revision), upload, placement);
      res.status(201).json({ story: expose(story) });
    } catch (error) { next(error); }
    finally { if (upload) { try { fs.unlinkSync(upload.path); } catch { /* already cleaned */ } } }
  });
  router.post('/api/fiction/:id/images/generate', async (req, res, next) => {
    try {
      keys(req.body, ['expected_revision', 'idempotency_key', 'input'], 'Illustrate story');
      const result = await media.generate(req.params.id, revision(req), req.get('Idempotency-Key') || req.body.idempotency_key, req.body.input);
      res.status(result.reused ? 200 : 201).json({ ...result, story: expose(result.story) });
    } catch (error) { next(error); }
  });
  router.post('/api/fiction/:id/images/remove', (req, res) => {
    keys(req.body, ['expected_revision', 'beat_id'], 'Remove illustration');
    res.json({ story: expose(store.removeIllustration(req.params.id, revision(req), text(req.body.beat_id, 'Moment', 80))) });
  });
  router.post('/api/fiction/:id/images/describe', (req, res) => {
    keys(req.body, ['expected_revision', 'beat_id', 'alt_text'], 'Describe illustration');
    res.json({ story: expose(store.describeIllustration(req.params.id, revision(req), req.body)) });
  });
  router.get('/api/fiction/:id/book/:format', async (req, res, next) => {
    try {
      const exported = await publication.export(req.params.id, req.params.format, req.query);
      res.set('Cache-Control', 'private, no-store').attachment(`InkMorrow-story.${exported.extension}`).type(exported.contentType).send(exported.buffer);
    } catch (error) { next(error); }
  });
  router.get('/api/fiction/:id', (req, res) => res.json({ story: expose(store.view(req.params.id, { before: req.query.before || null, limit: req.query.limit ? Number(req.query.limit) : 60 })) }));
  router.post('/api/fiction/:id/branches', (req, res) => {
    keys(req.body, ['expected_revision', 'name', 'beat_id'], 'Alternate path');
    res.status(201).json({ story: expose(store.fork(req.params.id, revision(req), { name: req.body.name, beat_id: req.body.beat_id })) });
  });
  router.put('/api/fiction/:id/branch', (req, res) => {
    keys(req.body, ['expected_revision', 'branch_id'], 'Select path');
    res.json({ story: expose(store.selectBranch(req.params.id, revision(req), text(req.body.branch_id, 'Path ID', 80))) });
  });
  router.put('/api/fiction/:id/control', (req, res) => {
    keys(req.body, ['expected_revision', 'character_id'], 'Character control');
    res.json({ story: expose(store.control(req.params.id, revision(req), req.body.character_id)) });
  });
  router.post('/api/fiction/:id/corrections', (req, res) => {
    keys(req.body, ['expected_revision', 'fact', 'remove_id', 'reason'], 'Correction');
    res.status(201).json({ story: expose(store.correct(req.params.id, revision(req), { fact: req.body.fact, remove_id: req.body.remove_id, reason: req.body.reason })) });
  });
  router.post('/api/fiction/:id/episodes', (req, res) => {
    keys(req.body, ['expected_revision', 'action', 'title', 'summary'], 'Episode');
    res.status(201).json({ story: expose(store.episode(req.params.id, revision(req), { action: req.body.action, title: req.body.title, summary: req.body.summary })) });
  });
  router.put('/api/fiction/:id/preferences', (req, res) => {
    keys(req.body, ['expected_revision', 'pacing', 'consequences', 'boundaries', 'voice', 'focus', 'play_style', 'fourth_wall'], 'Story preferences');
    const { expected_revision, ...input } = req.body;
    res.json({ story: expose(store.preferences(req.params.id, expected_revision, input)) });
  });
  router.post('/api/fiction/:id/cast', (req, res) => {
    keys(req.body, ['expected_revision', 'character'], 'Add cast member');
    res.status(201).json({ story: expose(store.addCast(req.params.id, revision(req), req.body.character)) });
  });
  router.post('/api/fiction/:id/replies', async (req, res, next) => {
    try {
      keys(req.body, ['expected_revision', 'idempotency_key', 'input', 'model', 'reasoning_effort', 'provider_id'], 'Continue story');
      const model = req.body.model === undefined ? undefined : text(req.body.model, 'Model', 300);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort != null && !reasoningEffort) fail('The reasoning effort is not supported.');
      const providerId = req.body.provider_id === undefined ? null : text(req.body.provider_id, 'Provider ID', 80);
      const result = await service.reply({ gameId: req.params.id, expectedRevision: revision(req), idempotencyKey: req.get('Idempotency-Key') || req.body.idempotency_key, input: req.body.input, model, reasoningEffort, providerId });
      res.status(result.reused ? 200 : 201).json({ ...result, story: expose(result.story) });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createFictionRouter };
