// Page generation + the speculative next-page state machine. The speculative
// preview survives server restarts server-side; on this side a per-attempt
// token guarantees a stale in-flight response can never turn the button
// green, and a direction-generate always discards first so a FRESH preview
// fires after it. Paid boundaries: every write/rewrite/commit passes the
// shared paid-consent gate; only the first accepted action opens its review.
// A story selection alone never spends anything.

import { SCRIBE_FLAVOR, SCRIBE_DONE, SCRIBE_ERROR } from '../../shell.js';
import { approxCostText, estimatePageCost, estimateContinuityCost } from '../../core/cost.js';

const QUALITY_ATTEMPTS_MAX = 3; // must match backend/src/ai.js
const CONTINUITY_ATTEMPTS_MAX = 2; // initial structured reply + one correction

export function createGeneration({ api, state, notify, shell, features, dialogs }) {
  const { apiCall } = api;
  const { showError } = notify;
  const { settings, data } = state;

  let speculative = null; // { storyId, ready, token }
  let speculativeToken = 0; // in-flight responses must match their own token
  let flavorTimer = null;
  let reviewing = false; // a paid-consent check is running: no second submission path

  // Rough context size (the provider bills prompt tokens for it): the last
  // CONTEXT_WINDOW pages are sent verbatim.
  function contextChars() {
    const pages = (data.storyPages || []).slice(-5);
    return pages.reduce((sum, p) => sum + (p.content || '').length, 0);
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

  function bookFailedSpend(error, { story = false } = {}) {
    if (typeof error?.costUsd !== 'number' || !Number.isFinite(error.costUsd)) return;
    if (story) state.addCost(error.costUsd);
    else state.addSessionCost(error.costUsd);
  }

  // The review every write shares: the page itself plus the follow-up
  // preparation, disclosed as one commitment.
  async function reviewWrite({ action, object, quantity, sends, also }) {
    const singleEstimate = pageEstimate();
    const memoryEstimate = continuityEstimate();
    const estimate = multipliedEstimate(singleEstimate, 2) + memoryEstimate; // page + ledger + successor preview
    const maximum = multipliedEstimate(singleEstimate, QUALITY_ATTEMPTS_MAX * 2) +
      multipliedEstimate(memoryEstimate, CONTINUITY_ATTEMPTS_MAX);
    const note = 'This rough estimate covers the page, its compact continuity record, and its prepared successor. Authoring may need up to three billable quality attempts; malformed continuity JSON gets one correction. Longer tales still send only bounded recent context.';
    const yes = await dialogs.confirmPaid({
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
    return yes;
  }

  function updateSpeculativeUi() {
    const btn = document.getElementById('generateBtn');
    if (!btn) return;
    const input = document.getElementById('userInput');
    const inputEmpty = !input || !input.value.trim();
    const previewReady =
      !data.generating && speculative && speculative.ready && data.currentStory && speculative.storyId === data.currentStory.id;
    const previewUsable = previewReady && inputEmpty;
    btn.textContent = data.generating ? 'The scribe is writing…' : previewUsable ? 'Use prepared page' : 'Write next page';
    btn.classList.toggle('next-page', previewUsable);
    // The prepared state says exactly what it is and what a direction costs it.
    const note = document.getElementById('preparedNote');
    if (note) {
      if (previewUsable) {
        note.hidden = false;
        note.textContent = 'Next page prepared. Its provider cost is already in Session; it joins Story when used.';
      } else if (previewReady && !inputEmpty) {
        note.hidden = false;
        note.textContent = 'A page is prepared — writing with this direction discards it.';
      } else {
        note.hidden = true;
      }
    }
  }

  async function maybeStartSpeculative() {
    const { currentStory, storyPages, currentPage } = data;
    if (!currentStory || data.generating) return;
    if (storyPages.length === 0 || currentPage !== storyPages.length) return;
    const input = document.getElementById('userInput');
    if (input && input.value.trim()) return;
    if (speculative && speculative.storyId === currentStory.id) return; // already in flight or ready

    const storyId = currentStory.id;
    const token = ++speculativeToken;
    speculative = { storyId, ready: false, token };
    try {
      const res = await apiCall(`/stories/${storyId}/pages/preview`, 'POST', {
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      // Even a response made stale by a direction change consumed provider
      // work. Book it before deciding whether it may affect the button.
      state.addSessionCost(res.preview?.cost_usd);
      // Only the CURRENT attempt may turn the button green: a stale attempt
      // whose story slot got written in the meantime (a direction-generate
      // invalidated its server-side preview) must never masquerade as ready.
      if (!speculative || speculative.storyId !== storyId || speculative.token !== token) return;
      speculative = { storyId, ready: true, token };
    } catch (error) {
      bookFailedSpend(error); // locally rejected provider replies can still bill
      if (speculative && speculative.storyId === storyId && speculative.token === token) speculative = null;
    }
    updateSpeculativeUi();
  }

  function discardSpeculative() {
    speculativeToken++; // any in-flight response is now stale by definition
    speculative = null;
    updateSpeculativeUi();
  }

  function setGenerating(active) {
    data.generating = active;
    for (const id of ['generateBtn', 'retryBtn']) {
      document.getElementById(id).disabled = active;
    }
    features.write.updatePageActionButtons(); // narration & illustration pause while the scribe writes
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.classList.toggle('busy', active);
    updateSpeculativeUi();

    const status = document.getElementById('scribeStatus');
    if (active) {
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

    const userInput = document.getElementById('userInput').value.trim();

    // No direction given and the scribe already prepared the next page: commit it.
    if (
      !userInput &&
      speculative &&
      speculative.ready &&
      speculative.storyId === currentStory.id
    ) {
      if (reviewing) return;
      reviewing = true;
      // The prose was billed when prepared. Committing makes it real, so the
      // continuity clerk runs now; preparing the successor is also fresh spend.
      const nextEstimate = pageEstimate();
      const memoryEstimate = continuityEstimate();
      const commitEstimate = nextEstimate + memoryEstimate;
      const nextMaximum = multipliedEstimate(nextEstimate, QUALITY_ATTEMPTS_MAX) +
        multipliedEstimate(memoryEstimate, CONTINUITY_ATTEMPTS_MAX);
      const yes = await dialogs.confirmPaid({
        title: 'Use this page and prepare another?',
        review: {
          action: `Commit prepared page ${storyPages.length + 1} of "${currentStory.title}". Its prose was already paid for; committing records its continuity.`,
          quantity: `the prepared page ${storyPages.length + 1} (already spent)`,
          also: `record continuity (${approxCostText(memoryEstimate)}), then prepare the next page (${approxCostText(nextEstimate)})`,
          estimate: commitEstimate,
          maximum: nextMaximum,
          note: 'The prepared prose bills nothing new. The estimate covers its continuity record and the successor; the record may get one JSON correction and authoring may need up to three quality attempts.',
        },
        confirmLabel: `Use prepared page, remember + prepare next (${approxCostText(commitEstimate)})`,
      });
      reviewing = false;
      if (!yes) return; // cancel: no commit, no follow-up, direction kept
      setGenerating(true);
      let committed = false;
      try {
        const res = await apiCall(`/stories/${currentStory.id}/pages/commit-preview`, 'POST', {});
        data.storyPages.push(res.page);
        data.currentPage = data.storyPages.length;
        const proseCost = typeof res.page?.cost_usd === 'number' ? res.page.cost_usd : 0;
        const memoryCost = typeof res.page?.continuity_cost_usd === 'number' ? res.page.continuity_cost_usd : 0;
        state.addStoryCost(proseCost + memoryCost); // prose session cost was booked at preview time
        state.addSessionCost(memoryCost); // continuity runs only when the preview commits
        discardSpeculative();
        document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
        features.write.displayCurrentPage();
        committed = true;
      } catch {
        // Stale or discarded (the story moved on) - fall back to a live call.
        discardSpeculative();
      } finally {
        setGenerating(false);
      }
      if (committed) {
        maybeStartSpeculative(); // consented: the review disclosed it
        return;
      }
    }

    // A direction was given (or the commit fell through): the live write
    // invalidates whatever preview the server holds, so any in-flight
    // speculative response is stale and must never turn the button green.
    discardSpeculative();

    if (reviewing) return;
    reviewing = true;
    const yes = await reviewWrite({
      action: userInput
        ? `Write page ${storyPages.length + 1} of "${currentStory.title}" from your direction.`
        : `Write page ${storyPages.length + 1} of "${currentStory.title}", continuing naturally.`,
      object: `"${currentStory.title}", new page ${storyPages.length + 1}`,
      quantity: `≈${settings.wordsPerPage} words of new prose`,
      sends: 'your direction, the world, the cast, and the last few pages',
      also: 'then prepare the next page for what may follow',
    });
    reviewing = false;
    if (!yes) return; // cancel: no request, the direction stays in the field

    await generateNextPageLive(userInput);
  }

  async function generateNextPageLive(userInput) {
    if (data.generating) return;
    const direction =
      userInput === undefined || userInput === null
        ? document.getElementById('userInput').value.trim()
        : userInput;

    setGenerating(true);
    let written = false;
    try {
      const res = await apiCall(`/stories/${data.currentStory.id}/pages/generate`, 'POST', {
        user_input: direction || null,
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      data.storyPages.push(res.page);
      data.currentPage = data.storyPages.length;
      state.addCost(storedPageCost(res.page));
      document.getElementById('userInput').value = '';
      document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
      features.write.displayCurrentPage();
      written = true;
    } catch (error) {
      bookFailedSpend(error);
      showError(error.message);
      document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
    } finally {
      setGenerating(false);
    }
    if (written) maybeStartSpeculative(); // only a successful write earns its disclosed successor
  }

  async function retryLastPage() {
    const { currentStory, generating, storyPages, currentPage } = data;
    if (!currentStory || generating) return;
    if (storyPages.length === 0 || currentPage !== storyPages.length) {
      showError('Retry works on the last page only - navigate there first.');
      return;
    }
    if (reviewing) return;
    reviewing = true;
    const yes = await reviewWrite({
      action: `Rewrite page ${storyPages.length} of "${currentStory.title}" with its original direction. Rewrites are billed in full.`,
      object: `"${currentStory.title}", rewriting page ${storyPages.length}`,
      quantity: `≈${settings.wordsPerPage} words rewritten from scratch`,
      sends: 'the same direction as the original page, the world, the cast, and the last few pages',
      also: 'then prepare the next page for what may follow',
    });
    reviewing = false;
    if (!yes) return; // cancel: the existing page stands, nothing is sent

    setGenerating(true);
    let rewritten = false;
    try {
      const oldCost = storedPageCost(storyPages[storyPages.length - 1]);
      const res = await apiCall(`/stories/${currentStory.id}/pages/regenerate`, 'POST', {
        words: settings.wordsPerPage,
        ...(settings.model ? { model: settings.model } : {}),
        ...(features.settings.reasoningApplies() ? { reasoning_effort: features.settings.activeReasoningEffort() } : {}),
      });
      data.storyPages[data.storyPages.length - 1] = res.page;
      const newCost = storedPageCost(res.page);
      state.addSessionCost(newCost); // the rewrite is a new provider spend in full
      state.addStoryCost(newCost - oldCost); // persisted story replaces the old page
      document.getElementById('scribeStatus').textContent = SCRIBE_DONE;
      discardSpeculative(); // the server dropped the old preview on regenerate
      features.write.displayCurrentPage();
      rewritten = true;
    } catch (error) {
      bookFailedSpend(error);
      showError(error.message);
      document.getElementById('scribeStatus').textContent = SCRIBE_ERROR;
    } finally {
      setGenerating(false);
    }
    if (rewritten) maybeStartSpeculative(); // only a successful rewrite earns its disclosed successor
  }

  function init() {
    const userInputEl = document.getElementById('userInput');
    if (userInputEl) {
      userInputEl.addEventListener('input', updateSpeculativeUi);
    }
  }

  return {
    updateSpeculativeUi,
    maybeStartSpeculative,
    discardSpeculative,
    setGenerating,
    generateNextPage,
    retryLastPage,
    init,
  };
}
