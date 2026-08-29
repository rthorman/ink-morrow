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
      <button id="settingsBtn" class="nav-btn">Settings</button>
    </nav>
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
        <button id="narrationAutoBtn" type="button">Auto</button>
        <button id="narrationStopBtn" type="button" hidden>Stop</button>
        <div id="storyContent" class="story-content"></div>
        <div id="pastPageBar" class="past-page-bar" hidden><p></p><button id="deleteAfterBtn" type="button">Delete everything after this page</button></div>
        <textarea id="userInput"></textarea>
        <button id="generateBtn">Generate Page</button>
        <button id="retryBtn">Retry Page</button>
        <button id="exportBtn">Export .epub</button>
        <button id="deletePageBtn">Delete Page</button>
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