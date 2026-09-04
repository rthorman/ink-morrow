'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { receiveImageUpload } = require('../imagery/upload');
const { keys, fail } = require('./model');
const { KINDS, FIELDS, CATGIRL_CANON, ENUMS, DEFAULTS, FOCUS_AREAS } = require('./library-model');

function createFictionLibraryRouter({ library, media }) {
  const router = express.Router(); const base = '/api/fiction/catalog';
  router.get(`${base}/metadata`, (req, res) => res.json({ kinds: KINDS, fields: FIELDS, scribe: { canon: CATGIRL_CANON, enums: ENUMS, defaults: DEFAULTS, focus_areas: FOCUS_AREAS }, generation: library.generation(), spend: library.spend() }));
  router.get(base, (req, res) => res.json(library.list(req.query.kind, Number(req.query.offset || 0))));
  router.post(base, (req, res) => {
    keys(req.body, ['kind', 'entry'], 'New catalogue entry');
    res.status(201).json({ entry: library.create(req.body.kind, req.body.entry) });
  });
  router.get(`${base}/:id`, (req, res) => res.json({ entry: library.get(req.params.id), generation: library.generation() }));
  router.put(`${base}/:id`, (req, res) => {
    keys(req.body, ['expected_revision', 'entry'], 'Edit catalogue entry');
    res.json({ entry: library.update(req.params.id, req.body.expected_revision, req.body.entry) });
  });
  router.delete(`${base}/:id`, (req, res) => {
    keys(req.body, ['expected_revision'], 'Delete catalogue entry'); library.remove(req.params.id, req.body.expected_revision); res.json({ removed: true });
  });
  router.get(`${base}/:id/images/:asset`, (req, res) => {
    const asset = library.read(req.params.id, req.params.asset);
    res.set('Cache-Control', 'private, no-store').type(asset.media_type).send(asset.buffer);
  });
  router.post(`${base}/:id/images/upload`, async (req, res, next) => {
    let upload;
    try {
      upload = await receiveImageUpload(req, path.join(media.directory, 'staging'));
      keys(upload.fields, ['expected_revision', 'alt_text'], 'Catalogue image upload');
      if (!/^\d+$/.test(upload.fields.expected_revision || '')) fail('The current catalogue revision is required.');
      res.status(201).json({ entry: await library.upload(req.params.id, Number(upload.fields.expected_revision), upload, upload.fields.alt_text) });
    } catch (error) { next(error); }
    finally { if (upload) { try { fs.unlinkSync(upload.path); } catch { /* already cleaned */ } } }
  });
  router.post(`${base}/:id/images/generate`, async (req, res, next) => {
    try {
      keys(req.body, ['expected_revision', 'idempotency_key', 'input'], 'Paint catalogue image');
      const result = await library.generate(req.params.id, req.body.expected_revision, req.get('Idempotency-Key') || req.body.idempotency_key, req.body.input);
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  router.post(`${base}/:id/images/remove`, (req, res) => {
    keys(req.body, ['expected_revision'], 'Remove catalogue image'); res.json({ entry: library.removeImage(req.params.id, req.body.expected_revision) });
  });
  router.post(`${base}/:id/images/describe`, (req, res) => {
    keys(req.body, ['expected_revision', 'alt_text'], 'Describe catalogue image'); res.json({ entry: library.describeImage(req.params.id, req.body.expected_revision, req.body.alt_text) });
  });
  return router;
}
module.exports = { createFictionLibraryRouter };
