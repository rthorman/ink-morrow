// Page generation + the speculative next-page state machine. Prepared prose
// remains server-side until committed. Client tokens protect both preview and
// live-writing responses from story switches and other superseding actions.

import { SCRIBE_FLAVOR, SCRIBE_DONE, SCRIBE_ERROR } from '../../shell.js';
import { approxCostText, estimatePageCost, estimateContinuityCost } from '../../core/cost.js';

const QUALITY_ATTEMPTS_MAX = 3; // must match backend/src/ai.js
const CONTINUITY_ATTEMPTS_MAX = 2; // initial structured reply + one correction

export function createGeneration({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  const { settings, data } = state;

  let speculative = null; // { storyId, expectedPage, ready, token, previewKey }
  let speculativeToken = 0;
  let actionToken = 0;
  let flavorTimer = null;
  let reviewing = false;
  const previewFlights = new Map(); // storyId -> Set(attempt tokens)
  const refreshAfterPreview = new Set();

  function contextChars() {
    const pages = (data.storyPages || []).slice(-5);
    return pages.reduce((sum, page) => sum + (page.content || '').length, 0);
  }

  function pageEstimate() {
    return estimatePageCost({
      models: state.modelsCache,
      model: settings.model,
      wordsPerPage: settings.wordsPerPage,
      pageChars: contextChars(),
    });
  }

  function continuityEstimate() {
    return estimateContinuityCost({
      models: state.modelsCache,
      model: settings.model,
      pageChars: settings.wordsPerPage * 6,
    });
  }

  function storedPageCost(page) {
    return (typeof page?.cost_usd === 'number' ? page.cost_usd : 0) +
      (typeof page?.continuity_cost_usd === 'number' ? page.continuity_cost_usd : 0);
  }

  function multipliedEstimate(estimate, count) {
    return typeof estimate === 'number' && Number.isFinite(estimate) ? estimate * count : null;
  }

  function bookFailedSpend(error, { storyId = null, persisted = false } = {}) {
    if (typeof error?.costUsd !== 'number' || !Number.isFinite(error.costUsd)) return;
    if (persisted && storyId) state.addCostForStory(storyId, error.costUsd);
    else state.addSessionCost(error.costUsd);
  }

  async function reviewWrite({ action, object, quantity, sends, also }) {
    const singleEstimate = pageEstimate();
    const memoryEstimate = continuityEstimate();
    const estimate = multipliedEstimate(singleEstimate, 2) + memoryEstimate;
    const maximum = multipliedEstimate(singleEstimate, QUALITY_ATTEMPTS_MAX * 2) +
      multipliedEstimate(memoryEstimate, CONTINUITY_ATTEMPTS_MAX);
    const note = 'This rough estimate covers the page, its compact continuity record, and its prepared successor. Authoring may need up to three billable quality attempts; malformed continuity JSON gets one correction. Longer tales still send only bounded recent context.';
    return dialogs.confirmPaid({
      title: 'Send this to the paid scribe?',
      review: {
        action,
        object,
        model: settings.model || 'the scribe\u2019s default model',
        quantity,
        sends,
        also: also ? `record continuity (${approxCostText(memoryEstimate)}), then ${also} (${approxCostText(singleEstimate)} before retries)` : null,
        estimate,
        maximum,
        note,
      },
      confirmLabel: `Write it, remember + prepare (${approxCostText(estimate)})`,
    });
  }

  function currentSpeculative() {
    return speculative && data.currentStory && speculative.storyId === data.currentStory.id
      ? speculative
      : null;
  }

  function updateSpeculativeUi() {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const input = document.getElementById('userInput');
    const inputEmpty = !input || !input.value.trim();
    const current = currentSpeculative();
    const preparing = Boolean(current && !current.ready);
    const ready = Boolean(current && current.ready);
    const writable = Boolean(data.currentStory) &&
      (data.storyPages.length === 0 || data.currentPage === data.storyPages.length);
    const usable = ready && inputEmpty && !data.generating && writable;

    btn.textContent = data.generating
      ? 'The scribe is writing…'
      : preparing && inputEmpty
        ? 'Preparing next page…'
        : usable
          ? 'Use prepared page'
          : 'Write next page';
    btn.classList.toggle('next-page', usable);
    btn.disabled = data.generating || !writable || (preparing && inputEmpty);

    const note = document.getElementById('preparedNote');
    if (!note) return;
    if (usable) {
      note.hidden = false;
      note.textContent = 'Next page prepared. Its provider cost was already incurred; it joins Story when used.';
    } else if (ready && !inputEmpty) {
      note.hidden = false;
      note.textContent = 'A page is prepared. Confirming this direction replaces it; canceling keeps it.';
    } else if (preparing && !inputEmpty) {
      note.hidden = false;
      note.textContent = 'A page is already being prepared. You may write from this direction instead, but that first request has already started.';
    } else {
      note.hidden = true;
    }
  }

  function previewMatchesStory(storyId, expectedPage) {
    return data.currentStory?.id === storyId &&
      data.storyPages.length + 1 === expectedPage &&
      (data.storyPages.length === 0 || data.currentPage === data.storyPages.length);
  }

  async function maybeStartSpeculative({ ignoreDirection = false } = {}) {
    const { currentStory, storyPages, currentPage } = data;
    if (!currentStory || data.generating) return;
    if (storyPages.length === 0 || currentPage !== storyPages.length) return;
    const input = document.getElementById('userInput');
    if (!ignoreDirection && input && input.value.trim()) return;
    if (speculative && speculative.storyId === currentStory.id) return;

    const storyId = currentStory.id;
    const expectedPage = storyPages.length + 1;
    const token = ++speculativeToken;
    speculative = { storyId, expectedPage, ready: false, token, previewKey: null };
    if (!previewFlights.has(storyId)) previewFlights.set(storyId, new Set());
    previewFlights.get(storyId).add(token);
    updateSpeculativeUi();
    try {
      const res = await apiCall(`/stories/${storyId}/pages/preview`, 'POST', {
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      state.addSessionCost(res.preview?.cost_usd);
      if (!speculative || speculative.storyId !== storyId || speculative.token !== token) return;
      if (!res.preview || res.preview.expected_page !== expectedPage || !previewMatchesStory(storyId, expectedPage)) {
        speculative = null;
        return;
      }
      speculative = {
        storyId,
        expectedPage,
        ready: true,
        token,
        previewKey: res.preview.preview_key || null,
      };
    } catch (error) {
      bookFailedSpend(error);
      if (speculative && speculative.storyId === storyId && speculative.token === token) speculative = null;
    } finally {
      const flights = previewFlights.get(storyId);
      flights?.delete(token);
      if (flights?.size === 0) previewFlights.delete(storyId);
      updateSpeculativeUi();
      if (
        !previewFlights.has(storyId) &&
        refreshAfterPreview.delete(storyId) &&
        data.currentStory?.id === storyId &&
        !data.generating
      ) {
        void refreshSpeculative(storyId);
      }
    }
  }

  function restoreSpeculative(storyId, preview) {
    const token = ++speculativeToken;
    const expectedPage = data.storyPages.length + 1;
    speculative = preview && preview.expected_page === expectedPage
      ? {
          storyId,
          expectedPage,
          ready: true,
          token,
          previewKey: preview.preview_key || null,
        }
      : null;
    updateSpeculativeUi();
  }

  async function refreshSpeculative(storyId) {
    try {
      const result = await apiCall(`/stories/${storyId}/pages/preview`);
      if (data.currentStory?.id === storyId) restoreSpeculative(storyId, result.preview);
    } catch {
      // This free reconciliation read can be retried by the next story load.
    }
  }

  function discardSpeculative() {
    speculativeToken++;
    speculative = null;
    updateSpeculativeUi();
  }

  function resetForStoryChange() {
    speculativeToken++;
    speculative = null;
    actionToken++;
    reviewing = false;
    refreshAfterPreview.clear();
    if (data.generating) setGenerating(false);
    else updateSpeculativeUi();
  }

  function setGenerating(active) {
    data.generating = active;
    for (const id of ['generateBtn', 'retryBtn']) {
      const button = document.getElementById(id);
      if (button) button.disabled = active;
    }
    features.write.updatePageActionButtons();
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) generateBtn.classList.toggle('busy', active);

    const status = document.getElementById('scribeStatus');
    if (active && status) {
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
    features.write.displayCurrentPage();
    updateSpeculativeUi();
  }

  function beginAction() {
    const token = ++actionToken;
    setGenerating(true);
    return token;
  }

  function actionIsCurrent(token, storyId) {
    return token === actionToken && data.currentStory?.id === storyId;
  }

  function finishAction(token) {
    if (token === actionToken) setGenerating(false);
  }

  function applyPage(storyId, page, { moveToPage = true } = {}) {
    if (data.currentStory?.id !== storyId || !page) return false;
    const index = data.storyPages.findIndex((candidate) =>
      (page.id && candidate.id === page.id) || candidate.page_number === page.page_number
    );
    if (index === -1) data.storyPages.push(page);
    else data.storyPages[index] = page;
    data.storyPages.sort((a, b) => a.page_number - b.page_number);
    if (moveToPage) data.currentPage = page.page_number;
    return true;
  }

  async function syncCommittedContinuity(storyId, page, originToken) {
    if (!page?.id) return;
    try {
      const result = await apiCall(`/stories/${storyId}/continuity/pages/${page.id}/sync`, 'POST', {
        ...(settings.model ? { model: settings.model } : {}),
      });
      const cost = result.memory?.cost_usd;
      state.addSessionCost(cost);
      if (originToken === actionToken && data.currentStory?.id === storyId) state.addStoryCost(cost);
      if (originToken !== actionToken || data.currentStory?.id !== storyId) return;
      if (result.page) applyPage(storyId, result.page, { moveToPage: false });
      features.write.displayCurrentPage();
      if (result.failed || result.memory?.status === 'failed') {
        showError('Page saved, but its continuity record needs attention in the Library.');
      }
    } catch (error) {
      bookFailedSpend(error);
      if (originToken === actionToken && data.currentStory?.id === storyId) {
        showError(`Page saved, but continuity could not finish: ${error.message}`);
      }
    }
  }

  async function reconcileAfterCommit(storyId, { bookRecoveredCommit = false } = {}) {
    const before = new Set(data.currentStory?.id === storyId
      ? data.storyPages.map((page) => page.id || `page:${page.page_number}`)
      : []);
    const pagesResult = await apiCall(`/stories/${storyId}/pages`);
    let previewResult = null;
    try {
      previewResult = await apiCall(`/stories/${storyId}/pages/preview`);
    } catch {
      // Page reconciliation is authoritative even if preview metadata fails.
    }
    if (data.currentStory?.id !== storyId) return { changed: false, newestPage: null };
    const pages = pagesResult.pages || [];
    let changed = false;
    let newestPage = null;
    for (const page of pages) {
      const key = page.id || `page:${page.page_number}`;
      if (before.has(key)) continue;
      changed = true;
      newestPage = page;
      if (bookRecoveredCommit) {
        state.addStoryCostForStory(storyId, typeof page.cost_usd === 'number' ? page.cost_usd : 0);
        state.addCostForStory(storyId, typeof page.continuity_cost_usd === 'number' ? page.continuity_cost_usd : 0);
      }
    }
    data.storyPages = pages;
    data.currentPage = Math.max(1, pages.length);
    if (previewResult) restoreSpeculative(storyId, previewResult.preview);
    else if (changed) discardSpeculative();
    features.write.displayCurrentPage();
    return { changed, newestPage };
  }

  async function confirmPreparedCommit(story, pageNumber) {
    const memoryEstimate = continuityEstimate();
    const successorEstimate = pageEstimate();
    const estimate = memoryEstimate + successorEstimate;
    const maximum = multipliedEstimate(memoryEstimate, CONTINUITY_ATTEMPTS_MAX) +
      multipliedEstimate(successorEstimate, QUALITY_ATTEMPTS_MAX);
    return dialogs.confirmPaid({
      title: 'Use the prepared page and prepare another?',
      review: {
        action: `Commit prepared page ${pageNumber} of "${story.title}".`,
        object: `"${story.title}", prepared page ${pageNumber}`,
        model: settings.model || 'the scribe\u2019s default model',
        quantity: 'the already-written page (no new prose generation)',
        sends: 'the committed page to the continuity clerk after it appears',
        also: `record continuity (${approxCostText(memoryEstimate)}), then prepare page ${pageNumber + 1} (${approxCostText(successorEstimate)} before retries)`,
        estimate,
        maximum,
        note: 'The page you are entering has already been billed and appears immediately. Continuity and exactly one speculative successor run behind the reader; the successor is not committed unless you use it.',
      },
      confirmLabel: `Use prepared page, remember + prepare (${approxCostText(estimate)})`,
    });
  }

  async function generateNextPage() {
    const { currentStory, storyPages, currentPage, generating } = data;
    if (!currentStory) {
      showError('Please select a story first.');
      return;
    }
    if (generating) return;
    if (storyPages.length > 0 && currentPage !== storyPages.length) {
      showError('Navigate to the last page to continue writing.');
      return;
    }

    const storyId = currentStory.id;
    const pageCount = storyPages.length;
    const userInput = document.getElementById('userInput').value.trim();
    const prepared = currentSpeculative();

    if (!userInput && prepared?.ready) {
      if (reviewing) return;
      reviewing = true;
      let yes;
      try {
        yes = await confirmPreparedCommit(currentStory, pageCount + 1);
      } finally {
        reviewing = false;
      }
      if (!yes) return;
      if (data.currentStory?.id !== storyId || currentSpeculative()?.token !== prepared.token) {
        showError('The prepared page changed before it could be committed. Nothing new was generated.');
        return;
      }

      const token = beginAction();
      let committedPage = null;
      let committedForCurrentStory = false;
      let continuityPending = false;
      try {
        const body = prepared.previewKey ? { preview_key: prepared.previewKey } : {};
        const result = await apiCall(`/stories/${storyId}/pages/commit-preview`, 'POST', body);
        committedPage = result.page;
        continuityPending = result.continuity_pending === true;
        const proseCost = typeof result.page?.cost_usd === 'number' ? result.page.cost_usd : 0;
        const memoryCost = typeof result.page?.continuity_cost_usd === 'number' ? result.page.continuity_cost_usd : 0;
        state.addSessionCost(memoryCost);
        if (actionIsCurrent(token, storyId)) {
          state.addStoryCost(proseCost + memoryCost);
          applyPage(storyId, result.page);
          discardSpeculative();
          document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
          features.write.displayCurrentPage();
          committedForCurrentStory = true;
        }
      } catch (error) {
        bookFailedSpend(error);
        const commitOutcomeUnknown = !Number.isInteger(error.status);
        let reconciliation = { changed: false, newestPage: null };
        try {
          reconciliation = await reconcileAfterCommit(storyId, { bookRecoveredCommit: commitOutcomeUnknown });
        } catch {
          // Keep the known prepared state when even the free read is offline.
        }
        if (actionIsCurrent(token, storyId)) {
          if (commitOutcomeUnknown && reconciliation.changed) {
            committedForCurrentStory = true;
            committedPage = reconciliation.newestPage;
            continuityPending = Boolean(committedPage?.id);
            showSuccess('The prepared page was committed and recovered after the response was interrupted.');
            document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
          } else {
            showError(`${error.message} No replacement page was generated.`);
            document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
          }
        }
      } finally {
        finishAction(token);
      }
      if (committedPage && continuityPending) void syncCommittedContinuity(storyId, committedPage, token);
      if (committedForCurrentStory && data.currentStory?.id === storyId) {
        void maybeStartSpeculative({ ignoreDirection: true });
      }
      return;
    }

    if (reviewing) return;
    reviewing = true;
    let yes;
    try {
      yes = await reviewWrite({
        action: userInput
          ? `Write page ${pageCount + 1} of "${currentStory.title}" from your direction.`
          : `Write page ${pageCount + 1} of "${currentStory.title}", continuing naturally.`,
        object: `"${currentStory.title}", new page ${pageCount + 1}`,
        quantity: `≈${settings.wordsPerPage} words of new prose`,
        sends: 'your direction, the world, the cast, and the last few pages',
        also: 'prepare the next page for what may follow',
      });
    } finally {
      reviewing = false;
    }
    if (!yes) return;
    if (data.currentStory?.id !== storyId || data.storyPages.length !== pageCount) return;

    // Confirmation is the invalidation boundary. Canceling a directed write
    // leaves the already-paid prepared page available.
    discardSpeculative();
    await generateNextPageLive(userInput, storyId);
  }

  async function generateNextPageLive(direction, storyId) {
    if (data.generating || data.currentStory?.id !== storyId) return;
    const submittedDirection = direction === undefined || direction === null
      ? document.getElementById('userInput').value.trim()
      : direction;
    const token = beginAction();
    let written = false;
    let failed = false;
    try {
      const result = await apiCall(`/stories/${storyId}/pages/generate`, 'POST', {
        user_input: submittedDirection || null,
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      const newCost = storedPageCost(result.page);
      state.addSessionCost(newCost);
      if (actionIsCurrent(token, storyId)) {
        refreshAfterPreview.delete(storyId);
        state.addStoryCost(newCost);
        applyPage(storyId, result.page);
        const input = document.getElementById('userInput');
        if (input.value.trim() === submittedDirection) input.value = '';
        document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
        features.write.displayCurrentPage();
        written = true;
      }
    } catch (error) {
      failed = true;
      bookFailedSpend(error);
      if (actionIsCurrent(token, storyId)) {
        showError(error.message);
        document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
      }
    } finally {
      finishAction(token);
    }
    if (written && actionIsCurrent(token, storyId)) maybeStartSpeculative({ ignoreDirection: true });
    else if (failed && data.currentStory?.id === storyId) {
      if (previewFlights.has(storyId)) refreshAfterPreview.add(storyId);
      else await refreshSpeculative(storyId);
    }
  }

  async function retryLastPage() {
    const { currentStory, generating, storyPages, currentPage } = data;
    if (!currentStory || generating) return;
    if (storyPages.length === 0 || currentPage !== storyPages.length) {
      showError('Retry works on the last page only - navigate there first.');
      return;
    }
    const storyId = currentStory.id;
    const pageCount = storyPages.length;
    if (reviewing) return;
    reviewing = true;
    let yes;
    try {
      yes = await reviewWrite({
        action: `Rewrite page ${pageCount} of "${currentStory.title}" with its original direction. Rewrites are billed in full.`,
        object: `"${currentStory.title}", rewriting page ${pageCount}`,
        quantity: `≈${settings.wordsPerPage} words rewritten from scratch`,
        sends: 'the same direction as the original page, the world, the cast, and the last few pages',
        also: 'prepare the next page for what may follow',
      });
    } finally {
      reviewing = false;
    }
    if (!yes || data.currentStory?.id !== storyId || data.storyPages.length !== pageCount) return;

    const oldCost = storedPageCost(storyPages[pageCount - 1]);
    const token = beginAction();
    let rewritten = false;
    try {
      const result = await apiCall(`/stories/${storyId}/pages/regenerate`, 'POST', {
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      const newCost = storedPageCost(result.page);
      state.addSessionCost(newCost);
      if (actionIsCurrent(token, storyId)) {
        state.addStoryCost(newCost - oldCost);
        applyPage(storyId, result.page);
        document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
        discardSpeculative();
        features.write.displayCurrentPage();
        rewritten = true;
      }
    } catch (error) {
      bookFailedSpend(error);
      if (actionIsCurrent(token, storyId)) {
        showError(error.message);
        document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
      }
    } finally {
      finishAction(token);
    }
    if (rewritten && actionIsCurrent(token, storyId)) maybeStartSpeculative({ ignoreDirection: true });
  }

  function init() {
    const userInput = document.getElementById('userInput');
    if (userInput) userInput.addEventListener('input', updateSpeculativeUi);
  }

  return {
    updateSpeculativeUi,
    maybeStartSpeculative,
    restoreSpeculative,
    discardSpeculative,
    resetForStoryChange,
    setGenerating,
    generateNextPage,
    retryLastPage,
    init,
  };
}
