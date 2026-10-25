import { el, button } from './dom.js';
import { wireModal } from '../core/dialogs.js';
import { ROOMS, workspaceUrl, putBookmark, readingPreferences, saveReadingPreferences, DEFAULT_READING } from './workspace-state.js';
import { storyImage } from './library.js';

const labels = { desk: 'Desk', chronicle: 'Chronicle', codex: 'Codex', gallery: 'Gallery', gate: 'Gate' };
const roomIds = { desk: 'workspaceDesk', chronicle: 'workspaceChronicle', codex: 'fictionDetails', gallery: 'workspaceGallery', gate: 'workspaceGate' };
export function createFictionWorkspace({ getCurrent, getShown, readBeat, sourceButton, illustrate, contributionChanged }) {
  const $ = id => document.getElementById(id);
  let room = 'desk'; let lastUrl = null; let scrollTimer = null; let restoreFrame = null; let restoring = false;
  let taskOpen = false; let lastPosition = null;
  const modal = wireModal('workspaceTask', { focusId: 'fictionDirection', beforeClose: () => closeContribution() });
  const inert = value => { document.querySelector('.fiction-app').inert = value; };
  function closeContribution() {
    modal.close(); taskOpen = false; inert(false);
    if (new URLSearchParams(location.hash.split('?')[1] || '').has('task')) {
      if (history.state?.fictionContribution) history.back();
      else history.replaceState(null, '', lastUrl || '#/stories');
    }
  }
  $('workspaceTaskClose').addEventListener('click', closeContribution);
  function contribution(kind, fromRoute = false) {
    const story = getCurrent(); if (!story) return;
    if (![...$('fictionInputKind').options].some(option => option.value === kind)) kind = 'steer';
    contributionChanged?.(kind);
    $('fictionInputKind').value = kind;
    $('workspaceTaskTitle').textContent = { steer: 'Steer this moment', ask: 'Ask outside the story', act: 'Act as your character', say: 'Speak as your character' }[kind];
    const branch = story.branches.find(item => item.id === story.active_branch_id);
    $('workspaceTaskTarget').textContent = `${story.title} · ${branch?.name || 'Active path'} · latest story moment. ${kind === 'ask' ? 'Ask uses current public context, not historical state.' : 'Earlier prose stays unchanged.'}`;
    if (!fromRoute) history.pushState({ fictionContribution: true }, '', `${lastUrl || workspaceUrl(story.id)}?task=${kind}`);
    taskOpen = true; modal.open(); inert(true);
  }
  $('workspaceSteer').addEventListener('click', () => contribution('steer'));
  $('workspaceAsk').addEventListener('click', () => contribution('ask'));
  function position() {
    const story = getCurrent(); const beatId = getShown();
    if (!story || !beatId || room !== 'desk' || restoring) return;
    const reader = $('workspaceReader'); const paragraphs = [...$('fictionProse').querySelectorAll('article > p')];
    const top = reader.getBoundingClientRect().top;
    let paragraph = paragraphs.findIndex(node => node.getBoundingClientRect().bottom >= top);
    if (paragraph < 0) paragraph = 0;
    const rect = paragraphs[paragraph]?.getBoundingClientRect();
    const fraction = rect?.height ? Math.max(0, Math.min(1, (top - rect.top) / rect.height)) : 0;
    const bookmark = { branchId: story.active_branch_id, beatId, paragraph, fraction, top: reader.scrollTop <= 0 };
    const saved = putBookmark(story.id, bookmark);
    $('workspacePositionStatus').textContent = saved ? '' : 'Reading position stays in this open tab only; browser storage is unavailable. The story remains saved on the server.';
    lastPosition = { storyId: story.id, ...bookmark }; return bookmark;
  }
  function restore(bookmark) {
    if (!bookmark) return;
    cancelAnimationFrame(restoreFrame); restoring = true;
    const owner = getCurrent(); const beat = getShown();
    restoreFrame = requestAnimationFrame(() => {
      if (owner?.id !== getCurrent()?.id || owner?.active_branch_id !== getCurrent()?.active_branch_id || beat !== getShown()) { restoring = false; return; }
      const paragraphs = [...$('fictionProse').querySelectorAll('article > p')];
      const anchor = paragraphs[bookmark.paragraph]; const reader = $('workspaceReader');
      reader.scrollTop = 0;
      if (anchor && !bookmark.top) {
        const rect = anchor.getBoundingClientRect();
        reader.scrollTop = Math.max(0, rect.top - reader.getBoundingClientRect().top + rect.height * bookmark.fraction);
      }
      restoring = false;
    });
  }
  $('workspaceReader').addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(position, 180); }, { passive: true });
  window.addEventListener('pagehide', position);
  const resize = () => { if (!taskOpen && room === 'desk' && lastPosition?.storyId === getCurrent()?.id && lastPosition.branchId === getCurrent()?.active_branch_id) restore(lastPosition); };
  window.addEventListener('resize', resize);
  function showRoom(next = 'desk', focus = false) {
    if (!ROOMS.includes(next)) next = 'desk';
    room = next;
    for (const name of ROOMS) $(roomIds[name]).hidden = name !== room;
    $('readerScreen').dataset.room = room;
    for (const link of $('workspaceRooms').querySelectorAll('a')) {
      if (link.dataset.room === room) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    const story = getCurrent();
    if (story) { lastUrl = workspaceUrl(story.id, room); $('workspaceReturn').href = lastUrl; $('workspaceReturn').hidden = false; }
    if (focus) {
      const heading = $(roomIds[room]).querySelector('h2') || $('fictionProse');
      heading.focus({ preventScroll: true });
    }
  }
  function renderHistory(story) {
    const root = $('workspaceHistory'); root.replaceChildren();
    const window = story.beats.slice(-80);
    $('workspaceHistoryStatus').textContent = `${window.length} loaded history records${story.has_earlier || story.beats.length > 80 ? ' · earlier history remains available' : ''}. Narrative passages and local records are labelled separately.`;
    for (const beat of window) {
      const card = el('article', '', 'workspace-history-card');
      card.dataset.beatId = beat.id;
      card.append(el('p', `${beat.id === getShown() ? 'Reading position · ' : ''}${beat.id === story.head_beat_id ? 'Action head · ' : ''}${beat.kind}`, 'eyebrow'), el('h3', beat.summary || 'Recorded moment'));
      if (['opening', 'scene', 'clarification'].includes(beat.kind)) card.append(button('Read this passage', () => { readBeat(beat.id); location.hash = workspaceUrl(story.id, 'desk'); }));
      else card.append(sourceButton(beat.id, 'Inspect this local record'));
      root.append(card);
    }
    if (!window.length) root.append(el('p', 'The situation is set. There are no recorded passages yet.', 'fiction-empty'));
  }
  function renderGallery(story) {
    const root = $('workspaceImages'); root.replaceChildren();
    const loaded = new Set(story.beats.map(beat => beat.id));
    const entries = [...(story.state.visuals || []).filter(item => item.kind !== 'cover'), ...(story.state.illustrations || []).filter(item => loaded.has(item.beat_id))];
    for (const image of entries) {
      const card = el('article', '', 'fiction-card');
      card.append(storyImage(story.id, image), el('h3', image.alt_text || 'Story image'), el('p', image.kind ? `${image.kind} reference · private save material, not book content` : 'Placed in the loaded active path'));
      const control = button('Upload, paint or edit description', () => illustrate(image.kind ? { kind: image.kind, subject_id: image.subject_id } : { beat_id: image.beat_id }));
      control.dataset.workspaceMutation = 'true'; card.append(control); root.append(card);
    }
    if (!entries.length) root.append(el('p', 'No reference or passage images in this loaded window. Upload an image or review a painting request above.', 'fiction-empty'));
  }
  function render(story) {
    const nav = $('workspaceRooms');
    if (nav.dataset.story !== story.id) {
      nav.replaceChildren(); nav.dataset.story = story.id;
      for (const name of ROOMS) { const link = el('a', labels[name]); link.href = workspaceUrl(story.id, name); link.dataset.room = name; nav.append(link); }
    }
    renderHistory(story); renderGallery(story); showRoom(room);
    const branch = story.branches.find(item => item.id === story.active_branch_id);
    const owned = story.state.cast.find(person => person.id === story.state.control.character_id);
    $('workspaceActionTarget').textContent = `Action destination: ${branch?.name || 'Active path'} · latest story moment · ${owned ? `Inhabit: ${owned.name}` : 'Reader-director'}`;
    if (taskOpen) $('workspaceTaskTarget').textContent = `${story.title} · ${branch?.name || 'Active path'} · latest story moment. Review again if the story changes.`;
  }
  let preferences = readingPreferences();
  const preferenceControls = { font: 'workspaceFont', spacing: 'workspaceSpacing', width: 'workspaceWidth', paper: 'workspacePaper' };
  function applyPreferences() {
    document.documentElement.style.setProperty('--fiction-reading-font', preferences.font === 'system' ? 'system-ui, sans-serif' : 'Literata, Georgia, serif');
    document.documentElement.style.setProperty('--fiction-reading-line', preferences.spacing);
    document.documentElement.style.setProperty('--fiction-reading-width', preferences.width === 'narrow' ? '58ch' : '68ch');
    document.documentElement.dataset.readingPaper = preferences.paper;
    for (const [name, control] of Object.entries(preferenceControls)) $(control).value = preferences[name];
  }
  for (const [name, control] of Object.entries(preferenceControls)) $(control).addEventListener('change', () => { preferences[name] = $(control).value; const saved = saveReadingPreferences(preferences); $('workspaceReadingStatus').textContent = saved ? 'Saved on this device.' : 'Applied in this session; browser storage is unavailable.'; applyPreferences(); });
  $('workspaceResetReading').addEventListener('click', () => {
    preferences = { ...DEFAULT_READING }; saveReadingPreferences(preferences); applyPreferences();
    $('fictionTextSize').value = '18'; $('fictionTextSize').dispatchEvent(new Event('change'));
  });
  applyPreferences();
  function leave() { position(); modal.close(); taskOpen = false; inert(false); document.body.classList.remove('fiction-in-workspace'); }
  function clear() {
    clearTimeout(scrollTimer); cancelAnimationFrame(restoreFrame); restoring = false; modal.close(); taskOpen = false; inert(false);
    for (const id of ['workspaceHistory', 'workspaceImages', 'workspaceRooms', 'workspaceTaskTarget', 'workspaceActionTarget', 'workspaceHistoryStatus', 'workspaceConsentStatus', 'workspacePositionStatus', 'workspaceReadingStatus']) $(id).replaceChildren();
    delete $('workspaceRooms').dataset.story; $('workspaceReturn').hidden = true; $('workspaceReturn').href = '#/stories'; lastUrl = null; lastPosition = null; room = 'desk';
    $('passwordChangeForm').reset(); $('passwordChangeStatus').textContent = '';
    document.body.classList.remove('fiction-in-workspace');
  }
  return { render, showRoom, get room() { return room; }, position, restore, contribution, closeContribution, get taskOpen() { return taskOpen; }, hideTask: () => { modal.close(); taskOpen = false; inert(false); }, leave, clear,
    dispose: () => { clear(); window.removeEventListener('pagehide', position); window.removeEventListener('resize', resize); },
  };
}
