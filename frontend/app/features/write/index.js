// The writing surface: story selection, the reader (read-only earlier
// pages), page navigation, and the story-management actions. Generation
// lives in generation.js; narration/imagery/audiobook own their machines.

export function createWrite({ api, state, notify, shell, features, dialogs }) {
  const { apiCall, apiFetch } = api;
  const { showError, showSuccess, showErrorRaw } = notify;
  let router = null; // set by bootstrap

  function updateStorySelect() {
    const select = document.getElementById('currentStory');
    if (!select) return;
    const keep = select.value;
    select.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a story';
    select.appendChild(placeholder);
    state.data.stories.forEach((story) => {
      const option = document.createElement('option');
      option.value = story.id;
      option.textContent = `${story.title} (${story.page_count} page${story.page_count === 1 ? '' : 's'})`;
      select.appendChild(option);
    });
    if (keep && [...select.options].some((o) => o.value === keep)) select.value = keep;
  }

  function openStory(storyId) {
    // Route-driven: the hash change lands in enterFromRoute, which loads the
    // tale. Direct fallback keeps old entry points working pre-router.
    features.storyEditor.closeCreator();
    if (router) router.navigate('write', { storyId });
    else enterFromRoute({ storyId });
  }

  // Deep-link recovery: a story id that no longer exists falls back to the
  // Stories shelf with an honest message.
  async function enterFromRoute(params = {}) {
    if (!params.storyId) {
      // A cold #/write boot starts from static HTML. Paint the truthful empty
      // desk immediately instead of leaving the markup's fake Page 1 of 1 and
      // enabled controls visible until some later interaction.
      displayCurrentPage();
      // Home can reveal the creator just before the hash transition. Now that
      // Write is actually visible, complete the hand-off by placing focus at
      // the first field (focusing it while its section was hidden is ignored).
      if (!document.getElementById('storyCreateWrap')?.hidden) {
        document.getElementById('storyTitle')?.focus();
      }
      return;
    }
    // Already open (a page turn wrote the hash): trust the reader's state.
    if (state.data.currentStory && state.data.currentStory.id === params.storyId) {
      if (params.pageNumber) {
        state.data.currentPage = Math.max(1, Math.min(state.data.storyPages.length, params.pageNumber));
        displayCurrentPage();
      }
      return;
    }
    let story = state.data.stories.find((s) => s.id === params.storyId);
    if (!story) {
      // Boot race: the story list may not have loaded yet.
      await features.stories.loadStories();
      story = state.data.stories.find((s) => s.id === params.storyId);
    }
    if (!story) {
      showErrorRaw('That story could not be found — it may have been deleted from another window.');
      if (router) router.navigate('library-stories');
      return;
    }
    document.getElementById('currentStory').value = story.id;
    state.data.currentStory = story;
    await loadStoryPages();
    if (params.pageNumber) {
      state.data.currentPage = Math.max(1, Math.min(state.data.storyPages.length, params.pageNumber));
      displayCurrentPage();
    }
  }

  async function handleStorySelection(event) {
    const storyId = event.target.value;
    features.narration.stopNarration();
    if (!storyId) {
      state.data.currentStory = null;
      resetStoryReader();
      if (router) router.replace('write');
      return;
    }
    const story = state.data.stories.find((s) => s.id === storyId) || null;
    if (router) {
      // Same story re-selected (the hash already points at it): the route
      // will not re-fire, so reload its pages directly.
      if (state.data.currentStory && state.data.currentStory.id === storyId) {
        await loadStoryPages();
        return;
      }
      router.navigate('write', { storyId });
      return;
    }
    state.data.currentStory = story;
    await loadStoryPages();
  }

  async function loadStoryPages() {
    if (!state.data.currentStory) return;
    try {
      const data = await apiCall(`/stories/${state.data.currentStory.id}/pages`);
      state.data.storyPages = data.pages || [];
      state.data.currentPage = Math.max(1, state.data.storyPages.length);
      displayCurrentPage();
      state.resetStoryCost();
      // No speculative preview here: selecting a story alone must never
      // start paid work. The preparation only runs after a confirmed write.
      features.audiobook.refreshAudiobook(); // banner follows the tale (progress, or a fresh result once)
    } catch (error) {
      showError(error.message);
      state.data.storyPages = [];
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
    const { currentStory, currentPage, storyPages, generating } = state.data;

    if (!currentStory) {
      // A truthful empty desk: no fake page count, every story-dependent
      // control off (so it can never fire an invalid request), and the
      // reason spelled out in copy, not just faded grey.
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder';
      placeholder.textContent =
        'No story selected. Choose a tale above, or bind a new one here — every writing control sleeps until then.';
      contentDiv.appendChild(placeholder);
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      retryBtn.disabled = true;
      deletePageBtn.disabled = true;
      document.getElementById('exportBtn').disabled = true;
      document.getElementById('audiobookBtn').disabled = true;
      document.getElementById('pageIndicator').textContent = 'No story selected';
      setPastPageBar(false, 0, 0);
      setWritingEnabled(false);
      updatePageActionButtons();
      return;
    }

    const page = storyPages.length > 0 ? storyPages.find((p) => p.page_number === currentPage) : null;

    if (storyPages.length === 0) {
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'This story has no pages yet. Give the scribe a direction below…';
      contentDiv.appendChild(placeholder);
    } else if (page) {
      if (page.image_media_type) {
        // A bound painting: the page IS the picture.
        const plate = document.createElement('img');
        plate.className = 'scene-plate';
        plate.src = `/api/stories/${currentStory.id}/pages/${currentPage}/image`;
        plate.alt = page.image_prompt || 'A painted scene plate';
        contentDiv.appendChild(plate);
      } else {
        const para = document.createElement('p');
        para.textContent = page.content;
        contentDiv.appendChild(para);
      }
      const direction = document.createElement('div');
      direction.className = 'page-direction';
      direction.textContent = page.user_input ? `↳ direction: ${page.user_input}` : '';
      contentDiv.appendChild(direction);
    }

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= storyPages.length;
    // A plate has no prose to rewrite: retrying it would paint text over a picture.
    retryBtn.disabled = generating || storyPages.length === 0 || currentPage !== storyPages.length || Boolean(page && page.image_media_type);
    deletePageBtn.disabled = storyPages.length === 0 || currentPage > storyPages.length;
    // Export and audiobook are story-level actions: they wake with a tale.
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('audiobookBtn').disabled = storyPages.length === 0;
    updatePageActionButtons();

    // Old pages are read-only: writing continues from the last page only.
    setWritingEnabled(storyPages.length === 0 || currentPage === storyPages.length);
    setPastPageBar(
      storyPages.length > 0 && currentPage < storyPages.length,
      currentPage,
      storyPages.length - currentPage
    );

    document.getElementById('pageIndicator').textContent = `Page ${currentPage} of ${Math.max(storyPages.length, 1)}`;
    updateStoryContextSummary();
  }

  // The context bar's plain summary: world + cast shape, at a glance.
  function updateStoryContextSummary() {
    const el = document.getElementById('storyContextMode');
    if (!el) return;
    const { currentStory } = state.data;
    if (!currentStory) {
      el.textContent = '';
      return;
    }
    const world = state.data.worlds.find((w) => w.id === currentStory.world_id);
    const cast = currentStory.characters || [];
    const lead = cast.find((c) => c.role === 'mc');
    let leadName = null;
    if (lead) {
      const character = state.data.characters.find((c) => c.id === lead.id);
      leadName = character ? character.name : null;
    }
    el.textContent = [
      world ? world.name : 'Unbound world',
      leadName ? `Centered on ${leadName}` : 'Ensemble',
    ].join(' · ');
  }

  function setWritingEnabled(enabled) {
    const wrap = document.getElementById('writeSection');
    const interfaceEl = wrap ? wrap.querySelector('.writing-interface') : null;
    const input = document.getElementById('userInput');
    const generateBtn = document.getElementById('generateBtn');
    if (interfaceEl) interfaceEl.classList.toggle('read-only', !enabled);
    if (input) input.disabled = !enabled;
    if (generateBtn) generateBtn.disabled = state.data.generating || !enabled;
  }

  // Narration and illustration need a real page to work on, and hold still
  // while the scribe writes a new one. A bound plate has no text to narrate
  // or condense, so those buttons sleep on image pages.
  function updatePageActionButtons() {
    const { currentStory, currentPage, storyPages, generating } = state.data;
    const page = storyPages.length > 0 ? storyPages.find((p) => p.page_number === currentPage) : null;
    const usable = Boolean(currentStory) && storyPages.length > 0 && !generating;
    const textual = usable && !(page && page.image_media_type);
    for (const id of ['readAloudBtn', 'narrationAutoBtn', 'imagePromptBtn']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !textual;
    }
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
    const { currentStory, storyPages } = state.data;
    if (!currentStory || storyPages.length === 0) return;
    features.narration.stopNarration(); // obsolete stream: the reader moved on
    state.data.currentPage = Math.max(1, Math.min(storyPages.length, state.data.currentPage + direction));
    displayCurrentPage();
    // The hash follows the reader (replace: page turns don't spam history)
    if (router) router.replace('write', { storyId: currentStory.id, pageNumber: state.data.currentPage });
  }

  async function deleteCurrentPage() {
    const { currentStory, currentPage, storyPages } = state.data;
    if (!currentStory || storyPages.length === 0) return;
    const page = storyPages.find((p) => p.page_number === currentPage);
    if (!page) return;
    const isPlate = Boolean(page.image_media_type);
    const yes = await dialogs.confirmDestructive({
      title: `Delete page ${currentPage}?`,
      body: isPlate
        ? `Page ${currentPage} of "${currentStory.title}" is a painted plate. It will be permanently deleted; later pages move up to close the gap.`
        : `Page ${currentPage} of "${currentStory.title}" will be permanently deleted and later pages move up to close the gap. This cannot be undone.`,
      confirmLabel: `Delete page ${currentPage}`,
    });
    if (!yes) return;
    try {
      await apiCall(`/stories/${currentStory.id}/pages/${page.page_number}`, 'DELETE');
      features.generation.discardSpeculative();
      await loadStoryPages();
      await features.stories.loadStories();
      state.resetStoryCost();
      showSuccess('Page deleted.');
    } catch (error) {
      showError(error.message);
    }
  }

  async function exportStory() {
    const { currentStory } = state.data;
    if (!currentStory) {
      showError('Please select a story first.');
      return;
    }
    try {
      const response = await apiFetch(`/api/stories/${currentStory.id}/export`);
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

  // -- burn (truncate) everything after the current page -----------------------
  // The shared destructive dialog names the exact count and range.

  function openBurnModal() {
    const { currentStory, currentPage, storyPages } = state.data;
    if (!currentStory || storyPages.length === 0 || currentPage >= storyPages.length) return;
    const after = storyPages.length - currentPage;
    const range = after === 1 ? `Page ${currentPage + 1}` : `Pages ${currentPage + 1}–${storyPages.length}`;
    dialogs
      .confirmDestructive({
        title: `Delete ${after} later ${after === 1 ? 'page' : 'pages'}?`,
        body: `${range} of "${currentStory.title}" will be permanently removed. Any painted plates among them will also be deleted, and page ${currentPage} becomes the end of the story.`,
        confirmLabel: `Delete ${after} ${after === 1 ? 'page' : 'pages'}`,
      })
      .then((yes) => {
        if (yes) burnAfterCurrentPage();
      });
  }

  function closeBurnModal() {
    dialogs.close(true);
  }

  async function burnAfterCurrentPage() {
    const { currentStory, currentPage } = state.data;
    if (!currentStory) return;
    const after = currentPage;
    try {
      const result = await apiCall(`/stories/${currentStory.id}/pages?after=${after}`, 'DELETE');
      features.generation.discardSpeculative();
      features.narration.stopNarration();
      await loadStoryPages();
      showSuccess(result.deleted === 1 ? '1 page burned.' : `${result.deleted} pages burned.`);
    } catch (error) {
      showError(error.message);
    }
  }

  function resetStoryReader() {
    state.data.storyPages = [];
    state.data.currentPage = 1;
    displayCurrentPage();
    state.resetStoryCost();
    features.audiobook.stopAudiobookPolling();
    const banner = document.getElementById('audiobookBanner');
    if (banner) banner.hidden = true;
  }

  // A deleted story that was open in the reader leaves it empty.
  function resetAfterStoryDeletion() {
    state.data.currentStory = null;
    resetStoryReader();
  }

  function init() {
    document.getElementById('currentStory').addEventListener('change', handleStorySelection);
    document.getElementById('generateBtn').addEventListener('click', () => features.generation.generateNextPage());
    document.getElementById('retryBtn').addEventListener('click', features.generation.retryLastPage);
    document.getElementById('exportBtn').addEventListener('click', exportStory);
    document.getElementById('deletePageBtn').addEventListener('click', deleteCurrentPage);
    document.getElementById('prevPageBtn').addEventListener('click', () => navigatePage(-1));
    document.getElementById('nextPageBtn').addEventListener('click', () => navigatePage(1));

    const deleteAfter = document.getElementById('deleteAfterBtn');
    if (deleteAfter) {
      deleteAfter.addEventListener('click', () => {
        const { currentStory, storyPages, currentPage } = state.data;
        if (currentStory && storyPages.length > 0 && currentPage < storyPages.length) openBurnModal();
      });
    }

    // Veteran rails: Ctrl/Cmd+Enter submits the composer; [ and ] turn
    // pages when focus is outside form controls.
    const userInput = document.getElementById('userInput');
    if (userInput) {
      userInput.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          features.generation.generateNextPage();
        }
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== '[' && event.key !== ']') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = document.activeElement ? document.activeElement.tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (dialogs.isOpen()) return;
      navigatePage(event.key === '[' ? -1 : 1);
    });
  }

  return {
    set router(value) { router = value; },
    updateStorySelect,
    openStory,
    enterFromRoute,
    handleStorySelection,
    loadStoryPages,
    displayCurrentPage,
    setWritingEnabled,
    updatePageActionButtons,
    navigatePage,
    deleteCurrentPage,
    exportStory,
    openBurnModal,
    closeBurnModal,
    burnAfterCurrentPage,
    resetStoryReader,
    resetAfterStoryDeletion,
    __setStoryState(patch) {
      if ('currentStory' in patch) {
        state.data.currentStory = patch.currentStory;
        state.resetStoryCost();
      }
      if ('currentPage' in patch) state.data.currentPage = patch.currentPage;
      if ('storyPages' in patch) state.data.storyPages = patch.storyPages;
    },
    init,
  };
}
