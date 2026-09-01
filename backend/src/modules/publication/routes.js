'use strict';

const express = require('express');
const { once } = require('node:events');
const { MIME, publicationChunks } = require('./adapters');

function filenameFor(title, extension) {
  const stem = String(title || 'manuscript')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 120) || 'manuscript';
  return `${stem}.${extension}`;
}

function createPublicationRouter({ publications, jobs = null }) {
  const router = express.Router();

  router.post('/api/stories/:id/publications', (req, res, next) => {
    try {
      const snapshot = publications.snapshot(req.params.id, req.body || {});
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({
        snapshot: {
          id: snapshot.id,
          sha256: snapshot.sha256,
          created_at: snapshot.created_at,
          warnings: snapshot.warnings,
          formats: publications.formats,
          document: snapshot.document,
        },
      });
    } catch (error) { next(error); }
  });

  router.get('/api/publications/:snapshotId', (req, res, next) => {
    try {
      const snapshot = publications.get(req.params.snapshotId);
      if (!snapshot) return res.status(404).json({ error: 'Publication snapshot not found.' });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('ETag', `"${snapshot.sha256}"`);
      return res.json({ snapshot });
    } catch (error) { return next(error); }
  });

  router.get('/api/publications/:snapshotId/formats/:format', async (req, res, next) => {
    try {
      const snapshot = publications.get(req.params.snapshotId);
      if (!snapshot) return res.status(404).json({ error: 'Publication snapshot not found.' });
      const format = req.params.format;
      if (!publications.formats.includes(format)) {
        const error = new Error(`Unsupported publication format: ${format}.`);
        error.statusCode = 400;
        error.code = 'PUBLICATION_FORMAT_UNSUPPORTED';
        throw error;
      }
      const filename = filenameFor(snapshot.document.metadata.title, format);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', MIME[format]);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Publication-Snapshot', snapshot.sha256);
      res.setHeader('X-Publication-Delivery', format === 'txt' ? 'streamed' : 'buffered-adapter');
      for await (const chunk of publicationChunks(snapshot.document, format)) {
        if (!res.write(chunk)) await once(res, 'drain');
      }
      return res.end();
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else next(error);
      return undefined;
    }
  });

  router.post('/api/publications/:snapshotId/exports', (req, res, next) => {
    try {
      if (!jobs) throw new Error('Publication jobs are unavailable.');
      res.setHeader('Cache-Control', 'no-store');
      res.status(202).json({ job: jobs.create(req.params.snapshotId, req.body?.formats) });
    } catch (error) { next(error); }
  });

  router.get('/api/publication-jobs/:jobId', (req, res) => {
    const job = jobs?.get(req.params.jobId);
    res.setHeader('Cache-Control', 'no-store');
    if (!job) return res.status(404).json({ error: 'Publication job not found.' });
    return res.json({ job });
  });

  router.post('/api/publication-jobs/:jobId/cancel', async (req, res, next) => {
    try {
      const job = await jobs?.cancel(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Publication job not found.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(202).json({ job });
    } catch (error) { return next(error); }
  });

  router.post('/api/publication-jobs/:jobId/retry', (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.status(202).json({ job: jobs.retry(req.params.jobId) });
    } catch (error) { next(error); }
  });

  router.get('/api/publication-jobs/:jobId/files/:filename', (req, res, next) => {
    try {
      const output = jobs.file(req.params.jobId, req.params.filename);
      res.setHeader('Cache-Control', 'no-store');
      res.download(output.path, output.filename);
    } catch (error) { next(error); }
  });

  router.delete('/api/publication-jobs/:jobId', async (req, res, next) => {
    try {
      if (!await jobs?.remove(req.params.jobId)) return res.status(404).json({ error: 'Publication job not found.' });
      return res.status(204).end();
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createPublicationRouter, filenameFor };
