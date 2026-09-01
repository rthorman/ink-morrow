'use strict';

const express = require('express');
const { CAPABILITY_PATTERN } = require('./shares');

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function publicCapability(req) {
  const match = /^Share ([A-Za-z0-9_-]+)$/.exec(String(req.get('Authorization') || ''));
  return match && CAPABILITY_PATTERN.test(match[1]) ? match[1] : null;
}

function createPublicShareRouter({ shares }) {
  const router = express.Router();
  router.get('/api/public-share', (req, res, next) => {
    try {
      const service = shares();
      const resolved = service?.resolve(publicCapability(req));
      noStore(res);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      if (!resolved) return res.status(404).json({ error: 'This reading-copy link is unavailable.' });
      return res.json({
        publication: {
          snapshot_sha256: resolved.snapshot.sha256,
          created_at: resolved.snapshot.created_at,
          expires_at: resolved.share.expires_at,
          document: resolved.snapshot.document,
        },
      });
    } catch (error) { return next(error); }
  });
  return router;
}

function createPublicationShareRouter({ shares }) {
  const router = express.Router();

  router.post('/api/publications/:snapshotId/shares', (req, res, next) => {
    try {
      noStore(res);
      return res.status(201).json({ share: shares.create(req.params.snapshotId, req.body || {}) });
    } catch (error) { return next(error); }
  });

  router.get('/api/publication-shares', (req, res, next) => {
    try {
      noStore(res);
      return res.json({ shares: shares.list(req.query.story_id) });
    } catch (error) { return next(error); }
  });

  router.post('/api/publication-shares/:shareId/revoke', (req, res, next) => {
    try {
      noStore(res);
      return res.json({ share: shares.revoke(req.params.shareId) });
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createPublicShareRouter, createPublicationShareRouter, publicCapability };
