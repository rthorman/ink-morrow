'use strict';

// ScribeTribe Frontend
// Same-origin API (backend serves this directory), so relative /api works
// everywhere - localhost, LAN, whatever host you browse from.

const API_BASE_URL = '/api';

const SCRIBE_IDLE = 'The scribe waits, quill at the ready…';
const SCRIBE_FLAVOR = [
  'The quill dips into shadow-ink…',
  'Ink remembers. Give it a moment.',
  'Candlelight steadies over the half-written line…',
  'The scribe murmurs the tale back to herself…',
  'Somewhere in the manuscript, a claw sharpens…',
  'Her tail flicks — the story is close now.',
];
const SCRIBE_DONE = 'The page is complete.';
const SCRIBE_ERROR = 'The scribe looks up, troubled — the ink has gone feral.';

// ---------------------------------------------------------------------------
// Settings (persisted in localStorage)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'st-settings';
const DEFAULT_SETTINGS = Object.freeze({
  model: null,
  scriptoriumBg: false,
  costTicker: true,
  storyFont: 'literata',
  wordsPerPage: 400,
  narrationModel: null,
  narrationVoice: null,
  reasoningEffort: null,
  storyFontSize: 18,
});
const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 24;
const WORDS_MIN = 50;
const WORDS_MAX = 2000;

// Typeface presets for the story reading/writing window.
const STORY_FONTS = {
  literata: { label: 'Literata', stack: 'Literata, Charter, Georgia, serif' },
  cormorant: { label: 'Cormorant Garamond', stack: '"Cormorant Garamond", Georgia, serif' },
  georgia: { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  inter: { label: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  mono: { label: 'IBM Plex Mono', stack: '"IBM Plex Mono", ui-monospace, monospace' },
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // private mode / corrupt value - fall back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

let settings = loadSettings();
let modelsCache = null;
let sessionCost = 0; // USD spent since page load
let storyCostBase = 0; // story total as last known from the server
let storyCostExtra = 0; // costs added this session for the current story

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode - settings live for this session only
  }
}

function setSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) return;
  if (key === 'storyFontSize') {
    const px = parseInt(value, 10);
    if (!Number.isFinite(px)) return;
    value = Math.min(Math.max(px, FONT_SIZE_MIN), FONT_SIZE_MAX);
  }
  if (key === 'wordsPerPage') {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    value = Math.min(Math.max(n, WORDS_MIN), WORDS_MAX);
  }
  if (settings[key] === value) return; // no change: nothing to apply or persist
  settings[key] = value;
  saveSettings();
  applySettings();
}

function applySettings() {
  const write = document.getElementById('writeSection');
  if (write) write.classList.toggle('scriptorium-bg', Boolean(settings.scriptoriumBg));
  const bgToggle = document.getElementById('scriptoriumBgToggle');
  if (bgToggle) bgToggle.checked = Boolean(settings.scriptoriumBg);
  const tickerToggle = document.getElementById('costTickerToggle');
  if (tickerToggle) tickerToggle.checked = Boolean(settings.costTicker);
  const font = STORY_FONTS[settings.storyFont] || STORY_FONTS.literata;
  document.documentElement.style.setProperty('--st-prose-family', font.stack);
  const fontSize = Math.min(Math.max(parseInt(settings.storyFontSize, 10) || 18, FONT_SIZE_MIN), FONT_SIZE_MAX);
  document.documentElement.style.setProperty('--st-prose-size', fontSize + 'px');
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  if (fontSizeSelect) fontSizeSelect.value = String(fontSize);
  const wordsInput = document.getElementById('wordsPerPageInput');
  if (wordsInput) wordsInput.value = String(settings.wordsPerPage);
  if (speechModelsCache) renderNarrationSettings(); // per-page cost labels track the word target
  updateCurrentModelLabel();
  updateCostTicker();
  renderFontList();
}

function renderFontList() {
  const list = document.getElementById('fontList');
  if (!list) return;
  list.textContent = '';
  Object.entries(STORY_FONTS).forEach(([id, font]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'font-item' + (settings.storyFont === id ? ' selected' : '');
    item.style.fontFamily = font.stack;
    item.setAttribute('aria-pressed', settings.storyFont === id ? 'true' : 'false');
    const sample = document.createElement('span');
    sample.className = 'font-item__sample';
    sample.textContent = 'Ag';
    const label = document.createElement('span');
    label.className = 'font-item__label';
    label.textContent = font.label;
    item.append(sample, label);
    item.addEventListener('click', () => {
      setSetting('storyFont', id);
    });
    list.appendChild(item);
  });
}

function updateCurrentModelLabel() {
  const label = document.getElementById('currentModel');
  if (!label) return;
  label.textContent = settings.model
    ? `Selected: ${settings.model}`
    : 'Using the server default model';
}

function formatUsd(value) {
  const v = Number(value) || 0;
  return '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(4));
}

function updateCostTicker() {
  const el = document.getElementById('costTicker');
  if (!el) return;
  el.hidden = !settings.costTicker;
  if (!settings.costTicker) return;
  el.textContent = `Session ${formatUsd(sessionCost)} · Story ${formatUsd(storyCostBase + storyCostExtra)}`;
}

function resetStoryCost() {
  storyCostBase = typeof currentStory?.total_cost_usd === 'number' ? currentStory.total_cost_usd : 0;
  storyCostExtra = 0;
  updateCostTicker();
}

function addCost(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
  sessionCost += costUsd;
  storyCostExtra += costUsd;
  updateCostTicker();
}

// Reference-image costs are booked exactly once per generation (per entity +
// image_updated_at), whenever the session observes the finished image.
const chargedImages = new Set();

function chargeEntityImageCosts(rows, kind) {
  for (const row of rows || []) {
    if (row.image_status !== 'ready' || typeof row.image_cost_usd !== 'number') continue;
    const key = `${kind}/${row.id}@${row.image_updated_at}`;
    if (chargedImages.has(key)) continue;
    chargedImages.add(key);
    addSessionCost(row.image_cost_usd);
  }
}

// While portraits/scenes are being painted in the background, refresh the
// lists until every pending brush has landed.
let imagePollTimer = null;

function anyImagePending() {
  return [...worlds, ...characters].some((r) => r.image_status === 'pending');
}

function scheduleImagePolling() {
  if (imagePollTimer || !anyImagePending()) return;
  imagePollTimer = setInterval(async () => {
    if (!anyImagePending()) {
      stopImagePolling();
      return;
    }
    await Promise.all([loadWorlds(), loadCharacters()]);
  }, 4000);
}

function stopImagePolling() {
  if (imagePollTimer) {
    clearInterval(imagePollTimer);
    imagePollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Speculative next-page preparation
// ---------------------------------------------------------------------------

// When the writer sits on the last page with no direction, the scribe
// prepares the next page in advance; an empty Generate commits it instantly.
// Costs are booked at preparation time (the tokens are spent either way).
let speculative = null; // { storyId, ready: bool }

// The ready signal IS the button: with a prepared page and no direction,
// Generate Page becomes a green Next Page button of identical dimensions.
function updateSpeculativeUi() {
  const btn = document.getElementById('generateBtn');
  if (!btn) return;
  const input = document.getElementById('userInput');
  const inputEmpty = !input || !input.value.trim();
  const previewUsable =
    !generating && speculative && speculative.ready && currentStory && speculative.storyId === currentStory.id && inputEmpty;
  btn.textContent = generating ? 'The scribe is writing…' : previewUsable ? 'Next Page' : 'Generate Page';
  btn.classList.toggle('next-page', previewUsable);
}

async function maybeStartSpeculative() {
  if (!currentStory || generating) return;
  if (storyPages.length === 0 || currentPage !== storyPages.length) return;
  const input = document.getElementById('userInput');
  if (input && input.value.trim()) return;
  if (speculative && speculative.storyId === currentStory.id) return; // already in flight or ready

  const storyId = currentStory.id;
  speculative = { storyId, ready: false };
  try {
    const res = await apiCall(`/stories/${storyId}/pages/preview`, 'POST', {
      words: settings.wordsPerPage,
      ...(settings.model ? { model: settings.model } : {}),
      ...(reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
    });
    if (!speculative || speculative.storyId !== storyId) return; // story changed mid-flight
    speculative = { storyId, ready: true };
    addSessionCost(res.preview?.cost_usd); // honest: the tokens are spent now
  } catch {
    if (speculative && speculative.storyId === storyId) speculative = null;
  }
  updateSpeculativeUi();
}

function discardSpeculative() {
  speculative = null;
  updateSpeculativeUi();
}
function addSessionCost(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
  sessionCost += costUsd;
  updateCostTicker();
}

// Story cost only (session already counted it - e.g. a speculatively
// pre-generated page whose preview cost was booked when it was prepared).
function addStoryCost(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
  storyCostExtra += costUsd;
  updateCostTicker();
}

async function loadModels() {
  if (modelsCache) return modelsCache;
  try {
    const data = await apiCall('/models');
    modelsCache = data.models || [];
  } catch (error) {
    modelsCache = [];
    const list = document.getElementById('modelList');
    if (list) {
      list.textContent = '';
      const p = document.createElement('p');
      p.className = 'placeholder';
      p.textContent = `Could not load the model catalog (${error.message}). Try again later.`;
      list.appendChild(p);
    }
  }
  return modelsCache;
}

// Reasoning level: only shown when the selected model can think first.
function selectedModelEntry() {
  if (!settings.model || !modelsCache) return null;
  return modelsCache.find((m) => m.id === settings.model) || null;
}

function reasoningApplies() {
  const entry = selectedModelEntry();
  return Boolean(entry && entry.reasoning);
}

function updateReasoningBlock() {
  const block = document.getElementById('reasoningBlock');
  const select = document.getElementById('reasoningSelect');
  if (!block || !select) return;
  const applies = reasoningApplies();
  block.hidden = !applies;
  if (applies) {
    if (!settings.reasoningEffort) setSetting('reasoningEffort', 'medium');
    select.value = settings.reasoningEffort || 'medium';
  } else if (settings.reasoningEffort) {
    setSetting('reasoningEffort', null); // carried thoughts don't fit this model
  }
}

function renderModelList() {
  const list = document.getElementById('modelList');
  if (!list) return;
  const query = (document.getElementById('modelSearch')?.value || '').toLowerCase().trim();
  list.textContent = '';

  const models = modelsCache || [];
  const filtered = query
    ? models.filter((m) => m.id.toLowerCase().includes(query) || (m.name || '').toLowerCase().includes(query))
    : models.slice(0, 50); // unfiltered: show a sensible first page

  if (filtered.length === 0) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = models.length === 0 ? 'The catalog is empty.' : 'No models match that search.';
    list.appendChild(p);
    return;
  }

  filtered.forEach((m) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'model-item' + (settings.model === m.id ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', settings.model === m.id ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'model-item__name';
    name.textContent = m.name || m.id;
    const id = document.createElement('span');
    id.className = 'model-item__id';
    id.textContent = m.id;
    const meta = document.createElement('span');
    meta.className = 'model-item__meta';
    const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : 'ctx n/a';
    meta.textContent = `${ctx} · in ${formatUsd(m.pricing?.prompt_per_mtok)}/1M · out ${formatUsd(m.pricing?.completion_per_mtok)}/1M`;
    item.append(name, id, meta);

    item.addEventListener('click', () => {
      const switching = settings.model !== m.id;
      setSetting('model', settings.model === m.id ? null : m.id);
      if (switching && !m.reasoning) setSetting('reasoningEffort', null); // carried thoughts don't fit this model
      renderModelList();
    });
    list.appendChild(item);
  });
  updateReasoningBlock();
}

// Global state
let worlds = [];
let characters = [];
let stories = [];
let currentStory = null;
let currentPage = 1;
let storyPages = [];
let generating = false;
let flavorTimer = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initApp() {
  document.getElementById('worldsBtn').addEventListener('click', () => showSection('worlds'));
  document.getElementById('charactersBtn').addEventListener('click', () => showSection('characters'));
  document.getElementById('storiesBtn').addEventListener('click', () => showSection('stories'));
  document.getElementById('writeBtn').addEventListener('click', () => showSection('write'));

  document.getElementById('worldForm').addEventListener('submit', handleWorldSubmit);
  document.getElementById('characterForm').addEventListener('submit', handleCharacterSubmit);
  document.getElementById('storyForm').addEventListener('submit', handleStorySubmit);
  document.getElementById('storyWorld').addEventListener('change', renderCastBuilder);
  const mcSelect = document.getElementById('mcSelect');
  if (mcSelect) mcSelect.addEventListener('change', () => { if (mcSelect.value) chooseMainCharacter(); });
  const castAddBtn = document.getElementById('castAddBtn');
  if (castAddBtn) castAddBtn.addEventListener('click', addCastMember);

  document.getElementById('currentStory').addEventListener('change', handleStorySelection);
  document.getElementById('generateBtn').addEventListener('click', () => generateNextPage());
  document.getElementById('retryBtn').addEventListener('click', retryLastPage);
  document.getElementById('exportBtn').addEventListener('click', exportStory);
  document.getElementById('deletePageBtn').addEventListener('click', deleteCurrentPage);
  document.getElementById('prevPageBtn').addEventListener('click', () => navigatePage(-1));
  document.getElementById('nextPageBtn').addEventListener('click', () => navigatePage(1));

  const heroStart = document.getElementById('heroStartBtn');
  if (heroStart) heroStart.addEventListener('click', () => showSection('stories'));
  const heroWrite = document.getElementById('heroWriteBtn');
  if (heroWrite) heroWrite.addEventListener('click', () => showSection('write'));

  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showSection('settings');
      loadModels().then(renderModelList);
      loadSpeechModels().then(renderNarrationSettings);
    });
  }
  const modelSearch = document.getElementById('modelSearch');
  if (modelSearch) modelSearch.addEventListener('input', renderModelList);
  const modelReset = document.getElementById('modelResetBtn');
  if (modelReset) {
    modelReset.addEventListener('click', () => {
      setSetting('model', null);
      setSetting('reasoningEffort', null);
      renderModelList();
    });
  }
  const reasoningSelect = document.getElementById('reasoningSelect');
  if (reasoningSelect) {
    reasoningSelect.addEventListener('change', () => {
      setSetting('reasoningEffort', reasoningSelect.value || null);
    });
  }
  const bgToggle = document.getElementById('scriptoriumBgToggle');
  if (bgToggle) bgToggle.addEventListener('change', () => setSetting('scriptoriumBg', bgToggle.checked));
  const tickerToggle = document.getElementById('costTickerToggle');
  if (tickerToggle) tickerToggle.addEventListener('change', () => setSetting('costTicker', tickerToggle.checked));
  const wordsInput = document.getElementById('wordsPerPageInput');
  if (wordsInput) {
    wordsInput.addEventListener('change', () => setSetting('wordsPerPage', wordsInput.value));
  }
  const fontSizeSelect = document.getElementById('fontSizeSelect');
  if (fontSizeSelect) {
    fontSizeSelect.addEventListener('change', () => setSetting('storyFontSize', fontSizeSelect.value));
  }
  const userInputEl = document.getElementById('userInput');
  if (userInputEl) {
    userInputEl.addEventListener('input', updateSpeculativeUi);
  }

  applySettings();
  initBurnModal();
  initAiDrafts();
  initNarration();
  initImagePrompt();
  initEntityEditors();

  initAgeGate();

  loadWorlds();
  loadCharacters();
  loadStories();
  showSection('worlds');
}

function initAgeGate() {
  const gate = document.getElementById('ageGate');
  const button = document.getElementById('ageGateAccept');
  if (!gate || !button) return;
  try {
    if (!localStorage.getItem('fw-age-ok')) gate.hidden = false;
  } catch {
    gate.hidden = false;
  }
  button.addEventListener('click', () => {
    try {
      localStorage.setItem('fw-age-ok', '1');
    } catch {
      // private mode - fine, just hide for this session
    }
    gate.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function apiCall(endpoint, method = 'GET', data = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (data && method !== 'GET') options.body = JSON.stringify(data);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  } catch (error) {
    throw new Error('Cannot reach the server - is it running?');
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON (e.g. 204)
  }

  if (!response.ok) {
    throw new Error((body && body.error) || `Request failed (${response.status})`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function showSection(section) {
  document.querySelectorAll('.content-section').forEach((sec) => sec.classList.remove('active'));
  document.getElementById(`${section}Section`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.remove('active'));
  document.getElementById(`${section}Btn`).classList.add('active');
}

// ---------------------------------------------------------------------------
// Messages (XSS-safe: textContent only, never innerHTML with user data)
// ---------------------------------------------------------------------------

function showMessage(message, kind = 'error') {
  const active = document.querySelector('.content-section.active') || document.querySelector('main');
  const div = document.createElement('div');
  div.className = kind === 'error' ? 'error-message' : 'success-message';
  div.textContent = message;
  active.insertBefore(div, active.firstChild);
  // Errors carry recovery information: keep them up longer.
  setTimeout(() => div.remove(), kind === 'error' ? 8000 : 5000);
}

// Wrap raw failures in the scribe's voice without ever hiding the reason.
function scribeErrorMessage(raw) {
  const msg = String(raw || 'something went wrong');
  if (msg.includes('Cannot reach the server')) {
    return 'The scriptorium has gone dark — the server cannot be reached. Is it still running?';
  }
  if (msg.includes('API key not configured')) {
    return 'The scribe has no key to the library. Set OPENROUTER_API_KEY in backend/.env, then restart the server.';
  }
  if (msg.includes('illegible')) {
    return 'The ink has gone feral — the scribe produced something illegible. Ask again; she will be clearer.';
  }
  if (msg.includes('referenced by')) {
    return `The scribe refuses to cut a thread that still holds weight — ${msg}`;
  }
  if (msg.includes('world_id') || msg.includes('unknown id')) {
    return `The scribe cannot find that in the archives — ${msg}`;
  }
  if (msg.includes('Request failed')) {
    return `The scribe frowns at a sealed envelope — ${msg}. The how of it is unclear; try again.`;
  }
  return `The scribe looks up, troubled — ${msg}`;
}

function showError(message) {
  showMessage(scribeErrorMessage(message), 'error');
}

function showSuccess(message) {
  showMessage(message, 'success');
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

async function loadWorlds() {
  try {
    const data = await apiCall('/worlds');
    worlds = data.worlds || [];
    chargeEntityImageCosts(worlds, 'world');
    renderWorlds();
    updateWorldSelects();
    scheduleImagePolling();
  } catch (error) {
    showError(error.message);
  }
}

// Reference image block for entity cards: the painted image (or its
// placeholder) plus a redo button that regenerates in the background.
// A "ready" image whose file has gone missing (legacy copies) degrades to
// the failed placeholder instead of a broken image.
function entityImageBlock(kind, row, altText) {
  const wrap = document.createElement('div');
  wrap.className = 'card-image-wrap';
  if (row.image_status === 'ready') {
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = `/api/${kind === 'world' ? 'worlds' : 'characters'}/${row.id}/image`;
    img.alt = altText;
    img.addEventListener('error', () => {
      const missing = document.createElement('div');
      missing.className = 'card-image card-image--failed';
      missing.textContent = 'The painting is missing.';
      if (img.parentNode) img.parentNode.replaceChild(missing, img);
    });
    wrap.appendChild(img);
  } else if (row.image_status === 'pending') {
    const pending = document.createElement('div');
    pending.className = 'card-image card-image--pending';
    pending.textContent = kind === 'world' ? 'The scene is being painted…' : 'The portrait is being painted…';
    wrap.appendChild(pending);
  } else if (row.image_status === 'failed') {
    const failed = document.createElement('div');
    failed.className = 'card-image card-image--failed';
    failed.textContent = 'The painting failed.';
    wrap.appendChild(failed);
  }
  const redo = document.createElement('button');
  redo.type = 'button';
  redo.className = 'card-image-redo';
  redo.textContent = row.image_status === 'ready' ? '↻ Redo image' : '↻ Paint image';
  redo.addEventListener('click', async () => {
    redo.disabled = true;
    try {
      await apiCall(`/${kind === 'world' ? 'worlds' : 'characters'}/${row.id}/image`, 'POST');
      if (kind === 'world') loadWorlds();
      else loadCharacters();
    } catch (error) {
      showError(error.message);
      redo.disabled = false;
    }
  });
  wrap.appendChild(redo);
  return wrap;
}

// ---------------------------------------------------------------------------
// Entity editors: click a card to edit it. Plain fields only - no AI assists
// here; the image generator gets whatever blurb the user writes.
// ---------------------------------------------------------------------------

let editingCharacterId = null;
let editingWorldId = null;

function openCharacterEditor(character) {
  const modal = document.getElementById('characterEditorModal');
  if (!modal) return;
  editingCharacterId = character.id;
  document.getElementById('charEditName').value = character.name || '';
  document.getElementById('charEditDescription').value = character.description || '';
  document.getElementById('charEditPersonality').value = character.personality || '';
  document.getElementById('charEditAppearance').value = character.appearance || '';
  document.getElementById('charEditBackground').value = character.background || '';
  document.getElementById('charEditImagePrompt').value = character.image_prompt || '';
  modal.hidden = false;
  document.getElementById('charEditName').focus();
}

function closeCharacterEditor() {
  const modal = document.getElementById('characterEditorModal');
  if (modal) modal.hidden = true;
  editingCharacterId = null;
}

async function saveCharacterEditor() {
  if (!editingCharacterId) return false;
  await apiCall(`/characters/${editingCharacterId}`, 'PUT', {
    name: document.getElementById('charEditName').value,
    description: document.getElementById('charEditDescription').value,
    personality: document.getElementById('charEditPersonality').value,
    appearance: document.getElementById('charEditAppearance').value,
    background: document.getElementById('charEditBackground').value,
    image_prompt: document.getElementById('charEditImagePrompt').value,
  });
  closeCharacterEditor();
  await loadCharacters();
  showSuccess('Character saved.');
  return true;
}

function openWorldEditor(world) {
  const modal = document.getElementById('worldEditorModal');
  if (!modal) return;
  editingWorldId = world.id;
  document.getElementById('worldEditName').value = world.name || '';
  document.getElementById('worldEditDescription').value = world.description || '';
  document.getElementById('worldEditGenre').value = world.genre || '';
  document.getElementById('worldEditSetting').value = world.setting || '';
  document.getElementById('worldEditLore').value = world.lore || '';
  document.getElementById('worldEditImagePrompt').value = world.image_prompt || '';
  modal.hidden = false;
  document.getElementById('worldEditName').focus();
}

function closeWorldEditor() {
  const modal = document.getElementById('worldEditorModal');
  if (modal) modal.hidden = true;
  editingWorldId = null;
}

async function saveWorldEditor() {
  if (!editingWorldId) return false;
  await apiCall(`/worlds/${editingWorldId}`, 'PUT', {
    name: document.getElementById('worldEditName').value,
    description: document.getElementById('worldEditDescription').value,
    genre: document.getElementById('worldEditGenre').value,
    setting: document.getElementById('worldEditSetting').value,
    lore: document.getElementById('worldEditLore').value,
    image_prompt: document.getElementById('worldEditImagePrompt').value,
  });
  closeWorldEditor();
  // Worlds are canonical: stories keep using this very world, so every
  // list that shows it (or its name) refreshes.
  await Promise.all([loadWorlds(), loadCharacters(), loadStories()]);
  showSuccess('World saved.');
  return true;
}

function initEntityEditors() {
  const characterForm = document.getElementById('characterEditorForm');
  if (characterForm) {
    characterForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveCharacterEditor().catch((error) => showError(error.message));
    });
  }
  const characterRedo = document.getElementById('charEditRedoImageBtn');
  if (characterRedo) {
    characterRedo.addEventListener('click', () => {
      (async () => {
        const id = editingCharacterId;
        if (!id) return;
        try {
          await saveCharacterEditor(); // saves the fields (incl. the blurb) first
          await apiCall(`/characters/${id}/image`, 'POST');
          await loadCharacters();
          showSuccess('A new portrait is being painted.');
        } catch (error) {
          showError(error.message);
        }
      })();
    });
  }
  const worldRedo = document.getElementById('worldEditRedoImageBtn');
  if (worldRedo) {
    worldRedo.addEventListener('click', () => {
      (async () => {
        const id = editingWorldId;
        if (!id) return;
        try {
          await saveWorldEditor(); // saves the fields (incl. the blurb) first
          await apiCall(`/worlds/${id}/image`, 'POST');
          await loadWorlds();
          showSuccess('A new scene is being painted.');
        } catch (error) {
          showError(error.message);
        }
      })();
    });
  }
  const worldForm = document.getElementById('worldEditorForm');
  if (worldForm) {
    worldForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveWorldEditor().catch((error) => showError(error.message));
    });
  }
  for (const [cancelId, closeFn, modalId] of [
    ['charEditCancelBtn', closeCharacterEditor, 'characterEditorModal'],
    ['worldEditCancelBtn', closeWorldEditor, 'worldEditorModal'],
  ]) {
    const cancel = document.getElementById(cancelId);
    const modal = document.getElementById(modalId);
    if (!cancel || !modal) continue;
    cancel.addEventListener('click', () => closeFn());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeFn();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeFn();
    });
  }
}

function renderWorlds() {
  const container = document.getElementById('worldsList');
  container.textContent = '';

  if (worlds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Nothing here yet. Disgraceful. Forge a world above.';
    container.appendChild(empty);
    return;
  }

  worlds.forEach((world) => {
    const card = document.createElement('div');
    card.className = 'item-card';

    const title = document.createElement('h4');
    title.textContent = world.name;
    const desc = document.createElement('p');
    desc.textContent = world.description || 'No description';
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = [world.genre, world.setting].filter(Boolean).join(' · ') || 'No genre/setting';

    const del = document.createElement('button');
    del.className = 'card-delete';
    del.type = 'button';
    del.textContent = '✕ Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete world "${world.name}"?`)) return;
      try {
        await apiCall(`/worlds/${world.id}`, 'DELETE');
        showSuccess('World deleted.');
        loadWorlds();
        loadCharacters();
        loadStories();
      } catch (error) {
        showError(error.message);
      }
    });

    card.append(title, entityImageBlock('world', world, `Reference scene for the world ${world.name}`), desc, meta, del);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return; // buttons keep their own jobs
      openWorldEditor(world);
    });
    container.appendChild(card);
  });
}

function updateWorldSelects() {
  for (const selectId of ['characterWorld', 'storyWorld']) {
    const select = document.getElementById(selectId);
    if (!select) continue;
    const keep = select.value;
    const first = select.querySelector('option').cloneNode(true);
    select.textContent = '';
    select.appendChild(first);
    worlds.forEach((world) => {
      const option = document.createElement('option');
      option.value = world.id;
      option.textContent = world.name;
      select.appendChild(option);
    });
    if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  }
}

async function handleWorldSubmit(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await apiCall('/worlds', 'POST', {
      name: document.getElementById('worldName').value,
      description: document.getElementById('worldDescription').value,
      genre: document.getElementById('worldGenre').value,
      setting: document.getElementById('worldSetting').value,
    });
    form.reset();
    await loadWorlds();
    showSuccess('World created.');
  } catch (error) {
    showError(error.message);
  }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

async function loadCharacters() {
  try {
    const data = await apiCall('/characters');
    characters = data.characters || [];
    chargeEntityImageCosts(characters, 'character');
    renderCharacters();
    renderCastBuilder();
    scheduleImagePolling();
  } catch (error) {
    showError(error.message);
  }
}

function renderCharacters() {
  const container = document.getElementById('charactersList');
  container.textContent = '';

  if (characters.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'No characters walk these halls yet. Summon one above.';
    container.appendChild(empty);
    return;
  }

  characters.forEach((character) => {
    const world = worlds.find((w) => w.id === character.world_id);
    const card = document.createElement('div');
    card.className = 'item-card';

    const title = document.createElement('h4');
    title.textContent = character.name;
    const desc = document.createElement('p');
    desc.textContent = character.description || 'No description';
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = world ? `World: ${world.name}` : 'Free-roaming (no world)';

    const del = document.createElement('button');
    del.className = 'card-delete';
    del.type = 'button';
    del.textContent = '✕ Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete character "${character.name}"? They will be removed from all story casts.`)) return;
      try {
        await apiCall(`/characters/${character.id}`, 'DELETE');
        showSuccess('Character deleted.');
        loadCharacters();
        loadStories();
      } catch (error) {
        showError(error.message);
      }
    });

    card.append(title, entityImageBlock('character', character, `Reference portrait of ${character.name}`), desc, meta, del);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return; // buttons keep their own jobs
      openCharacterEditor(character);
    });
    container.appendChild(card);
  });
}

async function handleCharacterSubmit(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await apiCall('/characters', 'POST', {
      name: document.getElementById('characterName').value,
      description: document.getElementById('characterDescription').value,
      personality: document.getElementById('characterPersonality').value,
      appearance: document.getElementById('characterAppearance').value,
      background: document.getElementById('characterBackground').value,
      world_id: document.getElementById('characterWorld').value || null,
    });
    form.reset();
    await loadCharacters();
    showSuccess('Character created.');
  } catch (error) {
    showError(error.message);
  }
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

async function loadStories() {
  try {
    const data = await apiCall('/stories');
    stories = data.stories || [];
    if (currentStory) currentStory = stories.find((s) => s.id === currentStory.id) || currentStory;
    renderStories();
    updateStorySelect();
  } catch (error) {
    showError(error.message);
  }
}

function renderStories() {
  const container = document.getElementById('storiesList');
  container.textContent = '';

  if (stories.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'The shelves are bare. Start a story above.';
    container.appendChild(empty);
    return;
  }

  stories.forEach((story) => {
    const world = worlds.find((w) => w.id === story.world_id);
    const card = document.createElement('div');
    card.className = 'item-card';

    const title = document.createElement('h4');
    title.textContent = story.title;
    const desc = document.createElement('p');
    desc.textContent = world ? `World: ${world.name}` : 'No world';
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `Tone: ${story.tone} · Pages: ${story.page_count}`;

    const open = document.createElement('button');
    open.className = 'card-open';
    open.type = 'button';
    open.textContent = '✎ Write';
    open.addEventListener('click', () => openStory(story.id));

    const del = document.createElement('button');
    del.className = 'card-delete';
    del.type = 'button';
    del.textContent = '✕ Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete story "${story.title}" and all its pages?`)) return;
      try {
        await apiCall(`/stories/${story.id}`, 'DELETE');
        if (currentStory && currentStory.id === story.id) {
          currentStory = null;
          resetStoryReader();
        }
        await loadStories();
        showSuccess('Story deleted.');
      } catch (error) {
        showError(error.message);
      }
    });

    card.append(title, desc, meta, open, del);
    container.appendChild(card);
  });
}

// Story cast builder: one Main Character, then supporting/background members
// added one at a time, each with an optional free-text relation to the MC.
// The relation seeds the story; later pages may evolve it server-side.
let storyCast = []; // [{id, role, relation}]

function castOrderedCharacters() {
  const storyWorld = document.getElementById('storyWorld')?.value || '';
  return [
    ...characters.filter((c) => c.world_id === storyWorld),
    ...characters.filter((c) => c.world_id !== storyWorld),
  ];
}

function castCharacterById(id) {
  return characters.find((c) => c.id === id) || null;
}

function populateSelectOptions(select, options, { placeholder = null } = {}) {
  select.textContent = '';
  if (placeholder !== null) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    select.appendChild(option);
  }
  const storyWorld = document.getElementById('storyWorld')?.value || '';
  options.forEach((character) => {
    const option = document.createElement('option');
    option.value = character.id;
    const otherWorld = Boolean(storyWorld) && Boolean(character.world_id) && character.world_id !== storyWorld;
    option.textContent = character.name + (otherWorld ? ' (other world)' : '');
    select.appendChild(option);
  });
}

function renderCastBuilder() {
  const mcSelect = document.getElementById('mcSelect');
  const charSelect = document.getElementById('castCharSelect');
  const list = document.getElementById('castList');
  if (!mcSelect || !charSelect || !list) return;

  const chosenIds = new Set(storyCast.map((entry) => entry.id));
  const available = castOrderedCharacters().filter((c) => !chosenIds.has(c.id));
  const currentMc = storyCast.find((entry) => entry.role === 'mc');

  // MC picker: offers everyone not yet cast; locks once a MC is chosen.
  const mcOptions = currentMc ? [] : available;
  populateSelectOptions(mcSelect, mcOptions, {
    placeholder: available.length > 0 ? '— Choose the character the story follows —' : '— No characters available —',
  });
  mcSelect.disabled = Boolean(currentMc) || available.length === 0;

  // Member picker: everyone not yet cast (MC included in the pool).
  populateSelectOptions(charSelect, available, {
    placeholder: available.length > 0 ? '— Choose a character —' : '— Everyone is already cast —',
  });
  charSelect.disabled = available.length === 0;

  const relationInput = document.getElementById('castRelation');
  const tierSelect = document.getElementById('castTierSelect');
  const addBtn = document.getElementById('castAddBtn');
  if (addBtn) addBtn.disabled = available.length === 0;
  if (relationInput) relationInput.value = '';
  if (tierSelect) tierSelect.value = 'supporting';

  // Cast list: rows with editable relation + removal.
  list.textContent = '';
  if (storyCast.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'No cast yet. A story cannot begin without a Main Character.';
    list.appendChild(empty);
    return;
  }
  storyCast.forEach((entry) => {
    const character = castCharacterById(entry.id);
    const row = document.createElement('div');
    row.className = 'cast-list__row' + (entry.role === 'mc' ? ' cast-list__row--mc' : '');

    const name = document.createElement('span');
    name.className = 'cast-list__name';
    name.textContent = (character ? character.name : entry.id) + (entry.role === 'mc' ? ' — Main Character' : '');

    if (entry.role !== 'mc') {
      const relation = document.createElement('input');
      relation.type = 'text';
      relation.className = 'cast-list__relation';
      relation.maxLength = 2000;
      relation.value = entry.relation || '';
      relation.setAttribute('aria-label', `Relation of ${character ? character.name : entry.id} to the Main Character`);
      relation.placeholder = 'relation to the Main Character…';
      relation.addEventListener('input', () => {
        entry.relation = relation.value.trim() || null;
      });
      row.appendChild(relation);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cast-list__remove';
    remove.textContent = entry.role === 'mc' ? '✕ Replace MC' : '✕ Remove';
    remove.setAttribute('aria-label', `Remove ${character ? character.name : entry.id} from the cast`);
    remove.addEventListener('click', () => {
      storyCast = storyCast.filter((e) => e.id !== entry.id);
      renderCastBuilder();
    });
    row.append(name, remove);
    list.appendChild(row);
  });
}

function addCastMember() {
  const charSelect = document.getElementById('castCharSelect');
  if (!charSelect || !charSelect.value) return;
  const tierSelect = document.getElementById('castTierSelect');
  const relationInput = document.getElementById('castRelation');
  const role = tierSelect && tierSelect.value === 'background' ? 'background' : 'supporting';
  const relation = relationInput && relationInput.value.trim() ? relationInput.value.trim() : null;
  storyCast.push({ id: charSelect.value, role, relation });
  renderCastBuilder();
}

function chooseMainCharacter() {
  const mcSelect = document.getElementById('mcSelect');
  if (!mcSelect || !mcSelect.value) return;
  storyCast = [{ id: mcSelect.value, role: 'mc', relation: null }, ...storyCast.filter((e) => e.role !== 'mc' && e.id !== mcSelect.value)];
  renderCastBuilder();
}

function updateStorySelect() {
  const select = document.getElementById('currentStory');
  if (!select) return;
  const keep = select.value;
  select.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select or Create a Story';
  select.appendChild(placeholder);
  stories.forEach((story) => {
    const option = document.createElement('option');
    option.value = story.id;
    option.textContent = `${story.title} (${story.page_count} page${story.page_count === 1 ? '' : 's'})`;
    select.appendChild(option);
  });
  if (keep && [...select.options].some((o) => o.value === keep)) select.value = keep;
}

async function handleStorySubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!storyCast.some((entry) => entry.role === 'mc')) {
    showError('A story must have a Main Character before the scribe can begin.');
    return;
  }
  const cast = storyCast.map((entry) => ({ ...entry, state: null }));
  try {
    const data = await apiCall('/stories', 'POST', {
      title: document.getElementById('storyTitle').value,
      world_id: document.getElementById('storyWorld').value || null,
      tone: document.getElementById('storyTone').value,
      characters: cast,
    });
    form.reset();
    storyCast = [];
    renderCastBuilder();
    document.getElementById('storyTone').value = 'fade-to-black';
    await loadStories();
    openStory(data.story.id);
    showSuccess('Story created.');
  } catch (error) {
    showError(error.message);
  }
}

function openStory(storyId) {
  showSection('write');
  document.getElementById('currentStory').value = storyId;
  currentStory = stories.find((s) => s.id === storyId) || null;
  loadStoryPages();
}

// ---------------------------------------------------------------------------
// Reading + writing
// ---------------------------------------------------------------------------

async function handleStorySelection(event) {
  const storyId = event.target.value;
  stopNarration();
  if (!storyId) {
    currentStory = null;
    resetStoryReader();
    return;
  }
  currentStory = stories.find((s) => s.id === storyId) || null;
  await loadStoryPages();
}

async function loadStoryPages() {
  if (!currentStory) return;
  try {
    const data = await apiCall(`/stories/${currentStory.id}/pages`);
    storyPages = data.pages || [];
    currentPage = Math.max(1, storyPages.length);
    displayCurrentPage();
    resetStoryCost();
    maybeStartSpeculative();
  } catch (error) {
    showError(error.message);
    storyPages = [];
    displayCurrentPage();
  }
}

function displayCurrentPage() {
  const contentDiv = document.getElementById('storyContent');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  const retryBtn = document.getElementById('retryBtn');
  const deletePageBtn = document.getElementById('deletePageBtn');
  contentDiv.textContent = '';

  const onLastPage = Boolean(currentStory) && storyPages.length > 0 && currentPage === storyPages.length;

  if (!currentStory) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'Select a story to begin reading and writing…';
    contentDiv.appendChild(placeholder);
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    retryBtn.disabled = true;
    deletePageBtn.disabled = true;
    document.getElementById('pageIndicator').textContent = 'Page 1 of 1';
    setPastPageBar(false, 0, 0);
    setWritingEnabled(true);
    return;
  }

  if (storyPages.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'This story has no pages yet. Give the scribe a direction below…';
    contentDiv.appendChild(placeholder);
  } else {
    const page = storyPages.find((p) => p.page_number === currentPage);
    if (page) {
      const para = document.createElement('p');
      para.textContent = page.content;
      const direction = document.createElement('div');
      direction.className = 'page-direction';
      direction.textContent = page.user_input ? `↳ direction: ${page.user_input}` : '';
      contentDiv.append(para, direction);
    }
  }

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= storyPages.length;
  retryBtn.disabled = generating || storyPages.length === 0 || currentPage !== storyPages.length;
  deletePageBtn.disabled = storyPages.length === 0 || currentPage > storyPages.length;

  // Old pages are read-only: writing continues from the last page only.
  setWritingEnabled(storyPages.length === 0 || currentPage === storyPages.length);
  setPastPageBar(
    storyPages.length > 0 && currentPage < storyPages.length,
    currentPage,
    storyPages.length - currentPage
  );

  document.getElementById('pageIndicator').textContent = `Page ${currentPage} of ${Math.max(storyPages.length, 1)}`;
}

function setWritingEnabled(enabled) {
  const wrap = document.getElementById('writeSection');
  const interfaceEl = wrap ? wrap.querySelector('.writing-interface') : null;
  const input = document.getElementById('userInput');
  const generateBtn = document.getElementById('generateBtn');
  if (interfaceEl) interfaceEl.classList.toggle('read-only', !enabled);
  if (input) input.disabled = !enabled;
  if (generateBtn) generateBtn.disabled = generating || !enabled;
}

function setPastPageBar(visible, pageNumber, pagesAfter) {
  const bar = document.getElementById('pastPageBar');
  if (!bar) return;
  bar.hidden = !visible;
  if (!visible) return;
  const note = bar.querySelector('p');
  if (note) {
    note.textContent =
      pagesAfter === 1
        ? `You are reading an earlier page. ${pagesAfter} page comes after this one. Old pages cannot be changed.`
        : `You are reading an earlier page. ${pagesAfter} pages come after this one. Old pages cannot be changed.`;
  }
}

function navigatePage(direction) {
  if (!currentStory || storyPages.length === 0) return;
  stopNarration(); // obsolete stream: the reader moved on
  currentPage = Math.max(1, Math.min(storyPages.length, currentPage + direction));
  displayCurrentPage();
}

function setGenerating(active) {
  generating = active;
  for (const id of ['generateBtn', 'retryBtn']) {
    document.getElementById(id).disabled = active;
  }
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.classList.toggle('busy', active);
  updateSpeculativeUi();

  const status = document.getElementById('scribeStatus');
  if (active) {
    let i = 0;
    status.textContent = SCRIBE_FLAVOR[0];
    flavorTimer = setInterval(() => {
      i = (i + 1) % SCRIBE_FLAVOR.length;
      status.textContent = SCRIBE_FLAVOR[i];
    }, 4000);
  } else {
    clearInterval(flavorTimer);
    flavorTimer = null;
  }
  displayCurrentPage();
}

async function generateNextPage() {
  if (!currentStory) {
    showError('Please select a story first.');
    return;
  }
  if (generating) return;
  if (storyPages.length > 0 && currentPage !== storyPages.length) {
    showError('Navigate to the last page to continue writing.');
    return;
  }

  const userInput = document.getElementById('userInput').value.trim();

  // No direction given and the scribe already prepared the next page: commit it.
  if (
    !userInput &&
    speculative &&
    speculative.ready &&
    speculative.storyId === currentStory.id
  ) {
    setGenerating(true);
    let committed = false;
    try {
      const data = await apiCall(`/stories/${currentStory.id}/pages/commit-preview`, 'POST', {});
      storyPages.push(data.page);
      currentPage = storyPages.length;
      addStoryCost(data.page?.cost_usd); // session cost was booked at preview time
      discardSpeculative();
      document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
      displayCurrentPage();
      committed = true;
    } catch {
      // Stale or discarded (the story moved on) - fall back to a live call.
      discardSpeculative();
    } finally {
      setGenerating(false);
    }
    if (committed) {
      maybeStartSpeculative(); // prepare the next one
      return;
    }
  }

  await generateNextPageLive(userInput);
}

async function generateNextPageLive(userInput) {
  if (generating) return;
  const direction =
    userInput === undefined || userInput === null
      ? document.getElementById('userInput').value.trim()
      : userInput;

  setGenerating(true);
  try {
    const data = await apiCall(`/stories/${currentStory.id}/pages/generate`, 'POST', {
      user_input: direction || null,
      words: settings.wordsPerPage,
      ...(settings.model ? { model: settings.model } : {}),
      ...(reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
    });
    storyPages.push(data.page);
    currentPage = storyPages.length;
    addCost(typeof data.page?.cost_usd === 'number' ? data.page.cost_usd : 0);
    document.getElementById('userInput').value = '';
    document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
    displayCurrentPage();
  } catch (error) {
    showError(error.message);
    document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
  } finally {
    setGenerating(false);
  }
  maybeStartSpeculative(); // prepare the next one (generating has cleared)
}

async function retryLastPage() {
  if (!currentStory || generating) return;
  if (storyPages.length === 0 || currentPage !== storyPages.length) {
    showError('Retry works on the last page only - navigate there first.');
    return;
  }
  setGenerating(true);
  try {
    const oldCost = typeof storyPages[storyPages.length - 1]?.cost_usd === 'number'
      ? storyPages[storyPages.length - 1].cost_usd
      : 0;
    const data = await apiCall(`/stories/${currentStory.id}/pages/regenerate`, 'POST', {
      words: settings.wordsPerPage,
      ...(settings.model ? { model: settings.model } : {}),
      ...(reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
    });
    storyPages[storyPages.length - 1] = data.page;
    const newCost = typeof data.page?.cost_usd === 'number' ? data.page.cost_usd : 0;
    addCost(newCost - oldCost);
    document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
    discardSpeculative(); // the server dropped the old preview on regenerate
    displayCurrentPage();
  } catch (error) {
    showError(error.message);
    document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
  } finally {
    setGenerating(false);
  }
  maybeStartSpeculative(); // prepare the next one (generating has cleared)
}

async function deleteCurrentPage() {
  if (!currentStory || storyPages.length === 0) return;
  const page = storyPages.find((p) => p.page_number === currentPage);
  if (!page) return;
  if (!confirm(`Delete page ${currentPage}? This cannot be undone.`)) return;
  try {
    await apiCall(`/stories/${currentStory.id}/pages/${page.page_number}`, 'DELETE');
    discardSpeculative();
    await loadStoryPages();
    await loadStories();
    resetStoryCost();
    showSuccess('Page deleted.');
  } catch (error) {
    showError(error.message);
  }
}

async function exportStory() {
  if (!currentStory) {
    showError('Please select a story first.');
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/stories/${currentStory.id}/export`);
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentStory.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story'}.epub`;
    link.click();
    URL.revokeObjectURL(url);
    showSuccess('Story exported as EPUB.');
  } catch (error) {
    showError(error.message);
  }
}

// ---------------------------------------------------------------------------
// Narration (streaming page read-aloud)
// ---------------------------------------------------------------------------

let narrationState = 'idle'; // idle|starting|playing|paused|completed|failed
let narrationAuto = false; // keep flipping pages once each is narrated
let narrationAudio = null;
let narrationGenerationId = null;
let narrationCacheHit = false;
const appliedNarrationCosts = new Set(); // generation ids already billed this session
let speechModelsCache = null; // [{id, name, voices:[{id,label}]}]

function narrationConfigured() {
  return Boolean(settings.narrationModel && settings.narrationVoice);
}

function setNarrationState(state) {
  narrationState = state;
  const btn = document.getElementById('readAloudBtn');
  const stop = document.getElementById('narrationStopBtn');
  if (!btn || !stop) return;
  switch (state) {
    case 'starting':
      btn.textContent = 'Preparing…';
      stop.hidden = false;
      break;
    case 'playing':
      btn.textContent = 'Pause';
      stop.hidden = false;
      break;
    case 'paused':
      btn.textContent = 'Resume';
      stop.hidden = false;
      break;
    case 'completed':
      btn.textContent = 'Read again';
      stop.hidden = true;
      break;
    case 'failed':
      btn.textContent = 'Retry reading';
      stop.hidden = true;
      break;
    default:
      btn.textContent = 'Read aloud';
      stop.hidden = true;
  }
  btn.setAttribute('aria-label', 'Read the current page aloud' + (state === 'playing' ? ' (now playing)' : ''));
}

// Autoplay: once this page is narrated, flip to the next and keep reading
// until the tale runs out or the user stops.
function maybeAutoAdvanceNarration() {
  if (!narrationAuto || !currentStory) return;
  if (currentPage < storyPages.length) {
    setTimeout(() => {
      if (!narrationAuto || !currentStory) return; // user changed their mind meanwhile
      navigatePage(1); // also stops the finished playback cleanly
      startNarration();
    }, 350); // a breath between pages
  } else {
    showSuccess('The scribe has read to the end of the written tale.');
  }
}

function stopNarration() {
  if (narrationAudio) {
    narrationAudio.pause();
    narrationAudio.src = '';
    try { narrationAudio.load(); } catch { /* jsdom: not implemented */ }
    narrationAudio = null;
  }
  narrationGenerationId = null;
  if (narrationState !== 'idle') setNarrationState('idle');
}

// Apply the authoritative cost for a generation exactly once.
async function settleNarrationCost() {
  const id = narrationGenerationId;
  narrationGenerationId = null;
  if (!id || narrationCacheHit || appliedNarrationCosts.has(id)) return;
  appliedNarrationCosts.add(id);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const cost = await apiCall(`/ai/generation-cost?id=${encodeURIComponent(id)}`);
      if (typeof cost.cost_usd === 'number') {
        addCost(cost.cost_usd);
        return;
      }
      if (cost && cost.error && String(cost.error).includes('not ready')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue; // metadata not ready: bounded retry
      }
      return; // unexpected shape: give up quietly
    } catch (error) {
      return; // give up quietly; the ledger keeps other costs honest
    }
  }
}

function startNarration() {
  if (!narrationStateAllowsStart()) return;
  if (!narrationConfigured()) {
    showError('Narration is not configured — choose a speech model and voice in Settings.');
    showSection('settings');
    loadSpeechModels().then(renderNarrationSettings);
    return;
  }
  if (!currentStory || storyPages.length === 0 || currentPage > storyPages.length) {
    showError('Select a page to read first.');
    return;
  }
  stopNarration();

  setNarrationState('starting');
  const audio = new Audio();
  narrationAudio = audio;
  narrationCacheHit = false;
  fetch(`/api/stories/${currentStory.id}/pages/${currentPage}/narrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.narrationModel, voice: settings.narrationVoice }),
  })
    .then((response) => {
      if (!response.ok) {
        return response.json().then((body) => { throw new Error(body.error || `Narration failed (${response.status})`); });
      }
      narrationGenerationId = response.headers.get('X-Generation-Id');
      narrationCacheHit = response.headers.get('X-Narration-Cache') === 'hit';
      return response.blob();
    })
    .then((blob) => {
      if (narrationAudio !== audio) return; // superseded meanwhile
      audio.src = URL.createObjectURL(blob);
      const played = audio.play();
      if (played && played.catch) played.catch(() => setNarrationState('failed'));
    })
    .catch((error) => {
      if (narrationAudio !== audio) return;
      showError(scribeErrorMessage(error.message));
      setNarrationState('failed');
    });

  audio.addEventListener('playing', () => {
    if (narrationAudio === audio) setNarrationState('playing');
  });
  audio.addEventListener('ended', () => {
    if (narrationAudio === audio) {
      setNarrationState('completed');
      settleNarrationCost();
      maybeAutoAdvanceNarration();
    }
  });
  audio.addEventListener('error', () => {
    if (narrationAudio === audio) {
      setNarrationState('failed');
      settleNarrationCost();
    }
  });
}

function narrationStateAllowsStart() {
  return ['idle', 'completed', 'failed', 'paused'].includes(narrationState) ||
    (narrationState === 'playing');
}

function onReadAloudClick() {
  if (narrationState === 'playing') {
    if (narrationAudio) narrationAudio.pause();
    setNarrationState('paused');
    return;
  }
  if (narrationState === 'paused') {
    if (narrationAudio) {
      const played = narrationAudio.play();
      if (played && played.catch) played.catch(() => setNarrationState('failed'));
    }
    setNarrationState('playing');
    return;
  }
  startNarration();
}

// -- Settings: speech models + dependent voices -------------------------------

async function loadSpeechModels() {
  if (speechModelsCache) return speechModelsCache;
  try {
    const data = await apiCall('/speech-models');
    speechModelsCache = data.models || [];
  } catch {
    speechModelsCache = [];
    showError(scribeErrorMessage('Could not load the speech catalogue.'));
  }
  return speechModelsCache;
}

// Approximate USD cost of narrating one page with this model: input is priced
// per character (≈6.5 chars per word incl. spaces), some models also price
// output audio tokens (≈20 per word — measured against a live Gemini bill).
// At the mercy of honest rounding.
function estimateNarrationCostPerPage(model) {
  if (!model) return 0;
  const words = Number.isFinite(settings.wordsPerPage) ? settings.wordsPerPage : 400;
  const chars = words * 6.5;
  const audioTokens = words * 20;
  const p = model.pricing || {};
  const cost = (chars * (p.prompt_per_mchar || 0) + audioTokens * (p.completion_per_mtok || 0)) / 1e6;
  return Number.isFinite(cost) ? cost : 0;
}

function narrationOptionLabel(model) {
  const cost = estimateNarrationCostPerPage(model);
  return cost > 0 ? `${model.name} — ≈${formatUsd(cost)} per page` : `${model.name} — free`;
}

function renderNarrationSettings() {
  const modelSelect = document.getElementById('narrationModelSelect');
  const voiceSelect = document.getElementById('narrationVoiceSelect');
  if (!modelSelect || !voiceSelect) return;
  const models = speechModelsCache || [];

  modelSelect.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = models.length ? '— Choose a speech model —' : '— No speech models available —';
  modelSelect.appendChild(placeholder);
  models.forEach((m) => {
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = narrationOptionLabel(m);
    modelSelect.appendChild(option);
  });
  modelSelect.value = settings.narrationModel || '';
  modelSelect.disabled = models.length === 0;

  const selected = models.find((m) => m.id === settings.narrationModel);
  if (!selected) {
    // Saved model disappeared from the catalogue: narration is unconfigured.
    if (settings.narrationModel || settings.narrationVoice) {
      setSetting('narrationModel', null);
      setSetting('narrationVoice', null);
    }
  }
  populateNarrationVoices(selected, voiceSelect);
}

function populateNarrationVoices(modelEntry, voiceSelect) {
  voiceSelect.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = modelEntry ? '— Choose a voice —' : '— Choose a model first —';
  voiceSelect.appendChild(placeholder);
  if (modelEntry) {
    modelEntry.voices.forEach((v) => {
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.label;
      voiceSelect.appendChild(option);
    });
    const saved = modelEntry.voices.some((v) => v.id === settings.narrationVoice);
    voiceSelect.value = saved ? settings.narrationVoice : '';
  }
  voiceSelect.disabled = !modelEntry;
}

function initNarration() {
  const btn = document.getElementById('readAloudBtn');
  if (btn) btn.addEventListener('click', onReadAloudClick);
  const stopBtn = document.getElementById('narrationStopBtn');
  if (stopBtn) stopBtn.addEventListener('click', stopNarration);
  const autoBtn = document.getElementById('narrationAutoBtn');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      narrationAuto = !narrationAuto;
      autoBtn.setAttribute('aria-pressed', narrationAuto ? 'true' : 'false');
      autoBtn.classList.toggle('active', narrationAuto);
    });
  }

  const modelSelect = document.getElementById('narrationModelSelect');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      setSetting('narrationModel', modelSelect.value || null);
      // A new model invalidates the saved voice immediately.
      setSetting('narrationVoice', null);
      const selected = (speechModelsCache || []).find((m) => m.id === settings.narrationModel);
      populateNarrationVoices(selected, document.getElementById('narrationVoiceSelect'));
    });
  }
  const voiceSelect = document.getElementById('narrationVoiceSelect');
  if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
      setSetting('narrationVoice', voiceSelect.value || null);
    });
  }
  setNarrationState('idle');
}

// ---------------------------------------------------------------------------
// AI drafts (flesh out worlds and characters)
// ---------------------------------------------------------------------------

const DRAFT_FIELDS = {
  world: [
    { key: 'name', label: 'Name', kind: 'input', maxlength: 200 },
    { key: 'description', label: 'Description', kind: 'textarea', rows: 5, maxlength: 10000 },
    { key: 'genre', label: 'Genre', kind: 'input', maxlength: 100 },
    { key: 'setting', label: 'Setting', kind: 'input', maxlength: 200 },
  ],
  character: [
    { key: 'name', label: 'Name', kind: 'input', maxlength: 200 },
    { key: 'description', label: 'Description', kind: 'textarea', rows: 4, maxlength: 10000 },
    { key: 'personality', label: 'Personality', kind: 'textarea', rows: 3, maxlength: 10000 },
    { key: 'appearance', label: 'Appearance', kind: 'textarea', rows: 3, maxlength: 10000 },
    { key: 'background', label: 'Background', kind: 'textarea', rows: 3, maxlength: 10000 },
  ],
};

const DRAFT_LENGTH_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' };

let aiDraft = null;

function draftSeedValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function draftSeedFor(mode) {
  if (mode === 'world') {
    return {
      name: draftSeedValue('worldName'),
      description: draftSeedValue('worldDescription'),
      genre: draftSeedValue('worldGenre'),
      setting: draftSeedValue('worldSetting'),
    };
  }
  return {
    name: draftSeedValue('characterName'),
    description: draftSeedValue('characterDescription'),
    personality: draftSeedValue('characterPersonality'),
    appearance: draftSeedValue('characterAppearance'),
    background: draftSeedValue('characterBackground'),
    world_id: draftSeedValue('characterWorld') || null,
  };
}

function openAiDraft(mode) {
  const modal = document.getElementById('aiDraftModal');
  if (!modal) return;
  aiDraft = { mode, length: 'medium', variant: 1, data: null, generating: false };
  renderAiDraft();
  modal.hidden = false;
}

function closeAiDraft() {
  const modal = document.getElementById('aiDraftModal');
  if (modal) modal.hidden = true;
  aiDraft = null;
}

async function generateAiDraft() {
  if (!aiDraft || aiDraft.generating) return;
  aiDraft.generating = true;
  aiDraft.error = null;
  renderAiDraft();
  try {
    const seed = draftSeedFor(aiDraft.mode);
    const res = await apiCall(`/ai/${aiDraft.mode}`, 'POST', {
      ...seed,
      length: aiDraft.length,
      variant: aiDraft.variant,
      ...(settings.model ? { model: settings.model } : {}),
    });
    aiDraft.data = res[aiDraft.mode] || null;
    if (!aiDraft.data) aiDraft.error = 'The scribe offered nothing. Try again.';
    addSessionCost(res.cost_usd);
  } catch (error) {
    aiDraft.error = scribeErrorMessage(error.message);
  } finally {
    aiDraft.generating = false;
    renderAiDraft();
  }
}

function regenerateAiDraft() {
  if (!aiDraft || aiDraft.generating) return;
  aiDraft.variant += 1;
  generateAiDraft();
}

async function saveAiDraft() {
  if (!aiDraft || !aiDraft.data) return;
  const mode = aiDraft.mode;
  const fields = DRAFT_FIELDS[mode];
  const payload = {};
  for (const field of fields) {
    payload[field.key] = String(aiDraft.data[field.key] ?? '').trim();
  }
  if (!payload.name) {
    aiDraft.error = 'The scribe will not file an anonymous page — give it a name first.';
    renderAiDraft();
    return;
  }
  if (mode === 'character') {
    payload.world_id = draftSeedValue('characterWorld') || null;
  }
  try {
    await apiCall(mode === 'world' ? '/worlds' : '/characters', 'POST', payload);
    showSuccess(mode === 'world' ? 'World created.' : 'Character created.');
    // Clear the seed fields, like the manual create path does.
    const form = document.getElementById(mode === 'world' ? 'worldForm' : 'characterForm');
    if (form) form.reset();
    closeAiDraft();
    if (mode === 'world') await loadWorlds();
    else await loadCharacters();
  } catch (error) {
    aiDraft.error = scribeErrorMessage(error.message);
    renderAiDraft();
  }
}

function renderAiDraft() {
  const body = document.getElementById('aiDraftBody');
  if (!body || !aiDraft) return;
  const mode = aiDraft.mode;
  body.textContent = '';

  // Length choice
  const lengthWrap = document.createElement('div');
  lengthWrap.className = 'draft-length';
  const lengthLabel = document.createElement('span');
  lengthLabel.className = 'draft-length__label';
  lengthLabel.textContent = 'Draft length:';
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  for (const [value, label] of Object.entries(DRAFT_LENGTH_LABELS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn' + (aiDraft.length === value ? ' active' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', aiDraft.length === value ? 'true' : 'false');
    btn.addEventListener('click', () => {
      aiDraft.length = value;
      renderAiDraft();
    });
    seg.appendChild(btn);
  }
  lengthWrap.append(lengthLabel, seg);
  body.appendChild(lengthWrap);

  const hint = document.createElement('p');
  hint.className = 'draft-hint';
  hint.textContent = 'The scribe builds outward from your form fields as seeds — empty fields mean she invents freely. Edit the result, regenerate for a different take, or close this and save your own words as-is.';
  body.appendChild(hint);

  // In-modal failures are never hidden behind the overlay.
  if (aiDraft.error) {
    const errorLine = document.createElement('p');
    errorLine.className = 'draft-error';
    errorLine.textContent = aiDraft.error;
    body.appendChild(errorLine);
  }

  // Editable fields (present once a draft exists)
  if (aiDraft.data) {
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'draft-fields';
    for (const field of DRAFT_FIELDS[mode]) {
      const label = document.createElement('label');
      label.textContent = field.label;
      label.htmlFor = `draft-${field.key}`;
      let input;
      if (field.kind === 'textarea') {
        input = document.createElement('textarea');
        input.rows = field.rows;
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      input.id = `draft-${field.key}`;
      input.maxLength = field.maxlength;
      input.value = String(aiDraft.data[field.key] ?? '');
      input.addEventListener('input', () => {
        aiDraft.data[field.key] = input.value;
      });
      fieldsWrap.append(label, input);
    }
    body.appendChild(fieldsWrap);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'draft-actions';

  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.className = 'btn btn-primary';
  generateBtn.disabled = aiDraft.generating;
  generateBtn.textContent = aiDraft.generating
    ? 'The scribe is drafting…'
    : aiDraft.data
      ? `Regenerate — take ${aiDraft.variant + 1}`
      : 'Ask the scribe';
  generateBtn.addEventListener('click', () => {
    if (aiDraft.data) regenerateAiDraft();
    else generateAiDraft();
  });
  actions.appendChild(generateBtn);

  if (aiDraft.data) {
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = mode === 'world' ? 'Save as World' : 'Save as Character';
    saveBtn.addEventListener('click', saveAiDraft);
    actions.appendChild(saveBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-secondary';
  closeBtn.textContent = 'Close (keep my own words)';
  closeBtn.addEventListener('click', closeAiDraft);
  actions.appendChild(closeBtn);

  body.appendChild(actions);
}

function initAiDrafts() {
  const worldAi = document.getElementById('worldAiBtn');
  if (worldAi) worldAi.addEventListener('click', () => openAiDraft('world'));
  const characterAi = document.getElementById('characterAiBtn');
  if (characterAi) characterAi.addEventListener('click', () => openAiDraft('character'));
  const modal = document.getElementById('aiDraftModal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeAiDraft();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeAiDraft();
    });
  }
}

// ---------------------------------------------------------------------------
// Burn (truncate) everything after the current page
// ---------------------------------------------------------------------------

function openBurnModal() {
  const modal = document.getElementById('burnModal');
  const body = document.getElementById('burnBody');
  const slider = document.getElementById('burnSlider');
  if (!modal || !body || !slider) return;  const after = storyPages.length - currentPage;
  body.textContent =
    after === 1
      ? `1 page comes after Page ${currentPage}. It will be destroyed, and Page ${currentPage} becomes the end of the story. There is no recovery.`
      : `${after} pages come after Page ${currentPage}. They will be destroyed, and Page ${currentPage} becomes the end of the story. There is no recovery.`;
  slider.value = 0;
  updateBurnSliderFill(slider);
  modal.hidden = false;
  slider.focus();
}

function closeBurnModal() {
  const modal = document.getElementById('burnModal');
  if (modal) modal.hidden = true;
}

function updateBurnSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty('--burn-fill', pct + '%');
}

async function burnAfterCurrentPage() {
  if (!currentStory) return;
  const after = currentPage;
  try {
    const result = await apiCall(`/stories/${currentStory.id}/pages?after=${after}`, 'DELETE');
    discardSpeculative();
    stopNarration();
    await loadStoryPages();
    showSuccess(result.deleted === 1 ? '1 page burned.' : `${result.deleted} pages burned.`);
  } catch (error) {
    showError(error.message);
  }
}

// ---------------------------------------------------------------------------
// Scene image prompt: condense the current page into an image-gen prompt
// ---------------------------------------------------------------------------

const IMAGE_PROMPT_BUTTON_LABEL = 'Scene image';

// Paint the scene for real: the (user-edited) prompt drives Grok Imagine
// through OpenRouter, with the cast's reference portraits riding along as
// identity references. The bill lands in both the session and the story.
async function generateSceneImage() {
  if (!currentStory || currentPage < 1 || currentPage > storyPages.length) {
    showError('Select a page to illustrate first.');
    return;
  }
  const box = document.getElementById('imagePromptText');
  const btn = document.getElementById('imagePromptGenerateBtn');
  const img = document.getElementById('sceneImageResult');
  const costEl = document.getElementById('sceneImageCost');
  if (!box || !btn || !img) return;
  const prompt = box.value.trim();
  if (!prompt) {
    showError('The prompt box is empty — condense the scene first.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Painting…';
  img.hidden = true;
  img.removeAttribute('src');
  if (costEl) costEl.hidden = true;
  try {
    const data = await apiCall(`/stories/${currentStory.id}/pages/${currentPage}/scene-image`, 'POST', { prompt });
    img.src = `data:${data.media_type};base64,${data.image}`;
    img.hidden = false;
    if (costEl) {
      if (typeof data.cost_usd === 'number') {
        const refs = Array.isArray(data.references) ? data.references.length : 0;
        costEl.textContent =
          `This painting cost ${formatUsd(data.cost_usd)}` +
          (refs > 0 ? ` · ${refs} cast portrait${refs > 1 ? 's' : ''} as reference${refs > 1 ? 's' : ''}` : '');
        costEl.hidden = false;
        addCost(data.cost_usd); // scene images belong to the tale: session + story
      }
    }
  } catch (error) {
    showError(scribeErrorMessage(error.message));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate image';
  }
}

async function generateImagePrompt() {
  if (!currentStory || currentPage < 1 || currentPage > storyPages.length) {
    showError('Select a page to illustrate first.');
    return;
  }
  const btn = document.getElementById('imagePromptBtn');
  const modal = document.getElementById('imagePromptModal');
  const box = document.getElementById('imagePromptText');
  if (!modal || !box) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Thinking…';
  }
  try {
    const data = await apiCall(`/stories/${currentStory.id}/pages/${currentPage}/image-prompt`, 'POST', {
      ...(settings.model ? { model: settings.model } : {}),
      ...(reasoningApplies() ? { reasoning_effort: settings.reasoningEffort || 'medium' } : {}),
    });
    box.value = data.prompt || '';
    const img = document.getElementById('sceneImageResult');
    if (img) {
      img.hidden = true;
      img.removeAttribute('src');
    }
    const costEl = document.getElementById('sceneImageCost');
    if (costEl) costEl.hidden = true;
    modal.hidden = false;
    box.focus();
  } catch (error) {
    showError(scribeErrorMessage(error.message));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = IMAGE_PROMPT_BUTTON_LABEL;
    }
  }
}

function initImagePrompt() {
  const btn = document.getElementById('imagePromptBtn');
  if (btn) btn.addEventListener('click', generateImagePrompt);
  const generateBtn = document.getElementById('imagePromptGenerateBtn');
  if (generateBtn) generateBtn.addEventListener('click', generateSceneImage);
  const modal = document.getElementById('imagePromptModal');
  const cancel = document.getElementById('imagePromptCancelBtn');
  if (!modal || !cancel) return;
  cancel.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });
}

function initBurnModal() {
  const modal = document.getElementById('burnModal');
  const slider = document.getElementById('burnSlider');
  const cancel = document.getElementById('burnCancelBtn');
  const deleteAfter = document.getElementById('deleteAfterBtn');
  if (!modal || !slider || !cancel) return;

  if (deleteAfter) {
    deleteAfter.addEventListener('click', () => {
      if (currentStory && storyPages.length > 0 && currentPage < storyPages.length) openBurnModal();
    });
  }
  cancel.addEventListener('click', closeBurnModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeBurnModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeBurnModal();
  });
  slider.addEventListener('input', () => {
    updateBurnSliderFill(slider);
    if (Number(slider.value) >= Number(slider.max)) {
      closeBurnModal();
      burnAfterCurrentPage();
    }
  });
  updateBurnSliderFill(slider);
}

function resetStoryReader() {
  storyPages = [];
  currentPage = 1;
  displayCurrentPage();
  resetStoryCost();
}

// ---------------------------------------------------------------------------
// Bootstrap (browser + jest/jsdom)
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

// Exported for the Jest test suite (a no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initApp,
    showSection,
    apiCall,
    loadWorlds,
    loadCharacters,
    loadStories,
    loadStoryPages,
    renderWorlds,
    renderCharacters,
    renderStories,
    updateWorldSelects,
    renderCastBuilder,
    addCastMember,
    chooseMainCharacter,
    storyCast: () => storyCast.map((e) => ({ ...e })),
    updateStorySelect,
    handleWorldSubmit,
    handleCharacterSubmit,
    handleStorySubmit,
    handleStorySelection,
    displayCurrentPage,
    navigatePage,
    setGenerating,
    generateNextPage,
    retryLastPage,
    exportStory,
    deleteCurrentPage,
    resetStoryReader,
    openBurnModal,
    closeBurnModal,
    burnAfterCurrentPage,
    setWritingEnabled,
    openAiDraft,
    closeAiDraft,
    generateAiDraft,
    regenerateAiDraft,
    saveAiDraft,
    renderAiDraft,
    showError,
    scribeErrorMessage,
    maybeStartSpeculative,
    discardSpeculative,
    loadSpeechModels,
    renderNarrationSettings,
    __lastNarrationAudio: () => narrationAudio,
    __setModelsCache(models) { modelsCache = models; },
    // Scene image prompt
    generateImagePrompt,
    generateSceneImage,
    // Entity editors
    openCharacterEditor,
    saveCharacterEditor,
    openWorldEditor,
    saveWorldEditor,
    // Settings + cost ticker
    loadSettings,
    setSetting,
    applySettings,
    updateCostTicker,
    renderModelList,
    renderFontList,
    STORY_FONTS,
    loadModels,
    state: () => ({
      worlds, characters, stories, currentStory, currentPage, storyPages, generating,
      settings: { ...settings },
      costs: { session: sessionCost, story: storyCostBase + storyCostExtra },
    }),
    // Test hook: state() returns a snapshot; this lets tests drive the module directly.
    __setStoryState(patch) {
      if ('currentStory' in patch) {
        currentStory = patch.currentStory;
        resetStoryCost();
      }
      if ('currentPage' in patch) currentPage = patch.currentPage;
      if ('storyPages' in patch) storyPages = patch.storyPages;
    },
    SCRIBE_FLAVOR,
    API_BASE_URL,
  };
}