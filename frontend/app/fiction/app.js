import { el, button, field, option } from './dom.js';
import { createStoryDialogs } from './story-dialogs.js';
import { createMediaDialogs } from './media.js';
import { createSaveDialogs } from './saves.js';
import { createInfluence } from './influence.js';
import { qualityPaidReview, renderQuality } from './quality.js';
import { createVisualLibrary, storyImage } from './library.js';
import { createFictionWorkspace } from './workspace-shell.js';
import { createInspection } from './inspection.js';
import { createPrivateDraft } from './private-drafts.js';
import { parseWorkspace, workspaceUrl, getBookmark } from './workspace-state.js';

const SCREEN_IDS = ['shelfScreen', 'startScreen', 'readerScreen', 'settingsScreen', 'catalogScreen'];

export function createFictionApp({ api, dialogs, providerPanel = null }) {
  const $ = (id) => document.getElementById(id);
  let unlocked = false; let epoch = 0; let current = null; let busy = false; let poll = null; let earlierBusy = false;
  const drafts = new Map();
  const scopes = new Map(); let shelfOffset = 0; let nextShelfOffset = null;
  const castRows = [];
  let scenario = null;
  let shownBeatId = null;
  let progressTimer = null; let progressSerial = 0;
  let actionFeedback = ''; let actionError = false;
  let workspace = null; let inspection = null;
  const durableDrafts = new Map(); let activeDurable = null; let setupDraft = null;
  let bookmarkRestoring = false;
  let roomEpoch = 0;
  const draftKey = (story = current, kind = $('fictionInputKind').value) => story ? `${story.id}:${story.active_branch_id}:${story.head_beat_id || "initial"}:${kind}` : '';
  let selectedDraftKind = 'steer'; let draftRevision = 0;
  function saveDraft() { if (current) { drafts.set(draftKey(current, selectedDraftKind), $('fictionDirection').value); scopes.set(draftKey(current, selectedDraftKind), $('fictionDirectionScope').value); if(activeDurable)activeDurable.edit({text:$('fictionDirection').value,direction_scope:$('fictionDirectionScope').value}); } }
  function selectDraft(kind) {
    saveDraft(); selectedDraftKind = kind;
    $('fictionDirection').value = drafts.get(draftKey(current, kind)) || '';
    $('fictionDirectionScope').value = scopes.get(draftKey(current, kind)) || 'moment';
    $('workspaceScope').hidden = kind !== 'steer';
    openContributionDraft();
  }
  function draftPanel(state) {
    let root=$('contributionDraftState');
    if(!root){root=el('section','','workspace-draft-state');root.id='contributionDraftState';$('fictionComposer').append(root);}
    root.replaceChildren();if(!state)return;
    const message=el('p',state.message);message.setAttribute('role','status');root.append(message);
    root.append(button('Save draft now',()=>activeDurable.flush().catch(error=>{message.textContent=error.message;})),button('Discard this draft…',()=>dialogs.openDialog({title:'Discard this private draft?',body:'This removes the saved draft and its local text. Story history is unchanged.',actions:[{label:'Keep draft',className:'btn-secondary',onClick:close=>close(true)},{label:'Discard draft',className:'btn-primary',onClick:async close=>{await activeDurable.discard();$('fictionDirection').value='';drafts.delete(draftKey());activeDurable=null;openContributionDraft();close(true);}}]})));
    root.append(button('Copy private draft',async()=>{try{await navigator.clipboard.writeText(state.local.text||'');message.textContent='Copied. Keep it somewhere private.';}catch{const text=field('Select and copy your draft','textarea',state.local.text||'',{readOnly:true});root.append(text.wrapper);text.control.select();}}));
    if(state.conflict){
      root.append(field('Your local version','textarea',state.local.text||'',{readOnly:true}).wrapper,field('Saved server version','textarea',state.conflict.content.text||'',{readOnly:true}).wrapper);
      for(const [label,useServer] of [['Use server version',true],['Keep my compared version',false]])root.append(button(label,()=>{const value=activeDurable.resolve(useServer);if(value){$('fictionDirection').value=value.text||'';$('fictionDirectionScope').value=value.direction_scope||'moment';draftRevision++;}}));
    }
    if(current && state.scope.head_id!==current.head_beat_id)root.append(button('Use this draft at the latest moment',()=>{const value={...state.local};activeDurable=null;openContributionDraft();$('fictionDirection').value=value.text||'';$('fictionDirectionScope').value=value.direction_scope||'moment';draftRevision++;saveDraft();}));
    if(state.row?.submitted)root.append(button('Review previous submission',()=>reviewSubmission(activeDurable)));
    root.append(button('Recover an earlier draft…',recoverContribution));
  }
  function openContributionDraft() {
    if(!current)return;
    if(activeDurable?.state?.dirty && activeDurable.state.scope.game_id===current.id && activeDurable.state.scope.head_id!==current.head_beat_id && $('fictionDirection').value){draftPanel(activeDurable.state);return;}
    const key=draftKey();let controller=durableDrafts.get(key);
    if(!controller?.state){
      controller=createPrivateDraft({api,onChange:state=>{if(activeDurable===controller)draftPanel(state);}});durableDrafts.set(key,controller);
      activeDurable=controller;
      const target={type:'contribution',game_id:current.id,branch_id:current.active_branch_id,head_id:current.head_beat_id,kind:$('fictionInputKind').value};
      const revision=draftRevision;
      controller.open(target,{text:$('fictionDirection').value,direction_scope:$('fictionDirectionScope').value}).then(value=>{if(activeDurable===controller&&value&&draftRevision===revision){$('fictionDirection').value=value.text||'';$('fictionDirectionScope').value=value.direction_scope||'moment';drafts.set(key,value.text||'');}});
    }else{activeDurable=controller;draftPanel(controller.state);}
  }
  async function recoverContribution() {
    const story=current;const token=epoch;const body=el('div','Opening private draft list…');
    dialogs.openDialog({title:'Recover a private contribution',body:[body],actions:[{label:'Close',className:'btn-secondary',onClick:close=>close(true)}]});
    try{const data=await api(`/fiction/drafts?type=contribution&game_id=${story.id}`);if(!alive(token))return;body.replaceChildren(el('p','Older drafts retain their original destination. Choosing one copies it into a draft for the active path at its latest moment; nothing is sent.'));
      for(const item of data.drafts){const path=story.branches.find(path=>path.id===item.scope.branch_id);body.append(button(`${item.scope.kind} · ${path?.name||'Saved path'} · ${item.scope.head_id===story.head_beat_id?'latest moment':'earlier moment'}`,async()=>{try{const {draft}=await api(`/fiction/drafts/${item.id}`);if(!alive(token)||current.id!==story.id)return;if(draft.submitted){body.append(el('p','This draft has a previous submission. Review it before reusing its text.'));await reviewSubmission(null,draft);return;}if(item.scope.kind==='follow'){body.append(el('p','Continue has no direction text to recover.'));return;}workspace.contribution(item.scope.kind);$('fictionDirection').value=draft.content.text||'';$('fictionDirectionScope').value=draft.content.direction_scope||'moment';draftRevision++;saveDraft();dialogs.close(true);}catch(error){body.append(el('p',error.message));}}));}
    }catch(error){if(alive(token))body.textContent=error.message;}
  }
  async function reviewSubmission(controller, supplied=null) {
    const row=supplied||controller?.state?.row;if(!row?.submitted)return;
    const token=epoch;const submitted=row.submitted;const body=el('div','Checking the durable request record…');
    const actions=[{label:'Close',className:'btn-secondary',onClick:close=>close(true)}];
    dialogs.openDialog({title:'Review previous submission',body:[body],actions});
    try{const result=await api(`/fiction/actions/${encodeURIComponent(submitted.action_key)}?game_id=${row.scope.game_id}`);if(!alive(token))return;
      body.replaceChildren(el('p',`Previous request: ${result.status}. No AI request has been sent by this check.`));
      if(result.status==='pending')body.append(el('p','Wait for the current request to finish, then check again.'));
      else if(result.can_start_new){body.append(button('Acknowledge result and allow a new reviewed action',async()=>{if(controller)await controller.clearSubmission();else await api(`/fiction/drafts/${row.id}`,'PATCH',{expected_revision:row.revision,clear_submission:true});if(alive(token)){body.replaceChildren(el('p','Previous result acknowledged. Review the current story and direction before sending again.'));}}));}
      else body.append(button('Cancel this action if it has not been dispatched',async()=>{try{const status=await api(`/fiction/actions/${encodeURIComponent(submitted.action_key)}/cancel`,'POST',{game_id:row.scope.game_id});if(alive(token))body.append(el('p',`Request is now ${status.status}. Check again before preparing another action.`));}catch(error){if(alive(token))body.append(el('p',error.message));}}));
    }catch(error){if(alive(token))body.textContent=error.message;}
  }
  const stopProgress = () => { progressSerial++; clearTimeout(progressTimer); progressTimer = null; };
  const alive = (token) => unlocked && epoch === token;
  function actionStatus() {
    $('fictionActionStatus').textContent = actionFeedback || (busy ? 'Your action is being handled.' : current?.pending ? 'A response is in progress. You can leave and return.' : '');
    $('fictionActionStatus').dataset.error = String(actionError);
  }
  const status = (message = '', error = false) => {
    $('fictionStatus').textContent = message; $('fictionStatus').dataset.error = String(error);
    // Keep outcomes at the point of action, not only above a long manuscript.
    // Reconciliation and enabling the controls must not erase the explanation.
    actionFeedback = current ? message : ''; actionError = Boolean(current && error); actionStatus();
  };
  function syncFourthWallStart() {
    const hidden = $('fictionStartStyle').value !== 'living-world';
    $('fictionFourthWallField').hidden = hidden; $('fictionFourthWall').disabled = hidden;
  }

  function showScreen(id) {
    if ($(id).hidden) window.scrollTo(0, 0);
    for (const screen of SCREEN_IDS) $(screen).hidden = screen !== id;
    for (const [link, active] of [['shelfLink', id === 'shelfScreen'], ['preferencesLink', id === 'settingsScreen'], ['catalogLink', id === 'catalogScreen']]) {
      if (active) $(link).setAttribute('aria-current', 'page'); else $(link).removeAttribute('aria-current');
    }
  }

  function controls() {
    const blocked = busy || bookmarkRestoring || !current || current.pending;
    for (const id of ['fictionContinue', 'fictionSend', 'fictionInputKind', 'fictionBranch', 'fictionFork', 'fictionRewind', 'fictionCorrect', 'releaseFictionControl', 'fictionEndEpisode', 'fictionNextEpisode', 'fictionPreferences', 'fictionAddCast', 'fictionRetire', 'fictionIllustrate', 'fictionExportBook']) $(id).disabled = blocked;
    $('fictionEarlier').disabled = Boolean(!current || earlierBusy || bookmarkRestoring);
    $('fictionDownloadSave').disabled = Boolean(blocked);
    $('fictionCoverEdit').disabled = Boolean(blocked);
    for (const node of $('fictionReferences').querySelectorAll('button')) node.disabled = blocked;
    $('fictionContinue').textContent = busy ? 'Working…' : current?.pending ? 'Story unfolding…' : 'Continue';
    actionStatus();
    $('fictionComposer').setAttribute('aria-busy', String(Boolean(blocked && current)));
    for (const node of $('fictionCast').querySelectorAll('button')) node.disabled = blocked;
    influence.controls(blocked);
    for (const id of ['workspaceSteer', 'workspaceAsk']) $(id).disabled = Boolean(blocked || current?.state.episode.status !== 'active');
    for (const node of document.querySelectorAll('[data-workspace-mutation]')) node.disabled = blocked;
    pageControls();
  }

  const readingPages = (beats = current?.beats || []) => beats.filter((beat) => ['opening', 'scene'].includes(beat.kind));
  function pageControls() {
    const beats = readingPages();
    const index = beats.findIndex((beat) => beat.id === shownBeatId);
    const blocked = earlierBusy || !current || bookmarkRestoring;
    $('fictionPreviousPage').disabled = blocked || (index <= 0 && !current?.has_earlier);
    $('fictionNextPage').disabled = blocked || index < 0 || index === beats.length - 1;
    $('fictionLatestPage').disabled = blocked || index < 0 || (index === beats.length - 1 && !current?.windowPast);
    $('fictionPageLabel').textContent = index < 0 ? 'No pages yet' : `Page ${index + 1} of ${beats.length}${current.has_earlier ? ' loaded' : ''}`;
    const historical = index >= 0 && (index !== beats.length - 1 || current?.windowPast);
    $('fictionPageContext').hidden = !historical;
    const branch = current?.branches.find(item => item.id === current.active_branch_id);
    if (!busy && !current?.pending) $('fictionContinue').textContent = historical ? `Continue latest on ${branch?.name || 'this path'}` : 'Continue';
  }

  function showPage(index, scroll = true) {
    const pages = readingPages();
    if (!pages[index]) return;
    workspace?.position();
    shownBeatId = pages[index].id;
    renderProse([pages[index]]); pageControls();
    if (current) workspace?.render(current);
    $('workspaceNewPassage').hidden = true;
    if (scroll) {
      $('workspaceReader').scrollTop = 0;
      $('fictionProse').focus({ preventScroll: true });
    }
    workspace?.position();
  }

  function renderShelf(stories, nextOffset = null) {
    nextShelfOffset = nextOffset;
    $('fictionShelfPrevious').hidden = shelfOffset === 0; $('fictionShelfNext').hidden = nextOffset === null;
    $('fictionShelfPrevious').disabled = false; $('fictionShelfNext').disabled = false;
    const root = $('fictionShelf'); root.replaceChildren();
    if (!stories.length) root.append(el('p', 'Your next story starts here. Follow and steer without playing a character.', 'fiction-empty'));
    for (const story of stories) {
      const card = el('article', '', 'fiction-card');
      if (story.cover) card.append(storyImage(story.id, story.cover, 'fiction-shelf-cover'));
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
          img.width = 640; img.height = 480;
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

  function renderStory(story, { forceLatest = false } = {}) {
    const beforeCursor = shownBeatId; const beforePosition = workspace?.position();
    const samePath = current?.id === story.id && current.active_branch_id === story.active_branch_id;
    if (current && !samePath) saveDraft();
    const latestChanged = samePath && readingPages().at(-1)?.id !== readingPages(story.beats).at(-1)?.id;
    if (samePath && !forceLatest && shownBeatId && !story.beats.some(beat => beat.id === shownBeatId)) story = { ...story, beats: current.beats, has_earlier: current.has_earlier, windowPast: true };
    const pages = readingPages(story.beats);
    if (forceLatest || !samePath || !pages.some((beat) => beat.id === shownBeatId)) shownBeatId = pages.at(-1)?.id || null;
    if (latestChanged && !forceLatest) $('workspaceNewPassage').hidden = false;
    if (forceLatest) $('workspaceNewPassage').hidden = true;
    current = story;
    $('fictionStoryTitle').textContent = story.title;
    const visuals = story.state.visuals || [];
    $('fictionCover').replaceChildren();
    const cover = visuals.find((item) => item.kind === 'cover');
    if (cover) $('fictionCover').append(storyImage(story.id, cover, 'fiction-reader-cover'));
    $('fictionReferences').replaceChildren();
    for (const kind of ['world', 'scribe']) {
      const reference = story.state.library?.[kind]; if (!reference) continue;
      const card = el('article', '', 'fiction-detail-card'); const visual = visuals.find((item) => item.kind === kind);
      if (visual) card.append(storyImage(story.id, visual));
      card.append(el('h3', `${kind === 'scribe' ? 'Scribe' : 'World'}: ${reference.name}`), el('p', reference.description), button('Image: upload or paint', () => mediaDialogs.illustrate({ kind })));
      $('fictionReferences').append(card);
    }
    if (!$('fictionReferences').children.length) $('fictionReferences').append(el('p', 'No catalogue world or Scribe was selected at setup. This story still has its own situation and narration preferences.'));
    $('fictionEpisode').textContent = `Episode ${story.state.episode.number} · ${story.state.episode.title}`;
    const owned = story.state.cast.find((character) => character.id === story.state.control.character_id);
    $('fictionControl').textContent = owned ? `You control ${owned.name}. Their decisions and speech remain yours.` : 'You are the reader-director. The narrator runs the cast.';
    const spend = story.spend;
    $('fictionSpend').textContent = spend ? `Known provider spend: $${spend.known_usd.toFixed(4)}${spend.unknown_attempts ? ` · ${spend.unknown_attempts} attempt(s) have unknown cost` : ''}` : '';
    $('fictionCast').replaceChildren();
    for (const character of story.state.cast) {
      const card = el('div', '', 'fiction-detail-card');
      const portrait = visuals.find((item) => item.kind === 'character' && item.subject_id === character.id);
      if (portrait) card.append(storyImage(story.id, portrait));
      card.append(el('h3', character.name), el('p', character.description));
      if (owned?.id !== character.id) card.append(button(`Inhabit ${character.name}`, () => confirmControl(character)));
      card.append(button(`Portrait for ${character.name}`, () => mediaDialogs.illustrate({ kind: 'character', subject_id: character.id })));
      $('fictionCast').append(card);
    }
    if (!story.state.cast.length) $('fictionCast').append(el('p', 'No cast members were supplied at the opening. You can still follow and steer.'));
    $('releaseFictionControl').hidden = !owned;
    const previousKind = $('fictionInputKind').value;
    $('fictionInputKind').replaceChildren(option('steer', 'Steer the story'), option('ask', 'Ask outside the story'));
    if (owned) $('fictionInputKind').append(option('act', `Act as ${owned.name}`), option('say', `Speak as ${owned.name}`));
    if ([...$('fictionInputKind').options].some((item) => item.value === previousKind)) $('fictionInputKind').value = previousKind;
    if (!samePath || $('fictionInputKind').value !== selectedDraftKind) {
      selectedDraftKind = $('fictionInputKind').value;
      $('fictionDirection').value = drafts.get(draftKey(story, selectedDraftKind)) || '';
      $('fictionDirectionScope').value = scopes.get(draftKey(story, selectedDraftKind)) || 'moment';
    }
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
    const phases = { opening: 'Opening', developing: 'Developing', payoff: 'A recorded payoff', aftermath: 'Room for aftermath' };
    $('fictionEpisodeFocus').textContent = `${story.state.episode.question || 'Follow what matters to the cast.'} ${phases[story.state.episode.phase] || ''} — you can linger, redirect or end the episode when ready.`;
    renderProse(story.beats.filter((beat) => beat.id === shownBeatId));
    renderQuality(story);
    influence.render(story);
    $('fictionEarlier').hidden = !story.has_earlier;
    const ended = story.state.episode.status === 'ended';
    $('fictionComposer').hidden = ended; $('fictionEnded').hidden = !ended; $('fictionEndEpisode').hidden = ended;
    $('fictionContinue').hidden = ended; $('workspaceContributionActions').hidden = ended;
    $('fictionEpisodeSummary').textContent = story.state.episode.summary || 'This episode has reached its resting point.';
    workspace?.render(story); controls();
    if (!forceLatest && samePath && beforeCursor === shownBeatId && beforePosition) workspace.restore(beforePosition);
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

  async function restoreReadingPosition(token) {
    const story = current; const bookmark = story && getBookmark(story.id, story.active_branch_id);
    const restoreCursor = shownBeatId;
    if (!bookmark) return;
    bookmarkRestoring = true; controls();
    try {
      if (!story.beats.some(beat => beat.id === bookmark.beatId)) {
        const [window, evidence] = await Promise.all([api(`/fiction/${story.id}?before=${encodeURIComponent(bookmark.beatId)}`), api(`/fiction/${story.id}/evidence/${encodeURIComponent(bookmark.beatId)}`)]);
        if (!alive(token)) return;
        if (current?.revision !== story.revision || current?.active_branch_id !== story.active_branch_id || shownBeatId !== restoreCursor) return;
        if (window.story.revision !== story.revision || window.story.active_branch_id !== story.active_branch_id || evidence.beat.id !== bookmark.beatId || !['opening', 'scene', 'clarification'].includes(evidence.beat.kind)) throw new Error('Saved reading context changed.');
        renderStory({ ...window.story, beats: [...window.story.beats, evidence.beat], windowPast: true }, { forceLatest: true });
      }
      if (!alive(token)) return;
      shownBeatId = bookmark.beatId;
      renderProse(current.beats.filter(beat => beat.id === shownBeatId));
      workspace.render(current); workspace.restore(bookmark);
    } catch {
      if (alive(token)) status('Your saved reading position is unavailable. Showing the latest loaded passage; your story is unchanged.');
    } finally { if (alive(token)) { bookmarkRestoring = false; controls(); } }
  }

  async function route(options = {}) {
    if (!unlocked) return;
    const hash = window.location.hash || '#/stories';
    const destination = parseWorkspace(hash);
    if (destination && current?.id === destination.storyId && options.refresh !== true) {
      workspace.position();
      if (!destination.task) { if (dialogs.cancel) dialogs.cancel(); else dialogs.close(true); workspace.hideTask(); }
      document.body.classList.add('fiction-in-workspace');
      const changed = workspace.room !== destination.room;
      if (changed) roomEpoch++;
      workspace.showRoom(destination.room, changed);
      inspection.render(destination.room);
      workspace.position();
      if (destination.task && !workspace.taskOpen) workspace.contribution(destination.task, true);
      return;
    }
    saveDraft(); inspection.leave(); workspace.leave();
    const token = ++epoch; clearTimeout(poll); stopProgress(); busy = false; earlierBusy = false; bookmarkRestoring = false; current = null; shownBeatId = null;
    if (dialogs.cancel) dialogs.cancel(); else dialogs.close(true); status();
    $('startFiction').disabled = false; $('startFiction').textContent = 'Begin this story';
    $('fictionEarlier').disabled = false;
    try {
      if (hash === '#/new') {
        showScreen('startScreen'); await library.loadSetup(() => alive(token)); if(alive(token))await openSetupDraft(token);
        try { const data = await api('/fiction/scenarios'); if (alive(token)) renderScenarios(data.scenarios || []); }
        catch { if (alive(token)) $('scenarioChoices').textContent = 'Authored openings are unavailable. You can still create your own situation below.'; }
        return;
      }
      const catalogue = /^#\/catalog\/(world|character|scribe)$/.exec(hash);
      if (catalogue) { showScreen('catalogScreen'); await library.render(catalogue[1], () => alive(token)); return; }
      if (hash === '#/settings') { showScreen('settingsScreen'); await providerPanel?.render(() => alive(token)); return; }
      if (destination) {
        showScreen('readerScreen'); document.body.classList.add('fiction-in-workspace');
        workspace.clear(); document.body.classList.add('fiction-in-workspace'); workspace.showRoom(destination.room);
        $('fictionProse').replaceChildren(); $('fictionStoryTitle').textContent = 'Opening your story…';
        for (const id of ['fictionCast', 'fictionFacts', 'fictionControl', 'fictionEpisode', 'fictionSpend', 'fictionPlayStyle', 'fictionFocusText', 'fictionChallenges', 'fictionInvitations', 'fictionEpisodeFocus', 'fictionQualityState', 'fictionCalls', 'fictionCover', 'fictionReferences']) $(id).replaceChildren();
        controls();
        const data = await api(`/fiction/${destination.storyId}`);
        if (!alive(token)) return;
        renderStory(data.story);
        selectedDraftKind = [...$('fictionInputKind').options].some(option => option.value === selectedDraftKind) ? selectedDraftKind : 'steer';
        $('fictionInputKind').value = selectedDraftKind;
        $('fictionDirection').value = drafts.get(draftKey()) || ''; $('fictionDirectionScope').value = scopes.get(draftKey()) || 'moment';
        await restoreReadingPosition(token);
        if (!alive(token)) return;
        workspace.showRoom(destination.room);
        inspection.render(destination.room);
        openContributionDraft();
        if (destination.task) workspace.contribution(destination.task, true);
        controls();
      } else {
        showScreen('shelfScreen'); $('fictionShelf').textContent = 'Opening your stories…';
        const data = await api(shelfOffset ? `/fiction?offset=${shelfOffset}` : '/fiction'); if (alive(token)) renderShelf(data.stories, data.next_offset ?? null);
      }
    } catch (error) { if (alive(token)) { status(error.message, true); controls(); } }
  }

  async function localAction(path, method, payload = {}) {
    if (busy || bookmarkRestoring || !current || current.pending) return;
    const token = epoch; const story = current;
    busy = true; controls(); status();
    try {
      const data = await api(`/fiction/${story.id}/${path}`, method, { ...payload, expected_revision: story.revision, target_branch_id:story.active_branch_id, expected_head_beat_id:story.head_beat_id });
      if (alive(token)) { renderStory(data.story); inspection.render(workspace.room); openContributionDraft(); if (path === 'branch' || path === 'branches') await restoreReadingPosition(token); if (alive(token) && !actionFeedback) status('Saved.'); return { ok: true }; }
    } catch (error) { if (alive(token)) status(`${error.message} Your current path is preserved.`, true); return { ok: false, error: error.message }; }
    finally { if (alive(token)) { busy = false; controls(); } }
  }

  async function send(kind, approach = null) {
    if (busy || bookmarkRestoring || !current || current.pending || current.state.episode.status !== 'active') return;
    const story = current; const token = epoch;
    const submittedKey = draftKey(story, kind); const submittedDraftRevision = draftRevision; const submittedCursor = shownBeatId;
    const atTail = !story.windowPast && readingPages().at(-1)?.id === shownBeatId;
    const direction = approach?.text || (kind === 'follow' ? '' : $('fictionDirection').value.trim());
    if (kind !== 'follow' && !direction) { $('fictionDirection').focus(); status('Add a direction or use Continue.'); return; }
    busy = true; controls(); status();
    const operation = ++progressSerial;
    try {
      const input = { kind, text: direction, ...(kind === 'steer' ? { direction_scope: approach ? 'moment' : $('fictionDirectionScope').value } : {}), ...(approach ? { challenge_id: approach.challenge_id, approach_id: approach.approach_id } : {}) };
      let free = false;
      if (approach) {
        const data = await api(`/fiction/${story.id}/challenge-review`, 'POST', { expected_revision: story.revision, input });
        if (!alive(token)) return;
        free = data.review.requires_generation === false;
      }
      const quality = (story.state.quality_mode || 'off') !== 'off';
      if (!free && quality && (!story.quality_generation?.available || story.quality_generation.mode !== story.state.quality_mode)) { status('The selected quality roles are unavailable. Configure them in Settings and refresh this story before continuing.', true); return; }
      const approved = free || await dialogs.confirmPaid(qualityPaidReview(story) || {
        title: 'Let the story unfold?',
        body: 'This sends the premise, selected cast, frozen world/Scribe/character references, boundaries, relevant facts (including hidden world truth), recent story text and your direction to your selected text provider. One completion is requested; cost depends on your provider and model. Invalid replies can still incur a charge. No automatic paid follow-up is started.',
        review: { action: `Continue latest moment on ${story.branches.find(branch => branch.id === story.active_branch_id)?.name || 'the active path'}`, object: story.title, model: story.generation?.provider ? `Storyteller (Scribe) · ${story.generation.provider.display_name} · ${story.generation.model_id}` : 'Your selected storyteller', quantity: 'One bounded narrative response', sends: 'Recent story, relevant facts (including hidden world truth), cast, boundaries and your direction', estimate: 0.02, note: 'A rough text-call estimate, not a spending cap. No automatic paid follow-up.' },
        confirmLabel: 'Continue with AI',
      });
      if (!approved || !alive(token)) return;
      if (quality && !free) {
        const updateProgress = async () => {
          if (!alive(token) || progressSerial !== operation || !busy) return;
          try {
            const data = await api(`/fiction/${story.id}`);
            if (!alive(token) || progressSerial !== operation || !busy) return;
            const step = data.story.pending_stage;
            if (step) $('fictionActionStatus').textContent = `${step.purpose === 'review' ? 'Checking consistency' : step.purpose === 'repair' ? 'Repairing the draft' : 'Writing the draft'} · ${step.role === 'archivist' ? 'memory support' : 'standard model'} · call ${step.call_index} of at most ${data.story.call_limit}.`;
            if (!data.story.pending) return;
          } catch { /* progress reads never retry a paid operation */ }
          if (alive(token) && progressSerial === operation && busy) progressTimer = setTimeout(updateProgress, 1500);
        };
        progressTimer = setTimeout(updateProgress, 1500);
      }
      if(draftRevision!==submittedDraftRevision)throw Error('Your direction changed during review. Review it again before sending.');
      openContributionDraft();if(kind!=='follow'&&activeDurable?.state?.scope.head_id!==story.head_beat_id)throw Error('This draft belongs to an earlier moment. Choose Use this draft at the latest moment, then review it.'); let submittedController=activeDurable;
      if(kind==='follow'||approach){const key=draftKey(story,kind==='follow'?'follow':'approach');submittedController=durableDrafts.get(key);if(!submittedController?.state){submittedController=createPrivateDraft({api});durableDrafts.set(key,submittedController);await submittedController.open({type:'contribution',game_id:story.id,branch_id:story.active_branch_id,head_id:story.head_beat_id,kind:kind==='follow'?'follow':kind},{text:direction});}}
      submittedController.edit({text:kind==='follow'?'':direction,direction_scope:$('fictionDirectionScope').value});
      const prepared=await submittedController.submit({game_id:story.id,branch_id:story.active_branch_id,head_beat_id:story.head_beat_id,revision:story.revision});
      if(!alive(token))return;
      const data = await api(`/fiction/${story.id}/replies`, 'POST', {
        expected_revision: story.revision, target_branch_id:story.active_branch_id,expected_head_beat_id:story.head_beat_id,idempotency_key: prepared.actionKey, input,
        ...(story.generation?.provider ? { provider_id: story.generation.provider.id, model: story.generation.model_id } : {}),
        ...(quality ? { quality_review: story.quality_generation?.review_id } : {}),
      });
      if (!alive(token)) return;
      if (!approach && kind !== 'follow' && draftRevision === submittedDraftRevision && $('fictionDirection').value.trim() === direction) { $('fictionDirection').value = ''; drafts.delete(submittedKey); $('fictionDirectionScope').value = 'moment'; scopes.delete(submittedKey); }
      if(submittedController.state && !submittedController.state.dirty){try{await submittedController.discard();}catch{status('Story saved; draft cleanup needs review.');}}
      renderStory(data.story, { forceLatest: atTail && submittedCursor === shownBeatId && workspace.room === 'desk' }); workspace.hideTask(); openContributionDraft(); inspection.render(workspace.room); status(data.repeated_adjudication ? 'The recorded ruling still applies. No AI request or charge.' : 'Story saved.');
      if (atTail && workspace.room === 'desk') $('workspaceReader').scrollTop = 0;
      if (new URLSearchParams(location.hash.split('?')[1] || '').has('task')) history.replaceState(null, '', workspaceUrl(story.id, workspace.room));
      workspace.position();
    } catch (error) {
      if (!alive(token)) return;
      stopProgress();
      status(`${error.message}${error.billedAttempts ? ' The provider may have charged for this attempt.' : ''} Your direction is still here.`, true);
      // A lost response is reconciled by a free read, never by re-sending a
      // paid action or inventing a replacement generation.
      try { const data = await api(`/fiction/${story.id}`); if (alive(token)) renderStory(data.story); } catch { /* keep the visible error and draft */ }
      // On narrow screens the manuscript can be taller than the viewport.
      // Reconciliation must leave the actionable failure beside Continue in
      // view instead of returning the reader to the prose above it.
      workspace.hideTask();
      if (new URLSearchParams(location.hash.split('?')[1] || '').has('task')) history.replaceState(null, '', workspaceUrl(story.id, workspace.room));
    } finally { if (progressSerial === operation) stopProgress(); if (alive(token)) { busy = false; controls(); } }
  }

  async function runMediaAction(work) {
    if (busy || !current || current.pending) return { ok: false, error: 'Another action is in progress.' };
    const token = epoch; const roomToken = roomEpoch; const story = current; busy = true; controls(); status();
    try {
      const data = await work(() => alive(token) && roomEpoch === roomToken);
      if (!alive(token)) return { ok: false, stale: true };
      if (!data) return { ok: false, cancelled: true, stale: roomEpoch !== roomToken };
      if (data.story) renderStory(data.story);
      status('Done.'); return roomEpoch === roomToken ? { ok: true } : { ok: false, stale: true };
    } catch (error) {
      if (!alive(token)) return { ok: false, stale: true };
      const message = `${error.message}${error.billedAttempts ? ' The provider may have charged for this attempt.' : ''}`;
      status(message, true);
      try { const data = await api(`/fiction/${story.id}`); if (alive(token)) renderStory(data.story); } catch { /* free reconciliation only */ }
      return roomEpoch === roomToken ? { ok: false, error: message } : { ok: false, stale: true };
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
    const error = el('p'); error.setAttribute('role', 'alert');
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: rewind ? 'Rewind a choice' : 'Explore an alternative', body: [note, select.wrapper, name.wrapper, error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Create this path', className: 'btn-primary', pendingLabel: 'Creating path…', onClick: async (close) => {
        if (!name.control.value.trim()) { name.control.focus(); return; }
        if (current?.id !== id || current.revision !== revision) { error.textContent = 'The story changed. Refresh before creating this path.'; return; }
        const result = await localAction('branches', 'POST', { beat_id: select.control.value || null, name: name.control.value.trim() });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved. Your path name and selected moment are still here.';
      } },
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
    const question = start ? field('What question might this episode explore? (optional)', 'input', '', { maxLength: 500 }) : null;
    const error = el('p'); error.setAttribute('role', 'alert');
    const id = current.id; const revision = current.revision;
    dialogs.openDialog({ title: start ? 'Begin another episode' : 'End this episode', body: [el('p', start ? 'Your cast, history and commitments continue with you. A question gives focus, not a fixed plot or a requirement to finish.' : 'Mark a resting point. Nothing changes while you are away, and you can begin another episode whenever you want.'), entry.wrapper, ...(question ? [question.wrapper] : []), error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: start ? 'Begin episode' : 'End episode', className: 'btn-primary', pendingLabel: 'Saving episode…', onClick: async (close) => {
        if (start && !entry.control.value.trim()) { entry.control.focus(); return; }
        if (current?.id !== id || current.revision !== revision) { error.textContent = 'The story changed. Refresh before saving this episode.'; return; }
        const result = await localAction('episodes', 'POST', start ? { action: 'start', title: entry.control.value.trim(), question: question.control.value.trim() } : { action: 'end', summary: entry.control.value.trim() });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved. Your episode details are still here.';
      } },
    ] });
  }

  function addCast(character = {}) {
    if (castRows.length >= 24) { status('A story can begin with up to 24 cast members.'); return; }
    const card = el('div', '', 'fiction-cast-draft');
    const name = field('Character name', 'input', character.name || '', { maxLength: 200 });
    const description = field('Who are they?', 'textarea', character.description || '', { maxLength: 2000, rows: 2 });
    const motive = field('What do they want?', 'input', character.motive || character.personality || '', { maxLength: 1000 });
    const row = { id: character.id || globalThis.crypto.randomUUID(), name, description, motive, card };
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
      scenario = null; $('fictionStartForm').reset(); library.resetSetup(); syncFourthWallStart(); castRows.length = 0; $('fictionCastDraft').replaceChildren(); $('scenarioNote').textContent = 'Your own situation: no preset cast or hidden world facts.';
    }));
  }

  function setupValue() {
    const cast=castRows.map(row=>({id:row.id,name:row.name.control.value.trim(),description:row.description.control.value.trim(),motive:row.motive.control.value.trim()}));
    const value={title:$('fictionTitle').value.trim(),premise:$('fictionPremise').value.trim(),genre:$('fictionGenre').value,play_style:$('fictionStartStyle').value,fourth_wall:$('fictionFourthWall').value,cast,pacing:$('fictionPacing').value,consequences:$('fictionConsequences').value,boundaries:$('fictionBoundaries').value.trim(),voice:$('fictionVoice').value.trim(),...(scenario?{scenario_id:scenario.id}:{})};
    const selection=library.selection();if(selection)value.library=selection;return value;
  }
  async function restoreSetup(value,token) {
    if(!value||!alive(token))return;
    for(const [key,id] of Object.entries({title:'fictionTitle',premise:'fictionPremise',genre:'fictionGenre',play_style:'fictionStartStyle',fourth_wall:'fictionFourthWall',pacing:'fictionPacing',consequences:'fictionConsequences',boundaries:'fictionBoundaries',voice:'fictionVoice'}))if(value[key]!==undefined)$(id).value=value[key];
    castRows.length=0;$('fictionCastDraft').replaceChildren();for(const person of value.cast||[])addCast(person);
    scenario=value.scenario_id?{id:value.scenario_id}:null;syncFourthWallStart();await library.restoreSelection(value.library,()=>alive(token));
  }
  async function openSetupDraft(token) {
    if(!setupDraft)setupDraft=createPrivateDraft({api,onChange:state=>{
      let root=$('setupDraftState');if(!root){root=el('section','','workspace-draft-state');root.id='setupDraftState';$('fictionStartForm').append(root);}root.replaceChildren();if(!state)return;
      if(state.creation){root.append(el('p','A story was created from this setup.'),button('Open the created story',()=>{const id=state.creation.result_id;setupDraft.acknowledgeCreation().catch(()=>{});location.hash=`#/story/${id}`;}),button('Acknowledge and begin another setup',()=>setupDraft.acknowledgeCreation()));}
      root.append(el('p',state.message),button('Save setup draft now',()=>setupDraft.flush().catch(error=>status(error.message,true))),button('Discard setup draft…',()=>dialogs.openDialog({title:'Discard this setup draft?',body:'The saved setup and unsaved fields will be removed.',actions:[{label:'Keep draft',className:'btn-secondary',onClick:close=>close(true)},{label:'Discard draft',className:'btn-primary',onClick:async close=>{await setupDraft.discard();setupDraft=null;$('fictionStartForm').reset();library.resetSetup();castRows.length=0;$('fictionCastDraft').replaceChildren();scenario=null;close(true);await openSetupDraft(epoch);}}]})));
      root.append(button('Copy setup draft',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(state.local,null,2));}catch{root.append(field('Select and copy private setup','textarea',JSON.stringify(state.local,null,2),{readOnly:true}).wrapper);}}));
      if(state.conflict){root.append(field('Local setup','textarea',JSON.stringify(state.local,null,2),{readOnly:true}).wrapper,field('Saved setup','textarea',JSON.stringify(state.conflict.content,null,2),{readOnly:true}).wrapper);for(const [label,server]of [['Use server setup',true],['Keep compared local setup',false]])root.append(button(label,()=>restoreSetup(setupDraft.resolve(server),epoch)));}
    }});
    if(!setupDraft.state){const value=await setupDraft.open({type:'setup',id:'new-story'},setupValue());if(alive(token))await restoreSetup(value,token);}
  }
  function saveSetupDraft(){if(setupDraft?.state)setupDraft.edit(setupValue());}
  async function startStory(event) {
    event.preventDefault();
    if (busy) return;
    const token = epoch; busy = true; $('startFiction').disabled = true; $('startFiction').textContent = 'Starting…'; status();
    try {
      const payload=setupValue();await openSetupDraft(token);setupDraft.edit(payload);const row=await setupDraft.flush();
      const actionKey=row.submitted?.action_key || crypto.randomUUID();
      const prepared=row.submitted?{row,actionKey}:await setupDraft.submit({purpose:'story-creation'},actionKey);
      if(!alive(token))return;
      const data=await api('/fiction','POST',{...payload,creation:{draft_id:prepared.row.id,draft_revision:prepared.row.revision,action_key:prepared.actionKey}});
      if (!alive(token)) return;
      $('fictionStartForm').reset(); library.resetSetup(); syncFourthWallStart(); castRows.length = 0; $('fictionCastDraft').replaceChildren(); scenario = null; $('scenarioNote').textContent = '';
      try{await api(`/fiction/local-actions/${encodeURIComponent(prepared.actionKey)}/ack`,'POST',{});}catch{/* Recovery remains available after a lost acknowledgement. */}
      if(!alive(token))return;setupDraft.close();setupDraft=null;
      window.location.hash = `#/story/${data.story.id}`;
    } catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { busy = false; $('startFiction').disabled = false; $('startFiction').textContent = 'Begin this story'; } }
  }


  function clearPrivate() {
    workspace.position(); inspection.clear(); for(const controller of durableDrafts.values())controller.close();durableDrafts.clear();activeDurable=null; workspace.clear();
    unlocked = false; epoch++; busy = false; earlierBusy = false; current = null; shownBeatId = null; clearTimeout(poll); drafts.clear(); scopes.clear(); shelfOffset = 0; nextShelfOffset = null; scenario = null; castRows.length = 0;
    if (dialogs.cancel) dialogs.cancel(); else dialogs.close(true);
    document.querySelector('.dialog-manager__body')?.replaceChildren();
    const dialogTitle = document.querySelector('.dialog-manager__title'); if (dialogTitle) dialogTitle.textContent = '';
    for (const id of ['fictionShelf', 'fictionProse', 'fictionCast', 'fictionFacts', 'fictionCastDraft', 'fictionProviderPanel', 'fictionStoryTitle', 'fictionControl', 'fictionEpisode', 'fictionSpend', 'fictionEpisodeSummary', 'fictionCover', 'fictionReferences']) $(id).replaceChildren();
    setupDraft?.close();setupDraft=null;$('setupDraftState')?.replaceChildren();
    $('contributionDraftState')?.replaceChildren();
    $('fictionStartForm').reset(); syncFourthWallStart(); $('fictionDirection').value = ''; status();
    $('fictionBranch').replaceChildren(); $('fictionInputKind').replaceChildren(option('steer', 'Steer the story'), option('ask', 'Ask outside the story'));
    selectedDraftKind = 'steer'; bookmarkRestoring = false; $('workspaceNewPassage').hidden = true;
    stopProgress();
    for (const id of ['fictionPlayStyle', 'fictionFocusText', 'fictionChallenges', 'fictionInvitations', 'fictionEpisodeFocus', 'fictionQualityState', 'fictionCalls']) $(id).replaceChildren();
    $('fictionDirectionScope').value = 'moment';
    for (const id of SCREEN_IDS) $(id).hidden = true;
    providerPanel?.clear();
    library.clear();
    $('scenarioNote').textContent = ''; $('scenarioChoices').replaceChildren();
    pageControls();
  }

  const storyDialogs = createStoryDialogs({ dialogs, getCurrent: () => current, isBusy: () => busy, localAction });
  const influence = createInfluence({ api, dialogs, getCurrent: () => current, isBusy: () => busy, localAction, send, correct: correctionDialog,
    setDirection: (value) => { workspace.contribution('steer'); $('fictionDirection').value = value; draftRevision++; saveDraft(); status('Direction filled in. Edit it or send when ready; nothing has happened yet.'); } });
  const mediaDialogs = createMediaDialogs({ api, dialogs, getCurrent: () => current, isBusy: () => busy, runAction: runMediaAction, localAction });
  const library = createVisualLibrary({ api, dialogs });
  const saveDialogs = createSaveDialogs({ dialogs, getCurrent: () => current, getLive: () => { const token = epoch; return () => alive(token); }, runAction: runMediaAction });
  workspace = createFictionWorkspace({ getCurrent: () => current, getShown: () => shownBeatId,
    readBeat: (id) => { const index = readingPages().findIndex(beat => beat.id === id); if (index >= 0) showPage(index); },
    sourceButton: influence.sourceButton, illustrate: mediaDialogs.illustrate, contributionChanged: selectDraft,
  });
  inspection = createInspection({api,dialogs,getCurrent:()=>current,activate:branch=>localAction('branch','PUT',{branch_id:branch})});
  async function loadLatest() {
    if (!current || $('fictionLatestPage').disabled) return;
    if (!current.windowPast) { showPage(readingPages().length - 1); return; }
    const story = current; const token = epoch; earlierBusy = true; controls();
    try { const data = await api(`/fiction/${story.id}`); if (alive(token) && current.active_branch_id === story.active_branch_id) { renderStory(data.story, { forceLatest: true }); $('workspaceReader').scrollTop = 0; workspace.position(); } }
    catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { earlierBusy = false; controls(); } }
  }
  $('fictionContinue').parentElement.append(button('Recover drafts or review submissions…',recoverContribution));
  $('fictionDownloadSave').addEventListener('click', saveDialogs.save);
  $('fictionImportSave').addEventListener('click', saveDialogs.importSave);
  $('fictionIllustrate').addEventListener('click', mediaDialogs.illustrate);
  $('fictionCoverEdit').addEventListener('click', () => mediaDialogs.illustrate({ kind: 'cover' }));
  $('fictionExportBook').addEventListener('click', mediaDialogs.exportBook);
  for (const [id, action] of [['fictionPreferences', 'preferences'], ['fictionAddCast', 'cast'], ['fictionRetire', 'retire']]) $(id).addEventListener('click', storyDialogs[action]);

  $('fictionStartForm').addEventListener('input',saveSetupDraft);$('fictionStartForm').addEventListener('change',saveSetupDraft);
  $('fictionStartForm').addEventListener('submit', startStory);
  $('fictionStartStyle').addEventListener('change', syncFourthWallStart);
  $('addFictionCast').addEventListener('click', () => addCast());
  $('fictionRefresh').addEventListener('click', () => route({ refresh: true }));
  for (const [id, family] of [['workspaceResetPaid', 'ordinary'], ['workspaceResetQualityPaid', 'quality']]) $(id).addEventListener('click', () => { dialogs.resetPaidConsent?.(family); $('workspaceConsentStatus').textContent = 'Future purchases in this family require review again. This does not cancel an active request.'; });
  $('fictionShelfPrevious').addEventListener('click', () => { shelfOffset = Math.max(0, shelfOffset - 80); $('fictionShelfPrevious').disabled = true; route(); });
  $('fictionShelfNext').addEventListener('click', () => { if (nextShelfOffset !== null) { shelfOffset = nextShelfOffset; $('fictionShelfNext').disabled = true; route(); } });
  $('fictionContinue').addEventListener('click', () => send('follow'));
  $('fictionComposer').addEventListener('submit', (event) => { event.preventDefault(); send($('fictionInputKind').value); });
  $('fictionDirection').addEventListener('input', () => { draftRevision++; saveDraft(); controls(); });
  $('fictionDirectionScope').addEventListener('change',()=>{draftRevision++;saveDraft();});
  $('fictionInputKind').addEventListener('change', () => { workspace.contribution($('fictionInputKind').value, true); controls(); });
  $('fictionDirection').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); send($('fictionInputKind').value); } });
  $('fictionDetailsToggle').addEventListener('click', () => { if (current) location.hash = workspaceUrl(current.id, 'codex'); });
  $('releaseFictionControl').addEventListener('click', () => localAction('control', 'PUT', { character_id: null }));
  $('fictionBranch').addEventListener('change', () => localAction('branch', 'PUT', { branch_id: $('fictionBranch').value }));
  $('fictionFork').addEventListener('click', () => pathDialog(false));
  $('fictionRewind').addEventListener('click', () => pathDialog(true));
  $('fictionCorrect').addEventListener('click', correctionDialog);
  $('fictionEndEpisode').addEventListener('click', () => episodeDialog(false));
  $('fictionNextEpisode').addEventListener('click', () => episodeDialog(true));
  async function loadEarlier() {
    if (!current || $('fictionEarlier').disabled) return;
    const token = epoch; const story = current; earlierBusy = true; controls();
    try {
      const data = await api(`/fiction/${story.id}?before=${encodeURIComponent(story.beats[0].id)}`);
      if (alive(token) && current.revision === story.revision && current.active_branch_id === story.active_branch_id && data.story.revision === story.revision) {
        renderStory({ ...data.story, beats: [...data.story.beats, ...story.beats] });
        const earlierPages = readingPages(data.story.beats);
        if (earlierPages.length) showPage(earlierPages.length - 1);
      }
    } catch (error) { if (alive(token)) status(error.message, true); }
    finally { if (alive(token)) { earlierBusy = false; controls(); } }
  }
  $('fictionEarlier').addEventListener('click', loadEarlier);
  $('fictionPreviousPage').addEventListener('click', () => {
    if ($('fictionPreviousPage').disabled) return;
    const index = readingPages().findIndex((beat) => beat.id === shownBeatId);
    if (index > 0) showPage(index - 1); else loadEarlier();
  });
  $('fictionNextPage').addEventListener('click', () => {
    if (!$('fictionNextPage').disabled) showPage(readingPages().findIndex((beat) => beat.id === shownBeatId) + 1);
  });
  $('fictionLatestPage').addEventListener('click', loadLatest);
  $('fictionTextSize').addEventListener('change', () => {
    const size = $('fictionTextSize').value;
    document.documentElement.style.setProperty('--fiction-reading-size', `${size}px`);
    try { localStorage.setItem('im-fiction-text-size', size); } catch { /* optional preference */ }
  });
  try { const size = localStorage.getItem('im-fiction-text-size'); if (['18', '21', '24'].includes(size)) { $('fictionTextSize').value = size; document.documentElement.style.setProperty('--fiction-reading-size', `${size}px`); } } catch { /* blocked storage */ }
  window.addEventListener('hashchange', route);
  return { start: () => { unlocked = true; return route(); }, lock: clearPrivate, dispose: () => { clearPrivate(); workspace.dispose(); window.removeEventListener('hashchange', route); }, route, send, renderStory, getCurrent: () => current, addCast, setScenario: (value) => { scenario = value; } };
}
