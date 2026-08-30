// Settings: the writing-model catalogue, reasoning effort, story fonts and
// sizes, the narration (speech) catalogue with per-page cost labels, and the
// persisted presentation preferences. Every change saves immediately.

import { formatUsd } from '../core/dom.js';
import { STORY_FONTS } from '../core/state.js';

export function createSettings({ api, state, notify, shell }) {
  const { apiCall } = api;
  const { showError } = notify;

  async function loadModels() {
    if (state.modelsCache) return state.modelsCache;
    try {
      const data = await apiCall('/models');
      state.modelsCache = data.models || [];
    } catch (error) {
      state.modelsCache = [];
      const list = document.getElementById('modelList');
      if (list) {
        list.textContent = '';
        const p = document.createElement('p');
        p.className = 'placeholder';
        p.textContent = `Could not load the model catalog (${error.message}). Try again later.`;
        list.appendChild(p);
      }
    }
    return state.modelsCache;
  }

  async function loadSpeechModels() {
    if (state.speechModelsCache) return state.speechModelsCache;
    try {
      const data = await apiCall('/speech-models');
      state.speechModelsCache = data.models || [];
    } catch {
      state.speechModelsCache = [];
      showError(notify.scribeErrorMessage('Could not load the speech catalogue.'));
    }
    return state.speechModelsCache;
  }

  // Reasoning level: only shown when the selected model can think first.
  function selectedModelEntry() {
    if (!state.settings.model || !state.modelsCache) return null;
    return state.modelsCache.find((m) => m.id === state.settings.model) || null;
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
      if (!state.settings.reasoningEffort) state.setSetting('reasoningEffort', 'medium');
      select.value = state.settings.reasoningEffort || 'medium';
    } else if (state.settings.reasoningEffort) {
      state.setSetting('reasoningEffort', null); // carried thoughts don't fit this model
    }
  }

  function updateCurrentModelLabel() {
    const label = document.getElementById('currentModel');
    if (!label) return;
    label.textContent = state.settings.model
      ? `Selected: ${state.settings.model}`
      : 'Using the server default model';
  }

  function renderModelList() {
    const list = document.getElementById('modelList');
    if (!list) return;
    const query = (document.getElementById('modelSearch')?.value || '').toLowerCase().trim();
    list.textContent = '';

    const models = state.modelsCache || [];
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
      item.className = 'model-item' + (state.settings.model === m.id ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', state.settings.model === m.id ? 'true' : 'false');

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
        const switching = state.settings.model !== m.id;
        state.setSetting('model', state.settings.model === m.id ? null : m.id);
        if (switching && !m.reasoning) state.setSetting('reasoningEffort', null); // carried thoughts don't fit this model
        renderModelList();
      });
      list.appendChild(item);
    });
    updateReasoningBlock();
  }

  function renderFontList() {
    const list = document.getElementById('fontList');
    if (!list) return;
    list.textContent = '';
    Object.entries(STORY_FONTS).forEach(([id, font]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'font-item' + (state.settings.storyFont === id ? ' selected' : '');
      item.style.fontFamily = font.stack;
      item.setAttribute('aria-pressed', state.settings.storyFont === id ? 'true' : 'false');
      const sample = document.createElement('span');
      sample.className = 'font-item__sample';
      sample.textContent = 'Ag';
      const label = document.createElement('span');
      label.className = 'font-item__label';
      label.textContent = font.label;
      item.append(sample, label);
      item.addEventListener('click', () => {
        state.setSetting('storyFont', id);
      });
      list.appendChild(item);
    });
  }

  // Approximate USD cost of narrating one page with this model: input is priced
  // per character (≈6.5 chars per word incl. spaces), some models also price
  // output audio tokens (≈20 per word — measured against a live Gemini bill).
  // At the mercy of honest rounding.
  function estimateNarrationCostPerPage(model) {
    if (!model) return 0;
    const words = Number.isFinite(state.settings.wordsPerPage) ? state.settings.wordsPerPage : 400;
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
      const saved = modelEntry.voices.some((v) => v.id === state.settings.narrationVoice);
      voiceSelect.value = saved ? state.settings.narrationVoice : '';
    }
    voiceSelect.disabled = !modelEntry;
  }

  function renderNarrationSettings() {
    const modelSelect = document.getElementById('narrationModelSelect');
    const voiceSelect = document.getElementById('narrationVoiceSelect');
    if (!modelSelect || !voiceSelect) return;
    const models = state.speechModelsCache || [];

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
    modelSelect.value = state.settings.narrationModel || '';
    modelSelect.disabled = models.length === 0;

    const selected = models.find((m) => m.id === state.settings.narrationModel);
    if (!selected) {
      // Saved model disappeared from the catalogue: narration is unconfigured.
      if (state.settings.narrationModel || state.settings.narrationVoice) {
        state.setSetting('narrationModel', null);
        state.setSetting('narrationVoice', null);
      }
    }
    populateNarrationVoices(selected, voiceSelect);
    // Catalogue loading is asynchronous; refresh the collapsed summary only
    // after the saved model can actually be resolved.
    updateGroupSummaries();
  }

  let savedNoticeTimer = null;

  function announceSaved() {
    const saved = document.getElementById('settingsSaved');
    if (!saved) return;
    saved.textContent = 'Saved on this device';
    if (savedNoticeTimer) clearTimeout(savedNoticeTimer);
    savedNoticeTimer = setTimeout(() => {
      saved.textContent = '';
    }, 2500);
  }

  // Compact summaries: what each group is set to, without opening it.
  function updateGroupSummaries() {
    const writing = document.getElementById('writingAiSummary');
    if (writing) {
      const model = state.settings.model || 'Server default model';
      writing.textContent = `${model} · ≈${state.settings.wordsPerPage} words per page`;
    }
    const narration = document.getElementById('narrationSummary');
    if (narration) {
      const entry = (state.speechModelsCache || []).find((m) => m.id === state.settings.narrationModel);
      narration.textContent = entry
        ? `${entry.name} · ${state.settings.narrationVoice || 'no voice chosen'}`
        : 'No narrator chosen';
    }
    const reading = document.getElementById('readingSummary');
    if (reading) {
      const font = STORY_FONTS[state.settings.storyFont] || STORY_FONTS.literata;
      reading.textContent = `${font.label} · ${state.settings.storyFontSize}px`;
    }
  }

  function init() {
    // applySettings re-renders: labels, fonts, narration per-page costs,
    // group summaries; every change is acknowledged politely.
    state.onApplySettings(() => {
      updateCurrentModelLabel();
      renderFontList();
      if (state.speechModelsCache) renderNarrationSettings(); // per-page cost labels track the word target
      updateGroupSummaries();
      announceSaved();
    });
    updateGroupSummaries();

    const modelSearch = document.getElementById('modelSearch');
    if (modelSearch) modelSearch.addEventListener('input', renderModelList);
    const modelReset = document.getElementById('modelResetBtn');
    if (modelReset) {
      modelReset.addEventListener('click', () => {
        state.setSetting('model', null);
        state.setSetting('reasoningEffort', null);
        renderModelList();
      });
    }
    const reasoningSelect = document.getElementById('reasoningSelect');
    if (reasoningSelect) {
      reasoningSelect.addEventListener('change', () => {
        state.setSetting('reasoningEffort', reasoningSelect.value || null);
      });
    }
    const bgToggle = document.getElementById('scriptoriumBgToggle');
    if (bgToggle) bgToggle.addEventListener('change', () => state.setSetting('scriptoriumBg', bgToggle.checked));
    const tickerToggle = document.getElementById('costTickerToggle');
    if (tickerToggle) tickerToggle.addEventListener('change', () => state.setSetting('costTicker', tickerToggle.checked));
    const wordsInput = document.getElementById('wordsPerPageInput');
    if (wordsInput) {
      wordsInput.addEventListener('change', () => state.setSetting('wordsPerPage', wordsInput.value));
    }
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) {
      fontSizeSelect.addEventListener('change', () => state.setSetting('storyFontSize', fontSizeSelect.value));
    }
    const modelSelect = document.getElementById('narrationModelSelect');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        state.setSetting('narrationModel', modelSelect.value || null);
        // A new model invalidates the saved voice immediately.
        state.setSetting('narrationVoice', null);
        const selected = (state.speechModelsCache || []).find((m) => m.id === state.settings.narrationModel);
        populateNarrationVoices(selected, document.getElementById('narrationVoiceSelect'));
      });
    }
    const voiceSelect = document.getElementById('narrationVoiceSelect');
    if (voiceSelect) {
      voiceSelect.addEventListener('change', () => {
        state.setSetting('narrationVoice', voiceSelect.value || null);
      });
    }
  }

  return {
    loadModels,
    loadSpeechModels,
    selectedModelEntry,
    reasoningApplies,
    updateReasoningBlock,
    updateCurrentModelLabel,
    renderModelList,
    renderFontList,
    estimateNarrationCostPerPage,
    narrationOptionLabel,
    renderNarrationSettings,
    init,
  };
}
