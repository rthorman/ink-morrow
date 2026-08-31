'use strict';

const express = require('express');

function createTransferRouter({ transfers }) {
  const router = express.Router();

  // Export is a two-step flow: the POST computes the complete exposure and
  // dependency plan; only the reviewed GET streams bytes to the browser.
  router.post('/api/transfers/exports/plan', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await transfers.createExport(req.body || {}));
    } catch (error) { next(error); }
  });

  router.get('/api/transfers/exports/:token', async (req, res, next) => {
    let plan;
    try {
      plan = transfers.exportPlan(req.params.token);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${plan.filename}"`);
      await transfers.streamExport(req.params.token, res);
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else next(error);
    }
  });

  router.post('/api/transfers/imports/preflight', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await transfers.preflight(req));
    } catch (error) { next(error); }
  });

  router.post('/api/transfers/imports/:token/commit', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await transfers.commit(req.params.token, req.body || {}));
    } catch (error) { next(error); }
  });

  router.delete('/api/transfers/imports/:token', (req, res) => {
    transfers.cancelImport(req.params.token);
    res.status(204).end();
  });

  router.get('/api/transfers/safety-backups/:filename', (req, res, next) => {
    try {
      const target = transfers.safetyBackupPath(req.params.filename);
      res.setHeader('Cache-Control', 'no-store');
      res.download(target, req.params.filename);
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createTransferRouter };
