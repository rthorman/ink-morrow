import { story, facts, assets, capabilities } from './fixtures.js';

const app = document.querySelector('#app');
const task = document.querySelector('#task');
const rooms = [['desk', 'Desk', '✦'], ['chronicle', 'Chronicle', '⌘'], ['codex', 'Codex', '◇'], ['gallery', 'Gallery', '▧'], ['gate', 'Gate', '❧']];
const key = 'im-recovery-prototype';
const read = (storage, name, fallback) => { try { return JSON.parse(storage.getItem(`${key}:${name}`)) ?? fallback; } catch { return fallback; } };
const write = (storage, name, value) => { try { storage.setItem(`${key}:${name}`, JSON.stringify(value)); return true; } catch { return false; } };
const bookmark = read(localStorage, 'bookmark', { path: 'main', index: 2 });
const state = {
  room: 'desk', cursor: { path: ['main', 'window'].includes(bookmark.path) ? bookmark.path : 'main', index: Number.isInteger(bookmark.index) ? Math.max(0, Math.min(2, bookmark.index)) : 2 },
  paths: [{ id: 'main', label: 'The homecoming', tail: 2 }, { id: 'window', label: 'A different goodbye', tail: 1 }], active: 'main',
  scroll: new Map(), locked: false, pending: null, uncertain: false, failure: '', noticeTimer: null,
  tab: 'Stories', category: 'All public', draft: read(sessionStorage, 'direction', ''), draftKind: 'Steer',
  corrected: false, studio: { name: 'Mara Venn', description: 'A bookbinder returning to her coastal childhood home.', private: 'She has not decided whether to read the letter upstairs.' },
};
state.studios = { Characters: state.studio, Worlds: { name: 'Greyhaven', description: 'A salt-weathered coastal town. Ordinary work and old obligations outlast each passing season.', private: 'The closed upstairs room belongs to a family history, not a public mystery to solve automatically.' }, Scribes: { name: 'The attentive observer', description: 'Patient close observation, specific physical detail, dialogue with room for silence. Never force a reconciliation.', private: 'Craft note: distinguish a hoped-for outcome from what the scene has earned.' } };
const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const button = (label, action, extra = '') => `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const art = file => `../../frontend/brand/${file}`;
const path = () => state.paths.find(item => item.id === state.cursor.path) || state.paths[0];
const activePath = () => state.paths.find(item => item.id === state.active);
const passage = () => story.passages[Math.min(state.cursor.index, path().tail)];
const notify = message => {
  clearTimeout(state.noticeTimer);
  document.querySelector('#notice').textContent = message;
  state.noticeTimer = setTimeout(() => { document.querySelector('#notice').textContent = ''; }, 6500);
};
function savePosition() {
  const reader = document.querySelector('.reader');
  if (reader) state.scroll.set(`${state.cursor.path}:${state.cursor.index}`, reader.scrollTop);
  write(localStorage, 'bookmark', state.cursor);
}
function navigate(room, index = state.cursor.index, branch = state.cursor.path) {
  savePosition();
  location.hash = room === 'desk' ? `/${room}/${branch}/${index}` : `/${room}`;
}
function heading(kicker, title, copy, action = '') {
  return `<div class="room-heading"><div><p class="eyebrow">${kicker}</p><h1 tabindex="-1">${title}</h1><p class="muted">${copy}</p></div>${action}</div>`;
}
function frame(content, desk = false) {
  return `<header class="topbar"><a href="#/library" aria-label="Ink Morrow Library"><img class="logo" src="${art('ink-morrow-lockup.svg')}" alt="Ink Morrow"></a><a class="button text-button library-label" href="#/library" ${state.room === 'library' ? 'aria-current="page"' : ''}>Library</a><div class="spacer"></div>${button('Reading settings', 'settings', 'class="text-button"')}${button('Lock demo', 'lock', 'class="text-button"')}</header>
    <div class="workbench"><nav class="rooms" aria-label="Story rooms">${rooms.map(([id, name, glyph]) => `<a href="#/${id}" ${state.room === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${glyph}</span>${name}</a>`).join('')}</nav><main id="workspace" class="workspace ${desk ? 'desk' : ''}" tabindex="-1">${content}</main></div>`;
}
function desk() {
  const historical = state.cursor.index < path().tail;
  const inactive = state.cursor.path !== state.active;
  const primary = historical ? button('Explore from this moment', 'fork', 'class="primary"') : inactive ? button('Make this my active path', 'activate', 'class="primary"') : button('Continue story', 'continue', `class="primary" ${state.pending || state.uncertain ? 'disabled' : ''}`);
  return `<header class="story-strip"><div><h1>${story.title}</h1><small>${esc(path().label)} · ${story.episode}</small></div><span class="badge">Reader-director · outside the cast</span></header>
    <div class="reader" aria-label="Story passage" tabindex="0"><article class="paper"><p class="eyebrow">${esc(passage().scene)} · Passage ${state.cursor.index + 1}</p><h2 tabindex="-1">${esc(passage().title)}</h2>${passage().paragraphs.map(text => `<p>${esc(text)}</p>`).join('')}<img class="ornament" src="${art('ornament-divider.svg')}" alt=""><p class="endnote">${historical ? 'An earlier moment. Its future is still safely kept.' : 'There is room to stay in this moment.'}</p></article></div>
    <footer class="desk-controls">${state.failure ? `<div class="failure" role="alert">${esc(state.failure)} ${state.uncertain ? button('Check simulated request status', 'check-status') : button('Review before another attempt', 'continue')}</div>` : ''}${state.pending ? `<div class="failure" role="status">Simulated request in progress on ${esc(state.pending.pathLabel)}. You can keep reading or visit another room. ${button('Finish simulated request', 'finish')}</div>` : ''}
    <div class="pagination">${button('Previous', 'previous', state.cursor.index === 0 ? 'disabled' : '')}<span class="counter">${state.cursor.index + 1} of ${path().tail + 1} · ${historical ? 'Reading history' : 'Latest passage'}</span><div class="row">${button('Next', 'next', state.cursor.index >= path().tail ? 'disabled' : '')}${button('Latest', 'latest')}</div></div>
    <div class="contribution"><span class="scope">${historical ? 'Reading earlier · Continue will not target this past' : inactive ? 'Browsing another path · active path unchanged' : `Next action: ${esc(activePath().label)} · latest moment`}</span><div class="row">${button('Ask', 'ask', state.uncertain ? 'disabled' : '')}${button('Steer', 'steer', state.pending || state.uncertain ? 'disabled' : '')}${primary}</div></div></footer>`;
}
function library() {
  const tabs = ['Stories', 'Worlds', 'Characters', 'Scribes', 'Bookshelf'];
  let body;
  if (state.tab === 'Stories') body = `<div class="hero"><picture><source media="(max-width:600px)" srcset="${art('hero-scriptorium-tablet-portrait.webp')}"><source media="(max-width:1100px)" srcset="${art('hero-scriptorium-tablet-landscape.webp')}"><img src="${art('hero-scriptorium-desktop.webp')}" alt="" loading="lazy"></picture><div class="hero-copy"><p class="eyebrow">Your Scriptorium</p><h2>Some stories are waiting<br>for you to come home.</h2><p>Read for a while. Follow a possibility. Make something worth keeping.</p>${button('Resume your story', 'resume', 'class="primary"')}</div></div><div class="grid"><section class="panel"><span class="badge local">Saved reading</span><h3>${story.title}</h3><p class="muted">${story.subtitle}</p><p>3 passages · 2 paths · Last read: ${esc(passage().title)}</p>${button('Open story', 'resume')}${button('Start a different story', 'setup', 'class="text-button"')}</section><section class="panel"><p class="eyebrow">Experience review</p><h3>Depth without the interruption</h3><p>Visit all five rooms. Inspect an earlier moment. Try a direction, then come back to the same passage.</p>${button('Open capability ledger', 'ledger')}${button('Review loading and failure states', 'states', 'class="text-button"')}</section></div>`;
  else if (state.tab === 'Bookshelf') body = `<div class="panel"><span class="badge">Example edition · earlier source</span><h2>The House of Small Hours</h2><p>A sample book frozen at passage 2. Continuing the story would not change this edition.</p>${button('Inspect edition', 'edition')}${button('Listen: sample readiness', 'listening', 'class="text-button"')}</div>`;
  else body = `<div class="reference-layout"><img src="${art(state.tab === 'Worlds' ? 'moth-archive.webp' : state.tab === 'Characters' ? 'cinder-cast.webp' : 'vesper-quill.webp')}" alt="${esc(state.tab)} studio composition reference"><section class="panel"><p class="eyebrow">Reusable ${esc(state.tab.toLowerCase())} · private library</p><h2>${state.tab === 'Worlds' ? story.world : state.tab === 'Characters' ? 'Mara Venn' : story.scribe}</h2><p>${state.tab === 'Worlds' ? 'A coastal town where the salt reaches everything eventually. The place has a history beyond the current story.' : state.tab === 'Characters' ? state.studios.Characters.description : 'Patient, particular prose. Let dialogue carry its silences. Let small actions change what a conversation can bear.'}</p><p class="muted">Editing a reusable reference does not silently update an existing story.</p>${button('Open full studio', 'studio', 'class="primary"')}</section></div>`;
  return heading('Library', 'A place for your stories', 'Works, worlds, people and the craft that gives them a voice.') + `<div class="content"><div class="row tabs" aria-label="Library collections">${tabs.map(tab => button(tab, 'tab', `data-tab="${tab}" aria-pressed="${state.tab === tab}"`)).join('')}</div>${body}</div>`;
}
function chronicle() {
  return heading('Chronicle', 'Every path leaves a trace', 'Read what happened. Keep what might have happened.', button('Plan a scene', 'scene')) + `<div class="content"><div class="row tabs"><label>Path to inspect<select id="path-picker">${state.paths.map(item => `<option value="${item.id}" ${item.id === state.cursor.path ? 'selected' : ''}>${esc(item.label)}${item.id === state.active ? ' · active' : ''}</option>`).join('')}</select></label><span class="badge">Browsing does not activate a path</span></div><div class="history">${story.passages.slice(0, path().tail + 1).map((item, index) => `<section class="panel moment ${index === state.cursor.index ? 'active' : ''}"><p class="eyebrow">Passage ${index + 1} · ${item.scene}</p><h2>${item.title}</h2><p class="muted">${esc(item.paragraphs[0])}</p><div class="row">${button('Read this passage', 'read', `data-index="${index}"`)}${button('Explore from here', 'fork-at', `data-index="${index}"`)}${index === state.cursor.index ? '<span class="badge">Reading position</span>' : ''}${index === path().tail ? '<span class="badge local">Path head</span>' : ''}</div></section>`).join('')}</div></div>`;
}
function codex() {
  const visible = facts.filter(fact => fact.at <= state.cursor.index && (state.category === 'Private planning' ? fact.private : !fact.private && (state.category === 'All public' || fact.category === state.category)));
  return heading('Codex', 'Know what your story knows', `Inspecting passage ${state.cursor.index + 1} on ${esc(path().label)}. Later and sibling-path evidence is excluded.`, button('Creative settings', 'craft')) + `<div class="content"><div class="row tabs">${['All public', 'People', 'Commitments', 'World', 'Private planning'].map(category => button(category, 'category', `data-category="${category}" aria-pressed="${category === state.category}"`)).join('')}</div>${state.category === 'Private planning' ? '<div class="failure">Owner planning · excluded from reader Ask, public recall and books.</div>' : ''}<div class="grid">${visible.map(fact => `<section class="panel"><span class="badge">${fact.category}</span><h2>${fact.id === 'promise' && state.corrected ? 'Mara plans to leave on Sunday' : fact.title}</h2><p>${fact.detail}</p><small>${fact.private ? 'Private reference · not a narrated event' : `Source: ${fact.source}`}</small><div class="row">${button(fact.private ? 'Inspect private reference' : 'Show exact evidence', 'evidence', `data-id="${fact.id}"`)}</div></section>`).join('') || '<p class="muted">No public records in this category at this moment.</p>'}</div></div>`;
}
function gallery() {
  return heading('Gallery', 'An image belongs somewhere', 'Story art and private references, with their destinations kept clear.', button('Upload an image', 'upload')) + `<div class="content"><div class="grid">${assets.map(asset => `<section class="panel media-card"><img src="${art(asset.file)}" alt="${esc(asset.title)} composition placeholder" loading="lazy"><div><span class="badge">${asset.placement}</span><h2>${asset.title}</h2><p class="muted">${asset.kind}. ${asset.note}</p>${button('Inspect image', 'image', `data-id="${asset.id}"`)}${button('Paint a candidate', 'paint', `data-id="${asset.id}" class="text-button"`)}</div></section>`).join('')}</div><p class="muted">All artwork here is supplied brand art used to review collection layout. No images have been generated.</p></div>`;
}
function gate() {
  return heading('Gate', 'Make a work worth keeping', 'A book is a chosen telling. A playable save keeps the possibilities.') + `<div class="content grid"><section class="panel"><p class="eyebrow">Reader-safe edition</p><h2>Prepare a book</h2><p>Freeze a path, preview the included passages and choose a format. Private references and alternative futures stay out.</p><label>Book format<select id="book-format">${['EPUB', 'PDF', 'HTML', 'Markdown', 'Plain text', 'DOCX', 'ODT', 'RTF', 'JSON'].map(format => `<option>${format}</option>`).join('')}</select></label><p></p>${button('Preview selected edition', 'edition', 'class="primary"')}</section><section class="panel"><p class="eyebrow">Private playable save</p><h2>Keep all the paths</h2><p>Every retained path, private story state and owned illustration. Credentials and paid permissions never travel.</p><span class="badge">Private file · not a public book</span><p></p>${button('Review save contents', 'save-review')}</section><section class="panel"><p class="eyebrow">Finishing without pressure</p><h2>Pause is enough</h2><p>A quiet scene need not manufacture a climax. Keep your place, come back later, or choose an ending yourself.</p>${button('Pause and return to Library', 'pause')}${button('Sharing readiness', 'sharing', 'class="text-button"')}</section></div>`;
}
function render(focus = true) {
  if (state.locked) {
    app.innerHTML = `<main class="lock-screen"><img src="${art('vesper-threshold.webp')}" alt=""><h1>Leave your story safely here</h1><p>Demo locked. This prototype contains only fictional examples; this screen is not production authentication.</p>${button('Return to the prototype', 'unlock', 'class="primary"')}</main>`;
    return;
  }
  app.innerHTML = frame(({ desk, library, chronicle, codex, gallery, gate })[state.room](), state.room === 'desk');
  const reader = document.querySelector('.reader');
  if (reader) { reader.scrollTop = state.scroll.get(`${state.cursor.path}:${state.cursor.index}`) || 0; reader.addEventListener('scroll', savePosition, { passive: true }); }
  document.querySelector('#path-picker')?.addEventListener('change', event => { state.cursor.path = event.target.value; state.cursor.index = Math.min(state.cursor.index, path().tail); render(); });
  if (focus) (document.querySelector('.workspace h1') || document.querySelector('.paper h2') || document.querySelector('#workspace'))?.focus({ preventScroll: true });
}
function route() {
  const [, room, branch, index] = location.hash.replace(/^#/, '').split('/');
  if (room === 'task') return;
  const returningFromTask = task.open;
  if (task.open) task.close();
  if (returningFromTask && location.hash === taskReturnHash) return;
  if (rooms.some(([id]) => id === room) || room === 'library') state.room = room;
  else { location.replace('#/desk'); return; }
  if (room === 'desk' && branch && state.paths.some(item => item.id === branch)) {
    state.cursor.path = branch;
    state.cursor.index = Math.max(0, Math.min(path().tail, Number.parseInt(index, 10) || 0));
  }
  render();
}
let originFocus = null;
let taskReturnHash = '';
let taskReturnMarkup = null;
function openTask(title, body, footer = '', large = true, nested = false) {
  if (task.open && !nested) { taskReturnMarkup = task.innerHTML; nested = true; }
  if (!nested) {
    originFocus = document.activeElement;
    taskReturnHash = location.hash;
    taskReturnMarkup = null;
    history.pushState({ prototypeTask: true }, '', '#/task');
  }
  task.classList.toggle('task-large', large);
  task.innerHTML = `<div class="task-shell"><header class="task-head"><p class="eyebrow">${story.title} · example task</p><div class="row spread"><h2 id="task-title">${title}</h2>${button('Close · keep draft', 'close')}</div></header><div class="task-body">${body}</div><footer class="task-foot">${footer || '<small>Local prototype example. No production data is changed.</small>'}</footer></div>`;
  if (!task.open) task.showModal();
  (task.querySelector('[autofocus]') || task.querySelector('button'))?.focus();
}
function closeTask() {
  if (taskReturnMarkup) { task.innerHTML = taskReturnMarkup; taskReturnMarkup = null; bindDraft(); bindStudio(); return; }
  if (location.hash === '#/task') history.back();
  else task.close();
}
task.addEventListener('cancel', event => { event.preventDefault(); closeTask(); });
task.addEventListener('close', () => { originFocus?.isConnected && originFocus.focus({ preventScroll: true }); });
function bindDraft() {
  if (task.querySelector('#direction')) task.querySelector('#direction').value = state.draft;
  task.querySelector('#direction')?.addEventListener('input', event => {
    state.draft = event.target.value;
    const saved = write(sessionStorage, 'direction', state.draft);
    task.querySelector('#draft-state').textContent = saved ? 'Demo draft kept in this tab · not a server save' : 'Not saved · storage unavailable. Copy your text before leaving.';
  });
}
function direction(kind) {
  state.draftKind = kind;
  openTask(kind === 'Ask' ? 'Ask outside the story' : 'Steer this moment', `<p>${kind === 'Ask' ? 'Ask about public events at the inspected moment. This does not make an event happen or reveal private planning.' : 'Offer direction, not finished prose. Leave room for character choice and the established world.'}</p><p class="badge">${esc(kind === 'Ask' ? path().label : activePath().label)} · ${kind === 'Ask' ? `inspecting passage ${state.cursor.index + 1}` : `latest moment, passage ${activePath().tail + 1}`}</p><label>${kind === 'Ask' ? 'Your question' : 'What deserves attention?'}<textarea id="direction" maxlength="4000" autofocus placeholder="Let them find a way to talk without forcing a reconciliation.">${esc(state.draft)}</textarea></label>${kind === 'Steer' ? '<label>Scope<select><option>This moment only</option><option>Ongoing focus after success</option></select></label>' : ''}<p id="draft-state" class="muted">Demo draft kept in this tab · not a server save</p>`, `${button('Review simulated request', 'direction-review', 'class="primary"')}<small>Nothing submits until you review it. No model is connected.</small>`);
  bindDraft();
}
function review(family) {
  const nested = task.open;
  if (nested) taskReturnMarkup = task.innerHTML;
  const target = family === 'Ask' ? `${path().label} · inspecting passage ${state.cursor.index + 1}` : family === 'Paint an image' ? 'Selected image candidate · no automatic placement' : `${activePath().label} · latest moment`;
  openTask('Review the request', `<span class="badge">Simulation only · no charge</span><dl><div class="review-line"><dt>Purpose</dt><dd>${esc(family)}</dd></div><div class="review-line"><dt>Destination</dt><dd>${esc(target)}</dd></div><div class="review-line"><dt>Example model</dt><dd>${family === 'Paint an image' ? 'Illustrator' : 'Storyteller'} example · no provider configured</dd></div><div class="review-line"><dt>Exposure</dt><dd>${family === 'Paint an image' ? 'Visible description and art direction only; no private motives or uploaded references.' : family === 'Ask' ? 'Public evidence through the inspected moment and your question. No private planning, future or sibling-path context.' : 'Selected story context and your submitted direction. Private fictional truth can constrain narration without being exposed in the reader.'}</dd></div><div class="review-line"><dt>Call ceiling</dt><dd>Example: one call, quality Off. Actual dispatches: zero.</dd></div><div class="review-line"><dt>Example estimate</dt><dd>$0.02–$0.05 illustrative range. This prototype costs $0.</dd></div></dl><label>Simulated outcome<select id="outcome"><option value="success">Completed example</option><option value="failure">Provider failure</option><option value="unknown">Unknown outcome after disconnect</option></select></label>`, `${button('Run simulated request', 'run-example', `class="primary" data-family="${esc(family)}"`)}${button('Back · keep draft', 'close')}<small>No remembered approval. Cancel leaves your direction intact.</small>`, false, nested);
}
function evidence(id) {
  const fact = facts.find(item => item.id === id);
  openTask(fact.private ? 'Private owner reference' : 'Evidence, not a guess', `<span class="badge">${fact.private ? 'Private planning' : 'Public evidence'} · ${esc(fact.source)}</span><h3>${fact.title}</h3><p>${fact.detail}</p>${fact.quote ? `<blockquote class="quote">“${fact.quote}”</blockquote><p>Exact quotation from passage ${fact.at + 1}. The source is preserved when you correct its interpretation.</p>` : '<p>No narrated source. A private plan is not evidence of an event.</p>'}`, fact.private ? '' : `${button('Read source and return later', 'source', `data-index="${fact.at}"`)}${button('Correct interpretation locally', 'correct', 'class="primary"')}`);
}
function studio() {
  state.studio = state.studios[state.tab] || state.studios.Characters;
  const title = state.tab === 'Worlds' ? 'World studio' : state.tab === 'Scribes' ? 'Scribe studio' : 'Character studio';
  const image = state.tab === 'Worlds' ? 'moth-archive.webp' : state.tab === 'Scribes' ? 'vesper-quill.webp' : 'cinder-cast.webp';
  openTask(title, `<div class="reference-layout"><img src="${art(image)}" alt="${title} composition reference"><div><p class="eyebrow">Identity · depth · craft · image</p><p>Give the reference particularity and depth. This reference stays independent of existing stories.</p>${button('Upload reference image', 'upload')}${button('Paint reference image', 'paint')}</div></div><div class="fields"><label>Name<input id="studio-name" value="${esc(state.studio.name)}"></label><label>Visible description<textarea id="studio-description">${esc(state.studio.description)}</textarea></label><label>Private background<textarea id="studio-private">${esc(state.studio.private)}</textarea></label></div><p class="muted">Sample fields are held in memory. Closing keeps them for this open prototype; reload is not a server save.</p>`, `${button('Save sample entry locally', 'studio-save', 'class="primary"')}${button('Compare a sample development', 'candidate')}`);
  bindStudio();
}
function bindStudio() {
  if (!task.querySelector('#studio-name')) return;
  task.querySelector('#studio-name').value = state.studio.name;
  task.querySelector('#studio-description').value = state.studio.description;
  task.querySelector('#studio-private').value = state.studio.private;
  task.querySelectorAll('input, textarea').forEach(field => field.addEventListener('input', () => {
    state.studio.name = task.querySelector('#studio-name').value;
    state.studio.description = task.querySelector('#studio-description').value;
    state.studio.private = task.querySelector('#studio-private').value;
  }));
}
const actions = {
  resume: () => navigate('desk'), previous: () => navigate('desk', Math.max(0, state.cursor.index - 1)), next: () => navigate('desk', Math.min(path().tail, state.cursor.index + 1)), latest: () => navigate('desk', path().tail),
  tab: element => { state.tab = element.dataset.tab; render(false); }, category: element => { state.category = element.dataset.category; render(false); },
  read: element => navigate('desk', Number(element.dataset.index)), 'fork-at': element => { state.cursor.index = Number(element.dataset.index); actions.fork(); },
  fork: () => openTask('Keep this possibility', `<p>Create a child path at passage ${state.cursor.index + 1}: <strong>${passage().title}</strong>.</p><p>The original future remains intact. The new path receives no events or knowledge from after this point.</p><label>Path name<input id="fork-name" value="Another way home" maxlength="80"></label>`, button('Create example path · no AI', 'fork-confirm', 'class="primary"')),
  'fork-confirm': () => {
    const label = task.querySelector('#fork-name').value.trim() || 'Another way home';
    const id = `path-${state.paths.length}`;
    state.paths.push({ id, label, tail: state.cursor.index }); state.active = id;
    taskReturnMarkup = null; task.close(); history.replaceState(null, '', `#/desk/${id}/${state.cursor.index}`); state.cursor.path = id; state.room = 'desk'; render(); notify('Example child path created locally. The original future is kept.');
  },
  activate: () => { state.active = path().id; render(); notify(`Active example path: ${path().label}. No generation.`); },
  continue: () => review('Continue story'), steer: () => direction('Steer'), ask: () => direction('Ask'), 'direction-review': () => review(state.draftKind),
  'run-example': element => {
    state.pending = { family: element.dataset.family, outcome: task.querySelector('#outcome').value, pathLabel: state.paths.find(item => item.id === state.active).label, draft: state.draft };
    state.failure = ''; taskReturnMarkup = null; task.close(); history.replaceState(null, '', '#/desk'); state.room = 'desk'; render(); notify('Simulated request queued. Browse freely, then finish the example.');
  },
  finish: () => {
    const pending = state.pending; if (!pending) return; state.pending = null;
    if (pending.outcome === 'failure') state.failure = 'Simulated provider failure. Story unchanged; your direction is kept. Another attempt needs review.';
    else if (pending.outcome === 'unknown') { state.uncertain = true; state.failure = 'Simulated connection loss. Outcome unknown: this is not proof that nothing was dispatched. Check status before a new purchase.'; }
    else notify('Simulated result ready. No new story prose was generated, no private truth was revealed and no charge was made.');
    render(false);
  },
  'check-status': () => openTask('Resolve the original request first', '<p>A missing response is not permission for a replacement purchase. Production must query the original durable action identity, or establish a cancellation fence.</p><p>This example has no provider. Resolve it explicitly as failed without dispatch to continue reviewing the interface.</p>', button('Resolve example as failed · no dispatch', 'resolve-status')),
  'resolve-status': () => { state.uncertain = false; state.failure = 'Original simulated request resolved as failed without dispatch. A new attempt still requires review.'; closeTask(); render(false); },
  evidence: element => evidence(element.dataset.id),
  source: element => { task.close(); history.replaceState(null, '', `#/desk/${state.cursor.path}/${element.dataset.index}`); state.cursor.index = Number(element.dataset.index); state.room = 'desk'; render(); },
  correct: () => { state.corrected = true; closeTask(); notify('Sample interpretation corrected locally. The original quotation remains.'); },
  studio, 'studio-save': () => { closeTask(); notify('Sample reference changed in memory. Existing stories were not updated.'); },
  candidate: () => { taskReturnMarkup = task.innerHTML; openTask('Compare, then choose', `<p>Fixed sample candidate · no model call.</p><h3>Current visible description</h3><p>${esc(state.studio.description)}</p><h3>Candidate</h3><p>${sampleCandidate()}</p><p>Private fields remain unchanged. Accepting updates only this unsaved example draft.</p>`, button('Use sample visible description', 'candidate-accept', 'class="primary"') + button('Back to unchanged fields', 'close'), true, true); },
  'candidate-accept': () => { state.studio.description = sampleCandidate(); taskReturnMarkup = null; studioReopen(); },
  paint: () => review('Paint an image'), image: element => { const asset = assets.find(item => item.id === element.dataset.id); openTask(asset.title, `<img style="width:100%;max-height:320px;object-fit:contain" src="${art(asset.file)}" alt="${asset.title} composition placeholder"><p>${asset.note}</p><p>Placement: ${asset.placement}. Removing a placement would not delete the owned image.</p><p class="muted">Source/path selectors and attachment review arrive in B5; no placement is changed here.</p>`); },
  upload: () => openTask('Upload without buying an image', '<label>Choose a local image<input id="sample-upload" type="file" accept="image/png,image/jpeg,image/webp"></label><p>The file is not uploaded or retained by this prototype. Production will normalize and validate it before attachment.</p><p id="file-state" class="muted">A native selection cannot survive reload. You would need to choose it again.</p>'),
  craft: () => openTask('The craft of this telling', `<div class="fields"><label>Scribe<input value="${story.scribe}" readonly></label><label>Perspective<select><option>Close third · Mara</option><option>Flexible at scene boundaries</option><option>Omniscient</option></select></label><label>Length<select><option>Unhurried · about 500 words</option><option>Brief · about 200 words</option><option>Extended · about 1,000 words</option></select></label><label>What matters in this scene<textarea>Small practical kindness. Neither sibling owes the other a reconciliation today.</textarea></label></div><p class="muted">Example controls only. Applying future configuration requires B3 versioned state and save support; these controls do not change existing prose.</p>`, button('Keep the current story unchanged', 'close')),
  scene: () => openTask('A scene may begin as a possibility', '<label>Scene name<input value="The room upstairs"></label><label>Purpose, not a required outcome<textarea>Give Mara a chance to approach the room. She may choose to leave it closed.</textarea></label><p>No prose, events or completed goals are created by planning a scene. Chapter grouping is a later B4 adapter.</p>', button('Keep example plan without generating', 'close')),
  edition: () => openTask('Preview a reader-safe edition', `<p class="badge">${esc(path().label)} · passages 1–${path().tail + 1}</p><h3>${story.title}</h3><ol>${story.passages.slice(0, path().tail + 1).map(item => `<li>${item.title}</li>`).join('')}</ol><p>Includes selected-path prose and cover/placed passage art. Excludes private references, Ask records, credentials and sibling futures.</p><p class="muted">Source frozen for this example. No book renderer or download is connected.</p>`, button('Return to Gate', 'close')),
  'save-review': () => openTask('A private save keeps more than a book', `<ul><li>${state.paths.length} example paths, with their retained history</li><li>Private facts and story-owned references</li><li>Placed and unplaced owned images</li></ul><p>Never includes API keys, access passwords, paid permissions or resumable requests.</p><p class="failure">This is a content preview only. It does not create a playable file; strict graph validation and copy import remain production responsibilities.</p>`, button('Close content preview', 'close')),
  sharing: () => openTask('Sharing stays out of the way until ready', '<p>Private book export must work independently. Public sharing is not enabled in this prototype; B7 needs immutable reader-safe snapshots, expiry and revocation before a share action appears.</p>'),
  listening: () => openTask('A voice when you choose it', '<p>Listening will bind the exact selected prose and voice to an immutable edition. Cached replay is free; new synthesis requires a reviewed operation.</p><p class="muted">B6 is not implemented. This prototype does not synthesize or play sample speech.</p>'),
  settings: () => openTask('Make room for reading', `<label>Reading size<select id="reading-size"><option value="1.12">Comfortable</option><option value="1.4">Large</option><option value="1.75">Extra large</option></select></label><p>Only this device’s presentation changes. No story settings or model requests.</p>${button('Apply reading size', 'reading-size')}${button('Reset reading size', 'reading-reset', 'class="text-button"')}`),
  'reading-size': () => { document.documentElement.style.setProperty('--reading-size', `${task.querySelector('#reading-size').value}rem`); closeTask(); },
  'reading-reset': () => { document.documentElement.style.removeProperty('--reading-size'); closeTask(); },
  setup: () => openTask('Begin outside the cast', `<label>Working title<input value="A story not yet named"></label><label>What is the situation?<textarea placeholder="A place, a few people, something unsettled."></textarea></label><p>No avatar, protagonist or Session Zero is required. Select world, cast and Scribe references when useful; advanced setup remains optional.</p><p class="muted">Setup persistence and studio handoffs need production drafts in B1/B3. This example does not create a story.</p>`),
  ledger: () => openTask('Version 4.1 capability ledger', `<p>Implementation dispositions, not claims that the proposed features already work.</p><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Disposition</th><th>Batch</th><th>Contract</th></tr></thead><tbody>${capabilities.map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`),
  states: () => openTask('Review difficult moments', `<p>Exercise the flows that tend to disappear behind a polished happy path.</p><div class="fields">${button('Show reader loading', 'loading')}${button('Show failed Continue beside the action', 'failure')}${button('Open a direction with the keyboard', 'steer')}${button('Review unknown paid outcome', 'unknown')}</div><p class="muted">For Android keyboard/Back/rotation evaluation use the real tablet. Browser viewport emulation is supporting evidence only.</p>`),
  loading: () => { task.close(); history.replaceState(null, '', '#/desk'); state.room = 'desk'; render(); const reader = document.querySelector('.reader'); reader.innerHTML = '<div class="loading" role="status">Opening your saved passage… No generation requested.</div>'; setTimeout(() => { if (!state.locked && state.room === 'desk') render(false); }, 900); },
  failure: () => { state.failure = 'Simulated provider failure. Your passage and direction are safe. Another attempt needs review.'; task.close(); history.replaceState(null, '', '#/desk'); state.room = 'desk'; render(); },
  unknown: () => { review('Continue story'); task.querySelector('#outcome').value = 'unknown'; },
  pause: () => { savePosition(); navigate('library'); }, close: closeTask,
  lock: () => { savePosition(); if (task.open) task.close(); state.locked = true; state.draft = ''; write(sessionStorage, 'direction', ''); document.querySelector('#notice').textContent = ''; render(); },
  unlock: () => { state.locked = false; render(); },
};
function sampleCandidate() { return state.tab === 'Worlds' ? 'Greyhaven keeps its own time: fish markets at dawn, paint peeling under salt wind, neighbours who remember departures longer than storms.' : state.tab === 'Scribes' ? 'Ground each scene in a precise observed action. Let dialogue remain particular to each speaker; treat silence as space rather than a problem to fill.' : 'Mara repairs damaged books for a living. She finds broken objects easier to approach than unfinished conversations.'; }
function studioReopen() { task.close(); history.replaceState(null, '', taskReturnHash || '#/library'); studio(); }
document.addEventListener('click', event => {
  const element = event.target.closest('[data-action]');
  if (element && !element.disabled) actions[element.dataset.action]?.(element);
});
document.addEventListener('change', event => {
  if (event.target.id === 'sample-upload') task.querySelector('#file-state').textContent = event.target.files.length ? 'File selected on this device only. Nothing was uploaded or persisted.' : 'No file selected.';
});
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', savePosition);
if (location.hash === '#/task') history.replaceState(null, '', '#/desk');
route();
