'use strict';

// Historical contracts are retained only behind an explicit composer test seam.
// The executable never enables this runtime or any of its automatic work.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createImageStore } = require('./images');
const { createCatalogStore } = require('./modules/catalog/store');
const { createCatalogRouter } = require('./modules/catalog/routes');
const { createScribeStore } = require('./modules/scribes/store');
const { createScribeRouter } = require('./modules/scribes/routes');
const { createStoriesStore } = require('./modules/stories/store');
const { createStoriesRouter } = require('./modules/stories/routes');
const { createPlayStore } = require('./modules/play/store');
const { createPlayService } = require('./modules/play/service');
const { createPlayRouter } = require('./modules/play/routes');
const { createSoloToolStore } = require('./modules/play/solo-tools');
const { createSoloToolRouter } = require('./modules/play/solo-tool-routes');
const { createCampaignStore } = require('./modules/campaign/store');
const { createCampaignService } = require('./modules/campaign/service');
const { createCampaignRouter } = require('./modules/campaign/routes');
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
const { createPublicationService } = require('./modules/publication/document');
const { createPublicationRouter } = require('./modules/publication/routes');
const { createPublicationJobs } = require('./modules/publication/jobs');
const { createPublicationShares } = require('./modules/publication/shares');
const { createPublicationShareRouter } = require('./modules/publication/share-routes');

function createLegacyRuntime({ db, app, providers, ai, imageClient, imageDir, audioDir, transferDir, publicationDir, recoveryRetentionDays, writerLeaseMs, autoSuccessorEnabled, clock, providerSafeLogger }) {
  const { generateImage, describeImageProvider } = imageClient;
  const catalog = createCatalogStore(db);
  const scribes = createScribeStore(db);
  const stories = createStoriesStore(db, {
    getWorld: catalog.getWorld,
    scribes,
    recoveryRetentionDays,
    clock,
  });
  const playStore = createPlayStore(db, { stories });
  const soloTools = createSoloToolStore(db, { stories, playStore });
  // Automatic continuity is silenced in ordinary unit tests so old one-call
  // provider mocks remain deterministic. Dedicated continuity tests opt in.
  const autoContinuityEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_CONTINUITY_EXTRACTION === '1';
  const continuityStore = createContinuityStore(db);
  const continuity = createContinuityService({
    db, stories, store: continuityStore, chatCompletion: ai.archivistCompletion, autoEnabled: autoContinuityEnabled,
  });
  const campaign = createCampaignStore(db, { stories, continuity, playStore });
  const campaignService = createCampaignService({ campaign, chatCompletion: ai.chatCompletion });
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
  const play = createPlayService({
    store: playStore, stories, continuity, chatCompletion: ai.chatCompletion,
    transactions: writingTransactions, soloTools,
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
  const publicationShares = createPublicationShares({ db, publications, clock });
  app.locals.writingTransactions = writingTransactions;
  app.locals.playStore = playStore;
  app.locals.campaign = campaign;
  app.locals.artStore = artStore;
  app.locals.publications = publications;
  app.locals.publicationJobs = publicationJobs;
  app.locals.publicationShares = publicationShares;

  // -- feature routers (unchanged paths) ---------------------------------------

  app.use(createCatalogRouter({ store: catalog, imageQueue, imageStore, stories }));
  app.use(createScribeRouter({ store: scribes, imageQueue, imageStore, stories }));
  app.use(createStoriesRouter({
    store: stories, imageStore, artStore, imageQueue, audio, transactions: writingTransactions,
  }));
  app.use(createPlayRouter({ stories, store: playStore, service: play, transactions: writingTransactions }));
  app.use(createSoloToolRouter({ stories, store: soloTools, transactions: writingTransactions }));
  app.use(createCampaignRouter({ stories, campaign, service: campaignService, transactions: writingTransactions }));
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

  return { dispose: () => {
    imageQueue.dispose();
    audiobooks.dispose();
    narration.dispose();
    transfers.dispose();
    publicationJobs.dispose();
    writingTransactions.dispose();
    if (ownsTransferDir) {
      try { fs.rmSync(resolvedTransferDir, { recursive: true, force: true }); } catch { /* test cleanup only */ }
    }
    if (ownsPublicationDir) {
      try { fs.rmSync(resolvedPublicationDir, { recursive: true, force: true }); } catch { /* test cleanup only */ }
    }
  } };
}

module.exports = { createLegacyRuntime };
