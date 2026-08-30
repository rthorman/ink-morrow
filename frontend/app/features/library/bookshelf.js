// Library storage: the all-story Bookshelf plus the per-story asset dialog
// opened from a story card. Deleting a plate deletes a REAL story page
// (renumbering the rest); an open reader must be refreshed.

import { API_BASE_URL } from '../../core/api.js';
import { formatUsd, formatMinutes, formatMb } from '../../core/dom.js';
import { wireModal } from '../../core/dialogs.js';

export function createBookshelf({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess, scribeErrorMessage } = notify;
  let storyAssetsModal = null;
  let activeStoryId = null;

  async function storageData() {
    return apiCall('/storage');
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
      const data = await storageData();
      const storage = (data.stories || []).find((entry) => entry.id === activeStoryId);
      const story = state.data.stories.find((entry) => entry.id === activeStoryId);
      if (!storage || !story) {
        closeStoryAssets();
        return;
      }
      renderStoryAssets(story, storage);
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

  function renderStoryAssets(story, storage) {
    const body = document.getElementById('storyAssetsBody');
    const title = document.getElementById('storyAssetsTitle');
    const total = document.getElementById('storyAssetsTotal');
    if (!body || !title || !total) return;
    title.textContent = story.title;
    total.textContent = `${storage.asset_count || 0} media ${storage.asset_count === 1 ? 'asset' : 'assets'} · ${formatMb(storage.disk_bytes || 0)} on disk`;
    body.textContent = '';
    body.append(manuscriptBlock(story), coverBlock(story, storage));

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
      const data = await storageData();
      const storage = (data.stories || []).find((entry) => entry.id === story.id);
      if (!storage) throw new Error('Story storage record not found');
      activeStoryId = story.id;
      renderStoryAssets(story, storage);
      storyAssetsModal?.open();
    } catch (error) {
      showError(scribeErrorMessage(error.message));
    }
  }

  function closeStoryAssets() {
    storyAssetsModal?.close();
    activeStoryId = null;
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
  }

  return { loadBookshelf, openStoryAssets, closeStoryAssets, refreshActiveAssets, init };
}
