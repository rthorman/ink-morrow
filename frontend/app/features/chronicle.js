// PR 12 Chronicle: a bounded, publication-ordered structure view. The
// hierarchy endpoint returns only short excerpts, so opening this room never
// downloads the manuscript's full prose. Chapters render one small page
// window at a time even for the 3,000-page release fixture.

import { chooseWorkspaceStory } from '../core/story-context.js';

const PAGE_WINDOW = 80;

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function pageRange(recovery) {
  const first = recovery.removed_range?.first;
  const last = recovery.removed_range?.last;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return 'Unknown page range';
  return first === last ? `Page ${first}` : `Pages ${first}-${last}`;
}

function readableDate(value) {
  if (!value) return 'unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toLocaleString();
}

export function createChronicle({ api, state, notify, features, dialogs, router }) {
  const { apiCall, API_BASE_URL } = api;
  const { showError, showSuccess } = notify;
  let hierarchy = null;
  let recoveries = [];
  let activeStoryId = null;
  let loadToken = 0;
  const pageOffsets = new Map();
  let revealNumber = null;
  let routeController = router;

  function marker(text, modifier = '') {
    return node('span', `chronicle-marker${modifier ? ` chronicle-marker--${modifier}` : ''}`, text);
  }

  function setStatus(text) {
    const status = document.getElementById('chronicleStatus');
    if (status) status.textContent = text;
  }

  function summaryItem(value, label) {
    const item = node('div', 'chronicle-summary__item');
    item.append(node('strong', '', value), node('span', '', label));
    return item;
  }

  function renderSummary() {
    const target = document.getElementById('chronicleSummary');
    if (!target) return;
    target.textContent = '';
    const summary = hierarchy?.summary;
    if (!summary) return;
    const coverage = summary.continuity || { ready: 0, total: summary.page_count || 0 };
    const prepared = summary.prepared;
    target.append(
      summaryItem(String(summary.volume_count), summary.volume_count === 1 ? 'volume' : 'volumes'),
      summaryItem(String(summary.chapter_count), summary.chapter_count === 1 ? 'chapter' : 'chapters'),
      summaryItem(String(summary.page_count), summary.page_count === 1 ? 'narrative page' : 'narrative pages'),
      summaryItem(`${coverage.ready} of ${coverage.total}`, 'pages covered by memory'),
      summaryItem(String(summary.placed_art_count || 0), 'placed art records'),
      summaryItem(prepared ? `Page ${prepared.expected_page}` : 'None', 'prepared next page'),
    );
    const jump = document.getElementById('chroniclePageJump');
    if (jump) jump.max = String(Math.max(1, summary.page_count || 1));
  }

  function openTitleDialog({ title, label, value, confirmLabel, save }) {
    const wrap = node('div', 'form-field');
    const fieldLabel = node('label', '', label);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.required = true;
    input.value = value || '';
    fieldLabel.appendChild(input);
    wrap.appendChild(fieldLabel);
    dialogs.openDialog({
      title,
      body: wrap,
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        {
          label: confirmLabel,
          className: 'btn-primary',
          onClick: async (close) => {
            const next = input.value.trim();
            if (!next) {
              input.setCustomValidity('Enter a name.');
              input.reportValidity();
              return;
            }
            close(true);
            await save(next);
          },
        },
      ],
    });
  }

  async function mutate(request, success) {
    try {
      await request();
      await load(activeStoryId);
      await features.stories.loadStories();
      showSuccess(success);
    } catch (error) {
      showError(error.message);
    }
  }

  function renameVolume(volume) {
    openTitleDialog({
      title: `Rename ${volume.title}`,
      label: 'Volume name',
      value: volume.title,
      confirmLabel: 'Save volume name',
      save: (title) => mutate(
        () => apiCall(`/stories/${activeStoryId}/volumes/${volume.id}`, 'PUT', { title }),
        'Volume renamed without changing page identities or remembered canon.',
      ),
    });
  }

  function renameChapter(chapter) {
    openTitleDialog({
      title: `Rename ${chapter.title}`,
      label: 'Chapter name',
      value: chapter.title,
      confirmLabel: 'Save chapter name',
      save: (title) => mutate(
        () => apiCall(`/stories/${activeStoryId}/chapters/${chapter.id}`, 'PUT', { title }),
        'Chapter renamed without changing page identities or remembered canon.',
      ),
    });
  }

  function addVolume() {
    const ordinal = (hierarchy?.summary?.volume_count || 0) + 1;
    openTitleDialog({
      title: 'Begin a new volume at the active tail',
      label: 'Volume name',
      value: `Volume ${ordinal}`,
      confirmLabel: 'Begin volume',
      save: (title) => mutate(
        () => apiCall(`/stories/${activeStoryId}/volumes`, 'POST', { title, chapter_title: 'Chapter I' }),
        'A new tail volume and its first empty chapter are ready.',
      ),
    });
  }

  function addChapter() {
    const volume = hierarchy?.volumes?.at(-1);
    if (!volume) return;
    const ordinal = volume.chapters.length + 1;
    openTitleDialog({
      title: `Begin a chapter in ${volume.title}`,
      label: 'Chapter name',
      value: `Chapter ${ordinal}`,
      confirmLabel: 'Begin chapter',
      save: (title) => mutate(
        () => apiCall(`/stories/${activeStoryId}/volumes/${volume.id}/chapters`, 'POST', { title }),
        'A new chapter is ready at the active tail.',
      ),
    });
  }

  async function deleteVolume(volume) {
    const yes = await dialogs.confirmDestructive({
      title: `Remove empty volume "${volume.title}"?`,
      body: 'This removes one empty active-tail volume and its empty Chapter I. No prose, art, or continuity record changes.',
      confirmLabel: 'Remove empty volume',
    });
    if (yes) await mutate(
      () => apiCall(`/stories/${activeStoryId}/volumes/${volume.id}`, 'DELETE'),
      'The empty tail volume was removed.',
    );
  }

  async function deleteChapter(chapter) {
    const yes = await dialogs.confirmDestructive({
      title: `Remove empty chapter "${chapter.title}"?`,
      body: 'This removes one empty active-tail chapter. No prose, art, or continuity record changes.',
      confirmLabel: 'Remove empty chapter',
    });
    if (yes) await mutate(
      () => apiCall(`/stories/${activeStoryId}/chapters/${chapter.id}`, 'DELETE'),
      'The empty tail chapter was removed.',
    );
  }

  function pageMarkers(page, isTail) {
    const group = node('div', 'chronicle-page__markers');
    if (isTail) group.appendChild(marker('Active tail', 'tail'));
    const continuity = page.continuity_status || 'pending';
    group.appendChild(marker(
      continuity === 'ready' ? 'Memory covered' : continuity === 'failed' ? 'Memory failed' : 'Memory pending',
      continuity,
    ));
    if (page.art_count) group.appendChild(marker(`${page.art_count} placed art`));
    if (page.is_copyedited) group.appendChild(marker('Display copyedit'));
    if (page.has_scene_break) group.appendChild(marker('Scene break in preview'));
    return group;
  }

  function renderPageWindow(chapter, body) {
    const pages = chapter.pages || [];
    const maxOffset = Math.max(0, Math.floor(Math.max(0, pages.length - 1) / PAGE_WINDOW) * PAGE_WINDOW);
    const offset = Math.min(Math.max(0, pageOffsets.get(chapter.id) || 0), maxOffset);
    pageOffsets.set(chapter.id, offset);
    const visible = pages.slice(offset, offset + PAGE_WINDOW);
    const status = node('p', 'chronicle-window-status', pages.length
      ? `Showing pages ${offset + 1}-${offset + visible.length} of ${pages.length} in this chapter.`
      : 'This tail chapter is empty. The next committed page will begin here.');
    body.appendChild(status);

    const list = node('ol', 'chronicle-pages');
    list.setAttribute('role', 'group');
    for (const page of visible) {
      const item = node('li', 'chronicle-page');
      item.dataset.chroniclePage = String(page.display_number);
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', '3');
      const open = node('button', 'btn btn-secondary chronicle-page__open', `Open page ${page.display_number}`);
      open.type = 'button';
      open.addEventListener('click', () => routeController.navigate('desk', {
        storyId: activeStoryId,
        pageNumber: page.display_number,
      }));
      const pageBody = node('div', 'chronicle-page__body');
      const excerpt = String(page.excerpt || '').trim().replace(/\s+/g, ' ');
      pageBody.appendChild(node('p', 'chronicle-excerpt', excerpt || 'Blank page'));
      pageBody.appendChild(pageMarkers(page, hierarchy.summary.active_tail?.page_id === page.id));
      item.append(open, pageBody);
      list.appendChild(item);
    }
    body.appendChild(list);

    if (pages.length > PAGE_WINDOW) {
      const controls = node('div', 'chronicle-window-controls');
      const previous = node('button', 'btn btn-secondary', `Previous ${PAGE_WINDOW}`);
      previous.type = 'button';
      previous.disabled = offset === 0;
      previous.addEventListener('click', () => {
        pageOffsets.set(chapter.id, Math.max(0, offset - PAGE_WINDOW));
        renderOutline();
      });
      const next = node('button', 'btn btn-secondary', `Next ${PAGE_WINDOW}`);
      next.type = 'button';
      next.disabled = offset + PAGE_WINDOW >= pages.length;
      next.addEventListener('click', () => {
        pageOffsets.set(chapter.id, Math.min(maxOffset, offset + PAGE_WINDOW));
        renderOutline();
      });
      controls.append(previous, next);
      body.appendChild(controls);
    }
  }

  function renderChapter(chapter, volume, isActiveVolume, focusPage) {
    const details = node('details', 'chronicle-chapter');
    details.setAttribute('role', 'treeitem');
    details.setAttribute('aria-level', '2');
    const containsFocus = chapter.pages.some((page) => page.display_number === focusPage);
    const isActive = isActiveVolume && volume.chapters.at(-1)?.id === chapter.id;
    details.open = containsFocus || isActive;
    details.appendChild(node('summary', '', `${chapter.title} - ${chapter.pages.length} ${chapter.pages.length === 1 ? 'page' : 'pages'}`));
    const body = node('div', 'chronicle-chapter__body');
    body.setAttribute('role', 'group');
    const actions = node('div', 'chronicle-node-actions');
    const rename = node('button', 'btn btn-secondary', 'Rename chapter');
    rename.type = 'button';
    rename.addEventListener('click', () => renameChapter(chapter));
    actions.appendChild(rename);
    if (isActive && chapter.pages.length === 0 && volume.chapters.length > 1) {
      const remove = node('button', 'btn btn-danger', 'Remove empty chapter');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteChapter(chapter));
      actions.appendChild(remove);
    }
    body.appendChild(actions);
    renderPageWindow(chapter, body);
    details.appendChild(body);
    return details;
  }

  function renderVolume(volume, focusPage) {
    const details = node('details', 'chronicle-volume');
    details.setAttribute('role', 'treeitem');
    details.setAttribute('aria-level', '1');
    const pageCount = volume.chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0);
    const containsFocus = volume.chapters.some((chapter) =>
      chapter.pages.some((page) => page.display_number === focusPage));
    const isActive = hierarchy.summary.active_tail?.volume_id === volume.id;
    details.open = containsFocus || isActive;
    details.appendChild(node('summary', '', `${volume.title} - ${volume.chapters.length} ${volume.chapters.length === 1 ? 'chapter' : 'chapters'}, ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`));
    const body = node('div', 'chronicle-volume__body');
    body.setAttribute('role', 'group');
    const actions = node('div', 'chronicle-node-actions');
    const rename = node('button', 'btn btn-secondary', 'Rename volume');
    rename.type = 'button';
    rename.addEventListener('click', () => renameVolume(volume));
    actions.appendChild(rename);
    if (isActive && pageCount === 0 && hierarchy.volumes.length > 1) {
      const remove = node('button', 'btn btn-danger', 'Remove empty volume');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteVolume(volume));
      actions.appendChild(remove);
    }
    body.appendChild(actions);
    for (const chapter of volume.chapters) {
      body.appendChild(renderChapter(chapter, volume, isActive, focusPage));
    }
    details.appendChild(body);
    return details;
  }

  function renderOutline() {
    const target = document.getElementById('chronicleOutline');
    if (!target) return;
    target.textContent = '';
    if (!hierarchy?.volumes?.length) {
      target.appendChild(node('p', 'workspace-empty__copy', 'This manuscript has no structure to show.'));
      return;
    }
    const focusPage = revealNumber;
    for (const volume of hierarchy.volumes) target.appendChild(renderVolume(volume, focusPage));
    if (focusPage) {
      const targetPage = target.querySelector(`[data-chronicle-page="${focusPage}"] .chronicle-page__open`);
      revealNumber = null;
      targetPage?.focus();
      targetPage?.scrollIntoView?.({ block: 'center' });
    }
  }

  function confirmRestore(recovery) {
    return new Promise((resolve) => {
      dialogs.openDialog({
        title: `Restore ${pageRange(recovery)}?`,
        body: `${recovery.page_count} ${recovery.page_count === 1 ? 'page' : 'pages'} will rejoin the active tail in their original publication order. This works only while the surviving manuscript is unchanged.`,
        onFreeClose: () => resolve(false),
        actions: [
          { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => { close(true); resolve(false); } },
          { label: `Restore ${recovery.page_count} ${recovery.page_count === 1 ? 'page' : 'pages'}`, className: 'btn-primary', onClick: (close) => { close(true); resolve(true); } },
        ],
      });
    });
  }

  async function restoreRecovery(recovery) {
    if (!recovery.restore?.available || !(await confirmRestore(recovery))) return;
    try {
      const result = await apiCall(`/stories/${activeStoryId}/recoveries/${recovery.id}/restore`, 'POST');
      await features.stories.loadStories();
      await load(activeStoryId);
      showSuccess(`${result.restored} ${result.restored === 1 ? 'page was' : 'pages were'} restored to the active manuscript.`);
    } catch (error) {
      await load(activeStoryId);
      showError(error.message);
    }
  }

  function renderRecoveries() {
    const target = document.getElementById('chronicleRecoveries');
    if (!target) return;
    target.textContent = '';
    if (!recoveries.length) {
      target.appendChild(node('p', 'workspace-empty__copy', 'No recovery copies exist for this manuscript. Returning to an earlier page will place the removed suffix here for 30 days.'));
      return;
    }
    for (const recovery of recoveries) {
      const card = node('article', 'chronicle-recovery');
      card.appendChild(node('h4', '', `${pageRange(recovery)} - ${recovery.page_count} ${recovery.page_count === 1 ? 'page' : 'pages'}`));
      card.appendChild(node('p', 'chronicle-recovery__meta', `Removed ${readableDate(recovery.created_at)}. Expires ${readableDate(recovery.expires_at)}.`));
      const restoreState = recovery.restore?.state || recovery.status;
      card.appendChild(marker(
        restoreState === 'safe' ? 'Safe to restore' : restoreState === 'unsafe' ? 'Export only - manuscript changed' : restoreState,
        restoreState,
      ));
      if (recovery.restore?.reason) card.appendChild(node('p', '', recovery.restore.reason));
      const actions = node('div', 'chronicle-recovery__actions');
      const restore = node('button', 'btn btn-primary', 'Restore recovery');
      restore.type = 'button';
      restore.disabled = !recovery.restore?.available;
      restore.addEventListener('click', () => restoreRecovery(recovery));
      const download = node('a', 'btn btn-secondary', 'Export recovery JSON');
      download.href = `${API_BASE_URL}/stories/${activeStoryId}/recoveries/${recovery.id}/export`;
      download.download = `recovery-${recovery.id}.json`;
      actions.append(restore, download);
      card.appendChild(actions);
      target.appendChild(card);
    }
  }

  function render() {
    renderSummary();
    renderOutline();
    renderRecoveries();
  }

  async function load(storyId) {
    const token = ++loadToken;
    setStatus('Opening the bounded hierarchy and recovery ledger...');
    try {
      const [outline, recoveryResult] = await Promise.all([
        apiCall(`/stories/${storyId}/hierarchy`),
        apiCall(`/stories/${storyId}/recoveries`),
      ]);
      if (token !== loadToken || activeStoryId !== storyId) return;
      hierarchy = outline.hierarchy;
      recoveries = recoveryResult.recoveries || [];
      render();
      const count = hierarchy.summary.page_count;
      setStatus(`${count} narrative ${count === 1 ? 'page' : 'pages'} in publication order. Only short excerpts are loaded here.`);
    } catch (error) {
      if (token !== loadToken) return;
      hierarchy = null;
      recoveries = [];
      render();
      setStatus(`Chronicle could not load: ${error.message}`);
      showError(error.message);
    }
  }

  async function enter(params = {}) {
    if (!params.storyId) return;
    const story = await chooseWorkspaceStory({ storyId: params.storyId, state, features });
    if (!story) {
      showError('That manuscript could not be found - it may have been deleted from another window.');
      routeController.navigate('library-stories');
      return;
    }
    activeStoryId = story.id;
    pageOffsets.clear();
    await load(story.id);
  }

  function revealPage() {
    const input = document.getElementById('chroniclePageJump');
    const number = Number.parseInt(input?.value, 10);
    const total = hierarchy?.summary?.page_count || 0;
    if (!Number.isSafeInteger(number) || number < 1 || number > total) {
      input?.setCustomValidity(`Enter a page from 1 to ${Math.max(1, total)}.`);
      input?.reportValidity();
      return;
    }
    input.setCustomValidity('');
    for (const volume of hierarchy.volumes) {
      for (const chapter of volume.chapters) {
        const index = chapter.pages.findIndex((page) => page.display_number === number);
        if (index >= 0) {
          pageOffsets.set(chapter.id, Math.floor(index / PAGE_WINDOW) * PAGE_WINDOW);
          revealNumber = number;
          renderOutline();
          return;
        }
      }
    }
  }

  function init() {
    document.getElementById('chroniclePageJumpBtn')?.addEventListener('click', revealPage);
    document.getElementById('chroniclePageJump')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') revealPage();
    });
    document.getElementById('chronicleAddVolume')?.addEventListener('click', addVolume);
    document.getElementById('chronicleAddChapter')?.addEventListener('click', addChapter);
  }

  function reset() {
    loadToken++;
    activeStoryId = null;
    hierarchy = null;
    recoveries = [];
    pageOffsets.clear();
    for (const id of ['chronicleSummary', 'chronicleOutline', 'chronicleRecoveries']) {
      const element = document.getElementById(id);
      if (element) element.textContent = '';
    }
    setStatus('Choose a manuscript to inspect its structure and recovery history.');
  }

  return {
    init,
    enter,
    load,
    render,
    revealPage,
    restoreRecovery,
    reset,
    setRouter(value) { routeController = value; },
  };
}

