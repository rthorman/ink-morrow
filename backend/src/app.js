'use strict';

// Application composer: global middleware, one runtime/service set, feature
// router mounting on unchanged paths, static frontend, error handling, and
// a disposal hook. All domain behavior lives in src/modules/*.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { createAiClient } = require('./ai');
const { createImageClient, createImageStore } = require('./images');
const { createHostGuard, securityHeaders } = require('./core/security');
const { releaseCapabilities } = require('./release');

const { createCatalogStore } = require('./modules/catalog/store');
const { createCatalogRouter } = require('./modules/catalog/routes');
const { createScribeStore } = require('./modules/scribes/store');
const { createScribeRouter } = require('./modules/scribes/routes');
const { createStoriesStore } = require('./modules/stories/store');
const { createStoriesRouter } = require('./modules/stories/routes');
const { createContinuityStore } = require('./modules/continuity/store');
const { createContinuityService } = require('./modules/continuity/service');
const { createContinuityRouter } = require('./modules/continuity/routes');
const { createWritingService } = require('./modules/writing/service');
const { createWritingRouter } = require('./modules/writing/routes');
const { createWritingTransactions } = require('./modules/writing/transactions');
const { createImageQueue } = require('./modules/imagery/queue');
const { createImageryService } = require('./modules/imagery/service');
const { createImageryRouter } = require('./modules/imagery/routes');
const { createArtStore } = require('./modules/imagery/art-store');
const { createNarration } = require('./modules/audio/narration');
const { createAudiobookQueue } = require('./modules/audio/audiobook-queue');
const { createAudioRouter } = require('./modules/audio/routes');
const { createLibraryRouter } = require('./modules/library/routes');
const { createExportPlanner } = require('./modules/transfer/planner');
const { createTransferService } = require('./modules/transfer/service');
const { createTransferRouter } = require('./modules/transfer/routes');
const { createAuthService } = require('./modules/auth/service');
const { createAuthRouter } = require('./modules/auth/routes');
const { createProviderService } = require('./modules/providers/service');
const { createProviderRouter } = require('./modules/providers/routes');
const { createPublicationService } = require('./modules/publication/document');
const { createPublicationRouter } = require('./modules/publication/routes');
const { createPublicationJobs } = require('./modules/publication/jobs');
const { createPublicationShares } = require('./modules/publication/shares');
const { createPublicShareRouter, createPublicationShareRouter } = require('./modules/publication/share-routes');

function createApp(
  db,
  {
    staticDir = path.join(__dirname, '../../frontend'),
    imageDir = path.join(__dirname, '../../database/images'),
    audioDir = path.join(__dirname, '../../database/audio'),
    transferDir = null,
    publicationDir = null,
    authRequired = process.env.NODE_ENV !== 'test',
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
  // The public reader is the sole unauthenticated API seam. It accepts a
  // capability in an Authorization header, never in a logged path or query.
  // The service is assigned before createApp returns and the closure prevents
  // the rest of /api from bypassing the owner gate.
  let publicationShares;
  app.use(createPublicShareRouter({ shares: () => publicationShares }));
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
  const scribes = createScribeStore(db);
  const stories = createStoriesStore(db, {
    getWorld: catalog.getWorld,
    scribes,
    recoveryRetentionDays,
    clock,
  });
  const ai = createAiClient({ providers });
  app.locals.validateStartup = () => providers.validateStartup(ai.listModelsForProfile);
  const { generateImage, describeImageProvider } = createImageClient({ providers });
  // Automatic continuity is silenced in ordinary unit tests so old one-call
  // provider mocks remain deterministic. Dedicated continuity tests opt in.
  const autoContinuityEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_CONTINUITY_EXTRACTION === '1';
  const continuityStore = createContinuityStore(db);
  const continuity = createContinuityService({
    db, stories, store: continuityStore, chatCompletion: ai.archivistCompletion, autoEnabled: autoContinuityEnabled,
  });
  const writing = createWritingService({ db, catalog, scribes, stories, continuity, chatCompletion: ai.chatCompletion });
  const writingTransactions = createWritingTransactions({
    db,
    stories,
    continuityStore,
    continuity,
    writing,
    clock,
    ...(writerLeaseMs === undefined ? {} : { leaseMs: writerLeaseMs }),
    ...(autoSuccessorEnabled === undefined ? {} : { autoSuccessorEnabled }),
    logger: providerSafeLogger,
  });
  const imageStore = createImageStore(imageDir);
  const artStore = createArtStore({
    db,
    rootDir: imageDir,
    legacyImageStore: imageStore,
    logger: providerSafeLogger,
  });
  // Auto-generation (creation + boot backfill) can be silenced in tests so it
  // never steals mocked upstream calls; explicit redo always works.
  const autoImagesEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_BACKGROUND_IMAGES === '1';
  const imageQueue = createImageQueue({
    db, continuity, generateImage, imageStore, logger: providerSafeLogger, autoImagesEnabled,
  });
  const imagery = createImageryService({
    catalog,
    stories,
    continuity,
    chatCompletion: ai.chatCompletion,
    generateImage,
    describeImageProvider,
    imageStore,
    artStore,
  });
  const narration = createNarration({ createSpeech: ai.createSpeech });
  // Whole-story audiobooks live on disk next to the images; a pending row
  // left behind by a server restart can never finish - fail it honestly.
  fs.mkdirSync(audioDir, { recursive: true });
  db.prepare(
    "UPDATE audiobooks SET status = 'failed', error = 'Interrupted by a server restart. Start it again from the audiobook button.', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'"
  ).run();
  const audiobooks = createAudiobookQueue({
    db,
    audioDir,
    stories,
    narration,
    listSpeechModels: ai.listSpeechModels,
    fetchGenerationCost: ai.fetchGenerationCost,
    logger: providerSafeLogger,
  });
  const audio = { abandonStory: audiobooks.abandonStory };
  // Imports are staged next to the database in production. Tests receive an
  // isolated disposable root unless they explicitly provide one.
  const ownsTransferDir = !transferDir && process.env.NODE_ENV === 'test';
  const resolvedTransferDir = transferDir || (ownsTransferDir
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'im-transfers-'))
    : path.join(__dirname, '../../database/transfers'));
  const transferPlanner = createExportPlanner({
    db,
    imageStore,
    artStore,
    audioDir,
    appVersion: require('../package.json').version,
  });
  const transfers = createTransferService({
    db,
    planner: transferPlanner,
    imageStore,
    artStore,
    audioDir,
    audiobooks,
    writingTransactions,
    transferDir: resolvedTransferDir,
  });
  const publications = createPublicationService({ db, stories, artStore });
  const ownsPublicationDir = !publicationDir && process.env.NODE_ENV === 'test';
  const resolvedPublicationDir = publicationDir || (ownsPublicationDir
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'im-publications-'))
    : path.join(__dirname, '../../database/publications'));
  const publicationJobs = createPublicationJobs({ publications, rootDir: resolvedPublicationDir, clock });
  publicationShares = createPublicationShares({ db, publications, clock });
  app.locals.auth = auth;
  app.locals.providers = providers;
  app.locals.releaseCapabilities = capabilities;
  app.locals.writingTransactions = writingTransactions;
  app.locals.artStore = artStore;
  app.locals.publications = publications;
  app.locals.publicationJobs = publicationJobs;
  app.locals.publicationShares = publicationShares;

  // -- feature routers (unchanged paths) ---------------------------------------

  app.use(createCatalogRouter({ store: catalog, imageQueue, imageStore, stories }));
  app.use(createScribeRouter({ store: scribes, imageQueue, imageStore, stories }));
  app.use(createProviderRouter({ providers, ai }));
  app.use(createStoriesRouter({
    store: stories, imageStore, artStore, imageQueue, audio, transactions: writingTransactions,
  }));
  app.use(createContinuityRouter({ stories, store: continuityStore, continuity }));
  app.use(createWritingRouter({ catalog, stories, writing, transactions: writingTransactions, ai }));
  app.use(createImageryRouter({ stories, imagery, imageStore, artStore, imageDir }));
  app.use(createAudioRouter({ stories, narration, audiobooks, ai, logger: providerSafeLogger }));
  app.use(createLibraryRouter({ db, catalog, stories, continuity, publications, imageStore, artStore, audiobooks }));
  app.use(createPublicationRouter({ publications, jobs: publicationJobs }));
  app.use(createPublicationShareRouter({ shares: publicationShares }));
  app.use(createTransferRouter({ transfers }));

  // Boot backfill of entity reference images (no-op without an API key or
  // in silenced test runs).
  imageQueue.backfill();

  // -- static frontend + error handling -------------------------------------

  if (staticDir) {
    app.get(['/share', '/share/'], (req, res) => {
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
    publicationJobs.dispose();
    writingTransactions.dispose();
    providers.dispose();
    if (ownsTransferDir) {
      try { fs.rmSync(resolvedTransferDir, { recursive: true, force: true }); } catch { /* test cleanup only */ }
    }
    if (ownsPublicationDir) {
      try { fs.rmSync(resolvedPublicationDir, { recursive: true, force: true }); } catch { /* test cleanup only */ }
    }
  };

  return app;
}

module.exports = { createApp };
