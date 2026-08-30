// Library → Bookshelf: every tale's kept things - audiobooks and painted
// plates - with downloads and deletes. Deleting a plate deletes a REAL
// story page (renumbering the rest); an open reader must be refreshed.

import { API_BASE_URL } from '../../core/api.js';
import { formatUsd, formatMinutes, formatMb } from '../../core/dom.js';

export function createBookshelf({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, scribeErrorMessage } = notify;

  async function loadBookshelf() {
    const list = document.getElementById('bookshelfList');
    if (!list) return;
    let data;
    try {
      data = await apiCall('/storage');
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

  function bookshelfAudioBlock(story) {
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
        await loadBookshelf();
        if (state.data.currentStory && state.data.currentStory.id === story.id) features.audiobook.refreshAudiobook();
      } catch (error) {
        showError(scribeErrorMessage(error.message));
      }
    });
    actions.appendChild(del);
    block.appendChild(actions);
    return block;
  }

  function bookshelfPlate(story, plate) {
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
        await loadBookshelf();
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

  return { loadBookshelf };
}
