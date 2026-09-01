// The writing surface: story selection, the reader (read-only earlier
// pages), page navigation, and the story-management actions. Generation
// lives in generation.js; narration/imagery/audiobook own their machines.

export function createWrite({ api, state, notify, shell, features, dialogs }) {
  const { apiCall, apiFetch } = api;
  const { showError, showSuccess, showErrorRaw } = notify;
  let router = null; // set by bootstrap
  let storyLoadToken = 0;
  let pageEditTimer = null;
  let pageEditSession = null;
  let pageEditSequence = 0;
  let recoveryUndo = null;
  const pageEditDrafts = new Map();

  const byId = (id) => document.getElementById(id);

  function pageDraftKey(storyId, pageId) {
    return `${storyId}:${pageId}`;
  }

  function setPageSaveState(state, message) {
    const status = byId('deskPageSaveState');
    if (!status) return;
    status.dataset.state = state || '';
    status.textContent = message || '';
  }

  function resetPageEditor({ preserveDraft = true } = {}) {
    if (pageEditTimer) clearTimeout(pageEditTimer);
    pageEditTimer = null;
    pageEditSequence++;
    if (!preserveDraft && pageEditSession) {
      pageEditDrafts.delete(pageDraftKey(pageEditSession.storyId, pageEditSession.pageId));
    }
    pageEditSession = null;
    if (byId('deskPageEditor')) byId('deskPageEditor').hidden = true;
    if (byId('deskPageReloadLatest')) byId('deskPageReloadLatest').hidden = true;
    setPageSaveState('', '');
  }

  function currentPageRecord() {
    return state.data.storyPages.find((page) => page.page_number === state.data.currentPage) || null;
  }

  function syncPageEditorControls() {
    const wrap = byId('deskPageState');
    const button = byId('deskPageEditBtn');
    const page = currentPageRecord();
    const usable = Boolean(state.data.currentStory && page?.id && !state.data.generating);
    if (wrap) wrap.hidden = !usable;
    if (!usable) {
      if (pageEditSession) resetPageEditor();
      return;
    }
    const historical = state.data.currentPage < state.data.storyPages.length;
    if (button) button.textContent = historical ? 'Copyedit this page' : 'Edit active page';
    if (pageEditSession && (
      pageEditSession.storyId !== state.data.currentStory.id ||
      pageEditSession.pageId !== page.id ||
      pageEditSession.mode !== (historical ? 'copyedit' : 'tail')
    )) resetPageEditor();
  }

  function openPageEditor() {
    const story = state.data.currentStory;
    const page = currentPageRecord();
    if (!story || !page?.id || state.data.generating) return;
    const mode = state.data.currentPage < state.data.storyPages.length ? 'copyedit' : 'tail';
    const key = pageDraftKey(story.id, page.id);
    pageEditSession = {
      storyId: story.id,
      pageId: page.id,
      pageNumber: page.page_number,
      mode,
      dirty: pageEditDrafts.has(key),
      token: ++pageEditSequence,
      version: 0,
    };
    byId('deskPageEditorTitle').textContent = mode === 'tail'
      ? `Edit active page ${page.page_number}`
      : `Copyedit page ${page.page_number}`;
    byId('deskPageEditorNotice').textContent = mode === 'tail'
      ? 'Changes autosave as a new canonical revision and invalidate any prepared successor. Story facts are rebuilt from this active tail.'
      : 'Display-only copyedit. Canonical prose and Archivist facts stay unchanged; no AI provider is called.';
    byId('deskPageEditorText').value = pageEditDrafts.get(key) ?? page.content ?? '';
    byId('deskPageEditor').hidden = false;
    byId('deskPageReloadLatest').hidden = true;
    setPageSaveState(pageEditSession.dirty ? 'error' : '', pageEditSession.dirty ? 'Unsaved draft restored.' : 'Autosave is ready.');
    byId('deskPageEditorText').focus();
  }

  async function savePageEdit() {
    if (pageEditTimer) clearTimeout(pageEditTimer);
    pageEditTimer = null;
    const session = pageEditSession;
    if (!session || !session.dirty) return true;
    const text = byId('deskPageEditorText').value;
    const version = session.version;
    if (!text.trim()) {
      setPageSaveState('error', 'A manuscript page cannot be empty. Your draft is still here.');
      return false;
    }
    const sequence = ++pageEditSequence;
    session.token = sequence;
    setPageSaveState('saving', session.mode === 'tail' ? 'Saving canonical revisionâ€¦' : 'Saving display copyeditâ€¦');
    byId('deskPageSaveNow').disabled = true;
    try {
      const endpoint = session.mode === 'tail'
        ? `/stories/${session.storyId}/pages/${session.pageId}/revisions`
        : `/stories/${session.storyId}/pages/${session.pageId}/copyedits`;
      await apiCall(endpoint, session.mode === 'tail' ? 'PUT' : 'POST', { content: text });
      if (!pageEditSession || pageEditSession.token !== sequence) return false;
      const page = state.data.storyPages.find((item) => item.id === session.pageId);
      if (page) page.content = text;
      if (session.version !== version) {
        session.dirty = true;
        displayCurrentPage();
        setPageSaveState('', 'Newer changes are still waiting to saveâ€¦');
        if (pageEditTimer) clearTimeout(pageEditTimer);
        pageEditTimer = setTimeout(savePageEdit, 200);
        return false;
      }
      session.dirty = false;
      pageEditDrafts.delete(pageDraftKey(session.storyId, session.pageId));
      if (session.mode === 'tail') features.generation.discardSpeculative();
      displayCurrentPage();
      setPageSaveState('saved', session.mode === 'tail' ? 'Canonical revision saved.' : 'Display copyedit saved; canon unchanged.');
      byId('deskPageReloadLatest').hidden = true;
      return true;
    } catch (error) {
      if (!pageEditSession || pageEditSession.token !== sequence) return false;
      session.dirty = true;
      pageEditDrafts.set(pageDraftKey(session.storyId, session.pageId), byId('deskPageEditorText').value);
      const conflict = error.status === 409;
      const offline = error.message.startsWith('Cannot reach the server');
      setPageSaveState(
        conflict ? 'conflict' : offline ? 'offline' : 'error',
        conflict
          ? 'This page changed elsewhere. Your draft is preserved; load the latest page or retry after reviewing it.'
          : offline
            ? 'Offline. Your draft is preserved in this Desk session; retry when the server returns.'
            : `Save failed: ${error.message}. Your draft is preserved.`
      );
      byId('deskPageReloadLatest').hidden = !conflict;
      return false;
    } finally {
      if (pageEditSession?.token === sequence) byId('deskPageSaveNow').disabled = false;
    }
  }

  async function reloadLatestPage() {
    const session = pageEditSession;
    if (!session) return;
    try {
      const result = await apiCall(`/stories/${session.storyId}/pages/${session.pageId}`);
      if (!pageEditSession || pageEditSession !== session) return;
      const page = state.data.storyPages.find((item) => item.id === session.pageId);
      if (page) Object.assign(page, result.page);
      pageEditDrafts.delete(pageDraftKey(session.storyId, session.pageId));
      session.dirty = false;
      byId('deskPageEditorText').value = result.page.content || '';
      byId('deskPageReloadLatest').hidden = true;
      displayCurrentPage();
      setPageSaveState('saved', 'Latest server revision loaded.');
    } catch (error) {
      setPageSaveState('error', `Could not load the latest page: ${error.message}`);
    }
  }

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
    shell.syncManuscriptShell(state.data.stories, state.data.currentStory);
  }

  function openStory(storyId) {
    // Route-driven: the hash change lands in enterFromRoute, which loads the
    // tale. Direct fallback keeps old entry points working pre-router.
    features.storyEditor.closeCreator();
    if (router) router.navigate('desk', { storyId });
    else enterFromRoute({ storyId });
  }

  // Deep-link recovery: a story id that no longer exists falls back to the
  // Stories shelf with an honest message.
  async function enterFromRoute(params = {}) {
    if (!params.storyId) {
      // A cold Desk boot starts from static HTML. Paint the truthful empty
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
    features.generation.resetForStoryChange();
    features.imagery?.resetForContextChange(story.id);
    resetPageEditor();
    hideRecoveryUndo();
    document.getElementById('currentStory').value = story.id;
    state.data.currentStory = story;
    await loadStoryPages();
    const pending = state.data.pendingOpeningDirection;
    if (pending?.storyId === story.id) {
      const direction = document.getElementById('userInput');
      if (direction) {
        direction.value = pending.text;
        direction.dispatchEvent(new Event('input', { bubbles: true }));
        direction.focus();
      }
      delete state.data.pendingOpeningDirection;
    }
    if (params.pageNumber) {
      state.data.currentPage = Math.max(1, Math.min(state.data.storyPages.length, params.pageNumber));
      displayCurrentPage();
    }
  }

  async function handleStorySelection(event) {
    const storyId = event.target.value;
    features.narration.stopNarration();
    resetPageEditor();
    hideRecoveryUndo();
    if (!storyId) {
      features.generation.resetForStoryChange();
      state.data.currentStory = null;
      shell.syncManuscriptShell(state.data.stories, null);
      resetStoryReader();
      if (router) router.replace('desk');
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
      router.navigate('desk', { storyId });
      return;
    }
    features.generation.resetForStoryChange();
    features.imagery?.resetForContextChange(story?.id || null);
    state.data.currentStory = story;
    await loadStoryPages();
  }

  async function loadStoryPages() {
    if (!state.data.currentStory) return;
    const storyId = state.data.currentStory.id;
    const token = ++storyLoadToken;
    try {
      const [pagesResult, previewResult, assetsResult] = await Promise.all([
        apiCall(`/stories/${storyId}/pages`),
        apiCall(`/stories/${storyId}/pages/preview`).catch(() => ({ preview: null })),
        apiCall(`/stories/${storyId}/assets`),
      ]);
      if (token !== storyLoadToken || state.data.currentStory?.id !== storyId) return;
      state.data.storyPages = pagesResult.pages || [];
      state.data.storyAssets = {
        assets: assetsResult.assets || [],
        placements: assetsResult.placements || [],
      };
      state.data.currentPage = Math.max(1, state.data.storyPages.length);
      displayCurrentPage();
      state.resetStoryCost();
      features.generation.restoreSpeculative(storyId, previewResult.preview || null);
      // No speculative preview here: selecting a story alone must never
      // start paid work. This only restores already-paid server metadata.
      features.audiobook.refreshAudiobook(); // banner follows the tale (progress, or a fresh result once)
    } catch (error) {
      if (token !== storyLoadToken || state.data.currentStory?.id !== storyId) return;
      showError(error.message);
      state.data.storyPages = [];
      state.data.storyAssets = { assets: [], placements: [] };
      displayCurrentPage();
    }
  }

  async function refreshStoryAssets(storyId = state.data.currentStory?.id) {
    if (!storyId) return;
    const result = await apiCall(`/stories/${storyId}/assets`);
    if (state.data.currentStory?.id !== storyId) return;
    state.data.storyAssets = {
      assets: result.assets || [],
      placements: result.placements || [],
    };
    displayCurrentPage();
  }

  function appendPlacedArt(contentDiv, afterPageId) {
    const assets = new Map((state.data.storyAssets?.assets || []).map((asset) => [asset.id, asset]));
    const placements = (state.data.storyAssets?.placements || [])
      .filter((placement) => (placement.after_page_id || null) === (afterPageId || null))
      .sort((left, right) => left.ordinal - right.ordinal);
    for (const placement of placements) {
      const asset = assets.get(placement.asset_id);
      if (!asset || asset.status !== 'ready' || !asset.content_url) continue;
      const figure = document.createElement('figure');
      figure.className = 'placed-art';
      figure.dataset.placementId = placement.id;
      const image = document.createElement('img');
      image.className = 'scene-plate';
      image.src = asset.content_url;
      image.alt = asset.alt_text || asset.title || 'Story illustration';
      figure.appendChild(image);
      if (asset.title) {
        const caption = document.createElement('figcaption');
        caption.textContent = asset.title;
        figure.appendChild(caption);
      }
      contentDiv.appendChild(figure);
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
      features.generation?.updateSpeculativeUi();
      syncPageEditorControls();
      return;
    }

    const page = storyPages.length > 0 ? storyPages.find((p) => p.page_number === currentPage) : null;

    if (storyPages.length === 0) {
      appendPlacedArt(contentDiv, null);
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'This story has no pages yet. Give the scribe a direction below…';
      contentDiv.appendChild(placeholder);
    } else if (page) {
      if (currentPage === 1) appendPlacedArt(contentDiv, null);
      const para = document.createElement('p');
      para.textContent = page.content;
      contentDiv.appendChild(para);
      const direction = document.createElement('div');
      direction.className = 'page-direction';
      direction.textContent = page.user_input ? `↳ direction: ${page.user_input}` : '';
      contentDiv.appendChild(direction);
      appendPlacedArt(contentDiv, page.id);
    }

    prevBtn.disabled = generating || currentPage <= 1;
    nextBtn.disabled = generating || currentPage >= storyPages.length;
    retryBtn.disabled = generating || storyPages.length === 0 || currentPage !== storyPages.length;
    deletePageBtn.disabled = generating || storyPages.length === 0 || currentPage > storyPages.length;
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
    features.generation?.updateSpeculativeUi();
    syncPageEditorControls();
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

  // Narration and AI illustration need a real prose page. Local upload only
  // needs a story and can place art before its first page.
  function updatePageActionButtons() {
    const { currentStory, storyPages, generating } = state.data;
    const usable = Boolean(currentStory) && storyPages.length > 0 && !generating;
    for (const id of ['readAloudBtn', 'narrationAutoBtn', 'imagePromptBtn']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !usable;
    }
    const upload = document.getElementById('uploadArtBtn');
    if (upload) upload.disabled = !currentStory || generating;
    const input = document.getElementById('uploadArtInput');
    if (input) input.disabled = !currentStory || generating;
  }

  function setPastPageBar(visible, pageNumber, pagesAfter) {
    const bar = document.getElementById('pastPageBar');
    if (!bar) return;
    bar.hidden = !visible;
    if (!visible) return;
    const deleteAfter = document.getElementById('deleteAfterBtn');
    if (deleteAfter) deleteAfter.disabled = state.data.generating;
    const note = bar.querySelector('p');
    if (note) {
      note.textContent =
        pagesAfter === 1
          ? `You are reading an earlier page. ${pagesAfter} page comes after it. You may copyedit display prose without changing canon.`
          : `You are reading an earlier page. ${pagesAfter} pages come after it. You may copyedit display prose without changing canon.`;
    }
  }

  function navigatePage(direction) {
    const { currentStory, storyPages, generating } = state.data;
    if (!currentStory || storyPages.length === 0 || generating) return;
    resetPageEditor();
    features.narration.stopNarration(); // obsolete stream: the reader moved on
    state.data.currentPage = Math.max(1, Math.min(storyPages.length, state.data.currentPage + direction));
    displayCurrentPage();
    // The hash follows the reader (replace: page turns don't spam history)
    if (router) router.replace('desk', { storyId: currentStory.id, pageNumber: state.data.currentPage });
  }

  async function deleteCurrentPage() {
    const { currentStory, currentPage, storyPages, generating } = state.data;
    if (!currentStory || storyPages.length === 0 || generating) return;
    const page = storyPages.find((p) => p.page_number === currentPage);
    if (!page) return;
    const yes = await dialogs.confirmDestructive({
      title: `Delete page ${currentPage}?`,
      body: `Page ${currentPage} of "${currentStory.title}" will be permanently deleted and later pages move up to close the gap. Placed art remains in the Gallery but is unplaced. This cannot be undone.`,
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

  // -- return story to an earlier page -----------------------------------------
  // Truncation is destructive to the active chain, but PR 03 returns a bounded
  // one-click undo token plus a longer-lived recovery suffix.

  function hideRecoveryUndo() {
    recoveryUndo = null;
    const banner = byId('deskRecoveryBanner');
    if (banner) banner.hidden = true;
  }

  function showRecoveryUndo(result, story, anchorPage) {
    if (!result?.recovery?.id || !result?.undo?.token) return;
    recoveryUndo = {
      storyId: story.id,
      recoveryId: result.recovery.id,
      token: result.undo.token,
    };
    const range = result.removed_range.first === result.removed_range.last
      ? `Page ${result.removed_range.first}`
      : `Pages ${result.removed_range.first}â€“${result.removed_range.last}`;
    byId('deskRecoveryText').textContent =
      `${range} left the active story after page ${anchorPage}. Undo is available briefly; the recovery copy remains available until ${new Date(result.recovery.expires_at).toLocaleString()}.`;
    byId('deskRecoveryBanner').hidden = false;
  }

  async function undoReturn() {
    const undo = recoveryUndo;
    if (!undo || state.data.generating) return;
    byId('deskRecoveryUndo').disabled = true;
    try {
      await apiCall(`/stories/${undo.storyId}/recoveries/${undo.recoveryId}/undo`, 'POST', {
        undo_token: undo.token,
      });
      if (state.data.currentStory?.id !== undo.storyId) return;
      hideRecoveryUndo();
      await loadStoryPages();
      await features.stories.loadStories();
      showSuccess('The returned pages are back in the active story.');
    } catch (error) {
      showError(error.message);
      if (byId('deskRecoveryText')) {
        byId('deskRecoveryText').textContent =
          `Quick undo is unavailable: ${error.message}. The recovery copy remains in Chronicle for manual restore or export.`;
      }
    } finally {
      if (byId('deskRecoveryUndo')) byId('deskRecoveryUndo').disabled = false;
    }
  }

  function openBurnModal() {
    const { currentStory, currentPage, storyPages, generating } = state.data;
    if (!currentStory || storyPages.length === 0 || currentPage >= storyPages.length || generating) return;
    const after = storyPages.length - currentPage;
    const range = after === 1 ? `Page ${currentPage + 1}` : `Pages ${currentPage + 1}–${storyPages.length}`;
    dialogs
      .confirmDestructive({
        title: `Return story to page ${currentPage}?`,
        body: `${range} (${after} ${after === 1 ? 'page' : 'pages'}) of "${currentStory.title}" will leave the active story. Art anchored there remains in the Gallery but is unplaced. A recovery copy is retained, and the next screen offers a brief one-click undo.`,
        confirmLabel: `Return story to page ${currentPage}`,
      })
      .then((yes) => {
        if (yes) burnAfterCurrentPage();
      });
  }

  function closeBurnModal() {
    dialogs.close(true);
  }

  async function burnAfterCurrentPage() {
    const { currentStory, currentPage, generating } = state.data;
    if (!currentStory || generating) return;
    const after = currentPage;
    try {
      const result = await apiCall(`/stories/${currentStory.id}/pages?after=${after}`, 'DELETE');
      features.generation.discardSpeculative();
      features.narration.stopNarration();
      await loadStoryPages();
      showRecoveryUndo(result, currentStory, after);
      showSuccess(result.deleted === 1 ? 'Story returned; 1 later page is recoverable.' : `Story returned; ${result.deleted} later pages are recoverable.`);
    } catch (error) {
      showError(error.message);
    }
  }

  async function uploadArt(file) {
    const { currentStory, currentPage, storyPages, generating } = state.data;
    if (!currentStory || !file || generating) return;
    const page = storyPages.find((entry) => entry.page_number === currentPage) || null;
    const form = new FormData();
    form.append('image', file, file.name || 'upload');
    form.append('after_page_id', page?.id || '');
    form.append('provider_reference_allowed', 'false');
    const button = document.getElementById('uploadArtBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Uploading…';
    }
    try {
      const response = await apiFetch(`/api/stories/${currentStory.id}/assets/upload`, {
        method: 'POST',
        body: form,
      });
      let body = null;
      try { body = await response.json(); } catch { /* error below has a safe fallback */ }
      if (!response.ok) throw new Error(body?.error || `Upload failed (${response.status})`);
      await refreshStoryAssets(currentStory.id);
      showSuccess(page ? `Art placed after page ${page.page_number}.` : 'Art placed before the first page.');
      shell.checkDiskSpace();
      return body;
    } catch (error) {
      showError(error.message);
      return null;
    } finally {
      if (button) {
        button.disabled = !state.data.currentStory || state.data.generating;
        button.textContent = 'Upload art';
      }
      const input = document.getElementById('uploadArtInput');
      if (input) input.value = '';
    }
  }

  function resetStoryReader() {
    storyLoadToken++;
    resetPageEditor();
    hideRecoveryUndo();
    features.generation.resetForStoryChange();
    features.imagery?.resetForContextChange(null);
    state.data.storyPages = [];
    state.data.storyAssets = { assets: [], placements: [] };
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
    byId('deskPageEditBtn')?.addEventListener('click', openPageEditor);
    byId('deskPageSaveNow')?.addEventListener('click', savePageEdit);
    byId('deskPageReloadLatest')?.addEventListener('click', reloadLatestPage);
    byId('deskPageEditorClose')?.addEventListener('click', async () => {
      const saved = await savePageEdit();
      if (saved && byId('deskPageEditor')) byId('deskPageEditor').hidden = true;
    });
    byId('deskPageEditorText')?.addEventListener('input', () => {
      if (!pageEditSession) return;
      pageEditSession.dirty = true;
      pageEditSession.version++;
      const text = byId('deskPageEditorText').value;
      pageEditDrafts.set(pageDraftKey(pageEditSession.storyId, pageEditSession.pageId), text);
      setPageSaveState('', 'Unsaved changes. Autosavingâ€¦');
      if (pageEditTimer) clearTimeout(pageEditTimer);
      pageEditTimer = setTimeout(savePageEdit, 850);
    });
    byId('deskRecoveryUndo')?.addEventListener('click', undoReturn);
    const uploadButton = document.getElementById('uploadArtBtn');
    const uploadInput = document.getElementById('uploadArtInput');
    uploadButton?.addEventListener('click', () => uploadInput?.click());
    uploadInput?.addEventListener('change', () => {
      const file = uploadInput.files?.[0];
      if (file) uploadArt(file);
    });

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
    refreshStoryAssets,
    displayCurrentPage,
    setWritingEnabled,
    updatePageActionButtons,
    navigatePage,
    deleteCurrentPage,
    exportStory,
    openBurnModal,
    closeBurnModal,
    burnAfterCurrentPage,
    openPageEditor,
    savePageEdit,
    reloadLatestPage,
    undoReturn,
    uploadArt,
    resetStoryReader,
    resetAfterStoryDeletion,
    __setStoryState(patch) {
      if ('currentStory' in patch) {
        features.generation.resetForStoryChange();
        features.imagery?.resetForContextChange(patch.currentStory?.id || null);
        state.data.currentStory = patch.currentStory;
        shell.syncManuscriptShell(state.data.stories, state.data.currentStory);
        state.resetStoryCost();
      }
      if ('currentPage' in patch) state.data.currentPage = patch.currentPage;
      if ('storyPages' in patch) state.data.storyPages = patch.storyPages;
      if ('storyAssets' in patch) state.data.storyAssets = patch.storyAssets;
    },
    init,
  };
}
