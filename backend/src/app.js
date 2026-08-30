'use strict';

// Application composer: global middleware, one runtime/service set, feature
// router mounting on unchanged paths, static frontend, error handling, and
// a disposal hook. All domain behavior lives in src/modules/*.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost } = require('./ai');
const { generateImage, createImageStore } = require('./images');

const { createCatalogStore } = require('./modules/catalog/store');
const { createCatalogRouter } = require('./modules/catalog/routes');
const { createStoriesStore } = require('./modules/stories/store');
const { createStoriesRouter } = require('./modules/stories/routes');
const { createWritingService } = require('./modules/writing/service');
const { createWritingRouter } = require('./modules/writing/routes');
const { createImageQueue } = require('./modules/imagery/queue');
const { createImageryService } = require('./modules/imagery/service');
const { createImageryRouter } = require('./modules/imagery/routes');
const { createNarration } = require('./modules/audio/narration');
const { createAudiobookQueue } = require('./modules/audio/audiobook-queue');
const { createAudioRouter } = require('./modules/audio/routes');
const { createLibraryRouter } = require('./modules/library/routes');

function createApp(
  db,
  {
    staticDir = path.join(__dirname, '../../frontend'),
    imageDir = path.join(__dirname, '../../database/images'),
    audioDir = path.join(__dirname, '../../database/audio'),
    // Logger seam: tests inject a collector so expected provider/quality
    // failures can be asserted without spilling stderr; production keeps
    // the console and unexpected errors remain visible.
    logger = console,
  } = {}
) {
  const app = express();
  app.disable('x-powered-by');
  // Base64 scene plates bound into the story can be several MB at 2K render
  // quality - the body limit must let a painted page through.
  app.use(express.json({ limit: '12mb' }));

  // Simple request log (skip static + health noise + test runs)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && process.env.NODE_ENV !== 'test') {
      logger.log(`${req.method} ${req.path}`);
    }
    next();
  });

  // -- runtime / service set -------------------------------------------------

  const catalog = createCatalogStore(db);
  const stories = createStoriesStore(db, { getWorld: catalog.getWorld });
  const ai = { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost };
  const writing = createWritingService({ db, catalog, stories, chatCompletion });
  const imageStore = createImageStore(imageDir);
  // Auto-generation (creation + boot backfill) can be silenced in tests so it
  // never steals mocked upstream calls; explicit redo always works.
  const autoImagesEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_BACKGROUND_IMAGES === '1';
  const imageQueue = createImageQueue({ db, generateImage, imageStore, logger, autoImagesEnabled });
  const imagery = createImageryService({ catalog, stories, chatCompletion, generateImage, imageStore });
  const narration = createNarration({ createSpeech });
  // Whole-story audiobooks live on disk next to the images; a pending row
  // left behind by a server restart can never finish - fail it honestly.
  fs.mkdirSync(audioDir, { recursive: true });
  db.prepare(
    "UPDATE audiobooks SET status = 'failed', error = 'Interrupted by a server restart. Start it again from the audiobook button.', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'"
  ).run();
  const audiobooks = createAudiobookQueue({ db, audioDir, stories, narration, listSpeechModels, fetchGenerationCost, logger });
  const audio = { abandonStory: audiobooks.abandonStory };

  // -- feature routers (unchanged paths) ---------------------------------------

  app.use(createCatalogRouter({ store: catalog, imageQueue, imageStore, stories }));
  app.use(createStoriesRouter({ store: stories, imageStore, imageQueue, audio }));
  app.use(createWritingRouter({ db, catalog, stories, writing, ai }));
  app.use(createImageryRouter({ stories, imagery, imageStore, imageDir }));
  app.use(createAudioRouter({ stories, narration, audiobooks, ai, logger }));
  app.use(createLibraryRouter({ db, catalog, stories, imageStore, audiobooks }));

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
    if (status >= 500) logger.error(`Unhandled error: ${error.message}`);
    const body = { error: error.message || 'Internal server error' };
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
  };

  return app;
}

module.exports = { createApp };
