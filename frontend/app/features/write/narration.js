// Narration: streaming page read-aloud with pause/resume, autoplay, stop,
// and idempotent cost settlement per generation id (replays never re-bill).

export function createNarration({ api, state, notify, shell, features }) {
  const { apiCall } = api;
  const { showError, scribeErrorMessage } = notify;
  const { settings, data } = state;

  let narrationState = 'idle'; // idle|starting|playing|paused|completed|failed
  let narrationAuto = false; // keep flipping pages once each is narrated
  let narrationAudio = null;
  let narrationGenerationId = null;
  let narrationCacheHit = false;
  const appliedNarrationCosts = new Set(); // generation ids already billed this session

  function narrationConfigured() {
    return Boolean(settings.narrationModel && settings.narrationVoice);
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
        startNarration();
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

  function startNarration() {
    if (!narrationStateAllowsStart()) return;
    if (!narrationConfigured()) {
      showError('Narration is not configured — choose a speech model and voice in Settings.');
      shell.showSection('settings');
      features.settings.loadSpeechModels().then(features.settings.renderNarrationSettings);
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
    fetch(`/api/stories/${currentStory.id}/pages/${currentPage}/narrate`, {
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
      autoBtn.addEventListener('click', () => {
        narrationAuto = !narrationAuto;
        autoBtn.setAttribute('aria-pressed', narrationAuto ? 'true' : 'false');
        autoBtn.classList.toggle('active', narrationAuto);
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
