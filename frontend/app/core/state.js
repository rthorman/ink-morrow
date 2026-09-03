// The one small cross-feature state container: shared durable session data
// (collections, current story/reader position, settings, cost ledger,
// model catalogues). Transient view state stays inside the owning feature.
// Plain get/set + change listeners - no reducer/action framework.

const SETTINGS_KEY = 'im-settings';
export const DEFAULT_SETTINGS = Object.freeze({
  model: null,
  costTicker: true,
  storyFont: 'literata',
  wordsPerPage: 400,
  narrationModel: null,
  narrationVoice: null,
  reasoningEffort: null,
  storyFontSize: 18,
  sceneRenderQuality: 'low_1k',
});
export const SCENE_RENDER_VARIANTS = new Set(['low_1k', 'medium_2k']);
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 24;
export const WORDS_MIN = 50;
export const WORDS_MAX = 2000;

// Typeface presets for the story reading/writing window.
export const STORY_FONTS = {
  literata: { label: 'Literata', stack: 'Literata, Charter, Georgia, serif' },
  cormorant: { label: 'Cormorant Garamond', stack: '"Cormorant Garamond", Georgia, serif' },
  georgia: { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  inter: { label: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  mono: { label: 'IBM Plex Mono', stack: '"IBM Plex Mono", ui-monospace, monospace' },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const clean = Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
        .map(([key, fallback]) => [key, Object.hasOwn(stored, key) ? stored[key] : fallback]));
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean)); } catch { /* keep clean settings in memory */ }
      return clean;
    }
  } catch {
    // private mode / corrupt value - fall back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function createSharedState() {
  // Collections and reader state - shared across features.
  const data = {
    worlds: [],
    characters: [],
    scribes: [],
    stories: [],
    currentStory: null,
    currentPage: 1,
    storyPages: [],
    storyAssets: { assets: [], placements: [] },
    generating: false,
  };

  let settings = loadSettings();
  let modelsCache = null; // writing models
  let speechModelsCache = null; // TTS catalogue

  // Cost ledger (USD): session total + current-story extras. Story totals
  // re-read from the server keep it honest.
  let sessionCost = 0;
  let storyCostBase = 0;
  let storyCostExtra = 0;
  // Reference-image costs are booked exactly once per generation (per entity
  // + image_updated_at), whenever the session observes the finished image.
  const chargedImages = new Set();

  // Re-render hooks invoked after settings change (features register theirs).
  const applyHooks = [];

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // private mode - settings live for this session only
    }
  }

  function updateCostTicker() {
    const elx = document.getElementById('costTicker');
    if (!elx) return;
    elx.hidden = !settings.costTicker;
    if (!settings.costTicker) return;
    const fmt = (value) => {
      const v = Number(value) || 0;
      return '$' + (v >= 1 ? v.toFixed(2) : v.toFixed(4));
    };
    elx.textContent = `Session ${fmt(sessionCost)} · Manuscript ${fmt(storyCostBase + storyCostExtra)}`;
  }

  function applySettings() {
    const tickerToggle = document.getElementById('costTickerToggle');
    if (tickerToggle) tickerToggle.checked = Boolean(settings.costTicker);
    const font = STORY_FONTS[settings.storyFont] || STORY_FONTS.literata;
    document.documentElement.style.setProperty('--im-prose-family', font.stack);
    const fontSize = Math.min(Math.max(parseInt(settings.storyFontSize, 10) || 18, FONT_SIZE_MIN), FONT_SIZE_MAX);
    document.documentElement.style.setProperty('--im-prose-size', fontSize + 'px');
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) fontSizeSelect.value = String(fontSize);
    const wordsInput = document.getElementById('wordsPerPageInput');
    if (wordsInput) wordsInput.value = String(settings.wordsPerPage);
    const renderSelect = document.getElementById('imageQualitySelect');
    if (renderSelect) renderSelect.value = SCENE_RENDER_VARIANTS.has(settings.sceneRenderQuality) ? settings.sceneRenderQuality : 'low_1k';
    for (const hook of applyHooks) {
      try { hook(); } catch { /* a feature's re-render must not break the rest */ }
    }
    updateCostTicker();
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
    if (key === 'sceneRenderQuality' && !SCENE_RENDER_VARIANTS.has(value)) return;
    if (settings[key] === value) return; // no change: nothing to apply or persist
    settings[key] = value;
    saveSettings();
    applySettings();
  }

  // Full backups may carry the same intentionally-small settings whitelist.
  // The server strips credentials and consent flags; this method still feeds
  // every value through the ordinary client validators before persisting it.
  function restoreSettings(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return;
    for (const [key, value] of Object.entries(values)) setSetting(key, value);
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

  function addCost(costUsd) {
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
    sessionCost += costUsd;
    storyCostExtra += costUsd;
    updateCostTicker();
  }

  // Async work belongs to the story that started it, not whichever story is
  // open when the response arrives. Session spend is always counted; the
  // visible Story ticker changes only when it still represents that story.
  function addCostForStory(storyId, costUsd) {
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
    sessionCost += costUsd;
    if (data.currentStory?.id === storyId) storyCostExtra += costUsd;
    updateCostTicker();
  }

  function addStoryCostForStory(storyId, costUsd) {
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return;
    if (data.currentStory?.id === storyId) storyCostExtra += costUsd;
    updateCostTicker();
  }

  function resetStoryCost() {
    storyCostBase = typeof data.currentStory?.total_cost_usd === 'number' ? data.currentStory.total_cost_usd : 0;
    storyCostExtra = 0;
    updateCostTicker();
  }

  function chargeEntityImageCosts(rows, kind) {
    for (const row of rows || []) {
      if (row.image_status !== 'ready' || typeof row.image_cost_usd !== 'number') continue;
      const key = `${kind}/${row.id}@${row.image_updated_at}`;
      if (chargedImages.has(key)) continue;
      chargedImages.add(key);
      addSessionCost(row.image_cost_usd);
    }
  }

  function onApplySettings(hook) {
    applyHooks.push(hook);
  }

  function clearPrivateData() {
    data.worlds = [];
    data.characters = [];
    data.scribes = [];
    data.stories = [];
    data.currentStory = null;
    data.currentPage = 1;
    data.storyPages = [];
    data.storyAssets = { assets: [], placements: [] };
    data.generating = false;
    modelsCache = null;
    speechModelsCache = null;
    sessionCost = 0;
    storyCostBase = 0;
    storyCostExtra = 0;
    chargedImages.clear();
    updateCostTicker();
  }

  return {
    data,
    get settings() { return settings; },
    setSetting,
    restoreSettings,
    applySettings,
    onApplySettings,
    updateCostTicker,
    resetStoryCost,
    addCost,
    addCostForStory,
    addSessionCost,
    addStoryCost,
    addStoryCostForStory,
    chargeEntityImageCosts,
    clearPrivateData,
    get modelsCache() { return modelsCache; },
    set modelsCache(value) { modelsCache = value; },
    get speechModelsCache() { return speechModelsCache; },
    set speechModelsCache(value) { speechModelsCache = value; },
    state() {
      return {
        worlds: data.worlds,
        characters: data.characters,
        scribes: data.scribes,
        stories: data.stories,
        currentStory: data.currentStory,
        currentPage: data.currentPage,
        storyPages: data.storyPages,
        storyAssets: data.storyAssets,
        generating: data.generating,
        settings: { ...settings },
        costs: { session: sessionCost, story: storyCostBase + storyCostExtra },
      };
    },
    __setModelsCache(models) { modelsCache = models; },
  };
}
