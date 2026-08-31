// Library > Stories: manuscript catalogue and doorway to each tale's on-disk
// assets. Creation belongs to Write; this surface answers "what do I have?"
// and "what is using space?" without hiding the familiar cast/write actions.

import { approxCostText } from '../../core/cost.js';
import { formatMb } from '../../core/dom.js';
import { IMAGE_COST_ESTIMATE } from '../../components/entity-card.js';

const COVER_ESTIMATE = IMAGE_COST_ESTIMATE.story;

export function createStories({ api, state, notify, features, dialogs, entityCard }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let storageById = new Map();
  let imageReviewing = false;
  let pollTimer = null;

  function scheduleCoverPoll() {
    const pending = state.data.stories.some((story) => story.image_status === 'pending');
    if (!pending || pollTimer) return;
    if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await loadStories();
    }, 4000);
  }

  function stopCoverPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function loadStories() {
    try {
      const [data, storage] = await Promise.all([
        apiCall('/stories'),
        apiCall('/storage').catch(() => ({ stories: [] })),
      ]);
      state.data.stories = data.stories || [];
      storageById = new Map((storage.stories || []).map((entry) => [entry.id, entry]));
      state.chargeEntityImageCosts(state.data.stories, 'story');
      if (state.data.currentStory) {
        state.data.currentStory = state.data.stories.find((s) => s.id === state.data.currentStory.id) || state.data.currentStory;
      }
      renderStories();
      features.write.updateStorySelect();
      features.home?.renderHome();
      if (state.data.stories.length === 0 && window.location.hash.startsWith('#/write')) {
        features.storyEditor.openCreator();
      }
      scheduleCoverPoll();
    } catch (error) {
      showError(error.message);
    }
  }

  async function repaintCover(story) {
    if (imageReviewing) return;
    imageReviewing = true;
    const yes = await dialogs.confirmPaid({
      title: `Paint a new cover for "${story.title}"?`,
      review: {
        action: 'Paint one vertical cover using the story, world, and cast reference portraits.',
        object: `story "${story.title}"`,
        quantity: 'one 1K cover painting',
        sends: 'the title, maturity level, world description, and cast appearance details; up to three portraits and the world painting when available',
        estimate: COVER_ESTIMATE,
      },
      confirmLabel: `Paint cover (${approxCostText(COVER_ESTIMATE)})`,
    });
    imageReviewing = false;
    if (!yes) return;
    try {
      await apiCall(`/stories/${story.id}/cover`, 'POST');
      await loadStories();
      showSuccess('The cover is being painted.');
    } catch (error) {
      showError(error.message);
    }
  }

  async function deleteStory(story) {
    const storage = storageById.get(story.id);
    const count = storage?.asset_count || 0;
    const yes = await dialogs.confirmDestructive({
      title: `Delete story "${story.title}"?`,
      body: `This removes the manuscript, all ${story.page_count} pages, and ${count} stored media ${count === 1 ? 'asset' : 'assets'} (${formatMb(storage?.disk_bytes || 0)}).`,
      confirmLabel: 'Delete story',
    });
    if (!yes) return;
    try {
      await apiCall(`/stories/${story.id}`, 'DELETE');
      if (state.data.currentStory && state.data.currentStory.id === story.id) features.write.resetAfterStoryDeletion();
      await loadStories();
      showSuccess('Story deleted.');
    } catch (error) {
      showError(error.message);
    }
  }

  function renderStories() {
    const container = document.getElementById('storiesList');
    if (!container) return;
    container.textContent = '';
    if (state.data.stories.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state empty-state--archive';
      const art = document.createElement('img');
      art.src = 'brand/moth-archive.webp';
      art.alt = '';
      art.width = 1536;
      art.height = 1024;
      const copy = document.createElement('div');
      const line = document.createElement('p');
      line.textContent = 'No manuscripts are bound yet. Moth has found nothing to catalogue.';
      const start = document.createElement('a');
      start.className = 'btn btn-primary';
      start.href = '#/write';
      start.textContent = 'Create at the writing desk';
      copy.append(line, start);
      empty.append(art, copy);
      container.appendChild(empty);
      return;
    }

    for (const story of state.data.stories) {
      const storage = storageById.get(story.id) || {};
      const world = state.data.worlds.find((w) => w.id === story.world_id);
      const card = document.createElement('article');
      card.className = 'item-card story-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Manage assets for ${story.title}`);

      const title = document.createElement('h4');
      title.textContent = story.title;
      const desc = document.createElement('p');
      desc.className = 'item-card__desc';
      desc.textContent = storage.excerpt || 'No pages yet. The first line is still waiting.';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = [
        world ? world.name : 'Unbound world',
        story.tone === 'fade-to-black' ? 'Tasteful' : story.tone === 'romantic' ? 'Romantic' : 'Explicit (18+)',
        `${story.page_count} page${story.page_count === 1 ? '' : 's'}`,
        `${formatMb(storage.disk_bytes || 0)} media on disk`,
      ].join(' · ');

      const openAssets = () => features.bookshelf.openStoryAssets(story);
      const actions = entityCard.cardActions({
        name: story.title,
        kind: 'story',
        primaryLabel: 'Assets',
        onEdit: openAssets,
        onRegenerate: () => repaintCover(story),
        onExport: () => features.transfer.openExport({ scope: 'story', id: story.id }),
        onDelete: () => deleteStory(story),
      });
      const cast = document.createElement('button');
      cast.type = 'button';
      cast.className = 'btn btn-secondary card-cast';
      cast.textContent = 'Cast';
      cast.addEventListener('click', () => features.storyEditor.openStoryCastEditor(story));
      actions.insertBefore(cast, actions.querySelector('details'));

      card.append(
        title,
        entityCard.entityImageBlock('story', story, `Cover of ${story.title}`),
        desc,
        meta,
        actions
      );
      card.addEventListener('click', (event) => {
        if (event.target.closest('button, details, a')) return;
        openAssets();
      });
      card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button, details, a')) {
          event.preventDefault();
          openAssets();
        }
      });
      container.appendChild(card);
    }
  }

  return { loadStories, renderStories, repaintCover, stopCoverPoll };
}
