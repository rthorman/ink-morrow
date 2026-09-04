'use strict';

// Application composer: global middleware, one runtime/service set, feature
// current-product router mounting, static frontend, error handling, and
// a disposal hook. All domain behavior lives in src/modules/*.

const express = require('express');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { createAiClient } = require('./ai');
const { createImageClient } = require('./images');
const { createLegacyRuntime } = require('./legacy-runtime');
const { createPublicShareRouter } = require('./modules/publication/share-routes');
const { createHostGuard, securityHeaders } = require('./core/security');
const { releaseCapabilities } = require('./release');

const { createFictionStore } = require('./modules/fiction/store');
const { createFictionService } = require('./modules/fiction/service');
const { createFictionRouter } = require('./modules/fiction/routes');
const { createFictionMedia } = require('./modules/fiction/media');
const { createFictionPublication } = require('./modules/fiction/publication');
const { createFictionSaves } = require('./modules/fiction/saves');
const { createAuthService } = require('./modules/auth/service');
const { createAuthRouter } = require('./modules/auth/routes');
const { createProviderService } = require('./modules/providers/service');
const { createProviderRouter } = require('./modules/providers/routes');

function createApp(
  db,
  {
    staticDir = path.join(__dirname, '../../frontend'),
    imageDir = path.join(__dirname, '../../database-v5/images'),
    audioDir = path.join(__dirname, '../../database-v5/audio'),
    transferDir = null,
    publicationDir = null,
    authRequired = process.env.NODE_ENV !== 'test',
    legacyEnabled = false,
    authOptions = {},
    providerOptions = {},
    allowLan = false,
    allowedHosts = [],
    trustProxy = false,
    recoveryRetentionDays = process.env.RECOVERY_RETENTION_DAYS,
    writerLeaseMs,
    autoSuccessorEnabled,
    clock = () => new Date(),
    // Logger seam: tests inject a collector so expected provider/quality
    // failures can be asserted without spilling stderr; production keeps
    // the console and unexpected errors remain visible.
    logger = console,
  } = {}
) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(createHostGuard({ allowLan, allowedHosts }));

  // Simple request log (skip static + health noise + test runs)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && process.env.NODE_ENV !== 'test') {
      logger.log(`${req.method} ${req.path}`);
    }
    next();
  });

  // Authentication is the first API feature. Every other API is guarded
  // before a potentially large request body is read from the socket.
  const auth = createAuthService({ db, logger, enabled: authRequired, ...authOptions });
  const providers = createProviderService({ db, auth, ...providerOptions });
  const providerSafeLogger = {
    log: (message) => logger.log(providers.redact(message)),
    error: (message) => logger.error(providers.redact(message)),
  };
  auth.attachVaultLifecycle({
    status: providers.vault.status,
    unlockIfPresent: providers.vault.unlockIfPresent,
    prepareRewrap: providers.vault.prepareRewrap,
    applyRewrap: providers.vault.applyRewrap,
    lockAll: providers.lockAll,
  });
  app.use(createAuthRouter({ auth }));
  // The manual is deliberately public: a locked-out owner may need its setup,
  // recovery, and network guidance before they can authenticate.
  app.get('/user-manual.pdf', (req, res) => {
    const manualPath = path.join(__dirname, '../../docs/pdf/Ink-Morrow-5.0-User-Guide.pdf');
    res.setHeader('Cache-Control', 'no-cache');
    res.download(manualPath, 'Ink-Morrow-User-Manual.pdf');
  });
  // Only inherited tests can mount the retired public-reader seam. Production
  // has no unauthenticated story API or sharing capability.
  if (legacyEnabled) app.use(createPublicShareRouter({ shares: () => app.locals.publicationShares }));
  app.use('/api', auth.requireAuth, auth.requireSameOrigin, auth.requireCsrf);

  // Authenticated identity distinguishes live 5.0 features from retired archives.
  const capabilities = releaseCapabilities(require('../package.json').version);
  app.get('/api/capabilities', (req, res) => res.json(capabilities));

  const ordinaryJson = express.json({ limit: '256kb' });
  const paintedPageJson = express.json({ limit: '12mb' });
  const paintedPagePath = /^\/api\/stories\/[^/]+\/pages\/\d+\/image-page$/;
  app.use((req, res, next) => {
    if (!req.is('application/json')) return next();
    return (legacyEnabled && paintedPagePath.test(req.path) ? paintedPageJson : ordinaryJson)(req, res, next);
  });

  // -- runtime / service set -------------------------------------------------

  const ai = createAiClient({ providers });
  const fictionStore = createFictionStore(db);
  fictionStore.reconcile();
  const fiction = createFictionService({ store: fictionStore, chatCompletion: ai.chatCompletion, archivistCompletion: ai.archivistCompletion, providers });
  app.locals.validateStartup = () => legacyEnabled ? providers.validateStartup(ai.listModelsForProfile) : Promise.resolve();
  const imageClient = createImageClient({ providers });
  const { generateIllustration } = imageClient;
  const fictionMedia = createFictionMedia({ db, store: fictionStore, rootDir: imageDir, generateIllustration, providers });
  const fictionPublication = createFictionPublication({ store: fictionStore, media: fictionMedia });
  const fictionSaves = createFictionSaves({ db, store: fictionStore, media: fictionMedia });
  app.locals.auth = auth;
  app.locals.providers = providers;
  app.locals.releaseCapabilities = capabilities;
  app.use(createProviderRouter({ providers, ai }));
  app.use(createFictionRouter({ store: fictionStore, service: fiction, providers, media: fictionMedia, publication: fictionPublication, saves: fictionSaves, allowManualOpening: legacyEnabled }));
  const legacy = legacyEnabled ? createLegacyRuntime({ db, app, providers, ai, imageClient, imageDir, audioDir, transferDir, publicationDir, recoveryRetentionDays, writerLeaseMs, autoSuccessorEnabled, clock, providerSafeLogger }) : null;

  // -- static frontend + error handling -------------------------------------

  if (staticDir) {
    app.get(['/share', '/share/', '/share.html'], (req, res) => {
      if (!legacyEnabled) return res.status(404).send('Public sharing is not part of InkMorrow 5.0.');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.sendFile(path.join(staticDir, 'share.html'));
    });
    app.use(express.static(staticDir));
    // SPA-ish fallback for non-API GET routes
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((error, req, res, next) => {
    const status = error.statusCode || 500;
    const reference = randomUUID();
    if (status >= 500) {
      let safeLog = providers.redact(String(error.message || 'Unknown error'))
        .replace(/(?:Bearer\s+)?sk-or-v1-[A-Za-z0-9_-]+/gi, '[redacted provider key]')
        .replace(/inkmorrow_session=[^;\s]+/gi, 'inkmorrow_session=[redacted]');
      const configuredKey = process.env.OPENROUTER_API_KEY || '';
      if (configuredKey.length >= 8) safeLog = safeLog.replaceAll(configuredKey, '[redacted provider key]');
      logger.error(`Unhandled error ${reference} on ${req.method} ${req.path}: ${safeLog}`);
    }
    let message = providers.redact(error.message || 'Request failed');
    if (error.type === 'entity.parse.failed') message = 'The request body is not valid JSON.';
    else if (status === 413) message = 'The request is too large.';
    else if (status === 500) message = `Internal server error. Reference: ${reference}`;
    const body = { error: message };
    if (error.code) body.code = error.code;
    if (error.state) body.state = error.state;
    if (status === 429 && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    // A failed local quality check can still follow one or more billable
    // provider completions. Return additive spend metadata so the local
    // session ledger stays honest even though nothing was saved.
    if (Number.isInteger(error.billedAttempts) && error.billedAttempts > 0) {
      body.billed_attempts = error.billedAttempts;
      body.cost_usd = typeof error.costUsd === 'number' && Number.isFinite(error.costUsd)
        ? error.costUsd
        : null;
      if (Number.isFinite(error.knownCostUsd)) body.known_cost_usd = error.knownCostUsd;
      if (Number.isInteger(error.unknownAttempts)) body.unknown_attempts = error.unknownAttempts;
    }
    res.status(status).json(body);
  });

  // Test/runtime disposal: queues stop accepting work; persisted user data
  // and in-flight cleanup are never deleted.
  app.locals.dispose = () => { legacy?.dispose(); providers.dispose(); };

  return app;
}

module.exports = { createApp };
