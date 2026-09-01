// Characters catalog: list, create, edit (entity editor modal), delete.
// Base characters are reusable; stories hold mutable state copies (deletion
// removes the character from story casts, server-side).

import { approxCostText } from '../core/cost.js';
import { wireModal } from '../core/dialogs.js';
import { IMAGE_COST_ESTIMATE } from '../components/entity-card.js';

const CHARACTER_IMAGE_ESTIMATE = IMAGE_COST_ESTIMATE.character;

export function createCharacters({ api, state, notify, catalogPoll, entityCard, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let imageReviewing = false; // a paid-consent check is running: no second submission
  let characterEditorModal = null; // wired lifecycle controller
  let editingCharacterId = null;

  async function loadCharacters() {
    try {
      const data = await apiCall('/characters');
      state.data.characters = data.characters || [];
      state.chargeEntityImageCosts(state.data.characters, 'character');
      renderCharacters();
      features.storyEditor.renderCastBuilder();
      catalogPoll.schedule();
    } catch (error) {
      showError(error.message);
    }
  }

  function renderCharacters() {
    const container = document.getElementById('charactersList');
    container.textContent = '';

    if (state.data.characters.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = 'No characters walk these halls yet. Summon the first one.';
      container.appendChild(empty);
      return;
    }

    state.data.characters.forEach((character) => {
      const world = state.data.worlds.find((w) => w.id === character.world_id);
      const card = document.createElement('div');
      card.className = 'item-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Edit character ${character.name}`);

      const title = document.createElement('h4');
      title.textContent = character.name;
      const desc = document.createElement('p');
      desc.className = 'item-card__desc'; // bounded preview; full text in Edit + AT
      desc.textContent = character.description || 'No description';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = world ? `World: ${world.name}` : 'Free-roaming (no world)';

      const regenerate = async () => {
        if (imageReviewing) return;
        imageReviewing = true;
        const yes = await dialogs.confirmPaid({
          title: `Repaint the portrait of ${character.name}?`,
          review: {
            action: `Paint a new reference portrait for ${character.name}.`,
            object: `character "${character.name}"`,
            quantity: 'one 1K portrait painting',
            sends: `the character's appearance, personality, and image blurb${character.image_prompt ? '' : ' (auto-composed)'}`,
            estimate: CHARACTER_IMAGE_ESTIMATE,
          },
          confirmLabel: `Repaint it (${approxCostText(CHARACTER_IMAGE_ESTIMATE)})`,
        });
        imageReviewing = false;
        if (!yes) return;
        try {
          await apiCall(`/characters/${character.id}/image`, 'POST');
          loadCharacters();
        } catch (error) {
          showError(error.message);
        }
      };
      const remove = async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Delete character "${character.name}"?`,
          body: 'The character and their reference portrait will be permanently deleted, and they will be removed from every manuscript cast that references them.',
          confirmLabel: 'Delete character',
        });
        if (!yes) return;
        try {
          await apiCall(`/characters/${character.id}`, 'DELETE');
          showSuccess('Character deleted.');
          loadCharacters();
          features.stories.loadStories();
        } catch (error) {
          showError(error.message);
        }
      };

      card.append(
        title,
        entityCard.entityImageBlock('character', character, `Reference portrait of ${character.name}`),
        desc,
        meta,
        entityCard.cardActions({
          name: character.name,
          kind: 'character',
          onEdit: () => openCharacterEditor(character),
          onRegenerate: regenerate,
          onExport: () => features.transfer.openExport({ scope: 'character', id: character.id }),
          onDelete: remove,
        })
      );
      card.addEventListener('click', (event) => {
        if (event.target.closest('button, details, a')) return; // actions keep their own jobs
        openCharacterEditor(character);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.target.closest('button, details, a')) return;
          event.preventDefault();
          openCharacterEditor(character);
        }
      });
      container.appendChild(card);
    });
  }

  async function handleCharacterSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const withoutImage = event.submitter && event.submitter.id === 'characterNoImageBtn';
    if (!withoutImage) {
      // Creating a character paints their portrait by default: the paid half
      // passes the consent gate; a first-review cancel keeps every field.
      if (imageReviewing) return;
      imageReviewing = true;
      const yes = await dialogs.confirmPaid({
        title: 'Create this character and paint their portrait?',
        review: {
          action: 'Create the character, then paint their reference portrait in the background.',
          object: `character "${document.getElementById('characterName').value.trim() || '(unnamed)'}"`,
          quantity: 'one 1K portrait painting',
          sends: 'the character\'s sheet (appearance, personality, image blurb)',
          estimate: CHARACTER_IMAGE_ESTIMATE,
          note: '"Create without image" skips the painting entirely.',
        },
        confirmLabel: `Create & paint (${approxCostText(CHARACTER_IMAGE_ESTIMATE)})`,
      });
      imageReviewing = false;
      if (!yes) return;
    }
    try {
      await apiCall('/characters', 'POST', {
        ...(withoutImage ? { generate_image: false } : {}),
        name: document.getElementById('characterName').value,
        description: document.getElementById('characterDescription').value,
        personality: document.getElementById('characterPersonality').value,
        appearance: document.getElementById('characterAppearance').value,
        background: document.getElementById('characterBackground').value,
        world_id: document.getElementById('characterWorld').value || null,
      });
      form.reset();
      await loadCharacters();
      showSuccess(withoutImage ? 'Character created.' : 'Character created — the portrait is being painted.');
    } catch (error) {
      showError(error.message);
    }
  }

  // -- character editor (dirty-guarded) -----------------------------------------

  const CHARACTER_EDITOR_FIELDS = ['charEditName', 'charEditWorld', 'charEditDescription', 'charEditPersonality', 'charEditAppearance', 'charEditBackground', 'charEditImagePrompt'];
  let editorSnapshot = null; // values as loaded; any drift means "dirty"

  function populateCharacterEditorWorlds(selectedWorldId) {
    const select = document.getElementById('charEditWorld');
    if (!select) return;
    select.textContent = '';
    const worldless = document.createElement('option');
    worldless.value = '';
    worldless.textContent = 'No world (free-roaming character)';
    select.appendChild(worldless);
    for (const world of state.data.worlds) {
      const option = document.createElement('option');
      option.value = world.id;
      option.textContent = world.name;
      select.appendChild(option);
    }
    const wanted = selectedWorldId || '';
    if (wanted && ![...select.options].some((option) => option.value === wanted)) {
      // World and character catalogues load independently at boot. Preserve
      // the existing association even if the world names arrive a moment
      // after the character card was opened.
      const pending = document.createElement('option');
      pending.value = wanted;
      pending.textContent = 'Current world (loading…)';
      select.appendChild(pending);
    }
    select.value = wanted;
  }

  function editorValues() {
    const values = {};
    for (const id of CHARACTER_EDITOR_FIELDS) values[id] = document.getElementById(id).value;
    return values;
  }

  function editorDirty() {
    return Boolean(editingCharacterId && editorSnapshot && JSON.stringify(editorValues()) !== JSON.stringify(editorSnapshot));
  }

  function requestCloseCharacterEditor() {
    if (!editorDirty()) return closeCharacterEditor();
    dialogs
      .confirmDestructive({
        title: 'Discard changes?',
        body: 'Your edits to this character have not been saved.',
        confirmLabel: 'Discard changes',
      })
      .then((yes) => {
        if (yes) closeCharacterEditor();
      });
  }

  function openCharacterEditor(character) {
    const modal = document.getElementById('characterEditorModal');
    if (!modal) return;
    editingCharacterId = character.id;
    document.getElementById('charEditName').value = character.name || '';
    populateCharacterEditorWorlds(character.world_id);
    document.getElementById('charEditDescription').value = character.description || '';
    document.getElementById('charEditPersonality').value = character.personality || '';
    document.getElementById('charEditAppearance').value = character.appearance || '';
    document.getElementById('charEditBackground').value = character.background || '';
    document.getElementById('charEditImagePrompt').value = character.image_prompt || '';
    editorSnapshot = editorValues();
    characterEditorModal.open(); // the wired lifecycle: focus, scroll lock, opener
  }

  function closeCharacterEditor() {
    characterEditorModal.close(); // restores the opener, unlocks the document
    editingCharacterId = null;
    editorSnapshot = null;
  }

  async function saveCharacterEditor() {
    if (!editingCharacterId) return false;
    await apiCall(`/characters/${editingCharacterId}`, 'PUT', {
      name: document.getElementById('charEditName').value,
      description: document.getElementById('charEditDescription').value,
      personality: document.getElementById('charEditPersonality').value,
      appearance: document.getElementById('charEditAppearance').value,
      background: document.getElementById('charEditBackground').value,
      world_id: document.getElementById('charEditWorld').value || null,
      image_prompt: document.getElementById('charEditImagePrompt').value,
    });
    closeCharacterEditor();
    await loadCharacters();
    showSuccess('Character saved.');
    return true;
  }

  function init() {
    document.getElementById('characterForm').addEventListener('submit', handleCharacterSubmit);

    // Collection-first: "New character" reveals and focuses the creation form.
    const newBtn = document.getElementById('characterNewBtn');
    const createWrap = document.getElementById('characterCreateWrap');
    if (newBtn && createWrap) {
      newBtn.addEventListener('click', () => {
        const opening = createWrap.hidden;
        createWrap.hidden = !opening;
        newBtn.setAttribute('aria-expanded', String(opening));
        if (opening) document.getElementById('characterName').focus();
        else createWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const characterRedo = document.getElementById('charEditRedoImageBtn');
    if (characterRedo) {
      characterRedo.addEventListener('click', () => {
        (async () => {
          const id = editingCharacterId;
          if (!id) return;
          // Save is free; the repaint passes the paid-consent gate. A
          // first-review cancel keeps the editor open with every field intact.
          if (imageReviewing) return;
          imageReviewing = true;
          const yes = await dialogs.confirmPaid({
            title: 'Save and repaint the portrait?',
            review: {
              action: 'Save the edited character fields, then paint a new reference portrait.',
              object: `character "${document.getElementById('charEditName').value.trim()}"`,
              quantity: 'one 1K portrait painting',
              sends: 'the character\'s sheet and the image blurb from the editor',
              estimate: CHARACTER_IMAGE_ESTIMATE,
            },
            confirmLabel: `Save & repaint (${approxCostText(CHARACTER_IMAGE_ESTIMATE)})`,
          });
          imageReviewing = false;
          if (!yes) return;
          try {
            await saveCharacterEditor(); // saves the fields (incl. the blurb) first
            await apiCall(`/characters/${id}/image`, 'POST');
            await loadCharacters();
            showSuccess(`A new portrait is being painted (${approxCostText(CHARACTER_IMAGE_ESTIMATE)}).`);
          } catch (error) {
            showError(error.message);
          }
        })();
      });
    }
    const characterForm = document.getElementById('characterEditorForm');
    if (characterForm) {
      characterForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveCharacterEditor().catch((error) => showError(error.message));
      });
    }
    // One wired lifecycle; the dirty guard is the close policy.
    characterEditorModal = wireModal('characterEditorModal', { beforeClose: requestCloseCharacterEditor, focusId: 'charEditName' });
    const cancel = document.getElementById('charEditCancelBtn');
    if (cancel) cancel.addEventListener('click', requestCloseCharacterEditor);
  }

  return { loadCharacters, renderCharacters, handleCharacterSubmit, openCharacterEditor, closeCharacterEditor, saveCharacterEditor, init };
}

