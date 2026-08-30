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
  document.body.innerHTML = `
    <nav class="main-nav">
      <button id="homeBtn" class="nav-btn active">Home</button>
      <button id="writeBtn" class="nav-btn">Write</button>
      <button id="libraryBtn" class="nav-btn">Library</button>
      <button id="worldsBtn" class="nav-btn">Worlds</button>
      <button id="charactersBtn" class="nav-btn">Characters</button>
      <button id="settingsBtn" class="nav-btn">Settings</button>
    </nav>
    <div id="diskBanner" class="disk-banner" role="alert" hidden>
      <p id="diskBannerText"></p>
    </div>
    <main class="main-content">
      <section id="homeSection" class="content-section active">
        <div class="hero__actions">
          <button id="heroContinueBtn" class="btn btn-primary" type="button" hidden>Continue</button>
          <button id="heroStartBtn" class="btn btn-primary" type="button" hidden>Create a story</button>
          <button id="heroWriteBtn" class="btn btn-secondary" type="button">Open the writing desk</button>
        </div>
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
          <button id="libraryStoriesTab" class="library-tab" role="tab" aria-selected="true" aria-controls="storiesPanel" type="button">Stories</button>
          <button id="libraryBookshelfTab" class="library-tab" role="tab" aria-selected="false" aria-controls="bookshelfPanel" type="button">Bookshelf</button>
        </div>
        <div id="storiesPanel" role="tabpanel" aria-labelledby="libraryStoriesTab">
        <form id="storyForm">
          <input type="text" id="storyTitle" required>
          <select id="storyWorld"><option value="">No world</option></select>
          <select id="storyTone">
            <option value="fade-to-black">Tasteful</option>
            <option value="romantic">Romantic</option>
            <option value="explicit">Explicit</option>
          </select>
          <div class="character-selection">
            <select id="mcSelect"></select>
            <select id="castCharSelect"></select>
            <select id="castTierSelect">
              <option value="supporting">Supporting</option>
              <option value="background">Background</option>
            </select>
            <input type="text" id="castRelation">
            <button id="castAddBtn" type="button">Add to cast</button>
            <div id="castList" class="cast-list"></div>
          </div>
          <button type="submit">Create Story</button>
        </form>
        <div id="storiesList" class="items-grid"></div>
        </div>
        <div id="bookshelfPanel" role="tabpanel" aria-labelledby="libraryBookshelfTab" hidden>
          <div id="bookshelfList" class="bookshelf-list"></div>
        </div>
      </section>
      <section id="writeSection" class="content-section">
        <select id="currentStory"><option value="">Select or Create a Story</option></select>
        <span id="storyContextMode" class="story-context__mode" aria-live="polite"></span>
        <div id="costTicker" class="cost-ticker" hidden></div>
        <button id="prevPageBtn">← Previous</button>        <span id="pageIndicator">Page 1 of 1</span>
        <button id="nextPageBtn">Next →</button>
        <button id="readAloudBtn" type="button">Read aloud</button>
        <button id="narrationAutoBtn" type="button" aria-pressed="false">Auto-read</button>
        <button id="imagePromptBtn" type="button">Paint scene</button>
        <button id="narrationStopBtn" type="button" hidden>Stop</button>
        <div id="storyContent" class="story-content"></div>
        <div id="pastPageBar" class="past-page-bar" hidden><p></p><button id="deleteAfterBtn" type="button">Delete everything after this page</button></div>
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
      <section id="settingsSection" class="content-section">
        <p id="settingsSaved" class="settings-saved" role="status" aria-live="polite"></p>
        <details class="settings-group" open><summary><h3>Writing AI</h3><span id="writingAiSummary" class="settings-group__summary"></span></summary>
          <p id="currentModel" class="current-model"></p>
          <details class="model-disclosure"><summary>Choose another model</summary>
            <input type="text" id="modelSearch">
            <div id="modelList" class="model-list"></div>
            <button id="modelResetBtn" type="button">Use the server default model</button>
          </details>
          <div id="reasoningBlock" hidden></div>
          <select id="reasoningSelect" hidden><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
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
        <p id="sceneImageCost" class="scene-image-cost" hidden></p>
        <button id="imagePromptGenerateBtn" type="button" class="btn">Generate image</button>
        <button id="imagePromptCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
    <div id="sceneImageViewerModal" class="scene-viewer" hidden>
      <img id="sceneViewerImg" alt="The painted scene">
      <button id="sceneViewerAddPageBtn" type="button" class="ghost-btn">Add as page</button>
      <button id="sceneViewerSaveBtn" type="button" class="ghost-btn">Save</button>
      <button id="sceneViewerCloseBtn" type="button" class="ghost-btn">Close</button>
    </div>
    <div id="characterEditorModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="characterEditorTitle">
        <h2 id="characterEditorTitle">Edit character</h2>
        <form id="characterEditorForm">
          <input type="text" id="charEditName">
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
          <h2 id="storyCastTitle">Story cast</h2>
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

// opts.hash: boot the app at that hash (deep-link); default is a clean '#/home'.
async function loadScript(opts = {}) {
  buildDom();
  // A fresh app boot: the hash is whatever the caller asked for. Stale
  // routers from earlier loads are dead (boot-token liveness), so no
  // replaceState event games are needed.
  const wanted = opts.hash === undefined ? '' : opts.hash;
  const current = window.location.hash || '';
  if (current !== wanted) {
    window.history.replaceState(null, '', window.location.href.split('#')[0] + wanted);
  }
  loadCounter += 1;
  const mod = await import(`../app/bootstrap.js?run=${loadCounter}`);
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
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

export { buildDom, loadScript, mockFetch, jsonResponse, dialogAction };

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

