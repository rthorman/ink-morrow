// AI drafts: flesh out worlds and characters from the creation form's seed
// fields. Drafts stay editable inside the modal; saving creates the entity
// explicitly - generating a draft never silently creates data. Every draft
// pass uses the shared paid-consent gate; remembered consent bypasses its UI.

import { approxCostText, estimatePageCost } from '../core/cost.js';
import { wireModal } from '../core/dialogs.js';

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

export function createAiDrafts({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showSuccess, scribeErrorMessage } = notify;

  let aiDraft = null;
  let draftReviewing = false; // a paid-consent check is running: no second submission
  let aiDraftModal = null; // wired lifecycle controller

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
    aiDraftModal?.open(); // wired lifecycle: focus entry, scroll lock, opener
  }

  function closeAiDraft() {
    aiDraftModal?.close(); // restores the opener, unlocks the document
    aiDraft = null;
  }

  async function generateAiDraft() {
    if (!aiDraft || aiDraft.generating) return;
    if (draftReviewing) return;
    draftReviewing = true;
    const seed = draftSeedFor(aiDraft.mode);
    const seedChars = Object.values(seed).join(' ').length;
    const estimate = estimatePageCost({
      models: state.modelsCache,
      model: state.settings.model,
      wordsPerPage: 220, // a fleshed-out draft is a medium JSON document
      pageChars: seedChars,
    });
    // There can be two JSON draft passes, and each provider completion can
    // need up to three billable attempts before it yields usable text.
    const retryMaximum = typeof estimate === 'number' && Number.isFinite(estimate) ? estimate * 6 : null;
    // Initial draft and every regeneration pass the same consent gate; only
    // the first accepted paid action on this device opens the review.
    const yes = await dialogs.confirmPaid({
      title: aiDraft.variant > 1 ? 'Draft another variant?' : 'Flesh this out with the AI?',
      review: {
        action: `Write a ${DRAFT_LENGTH_LABELS[aiDraft.length].toLowerCase()} draft ${aiDraft.mode} from your seed fields.`,
        object: `a draft ${aiDraft.mode}${aiDraft.variant > 1 ? `, variant ${aiDraft.variant}` : ''}`,
        model: state.settings.model || 'the scribe\u2019s default model',
        quantity: `one ${DRAFT_LENGTH_LABELS[aiDraft.length].toLowerCase()} draft (up to two JSON passes; each may take three billable quality attempts)`,
        sends: 'the seed fields you filled in (name and whatever else you wrote)',
        estimate,
        maximum: retryMaximum,
        note: 'The draft only becomes a real ' + aiDraft.mode + ' when you save it. An invalid first answer is corrected once and both completions are billed.',
      },
      confirmLabel: `Draft it (${approxCostText(estimate)})`,
    });
    draftReviewing = false;
    if (!yes) return; // cancel: the modal and its seeds stand untouched
    aiDraft.generating = true;
    aiDraft.error = null;
    renderAiDraft();
    try {
      const res = await apiCall(`/ai/${aiDraft.mode}`, 'POST', {
        ...seed,
        length: aiDraft.length,
        variant: aiDraft.variant,
        ...(state.settings.model ? { model: state.settings.model } : {}),
      });
      aiDraft.data = res[aiDraft.mode] || null;
      if (!aiDraft.data) aiDraft.error = 'The scribe offered nothing. Try again.';
      state.addSessionCost(res.cost_usd);
    } catch (error) {
      state.addSessionCost(error.costUsd);
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
      if (mode === 'world') await features.worlds.loadWorlds();
      else await features.characters.loadCharacters();
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

  function init() {
    // One wired lifecycle; drafts are discardable without a guard.
    aiDraftModal = wireModal('aiDraftModal');
    const worldAi = document.getElementById('worldAiBtn');
    if (worldAi) worldAi.addEventListener('click', () => openAiDraft('world'));
    const characterAi = document.getElementById('characterAiBtn');
    if (characterAi) characterAi.addEventListener('click', () => openAiDraft('character'));
  }

  return { openAiDraft, closeAiDraft, generateAiDraft, regenerateAiDraft, saveAiDraft, renderAiDraft, init };
}
