'use strict';
const express = require('express');
function createCreativeRouter({ store, providers }) {
  const router = express.Router();
  const expose = require('./story-exposure').createStoryExposure(providers);
  const command = (method, req, res) => {
    const result = store.creativeRecords[method](req.params.id, req.body);
    res.json({ ...result, story: expose(result.story) });
  };
  router.get('/api/fiction/:id/creative', (req, res) =>
    res
      .set('Cache-Control', 'private, no-store')
      .json(store.creativeRecords.inspect(req.params.id)),
  );
  router.post('/api/fiction/:id/commands/configuration', (req, res) =>
    command('configure', req, res),
  );
  router.post('/api/fiction/:id/commands/references', (req, res) =>
    command('adopt', req, res),
  );
  router.post('/api/fiction/:id/commands/campaign', (req, res) =>
    command('declareCampaign', req, res),
  );
  router.post('/api/fiction/:id/commands/episodes', (req, res) =>
    command('episode', req, res),
  );
  router.post('/api/fiction/:id/commands/metadata', (req, res) =>
    command('rename', req, res),
  );
  router.get('/api/fiction/:id/commands/:key', (req, res) =>
    res
      .set('Cache-Control', 'private, no-store')
      .json(store.creativeRecords.status(req.params.id, req.params.key)),
  );
  router.post('/api/fiction/:id/commands/:key/cancel', (req, res) =>
    res.json(store.creativeRecords.cancel(req.params.id, req.params.key)),
  );
  return router;
}
module.exports = { createCreativeRouter };
