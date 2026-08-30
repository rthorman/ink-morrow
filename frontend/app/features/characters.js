// Characters catalog: list, create, edit (entity editor modal), delete.
// Base characters are reusable; stories hold mutable state copies (deletion
// removes the character from story casts, server-side).

export function createCharacters({ api, state, notify, catalogPoll, entityCard, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
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
      desc.textContent = character.description || 'No description';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = world ? `World: ${world.name}` : 'Free-roaming (no world)';

      const regenerate = async () => {
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
          body: 'The character and their reference portrait will be permanently deleted, and they will be removed from every story cast that references them.',
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
        entityCard.cardActions({ name: character.name, kind: 'character', onEdit: () => openCharacterEditor(character), onRegenerate: regenerate, onDelete: remove })
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

  const CHARACTER_EDITOR_FIELDS = ['charEditName', 'charEditDescription', 'charEditPersonality', 'charEditAppearance', 'charEditBackground', 'charEditImagePrompt'];
  let editorSnapshot = null; // values as loaded; any drift means "dirty"

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
    document.getElementById('charEditDescription').value = character.description || '';
    document.getElementById('charEditPersonality').value = character.personality || '';
    document.getElementById('charEditAppearance').value = character.appearance || '';
    document.getElementById('charEditBackground').value = character.background || '';
    document.getElementById('charEditImagePrompt').value = character.image_prompt || '';
    editorSnapshot = editorValues();
    modal.hidden = false;
    document.getElementById('charEditName').focus();
  }

  function closeCharacterEditor() {
    const modal = document.getElementById('characterEditorModal');
    if (modal) modal.hidden = true;
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
          try {
            await saveCharacterEditor(); // saves the fields (incl. the blurb) first
            await apiCall(`/characters/${id}/image`, 'POST');
            await loadCharacters();
            showSuccess('A new portrait is being painted (≈$0.06).');
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
    const cancel = document.getElementById('charEditCancelBtn');
    const modal = document.getElementById('characterEditorModal');
    if (cancel && modal) {
      cancel.addEventListener('click', requestCloseCharacterEditor);
      modal.addEventListener('click', (event) => {
        if (event.target === modal) requestCloseCharacterEditor();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden) requestCloseCharacterEditor();
      });
    }
  }

  return { loadCharacters, renderCharacters, handleCharacterSubmit, openCharacterEditor, closeCharacterEditor, saveCharacterEditor, init };
}
