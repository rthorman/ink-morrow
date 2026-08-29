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
});
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
  if (key === 'wordsPerPage') {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    value = Math.min(Math.max(n, WORDS_MIN), WORDS_MAX);
  }
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
  const wordsInput = document.getElementById('wordsPerPageInput');
  if (wordsInput) wordsInput.value = String(settings.wordsPerPage);
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

// Non-story AI usage (world/character drafts) still counts toward the session.
function addSessionCost(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
  sessionCost += costUsd;
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
      setSetting('model', settings.model === m.id ? null : m.id);
      renderModelList();
    });
    list.appendChild(item);
  });
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
  document.getElementById('storyWorld').addEventListener('change', updateCharacterCheckboxes);

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
    });
  }
  const modelSearch = document.getElementById('modelSearch');
  if (modelSearch) modelSearch.addEventListener('input', renderModelList);
  const modelReset = document.getElementById('modelResetBtn');
  if (modelReset) {
    modelReset.addEventListener('click', () => {
      setSetting('model', null);
      renderModelList();
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

  applySettings();
  initBurnModal();
  initAiDrafts();

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
  setTimeout(() => div.remove(), 5000);
}

function showError(message) {
  showMessage(message, 'error');
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
    renderWorlds();
    updateWorldSelects();
  } catch (error) {
    showError(error.message);
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

    card.append(title, desc, meta, del);
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
    renderCharacters();
    updateCharacterCheckboxes();
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

    card.append(title, desc, meta, del);
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

// Only show characters from the chosen world first, but keep others selectable
// (cross-world casting is allowed). Each cast row carries a tier:
// 'mc' (the one protagonist), 'supporting', or 'background'.
let castRoles = new Map(); // character id -> role (persisted across re-renders)

const CAST_ROLE_OPTIONS = [
  { value: 'supporting', label: 'Supporting' },
  { value: 'mc', label: 'MC' },
  { value: 'background', label: 'Background' },
];

function updateCharacterCheckboxes() {
  const container = document.getElementById('characterCheckboxes');
  if (!container) return;
  const storyWorld = document.getElementById('storyWorld')?.value || '';
  const previouslyChecked = new Set(
    [...container.querySelectorAll('input:checked')].map((input) => input.value)
  );

  container.textContent = '';
  const ordered = [
    ...characters.filter((c) => c.world_id === storyWorld),
    ...characters.filter((c) => c.world_id !== storyWorld),
  ];

  if (ordered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'No characters exist yet.';
    container.appendChild(empty);
    return;
  }

  ordered.forEach((character, index) => {
    const row = document.createElement('div');
    row.className = 'cast-row';

    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = character.id;
    checkbox.checked = previouslyChecked.has(character.id);
    if (character.world_id === storyWorld && storyWorld && index < ordered.filter((c) => c.world_id === storyWorld).length) {
      checkbox.classList.add('in-world');
    }
    const name = document.createElement('span');
    const otherWorld = Boolean(character.world_id) && character.world_id !== storyWorld;
    name.textContent = character.name + (otherWorld ? ' (other world)' : '');
    label.append(checkbox, name);

    const role = document.createElement('select');
    role.className = 'cast-role';
    role.dataset.characterId = character.id;
    role.setAttribute('aria-label', `Role of ${character.name} in this story`);
    role.disabled = !checkbox.checked;
    CAST_ROLE_OPTIONS.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      role.appendChild(option);
    });
    role.value = castRoles.get(character.id) || 'supporting';
    role.addEventListener('change', () => {
      if (role.value === 'mc') {
        // One MC per story: demote any other protagonist.
        castRoles.forEach((r, id) => {
          if (r === 'mc' && id !== character.id) castRoles.set(id, 'supporting');
        });
      }
      castRoles.set(character.id, role.value);
      refreshCastRoleSelects(container);
    });
    checkbox.addEventListener('change', () => {
      role.disabled = !checkbox.checked;
      if (checkbox.checked && !castRoles.has(character.id)) castRoles.set(character.id, 'supporting');
    });

    row.append(label, role);
    container.appendChild(row);
  });
}

function refreshCastRoleSelects(container) {
  const scope = container || document.getElementById('characterCheckboxes');
  if (!scope) return;
  scope.querySelectorAll('.cast-role').forEach((select) => {
    select.value = castRoles.get(select.dataset.characterId) || 'supporting';
  });
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
  const cast = [...document.querySelectorAll('#characterCheckboxes input:checked')].map((i) => ({
    id: i.value,
    role: castRoles.get(i.value) || 'supporting',
  }));
  try {
    const data = await apiCall('/stories', 'POST', {
      title: document.getElementById('storyTitle').value,
      world_id: document.getElementById('storyWorld').value || null,
      tone: document.getElementById('storyTone').value,
      characters: cast,
    });
    form.reset();
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
  currentPage = Math.max(1, Math.min(storyPages.length, currentPage + direction));
  displayCurrentPage();
}

function setGenerating(active) {
  generating = active;
  for (const id of ['generateBtn', 'retryBtn']) {
    document.getElementById(id).disabled = active;
  }
  document.getElementById('generateBtn').textContent = active ? 'The scribe is writing…' : 'Generate Page';

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
  setGenerating(true);
  try {
    const data = await apiCall(`/stories/${currentStory.id}/pages/generate`, 'POST', {
      user_input: userInput || null,
      words: settings.wordsPerPage,
      ...(settings.model ? { model: settings.model } : {}),
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
    });
    storyPages[storyPages.length - 1] = data.page;
    const newCost = typeof data.page?.cost_usd === 'number' ? data.page.cost_usd : 0;
    addCost(newCost - oldCost);
    document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
    displayCurrentPage();
  } catch (error) {
    showError(error.message);
    document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
  } finally {
    setGenerating(false);
  }
}

async function deleteCurrentPage() {
  if (!currentStory || storyPages.length === 0) return;
  const page = storyPages.find((p) => p.page_number === currentPage);
  if (!page) return;
  if (!confirm(`Delete page ${currentPage}? This cannot be undone.`)) return;
  try {
    await apiCall(`/stories/${currentStory.id}/pages/${page.page_number}`, 'DELETE');
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
    addSessionCost(res.cost_usd);
  } catch (error) {
    showError(error.message);
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
    showError('A name is required before saving.');
    return;
  }
  if (mode === 'character') {
    payload.world_id = draftSeedValue('characterWorld') || null;
  }
  try {
    await apiCall(mode === 'world' ? '/worlds' : '/characters', 'POST', payload);
    showSuccess(mode === 'world' ? 'World created.' : 'Character created.');
    closeAiDraft();
    if (mode === 'world') await loadWorlds();
    else await loadCharacters();
  } catch (error) {
    showError(error.message);
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
  hint.textContent = 'The scribe builds outward from your form fields as seeds. Edit the result below, regenerate for a different take — or close this and save your own words as-is.';
  body.appendChild(hint);

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
    await loadStoryPages();
    showSuccess(result.deleted === 1 ? '1 page burned.' : `${result.deleted} pages burned.`);
  } catch (error) {
    showError(error.message);
  }
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
    updateCharacterCheckboxes,
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