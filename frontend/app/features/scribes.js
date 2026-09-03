// The Tribe: first-class, versioned Scribes. Every Scribe is an adult
// catgirl by server-owned canon; the editable profile describes identity and
// craft rather than a named-author imitation.

import { approxCostText, estimatePageCost } from '../core/cost.js';
import { beginButtonBusy } from '../core/dom.js';
import { wireModal } from '../core/dialogs.js';
import { IMAGE_COST_ESTIMATE } from '../components/entity-card.js';

const IMAGE_ESTIMATE = IMAGE_COST_ESTIMATE.scribe;
const FOCUS_AREAS = [
  'interiority', 'relationships', 'dialogue', 'action', 'sensory-detail', 'setting',
  'world-systems', 'mystery', 'theme', 'humor', 'consequences',
];
const FIELD_SUFFIX = {
  name: 'Name', description: 'Description', personality: 'Personality', appearance: 'Appearance',
  background: 'Background', feline_traits: 'FelineTraits', diction: 'Diction',
  sentence_rhythm: 'SentenceRhythm', narrative_distance: 'NarrativeDistance',
  figurative_language: 'FigurativeLanguage', description_density: 'DescriptionDensity',
  dialogue_tendency: 'DialogueTendency', exposition_style: 'ExpositionStyle', humor: 'Humor',
  scene_tempo: 'SceneTempo', progress_appetite: 'ProgressAppetite',
  tension_tolerance: 'TensionTolerance', aftermath_dwell: 'AftermathDwell',
  signature_habits: 'SignatureHabits', avoidances: 'Avoidances', image_prompt: 'ImagePrompt',
};

export function createScribes({ api, state, notify, catalogPoll, entityCard, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let editor = null;
  let editingId = null;
  let editorSnapshot = null;
  let reviewing = false;
  let aiOperationRunning = false;

  const idFor = (prefix, key) => `${prefix}${FIELD_SUFFIX[key]}`;
  const formElement = (prefix, key) => document.getElementById(idFor(prefix, key));

  function renderFocus(prefix, selected = []) {
    const container = document.getElementById(`${prefix}FocusAreas`);
    if (!container) return;
    container.textContent = '';
    for (const area of FOCUS_AREAS) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = area;
      input.checked = selected.includes(area);
      label.append(input, document.createTextNode(area.replaceAll('-', ' ')));
      container.appendChild(label);
    }
  }

  function focusValues(prefix) {
    return [...document.querySelectorAll(`#${prefix}FocusAreas input:checked`)].map((input) => input.value);
  }

  function values(prefix, { includeImagePrompt = false } = {}) {
    const result = { entity_kind: 'catgirl' };
    for (const key of Object.keys(FIELD_SUFFIX)) {
      if (key === 'image_prompt' && !includeImagePrompt) continue;
      const element = formElement(prefix, key);
      if (element) result[key] = element.value;
    }
    result.focus_areas = focusValues(prefix);
    return result;
  }

  function populate(prefix, scribe) {
    for (const key of Object.keys(FIELD_SUFFIX)) {
      const element = formElement(prefix, key);
      if (element) element.value = scribe[key] || '';
    }
    renderFocus(prefix, scribe.focus_areas || []);
  }

  function updateStartSelect() {
    const select = document.getElementById('startScribe');
    if (!select) return;
    const wanted = select.value;
    select.textContent = '';
    const neutral = document.createElement('option');
    neutral.value = '';
    neutral.textContent = 'No Scribe — neutral house craft';
    select.appendChild(neutral);
    for (const scribe of state.data.scribes) {
      const option = document.createElement('option');
      option.value = scribe.id;
      option.textContent = `${scribe.name} — revision ${scribe.revision_number}`;
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
  }

  async function loadScribes() {
    try {
      const result = await apiCall('/scribes');
      state.data.scribes = result.scribes || [];
      state.chargeEntityImageCosts(state.data.scribes, 'scribe');
      renderScribes();
      updateStartSelect();
      catalogPoll.schedule();
    } catch (error) {
      showError(error.message);
    }
  }

  function craftSummary(scribe) {
    const focus = (scribe.focus_areas || []).map((item) => item.replaceAll('-', ' ')).join(', ');
    return [
      `${scribe.diction} diction`, `${scribe.sentence_rhythm} rhythm`,
      `${scribe.scene_tempo} scenes`, `${scribe.progress_appetite} plot movement`,
      focus ? `favors ${focus}` : null,
    ].filter(Boolean).join(' · ');
  }

  function renderScribes() {
    const container = document.getElementById('scribesList');
    if (!container) return;
    container.textContent = '';
    if (!state.data.scribes.length) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = 'The desks are quiet. Welcome the first Scribe to the Tribe.';
      container.appendChild(empty);
      return;
    }
    for (const scribe of state.data.scribes) {
      const card = document.createElement('article');
      card.className = 'item-card';
      card.tabIndex = 0;
      const title = document.createElement('h4');
      title.textContent = scribe.name;
      const description = document.createElement('p');
      description.className = 'item-card__desc';
      description.textContent = scribe.description || scribe.personality || 'A Scribe of the Ink Morrow Tribe.';
      const craft = document.createElement('p');
      craft.className = 'scribe-craft-summary';
      craft.textContent = craftSummary(scribe);
      const version = document.createElement('div');
      version.className = 'item-meta';
      version.textContent = `Adult catgirl · revision ${scribe.revision_number}`;
      const repaint = async () => {
        if (reviewing) return;
        reviewing = true;
        const yes = await dialogs.confirmPaid({
          title: `Repaint ${scribe.name}?`,
          review: {
            action: 'Paint a new full-body reference portrait.', object: `Scribe "${scribe.name}"`,
            quantity: 'one 1K portrait painting',
            sends: 'her identity, appearance, feline traits, craft cues, and portrait direction', estimate: IMAGE_ESTIMATE,
            note: 'The server always adds the adult-catgirl anatomy contract to the portrait prompt.',
          },
          confirmLabel: `Repaint her (${approxCostText(IMAGE_ESTIMATE)})`,
        });
        reviewing = false;
        if (!yes) return;
        try {
          await apiCall(`/scribes/${scribe.id}/image`, 'POST');
          await loadScribes();
        } catch (error) { showError(error.message); }
      };
      const remove = async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Remove ${scribe.name} from the Tribe?`,
          body: 'Her Library record and portrait will be deleted. Manuscripts and page revisions keep their immutable frozen copies of her craft signature.',
          confirmLabel: 'Remove Scribe',
        });
        if (!yes) return;
        try {
          await apiCall(`/scribes/${scribe.id}`, 'DELETE');
          showSuccess('Scribe removed. Bound manuscript history was preserved.');
          await loadScribes();
        } catch (error) { showError(error.message); }
      };
      card.append(
        title,
        entityCard.entityImageBlock('scribe', scribe, `Reference portrait of Scribe ${scribe.name}`),
        description, craft, version,
        entityCard.cardActions({
          name: scribe.name, kind: 'scribe', onEdit: () => openEditor(scribe),
          onRegenerate: repaint, onExport: () => features.transfer.openExport({ scope: 'scribe', id: scribe.id }), onDelete: remove,
        })
      );
      card.addEventListener('click', (event) => {
        if (!event.target.closest('button, details, a')) openEditor(scribe);
      });
      card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, details, a')) {
          event.preventDefault();
          openEditor(scribe);
        }
      });
      container.appendChild(card);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const withoutImage = event.submitter?.id === 'scribeNoImageBtn';
    const payload = values('scribe');
    if (!withoutImage) {
      if (reviewing) return;
      reviewing = true;
      const yes = await dialogs.confirmPaid({
        title: 'Welcome this Scribe and paint her portrait?',
        review: {
          action: 'Create the versioned Scribe, then paint her reference portrait.',
          object: `Scribe "${payload.name || '(unnamed)'}"`, quantity: 'one 1K portrait painting',
          sends: 'her identity, appearance, feline traits, and craft signature', estimate: IMAGE_ESTIMATE,
          note: '“Create without image” skips the painting. Every Scribe remains an adult catgirl by server-owned canon.',
        },
        confirmLabel: `Welcome & paint (${approxCostText(IMAGE_ESTIMATE)})`,
      });
      reviewing = false;
      if (!yes) return;
    }
    try {
      await apiCall('/scribes', 'POST', { ...payload, generate_image: !withoutImage });
      document.getElementById('scribeForm').reset();
      renderFocus('scribe');
      await loadScribes();
      showSuccess(withoutImage ? 'Scribe welcomed to the Tribe.' : 'Scribe welcomed — her portrait is being painted.');
    } catch (error) { showError(error.message); }
  }

  function openEditor(scribe) {
    editingId = scribe.id;
    populate('scribeEdit', scribe);
    editorSnapshot = JSON.stringify(values('scribeEdit', { includeImagePrompt: true }));
    editor.open();
  }

  function closeEditor() {
    editor.close();
    editingId = null;
    editorSnapshot = null;
  }

  function requestClose() {
    if (!editingId || editorSnapshot === JSON.stringify(values('scribeEdit', { includeImagePrompt: true }))) {
      closeEditor();
      return;
    }
    dialogs.confirmDestructive({
      title: 'Discard changes?', body: 'This unsaved Scribe revision will be lost.', confirmLabel: 'Discard changes',
    }).then((yes) => { if (yes) closeEditor(); });
  }

  async function saveEditor({ repaint = false } = {}) {
    if (!editingId) return;
    const id = editingId;
    await apiCall(`/scribes/${id}`, 'PUT', values('scribeEdit', { includeImagePrompt: true }));
    closeEditor();
    if (repaint) await apiCall(`/scribes/${id}/image`, 'POST');
    await loadScribes();
    showSuccess(repaint ? 'New Scribe revision saved; her portrait is being repainted.' : 'New Scribe revision saved.');
  }

  async function designWithAi() {
    if (reviewing || aiOperationRunning) return;
    const seed = values('scribe');
    const estimate = estimatePageCost({
      models: state.modelsCache, model: state.settings.model, wordsPerPage: 450,
      pageChars: JSON.stringify(seed).length,
    });
    reviewing = true;
    const yes = await dialogs.confirmPaid({
      title: 'Design a Scribe with AI?',
      review: {
        action: 'Draft identity, adult-catgirl appearance, and a complete craft signature into this form.',
        object: `draft Scribe${seed.name ? ` "${seed.name}"` : ''}`,
        model: state.settings.model || 'the Scribe role default model',
        quantity: 'one structured draft, with one corrective retry if its JSON is invalid',
        sends: 'all Scribe form fields currently filled in', estimate,
        maximum: typeof estimate === 'number' ? estimate * 6 : null,
        note: 'Nothing is saved yet. Review and edit every field, then choose Create.',
      },
      confirmLabel: `Draft her (${approxCostText(estimate)})`,
    });
    reviewing = false;
    if (!yes) return;
    aiOperationRunning = true;
    const restoreButton = beginButtonBusy(document.getElementById('scribeAiBtn'), 'The Scribe is designing…');
    try {
      const result = await apiCall('/ai/scribe', 'POST', {
        ...seed, length: 'medium', ...(state.settings.model ? { model: state.settings.model } : {}),
      });
      state.addSessionCost(result.cost_usd);
      populate('scribe', result.scribe || seed);
      showSuccess('Draft ready. Review her identity and craft before creating the Scribe.');
    } catch (error) {
      state.addSessionCost(error.costUsd);
      showError(error.message);
    } finally {
      aiOperationRunning = false;
      restoreButton();
    }
  }

  function init() {
    renderFocus('scribe');
    renderFocus('scribeEdit');
    document.getElementById('scribeForm')?.addEventListener('submit', handleSubmit);
    document.getElementById('scribeAiBtn')?.addEventListener('click', designWithAi);
    const newButton = document.getElementById('scribeNewBtn');
    const form = document.getElementById('scribeCreateWrap');
    newButton?.addEventListener('click', () => {
      const opening = form.hidden;
      form.hidden = !opening;
      newButton.setAttribute('aria-expanded', String(opening));
      if (opening) document.getElementById('scribeName')?.focus();
    });
    editor = wireModal('scribeEditorModal', { beforeClose: requestClose, focusId: 'scribeEditName' });
    document.getElementById('scribeEditorForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveEditor().catch((error) => showError(error.message));
    });
    document.getElementById('scribeEditCancelBtn')?.addEventListener('click', requestClose);
    document.getElementById('scribeEditRedoImageBtn')?.addEventListener('click', async () => {
      if (reviewing || !editingId) return;
      reviewing = true;
      const yes = await dialogs.confirmPaid({
        title: 'Save this revision and repaint her?',
        review: {
          action: 'Save a new immutable Scribe revision, then repaint her portrait.',
          object: `Scribe "${formElement('scribeEdit', 'name')?.value || ''}"`,
          quantity: 'one 1K portrait painting', sends: 'the edited identity, craft cues, and portrait direction',
          estimate: IMAGE_ESTIMATE,
        }, confirmLabel: `Save & repaint (${approxCostText(IMAGE_ESTIMATE)})`,
      });
      reviewing = false;
      if (!yes) return;
      saveEditor({ repaint: true }).catch((error) => showError(error.message));
    });
  }

  return { init, loadScribes, renderScribes, updateStartSelect, openEditor, saveEditor, handleSubmit, designWithAi };
}
