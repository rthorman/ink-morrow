// Worlds catalog: list, create, edit (entity editor modal), delete. Worlds
// are canonical - stories reference the live row, so saves refresh every
// list that shows the world.

export function createWorlds({ api, state, notify, catalogPoll, entityCard, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let editingWorldId = null;

  async function loadWorlds() {
    try {
      const data = await apiCall('/worlds');
      state.data.worlds = data.worlds || [];
      state.chargeEntityImageCosts(state.data.worlds, 'world');
      renderWorlds();
      updateWorldSelects();
      catalogPoll.schedule();
    } catch (error) {
      showError(error.message);
    }
  }

  function renderWorlds() {
    const container = document.getElementById('worldsList');
    container.textContent = '';

    if (state.data.worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = 'No worlds yet. Every tale needs ground to stand on — forge the first one.';
      container.appendChild(empty);
      return;
    }

    state.data.worlds.forEach((world) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      // The card mirrors Edit for pointer convenience, but it is itself
      // keyboard-focusable and named - never the only route in.
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Edit world ${world.name}`);

      const title = document.createElement('h4');
      title.textContent = world.name;
      const desc = document.createElement('p');
      desc.textContent = world.description || 'No description';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = [world.genre, world.setting].filter(Boolean).join(' · ') || 'No genre/setting';

      const regenerate = async () => {
        try {
          await apiCall(`/worlds/${world.id}/image`, 'POST');
          loadWorlds();
        } catch (error) {
          showError(error.message);
        }
      };
      const remove = async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Delete world "${world.name}"?`,
          body: 'The world and its reference image will be permanently deleted.',
          confirmLabel: 'Delete world',
        });
        if (!yes) return;
        try {
          await apiCall(`/worlds/${world.id}`, 'DELETE');
          showSuccess('World deleted.');
          loadWorlds();
          features.characters.loadCharacters();
          features.stories.loadStories();
        } catch (error) {
          showError(error.message);
        }
      };

      card.append(
        title,
        entityCard.entityImageBlock('world', world, `Reference scene for the world ${world.name}`),
        desc,
        meta,
        entityCard.cardActions({ name: world.name, kind: 'world', onEdit: () => openWorldEditor(world), onRegenerate: regenerate, onDelete: remove })
      );
      card.addEventListener('click', (event) => {
        if (event.target.closest('button, details, a')) return; // actions keep their own jobs
        openWorldEditor(world);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.target.closest('button, details, a')) return;
          event.preventDefault();
          openWorldEditor(world);
        }
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
      state.data.worlds.forEach((world) => {
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
    // "Create without image" skips the background painting entirely; the
    // default path paints (generate_image omitted = old-client behavior).
    const withoutImage = event.submitter && event.submitter.id === 'worldNoImageBtn';
    try {
      await apiCall('/worlds', 'POST', {
        name: document.getElementById('worldName').value,
        description: document.getElementById('worldDescription').value,
        genre: document.getElementById('worldGenre').value,
        setting: document.getElementById('worldSetting').value,
        ...(withoutImage ? { generate_image: false } : {}),
      });
      form.reset();
      await loadWorlds();
      showSuccess(withoutImage ? 'World created.' : 'World created — the scene is being painted.');
    } catch (error) {
      showError(error.message);
    }
  }

  // -- world editor (dirty-guarded) ---------------------------------------------

  const WORLD_EDITOR_FIELDS = ['worldEditName', 'worldEditDescription', 'worldEditGenre', 'worldEditSetting', 'worldEditLore', 'worldEditImagePrompt'];
  let editorSnapshot = null; // values as loaded; any drift means "dirty"

  function editorValues() {
    const values = {};
    for (const id of WORLD_EDITOR_FIELDS) values[id] = document.getElementById(id).value;
    return values;
  }

  function editorDirty() {
    return Boolean(editingWorldId && editorSnapshot && JSON.stringify(editorValues()) !== JSON.stringify(editorSnapshot));
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
    editorSnapshot = editorValues();
    modal.hidden = false;
    document.getElementById('worldEditName').focus();
  }

  function closeWorldEditor() {
    const modal = document.getElementById('worldEditorModal');
    if (modal) modal.hidden = true;
    editingWorldId = null;
    editorSnapshot = null;
  }

  // Closing a dirty editor asks before discarding - backdrop, Escape, Cancel.
  function requestCloseWorldEditor() {
    if (!editorDirty()) return closeWorldEditor();
    dialogs
      .confirmDestructive({
        title: 'Discard changes?',
        body: 'Your edits to this world have not been saved.',
        confirmLabel: 'Discard changes',
      })
      .then((yes) => {
        if (yes) closeWorldEditor();
      });
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
    await Promise.all([loadWorlds(), features.characters.loadCharacters(), features.stories.loadStories()]);
    showSuccess('World saved.');
    return true;
  }

  function init() {
    document.getElementById('worldForm').addEventListener('submit', handleWorldSubmit);

    // Collection-first: "New world" reveals and focuses the creation form.
    const newBtn = document.getElementById('worldNewBtn');
    const createWrap = document.getElementById('worldCreateWrap');
    if (newBtn && createWrap) {
      newBtn.addEventListener('click', () => {
        const opening = createWrap.hidden;
        createWrap.hidden = !opening;
        newBtn.setAttribute('aria-expanded', String(opening));
        if (opening) document.getElementById('worldName').focus();
        else createWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            showSuccess('A new scene is being painted (≈$0.04).');
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
    const cancel = document.getElementById('worldEditCancelBtn');
    const modal = document.getElementById('worldEditorModal');
    if (cancel && modal) {
      cancel.addEventListener('click', requestCloseWorldEditor);
      modal.addEventListener('click', (event) => {
        if (event.target === modal) requestCloseWorldEditor();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden) requestCloseWorldEditor();
      });
    }
  }

  return { loadWorlds, renderWorlds, updateWorldSelects, handleWorldSubmit, openWorldEditor, closeWorldEditor, saveWorldEditor, init };
}
