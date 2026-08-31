'use strict';

const express = require('express');

function createAuthRouter({ auth }) {
  const router = express.Router();
  const json = express.json({ limit: '16kb' });

  router.get('/api/auth/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(auth.status(req));
  });

  router.post('/api/auth/setup', auth.requireSameOrigin, json, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(await auth.setup(req, res, {
        code: req.body?.setup_code,
        password: req.body?.password,
        remember: req.body?.remember !== false,
      }));
    } catch (error) { next(error); }
  });

  router.post('/api/auth/login', auth.requireSameOrigin, json, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await auth.login(req, res, {
        password: req.body?.password,
        remember: req.body?.remember !== false,
      }));
    } catch (error) { next(error); }
  });

  router.post('/api/auth/logout', auth.requireAuth, auth.requireSameOrigin, auth.requireCsrf, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(auth.logout(req, res));
  });

  router.post('/api/auth/change-password', auth.requireAuth, auth.requireSameOrigin, auth.requireCsrf, json, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await auth.changePassword(req, res, {
        currentPassword: req.body?.current_password,
        newPassword: req.body?.new_password,
      }));
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createAuthRouter };
