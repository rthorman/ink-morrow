// Home: the manuscript hall. Returning users get "Continue {most recent
// story}" + up to three recent manuscripts; new users get the recommended
// (skippable) scriptorium path. Never blocks direct story creation.

import { formatUsd } from '../core/dom.js';

export function createHome({ state, notify, features }) {
  let router = null; // set by bootstrap
  function renderHome() {
    const stories = state.data.stories || [];
    const recentWrap = document.getElementById('homeRecent');
    const recentList = document.getElementById('homeRecentList');
    const continueBtn = document.getElementById('heroContinueBtn');
    const startBtn = document.getElementById('heroStartBtn');
    if (!recentWrap || !recentList || !continueBtn || !startBtn) return;

    if (stories.length === 0) {
      recentWrap.hidden = true;
      continueBtn.hidden = true;
      startBtn.hidden = false;
      startBtn.textContent = 'Create your first story';
      return;
    }

    // Returning user: continue the most recently updated story.
    const latest = stories[0]; // list is updated_at DESC
    continueBtn.hidden = false;
    continueBtn.textContent = `Continue “${latest.title}”`;
    continueBtn.dataset.storyId = latest.id;
    startBtn.hidden = false;
    startBtn.textContent = 'Create a story';

    recentWrap.hidden = false;
    recentList.textContent = '';
    for (const story of stories.slice(0, 3)) {
      const card = document.createElement('div');
      card.className = 'item-card home-recent__card';

      const title = document.createElement('h4');
      title.textContent = story.title;
      const world = state.data.worlds.find((w) => w.id === story.world_id);
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const castMode = (() => {
        const mc = (story.characters || []).find((c) => c.role === 'mc');
        if (!mc) return 'Ensemble';
        const character = state.data.characters.find((c) => c.id === mc.id);
        return `Centered on ${character ? character.name : 'a lead'}`;
      })();
      meta.textContent = [
        `${story.page_count} page${story.page_count === 1 ? '' : 's'}`,
        world ? world.name : 'Unbound world',
        castMode,
        story.tone,
      ].join(' · ');

      const cost = document.createElement('p');
      cost.className = 'item-meta';
      cost.textContent = `Recorded cost ${formatUsd(story.total_cost_usd)}`;

      const open = document.createElement('button');
      open.className = 'card-open';
      open.type = 'button';
      open.textContent = 'Continue writing';
      open.addEventListener('click', () => features.write.openStory(story.id));

      card.append(title, meta, cost, open);
      recentList.appendChild(card);
    }
  }

  function enter() {
    renderHome();
    // Home is the freshest view of the shelf; a stale list would misdirect.
    features.stories.loadStories();
  }

  function init() {
    const continueBtn = document.getElementById('heroContinueBtn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        const id = continueBtn.dataset.storyId;
        if (id) features.write.openStory(id);
      });
    }
    const startBtn = document.getElementById('heroStartBtn');
    if (startBtn) startBtn.addEventListener('click', () => router.navigate('library-stories'));
    const writeBtn = document.getElementById('heroWriteBtn');
    if (writeBtn) writeBtn.addEventListener('click', () => router.navigate('write'));
  }

  return {
    set router(value) { router = value; },
    renderHome,
    enter,
    init,
  };
}
