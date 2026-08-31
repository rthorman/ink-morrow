// Library storage: the all-story Bookshelf plus the per-story asset dialog
// opened from a story card. Deleting a plate deletes a REAL story page
// (renumbering the rest); an open reader must be refreshed.

import { API_BASE_URL } from '../../core/api.js';
import { formatUsd, formatMinutes, formatMb } from '../../core/dom.js';
import { wireModal } from '../../core/dialogs.js';
import { approxCostText, estimateContinuityCost } from '../../core/cost.js';

export function createBookshelf({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess, scribeErrorMessage } = notify;
  let storyAssetsModal = null;
  let activeStoryId = null;
  let activeContinuity = null;

  async function storageData() {
    return apiCall('/storage');
  }

  async function continuityData(storyId) {
    const result = await apiCall(`/stories/${storyId}/continuity`);
    return result.continuity || null;
  }

  async function loadBookshelf() {
    const list = document.getElementById('bookshelfList');
    if (!list) return;
    let data;
    try {
      data = await storageData();
    } catch (error) {
      list.textContent = '';
      const p = document.createElement('p');
      p.className = 'placeholder';
      p.textContent = `Could not load the bookshelf (${error.message}).`;
      list.appendChild(p);
      return;
    }
    list.textContent = '';
    const stories = data.stories || [];
    if (stories.length === 0) {
      // Moth keeps the archive; one sharp line, one clear action.
      const empty = document.createElement('div');
      empty.className = 'empty-state empty-state--archive';
      const art = document.createElement('img');
      art.src = 'brand/moth-archive.webp';
      art.alt = '';
      art.width = 1536;
      art.height = 1024;
      art.loading = 'lazy';
      art.decoding = 'async';
      const line = document.createElement('p');
      line.textContent = 'No audiobooks or painted plates yet. Moth has found nothing to catalogue.';
      const open = document.createElement('a');
      open.className = 'btn btn-primary';
      open.href = '#/library/stories';
      open.textContent = 'Open stories';
      empty.append(art, line, open);
      list.appendChild(empty);
      return;
    }
    for (const story of stories) {
      list.appendChild(bookshelfEntry(story));
    }
  }

  function bookshelfEntry(story) {
    const card = document.createElement('div');
    card.className = 'bookshelf-entry';

    const head = document.createElement('h3');
    head.textContent = story.title;
    card.appendChild(head);

    if (story.audiobook) {
      card.appendChild(bookshelfAudioBlock(story));
    } else {
      const none = document.createElement('p');
      none.className = 'bookshelf-entry__none';
      none.textContent = 'No audiobook kept.';
      card.appendChild(none);
    }

    if (story.plates && story.plates.length > 0) {
      const plates = document.createElement('div');
      plates.className = 'bookshelf-plates';
      for (const plate of story.plates) {
        plates.appendChild(bookshelfPlate(story, plate));
      }
      card.appendChild(plates);
    } else {
      const none = document.createElement('p');
      none.className = 'bookshelf-entry__none';
      none.textContent = 'No plates kept.';
      card.appendChild(none);
    }
    return card;
  }

  function bookshelfAudioBlock(story, afterChange = loadBookshelf) {
    const row = story.audiobook;
    const block = document.createElement('div');
    block.className = 'bookshelf-audio';

    const info = document.createElement('p');
    if (row.status === 'ready') {
      const stale = row.stale ? ' · stale (the tale changed)' : '';
      const missing = row.file_missing ? ' · file missing' : '';
      info.textContent = `Audiobook · ≈${formatMinutes(row.duration_s || 0)} · ${formatMb(row.size_bytes || 0)} · ${formatUsd(row.cost_usd || 0)}${stale}${missing}`;
    } else if (row.status === 'pending') {
      const queue = row.queue_position === 0 ? `reading — page ${row.pages_done || 0} of ${row.pages_total || 0}` : `waiting in queue (position ${row.queue_position})`;
      info.textContent = `Audiobook · ${queue}`;
    } else {
      info.textContent = `Audiobook · failed: ${row.error || 'unknown error'}`;
    }
    block.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'bookshelf-entry__actions';
    if (row.status === 'ready' && !row.file_missing) {
      const download = document.createElement('a');
      download.className = 'ghost-btn';
      download.href = `${API_BASE_URL}/stories/${story.id}/audiobook/audio`;
      download.textContent = 'Download';
      actions.appendChild(download);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      const yes = await dialogs.confirmDestructive({
        title: `Delete the audiobook of "${story.title}"?`,
        body: 'The kept reading will be permanently deleted. The pages stay; only the audio file goes.',
        confirmLabel: 'Delete audiobook',
      });
      if (!yes) return;
      try {
        await apiCall(`/stories/${story.id}/audiobook`, 'DELETE');
        await afterChange();
        if (state.data.currentStory && state.data.currentStory.id === story.id) features.audiobook.refreshAudiobook();
      } catch (error) {
        showError(scribeErrorMessage(error.message));
      }
    });
    actions.appendChild(del);
    block.appendChild(actions);
    return block;
  }

  function bookshelfPlate(story, plate, afterChange = loadBookshelf) {
    const wrap = document.createElement('div');
    wrap.className = 'bookshelf-plate';
    const img = document.createElement('img');
    img.src = `${API_BASE_URL}/stories/${story.id}/pages/${plate.page_number}/image`;
    img.alt = plate.image_prompt || `Painted plate for page ${plate.page_number}`;
    img.loading = 'lazy';
    wrap.appendChild(img);

    const caption = document.createElement('p');
    caption.textContent = `Page ${plate.page_number}${plate.size_bytes ? ` · ${formatMb(plate.size_bytes)}` : ''}`;
    wrap.appendChild(caption);

    const actions = document.createElement('div');
    actions.className = 'bookshelf-entry__actions';
    const download = document.createElement('a');
    download.className = 'ghost-btn';
    download.href = `${API_BASE_URL}/stories/${story.id}/pages/${plate.page_number}/image?download=1`;
    download.textContent = 'Save';
    actions.appendChild(download);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      const yes = await dialogs.confirmDestructive({
        title: `Delete the plate on page ${plate.page_number}?`,
        body: `This removes page ${plate.page_number} from "${story.title}" and renumbers every later page. It cannot be undone.`,
        confirmLabel: `Delete page ${plate.page_number}`,
      });
      if (!yes) return;
      try {
        await apiCall(`/stories/${story.id}/pages/${plate.page_number}`, 'DELETE');
        await afterChange();
        // An open reader must not sit on renumbered pages
        if (state.data.currentStory && state.data.currentStory.id === story.id) {
          features.generation.discardSpeculative();
          features.narration.stopNarration();
          await features.write.loadStoryPages();
        }
      } catch (error) {
        showError(scribeErrorMessage(error.message));
      }
    });
    actions.appendChild(del);
    wrap.appendChild(actions);
    return wrap;
  }

  function assetSection(titleText) {
    const section = document.createElement('section');
    section.className = 'story-asset-section';
    const title = document.createElement('h3');
    title.textContent = titleText;
    section.appendChild(title);
    return section;
  }

  async function refreshActiveAssets() {
    if (!activeStoryId || !storyAssetsModal?.isOpen) return;
    try {
      const [data, continuity] = await Promise.all([storageData(), continuityData(activeStoryId)]);
      const storage = (data.stories || []).find((entry) => entry.id === activeStoryId);
      const story = state.data.stories.find((entry) => entry.id === activeStoryId);
      if (!storage || !story) {
        closeStoryAssets();
        return;
      }
      activeContinuity = continuity;
      renderStoryAssets(story, storage, continuity);
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  async function afterModalAssetChange() {
    await features.stories.loadStories();
    await refreshActiveAssets();
  }

  function coverBlock(story, storage) {
    const section = assetSection('Cover');
    const cover = storage.cover || { status: story.image_status || 'none' };
    if (cover.status === 'ready' && !cover.file_missing) {
      const img = document.createElement('img');
      img.className = 'story-asset-cover';
      img.src = `${API_BASE_URL}/stories/${story.id}/cover`;
      img.alt = `Cover of ${story.title}`;
      section.appendChild(img);
      const info = document.createElement('p');
      info.className = 'story-asset-info';
      info.textContent = `${formatMb(cover.size_bytes || 0)}${typeof cover.cost_usd === 'number' ? ` · painted for ${formatUsd(cover.cost_usd)}` : ''}`;
      section.appendChild(info);
    } else {
      const empty = document.createElement('p');
      empty.className = 'bookshelf-entry__none';
      empty.textContent = cover.status === 'pending'
        ? 'The cover is being painted…'
        : cover.status === 'failed' ? 'The last cover painting failed.' : 'No cover is stored.';
      section.appendChild(empty);
    }

    const actions = document.createElement('div');
    actions.className = 'bookshelf-entry__actions';
    if (cover.status === 'ready' && !cover.file_missing) {
      const download = document.createElement('a');
      download.className = 'ghost-btn';
      download.href = `${API_BASE_URL}/stories/${story.id}/cover?download=1`;
      download.textContent = 'Download cover';
      actions.appendChild(download);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-btn';
      remove.textContent = 'Delete cover';
      remove.addEventListener('click', async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Delete the cover of "${story.title}"?`,
          body: 'Only the cover file is removed. The story, pages, cast, audiobook, and plates stay.',
          confirmLabel: 'Delete cover',
        });
        if (!yes) return;
        try {
          await apiCall(`/stories/${story.id}/cover`, 'DELETE');
          await afterModalAssetChange();
          showSuccess('Cover deleted.');
        } catch (error) {
          showError(scribeErrorMessage(error.message));
        }
      });
      actions.appendChild(remove);
    }
    const repaint = document.createElement('button');
    repaint.type = 'button';
    repaint.className = 'ghost-btn';
    repaint.disabled = cover.status === 'pending';
    repaint.textContent = cover.status === 'ready' ? 'Repaint cover (≈$0.06)' : 'Paint cover (≈$0.06)';
    repaint.addEventListener('click', async () => {
      await features.stories.repaintCover(story);
      await refreshActiveAssets();
    });
    actions.appendChild(repaint);
    section.appendChild(actions);
    return section;
  }

  function manuscriptBlock(story) {
    const section = assetSection('Manuscript');
    const info = document.createElement('p');
    info.className = 'story-asset-info';
    info.textContent = `${story.page_count} page${story.page_count === 1 ? '' : 's'} · maturity: ${story.tone === 'fade-to-black' ? 'tasteful' : story.tone}`;
    const actions = document.createElement('div');
    actions.className = 'bookshelf-entry__actions';
    const download = document.createElement('a');
    download.className = 'ghost-btn';
    download.href = `${API_BASE_URL}/stories/${story.id}/export`;
    download.textContent = 'Download EPUB';
    actions.appendChild(download);
    section.append(info, actions);
    return section;
  }

  function continuityCallEstimate() {
    return estimateContinuityCost({
      models: state.modelsCache,
      model: state.settings.model,
      pageChars: state.settings.wordsPerPage * 6,
    });
  }

  async function buildContinuity(story, storage, { rebuild = false } = {}) {
    let view = activeContinuity || await continuityData(story.id);
    let pages = (view?.coverage?.pages || []).filter((page) => rebuild || page.status !== 'ready');
    const count = pages.length;
    if (!count) {
      showSuccess('The continuity ledger already covers every text page.');
      return;
    }
    const perPage = continuityCallEstimate();
    const estimate = perPage * count;
    const yes = await dialogs.confirmPaid({
      title: rebuild ? 'Rebuild this story’s continuity?' : 'Build the missing continuity?',
      review: {
        action: rebuild
          ? `Discard the derived ledger for “${story.title}” and read all ${count} text pages again.`
          : `Read ${count} missing or failed page${count === 1 ? '' : 's'} into “${story.title}”’s continuity ledger.`,
        object: `“${story.title}” continuity`,
        model: state.settings.model || 'the scribe’s default model',
        quantity: `${count} compact page extraction${count === 1 ? '' : 's'}, one at a time`,
        sends: 'each manuscript page, its author direction, cast ids, and compact prior story state',
        estimate,
        maximum: estimate * 2,
        note: 'Pages are processed in order and saved after each result. You can safely close the app between pages; malformed JSON gets at most one paid correction.',
      },
      confirmLabel: `${rebuild ? 'Rebuild' : 'Build'} ledger (${approxCostText(estimate)})`,
    });
    if (!yes) return;

    const section = document.getElementById('storyContinuitySection');
    const progress = section?.querySelector('.continuity-progress');
    for (const button of section?.querySelectorAll('button') || []) button.disabled = true;
    try {
      if (rebuild) {
        if (progress) progress.textContent = 'Clearing derived memory…';
        await apiCall(`/stories/${story.id}/continuity`, 'DELETE');
        view = await continuityData(story.id);
        pages = view?.coverage?.pages || [];
      }
      const failed = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (progress) progress.textContent = `Reading page ${page.page_number} · ${i + 1} of ${pages.length}`;
        const result = await apiCall(`/stories/${story.id}/continuity/pages/${page.page_id}/sync`, 'POST', {
          ...(state.settings.model ? { model: state.settings.model } : {}),
        });
        state.addCost(result.memory?.cost_usd);
        if (result.memory?.status !== 'ready') failed.push(page.page_number);
      }
      activeContinuity = await continuityData(story.id);
      if (activeStoryId === story.id) renderStoryAssets(story, storage, activeContinuity);
      if (failed.length) showError(`Continuity still needs attention on page${failed.length === 1 ? '' : 's'} ${failed.join(', ')}.`);
      else showSuccess(`Continuity now covers ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
    } catch (error) {
      if (typeof error.costUsd === 'number') state.addCost(error.costUsd);
      showError(scribeErrorMessage(error.message));
      if (activeStoryId === story.id) await refreshActiveAssets();
    }
  }

  async function saveContinuityCorrections(story, storage, section) {
    const base = activeContinuity?.overrides || {};
    const overrides = {
      characters: JSON.parse(JSON.stringify(base.characters || {})),
      goals: JSON.parse(JSON.stringify(base.goals || {})),
      threads: JSON.parse(JSON.stringify(base.threads || {})),
    };
    for (const input of section.querySelectorAll('[data-continuity-character][data-continuity-field]')) {
      const id = input.dataset.continuityCharacter;
      const field = input.dataset.continuityField;
      const value = input.value.trim();
      if (value) {
        overrides.characters[id] = { ...(overrides.characters[id] || {}), [field]: value };
      } else if (overrides.characters[id]) {
        delete overrides.characters[id][field];
        if (!Object.keys(overrides.characters[id]).length) delete overrides.characters[id];
      }
    }
    for (const select of section.querySelectorAll('[data-continuity-goal]')) {
      if (select.value) overrides.goals[select.dataset.continuityGoal] = { status: select.value };
      else delete overrides.goals[select.dataset.continuityGoal];
    }
    for (const select of section.querySelectorAll('[data-continuity-thread]')) {
      if (select.value) overrides.threads[select.dataset.continuityThread] = { status: select.value };
      else delete overrides.threads[select.dataset.continuityThread];
    }
    try {
      const result = await apiCall(`/stories/${story.id}/continuity/overrides`, 'PUT', overrides);
      activeContinuity = result.continuity;
      renderStoryAssets(story, storage, activeContinuity);
      showSuccess('Continuity corrections saved. Future pages will use them.');
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  function statusSelect({ value, inherited, options, dataName, dataValue, ariaLabel }) {
    const select = document.createElement('select');
    select.className = 'continuity-status-select';
    select.dataset[dataName] = dataValue;
    select.setAttribute('aria-label', ariaLabel);
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = `Use ledger (${inherited})`;
    select.appendChild(automatic);
    for (const status of options) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      select.appendChild(option);
    }
    select.value = value || '';
    return select;
  }

  function continuityBlock(story, storage, continuity) {
    const section = assetSection('Continuity ledger');
    section.id = 'storyContinuitySection';
    if (!continuity?.coverage) {
      const unavailable = document.createElement('p');
      unavailable.className = 'bookshelf-entry__none';
      unavailable.textContent = 'Continuity details are unavailable.';
      section.appendChild(unavailable);
      return section;
    }

    const coverage = continuity.coverage;
    const info = document.createElement('p');
    info.className = 'story-asset-info';
    const failedCount = coverage.failed?.length || 0;
    info.textContent = `${coverage.ready} of ${coverage.total} text pages remembered` +
      `${failedCount ? ` · ${failedCount} failed` : ''} · ${formatUsd(coverage.memory_cost_usd || 0)} recorded extraction cost`;
    section.appendChild(info);

    const explanation = document.createElement('p');
    explanation.className = 'setting-hint';
    explanation.textContent = 'Committed pages own their facts. Deleting or rewriting a page removes its facts; prepared pages own none. Blank corrections below follow the ledger.';
    section.appendChild(explanation);

    const characters = document.createElement('details');
    const characterSummary = document.createElement('summary');
    characterSummary.textContent = `Current character state (${continuity.characters?.length || 0})`;
    characters.appendChild(characterSummary);
    for (const character of continuity.characters || []) {
      const block = document.createElement('div');
      block.className = 'continuity-character';
      const name = document.createElement('h4');
      name.textContent = `${character.name} · ${character.role}`;
      const current = character.current || {};
      const facts = document.createElement('p');
      const knowledge = (current.knowledge || []).slice(-20);
      const possessions = (current.possessions || []).slice(-20);
      facts.textContent = [
        current.location ? `At ${current.location}` : 'Location not recorded',
        current.condition ? `Condition: ${current.condition}` : 'No changed condition recorded',
        knowledge.length ? `Recent knowledge: ${knowledge.join('; ')}` : null,
        possessions.length ? `Recent possessions: ${possessions.join('; ')}` : null,
      ].filter(Boolean).join(' · ');
      block.append(name, facts);
      for (const [field, labelText] of [['location', 'Correct location'], ['condition', 'Correct condition']]) {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 2000;
        input.placeholder = current[field] || `No ${field} recorded`;
        input.value = continuity.overrides?.characters?.[character.id]?.[field] || '';
        input.dataset.continuityCharacter = character.id;
        input.dataset.continuityField = field;
        label.appendChild(input);
        block.appendChild(label);
      }
      characters.appendChild(block);
    }
    section.appendChild(characters);

    const goals = document.createElement('details');
    const goalSummary = document.createElement('summary');
    goalSummary.textContent = `Goals (${continuity.goals?.length || 0})`;
    goals.appendChild(goalSummary);
    for (const goal of continuity.goals || []) {
      const row = document.createElement('div');
      row.className = 'continuity-status-row';
      const label = document.createElement('span');
      label.textContent = goal.text || '(untitled goal)';
      row.append(label, statusSelect({
        value: continuity.overrides?.goals?.[goal.id]?.status,
        inherited: goal.status,
        options: ['pending', 'active', 'fulfilled', 'abandoned'],
        dataName: 'continuityGoal',
        dataValue: goal.id,
        ariaLabel: `Status correction for ${goal.text || 'untitled goal'}`,
      }));
      goals.appendChild(row);
    }
    section.appendChild(goals);

    const threads = document.createElement('details');
    const threadSummary = document.createElement('summary');
    threadSummary.textContent = `Story threads (${continuity.threads?.length || 0})`;
    threads.appendChild(threadSummary);
    for (const thread of continuity.threads || []) {
      const row = document.createElement('div');
      row.className = 'continuity-status-row';
      const label = document.createElement('span');
      label.textContent = thread.text || '(untitled thread)';
      row.append(label, statusSelect({
        value: continuity.overrides?.threads?.[thread.id]?.status,
        inherited: thread.status,
        options: ['open', 'resolved'],
        dataName: 'continuityThread',
        dataValue: thread.id,
        ariaLabel: `Status correction for ${thread.text || 'untitled thread'}`,
      }));
      threads.appendChild(row);
    }
    section.appendChild(threads);

    const events = document.createElement('details');
    const eventSummary = document.createElement('summary');
    const eventCount = continuity.history_counts?.events ?? continuity.events?.length ?? 0;
    eventSummary.textContent = `Recorded events (${eventCount})`;
    events.appendChild(eventSummary);
    const eventList = document.createElement('ol');
    for (const event of (continuity.events || []).slice(-30).reverse()) {
      const item = document.createElement('li');
      item.textContent = `Page ${event.page_number}: ${event.text}`;
      eventList.appendChild(item);
    }
    if (eventList.children.length) events.appendChild(eventList);
    section.appendChild(events);

    const progress = document.createElement('p');
    progress.className = 'continuity-progress';
    progress.setAttribute('role', 'status');
    section.appendChild(progress);

    const actions = document.createElement('div');
    actions.className = 'bookshelf-entry__actions';
    const missing = (coverage.pages || []).filter((page) => page.status !== 'ready').length;
    const build = document.createElement('button');
    build.type = 'button';
    build.className = 'ghost-btn';
    build.disabled = missing === 0;
    build.textContent = missing ? `Build ${missing} missing` : 'Memory complete';
    build.addEventListener('click', () => buildContinuity(story, storage));
    const rebuild = document.createElement('button');
    rebuild.type = 'button';
    rebuild.className = 'ghost-btn';
    rebuild.disabled = coverage.total === 0;
    rebuild.textContent = 'Rebuild from manuscript';
    rebuild.addEventListener('click', () => buildContinuity(story, storage, { rebuild: true }));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ghost-btn';
    save.textContent = 'Save corrections';
    save.addEventListener('click', () => saveContinuityCorrections(story, storage, section));
    actions.append(build, rebuild, save);
    section.appendChild(actions);
    return section;
  }

  function renderStoryAssets(story, storage, continuity = null) {
    const body = document.getElementById('storyAssetsBody');
    const title = document.getElementById('storyAssetsTitle');
    const total = document.getElementById('storyAssetsTotal');
    if (!body || !title || !total) return;
    title.textContent = story.title;
    total.textContent = `${storage.asset_count || 0} media ${storage.asset_count === 1 ? 'asset' : 'assets'} · ${formatMb(storage.disk_bytes || 0)} on disk`;
    body.textContent = '';
    body.append(manuscriptBlock(story), coverBlock(story, storage), continuityBlock(story, storage, continuity));

    const audio = assetSection('Audiobook');
    if (storage.audiobook) audio.appendChild(bookshelfAudioBlock(storage, afterModalAssetChange));
    else {
      const none = document.createElement('p');
      none.className = 'bookshelf-entry__none';
      none.textContent = 'No audiobook is stored.';
      audio.appendChild(none);
    }
    body.appendChild(audio);

    const plates = assetSection(`Painted plates (${(storage.plates || []).length})`);
    if (storage.plates?.length) {
      const grid = document.createElement('div');
      grid.className = 'bookshelf-plates';
      for (const plate of storage.plates) grid.appendChild(bookshelfPlate(storage, plate, afterModalAssetChange));
      plates.appendChild(grid);
    } else {
      const none = document.createElement('p');
      none.className = 'bookshelf-entry__none';
      none.textContent = 'No painted plates are stored.';
      plates.appendChild(none);
    }
    body.appendChild(plates);
  }

  async function openStoryAssets(story) {
    try {
      const [data, continuity] = await Promise.all([storageData(), continuityData(story.id)]);
      const storage = (data.stories || []).find((entry) => entry.id === story.id);
      if (!storage) throw new Error('Story storage record not found');
      activeStoryId = story.id;
      activeContinuity = continuity;
      renderStoryAssets(story, storage, continuity);
      storyAssetsModal?.open();
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  function closeStoryAssets() {
    storyAssetsModal?.close();
    activeStoryId = null;
    activeContinuity = null;
  }

  function init() {
    storyAssetsModal = wireModal('storyAssetsModal', { focusId: 'storyAssetsCloseBtn' });
    document.getElementById('storyAssetsCloseBtn')?.addEventListener('click', closeStoryAssets);
    document.getElementById('storyAssetsWriteBtn')?.addEventListener('click', () => {
      const storyId = activeStoryId;
      closeStoryAssets();
      if (storyId) features.write.openStory(storyId);
    });
    document.getElementById('storyAssetsCastBtn')?.addEventListener('click', () => {
      const story = state.data.stories.find((entry) => entry.id === activeStoryId);
      closeStoryAssets();
      if (story) features.storyEditor.openStoryCastEditor(story);
    });
    document.getElementById('storyAssetsExportBtn')?.addEventListener('click', () => {
      const story = state.data.stories.find((entry) => entry.id === activeStoryId);
      closeStoryAssets();
      if (story) features.transfer.openExport({ scope: 'story', id: story.id });
    });
  }

  return { loadBookshelf, openStoryAssets, closeStoryAssets, refreshActiveAssets, init };
}
