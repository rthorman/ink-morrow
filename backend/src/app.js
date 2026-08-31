'use strict';

// Application composer: global middleware, one runtime/service set, feature
// router mounting on unchanged paths, static frontend, error handling, and
// a disposal hook. All domain behavior lives in src/modules/*.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost } = require('./ai');
const { generateImage, createImageStore } = require('./images');
const { createHostGuard, securityHeaders } = require('./core/security');
const { releaseCapabilities } = require('./release');

const { createCatalogStore } = require('./modules/catalog/store');
const { createCatalogRouter } = require('./modules/catalog/routes');
const { createStoriesStore } = require('./modules/stories/store');
const { createStoriesRouter } = require('./modules/stories/routes');
const { createContinuityStore } = require('./modules/continuity/store');
const { createContinuityService } = require('./modules/continuity/service');
const { createContinuityRouter } = require('./modules/continuity/routes');
const { createWritingService } = require('./modules/writing/service');
const { createWritingRouter } = require('./modules/writing/routes');
const { createImageQueue } = require('./modules/imagery/queue');
const { createImageryService } = require('./modules/imagery/service');
const { createImageryRouter } = require('./modules/imagery/routes');
const { createNarration } = require('./modules/audio/narration');
const { createAudiobookQueue } = require('./modules/audio/audiobook-queue');
const { createAudioRouter } = require('./modules/audio/routes');
const { createLibraryRouter } = require('./modules/library/routes');
const { createExportPlanner } = require('./modules/transfer/planner');
const { createTransferService } = require('./modules/transfer/service');
const { createTransferRouter } = require('./modules/transfer/routes');
const { createAuthService } = require('./modules/auth/service');
const { createAuthRouter } = require('./modules/auth/routes');

function createApp(
  db,
  {
    staticDir = path.join(__dirname, '../../frontend'),
    imageDir = path.join(__dirname, '../../database/images'),
    audioDir = path.join(__dirname, '../../database/audio'),
    transferDir = null,
    authRequired = process.env.NODE_ENV !== 'test',
    authOptions = {},
    allowLan = false,
    allowedHosts = [],
    trustProxy = false,
    recoveryRetentionDays = process.env.RECOVERY_RETENTION_DAYS,
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
  app.use(createAuthRouter({ auth }));
  app.use('/api', auth.requireAuth, auth.requireSameOrigin, auth.requireCsrf);

  // The release branch grows feature-by-feature. Later frontend PRs can use
  // this authenticated, non-secret contract instead of inferring support from
  // routes or package versions.
  const capabilities = releaseCapabilities(require('../package.json').version);
  app.get('/api/capabilities', (req, res) => res.json(capabilities));

  const ordinaryJson = express.json({ limit: '256kb' });
  const paintedPageJson = express.json({ limit: '12mb' });
  const paintedPagePath = /^\/api\/stories\/[^/]+\/pages\/\d+\/image-page$/;
  app.use((req, res, next) => {
    if (!req.is('application/json')) return next();
    return (paintedPagePath.test(req.path) ? paintedPageJson : ordinaryJson)(req, res, next);
  });

  // -- runtime / service set -------------------------------------------------

  const catalog = createCatalogStore(db);
  const stories = createStoriesStore(db, {
    getWorld: catalog.getWorld,
    recoveryRetentionDays,
    clock,
  });
  const ai = { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost };
  // Automatic continuity is silenced in ordinary unit tests so old one-call
  // provider mocks remain deterministic. Dedicated continuity tests opt in.
  const autoContinuityEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_CONTINUITY_EXTRACTION === '1';
  const continuityStore = createContinuityStore(db);
  const continuity = createContinuityService({
    db, stories, store: continuityStore, chatCompletion, autoEnabled: autoContinuityEnabled,
  });
  const writing = createWritingService({ db, catalog, stories, continuity, chatCompletion });
  const imageStore = createImageStore(imageDir);
  // Auto-generation (creation + boot backfill) can be silenced in tests so it
  // never steals mocked upstream calls; explicit redo always works.
  const autoImagesEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_BACKGROUND_IMAGES === '1';
  const imageQueue = createImageQueue({ db, continuity, generateImage, imageStore, logger, autoImagesEnabled });
  const imagery = createImageryService({ catalog, stories, continuity, chatCompletion, generateImage, imageStore });
  const narration = createNarration({ createSpeech });
  // Whole-story audiobooks live on disk next to the images; a pending row
  // left behind by a server restart can never finish - fail it honestly.
  fs.mkdirSync(audioDir, { recursive: true });
  db.prepare(
    "UPDATE audiobooks SET status = 'failed', error = 'Interrupted by a server restart. Start it again from the audiobook button.', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'"
  ).run();
  const audiobooks = createAudiobookQueue({ db, audioDir, stories, narration, listSpeechModels, fetchGenerationCost, logger });
  const audio = { abandonStory: audiobooks.abandonStory };
  // Imports are staged next to the database in production. Tests receive an
  // isolated disposable root unless they explicitly provide one.
  const ownsTransferDir = !transferDir && process.env.NODE_ENV === 'test';
  const resolvedTransferDir = transferDir || (ownsTransferDir
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'st-transfers-'))
    : path.join(__dirname, '../../database/transfers'));
  const transferPlanner = createExportPlanner({
    db,
    imageStore,
    audioDir,
    appVersion: require('../package.json').version,
  });
  const transfers = createTransferService({
    db,
    planner: transferPlanner,
    imageStore,
    audioDir,
    audiobooks,
    transferDir: resolvedTransferDir,
  });
  app.locals.auth = auth;
  app.locals.releaseCapabilities = capabilities;

  // -- feature routers (unchanged paths) ---------------------------------------

  app.use(createCatalogRouter({ store: catalog, imageQueue, imageStore, stories }));
  app.use(createStoriesRouter({ store: stories, imageStore, imageQueue, audio }));
  app.use(createContinuityRouter({ stories, store: continuityStore, continuity }));
  app.use(createWritingRouter({ catalog, stories, writing, continuity, ai }));
  app.use(createImageryRouter({ stories, imagery, imageStore, imageDir }));
  app.use(createAudioRouter({ stories, narration, audiobooks, ai, logger }));
  app.use(createLibraryRouter({ db, catalog, stories, continuity, imageStore, audiobooks }));
  app.use(createTransferRouter({ transfers }));

  // Boot backfill of entity reference images (no-op without an API key or
  // in silenced test runs).
  imageQueue.backfill();

  // -- static frontend + error handling -------------------------------------

  if (staticDir) {
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
      let safeLog = String(error.message || 'Unknown error')
        .replace(/(?:Bearer\s+)?sk-or-v1-[A-Za-z0-9_-]+/gi, '[redacted provider key]')
        .replace(/st_session=[^;\s]+/gi, 'st_session=[redacted]');
      const configuredKey = process.env.OPENROUTER_API_KEY || '';
      if (configuredKey.length >= 8) safeLog = safeLog.replaceAll(configuredKey, '[redacted provider key]');
      logger.error(`Unhandled error ${reference} on ${req.method} ${req.path}: ${safeLog}`);
    }
    let message = error.message || 'Request failed';
    if (error.type === 'entity.parse.failed') message = 'The request body is not valid JSON.';
    else if (status === 413) message = 'The request is too large.';
    else if (status === 500) message = `Internal server error. Reference: ${reference}`;
    const body = { error: message };
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
    }
    res.status(status).json(body);
  });

  // Test/runtime disposal: queues stop accepting work; persisted user data
  // and in-flight cleanup are never deleted.
  app.locals.dispose = () => {
    imageQueue.dispose();
    audiobooks.dispose();
    narration.dispose();
    transfers.dispose();
    if (ownsTransferDir) {
      try { fs.rmSync(resolvedTransferDir, { recursive: true, force: true }); } catch { /* test cleanup only */ }
    }
  };

  return app;
}

module.exports = { createApp };
