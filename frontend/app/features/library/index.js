// Library: route-backed Stories/Bookshelf tabs. The tabs are real buttons
// with tab semantics; the active tab follows the hash route, so refresh,
// history, and deep links all restore it.

export function createLibrary({ features }) {
  let router = null; // set by bootstrap
  function showTab(tab) {
    const storiesTab = document.getElementById('libraryStoriesTab');
    const bookshelfTab = document.getElementById('libraryBookshelfTab');
    const storiesPanel = document.getElementById('storiesPanel');
    const bookshelfPanel = document.getElementById('bookshelfPanel');
    if (!storiesTab || !bookshelfTab || !storiesPanel || !bookshelfPanel) return;
    const active = tab === 'bookshelf';
    storiesTab.setAttribute('aria-selected', String(!active));
    bookshelfTab.setAttribute('aria-selected', String(active));
    storiesTab.classList.toggle('library-tab--active', !active);
    bookshelfTab.classList.toggle('library-tab--active', active);
    storiesPanel.hidden = active;
    bookshelfPanel.hidden = !active;
    if (active) features.bookshelf.loadBookshelf();
  }

  function enter(route) {
    showTab(route.name === 'library-bookshelf' ? 'bookshelf' : 'stories');
  }

  function init() {
    // New story reveals the existing Manuscript/Cast/Review form (no wizard)
    // and focuses Title; it collapses exactly as deliberately.
    const newStoryBtn = document.getElementById('storyNewBtn');
    if (newStoryBtn) {
      newStoryBtn.addEventListener('click', () => {
        const wrap = document.getElementById('storyCreateWrap');
        const opening = wrap.hidden;
        wrap.hidden = !opening;
        newStoryBtn.setAttribute('aria-expanded', String(opening));
        if (opening) document.getElementById('storyTitle').focus();
        else wrap.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    }
    const storiesTab = document.getElementById('libraryStoriesTab');
    const bookshelfTab = document.getElementById('libraryBookshelfTab');
    if (storiesTab) storiesTab.addEventListener('click', () => router.navigate('library-stories'));
    if (bookshelfTab) bookshelfTab.addEventListener('click', () => router.navigate('library-bookshelf'));
    // Keyboard semantics for the tablist (roving focus, arrow keys)
    const tabs = [storiesTab, bookshelfTab].filter(Boolean);
    for (const tab of tabs) {
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const other = tabs.find((t) => t !== tab);
        if (other) other.focus();
        router.navigate(other === storiesTab ? 'library-stories' : 'library-bookshelf');
      });
    }
  }

  return {
    set router(value) { router = value; },
    showTab,
    enter,
    init,
  };
}
