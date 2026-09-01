// Bootstrap: creates the one application context, builds every feature,
// wires the shell, and starts the app. Runs at import time (jsdom's
// readyState is 'complete' when tests load it; the browser uses the
// module script which executes after the DOM is parsed).
//
// The `fw` export is the feature facade used by the Jest suite; production
// only needs the side effect of startup.

import { apiCall, apiFetch, configureApiSecurity, API_BASE_URL } from './core/api.js';
import { createSharedState, STORY_FONTS } from './core/state.js';
import { createNotifications } from './core/notifications.js';
import { createDialogManager, forceCloseAllModals } from './core/dialogs.js';
import { createRouter } from './core/router.js';
import { createShell, SCRIBE_FLAVOR, updateDiskBanner } from './shell.js';
import { entityImageBlock, cardActions, createCatalogPoll } from './components/entity-card.js';

import { createWorlds } from './features/worlds.js';
import { createCharacters } from './features/characters.js';
import { createHome } from './features/home.js';
import { createLibrary } from './features/library/index.js';
import { createStories } from './features/library/stories.js';
import { createStoryEditor } from './features/library/story-editor.js';
import { createBookshelf } from './features/library/bookshelf.js';
import { createWrite } from './features/write/index.js';
import { createGeneration } from './features/write/generation.js';
import { createNarration } from './features/write/narration.js';
import { createImagery } from './features/write/imagery.js';
import { createAudiobook } from './features/write/audiobook.js';
import { createSettings } from './features/settings.js';
import { createTransfer } from './features/transfer.js';
import { createAiDrafts } from './features/ai-drafts.js';
import { createAuthAdapter } from './features/auth/adapter.js';
import { createAuthGate } from './features/auth/gate.js';

export function initApp() {
  const api = { apiCall, apiFetch, API_BASE_URL };
  const state = createSharedState();
  const notify = createNotifications();
  const dialogs = createDialogManager();
  // Tests may inject a deterministic state provider; production always uses
  // the real single-owner adapter.
  const auth = window.__stTestAuthAdapter || createAuthAdapter();
  const authGate = createAuthGate({ auth });
  configureApiSecurity({
    getCsrfToken: () => auth.csrfToken || null,
    onUnauthorized: (status) => auth.handleUnauthorized?.(status),
  });
  const shell = createShell({ api, state, notify });

  // Cross-feature registry: features get each other through this bag, never
  // by importing another feature module.
  const features = {};

  const catalogPoll = createCatalogPoll({ state, loaders: null });
  const entityCard = { entityImageBlock, cardActions };
  catalogPoll.loaders = {
    loadWorlds: () => features.worlds.loadWorlds(),
    loadCharacters: () => features.characters.loadCharacters(),
  };

  features.settings = createSettings({ api, state, notify, shell, dialogs });
  features.transfer = createTransfer({ api, state, notify, features, dialogs });
  features.worlds = createWorlds({ api, state, notify, catalogPoll, entityCard, features, dialogs });
  features.characters = createCharacters({ api, state, notify, catalogPoll, entityCard, features, dialogs });
  features.home = createHome({ state, notify, router: null, features });
  features.library = createLibrary({ router: null, features });
  features.stories = createStories({ api, state, notify, features, dialogs, entityCard });
  features.storyEditor = createStoryEditor({ api, state, notify, features, dialogs });
  features.bookshelf = createBookshelf({ api, state, notify, features, dialogs });
  features.write = createWrite({ api, state, notify, shell, features, dialogs });
  features.generation = createGeneration({ api, state, notify, shell, features, dialogs });
  features.narration = createNarration({ api, state, notify, shell, features, dialogs });
  features.imagery = createImagery({ api, state, notify, shell, features, dialogs });
  features.audiobook = createAudiobook({ api, state, notify, shell, features, dialogs });
  features.aiDrafts = createAiDrafts({ api, state, notify, features, dialogs });

  // -- router -------------------------------------------------------------------
  // Each boot marks itself live; a superseded boot (a fresh loadScript in
  // tests, or a re-import) must never act on the app again.
  const bootToken = {};
  window.__stLiveBoot = bootToken;
  let lastRoute = null;
  let routeTransitionToken = 0; // stale async gate results must not render
  const SECTION_FOR = {
    home: 'home',
    write: 'write',
    'library-stories': 'library',
    'library-bookshelf': 'library',
    worlds: 'worlds',
    characters: 'characters',
    settings: 'settings',
  };

  // What a permitted route actually paints. Extracted so the gate result is
  // the ONLY entry to rendering.
  function renderRoute(route, previous) {
    // Leaving the writing desk stops its media; stale streams must not
    // narrate into another room.
    if (previous && previous.name === 'write' && route.name !== 'write') {
      features.narration.stopNarration();
    }
    // A true top-level surface change establishes a predictable top
    // position, instantly - but page turns inside a story and Library tab
    // switches stay exactly where they are.
    const section = SECTION_FOR[route.name] || 'home';
    const previousSection = previous ? SECTION_FOR[previous.name] || 'home' : null;
    if (previousSection !== section) window.scrollTo(0, 0);
    shell.showSection(section);
    if (route.name === 'home') features.home.enter();
    if (route.name === 'library-stories' || route.name === 'library-bookshelf') {
      features.library.enter(route);
      if (route.name === 'library-stories') features.stories.loadStories();
    }
    if (route.name === 'settings') {
      features.settings.loadModels().then(features.settings.renderModelList);
      features.settings.loadSpeechModels().then(features.settings.renderNarrationSettings);
    }
    if (route.name === 'worlds') features.worlds.loadWorlds();
    if (route.name === 'characters') features.characters.loadCharacters();
    if (route.name === 'write') features.write.enterFromRoute(route.params);
  }

  const router = createRouter({
    isAlive: () => window.__stLiveBoot === bootToken,
    onRoute(route) {
      const previous = lastRoute;
      lastRoute = route;
      // The auth gate gets the FIRST word and rendering genuinely awaits it.
      // A per-transition token keeps a slow older gate result from rendering
      // after a newer route change - only the newest transition may paint.
      const token = ++routeTransitionToken;
      authGate.canRender().then((allowed) => {
        if (token !== routeTransitionToken) return; // superseded transition
        if (!allowed) {
          // Locked/setup/error: no application surface may render. The
          // branded gate owns the page until a live session exists.
          document.body.classList.add('st-gated');
          for (const el of document.querySelectorAll('.content-section')) el.classList.remove('active');
          return;
        }
        document.body.classList.remove('st-gated');
        renderRoute(route, previous);
      });
    },
    onUnknown(path) {
      notify.showErrorRaw(`That address (${path}) does not lead anywhere in the scriptorium.`);
    },
  });
  features.home.router = router;
  features.library.router = router;
  features.write.router = router;

  // -- shell wiring ------------------------------------------------------------
  document.getElementById('homeBtn').addEventListener('click', () => router.navigate('home'));
  document.getElementById('writeBtn').addEventListener('click', () => router.navigate('write'));
  document.getElementById('libraryBtn').addEventListener('click', () => router.navigate('library-stories'));
  document.getElementById('worldsBtn').addEventListener('click', () => router.navigate('worlds'));
  document.getElementById('charactersBtn').addEventListener('click', () => router.navigate('characters'));
  document.getElementById('settingsBtn').addEventListener('click', () => router.navigate('settings'));

  // -- feature init (order preserves the old escape/priority stack) -------------
  features.write.init(); // burn modal + reading wiring
  features.aiDrafts.init();
  features.narration.init();
  features.imagery.init(); // scene viewer first so Escape dismisses it before the prompt popup
  features.worlds.init(); // entity editors
  features.characters.init();
  features.audiobook.init();
  features.bookshelf.init();
  features.storyEditor.init();
  features.generation.init();
  features.settings.init(); // registers the applySettings re-render hooks...
  features.transfer.init();
  features.home.init();
  features.library.init();

  state.applySettings(); // ...which render fonts/labels on this first apply
  authGate.wireAccountControls();

  let routerStarted = false;
  let protectedActive = false;
  let protectedStart = null;
  let lifecycleToken = 0;

  async function startProtectedApp() {
    if (protectedActive || protectedStart) return protectedStart;
    const token = ++lifecycleToken;
    const run = (async () => {
      shell.initDiskBanner();
      await Promise.all([
        features.worlds.loadWorlds(),
        features.characters.loadCharacters(),
        features.stories.loadStories(),
      ]);
      if (token !== lifecycleToken) return;
      protectedActive = true;
      if (!routerStarted) {
        routerStarted = true;
        router.start();
      } else {
        router.refresh();
      }
    })();
    protectedStart = run;
    try { await run; } finally { if (protectedStart === run) protectedStart = null; }
  }

  function lockProtectedApp() {
    lifecycleToken++;
    protectedStart = null;
    protectedActive = false;
    features.narration.stopNarration();
    features.audiobook.stopAudiobookPolling();
    features.stories.stopCoverPoll();
    catalogPoll.stop();
    shell.stopDiskBanner();
    features.generation.resetForStoryChange();
    dialogs.close(true);
    forceCloseAllModals();
    state.clearPrivateData();
    for (const id of [
      'worldsList', 'charactersList', 'storiesList', 'bookshelfList',
      'homeRecentList', 'storyContent', 'storyAssetsBody', 'storyCastList',
      'storyCastDetail', 'storyReview', 'castList', 'modelList',
    ]) {
      const element = document.getElementById(id);
      if (element) element.textContent = '';
    }
    const direction = document.getElementById('userInput');
    if (direction) direction.value = '';
    for (const formId of [
      'worldForm', 'characterForm', 'storyForm', 'characterEditorForm',
      'worldEditorForm', 'passwordChangeForm',
    ]) {
      document.getElementById(formId)?.reset();
    }
    const privateSelects = {
      currentStory: 'Select or Create a Story',
      storyWorld: 'No world',
      characterWorld: 'No world',
      mcSelect: '— Choose a lead —',
      castCharSelect: '— Choose a character —',
      storyCastAddSelect: '— Choose a character —',
      charEditWorld: 'No world',
    };
    for (const [id, label] of Object.entries(privateSelects)) {
      const select = document.getElementById(id);
      if (!select) continue;
      const option = document.createElement('option');
      option.value = '';
      option.textContent = label;
      select.replaceChildren(option);
    }
    for (const section of document.querySelectorAll('.content-section')) section.classList.remove('active');
  }

  // This is the sole startup boundary: neither catalogue reads nor router
  // rendering begins until status says the session is unlocked.
  authGate.init({ onUnlock: startProtectedApp, onLock: lockProtectedApp });

  return { api, state, notify, shell, features, dialogs, router, auth, authGate };
}

const context = typeof document !== 'undefined' ? initApp() : null;

// Feature facade for the Jest suite (property names mirror the pre-module
// export block; a no-op in the browser, where only the side effect matters).
export const fw = buildFacade(context);

function buildFacade(ctx) {
  if (!ctx) return null;
  const { api, state, notify, shell, features } = ctx;
  const { worlds, characters, stories, storyEditor, bookshelf, write, generation, narration, imagery, audiobook, settings, transfer, aiDrafts } = features;
  const { dialogs, auth, authGate } = ctx;
  return {
    initApp,
    dialogs,
    auth,
    authGate,
    showSection: shell.showSection,
    apiCall: api.apiCall,
    loadWorlds: worlds.loadWorlds,
    loadCharacters: characters.loadCharacters,
    loadStories: stories.loadStories,
    loadStoryPages: write.loadStoryPages,
    refreshStoryAssets: write.refreshStoryAssets,
    uploadArt: write.uploadArt,
    renderWorlds: worlds.renderWorlds,
    renderCharacters: characters.renderCharacters,
    renderStories: stories.renderStories,
    updateWorldSelects: worlds.updateWorldSelects,
    renderCastBuilder: storyEditor.renderCastBuilder,
    addCastMember: storyEditor.addCastMember,
    chooseMainCharacter: storyEditor.chooseMainCharacter,
    storyCast: storyEditor.storyCast,
    updateStorySelect: write.updateStorySelect,
    handleWorldSubmit: worlds.handleWorldSubmit,
    handleCharacterSubmit: characters.handleCharacterSubmit,
    handleStorySubmit: storyEditor.handleStorySubmit,
    handleStorySelection: write.handleStorySelection,
    displayCurrentPage: write.displayCurrentPage,
    navigatePage: write.navigatePage,
    setGenerating: generation.setGenerating,
    generateNextPage: generation.generateNextPage,
    retryLastPage: generation.retryLastPage,
    exportStory: write.exportStory,
    deleteCurrentPage: write.deleteCurrentPage,
    resetStoryReader: write.resetStoryReader,
    openBurnModal: write.openBurnModal,
    closeBurnModal: write.closeBurnModal,
    burnAfterCurrentPage: write.burnAfterCurrentPage,
    setWritingEnabled: write.setWritingEnabled,
    openAiDraft: aiDrafts.openAiDraft,
    closeAiDraft: aiDrafts.closeAiDraft,
    generateAiDraft: aiDrafts.generateAiDraft,
    regenerateAiDraft: aiDrafts.regenerateAiDraft,
    saveAiDraft: aiDrafts.saveAiDraft,
    renderAiDraft: aiDrafts.renderAiDraft,
    showError: notify.showError,
    scribeErrorMessage: notify.scribeErrorMessage,
    maybeStartSpeculative: generation.maybeStartSpeculative,
    restoreSpeculative: generation.restoreSpeculative,
    discardSpeculative: generation.discardSpeculative,
    resetGenerationForStoryChange: generation.resetForStoryChange,
    loadSpeechModels: settings.loadSpeechModels,
    renderNarrationSettings: settings.renderNarrationSettings,
    __lastNarrationAudio: narration.__lastNarrationAudio,
    __setModelsCache: state.__setModelsCache,
    // Scene image prompt + zoomable viewer
    generateImagePrompt: imagery.generateImagePrompt,
    generateSceneImage: imagery.generateSceneImage,
    __sceneModerationState: imagery.__sceneModerationState,
    openSceneViewer: imagery.openSceneViewer,
    closeSceneViewer: imagery.closeSceneViewer,
    saveSceneViewer: imagery.saveSceneViewer,
    addSceneAsPage: imagery.addSceneAsPage,
    // Disk-space banner
    updateDiskBanner,
    checkDiskSpace: shell.checkDiskSpace,
    // Audiobooks + Bookshelf
    openAudiobookModal: audiobook.openAudiobookModal,
    closeAudiobookModal: audiobook.closeAudiobookModal,
    updateAudiobookBanner: audiobook.updateAudiobookBanner,
    refreshAudiobook: audiobook.refreshAudiobook,
    stopAudiobook: audiobook.stopAudiobook,
    loadBookshelf: bookshelf.loadBookshelf,
    openStoryAssets: bookshelf.openStoryAssets,
    closeStoryAssets: bookshelf.closeStoryAssets,
    audiobookEstimate: audiobook.audiobookEstimate,
    audiobookNarratorVerdict: audiobook.audiobookNarratorVerdict,
    markAudiobookSeen: audiobook.markAudiobookSeen,
    __sceneViewerState: imagery.__sceneViewerState,
    // Entity editors
    openCharacterEditor: characters.openCharacterEditor,
    saveCharacterEditor: characters.saveCharacterEditor,
    openWorldEditor: worlds.openWorldEditor,
    saveWorldEditor: worlds.saveWorldEditor,
    // Story cast editor
    openStoryCastEditor: storyEditor.openStoryCastEditor,
    closeStoryCastEditor: storyEditor.closeStoryCastEditor,
    renderStoryCastEditor: storyEditor.renderStoryCastEditor,
    addCastEditorMember: storyEditor.addCastEditorMember,
    saveStoryCastEditor: storyEditor.saveStoryCastEditor,
    __castEditState: storyEditor.__castEditState,
    // Settings + cost ticker
    loadSettings: () => state.settings,
    setSetting: state.setSetting,
    applySettings: state.applySettings,
    updateCostTicker: state.updateCostTicker,
    renderModelList: settings.renderModelList,
    renderFontList: settings.renderFontList,
    STORY_FONTS,
    loadModels: settings.loadModels,
    openDataExport: transfer.openExport,
    openImportReview: transfer.openImportReview,
    reviewImportFile: transfer.reviewFile,
    state: state.state,
    __setStoryState: write.__setStoryState,
    SCRIBE_FLAVOR,
    API_BASE_URL,
  };
}
