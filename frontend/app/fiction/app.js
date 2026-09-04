import { el, button, field, option } from './dom.js';
import { createStoryDialogs } from './story-dialogs.js';
import { createMediaDialogs } from './media.js';
import { createSaveDialogs } from './saves.js';
import { createInfluence } from './influence.js';

const SCREEN_IDS = ['shelfScreen', 'startScreen', 'readerScreen', 'settingsScreen'];

export function createFictionApp({ api, dialogs, providerPanel = null }) {
  const $ = (id) => document.getElementById(id);
  let unlocked = false; let epoch = 0; let current = null; let busy = false; let poll = null; let earlierBusy = false;
  const drafts = new Map();
  const scopes = new Map(); let shelfOffset = 0; let nextShelfOffset = null;
  const castRows = [];
  let scenario = null;
  const alive = (token) => unlocked && epoch === token;
  const status = (message = '', error = false) => { $('fictionStatus').textContent = message; $('fictionStatus').dataset.error = String(error); };

  function showScreen(id) {
    for (const screen of SCREEN_IDS) $(screen).hidden = screen !== id;
    for (const [link, active] of [['shelfLink', id === 'shelfScreen'], ['preferencesLink', id === 'settingsScreen']]) {
      if (active) $(link).setAttribute('aria-current', 'page'); else $(link).removeAttribute('aria-current');
    }
  }

  function controls() {
    const blocked = busy || !current || current.pending;
    for (const id of ['fictionContinue', 'fictionSend', 'fictionInputKind', 'fictionBranch', 'fictionFork', 'fictionRewind', 'fictionCorrect', 'releaseFictionControl', 'fictionEndEpisode', 'fictionNextEpisode', 'fictionPreferences', 'fictionAddCast', 'fictionRetire', 'fictionIllustrate', 'fictionExportBook']) $(id).disabled = blocked;
    $('fictionEarlier').disabled = Boolean(blocked || earlierBusy);
    $('fictionDownloadSave').disabled = Boolean(blocked);
    $('fictionContinue').textContent = busy ? 'Working…' : current?.pending ? 'Story unfolding…' : 'Continue';
    $('fictionActionStatus').textContent = busy ? 'Your action is being handled.' : current?.pending ? 'A response is in progress. You can leave and return.' : '';
    $('fictionComposer').setAttribute('aria-busy', String(Boolean(blocked && current)));
    for (const node of $('fictionCast').querySelectorAll('button')) node.disabled = blocked;
    influence.controls(blocked);
  }

  function renderShelf(stories, nextOffset = null) {
    nextShelfOffset = nextOffset;
    $('fictionShelfPrevious').hidden = shelfOffset === 0; $('fictionShelfNext').hidden = nextOffset === null;
    $('fictionShelfPrevious').disabled = false; $('fictionShelfNext').disabled = false;
    const root = $('fictionShelf'); root.replaceChildren();
    if (!stories.length) root.append(el('p', 'Your next story starts here. Follow and steer without playing a character.', 'fiction-empty'));
    for (const story of stories) {
      const card = el('article', '', 'fiction-card');
      card.append(el('p', story.genre, 'eyebrow'), el('h2', story.title), el('p', story.premise.slice(0, 220)));
      const link = el('a', 'Return to this story', 'btn btn-secondary'); link.href = `#/story/${encodeURIComponent(story.id)}`;
      card.append(link); root.append(card);
    }
  }

  function renderProse(beats) {
    const root = $('fictionProse'); root.replaceChildren();
    if (!beats.length) root.append(el('p', 'The situation is set. Continue when you are ready, or give the story a direction.'));
    for (const beat of beats) {
      const article = el('article', '', 'fiction-beat'); article.dataset.beatId = beat.id;
      if (['opening', 'scene'].includes(beat.kind)) {
        const placed = current.state.illustrations?.find((item) => item.beat_id === beat.id);
        if (placed) {
          const figure = el('figure', '', 'fiction-illustration'); const img = el('img');
          img.src = `/api/fiction/${encodeURIComponent(current.id)}/images/${encodeURIComponent(placed.asset_id)}`;
          img.alt = placed.alt_text; img.loading = 'lazy';
          img.addEventListener('error', () => { img.hidden = true; figure.append(el('p', `Illustration unavailable: ${placed.alt_text}`)); }, { once: true });
          figure.append(img); if (placed.caption) figure.append(el('figcaption', placed.caption));
          article.append(figure);
        }
        if (beat.input?.kind && beat.input.kind !== 'follow') {
          const attribution = ['act', 'say'].includes(beat.input.kind) ? 'Character action' : 'Your direction';
          article.append(el('p', attribution, 'fiction-beat-meta'));
        }
        for (const paragraph of beat.prose.split(/\n\s*\n/)) article.append(el('p', paragraph));
      } else article.append(el('p', beat.kind === 'clarification' ? `Outside the story: ${beat.prose}` : beat.summary, 'fiction-aside'));
      if (beat.changes?.length) {
        const details = el('details'); details.append(el('summary', 'What changed'));
        for (const change of beat.changes) {
          details.append(el('p', change.op === 'introduce' ? `Introduced: ${change.character.name}` : `${change.op === 'resolve' ? 'Resolved: ' : change.op === 'remove' ? 'Removed: ' : ''}${change.fact.text}`));
          if (change.prior_evidence_beat_id) details.append(influence.sourceButton(change.prior_evidence_beat_id, 'Read the earlier record this changed'));
        }
        article.append(details);
      }
      const decision = (current.state.adjudications || []).find((entry) => entry.beat_id === beat.id);
      if (decision) article.append(el('p', `Recorded ruling: ${decision.explanation}`, 'fiction-aside'));
      root.append(article);
    }
  }

  function renderStory(story) {
    current = story;
    $('fictionStoryTitle').textContent = story.title;
    $('fictionEpisode').textContent = `Episode ${story.state.episode.number} · ${story.state.episode.title}`;
    const owned = story.state.cast.find((character) => character.id === story.state.control.character_id);
    $('fictionControl').textContent = owned ? `You control ${owned.name}. Their decisions and speech remain yours.` : 'You are the reader-director. The narrator runs the cast.';
    const spend = story.spend;
    $('fictionSpend').textContent = spend ? `Known provider spend: $${spend.known_usd.toFixed(4)}${spend.unknown_attempts ? ` · ${spend.unknown_attempts} attempt(s) have unknown cost` : ''}` : '';
    $('fictionCast').replaceChildren();
    for (const character of story.state.cast) {
      const card = el('div', '', 'fiction-detail-card');
      card.append(el('h3', character.name), el('p', character.description));
      if (owned?.id !== character.id) card.append(button(`Inhabit ${character.name}`, () => confirmControl(character)));
      $('fictionCast').append(card);
    }
    if (!story.state.cast.length) $('fictionCast').append(el('p', 'No cast members were supplied at the opening. You can still follow and steer.'));
    $('releaseFictionControl').hidden = !owned;
    const previousKind = $('fictionInputKind').value;
    $('fictionInputKind').replaceChildren(option('steer', 'Steer the story'), option('ask', 'Ask outside the story'));
    if (owned) $('fictionInputKind').append(option('act', `Act as ${owned.name}`), option('say', `Speak as ${owned.name}`));
    if ([...$('fictionInputKind').options].some((item) => item.value === previousKind)) $('fictionInputKind').value = previousKind;
    $('fictionBranch').replaceChildren(...story.branches.map((branch) => option(branch.id, branch.name)));
    $('fictionBranch').value = story.active_branch_id;
    $('fictionFacts').replaceChildren();
    for (const fact of story.state.facts) {
      const card = el('div', '', 'fiction-detail-card');
      card.append(el('p', `${fact.status === 'resolved' ? 'Resolved · ' : ''}${fact.text}${fact.value !== null ? ` (${fact.value})` : ''}`));
      if (fact.evidence_beat_id) card.append(influence.sourceButton(fact.evidence_beat_id));
      $('fictionFacts').append(card);
    }
    if (!story.state.facts.length) $('fictionFacts').append(el('p', 'Important discoveries and commitments will appear here.'));
    renderProse(story.beats);
    influence.render(story);
    $('fictionEarlier').hidden = !story.has_earlier;
    const ended = story.state.episode.status === 'ended';
    $('fictionComposer').hidden = ended; $('fictionEnded').hidden = !ended; $('fictionEndEpisode').hidden = ended;
    $('fictionEpisodeSummary').textContent = story.state.episode.summary || 'This episode has reached its resting point.';
    controls();
    clearTimeout(poll);
    if (story.pending) {
      const token = epoch;
      poll = setTimeout(async () => {
        if (!alive(token)) return;
        try { const data = await api(`/fiction/${story.id}`); if (alive(token)) renderStory(data.story); }
        catch (error) { if (alive(token)) status(error.message, true); }
      }, 1500);
    }
  }

  async function route() {
    if (!unlocked) return;
    const token = ++epoch; clearTimeout(poll); busy = false; earlierBusy = false; current = null;
    dialogs.close(true); status();
    $('startFiction').disabled = false; $('startFiction').textContent = 'Begin this story';
    $('importFictionCast').disabled = false; $('importFictionCast').textContent = 'Choose a character template';
    $('fictionEarlier').disabled = false;
    const hash = window.location.hash || '#/stories';
    try {
      if (hash === '#/new') {
        showScreen('startScreen');
        try { const data = await api('/fiction/scenarios'); if (alive(token)) renderScenarios(data.scenarios || []); }
        catch { if (alive(token)) $('scenarioChoices').textContent = 'Authored openings are unavailable. You can still create your own situation below.'; }
        return;
      }
      if (hash === '#/settings') {
        showScreen('settingsScreen');
        await providerPanel?.render(() => alive(token));
        return;
      }
      const match = /^#\/story\/([A-Za-z0-9_-]+)$/.exec(hash);
      if (match) {
        showScreen('readerScreen'); $('fictionProse').replaceChildren(); $('fictionStoryTitle').textContent = 'Opening your story…';
        for (const id of ['fictionCast', 'fictionFacts', 'fictionControl', 'fictionEpisode', 'fictionSpend', 'fictionPlayStyle', 'fictionFocusText', 'fictionChallenges', 'fictionInvitations']) $(id).replaceChildren();
        $('fictionDetails').hidden = true; $('fictionDetailsToggle').setAttribute('aria-expanded', 'false');
        controls();
        const data = await api(`/fiction/${match[1]}`);
        if (!alive(token)) return;
        renderStory(data.story); $('fictionDirection').value = drafts.get(data.story.id) || '';
        $('fictionDirectionScope').value = scopes.get(data.story.id) || 'moment'; controls();
      } else {
        showScreen('shelfScreen'); $('fictionShelf').textContent = 'Opening your stories…';
        const data = await api(shelfOffset ? `/fiction?offset=${shelfOffset}` : '/fiction'); if (alive(token)) renderShelf(data.stories, data.next_offset ?? null);
      }
    } catch (error) { if (alive(token)) { status(error.message, true); controls(); } }
  }

  async function localAction(path, method, payload = {}) {
    if (busy || !current || current.pending) return;
    const token = epoch; const story = current;
    busy = true; controls(); status();
    try {
      const data = await api(`/fiction/${story.id}/${path}`, method, { ...payload, expected_revision: story.revision });
      if (alive(token)) { renderStory(data.story); status('Saved.'); return { ok: true }; }
    } catch (error) { if (alive(token)) status(`${error.message} Your current path is preserved.`, true); return { ok: false, error: error.message }; }
    finally { if (alive(token)) { busy = false; controls(); } }
  }

  async function send(kind, approach = null) {
    if (busy || !current || current.pending || current.state.episode.status !== 'active') return;
    const story = current; const token = epoch;
    const direction = approach?.text || (kind === 'follow' ? '' : $('fictionDirection').value.trim());
    if (kind !== 'follow' && !direction) { $('fictionDirection').focus(); status('Add a direction or use Continue.'); return; }
    busy = true; controls(); status();
    try {
      const input = { kind, text: direction, ...(kind === 'steer' ? { direction_scope: approach ? 'moment' : $('fictionDirectionScope').value } : {}), ...(approach ? { challenge_id: approach.challenge_id, approach_id: approach.approach_id } : {}) };
      let free = false;
      if (approach) {
        const data = await api(`/fiction/${story.id}/challenge-review`, 'POST', { expected_revision: story.revision, input });
        if (!alive(token)) return;
        free = data.review.requires_generation === false;
      }
      const approved = free || await dialogs.confirmPaid({
        title: 'Let the story unfold?',
        body: 'This sends the premise, selected cast, boundaries, relevant facts (including hidden world truth), recent story text and your direction to your selected text provider. One completion is requested; cost depends on your provider and model. Invalid replies can still incur a charge. No automatic paid follow-up is started.',
        review: { action: 'Continue this story', object: story.title, model: story.generation?.provider ? `Storyteller (Scribe) · ${story.generation.provider.display_name} · ${story.generation.model_id}` : 'Your selected storyteller', quantity: 'One bounded narrative response', sends: 'Recent story, relevant facts (including hidden world truth), cast, boundaries and your direction', estimate: 0.02, note: 'A rough text-call estimate, not a spending cap. No automatic paid follow-up.' },
        confirmLabel: 'Continue with AI',
      });
      if (!approved || !alive(token)) return;
      const data = await api(`/fiction/${story.id}/replies`, 'POST', {
        expected_revision: story.revision, idempotency_key: globalThis.crypto.randomUUID(), input,
        ...(story.generation?.provider ? { provider_id: story.generation.provider.id, model: story.generation.model_id } : {}),
      });
      if (!alive(token)) return;
      if (!approach && kind !== 'follow' && $('fictionDirection').value.trim() === direction) { $('fictionDirection').value = ''; drafts.delete(story.id); $('fictionDirectionScope').value = 'moment'; scopes.delete(story.id); }
      renderStory(data.story); status(data.repeated_adjudication ? 'The recorded ruling still applies. No AI request or charge.' : 'Story saved.');
      $('fictionProse').lastElementChild?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    } catch (error) {
      if (!alive(token)) return;
      status(`${error.message}${error.billedAttempts ? ' The provider may have charged for this attempt.' : ''} Your direction is still here.`, true);
      // A lost response is reconciled by a free read, never by re-sending a
      // paid action or inventing a replacement generation.
      try { const data = await api(`/fiction/${story.id}`); if (alive(token)) renderStory(data.story); } catch { /* keep the visible error and draft */ }
    } finally { if (alive(token)) { busy = false; controls(); } }
  }

  async function runMediaAction(work) {
    if (busy || !current || current.pending) return { ok: false, error: 'Another action is in progress.' };
    const token = epoch; const story = current; busy = true; controls(); status();
    try {
      const data = await work(() => alive(token));
      if (!alive(token)) return { ok: false, stale: true };
      if (!data) return { ok: false, cancelled: true };
      if (data.story) renderStory(data.story);
      status('Done.'); return { ok: true };
    } catch (error) {
      if (!alive(token)) return { ok: false, stale: true };
      const message = `${error.message}${error.billedAttempts ? ' The provider may have charged for this attempt.' : ''}`;
      status(message, true);
      try { const data = await api(`/fiction/${story.id}`); if (alive(token)) renderStory(data.story); } catch { /* free reconciliation only */ }
      return { ok: false, error: message };
    } finally { if (alive(token)) { busy = false; controls(); } }
  }

  function confirmControl(character) {
    if (busy || !current || current.pending) return;
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: `Inhabit ${character.name}?`, body: `You will decide ${character.name}'s actions and speech. Continue can develop the surrounding scene but should stop before decisions that belong to you. You can return to reader-director at any time.`, actions: [
      { label: 'Keep directing', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Take this role', className: 'btn-primary', onClick: async (close) => { close(true); if (current?.id === id && current.revision === revision) await localAction('control', 'PUT', { character_id: character.id }); } },
    ] });
  }

  function pathDialog(rewind) {
    if (busy || !current || current.pending) return;
    const select = field('Continue from after this moment', 'select');
    select.control.append(option('', 'Before the opening'), ...current.beats.map((beat) => option(beat.id, beat.summary.slice(0, 120))));
    select.control.value = rewind ? current.beats.at(-2)?.id || '' : current.head_beat_id || '';
    const name = field('Name this path', 'input', rewind ? 'A different choice' : 'An alternative', { maxLength: 120 });
    const note = el('p', 'The original path remains available. This restores all story state at that moment. Read earlier moments first if the moment you want is not listed.');
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: rewind ? 'Rewind a choice' : 'Explore an alternative', body: [note, select.wrapper, name.wrapper], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Create this path', className: 'btn-primary', onClick: async (close) => { if (!name.control.value.trim()) { name.control.focus(); return; } close(true); if (current?.id === id && current.revision === revision) await localAction('branches', 'POST', { beat_id: select.control.value || null, name: name.control.value.trim() }); } },
    ] });
  }

  function correctionDialog(recalled = null) {
    if (busy || !current || current.pending) return;
    const select = field('Fact to correct', 'select');
    const facts = recalled?.id ? [recalled, ...current.state.facts.filter((fact) => fact.id !== recalled.id)] : current.state.facts;
    select.control.append(option('', 'Add a missing fact'), ...facts.map((fact) => option(fact.id, fact.text.slice(0, 100))));
    if (recalled?.id) select.control.value = recalled.id;
    const value = field('What is true?', 'textarea', recalled?.text || '', { maxLength: 1500, rows: 4 });
    const reason = field('Why are you correcting it?', 'input', '', { maxLength: 1500 });
    const error = el('p'); error.setAttribute('role', 'alert');
    select.control.addEventListener('change', () => { value.control.value = facts.find((fact) => fact.id === select.control.value)?.text || ''; });
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: 'Correct a story fact', body: [el('p', 'Corrections affect future narration on this path. Earlier prose is preserved, and there is no in-story penalty.'), select.wrapper, value.wrapper, reason.wrapper, error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Save correction', className: 'btn-primary', pendingLabel: 'Saving…', onClick: async (close) => {
        if (!value.control.value.trim() || !reason.control.value.trim()) { value.control.focus(); return; }
        const existing = facts.find((fact) => fact.id === select.control.value);
        const fact = { ...(existing || { id: globalThis.crypto.randomUUID(), kind: 'fact', visibility: 'public', known_by: [], status: 'active', actor_id: null, value: null }), text: value.control.value.trim() };
        if (current?.id !== id || current.revision !== revision) { error.textContent = 'The story changed. Refresh before saving this correction.'; return; }
        const result = await localAction('corrections', 'POST', { fact, reason: reason.control.value.trim() });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved. Your correction is still here.';
      } },
    ] });
  }

  function episodeDialog(start) {
    if (busy || !current || current.pending) return;
    const entry = field(start ? 'Episode title' : 'A short recap (optional)', start ? 'input' : 'textarea', start ? `Episode ${current.state.episode.number + 1}` : '', { maxLength: start ? 200 : 2000 });
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: start ? 'Begin another episode' : 'End this episode', body: [el('p', start ? 'Your cast, history and commitments continue with you.' : 'Mark a resting point. Nothing changes while you are away, and you can begin another episode whenever you want.'), entry.wrapper], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: start ? 'Begin episode' : 'End episode', className: 'btn-primary', onClick: async (close) => { if (start && !entry.control.value.trim()) { entry.control.focus(); return; } close(true); if (current?.id === id && current.revision === revision) await localAction('episodes', 'POST', start ? { action: 'start', title: entry.control.value.trim() } : { action: 'end', summary: entry.control.value.trim() }); } },
    ] });
  }

  function addCast(character = {}) {
    if (castRows.length >= 24) { status('A story can begin with up to 24 cast members.'); return; }
    const card = el('div', '', 'fiction-cast-draft');
    const name = field('Character name', 'input', character.name || '', { maxLength: 200 });
    const description = field('Who are they?', 'textarea', character.description || '', { maxLength: 2000, rows: 2 });
    const motive = field('What do they want?', 'input', character.motive || character.personality || '', { maxLength: 1000 });
    const row = { id: globalThis.crypto.randomUUID(), name, description, motive, card };
    card.append(name.wrapper, description.wrapper, motive.wrapper, button('Remove this character', () => { castRows.splice(castRows.indexOf(row), 1); card.remove(); }));
    castRows.push(row); $('fictionCastDraft').append(card);
  }

  function renderScenarios(scenarios) {
    const root = $('scenarioChoices'); root.replaceChildren();
    for (const entry of scenarios) {
      const card = el('article', '', 'fiction-card');
      card.append(el('h2', entry.title), el('p', entry.tagline), button(`Begin with ${entry.title}`, () => {
        scenario = entry; $('fictionTitle').value = entry.title; $('fictionPremise').value = entry.premise;
        $('fictionGenre').value = entry.genre; $('fictionBoundaries').value = entry.boundaries;
        castRows.length = 0; $('fictionCastDraft').replaceChildren();
        $('scenarioNote').textContent = `${entry.title} selected. Its authored opening, cast and world facts will be included. Any characters you add below are additional people.`;
        $('fictionTitle').focus();
      })); root.append(card);
    }
    root.append(button('Use my own situation', () => {
      scenario = null; $('fictionStartForm').reset(); castRows.length = 0; $('fictionCastDraft').replaceChildren(); $('scenarioNote').textContent = 'Your own situation: no preset cast or hidden world facts.';
    }));
  }

  async function startStory(event) {
    event.preventDefault();
    if (busy) return;
    const token = epoch; busy = true; $('startFiction').disabled = true; $('startFiction').textContent = 'Starting…'; status();
    try {
      const cast = castRows.map((row) => ({ id: row.id, name: row.name.control.value.trim(), description: row.description.control.value.trim(), motive: row.motive.control.value.trim() }));
      const payload = { title: $('fictionTitle').value.trim(), premise: $('fictionPremise').value.trim(), genre: $('fictionGenre').value, play_style: $('fictionStartStyle').value, cast, pacing: $('fictionPacing').value, consequences: $('fictionConsequences').value, boundaries: $('fictionBoundaries').value.trim(), voice: $('fictionVoice').value.trim(), ...(scenario ? { scenario_id: scenario.id } : {}) };
      const data = await api('/fiction', 'POST', payload);
      if (!alive(token)) return;
      $('fictionStartForm').reset(); castRows.length = 0; $('fictionCastDraft').replaceChildren(); scenario = null; $('scenarioNote').textContent = '';
      window.location.hash = `#/story/${data.story.id}`;
    } catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { busy = false; $('startFiction').disabled = false; $('startFiction').textContent = 'Begin this story'; } }
  }

  async function templates() {
    const token = epoch; const trigger = $('importFictionCast');
    if (trigger.disabled) return;
    trigger.disabled = true; trigger.textContent = 'Loading templates…';
    try {
      const data = await api('/characters');
      if (!alive(token)) return;
      $('fictionTemplatePicker').replaceChildren();
      const characters = Array.isArray(data) ? data : data.characters || [];
      for (const character of characters) $('fictionTemplatePicker').append(button(`Add ${character.name}`, () => addCast(character)));
      if (!characters.length) $('fictionTemplatePicker').textContent = 'No character templates yet. You can add a character above.';
    } catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { trigger.disabled = false; trigger.textContent = 'Choose a character template'; } }
  }

  function clearPrivate() {
    unlocked = false; epoch++; busy = false; earlierBusy = false; current = null; clearTimeout(poll); drafts.clear(); scopes.clear(); shelfOffset = 0; nextShelfOffset = null; scenario = null; castRows.length = 0;
    dialogs.close(true);
    document.querySelector('.dialog-manager__body')?.replaceChildren();
    const dialogTitle = document.querySelector('.dialog-manager__title'); if (dialogTitle) dialogTitle.textContent = '';
    for (const id of ['fictionShelf', 'fictionProse', 'fictionCast', 'fictionFacts', 'fictionCastDraft', 'fictionTemplatePicker', 'fictionProviderPanel', 'fictionStoryTitle', 'fictionControl', 'fictionEpisode', 'fictionSpend', 'fictionEpisodeSummary']) $(id).replaceChildren();
    $('fictionStartForm').reset(); $('fictionDirection').value = ''; status();
    for (const id of ['fictionPlayStyle', 'fictionFocusText', 'fictionChallenges', 'fictionInvitations']) $(id).replaceChildren();
    $('fictionDirectionScope').value = 'moment';
    for (const id of SCREEN_IDS) $(id).hidden = true;
    providerPanel?.clear();
    $('scenarioNote').textContent = ''; $('scenarioChoices').replaceChildren();
  }

  const storyDialogs = createStoryDialogs({ dialogs, getCurrent: () => current, isBusy: () => busy, localAction });
  const influence = createInfluence({ api, dialogs, getCurrent: () => current, isBusy: () => busy, localAction, send, correct: correctionDialog,
    setDirection: (value) => { $('fictionDirection').value = value; if (current) { drafts.set(current.id, value); scopes.set(current.id, 'moment'); } status('Direction filled in. Edit it or send when ready; nothing has happened yet.'); } });
  const mediaDialogs = createMediaDialogs({ api, dialogs, getCurrent: () => current, isBusy: () => busy, runAction: runMediaAction, localAction });
  const saveDialogs = createSaveDialogs({ dialogs, getCurrent: () => current, getLive: () => { const token = epoch; return () => alive(token); }, runAction: runMediaAction });
  $('fictionDownloadSave').addEventListener('click', saveDialogs.save);
  $('fictionImportSave').addEventListener('click', saveDialogs.importSave);
  $('fictionIllustrate').addEventListener('click', mediaDialogs.illustrate);
  $('fictionExportBook').addEventListener('click', mediaDialogs.exportBook);
  for (const [id, action] of [['fictionPreferences', 'preferences'], ['fictionAddCast', 'cast'], ['fictionRetire', 'retire']]) $(id).addEventListener('click', storyDialogs[action]);

  $('fictionStartForm').addEventListener('submit', startStory);
  $('addFictionCast').addEventListener('click', () => addCast());
  $('importFictionCast').addEventListener('click', templates);
  $('fictionRefresh').addEventListener('click', route);
  $('fictionShelfPrevious').addEventListener('click', () => { shelfOffset = Math.max(0, shelfOffset - 80); $('fictionShelfPrevious').disabled = true; route(); });
  $('fictionShelfNext').addEventListener('click', () => { if (nextShelfOffset !== null) { shelfOffset = nextShelfOffset; $('fictionShelfNext').disabled = true; route(); } });
  $('fictionContinue').addEventListener('click', () => send('follow'));
  $('fictionComposer').addEventListener('submit', (event) => { event.preventDefault(); send($('fictionInputKind').value); });
  $('fictionDirection').addEventListener('input', () => { if (current) drafts.set(current.id, $('fictionDirection').value); controls(); });
  $('fictionDirectionScope').addEventListener('change', () => { if (current) scopes.set(current.id, $('fictionDirectionScope').value); });
  $('fictionInputKind').addEventListener('change', controls);
  $('fictionDirection').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); send($('fictionInputKind').value); } });
  $('fictionDetailsToggle').addEventListener('click', () => { const showing = $('fictionDetails').hidden; $('fictionDetails').hidden = !showing; $('fictionDetailsToggle').setAttribute('aria-expanded', String(showing)); });
  $('releaseFictionControl').addEventListener('click', () => localAction('control', 'PUT', { character_id: null }));
  $('fictionBranch').addEventListener('change', () => localAction('branch', 'PUT', { branch_id: $('fictionBranch').value }));
  $('fictionFork').addEventListener('click', () => pathDialog(false));
  $('fictionRewind').addEventListener('click', () => pathDialog(true));
  $('fictionCorrect').addEventListener('click', correctionDialog);
  $('fictionEndEpisode').addEventListener('click', () => episodeDialog(false));
  $('fictionNextEpisode').addEventListener('click', () => episodeDialog(true));
  $('fictionEarlier').addEventListener('click', async () => {
    if (!current || $('fictionEarlier').disabled) return;
    const token = epoch; const story = current; earlierBusy = true; controls();
    try {
      const data = await api(`/fiction/${story.id}?before=${encodeURIComponent(story.beats[0].id)}`);
      if (alive(token) && current.revision === story.revision && current.active_branch_id === story.active_branch_id && data.story.revision === story.revision) renderStory({ ...data.story, beats: [...data.story.beats, ...story.beats] });
    } catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { earlierBusy = false; controls(); } }
  });
  $('fictionTextSize').addEventListener('change', () => {
    const size = $('fictionTextSize').value;
    document.documentElement.style.setProperty('--fiction-reading-size', `${size}px`);
    try { localStorage.setItem('im-fiction-text-size', size); } catch { /* optional preference */ }
  });
  try { const size = localStorage.getItem('im-fiction-text-size'); if (['18', '21', '24'].includes(size)) { $('fictionTextSize').value = size; document.documentElement.style.setProperty('--fiction-reading-size', `${size}px`); } } catch { /* blocked storage */ }
  window.addEventListener('hashchange', route);
  return { start: () => { unlocked = true; return route(); }, lock: clearPrivate, dispose: () => { clearPrivate(); window.removeEventListener('hashchange', route); }, route, send, renderStory, getCurrent: () => current, addCast, setScenario: (value) => { scenario = value; } };
}
