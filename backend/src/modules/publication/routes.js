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

function createPublicationRouter({ publications }) {
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

  return router;
}

module.exports = { createPublicationRouter, filenameFor };
