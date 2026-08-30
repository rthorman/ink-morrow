'use strict';

// Builds a DOM matching index.html and loads a fresh copy of script.js.
// Returns the module (initApp has already run, since readyState is 'complete'
// in jsdom at require time).

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
    <div id="ageGate" class="age-gate" hidden>
      <p>This tool is for adult fiction writing.
        <button id="ageGateAccept" type="button">I am 18 or older — Enter</button>
      </p>
    </div>
    <nav class="main-nav">
      <button id="worldsBtn" class="nav-btn active">Worlds</button>
      <button id="charactersBtn" class="nav-btn">Characters</button>
      <button id="storiesBtn" class="nav-btn">Stories</button>
      <button id="writeBtn" class="nav-btn">Write</button>
      <button id="bookshelfBtn" class="nav-btn">Bookshelf</button>
      <button id="settingsBtn" class="nav-btn">Settings</button>
    </nav>
    <div id="diskBanner" class="disk-banner" role="alert" hidden>
      <p id="diskBannerText"></p>
    </div>
    <main class="main-content">
      <section id="worldsSection" class="content-section active">
        <form id="worldForm">
          <input type="text" id="worldName" required>
          <textarea id="worldDescription"></textarea>
          <input type="text" id="worldGenre">
          <input type="text" id="worldSetting">
          <button id="worldAiBtn" type="button">Flesh out with AI</button>
          <button type="submit">Create World</button>
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
          <button id="characterAiBtn" type="button">Flesh out with AI</button>
          <button type="submit">Create Character</button>
        </form>
        <div id="charactersList" class="items-grid"></div>
      </section>
      <section id="storiesSection" class="content-section">
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
      </section>
      <section id="writeSection" class="content-section">
        <select id="currentStory"><option value="">Select or Create a Story</option></select>
        <div id="costTicker" class="cost-ticker" hidden></div>
        <button id="prevPageBtn">← Previous</button>        <span id="pageIndicator">Page 1 of 1</span>
        <button id="nextPageBtn">Next →</button>
        <button id="readAloudBtn" type="button">Read aloud</button>
        <button id="narrationAutoBtn" type="button" aria-pressed="false" aria-label="Autoplay narration">▶</button>
        <button id="imagePromptBtn" type="button">Scene image</button>
        <button id="narrationStopBtn" type="button" aria-label="Stop playback" hidden>■</button>
        <div id="storyContent" class="story-content"></div>
        <div id="pastPageBar" class="past-page-bar" hidden><p></p><button id="deleteAfterBtn" type="button">Delete everything after this page</button></div>
        <div id="audiobookBanner" class="audiobook-banner" role="status" hidden>
          <p id="audiobookBannerText" class="audiobook-banner__text"></p>
          <div id="audiobookProgress" class="progress-track" hidden><div id="audiobookProgressFill" class="progress-fill"></div></div>
          <div id="audiobookBannerActions" class="audiobook-banner__actions" hidden></div>
        </div>
        <textarea id="userInput"></textarea>
        <button id="generateBtn">Generate Page</button>
        <button id="retryBtn">Retry Page</button>
        <button id="exportBtn">Export .epub</button>
        <button id="audiobookBtn" type="button">Audiobook</button>
        <button id="deletePageBtn">Delete Page</button>
      </section>
      <section id="bookshelfSection" class="content-section">
        <h2>Bookshelf</h2>
        <div id="bookshelfList" class="bookshelf-list"></div>
      </section>
      <section id="settingsSection" class="content-section">
        <p id="currentModel" class="current-model"></p>
        <input type="text" id="modelSearch">
        <div id="modelList" class="model-list"></div>
        <div id="fontList" class="font-list"></div>
        <select id="fontSizeSelect"><option value="16">Small</option><option value="18">Medium</option><option value="20">Large</option><option value="22">Extra large</option></select>
        <button id="modelResetBtn" type="button">Use the server default model</button>
        <input type="number" id="wordsPerPageInput" value="400">
        <input type="checkbox" id="scriptoriumBgToggle">
        <input type="checkbox" id="costTickerToggle" checked>
        <select id="narrationModelSelect"></select>
        <select id="reasoningSelect" hidden><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        <div id="reasoningBlock" hidden></div>
        <select id="narrationVoiceSelect"></select>
      </section>
    </main>
    <div id="burnModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="burnTitle" aria-describedby="burnBody">
        <h2 id="burnTitle">Burn the following pages?</h2>
        <p id="burnBody" class="burn-modal__body"></p>
        <input type="range" id="burnSlider" min="0" max="100" step="1" value="0">
        <button id="burnCancelBtn" type="button" class="btn btn-secondary">Keep them</button>
      </div>
    </div>
    <div id="audiobookModal" class="burn-modal" hidden>
      <div class="burn-modal__panel" role="dialog" aria-modal="true" aria-labelledby="audiobookTitle" aria-describedby="audiobookModalBody">
        <h2 id="audiobookTitle">Bind the tale into an audiobook</h2>
        <div id="audiobookModalBody" class="burn-modal__body"></div>
        <p id="audiobookExisting" class="audiobook-existing" hidden></p>
        <div class="burn-slider">
          <label class="sr-only" for="audiobookSlider">Slide all the way right to start the reading</label>
          <input type="range" id="audiobookSlider" min="0" max="100" step="1" value="0">
          <span class="burn-slider__hint" aria-hidden="true">slide to read →</span>
        </div>
        <div class="burn-modal__actions">
          <button id="audiobookCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
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
        <h2 id="storyCastTitle">Story cast</h2>
        <p class="burn-modal__body">Add or remove members while the tale runs.</p>
        <div id="storyCastList" class="cast-edit-list"></div>
        <div class="cast-edit-add">
          <select id="storyCastAddSelect"></select>
          <select id="storyCastAddRole"><option value="supporting">Supporting</option><option value="background">Background</option></select>
          <input type="text" id="storyCastAddRelation" maxlength="2000">
          <button id="storyCastAddBtn" type="button" class="btn">Add to cast</button>
        </div>
        <p id="storyCastNote" class="cast-edit-note" hidden></p>
        <div class="burn-modal__actions">
          <button id="storyCastSaveBtn" type="button" class="btn">Save cast</button>
          <button id="storyCastCancelBtn" type="button" class="btn btn-secondary">Cancel</button>
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

function loadScript() {
  buildDom();
  let module;
  jest.isolateModules(() => {
    module = require('../script.js');
  });
  return module;
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

module.exports = { buildDom, loadScript, mockFetch, jsonResponse };