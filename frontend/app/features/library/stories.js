// Library → Stories: the story collection (list + creation form lives with
// the story editor feature). Opening a tale hands the reader to Write.

export function createStories({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;

  async function loadStories() {
    try {
      const data = await apiCall('/stories');
      state.data.stories = data.stories || [];
      if (state.data.currentStory) {
        state.data.currentStory = state.data.stories.find((s) => s.id === state.data.currentStory.id) || state.data.currentStory;
      }
      renderStories();
      features.write.updateStorySelect();
    } catch (error) {
      showError(error.message);
    }
  }

  function renderStories() {
    const container = document.getElementById('storiesList');
    container.textContent = '';

    // Collection-first: with stories present the long creation form stays
    // behind New story (the button owns the user's expansion choice); a
    // genuinely empty library opens the form to walk the novice in.
    const wrap = document.getElementById('storyCreateWrap');
    const newBtn = document.getElementById('storyNewBtn');
    if (wrap) {
      if (state.data.stories.length === 0) {
        // Novice-forward: the form is open. (aria-expanded stays the USER's
        // toggle; the empty state does not claim they pressed anything.)
        wrap.hidden = false;
      } else if (newBtn && newBtn.getAttribute('aria-expanded') !== 'true') {
        wrap.hidden = true;
      }
    }

    if (state.data.stories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'placeholder';
      empty.textContent = 'The shelves are bare - the form below is open to begin your first tale.';
      container.appendChild(empty);
      return;
    }

    state.data.stories.forEach((story) => {
      const world = state.data.worlds.find((w) => w.id === story.world_id);
      const card = document.createElement('div');
      card.className = 'item-card';

      const title = document.createElement('h4');
      title.textContent = story.title;
      const desc = document.createElement('p');
      desc.textContent = world ? `World: ${world.name}` : 'No world';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = `Tone: ${story.tone} · Pages: ${story.page_count}`;

      const open = document.createElement('button');
      open.className = 'card-open';
      open.type = 'button';
      open.textContent = '✎ Write';
      open.addEventListener('click', () => features.write.openStory(story.id));

      const cast = document.createElement('button');
      cast.className = 'card-cast';
      cast.type = 'button';
      cast.title = 'Edit this story\u2019s cast and its in-story character sheets';
      cast.textContent = '☰ Cast';
      cast.addEventListener('click', () => features.storyEditor.openStoryCastEditor(story));

      const del = document.createElement('button');
      del.className = 'card-delete';
      del.type = 'button';
      del.textContent = '✕ Delete';
      del.addEventListener('click', async () => {
        const yes = await dialogs.confirmDestructive({
          title: `Delete story "${story.title}"?`,
          body: `The story and all ${story.page_count} of its pages, painted plates included, will be permanently deleted.`,
          confirmLabel: 'Delete story',
        });
        if (!yes) return;
        try {
          await apiCall(`/stories/${story.id}`, 'DELETE');
          if (state.data.currentStory && state.data.currentStory.id === story.id) {
            features.write.resetAfterStoryDeletion();
          }
          await loadStories();
          showSuccess('Story deleted.');
        } catch (error) {
          showError(error.message);
        }
      });

      card.append(title, desc, meta, open, cast, del);
      container.appendChild(card);
    });
  }

  return { loadStories, renderStories };
}
