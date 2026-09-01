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
      const listing = await apiCall(`/stories/${story.id}/assets`);
      if (token !== loadToken || activeStoryId !== story.id) return;
      assets = listing.assets || [];
      placements = listing.placements || [];
      renderArt();
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
  }

  function reset() {
    stopPolling();
    loadToken++;
    activeStoryId = null;
    assets = [];
    placements = [];
    currentJob = null;
    document.getElementById('gateArtList')?.replaceChildren();
    const job = document.getElementById('gateJob');
    if (job) job.hidden = true;
  }

  return {
    init, enter, reset, reviewPublication, renderJob, pollJob,
    setRouter(value) { routeController = value; },
  };
}
