// Gate keeps full-fidelity backup separate from allowlisted publication.
// Every selected format is built from one immutable PublicationDocument;
// this feature never invokes a provider.

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createGate({ api, state, notify, features, dialogs, router }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let routeController = router;
  let activeStoryId = null;
  let assets = [];
  let placements = [];
  let currentJob = null;
  let currentSnapshot = null;
  let currentShares = [];
  let revealedShareId = null;
  let pollTimer = null;
  let loadToken = 0;

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function selectedFormats() {
    return [...document.querySelectorAll('[name="publication-format"]:checked')].map((input) => input.value);
  }

  function selectedArtIds() {
    return [...document.querySelectorAll('#gateArtList [data-asset-id]:checked')].map((input) => input.dataset.assetId);
  }

  function renderArt() {
    const target = document.getElementById('gateArtList');
    if (!target) return;
    target.textContent = '';
    const placed = new Set(placements.map((placement) => placement.asset_id));
    const choices = assets.filter((asset) => placed.has(asset.id));
    for (const asset of choices) {
      const label = el('label', 'gate-art-row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.assetId = asset.id;
      checkbox.setAttribute('aria-label', `Publish ${asset.title || 'placed image'}`);
      const image = document.createElement('img');
      image.src = asset.content_url;
      image.alt = '';
      const copy = el('span', 'gate-art-row__copy');
      copy.append(el('strong', '', asset.title || 'Placed image'));
      if (asset.alt_text) copy.append(el('span', '', asset.alt_text));
      else copy.append(el('span', 'gate-art-row__warning', 'No alt text. Gate will warn and use an explicit missing-description label.'));
      label.append(checkbox, image, copy);
      target.appendChild(label);
    }
    if (!choices.length) target.appendChild(el('p', 'setting-hint', 'This manuscript has no placed art. Gallery-only images are never offered for publication.'));
  }

  function publicationPayload(story) {
    const front = document.getElementById('gateFrontMatter')?.value.trim() || '';
    const back = document.getElementById('gateBackMatter')?.value.trim() || '';
    return {
      metadata: {
        title: document.getElementById('gatePublicationTitle').value.trim(),
        author: document.getElementById('gatePublicationAuthor').value.trim(),
        language: document.getElementById('gatePublicationLanguage').value.trim(),
      },
      front_matter: front ? [{ role: 'preface', title: 'Preface', text: front }] : [],
      back_matter: back ? [{ role: 'afterword', title: 'Afterword', text: back }] : [],
      art: { asset_ids: selectedArtIds() },
      expected_story_updated_at: story.updated_at,
    };
  }

  function structureSummary(documentValue) {
    const volumes = documentValue.volumes.length;
    const chapters = documentValue.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0);
    const pages = documentValue.volumes.reduce((sum, volume) =>
      sum + volume.chapters.reduce((chapterSum, chapter) => chapterSum + chapter.pages.length, 0), 0);
    return { volumes, chapters, pages };
  }

  function reviewDialog(snapshot, formats) {
    const body = el('div', 'gate-review');
    const summary = structureSummary(snapshot.document);
    body.append(
      el('p', '', `One immutable book is ready: ${summary.volumes} volume${summary.volumes === 1 ? '' : 's'}, ${summary.chapters} chapter${summary.chapters === 1 ? '' : 's'}, and ${summary.pages} prose page${summary.pages === 1 ? '' : 's'}.`),
      el('p', '', `Formats: ${formats.join(', ').toUpperCase()}. Selected art: ${snapshot.document.assets.length}.`),
      el('p', '', `Metadata: “${snapshot.document.metadata.title}”${snapshot.document.metadata.author ? ` by ${snapshot.document.metadata.author}` : ''} · ${snapshot.document.metadata.language}.`),
      el('p', 'gate-review__excluded', 'Excluded: directions, continuity, speculative work, recovery, prompts, provider traces, costs, credentials, sessions, and working history.'),
    );
    for (const warning of snapshot.warnings || []) body.appendChild(el('p', 'gate-art-row__warning', warning.message));
    dialogs.openDialog({
      title: 'Review the normalized reading copy',
      body,
      actions: [
        { label: 'Back', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        {
          label: `Build ${formats.length} format${formats.length === 1 ? '' : 's'}`,
          className: 'btn-primary',
          onClick: async (close) => {
            close(true);
            try {
              const result = await apiCall(`/publications/${snapshot.id}/exports`, 'POST', { formats });
              currentJob = result.job;
              renderJob(currentJob);
              pollJob();
            } catch (error) { showError(error.message); }
          },
        },
      ],
    });
  }

  async function reviewPublication(event) {
    event?.preventDefault();
    const story = state.data.currentStory;
    if (!story || story.id !== activeStoryId) return showError('Choose this manuscript again before publishing.');
    const formats = selectedFormats();
    if (!formats.length) return showError('Choose at least one publication format.');
    const button = document.getElementById('gateReviewPublicationBtn');
    if (button) button.disabled = true;
    try {
      const result = await apiCall(`/stories/${story.id}/publications`, 'POST', publicationPayload(story));
      currentSnapshot = result.snapshot;
      const createShare = document.getElementById('gateCreateShareBtn');
      if (createShare) createShare.disabled = false;
      const hint = document.getElementById('gateShareHint');
      if (hint) hint.textContent = `Snapshot ${currentSnapshot.sha256.slice(0, 12)} is ready to share.`;
      reviewDialog(result.snapshot, formats);
    } catch (error) { showError(error.message); }
    finally { if (button) button.disabled = false; }
    return undefined;
  }

  function renderJob(job) {
    const section = document.getElementById('gateJob');
    if (!section) return;
    section.hidden = false;
    const status = document.getElementById('gateJobStatus');
    const progress = document.getElementById('gateJobProgress');
    const downloads = document.getElementById('gateJobDownloads');
    const cancel = document.getElementById('gateCancelJobBtn');
    const retry = document.getElementById('gateRetryJobBtn');
    if (status) status.textContent = job.status === 'ready'
      ? `${job.completed_formats} publication file${job.completed_formats === 1 ? '' : 's'} ready from snapshot ${job.snapshot_sha256.slice(0, 12)}.`
      : job.status === 'failed'
        ? `Publication failed: ${job.error || 'unknown adapter error'}. No partial file is available.`
        : job.status === 'cancelled'
          ? 'Publication cancelled. Partial staging was removed.'
          : `Building ${job.completed_formats + 1} of ${job.total_formats} from one immutable snapshot…`;
    if (progress) {
      progress.max = job.total_formats || 1;
      progress.value = job.completed_formats || 0;
    }
    if (downloads) {
      downloads.textContent = '';
      for (const output of job.outputs || []) {
        const link = el('a', 'btn btn-primary', `Download ${output.format.toUpperCase()}`);
        link.href = output.download_url;
        link.download = output.filename;
        downloads.appendChild(link);
      }
    }
    if (cancel) cancel.hidden = !['queued', 'running'].includes(job.status);
    if (retry) retry.hidden = !['failed', 'cancelled'].includes(job.status);
  }

  async function pollJob() {
    stopPolling();
    if (!currentJob || !['queued', 'running'].includes(currentJob.status)) return;
    try {
      const result = await apiCall(`/publication-jobs/${currentJob.id}`);
      currentJob = result.job;
      renderJob(currentJob);
      if (['queued', 'running'].includes(currentJob.status)) pollTimer = setTimeout(pollJob, 500);
      else if (currentJob.status === 'ready') showSuccess('Publication files are ready. Every format came from the same frozen book.');
    } catch (error) { showError(error.message); }
  }

  async function cancelJob() {
    if (!currentJob) return;
    try {
      const result = await apiCall(`/publication-jobs/${currentJob.id}/cancel`, 'POST', {});
      currentJob = result.job;
      renderJob(currentJob);
      if (currentJob.status === 'running') pollJob();
    } catch (error) { showError(error.message); }
  }

  async function retryJob() {
    if (!currentJob) return;
    try {
      const result = await apiCall(`/publication-jobs/${currentJob.id}/retry`, 'POST', {});
      currentJob = result.job;
      renderJob(currentJob);
      pollJob();
    } catch (error) { showError(error.message); }
  }

  function renderShares() {
    const target = document.getElementById('gateShareList');
    if (!target) return;
    target.textContent = '';
    if (!currentShares.length) {
      target.appendChild(el('p', 'setting-hint', 'No reading-copy links exist for this manuscript.'));
      return;
    }
    for (const share of currentShares) {
      const row = el('section', 'gate-share-row');
      const expiry = share.expires_at ? `Expires ${share.expires_at}` : 'No automatic expiry';
      row.appendChild(el('p', '', `${share.status === 'active' ? 'Active' : share.status} · ${expiry} · snapshot ${share.snapshot_sha256.slice(0, 12)}`));
      if (share.status === 'active') {
        const revoke = el('button', 'btn btn-secondary', 'Revoke link');
        revoke.type = 'button';
        revoke.addEventListener('click', () => revokeShare(share.id));
        row.appendChild(revoke);
      }
      target.appendChild(row);
    }
  }

  async function loadShares() {
    if (!activeStoryId) return;
    const result = await apiCall(`/publication-shares?story_id=${encodeURIComponent(activeStoryId)}`);
    currentShares = result.shares || [];
    renderShares();
  }

  async function createShare() {
    if (!currentSnapshot) return showError('Review a publication snapshot before creating a reading-copy link.');
    const button = document.getElementById('gateCreateShareBtn');
    if (button) button.disabled = true;
    try {
      const rawExpiry = document.getElementById('gateShareExpiry')?.value || '';
      const result = await apiCall(`/publications/${currentSnapshot.id}/shares`, 'POST', {
        expires_in_seconds: rawExpiry ? Number(rawExpiry) : null,
      });
      const absolute = new URL(result.share.share_url, window.location.href).href;
      const input = document.getElementById('gateShareUrl');
      if (input) input.value = absolute;
      revealedShareId = result.share.id;
      const reveal = document.getElementById('gateShareReveal');
      if (reveal) reveal.hidden = false;
      await loadShares();
      showSuccess('Reading-copy link created. Copy it now; only its hash is stored.');
    } catch (error) { showError(error.message); }
    finally { if (button) button.disabled = false; }
    return undefined;
  }

  async function performRevoke(shareId) {
    try {
      await apiCall(`/publication-shares/${shareId}/revoke`, 'POST', {});
      if (revealedShareId === shareId) {
        const input = document.getElementById('gateShareUrl');
        if (input) input.value = '';
        const reveal = document.getElementById('gateShareReveal');
        if (reveal) reveal.hidden = true;
        revealedShareId = null;
      }
      await loadShares();
      showSuccess('Reading-copy link revoked. It now fails closed.');
    } catch (error) { showError(error.message); }
  }

  function revokeShare(shareId) {
    const body = el('div', 'gate-review');
    body.append(
      el('p', '', 'This reading-copy link will stop working immediately.'),
      el('p', 'gate-review__excluded', 'This cannot be undone. The immutable snapshot remains private and can receive a new link later.'),
    );
    dialogs.openDialog({
      title: 'Revoke reading-copy link?',
      body,
      actions: [
        { label: 'Keep link', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        {
          label: 'Revoke permanently', className: 'btn-danger',
          onClick: async (close) => { close(true); await performRevoke(shareId); },
        },
      ],
    });
  }

  async function copyShare() {
    const input = document.getElementById('gateShareUrl');
    if (!input?.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      showSuccess('Reading-copy link copied.');
    } catch {
      input.select();
      showError('Copy was blocked by the browser. The link is selected for manual copying.');
    }
  }

  async function chooseStory(storyId) {
    let story = state.data.currentStory?.id === storyId ? state.data.currentStory : state.data.stories.find((item) => item.id === storyId);
    if (!story) {
      await features.stories.loadStories();
      story = state.data.stories.find((item) => item.id === storyId);
    }
    if (!story) return null;
    if (state.data.currentStory?.id !== story.id) {
      features.write.resetStoryReader();
      state.data.currentStory = story;
      state.resetStoryCost();
    }
    return story;
  }

  async function enter(params = {}) {
    if (!params.storyId) return;
    const token = ++loadToken;
    const story = await chooseStory(params.storyId);
    if (!story) {
      showError('That manuscript could not be found.');
      routeController.navigate('library-stories');
      return;
    }
    activeStoryId = story.id;
    document.getElementById('gatePublicationTitle').value = story.title;
    try {
      const [listing, shareListing] = await Promise.all([
        apiCall(`/stories/${story.id}/assets`),
        apiCall(`/publication-shares?story_id=${encodeURIComponent(story.id)}`),
      ]);
      if (token !== loadToken || activeStoryId !== story.id) return;
      assets = listing.assets || [];
      placements = listing.placements || [];
      currentShares = shareListing.shares || [];
      renderArt();
      renderShares();
    } catch (error) {
      if (token === loadToken) showError(error.message);
    }
  }

  function init() {
    document.getElementById('gateBackupBtn')?.addEventListener('click', () => {
      if (activeStoryId) features.transfer.openExport({ scope: 'story', id: activeStoryId });
    });
    document.getElementById('gatePublicationForm')?.addEventListener('submit', reviewPublication);
    document.getElementById('gateCancelJobBtn')?.addEventListener('click', cancelJob);
    document.getElementById('gateRetryJobBtn')?.addEventListener('click', retryJob);
    document.getElementById('gateCreateShareBtn')?.addEventListener('click', createShare);
    document.getElementById('gateCopyShareBtn')?.addEventListener('click', copyShare);
  }

  function reset() {
    stopPolling();
    loadToken++;
    activeStoryId = null;
    assets = [];
    placements = [];
    currentJob = null;
    currentSnapshot = null;
    currentShares = [];
    revealedShareId = null;
    document.getElementById('gateArtList')?.replaceChildren();
    const job = document.getElementById('gateJob');
    if (job) job.hidden = true;
    const createShare = document.getElementById('gateCreateShareBtn');
    if (createShare) createShare.disabled = true;
    const reveal = document.getElementById('gateShareReveal');
    if (reveal) reveal.hidden = true;
    document.getElementById('gateShareList')?.replaceChildren();
  }

  return {
    init, enter, reset, reviewPublication, renderJob, pollJob, createShare, revokeShare, renderShares,
    setRouter(value) { routeController = value; },
  };
}
