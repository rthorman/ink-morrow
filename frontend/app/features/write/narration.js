// Narration: streaming page read-aloud with pause/resume, autoplay, stop,
// and idempotent cost settlement per generation id (replays never re-bill).
// Every narration pass that will hit the paid speech provider passes the
// shared consent gate; remembered device consent keeps it quiet. Auto-read
// then flips pages without nagging until stopped.

import { approxCostText, ROUGH_NARRATION_PAGE_ESTIMATE } from '../../core/cost.js';

export function createNarration({ api, state, notify, shell, features, dialogs }) {
  const { apiCall, apiFetch } = api;
  const { showError, scribeErrorMessage } = notify;
  const { settings, data } = state;

  let narrationState = 'idle'; // idle|starting|playing|paused|completed|failed
  let narrationAuto = false; // keep flipping pages once each is narrated
  let narrationAudio = null;
  let narrationGenerationId = null;
  let narrationCacheHit = false;
  let reviewing = false; // a paid-consent check is running: no second submission
  const appliedNarrationCosts = new Set(); // generation ids already billed this session

  function narrationConfigured() {
    return Boolean(settings.narrationModel && settings.narrationVoice);
  }

  function openNarrationSettings() {
    // Keep the visible surface and canonical hash in lockstep. Bootstrap
    // supplies the route-aware opener; the fallback keeps isolated feature
    // tests and embedders functional without a router.
    if (typeof features.settings.open === 'function') features.settings.open();
    else shell.showSection('settings');
    features.settings.loadSpeechModels().then(features.settings.renderNarrationSettings);
  }

  async function speechModelEntry() {
    try {
      const models = await features.settings.loadSpeechModels();
      return models.find((m) => m.id === settings.narrationModel) || null;
    } catch {
      return null;
    }
  }

  // The per-page review for a single Read-aloud press.
  async function reviewPageNarration() {
    if (reviewing) return false;
    reviewing = true;
    const entry = await speechModelEntry();
    const estimate = entry ? features.settings.estimateNarrationCostPerPage(entry) : ROUGH_NARRATION_PAGE_ESTIMATE;
    const yes = await dialogs.confirmPaid({
      title: 'Read this page aloud?',
      review: {
        action: `Narrate page ${data.currentPage} of "${data.currentStory?.title}" with the chosen voice.`,
        object: `page ${data.currentPage} of "${data.currentStory?.title}"`,
        model: entry ? `${entry.name} · voice ${settings.narrationVoice}` : null,
        quantity: 'one page of spoken audio',
        sends: 'the text of this page to the speech provider',
        estimate,
        note: 'A page you have had read before may be replayed from cache and cost nothing - never promised, just possible.',
      },
      confirmLabel: `Read it (${approxCostText(estimate)})`,
    });
    reviewing = false;
    return yes;
  }

  // The once-per-run review for Auto-read: every remaining narratable page,
  // one after the other, stoppable anytime.
  async function reviewAutoNarration() {
    if (reviewing) return false;
    reviewing = true;
    const entry = await speechModelEntry();
    const remaining = (data.storyPages || []).filter(
      (p) => p.page_number >= data.currentPage && !p.image_media_type && String(p.content || '').trim()
    ).length;
    const perPage = entry ? features.settings.estimateNarrationCostPerPage(entry) : ROUGH_NARRATION_PAGE_ESTIMATE;
    const estimate = perPage * remaining;
    const yes = await dialogs.confirmPaid({
      title: 'Keep reading pages aloud?',
      review: {
        action: `Auto-read the tale from page ${data.currentPage}: each remaining narratable page is narrated, one after the other, until the end or you stop.`,
        object: `${remaining} remaining narratable page${remaining === 1 ? '' : 's'} of "${data.currentStory?.title}"`,
        model: entry ? `${entry.name} · voice ${settings.narrationVoice}` : null,
        quantity: `${remaining} page${remaining === 1 ? '' : 's'} of spoken audio`,
        sends: 'the text of each page, as it is reached, to the speech provider',
        estimate,
        note: 'The ■ control stops the run at any page; pages already read stay read.',
      },
      confirmLabel: `Auto-read (${approxCostText(estimate)})`,
    });
    reviewing = false;
    return yes;
  }

  function setNarrationState(st) {
    narrationState = st;
    const btn = document.getElementById('readAloudBtn');
    const stop = document.getElementById('narrationStopBtn');
    if (!btn || !stop) return;
    switch (st) {
      case 'starting':
        btn.textContent = 'Preparing…';
        stop.hidden = false;
        break;
      case 'playing':
        btn.textContent = 'Pause';
        stop.hidden = false;
        break;
      case 'paused':
        btn.textContent = 'Resume';
        stop.hidden = false;
        break;
      case 'completed':
        btn.textContent = 'Read again';
        stop.hidden = true;
        break;
      case 'failed':
        btn.textContent = 'Retry reading';
        stop.hidden = true;
        break;
      default:
        btn.textContent = 'Read aloud';
        stop.hidden = true;
    }
    btn.setAttribute('aria-label', 'Read the current page aloud' + (st === 'playing' ? ' (now playing)' : ''));
  }

  // Autoplay: once this page is narrated, flip to the next and keep reading
  // until the tale runs out or the user stops.
  function maybeAutoAdvanceNarration() {
    if (!narrationAuto || !data.currentStory) return;
    if (data.currentPage < data.storyPages.length) {
      setTimeout(() => {
        if (!narrationAuto || !data.currentStory) return; // user changed their mind meanwhile
        features.write.navigatePage(1); // also stops the finished playback cleanly
        doNarration(); // the auto-read run's consent covers every page it reaches
      }, 350); // a breath between pages
    } else {
      notify.showSuccess('The scribe has read to the end of the written tale.');
    }
  }

  function stopNarration() {
    if (narrationAudio) {
      narrationAudio.pause();
      narrationAudio.src = '';
      try { narrationAudio.load(); } catch { /* jsdom: not implemented */ }
      narrationAudio = null;
    }
    narrationGenerationId = null;
    if (narrationState !== 'idle') setNarrationState('idle');
  }

  // Apply the authoritative cost for a generation exactly once.
  async function settleNarrationCost() {
    const id = narrationGenerationId;
    narrationGenerationId = null;
    if (!id || narrationCacheHit || appliedNarrationCosts.has(id)) return;
    appliedNarrationCosts.add(id);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cost = await apiCall(`/ai/generation-cost?id=${encodeURIComponent(id)}`);
        if (typeof cost.cost_usd === 'number') {
          state.addCost(cost.cost_usd);
          return;
        }
        if (cost && cost.error && String(cost.error).includes('not ready')) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue; // metadata not ready: bounded retry
        }
        return; // unexpected shape: give up quietly
      } catch {
        return; // give up quietly; the ledger keeps other costs honest
      }
    }
  }

  // The paid entry point: pass the remembered consent gate, then run.
  // Auto-advance pages carry the run's consent and call doNarration directly.
  async function startNarration() {
    if (!narrationStateAllowsStart()) return;
    if (!narrationConfigured()) {
      showError('Narration is not configured — choose a speech model and voice in Settings.');
      openNarrationSettings();
      return;
    }
    const { currentStory, currentPage, storyPages } = data;
    if (!currentStory || storyPages.length === 0 || currentPage > storyPages.length) {
      showError('Select a page to read first.');
      return;
    }
    if (!(await reviewPageNarration())) return; // cancel: zero paid requests
    doNarration();
  }

  function doNarration() {
    if (!narrationStateAllowsStart()) return;
    if (!narrationConfigured()) {
      showError('Narration is not configured — choose a speech model and voice in Settings.');
      openNarrationSettings();
      return;
    }
    const { currentStory, currentPage, storyPages } = data;
    if (!currentStory || storyPages.length === 0 || currentPage > storyPages.length) {
      showError('Select a page to read first.');
      return;
    }
    stopNarration();

    setNarrationState('starting');
    const audio = new Audio();
    narrationAudio = audio;
    narrationCacheHit = false;
    apiFetch(`/api/stories/${currentStory.id}/pages/${currentPage}/narrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.narrationModel, voice: settings.narrationVoice }),
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((body) => { throw new Error(body.error || `Narration failed (${response.status})`); });
        }
        narrationGenerationId = response.headers.get('X-Generation-Id');
        narrationCacheHit = response.headers.get('X-Narration-Cache') === 'hit';
        return response.blob();
      })
      .then((blob) => {
        if (narrationAudio !== audio) return; // superseded meanwhile
        audio.src = URL.createObjectURL(blob);
        const played = audio.play();
        if (played && played.catch) played.catch(() => setNarrationState('failed'));
      })
      .catch((error) => {
        if (narrationAudio !== audio) return;
        showError(scribeErrorMessage(error.message));
        setNarrationState('failed');
      });

    audio.addEventListener('playing', () => {
      if (narrationAudio === audio) setNarrationState('playing');
    });
    audio.addEventListener('ended', () => {
      if (narrationAudio === audio) {
        setNarrationState('completed');
        settleNarrationCost();
        maybeAutoAdvanceNarration();
      }
    });
    audio.addEventListener('error', () => {
      if (narrationAudio === audio) {
        setNarrationState('failed');
        settleNarrationCost();
      }
    });
  }

  function narrationStateAllowsStart() {
    return ['idle', 'completed', 'failed', 'paused'].includes(narrationState) ||
      (narrationState === 'playing');
  }

  function onReadAloudClick() {
    if (narrationState === 'playing') {
      if (narrationAudio) narrationAudio.pause();
      setNarrationState('paused');
      return;
    }
    if (narrationState === 'paused') {
      if (narrationAudio) {
        const played = narrationAudio.play();
        if (played && played.catch) played.catch(() => setNarrationState('failed'));
      }
      setNarrationState('playing');
      return;
    }
    startNarration();
  }

  function init() {
    const btn = document.getElementById('readAloudBtn');
    if (btn) btn.addEventListener('click', onReadAloudClick);
    const stopBtn = document.getElementById('narrationStopBtn');
    if (stopBtn) stopBtn.addEventListener('click', stopNarration);
    const autoBtn = document.getElementById('narrationAutoBtn');
    if (autoBtn) {
      autoBtn.addEventListener('click', async () => {
        if (narrationAuto) {
          // ■ : stop the run; any in-flight page finishes this once.
          narrationAuto = false;
          autoBtn.setAttribute('aria-pressed', 'false');
          autoBtn.classList.remove('active');
          return;
        }
        if (!data.currentStory) return; // nothing selected: no run to promise
        if (!narrationConfigured()) {
          // Same honest dead end as Read aloud: fix it in Settings.
          showError('Narration is not configured — choose a speech model and voice in Settings.');
          openNarrationSettings();
          return;
        }
        if (!(await reviewAutoNarration())) return; // cancel keeps auto off
        narrationAuto = true;
        autoBtn.setAttribute('aria-pressed', 'true');
        autoBtn.classList.add('active');
      });
    }
    setNarrationState('idle');
  }

  return {
    setNarrationState,
    stopNarration,
    startNarration,
    onReadAloudClick,
    __lastNarrationAudio: () => narrationAudio,
    init,
  };
}
