// Audiobooks: the whole tale read aloud as one mp3 through the single
// global queue. A modal advertises the narrator verdict + estimate; the final
// start passes the shared paid-consent gate; the pending banner carries progress;
// the ready banner shows once per completed reading; the Bookshelf owns
// downloads afterwards.

import { formatUsd, formatMinutes, formatMb } from '../../core/dom.js';
import { ROUGH_NARRATION_PAGE_ESTIMATE } from '../../core/cost.js';
import { wireModal } from '../../core/dialogs.js';

export function createAudiobook({ api, state, notify, shell, features, dialogs }) {
  const { apiCall, API_BASE_URL } = api;
  const { showError, scribeErrorMessage } = notify;
  const { settings, data } = state;

  const AUDIOBOOK_EST_WORDS_PER_MIN = 150; // measured speaking pace
  const AUDIOBOOK_EST_BYTES_PER_SECOND = 6 * 1024; // ~48 kbps mono mp3

  // Session + story tick exactly once per completed reading.
  const chargedAudiobooks = new Set();
  let audiobookPollTimer = null;
  let audiobookModal = null; // wired lifecycle controller

  function audiobookTextPages() {
    return data.storyPages.filter((p) => !p.image_media_type && String(p.content || '').trim());
  }

  // Same honest math as the per-page labels in Settings: chars priced per
  // million, audio tokens approximated at ~20 per word.
  function audiobookEstimate(modelEntry) {
    const pages = audiobookTextPages();
    let words = 0;
    let chars = 0;
    for (const page of pages) {
      const text = String(page.content || '').trim();
      words += text.split(/\s+/).filter(Boolean).length;
      chars += text.length;
    }
    const durationS = Math.round((words / AUDIOBOOK_EST_WORDS_PER_MIN) * 60);
    const p = modelEntry?.pricing || {};
    const hasCataloguePrice = Number.isFinite(p.prompt_per_mchar) || Number.isFinite(p.completion_per_mtok);
    const pricedCost = (chars * (p.prompt_per_mchar || 0) + words * 20 * (p.completion_per_mtok || 0)) / 1e6;
    const cost = modelEntry && !hasCataloguePrice
      ? pages.length * ROUGH_NARRATION_PAGE_ESTIMATE
      : pricedCost;
    return {
      pages: pages.length,
      words,
      duration_s: durationS,
      size_bytes: Math.round(durationS * AUDIOBOOK_EST_BYTES_PER_SECOND),
      cost_usd: Number.isFinite(cost) ? cost : pages.length * ROUGH_NARRATION_PAGE_ESTIMATE,
    };
  }

  // Why can (or cannot) the currently chosen narrator read a whole book?
  async function audiobookNarratorVerdict() {
    const models = await features.settings.loadSpeechModels();
    const entry = models.find((m) => m.id === settings.narrationModel) || null;
    if (!settings.narrationModel || !entry) {
      return { entry: null, usable: false, reason: 'No narrator chosen — pick a speech model and voice in Settings first.' };
    }
    if (!settings.narrationVoice || !entry.voices.some((v) => v.id === settings.narrationVoice)) {
      return { entry, usable: false, reason: 'Choose a voice in Settings first.' };
    }
    if (entry.pcm) {
      return { entry, usable: false, reason: `${entry.name} speaks WAV-only, which cannot be bound into a single-sound audiobook. Choose an mp3 narrator in Settings.` };
    }
    const voiceLabel = (entry.voices.find((v) => v.id === settings.narrationVoice) || {}).label || settings.narrationVoice;
    return { entry, usable: true, reason: `Narrator: ${entry.name} · voice ${voiceLabel}.` };
  }

  async function openAudiobookModal() {
    const modal = document.getElementById('audiobookModal');
    const body = document.getElementById('audiobookModalBody');
    const existingEl = document.getElementById('audiobookExisting');
    const startBtn = document.getElementById('audiobookStartBtn');
    if (!modal || !body || !startBtn) return;
    if (!data.currentStory) {
      showError('Choose a manuscript first.');
      return;
    }
    const verdict = await audiobookNarratorVerdict();
    const estimate = audiobookEstimate(verdict.entry);
    const lines = [verdict.reason];
    if (verdict.usable && estimate.pages > 0) {
      lines.push(
        `${estimate.pages} page${estimate.pages === 1 ? '' : 's'} · ≈${formatMinutes(estimate.duration_s)} of listening · ` +
          `≈${formatMb(estimate.size_bytes)} · ≈${formatUsd(estimate.cost_usd)} in narration.`
      );
      lines.push('Unchanged pages are remembered — regenerating after edits re-bills only what changed.');
    } else if (verdict.usable && estimate.pages === 0) {
      lines.push('This tale has no narratable pages yet.');
    }
    body.textContent = lines.join('\n');
    body.style.whiteSpace = 'pre-line';

    const row = await refreshAudiobook();
    let blocked = !verdict.usable || estimate.pages === 0;
    if (existingEl) {
      if (row && row.status === 'pending') {
        existingEl.textContent = 'This manuscript is already being read aloud — watch the banner below it.';
        existingEl.hidden = false;
        blocked = true;
      } else if (row && row.status === 'ready') {
        const stale = row.stale ? ' The tale has changed since — the changed pages will be re-billed.' : '';
        existingEl.textContent = `An audiobook already exists (≈${formatMinutes(row.duration_s || 0)}, ${formatUsd(row.cost_usd || 0)}). Generating again replaces it.${stale}`;
        existingEl.hidden = false;
      } else if (row && row.status === 'failed') {
        existingEl.textContent = `The last reading failed: ${row.error || 'unknown error'}. Starting again retries it.`;
        existingEl.hidden = false;
      } else {
        existingEl.hidden = true;
      }
    }

    // Price on the button, with the blocking reason kept in the modal copy.
    startBtn.textContent = verdict.entry && estimate.cost_usd > 0
      ? `Create audiobook (≈${formatUsd(estimate.cost_usd)})`
      : 'Create audiobook';
    startBtn.disabled = blocked;
    startBtn.dataset.blockedReason = blocked ? (verdict.usable ? 'no narratable pages' : 'narrator unusable') : '';
    audiobookModal?.open(); // wired lifecycle: focus entry, scroll lock, opener
  }

  function closeAudiobookModal() {
    audiobookModal?.close(); // restores the opener, unlocks the document
  }

  async function startAudiobook() {
    if (!data.currentStory) return;
    // The final commitment goes through the shared consent gate. Its first
    // review includes narrator, page count, duration, size, and estimate.
    // Cancel keeps the modal flow intact (nothing is sent).
    const verdict = await audiobookNarratorVerdict();
    const estimate = audiobookEstimate(verdict.entry);
    const price = verdict.entry ? estimate.cost_usd : null;
    closeAudiobookModal();
    const yes = await dialogs.confirmPaid({
      title: 'Read the whole tale aloud?',
      review: {
        action: `Bind "${data.currentStory.title}" into a single mp3 audiobook.`,
        object: `"${data.currentStory.title}", ${estimate.pages} narratable page${estimate.pages === 1 ? '' : 's'}`,
        model: verdict.entry ? `${verdict.entry.name} · voice ${settings.narrationVoice}` : null,
        quantity: `≈${formatMinutes(estimate.duration_s)} of listening · ≈${formatMb(estimate.size_bytes)}`,
        sends: 'the text of every narratable page, page by page, to the speech provider',
        estimate: price,
        note: 'Unchanged pages are remembered - regenerating after edits re-bills only what changed.',
      },
      confirmLabel: price !== null
        ? `Create audiobook (${price === 0 ? 'free' : `≈${formatUsd(price)}`})`
        : 'Create audiobook',
    });
    if (!yes) {
      openAudiobookModal();
      return;
    }
    try {
      const res = await apiCall(`/stories/${data.currentStory.id}/audiobook`, 'POST', {
        model: settings.narrationModel,
        voice: settings.narrationVoice,
      });
      updateAudiobookBanner(res.audiobook);
      startAudiobookPolling();
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  // The ready banner appears once per completed reading (the Bookshelf owns
  // the download afterwards); the pending banner always shows while reading.
  function audiobookSeenKey(storyId, row) {
    return `st-ab-seen:${storyId}:${row.updated_at || row.created_at || ''}`;
  }

  function audiobookWasSeen(storyId, row) {
    try {
      return localStorage.getItem(audiobookSeenKey(storyId, row)) === '1';
    } catch {
      return false;
    }
  }

  function markAudiobookSeen(storyId, row) {
    try {
      localStorage.setItem(audiobookSeenKey(storyId, row), '1');
    } catch {
      /* private mode: just for this session */
    }
  }

  function audiobookBannerRow(storyId, row) {
    const show = row.status === 'pending' ||
      (row.status === 'ready' && !audiobookWasSeen(storyId, row)) ||
      row.status === 'failed';
    return show ? row : null;
  }

  function updateAudiobookBanner(row) {
    const banner = document.getElementById('audiobookBanner');
    const textEl = document.getElementById('audiobookBannerText');
    const progress = document.getElementById('audiobookProgress');
    const fill = document.getElementById('audiobookProgressFill');
    const actions = document.getElementById('audiobookBannerActions');
    if (!banner || !textEl || !progress || !fill || !actions) return;
    if (!data.currentStory || !row || !audiobookBannerRow(data.currentStory.id, row)) {
      banner.hidden = true;
      return;
    }
    actions.textContent = '';
    if (row.status === 'pending') {
      const reading = row.queue_position === 0 || row.queue_position === undefined;
      if (reading) {
        textEl.textContent = `The scribe reads the tale aloud — page ${row.pages_done || 0} of ${row.pages_total || 0}…`;
        const total = row.pages_total || 1;
        const pct = Math.round(((row.pages_done || 0) / total) * 100);
        fill.style.width = `${pct}%`;
        fill.setAttribute('aria-valuenow', String(pct));
        progress.hidden = false;
      } else {
        const ahead = row.queue_position === 1 ? '1 tale is' : `${row.queue_position} tales are`;
        textEl.textContent = `Waiting for the scribe — ${ahead} ahead in the queue.`;
        progress.hidden = true; // nothing to measure yet while queued
      }
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'ghost-btn';
      stop.textContent = 'Stop';
      stop.addEventListener('click', stopAudiobook);
      actions.append(stop);
      actions.hidden = false;
      banner.hidden = false;
      return;
    }
    progress.hidden = true;
    if (row.status === 'ready') {
      const stale = row.stale ? ' (the tale has changed since it was read)' : '';
      const missing = row.file_missing ? ' — the file is missing, generate it again' : '';
      textEl.textContent = `The audiobook is ready — ≈${formatMinutes(row.duration_s || 0)} · ${formatUsd(row.cost_usd || 0)}${stale}${missing}.`;
      const download = document.createElement('a');
      download.className = 'ghost-btn';
      download.href = `${API_BASE_URL}/stories/${data.currentStory.id}/audiobook/audio`;
      download.textContent = 'Download';
      actions.append(download);
      chargeAudiobookCost(data.currentStory.id, row);
    } else if (row.status === 'failed') {
      textEl.textContent = `The reading failed: ${row.error || 'unknown error'}.`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ghost-btn';
      retry.textContent = 'Open audiobook';
      retry.addEventListener('click', openAudiobookModal);
      actions.append(retry);
    }
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'ghost-btn';
    hide.textContent = 'Hide';
    hide.addEventListener('click', () => {
      markAudiobookSeen(data.currentStory.id, row);
      banner.hidden = true;
    });
    actions.append(hide);
    actions.hidden = false;
    banner.hidden = false;
  }

  function chargeAudiobookCost(storyId, row) {
    const key = `${storyId}@${row.updated_at || row.created_at || ''}`;
    if (typeof row.cost_usd !== 'number' || row.cost_usd <= 0 || chargedAudiobooks.has(key)) return;
    chargedAudiobooks.add(key);
    state.addCost(row.cost_usd);
  }

  function startAudiobookPolling() {
    stopAudiobookPolling();
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) return; // tests drive updates directly
    audiobookPollTimer = setInterval(async () => {
      if (!data.currentStory) return stopAudiobookPolling();
      const row = await refreshAudiobook();
      if (!row || row.status !== 'pending') stopAudiobookPolling();
    }, 2000);
  }

  function stopAudiobookPolling() {
    if (audiobookPollTimer) {
      clearInterval(audiobookPollTimer);
      audiobookPollTimer = null;
    }
  }

  async function refreshAudiobook() {
    if (!data.currentStory) return null;
    try {
      const res = await apiCall(`/stories/${data.currentStory.id}/audiobook`);
      const row = res.audiobook || null;
      updateAudiobookBanner(row);
      if (row && row.status === 'pending') startAudiobookPolling();
      if (row && row.status === 'ready') shell.checkDiskSpace(); // megabytes just landed
      return row;
    } catch {
      return null;
    }
  }

  async function stopAudiobook() {
    if (!data.currentStory) return;
    try {
      const res = await apiCall(`/stories/${data.currentStory.id}/audiobook/cancel`, 'POST');
      updateAudiobookBanner(res.audiobook);
      if (res.audiobook?.status !== 'pending') stopAudiobookPolling();
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  function init() {
    const btn = document.getElementById('audiobookBtn');
    if (btn) btn.addEventListener('click', openAudiobookModal);
    const modal = document.getElementById('audiobookModal');
    const start = document.getElementById('audiobookStartBtn');
    const cancel = document.getElementById('audiobookCancelBtn');
    if (!modal || !start || !cancel) return;
    // One wired lifecycle; the modal has no dirty state to guard.
    audiobookModal = wireModal('audiobookModal', { focusId: 'audiobookStartBtn' });
    cancel.addEventListener('click', closeAudiobookModal);
    start.addEventListener('click', startAudiobook);
  }

  return {
    audiobookEstimate,
    audiobookNarratorVerdict,
    openAudiobookModal,
    closeAudiobookModal,
    updateAudiobookBanner,
    refreshAudiobook,
    stopAudiobook,
    startAudiobookPolling,
    stopAudiobookPolling,
    markAudiobookSeen,
    init,
  };
}

