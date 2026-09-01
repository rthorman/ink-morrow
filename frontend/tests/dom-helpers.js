// Builds a DOM matching index.html and loads a fresh copy of the app's
// bootstrap module. Each loadScript() call busts the ESM cache with a query
// string, giving the new instance fresh closure state - the equivalent of
// the old jest.isolateModules + require.

import { jest } from '@jest/globals';

function installUrlStub() {
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = () => 'blob:narration-mock';
    window.URL.revokeObjectURL = () => {};
  }
}

function installAudioStub() {
  if (typeof window.Audio === 'function') return;
  window.Audio = class Audio extends EventTarget {
    constructor() {
      super();
      this.src = '';
      this.paused = true;
    }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
  };
}

function buildDom() {
  installAudioStub();
  installUrlStub();
  document.body.className = '';
  document.body.innerHTML = `
    <div id="authRoot" hidden></div>
    <select id="shellManuscriptSelect" aria-label="Choose a manuscript" disabled><option value="">No manuscripts yet</option></select>
    <nav class="main-nav" aria-label="Global">
      <button id="homeBtn" class="nav-btn active">Library</button>
      <button id="libraryBtn" class="nav-btn">Manuscripts</button>
      <button id="worldsBtn" class="nav-btn">World templates</button>
      <button id="charactersBtn" class="nav-btn">Character templates</button>
      <button id="settingsBtn" class="nav-btn">Settings</button>
      <button id="lockBtn" class="nav-btn">Lock</button>
    </nav>
    <nav id="workspaceNav" class="workspace-nav" aria-label="Manuscript workspace">
      <button id="writeBtn" class="workspace-nav__btn">Desk</button>
      <button id="chronicleBtn" class="workspace-nav__btn" disabled>Chronicle</button>
      <button id="codexBtn" class="workspace-nav__btn" disabled>Codex</button>
      <button id="galleryBtn" class="workspace-nav__btn" disabled>Gallery</button>
      <button id="gateBtn" class="workspace-nav__btn" disabled>Gate</button>
    </nav>
    <div id="diskBanner" class="disk-banner" role="alert" hidden>
      <p id="diskBannerText"></p>
    </div>
    <main class="main-content">
      <section id="homeSection" class="content-section active">
        <div class="hero__actions">
          <button id="heroContinueBtn" class="btn btn-primary" type="button" hidden>Continue</button>
          <button id="heroStartBtn" class="btn btn-primary" type="button" hidden>Create a story</button>
          <button id="heroImportBtn" class="btn btn-secondary" type="button">Import prose</button>
          <button id="heroWriteBtn" class="btn btn-secondary" type="button">Open the writing desk</button>
        </div>
        <section id="manuscriptStartSheet" hidden>
          <button id="manuscriptStartClose" type="button">Keep draft &amp; close</button>
          <form id="manuscriptStartForm">
            <input id="manuscriptStartName" type="text">
            <button id="startPathManual" data-start-path="manual" type="button" role="radio">Manual</button>
            <button id="startPathSeed" data-start-path="seed" type="button" role="radio">Seed</button>
            <button id="startPathImport" data-start-path="import" type="button" role="radio">Import</button>
            <div data-start-panel="manual"><textarea id="startManualOpening"></textarea></div>
            <div data-start-panel="seed" hidden><textarea id="startSeedPremise"></textarea><textarea id="startSeedDirection"></textarea></div>
            <div data-start-panel="import" hidden>
              <input id="startImportFile" type="file">
              <textarea id="startImportProse"></textarea>
              <select id="startImportMode"><option value="headings">Headings</option><option value="single">Single</option></select>
            </div>
            <div id="manuscriptStartHintWrap"><p id="manuscriptStartHint"></p><button id="manuscriptStartHintDismiss" type="button">Dismiss hint</button></div>
            <details id="startFoundations">
              <select id="startWorld"><option value="">No world</option></select>
              <div class="character-selection">
                <button type="button" id="castModeCentered" role="radio" aria-checked="false">Centered</button>
                <button type="button" id="castModeEnsemble" role="radio" aria-checked="true">Ensemble</button>
                <p id="castModeHint"></p>
                <div id="castLeadRow" hidden><select id="mcSelect"></select></div>
                <select id="castCharSelect"></select>
                <select id="castTierSelect"><option value="supporting">Supporting</option><option value="background">Background</option></select>
                <label id="castRelationLabel"></label>
                <input type="text" id="castRelation">
                <button id="castAddBtn" type="button">Add to cast</button>
                <div id="castList" class="cast-list"></div>
                <div id="storyReview"></div>
              </div>
              <input id="startNarrativeVoice" type="text">
              <input id="startPointOfView" type="text">
              <input id="startTense" type="text">
              <textarea id="startConstraints"></textarea>
              <button id="startDraftFoundationsBtn" type="button">Draft Foundations</button>
              <div id="startFoundationDraft" hidden></div>
              <div id="startProviderSetup" hidden>
                <input id="startProviderKey" type="password">
                <button id="startProviderSave" type="button">Use for session</button>
              </div>
            </details>
            <select id="manuscriptStartTone"><option value="fade-to-black">Tasteful</option><option value="romantic">Romantic</option><option value="explicit">Explicit</option></select>
            <p id="manuscriptStartStatus"></p>
            <button id="manuscriptStartCancel" type="button">Keep draft &amp; close</button>
            <button id="manuscriptStartSubmit" type="submit">Create manuscript</button>
            <button id="manuscriptStartWithCover" type="submit">Create &amp; paint cover</button>
          </form>
        </section>
        <div id="homeRecent" class="home-recent" hidden>
          <h2>Recent manuscripts</h2>
          <div id="homeRecentList" class="items-grid"></div>
        </div>
        <div id="homePath" class="home-path"><h2>Your scriptorium</h2></div>
      </section>
      <section id="worldsSection" class="content-section">
        <form id="worldForm">
          <input type="text" id="worldName" required>
          <textarea id="worldDescription"></textarea>
          <input type="text" id="worldGenre">
          <input type="text" id="worldSetting">
          <button type="submit" class="btn btn-primary">Create and paint (≈$0.04)</button>
          <button id="worldNoImageBtn" type="submit" class="btn btn-secondary">Create without image</button>
          <button id="worldAiBtn" type="button" class="btn btn-secondary">Flesh out with AI</button>
        </form>
        <div id="worldsList" class="items-grid"></div>
      </section>
      <section id="charactersSection" class="content-section">
        <form id="characterForm">
          <input type="text" id="characterName" required>
          <textarea id="characterDescription"></textarea>
          <textarea id="characterPersonality"></textarea>
          <textarea id="characterAppearance"></textarea>
          <textarea id="characterBackground"></textarea>
          <select id="characterWorld"><option value="">No world</option></select>
          <button type="submit" class="btn btn-primary">Create and paint (≈$0.06)</button>
          <button id="characterNoImageBtn" type="submit" class="btn btn-secondary">Create without image</button>
          <button id="characterAiBtn" type="button" class="btn btn-secondary">Flesh out with AI</button>
        </form>
        <div id="charactersList" class="items-grid"></div>
      </section>
      <section id="librarySection" class="content-section">
        <div class="library-tabs" role="tablist" aria-label="Library">
          <button id="libraryStoriesTab" class="library-tab" role="tab" aria-selected="true" aria-controls="storiesPanel" type="button">Manuscripts</button>
          <button id="libraryBookshelfTab" class="library-tab" role="tab" aria-selected="false" aria-controls="bookshelfPanel" type="button">Bookshelf</button>
        </div>
        <div id="storiesPanel" role="tabpanel" aria-labelledby="libraryStoriesTab">
        <button id="libraryBeginBtn" type="button">Begin a manuscript</button>
        <div id="storiesList" class="items-grid"></div>
        </div>
        <div id="bookshelfPanel" role="tabpanel" aria-labelledby="libraryBookshelfTab" hidden>
          <div id="bookshelfList" class="bookshelf-list"></div>
        </div>
      </section>
      <section id="writeSection" class="content-section">
        <button id="storyNewBtn" type="button">New manuscript</button>
        <span id="storyContextMode" class="story-context__mode" aria-live="polite"></span>
        <div id="costTicker" class="cost-ticker" hidden></div>
        <button id="prevPageBtn">← Previous</button>        <span id="pageIndicator">Page 1 of 1</span>
        <button id="nextPageBtn">Next →</button>
        <button id="readAloudBtn" type="button">Read aloud</button>
        <button id="narrationAutoBtn" type="button" aria-pressed="false">Auto-read</button>
        <button id="imagePromptBtn" type="button">Paint scene</button>
        <button id="deskGalleryBtn" type="button">Open Gallery</button>
        <button id="narrationStopBtn" type="button" hidden>Stop</button>
        <div id="storyContent" class="story-content"></div>
        <div id="deskPageState" hidden><button id="deskPageEditBtn" type="button">Edit active page</button><p id="deskPageSaveState" role="status"></p></div>
        <section id="deskPageEditor" hidden><h3 id="deskPageEditorTitle"></h3><p id="deskPageEditorNotice"></p><textarea id="deskPageEditorText"></textarea><button id="deskPageSaveNow" type="button">Save now</button><button id="deskPageReloadLatest" type="button" hidden>Load latest page</button><button id="deskPageEditorClose" type="button">Close editor</button></section>
        <div id="pastPageBar" class="past-page-bar" hidden><p></p><button id="deleteAfterBtn" type="button">Return story to this page</button></div>
        <div id="deskRecoveryBanner" hidden><p id="deskRecoveryText"></p><button id="deskRecoveryUndo"></button></div>
        <div id="audiobookBanner" class="audiobook-banner" role="status" hidden>
          <p id="audiobookBannerText" class="audiobook-banner__text"></p>
          <div id="audiobookProgress" class="progress-track" hidden><div id="audiobookProgressFill" class="progress-fill"></div></div>
          <div id="audiobookBannerActions" class="audiobook-banner__actions" hidden></div>
        </div>
        <p id="preparedNote" class="prepared-note" hidden></p>
        <textarea id="userInput"></textarea>
        <button id="generateBtn">Write next page</button>
        <button id="retryBtn">Rewrite last page</button>
        <button id="exportBtn">Export .epub</button>
        <button id="audiobookBtn" type="button">Audiobook</button>
        <button id="deletePageBtn">Delete Page</button>
      </section>
      <section id="chronicleSection" class="content-section">
        <span data-workspace-story></span><p id="chronicleStatus"></p><div id="chronicleSummary"></div>
        <input id="chroniclePageJump" type="number"><button id="chroniclePageJumpBtn">Find page</button>
        <button id="chronicleAddChapter">Begin chapter</button><button id="chronicleAddVolume">Begin volume</button>
        <button class="workspace-back-to-desk">Return to Desk</button>
        <div id="chronicleOutline" role="tree"></div><div id="chronicleRecoveries"></div>
      </section>
      <section id="codexSection" class="content-section">
        <span data-workspace-story></span><p id="codexStatus"></p>
        <button id="codexFoundationsTab" role="tab" aria-selected="true">Foundations</button>
        <button id="codexCanonTab" role="tab" aria-selected="false">Remembered canon</button>
        <button id="codexCorrectionsTab" role="tab" aria-selected="false">Author corrections</button>
        <button class="workspace-back-to-desk">Return to Desk</button>
        <section id="codexFoundationsPanel"><div id="codexFoundations"></div><div id="codexTemplateUpdates"></div></section>
        <section id="codexCanonPanel" hidden><div id="codexCoverage"></div><input id="codexSearch"><div id="codexCanon"></div></section>
        <section id="codexCorrectionsPanel" hidden><div id="codexCorrectionActions"></div><div id="codexCorrections"></div><div id="codexIssues"></div><div id="codexImpactSummary"></div></section>
      </section>
      <section id="gallerySection" class="content-section"><span data-workspace-story></span><p id="galleryStatus"></p>
        <button id="galleryPaintBtn" class="btn btn-primary">Paint with AI</button><button id="galleryUploadBtn" class="btn btn-primary">Upload an image</button>
        <input id="galleryUploadInput" type="file"><button class="workspace-back-to-desk">Return to Desk</button>
        <div id="galleryReferenceSummary"></div><div id="galleryGrid"></div>
      </section>
      <section id="gateSection" class="content-section"><span data-workspace-story></span>
        <button id="gateBackupBtn">Review project backup</button>
        <form id="gatePublicationForm"><input id="gatePublicationTitle"><input id="gatePublicationAuthor"><input id="gatePublicationLanguage" value="en">
          <textarea id="gateFrontMatter"></textarea><textarea id="gateBackMatter"></textarea>
          <div id="gateFormatList"><input type="checkbox" name="publication-format" value="epub" checked><input type="checkbox" name="publication-format" value="pdf" checked></div>
          <div id="gateArtList"></div><button id="gateReviewPublicationBtn" type="submit">Review publication</button>
        </form>
        <select id="gateShareExpiry"><option value="604800" selected>7 days</option><option value="">Never</option></select>
        <button id="gateCreateShareBtn" disabled>Share reviewed snapshot</button><p id="gateShareHint"></p>
        <div id="gateShareReveal" hidden><input id="gateShareUrl"><button id="gateCopyShareBtn">Copy link</button></div>
        <div id="gateShareList"></div>
        <section id="gateJob" hidden><p id="gateJobStatus"></p><progress id="gateJobProgress"></progress><div id="gateJobDownloads"></div><button id="gateCancelJobBtn">Cancel</button><button id="gateRetryJobBtn" hidden>Retry</button></section>
        <button class="workspace-back-to-desk">Return to Desk</button>
      </section>
      <section id="settingsSection" class="content-section">
        <p id="settingsSaved" class="settings-saved" role="status" aria-live="polite"></p>
        <details class="settings-group" open><summary><h3>Writing AI</h3><span id="writingAiSummary" class="settings-group__summary"></span></summary>
          <p id="currentModel" class="current-model"></p>
          <details class="model-disclosure"><summary>Choose another model</summary>
            <input type="text" id="modelSearch">
            <div id="modelList" class="model-list"></div>
            <button id="modelResetBtn" type="button">Use the server default model</button>
          </details>
          <div id="reasoningBlock" hidden><select id="reasoningSelect"></select></div>
          <input type="number" id="wordsPerPageInput" value="400">
        </details>
        <details class="settings-group" open><summary><h3>Narration</h3><span id="narrationSummary" class="settings-group__summary"></span></summary>
          <select id="narrationModelSelect"></select>
          <select id="narrationVoiceSelect"></select>
        </details>
        <details class="settings-group" open><summary><h3>Reading appearance</h3><span id="readingSummary" class="settings-group__summary"></span></summary>
          <div id="fontList" class="font-list"></div>
          <select id="fontSizeSelect"><option value="16">Small</option><option value="18">Medium</option><option value="20">Large</option><option value="22">Extra large</option></select>
          <input type="checkbox" id="scriptoriumBgToggle">
        </details>
        <details class="settings-group" open><summary><h3>Costs &amp; storage</h3></summary>
          <input type="checkbox" id="costTickerToggle" checked>
        </details>
        <details class="settings-group"><summary><h3>Data &amp; backups</h3></summary>
          <button id="dataExportBtn" type="button">Export or back up…</button>
          <button id="dataImportBtn" type="button">Import or restore…</button>
          <input id="dataImportFile" type="file">
          <p id="dataTransferStatus" role="status"></p>
        </details>
      </section>
    </main>
    <div id="audiobookModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="audiobookTitle" aria-describedby="audiobookModalBody">
        <h2 id="audiobookTitle">Bind the tale into an audiobook</h2>
        <div id="audiobookModalBody" class="burn-modal__body"></div>
        <p id="audiobookExisting" class="audiobook-existing" hidden></p>
        <div class="burn-modal__actions">
          <button id="audiobookCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
          <button id="audiobookStartBtn" type="button" class="btn btn-primary">Create audiobook</button>
        </div>
      </div>
    </div>
    <div id="imagePromptModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="imagePromptTitle" aria-describedby="imagePromptHint">
        <h2 id="imagePromptTitle">Scene image prompt</h2>
        <p id="imagePromptHint" class="burn-modal__body"></p>
        <textarea id="imagePromptText" rows="10"></textarea>
        <select id="imageQualitySelect"><option value="low_1k">1K · low</option><option value="medium_2k">2K · medium</option></select>
        <p id="imageRefusalNotice" class="image-refusal-notice" role="status" aria-live="polite" hidden></p>
        <div id="imageReferenceDropOption" hidden>
          <label><input id="imagePromptDropReferences" type="checkbox">Retry without identity references</label>
          <p>Originals stay unchanged.</p>
        </div>
        <p id="sceneImageCost" class="scene-image-cost" hidden></p>
        <button id="imagePromptGenerateBtn" type="button" class="btn">Generate image</button>
        <button id="imagePromptCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
    <div id="storyAssetsModal" class="burn-modal" hidden>
      <div class="burn-modal__panel story-assets-panel" role="dialog" aria-modal="true" aria-labelledby="storyAssetsTitle">
        <h2 id="storyAssetsTitle">Manuscript assets</h2>
        <p id="storyAssetsTotal"></p>
        <div id="storyAssetsBody"></div>
        <button id="storyAssetsWriteBtn" type="button">Open writing desk</button>
        <button id="storyAssetsCastBtn" type="button">Edit cast</button>
        <button id="storyAssetsExportBtn" type="button">Export archive…</button>
        <button id="storyAssetsCloseBtn" type="button">Close</button>
      </div>
    </div>
    <div id="sceneImageViewerModal" class="scene-viewer" hidden>
      <img id="sceneViewerImg" alt="The painted scene">
      <button id="sceneViewerAddPageBtn" type="button" class="ghost-btn">Place after page</button>
      <button id="sceneViewerGalleryBtn" type="button" class="ghost-btn">Save to Gallery</button>
      <button id="sceneViewerSaveBtn" type="button" class="ghost-btn">Save</button>
      <button id="sceneViewerCloseBtn" type="button" class="ghost-btn">Close</button>
    </div>
    <div id="characterEditorModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="characterEditorTitle">
        <h2 id="characterEditorTitle">Edit character</h2>
        <form id="characterEditorForm">
          <input type="text" id="charEditName">
          <select id="charEditWorld"><option value="">No world (free-roaming character)</option></select>
          <textarea id="charEditDescription"></textarea>
          <textarea id="charEditPersonality"></textarea>
          <textarea id="charEditAppearance"></textarea>
          <textarea id="charEditBackground"></textarea>
          <textarea id="charEditImagePrompt"></textarea>
        </form>
        <button id="charEditSaveBtn" type="submit" form="characterEditorForm">Save</button>
        <button id="charEditRedoImageBtn" type="button">Save &amp; redo image</button>
        <button id="charEditCancelBtn" type="button">Cancel</button>
      </div>
    </div>
    <div id="worldEditorModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="worldEditorTitle">
        <h2 id="worldEditorTitle">Edit world</h2>
        <form id="worldEditorForm">
          <input type="text" id="worldEditName">
          <textarea id="worldEditDescription"></textarea>
          <input type="text" id="worldEditGenre">
          <input type="text" id="worldEditSetting">
          <textarea id="worldEditLore"></textarea>
          <textarea id="worldEditImagePrompt"></textarea>
        </form>
        <button id="worldEditSaveBtn" type="submit" form="worldEditorForm">Save</button>
        <button id="worldEditRedoImageBtn" type="button">Save &amp; redo image</button>
        <button id="worldEditCancelBtn" type="button">Cancel</button>
      </div>
    </div>
    <div id="storyCastModal" class="burn-modal" hidden>
      <div class="burn-modal__panel draft-panel editor-panel cast-panel" role="dialog" aria-modal="true" aria-labelledby="storyCastTitle">
        <div class="cast-edit__head">
          <h2 id="storyCastTitle">Manuscript cast</h2>
          <p id="storyCastMode" class="cast-edit__mode"></p>
          <p id="storyCastStatus" class="cast-edit__status" role="status"></p>
        </div>
        <div class="cast-edit__body">
          <div class="cast-edit__roster">
            <div id="storyCastList" class="cast-edit-list" role="list"></div>
            <div class="cast-edit-add">
              <select id="storyCastAddSelect"></select>
              <select id="storyCastAddRole"><option value="supporting">Supporting</option><option value="background">Background</option><option value="mc">Lead</option></select>
              <input type="text" id="storyCastAddRelation" maxlength="2000" placeholder="starting connection…">
              <button id="storyCastAddBtn" type="button" class="btn">Add to cast</button>
            </div>
          </div>
          <div id="storyCastDetail" class="cast-edit__detail"></div>
        </div>
        <p id="storyCastNote" class="cast-edit-note" hidden></p>
        <div class="burn-modal__actions">
          <button id="storyCastSaveBtn" type="button" class="btn">Save cast</button>
          <button id="storyCastCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
    </div>
    <div id="aiDraftModal" class="burn-modal" hidden>
      <div class="burn-modal__panel draft-panel" role="dialog" aria-modal="true" aria-labelledby="aiDraftTitle">
        <h2 id="aiDraftTitle">The scribe offers a draft</h2>
        <div id="aiDraftBody"></div>
      </div>
    </div>
    <p id="scribeStatus" class="scribe-status">The scribe waits, quill at the ready…</p>
  `;
}

let loadCounter = 0;
const PAID_CONSENT_KEY = 'im-paid-consent-v1';

// opts.hash: boot the app at that hash (deep-link); default is a clean '#/library'.
async function loadScript(opts = {}) {
  if (!opts.preservePaidConsent) window.localStorage.removeItem(PAID_CONSENT_KEY);
  buildDom();
  // A fresh app boot: the hash is whatever the caller asked for. Stale
  // routers from earlier loads are dead (boot-token liveness), so no
  // replaceState event games are needed.
  const wanted = opts.hash === undefined ? '' : opts.hash;
  const current = window.location.hash || '';
  if (current !== wanted) {
    window.history.replaceState(null, '', window.location.href.split('#')[0] + wanted);
  }
  if (window.__imTestAuthAdapter?.__autoTestAdapter) delete window.__imTestAuthAdapter;
  if (!window.__imTestAuthAdapter && opts.realAuth !== true) {
    const listeners = new Set();
    let currentAuth = { state: 'unlocked', csrf_token: 'jest-csrf-token' };
    window.__imTestAuthAdapter = {
      __autoTestAdapter: true,
      mode: 'test-unlocked',
      status: () => Promise.resolve({ ...currentAuth }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      handleUnauthorized(status) {
        currentAuth = { ...status };
        for (const listener of listeners) listener({ ...currentAuth });
      },
      get csrfToken() { return currentAuth.csrf_token || null; },
    };
  }
  loadCounter += 1;
  const mod = await import(`../app/bootstrap.js?run=${loadCounter}`);
  // Bootstrap now waits for authentication before its initial catalogue
  // reads/router dispatch. Deterministic test adapters resolve immediately;
  // let that protected startup boundary settle before a test mutates state.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mod.fw;
}

// Deterministic fake fetch helper: pass an array of {match, response} handlers
function mockFetch(handlers = [], defaultResponse = { ok: true, status: 200, json: () => Promise.resolve({}) }) {
  global.fetch = jest.fn((url, options) => {
    for (const handler of handlers) {
      if (typeof handler.match === 'function' ? handler.match(url, options) : url.includes(handler.match)) {
        return Promise.resolve(handler.response);
      }
    }
    return Promise.resolve(defaultResponse);
  });
  return global.fetch;
}

function jsonResponse(status, body) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone: () => response,
  };
  return response;
}

// The shared consent gate covers every paid action. Tests click through its
// first review with paidReview('confirm') / paidReview('cancel'); after an
// accepted review, confirm observes the deliberate no-dialog fast path.
async function paidReview(action = 'confirm') {
  for (let i = 0; i < 200; i++) {
    const dlg = document.querySelector('.dialog-manager');
    if (dlg && !dlg.hidden) {
      const btn = dlg.querySelector(
        `.dialog-manager__actions .btn-${action === 'confirm' ? 'primary' : 'secondary'}`
      );
      if (btn) {
        btn.click();
        await new Promise((r) => setTimeout(r, 0));
        return true;
      }
    }
    // Once the first confirmation has been accepted, paid reviews are
    // deliberately bypassed. Treat that as a successful confirm helper;
    // a requested cancel must fail loudly so stale tests cannot hide it.
    if (window.localStorage.getItem(PAID_CONSENT_KEY) === '1') {
      await new Promise((r) => setTimeout(r, 0));
      return action === 'confirm';
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

export { buildDom, loadScript, mockFetch, jsonResponse, dialogAction, paidReview };

// Drives the shared dialog manager: waits a tick for the dialog to open,
// clicks the action button with the given label, waits for the flow to settle.
async function dialogAction(label) {
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector('.dialog-manager');
  const btn = dlg && [...dlg.querySelectorAll('button')].find((b) => b.textContent === label);
  if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 0));
  return Boolean(btn);
}
