'use strict';

const express = require('express');

function createProviderRouter({ providers, ai }) {
  const router = express.Router();

  router.get('/api/providers', (req, res) => {
    res.json(providers.list());
  });

  router.post('/api/providers', (req, res, next) => {
    try { res.status(201).json({ profile: providers.createProfile(req.body || {}) }); }
    catch (error) { next(error); }
  });

  router.put('/api/providers/:id', (req, res, next) => {
    try {
      const profile = providers.updateProfile(req.params.id, req.body || {});
      if (!profile) return res.status(404).json({ error: 'Provider profile not found.' });
      res.json({ profile });
    } catch (error) { next(error); }
  });

  router.delete('/api/providers/:id', (req, res, next) => {
    try {
      if (!providers.deleteProfile(req.params.id)) return res.status(404).json({ error: 'Provider profile not found.' });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.put('/api/providers/:id/credential', async (req, res, next) => {
    try {
      const profile = await providers.setCredential(req.params.id, {
        source: req.body?.source,
        secret: req.body?.credential,
        password: req.body?.password,
      });
      if (!profile) return res.status(404).json({ error: 'Provider profile not found.' });
      res.json({ profile, vault: providers.vault.status() });
    } catch (error) { next(error); }
  });

  router.post('/api/providers/vault/unlock', async (req, res, next) => {
    try { res.json({ vault: await providers.vault.unlock(req.body?.password) }); }
    catch (error) { next(error); }
  });

  router.post('/api/providers/vault/lock', (req, res) => {
    providers.vault.lock();
    res.json({ vault: providers.vault.status() });
  });

  router.put('/api/providers/roles/:role', (req, res, next) => {
    try { res.json({ assignment: providers.assignRole(req.params.role, req.body || {}) }); }
    catch (error) { next(error); }
  });

  router.get('/api/providers/:id/models', async (req, res, next) => {
    try { res.json({ models: await ai.listModelsForProfile(req.params.id) }); }
    catch (error) { next(error); }
  });

  router.post('/api/providers/exposure', (req, res, next) => {
    try {
      res.json({ exposure: providers.exposure(req.body?.role, req.body || {}) });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createProviderRouter };
