// Library one-sheet manuscript start. Manual and imported prose stay local;
// AI is optional, reviewed, and configured only when the author asks for it.

import { approxCostText } from '../core/cost.js';
import { beginButtonBusy } from '../core/dom.js';
import { IMAGE_COST_ESTIMATE } from '../components/entity-card.js';

const START_DRAFT_KEY = 'im-manuscript-start-draft-v1';
const DISMISSED_HINTS_KEY = 'im-manuscript-start-hints-v1';
const FOUNDATION_ESTIMATE = 0.02;
const COVER_ESTIMATE = IMAGE_COST_ESTIMATE.story;
const PATH_HINT = {
  manual: 'Your opening becomes Page 1 locally. No provider, model, or API key is needed.',
  seed: 'The seed waits in the Desk direction. Nothing is sent until you review and press the paid Generate action.',
  import: 'Plain text stays in Chapter I; Markdown headings can become chapter titles without becoming prose pages.',
};
const FOUNDATION_FIELDS = [
  ['premise', 'Premise', 'startSeedPremise'],
  ['narrative_voice', 'Narrative voice', 'startNarrativeVoice'],
  ['point_of_view', 'Point of view', 'startPointOfView'],
  ['tense', 'Tense', 'startTense'],
  ['constraints', 'Constraints', 'startConstraints'],
];

export function createManuscriptStart({ api, state, notify, features, dialogs }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let path = 'manual';
  let stage = 1;
  let creating = false;
  let reviewing = false;
  let draftingFoundations = false;

  const el = (id) => document.getElementById(id);

  function draftValue() {
    return {
      path,
      stage,
      title: el('manuscriptStartName')?.value || '',
      manual: el('startManualOpening')?.value || '',
      premise: el('startSeedPremise')?.value || '',
      direction: el('startSeedDirection')?.value || '',
      prose: el('startImportProse')?.value || '',
      importMode: el('startImportMode')?.value || 'headings',
      worldId: el('startWorld')?.value || '',
      scribeId: el('startScribe')?.value || '',
      castMode: features.storyEditor?.castMode?.() || 'ensemble',
      cast: features.storyEditor?.storyCast?.() || [],
      castDraft: features.storyEditor?.creationCastDraft?.() || null,
      narrativeVoice: el('startNarrativeVoice')?.value || '',
      pointOfView: el('startPointOfView')?.value || '',
      tense: el('startTense')?.value || '',
      constraints: el('startConstraints')?.value || '',
      tone: el('manuscriptStartTone')?.value || 'fade-to-black',
      foundationsOpen: Boolean(el('startFoundations')?.open),
    };
  }

  function saveDraft() {
    try { sessionStorage.setItem(START_DRAFT_KEY, JSON.stringify(draftValue())); } catch { /* memory-only browser */ }
  }

  function savedDraft() {
    try { return JSON.parse(sessionStorage.getItem(START_DRAFT_KEY) || 'null'); } catch { return null; }
  }

  function setPath(next, { focus = false } = {}) {
    path = ['manual', 'seed', 'import'].includes(next) ? next : 'manual';
    for (const button of document.querySelectorAll('[data-start-path]')) {
      const active = button.dataset.startPath === path;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('[data-start-panel]')) {
      panel.hidden = panel.dataset.startPanel !== path;
    }
    if (el('manuscriptStartHint')) el('manuscriptStartHint').textContent = PATH_HINT[path];
    let dismissed = [];
    try { dismissed = JSON.parse(sessionStorage.getItem(DISMISSED_HINTS_KEY) || '[]'); } catch { dismissed = []; }
    if (el('manuscriptStartHintWrap')) el('manuscriptStartHintWrap').hidden = dismissed.includes(path);
    if (el('manuscriptStartSubmit')) {
      el('manuscriptStartSubmit').textContent = path === 'seed' ? 'Create and open the Desk' : 'Create manuscript';
    }
    if (focus) {
      const target = path === 'manual' ? el('startManualOpening') : path === 'seed' ? el('startSeedPremise') : el('startImportProse');
      target?.focus();
    }
    saveDraft();
  }

  function setStage(next, { focus = false } = {}) {
    stage = Math.min(3, Math.max(1, Number(next) || 1));
    for (const panel of document.querySelectorAll('[data-start-stage]')) {
      panel.hidden = Number(panel.dataset.startStage) !== stage;
    }
    for (const button of document.querySelectorAll('[data-start-stage-target]')) {
      const selected = Number(button.dataset.startStageTarget) === stage;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('active', selected);
    }
    if (focus) {
      const target = stage === 1 ? el('manuscriptStartName')
        : stage === 2 ? el('startWorld') : el('startNarrativeVoice');
      target?.focus();
    }
    saveDraft();
  }

  function renderTemplates(keep = {}) {
    const world = el('startWorld');
    if (world) {
      const wanted = keep.worldId ?? world.value;
      world.textContent = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'No world';
      world.appendChild(none);
      for (const item of state.data.worlds || []) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        world.appendChild(option);
      }
      if ([...world.options].some((option) => option.value === wanted)) world.value = wanted;
    }

    const scribe = el('startScribe');
    if (scribe) {
      const wanted = keep.scribeId ?? scribe.value;
      scribe.textContent = '';
      const neutral = document.createElement('option');
      neutral.value = '';
      neutral.textContent = 'No Scribe — neutral house craft';
      scribe.appendChild(neutral);
      for (const item of state.data.scribes || []) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.name} — revision ${item.revision_number}`;
        scribe.appendChild(option);
      }
      if ([...scribe.options].some((option) => option.value === wanted)) scribe.value = wanted;
    }

    if (Array.isArray(keep.cast)) {
      features.storyEditor?.restoreCreationCast?.(keep.castMode, keep.cast, keep.castDraft);
    } else {
      features.storyEditor?.renderCastBuilder?.();
    }
  }

  function restoreDraft() {
    const draft = savedDraft();
    if (!draft) return;
    const values = {
      manuscriptStartName: draft.title,
      startManualOpening: draft.manual,
      startSeedPremise: draft.premise,
      startSeedDirection: draft.direction,
      startImportProse: draft.prose,
      startImportMode: draft.importMode,
      startNarrativeVoice: draft.narrativeVoice,
      startPointOfView: draft.pointOfView,
      startTense: draft.tense,
      startConstraints: draft.constraints,
      manuscriptStartTone: draft.tone,
    };
    for (const [id, value] of Object.entries(values)) if (el(id) && typeof value === 'string') el(id).value = value;
    if (el('startFoundations')) el('startFoundations').open = draft.foundationsOpen === true;
    renderTemplates(draft);
    setPath(draft.path || 'manual');
    setStage(draft.stage || 1);
  }

  function open(next = 'manual') {
    if (!el('homeSection')?.classList.contains('active')) {
      window.location.hash = '#/library';
      setTimeout(() => open(next), 0);
      return;
    }
    const sheet = el('manuscriptStartSheet');
    if (!sheet) return;
    renderTemplates(savedDraft() || {});
    sheet.hidden = false;
    setPath(next);
    setStage(savedDraft()?.stage || 1, { focus: true });
    sheet.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function close() {
    saveDraft();
    const sheet = el('manuscriptStartSheet');
    if (sheet) sheet.hidden = true;
    el('heroStartBtn')?.focus();
  }

  function untitledName() {
    const titles = new Set((state.data.stories || []).map((story) => story.title));
    if (!titles.has('Untitled manuscript')) return 'Untitled manuscript';
    let number = 2;
    while (titles.has(`Untitled manuscript ${number}`)) number++;
    return `Untitled manuscript ${number}`;
  }

  function foundationText() {
    const rows = [
      ['Premise', el('startSeedPremise')?.value],
      ['Narrative voice', el('startNarrativeVoice')?.value],
      ['Point of view', el('startPointOfView')?.value],
      ['Tense', el('startTense')?.value],
      ['Constraints', el('startConstraints')?.value],
    ].filter(([, value]) => value?.trim());
    return rows.length ? `Foundations:\n${rows.map(([label, value]) => `${label}: ${value.trim()}`).join('\n')}` : '';
  }

  function seedDirection() {
    return [el('startSeedPremise')?.value.trim(), el('startSeedDirection')?.value.trim(), foundationText()]
      .filter(Boolean).join('\n\n');
  }

  function chunks(text, limit = 48000) {
    const result = [];
    for (let start = 0; start < text.length; start += limit) result.push(text.slice(start, start + limit));
    return result;
  }

  function importChapters(text, mode) {
    if (mode !== 'headings') return [{ title: 'Chapter I', content: text }];
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let current = { title: 'Chapter I', lines: [] };
    for (const line of lines) {
      const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (!heading) {
        current.lines.push(line);
        continue;
      }
      if (current.lines.join('\n').trim() || chapters.length > 0) chapters.push(current);
      current = { title: heading[1].trim().slice(0, 500) || `Chapter ${chapters.length + 1}`, lines: [] };
    }
    chapters.push(current);
    return chapters.map((chapter) => ({ title: chapter.title, content: chapter.lines.join('\n') }));
  }

  async function addOpening(story, foundations) {
    if (path === 'manual') {
      const opening = el('startManualOpening').value;
      if (!opening.trim()) throw new Error('Write or paste an opening page before creating this manuscript.');
      await apiCall(`/stories/${story.id}/pages`, 'POST', { content: opening, user_input: foundations || null });
      return;
    }
    if (path === 'seed') {
      const direction = seedDirection();
      if (!direction) throw new Error('Give the Scribe a premise or opening direction first.');
      state.data.pendingOpeningDirection = { storyId: story.id, text: direction };
      return;
    }

    const prose = el('startImportProse').value;
    if (!prose.trim()) throw new Error('Choose a text file or paste prose before importing.');
    const hierarchy = story.hierarchy;
    const volume = hierarchy.volumes[0];
    const firstChapter = volume.chapters[0];
    const chapters = importChapters(prose, el('startImportMode').value);
    let firstPage = true;
    for (let index = 0; index < chapters.length; index++) {
      const chapter = chapters[index];
      if (index === 0 && chapter.title !== firstChapter.title) {
        await apiCall(`/stories/${story.id}/chapters/${firstChapter.id}`, 'PUT', { title: chapter.title });
      } else if (index > 0) {
        await apiCall(`/stories/${story.id}/volumes/${volume.id}/chapters`, 'POST', { title: chapter.title });
      }
      for (const content of chunks(chapter.content)) {
        if (!content.trim()) continue;
        await apiCall(`/stories/${story.id}/pages`, 'POST', {
          content,
          user_input: firstPage && foundations ? foundations : null,
        });
        firstPage = false;
      }
    }
  }

  async function create(event) {
    event.preventDefault();
    if (creating) return;
    creating = true;
    const submit = el('manuscriptStartSubmit');
    const coverSubmit = el('manuscriptStartWithCover');
    const withCover = event.submitter?.id === 'manuscriptStartWithCover';
    const status = el('manuscriptStartStatus');
    if (withCover) {
      reviewing = true;
      const yes = await dialogs.confirmPaid({
        title: 'Create this manuscript and paint its cover?',
        review: {
          action: 'Create the manuscript, then paint a vertical cover in the background.',
          object: `manuscript "${el('manuscriptStartName').value.trim() || '(untitled)'}"`,
          quantity: 'one 1K cover painting',
          sends: 'the title, maturity level, world description, cast appearance details, and available reference paintings',
          estimate: COVER_ESTIMATE,
          note: 'Create manuscript binds the same story without sending an image request.',
        },
        confirmLabel: `Create & paint (${approxCostText(COVER_ESTIMATE)})`,
      });
      reviewing = false;
      if (!yes) {
        creating = false;
        return;
      }
    }
    if (submit) submit.disabled = true;
    if (coverSubmit) coverSubmit.disabled = true;
    if (status) status.textContent = 'Binding Volume I and Chapter I…';
    let story = null;
    const completedPath = path;
    try {
      const response = await apiCall('/stories', 'POST', {
        generate_image: withCover,
        title: el('manuscriptStartName').value.trim() || untitledName(),
        world_id: el('startWorld').value || null,
        scribe_id: el('startScribe').value || null,
        tone: el('manuscriptStartTone').value,
        characters: (features.storyEditor?.storyCast?.() || []).map((entry) => ({ ...entry, state: null })),
      });
      story = response.story;
      await addOpening(story, foundationText());
      try { sessionStorage.removeItem(START_DRAFT_KEY); } catch { /* memory-only browser */ }
      el('manuscriptStartForm').reset();
      features.storyEditor?.resetCreationCast?.();
      if (el('manuscriptStartSheet')) el('manuscriptStartSheet').hidden = true;
      path = 'manual';
      stage = 1;
      await features.stories.loadStories();
      features.write.openStory(story.id);
      showSuccess(completedPath === 'import'
        ? 'Prose imported into the manuscript.'
        : withCover ? 'Manuscript created — the cover is being painted.' : 'Manuscript created.');
    } catch (error) {
      if (status) status.textContent = story
        ? `The manuscript exists, but its opening could not be finished: ${error.message}`
        : error.message;
      showError(error.message);
      saveDraft();
    } finally {
      creating = false;
      if (submit) submit.disabled = false;
      if (coverSubmit) coverSubmit.disabled = false;
    }
  }

  function renderFoundationDraft(foundations) {
    const wrap = el('startFoundationDraft');
    if (!wrap) return;
    wrap.textContent = '';
    const intro = document.createElement('p');
    intro.textContent = 'Review each suggestion. Nothing changes until you use that field.';
    wrap.appendChild(intro);
    for (const [key, label, targetId] of FOUNDATION_FIELDS) {
      const value = String(foundations[key] || '').trim();
      if (!value) continue;
      const row = document.createElement('div');
      row.className = 'foundation-draft__row';
      const copy = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = label;
      const text = document.createElement('p');
      text.textContent = value;
      copy.append(heading, text);
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'btn btn-secondary';
      accept.textContent = `Use ${label.toLowerCase()}`;
      accept.addEventListener('click', () => {
        el(targetId).value = value;
        accept.textContent = 'Used';
        accept.disabled = true;
        saveDraft();
      });
      row.append(copy, accept);
      wrap.appendChild(row);
    }
    wrap.hidden = false;
  }

  async function providerReady() {
    const providers = await apiCall('/providers');
    return providers.roles?.find((role) => role.role === 'scribe')?.status === 'available';
  }

  async function draftFoundations() {
    if (reviewing || draftingFoundations) return;
    const status = el('manuscriptStartStatus');
    try {
      if (!(await providerReady())) {
        el('startProviderSetup').hidden = false;
        el('startProviderKey').focus();
        if (status) status.textContent = 'Connect a provider only because you requested an AI draft. Manual and import paths remain ready.';
        return;
      }
    } catch (error) {
      showError(error.message);
      return;
    }
    reviewing = true;
    const yes = await dialogs.confirmPaid({
      title: 'Ask the Scribe for Foundation drafts?',
      review: {
        action: 'Suggest values for the five optional Foundation fields. You accept or reject each field separately.',
        object: 'this uncreated manuscript draft',
        quantity: 'one structured text response',
        sends: 'the premise, voice, point of view, tense, and constraints currently entered',
        estimate: FOUNDATION_ESTIMATE,
        note: 'No manuscript, page, world, or character template is changed by this request.',
      },
      confirmLabel: 'Draft Foundations (≈$0.02)',
    });
    reviewing = false;
    if (!yes) return;
    draftingFoundations = true;
    const restoreButton = beginButtonBusy(el('startDraftFoundationsBtn'), 'The Scribe is drafting…');
    try {
      const response = await apiCall('/ai/foundations', 'POST', {
        premise: el('startSeedPremise').value,
        narrative_voice: el('startNarrativeVoice').value,
        point_of_view: el('startPointOfView').value,
        tense: el('startTense').value,
        constraints: el('startConstraints').value,
        model: state.settings.model || undefined,
      });
      if (typeof response.cost_usd === 'number') state.addCost(response.cost_usd);
      renderFoundationDraft(response.foundations || {});
      if (status) status.textContent = 'Foundation drafts are ready for field-by-field review.';
    } catch (error) {
      showError(error.message);
      if (status) status.textContent = error.message;
    } finally {
      draftingFoundations = false;
      restoreButton();
    }
  }

  async function saveSessionProvider() {
    const key = el('startProviderKey').value.trim();
    if (!key) {
      el('manuscriptStartStatus').textContent = 'Enter an API key for this session.';
      return;
    }
    const button = el('startProviderSave');
    button.disabled = true;
    try {
      const providers = await apiCall('/providers');
      let profile = providers.profiles?.find((item) => !item.builtin && item.display_name === 'OpenRouter session');
      if (!profile) {
        profile = (await apiCall('/providers', 'POST', {
          display_name: 'OpenRouter session',
          base_url: 'https://openrouter.ai/api/v1',
          capabilities: ['catalog', 'chat', 'generation-cost', 'image', 'speech'],
        })).profile;
      }
      await apiCall(`/providers/${profile.id}/credential`, 'PUT', { source: 'session', credential: key });
      const current = providers.roles?.find((role) => role.role === 'scribe');
      await apiCall('/providers/roles/scribe', 'PUT', {
        profile_id: profile.id,
        model_id: state.settings.model || current?.model_id || 'z-ai/glm-5.1',
      });
      el('startProviderKey').value = '';
      el('startProviderSetup').hidden = true;
      el('manuscriptStartStatus').textContent = 'The Scribe is connected for this server session. You can now request the draft.';
    } catch (error) {
      showError(error.message);
      el('manuscriptStartStatus').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function loadImportFile() {
    const file = el('startImportFile').files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      showError('Choose a text file no larger than 1 MB.');
      el('startImportFile').value = '';
      return;
    }
    try {
      const text = await file.text();
      if (text.length > 500000) throw new Error('Imported prose must be 500,000 characters or fewer.');
      el('startImportProse').value = text;
      saveDraft();
    } catch (error) {
      showError(error.message);
    }
  }

  function init() {
    if (!el('manuscriptStartForm')) return;
    restoreDraft();
    for (const button of document.querySelectorAll('[data-start-path]')) {
      button.addEventListener('click', () => setPath(button.dataset.startPath, { focus: true }));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const names = ['manual', 'seed', 'import'];
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = names[(names.indexOf(path) + offset + names.length) % names.length];
        setPath(next);
        document.querySelector(`[data-start-path="${next}"]`)?.focus();
      });
    }
    el('manuscriptStartForm').addEventListener('submit', create);
    el('manuscriptStartClose').addEventListener('click', close);
    el('manuscriptStartCancel')?.addEventListener('click', close);
    for (const button of document.querySelectorAll('[data-start-stage-target], [data-start-next]')) {
      button.addEventListener('click', () => setStage(button.dataset.startStageTarget || button.dataset.startNext, { focus: true }));
    }
    el('manuscriptStartHintDismiss').addEventListener('click', () => {
      let dismissed = [];
      try { dismissed = JSON.parse(sessionStorage.getItem(DISMISSED_HINTS_KEY) || '[]'); } catch { dismissed = []; }
      dismissed = [...new Set([...dismissed, path])].slice(0, 3);
      try { sessionStorage.setItem(DISMISSED_HINTS_KEY, JSON.stringify(dismissed)); } catch { /* memory-only browser */ }
      el('manuscriptStartHintWrap').hidden = true;
    });
    el('startDraftFoundationsBtn').addEventListener('click', draftFoundations);
    el('startProviderSave').addEventListener('click', saveSessionProvider);
    el('startImportFile').addEventListener('change', loadImportFile);
    el('manuscriptStartForm').addEventListener('input', (event) => {
      if (event.target.id !== 'startProviderKey') saveDraft();
    });
    el('manuscriptStartForm').addEventListener('change', (event) => {
      if (event.target.id !== 'startProviderKey') saveDraft();
    });
    el('libraryBeginBtn')?.addEventListener('click', () => open('manual'));
  }

  return { open, close, setPath, setStage, renderTemplates, create, draftFoundations, saveDraft, init };
}
