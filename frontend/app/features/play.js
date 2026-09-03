// Optional scene play. Session transcripts are working history; this surface
// has no pathway that silently promotes a turn into manuscript prose.

import { chooseWorkspaceStory } from '../core/story-context.js';
import { ROUGH_TEXT_CALL_ESTIMATE } from '../core/cost.js';

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function requestKey() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `play:${id}`;
}

function sentence(value) {
  return String(value || '').replaceAll('_', ' ');
}

export function createPlay({ api, state, notify, features, dialogs, router }) {
  const { apiCall } = api;
  const { showError, showSuccess } = notify;
  let routeController = router;
  let activeStoryId = null;
  let scene = null;
  let sessions = [];
  let session = null;
  let editingContract = false;
  let busy = false;
  let loadToken = 0;
  let retryRequest = null;
  let recap = { entries: [], omitted: 0 };
  let proposals = [];
  let suggestionKey = null;
  let proseRequestKey = null;

  const byId = (id) => document.getElementById(id);
  const setStatus = (message) => { if (byId('playStatus')) byId('playStatus').textContent = message; };

  function characterName(id, fallback = 'Owner / director') {
    if (!id) return fallback;
    return state.data.characters.find((character) => character.id === id)?.name ||
      session?.participants?.find((participant) => participant.character_id === id)?.name ||
      'Cast participant';
  }

  function defaultParticipants() {
    const cast = state.data.currentStory?.characters || [];
    const lead = cast.find((member) => member.id === scene?.viewpoint_character_id) ||
      cast.find((member) => member.role === 'mc') || cast[0] || null;
    return cast.map((member) => ({
      character_id: member.id,
      controller: member.id === lead?.id ? 'owner' : 'scribe',
    }));
  }

  function renderParticipants(contract = null) {
    const target = byId('playParticipants');
    target.textContent = '';
    const defaults = defaultParticipants();
    const stored = new Map((contract?.participants || []).map((participant) => [participant.character_id, participant]));
    const values = defaults.map((participant) => stored.get(participant.character_id) || participant);
    if (!values.length) {
      target.appendChild(node('p', 'setting-hint', 'This manuscript has no cast. You can still play as the owner/director.'));
      return;
    }
    for (const participant of values) {
      const row = node('label', 'play-participant');
      const cast = state.data.currentStory?.characters?.find((member) => member.id === participant.character_id);
      const name = characterName(participant.character_id, participant.name);
      row.appendChild(node('strong', '', `${name} · ${cast?.role || participant.role || 'supporting'}`));
      const select = document.createElement('select');
      select.dataset.characterId = participant.character_id;
      select.setAttribute('aria-label', `Control for ${name}`);
      for (const [value, label] of [
        ['owner', 'Owner controls'], ['scribe', 'Scribe controls'], ['shared', 'Shared control'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === participant.controller;
        select.appendChild(option);
      }
      row.appendChild(select);
      target.appendChild(row);
    }
  }

  function fillContract(contract = null) {
    renderParticipants(contract);
    byId('playInitiative').value = contract?.scribe_initiative || 'balanced';
    byId('playChallenge').value = contract?.challenge || 'balanced';
    byId('playPacing').value = contract?.pacing || 'balanced';
    byId('playConsequences').value = contract?.consequences || 'meaningful';
    byId('playSuggestions').value = contract?.suggestions || 'on_request';
    byId('playInteriority').value = contract?.player_interiority || 'owner_only';
    byId('playAllowDeath').checked = Boolean(contract?.allow_character_death);
    byId('playContractNotes').value = contract?.notes || '';
  }

  function contractPayload() {
    return {
      participants: [...byId('playParticipants').querySelectorAll('select')].map((select) => ({
        character_id: select.dataset.characterId,
        controller: select.value,
      })),
      scribe_initiative: byId('playInitiative').value,
      challenge: byId('playChallenge').value,
      pacing: byId('playPacing').value,
      consequences: byId('playConsequences').value,
      allow_character_death: byId('playAllowDeath').checked,
      suggestions: byId('playSuggestions').value,
      player_interiority: byId('playInteriority').value,
      notes: byId('playContractNotes').value,
    };
  }

  function renderSessionPicker() {
    const select = byId('playSessionSelect');
    select.textContent = '';
    if (!sessions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No sessions yet';
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    for (const item of sessions) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `Session ${item.ordinal} · ${item.status} · ${item.turn_count} turns`;
      select.appendChild(option);
    }
    select.disabled = false;
    select.value = session?.id || sessions[0].id;
  }

  function renderBranchPicker() {
    const select = byId('playBranchSelect');
    if (!select) return;
    select.textContent = '';
    for (const branch of session?.branches || []) {
      const option = document.createElement('option'); option.value = branch.id;
      option.textContent = `${branch.ordinal}. ${branch.name}${branch.selected_successor_turn_id ? ' · successor selected' : ''}`;
      option.selected = branch.id === session.selected_branch_id; select.append(option);
    }
    select.disabled = busy || !session || (session.branches || []).length < 2;
  }

  function renderContractSummary() {
    const target = byId('playContractSummary');
    if (!session) { target.textContent = ''; return; }
    const control = session.participants.length
      ? session.participants.map((participant) => `${participant.name}: ${participant.controller}`).join(' · ')
      : 'Owner/director play without a cast';
    target.textContent = [
      control,
      `initiative ${sentence(session.scribe_initiative)}`,
      `challenge ${sentence(session.challenge)}`,
      `pacing ${sentence(session.pacing)}`,
      `${sentence(session.consequences)} consequences`,
      session.allow_character_death ? 'character death allowed' : 'character death barred',
      `suggestions ${sentence(session.suggestions)}`,
      `interiority ${sentence(session.player_interiority)}`,
    ].join(' · ');
  }

  function renderTranscript() {
    const target = byId('playTranscript');
    target.textContent = '';
    if (!session?.turns?.length) {
      target.appendChild(node('li', 'play-transcript__empty', 'The scene waits for its first turn.'));
      return;
    }
    for (const turn of session.turns) {
      const item = node('li', `play-turn play-turn--${turn.speaker}`);
      const who = turn.speaker === 'scribe' ? 'Scribe' : characterName(turn.character_id);
      item.appendChild(node('p', 'play-turn__meta', `${turn.ordinal} · ${who} · ${sentence(turn.input_kind)}`));
      item.appendChild(node('p', 'play-turn__content', turn.content));
      if (session) {
        const actions = node('div', 'play-actions play-turn__actions');
        if (session.status === 'active') {
          const fork = node('button', 'btn btn-secondary', 'Fork from here'); fork.type = 'button'; fork.disabled = busy;
          fork.addEventListener('click', () => forkFrom(turn)); actions.append(fork);
        }
        if (turn.branch_id === session.selected_branch_id) {
          const choose = node('button', 'btn btn-secondary', 'Select as successor'); choose.type = 'button'; choose.disabled = busy;
          choose.addEventListener('click', () => selectSuccessor(turn)); actions.append(choose);
        }
        item.append(actions);
      }
      target.appendChild(item);
    }
    target.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  }

  function renderRecap() {
    const target = byId('playRecap');
    const suggestionTarget = byId('playSuggestions');
    if (!target || !suggestionTarget) return;
    target.textContent = '';
    if (!recap.entries?.length) target.append(node('p', 'setting-hint', 'No durable campaign state has been recorded yet.'));
    for (const entry of recap.entries || []) {
      const item = node('article', `play-state play-state--p${entry.priority}`);
      item.append(node('p', 'play-turn__meta', `${sentence(entry.kind)} · ${['Main', 'Supporting', 'Background'][entry.priority] || 'Supporting'} · ${entry.source?.label || 'owner record'}`));
      item.append(node('strong', '', entry.title));
      if (entry.details?.summary) item.append(node('p', '', entry.details.summary));
      target.append(item);
    }
    if (recap.omitted) target.append(node('p', 'setting-hint', `${recap.omitted} lower-priority records are available in Codex → Campaign.`));
    suggestionTarget.textContent = '';
    for (const proposal of proposals) {
      const item = node('article', 'play-state play-state--proposal');
      item.append(node('p', 'play-turn__meta', `${sentence(proposal.kind)} · proposal, not canon`));
      item.append(node('strong', '', proposal.title), node('p', '', proposal.details?.summary || ''));
      const add = node('button', 'btn btn-primary', 'Add to campaign state'); add.type = 'button';
      add.addEventListener('click', () => applyProposal(proposal, item)); item.append(add); suggestionTarget.append(item);
    }
    const suggest = byId('playSuggestState');
    if (suggest) suggest.disabled = busy || !session?.turns?.length;
  }

  function renderComposer() {
    const composer = byId('playComposer');
    const ended = !session || session.status !== 'active';
    composer.hidden = ended;
    byId('playEditContract').hidden = ended;
    byId('playEndSession').hidden = ended;
    byId('playNewSessionBtn').hidden = !session || !ended || sessions.some((item) => item.status === 'active');
    const select = byId('playTurnCharacter');
    select.textContent = '';
    const director = document.createElement('option');
    director.value = '';
    director.textContent = 'Owner / director';
    select.appendChild(director);
    for (const participant of session?.participants || []) {
      if (!['owner', 'shared'].includes(participant.controller)) continue;
      const option = document.createElement('option');
      option.value = participant.character_id;
      option.textContent = `${participant.name} · ${participant.controller}`;
      select.appendChild(option);
    }
    for (const control of composer.querySelectorAll('button, select, textarea')) control.disabled = busy || ended;
    byId('playSendTurn').textContent = retryRequest ? 'Retry Scribe reply' : 'Send to Scribe';
  }

  function render() {
    if (byId('playSceneName')) byId('playSceneName').textContent = scene ? `— ${scene.title}` : '— scene unavailable';
    renderSessionPicker();
    renderBranchPicker();
    const showContract = !session || editingContract;
    byId('playContractPanel').hidden = !showContract;
    byId('playSessionPanel').hidden = !session;
    if (showContract) {
      byId('playContractTitle').textContent = session ? 'Edit the table contract' : 'Set the table contract';
      byId('playContractSave').textContent = session ? 'Save Session Zero' : 'Start play session';
      byId('playContractCancel').hidden = !session;
      fillContract(session);
    }
    renderContractSummary();
    renderTranscript();
    renderRecap();
    renderComposer();
    const selectedBranch = session?.branches?.find((branch) => branch.id === session.selected_branch_id);
    if (byId('playPrepareProse')) byId('playPrepareProse').disabled = busy || !selectedBranch?.selected_successor_turn_id;
    if (session) {
      setStatus(session.status === 'active'
        ? `Session ${session.ordinal} is active. Turns are working history, not manuscript canon.`
        : `Session ${session.ordinal} ended. Its transcript remains read-only working history.`);
    } else {
      setStatus('No play session exists. Session Zero is optional; returning to Chronicle changes nothing.');
    }
  }

  async function loadSession(id) {
    const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${id}`);
    session = result.session;
  }

  function forkFrom(turn) {
    const body = node('div', 'codex-correction-form');
    const label = node('label', '', 'Path name'); const input = document.createElement('input'); input.maxLength = 200;
    input.value = `Alternative after turn ${turn.ordinal}`; label.append(input); body.append(label);
    dialogs.openDialog({ title: `Fork from turn ${turn.ordinal}?`, body,
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        { label: 'Create alternate path', className: 'btn-primary', onClick: async (close) => {
          if (!input.value.trim()) { input.setCustomValidity('Name this path.'); input.reportValidity(); return; }
          close(true);
          try {
            const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/branches`, 'POST', { fork_turn_id: turn.id, name: input.value.trim() });
            session = result.session; proposals = []; suggestionKey = null; proseRequestKey = null; render(); showSuccess('Alternate path created. Earlier turns remain shared and immutable.');
          } catch (error) { showError(error.message); }
        } },
      ],
    });
  }

  function selectSuccessor(turn) {
    dialogs.openDialog({
      title: `Select turn ${turn.ordinal} as this path’s successor?`,
      body: 'This marks the endpoint to shape into prose. It does not create canon, alter another path, or call AI.',
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: (close) => close(true) },
        { label: 'Select successor', className: 'btn-primary', onClick: async (close) => {
          close(true);
          try {
            const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/branches/${session.selected_branch_id}/successor`, 'PUT', { turn_id: turn.id });
            session = result.session; proseRequestKey = null; render(); showSuccess('Successor selected. This path is still working history, not manuscript canon.');
          } catch (error) { showError(error.message); }
        } },
      ],
    });
  }

  async function prepareProse() {
    const branch = session?.branches?.find((item) => item.id === session.selected_branch_id);
    if (!branch?.selected_successor_turn_id || busy) return;
    const estimate = ROUGH_TEXT_CALL_ESTIMATE;
    const approved = await dialogs.confirmPaid({
      title: 'Shape this selected Play path into prose?',
      review: {
        action: 'Create one prepared manuscript page from the selected path endpoint.',
        object: `path “${branch.name}” in scene “${scene.title}”`, model: state.settings.model || 'server default writing model',
        quantity: 'one prepared page (up to two billed attempts if the first is unusable)',
        sends: 'up to 60 recent turns of the selected path through its chosen successor, Session Zero contract, compact world/cast memory, relevant remembered canon, recent manuscript prose, the bound Scribe profile, and manuscript/scene titles',
        estimate, maximum: estimate * 2,
        note: 'The result stays server-side as a prepared page. Only the normal Desk review/Use prepared page action can commit it to canon.',
      }, confirmLabel: 'Prepare prose',
    });
    if (!approved) return;
    busy = true; render();
    try {
      proseRequestKey ||= requestKey().replace('play:', 'play-prose:');
      const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/prepare-prose`, 'POST', {
        idempotency_key: proseRequestKey, words: state.settings.wordsPerPage,
        ...(state.settings.model ? { model: state.settings.model } : {}),
        ...(state.settings.reasoningEffort ? { reasoning_effort: state.settings.reasoningEffort } : {}),
      });
      if (!result.reused) state.addSessionCost(result.preview?.cost_usd);
      proseRequestKey = null;
      await features.write.loadStoryPages();
      showSuccess('The selected path is prepared as prose on the Desk; it is not canon until you use it.');
      routeController.navigate('desk', { storyId: activeStoryId });
    } catch (error) {
      if (typeof error.costUsd === 'number') state.addSessionCost(error.costUsd);
      showError(error.message);
    } finally { busy = false; render(); }
  }

  async function reload(preferredId = null) {
    const [result, recapResult] = await Promise.all([
      apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/play-sessions`),
      apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/recap`),
    ]);
    recap = recapResult.recap || { entries: [], omitted: 0 };
    sessions = result.sessions || [];
    const selected = preferredId || result.active?.id || sessions[0]?.id || null;
    session = null;
    if (selected) await loadSession(selected);
    render();
  }

  async function suggestState() {
    if (busy || !session?.turns?.length) return;
    const approved = await dialogs.confirmPaid({
      title: 'Ask AI to propose campaign state?',
      review: {
        action: 'Inspect this scene’s Play transcript and propose durable state for your review.',
        object: `scene “${scene.title}”`, model: state.settings.model || 'server default writing model',
        quantity: 'one structured proposal set (up to two billed attempts if the first is unusable)',
        sends: 'the scene transcript, compact current campaign state, cast names/roles, and manuscript/scene titles',
        estimate: ROUGH_TEXT_CALL_ESTIMATE, maximum: ROUGH_TEXT_CALL_ESTIMATE * 2,
        note: 'Nothing is applied automatically. Add proposals one by one after inspecting them.',
      },
      confirmLabel: 'Suggest campaign state',
    });
    if (!approved) return;
    busy = true; suggestionKey ||= requestKey().replace('play:', 'campaign:'); render();
    try {
      const result = await apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/campaign-suggestions`, 'POST', {
        idempotency_key: suggestionKey,
        ...(state.settings.model ? { model: state.settings.model } : {}),
        ...(state.settings.reasoningEffort ? { reasoning_effort: state.settings.reasoningEffort } : {}),
      });
      state.addCostForStory(activeStoryId, result.cost_usd); proposals = result.proposals || []; suggestionKey = null;
      showSuccess(proposals.length ? 'Campaign proposals are ready for review.' : 'No durable state changes were found.');
    } catch (error) {
      if (typeof error.costUsd === 'number') state.addCostForStory(activeStoryId, error.costUsd);
      showError(error.message);
    } finally { busy = false; render(); }
  }

  async function applyProposal(proposal, item) {
    try {
      await apiCall(`/stories/${activeStoryId}/campaign-state`, 'POST', proposal);
      proposals = proposals.filter((candidate) => candidate !== proposal);
      const result = await apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/recap`); recap = result.recap;
      renderRecap(); showSuccess(`Added “${proposal.title}” to campaign state.`);
    } catch (error) { showError(error.message); item?.scrollIntoView?.({ block: 'nearest' }); }
  }

  async function enter(params = {}) {
    if (!params.storyId || !params.sceneId) return;
    const token = ++loadToken;
    const story = await chooseWorkspaceStory({ storyId: params.storyId, state, features });
    if (!story || token !== loadToken) return;
    activeStoryId = story.id;
    retryRequest = null;
    editingContract = false;
    setStatus('Opening the scene and its working transcript…');
    try {
      const result = await apiCall(`/stories/${story.id}/scenes`);
      if (token !== loadToken) return;
      scene = (result.scenes || []).find((item) => item.id === params.sceneId) || null;
      if (!scene) {
        showError('That scene no longer exists.');
        routeController.navigate('chronicle', { storyId: story.id });
        return;
      }
      await reload();
    } catch (error) {
      if (token !== loadToken) return;
      showError(error.message);
      setStatus(`Play could not load: ${error.message}`);
    }
  }

  async function saveContract(event) {
    event.preventDefault();
    if (busy || !scene) return;
    busy = true;
    byId('playContractSave').disabled = true;
    renderComposer();
    try {
      const result = session
        ? await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/contract`, 'PUT', contractPayload())
        : await apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/play-sessions`, 'POST', contractPayload());
      session = result.session;
      proseRequestKey = null;
      editingContract = false;
      await reload(session.id);
      showSuccess(session.ordinal === 1 && session.turn_count === 0 ? 'Session Zero saved. The scene is ready to play.' : 'Session Zero updated for future turns.');
    } catch (error) {
      showError(error.message);
    } finally {
      busy = false;
      byId('playContractSave').disabled = false;
      if (session) render();
    }
  }

  function turnPayload() {
    return {
      kind: byId('playTurnKind').value,
      character_id: byId('playTurnCharacter').value || null,
      content: byId('playTurnContent').value.trim(),
    };
  }

  async function submitTurn(sendToScribe) {
    if (busy || !session) return;
    let payload = turnPayload();
    if (sendToScribe && retryRequest && !payload.content) payload = retryRequest.payload;
    if (!payload.content) {
      byId('playTurnContent').setCustomValidity('Enter your turn.');
      byId('playTurnContent').reportValidity();
      return;
    }
    byId('playTurnContent').setCustomValidity('');
    if (sendToScribe) {
      const approved = await dialogs.confirmPaid({
        title: `Send this ${sentence(payload.kind)} turn to the Scribe?`,
        review: {
          action: 'Record your turn and ask the Scribe for one immediate roleplay response.',
          object: `scene “${scene.title}”`,
          model: state.settings.model || 'server default writing model',
          quantity: 'one text reply (up to two billed attempts if the first is unusable)',
          sends: 'the Session Zero contract, recent session turns, compact world/cast memory, recent manuscript excerpts, and this turn',
          estimate: ROUGH_TEXT_CALL_ESTIMATE,
          maximum: ROUGH_TEXT_CALL_ESTIMATE * 2,
          note: 'The response stays in working history. It does not become manuscript prose.',
        },
        confirmLabel: 'Send to Scribe',
      });
      if (!approved) return;
    }
    busy = true;
    renderComposer();
    const key = sendToScribe && retryRequest?.payload.content === payload.content
      ? retryRequest.key
      : requestKey();
    try {
      const endpoint = sendToScribe ? 'replies' : 'turns';
      const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/${endpoint}`, 'POST', {
        ...payload,
        idempotency_key: key,
        ...(sendToScribe ? {
          ...(state.settings.model ? { model: state.settings.model } : {}),
          ...(state.settings.reasoningEffort ? { reasoning_effort: state.settings.reasoningEffort } : {}),
        } : {}),
      });
      if (sendToScribe) state.addCostForStory(activeStoryId, result.cost_usd);
      retryRequest = null;
      proposals = [];
      suggestionKey = null;
      proseRequestKey = null;
      byId('playTurnContent').value = '';
      await reload(session.id);
      showSuccess(sendToScribe ? 'The Scribe answered in working history.' : 'Turn recorded without calling AI.');
    } catch (error) {
      if (typeof error.costUsd === 'number') state.addCostForStory(activeStoryId, error.costUsd);
      if (sendToScribe) {
        retryRequest = { key, payload };
        byId('playTurnContent').value = '';
        try { await reload(session.id); } catch { /* keep the original provider error */ }
      }
      showError(error.message);
    } finally {
      busy = false;
      render();
    }
  }

  function confirmEnd() {
    return new Promise((resolve) => dialogs.openDialog({
      title: 'End this play session?',
      body: 'The transcript becomes read-only working history. You can begin another Session Zero for this scene later.',
      onFreeClose: () => resolve(false),
      actions: [
        { label: 'Keep playing', className: 'btn-secondary', autofocus: true, onClick: (close) => { close(true); resolve(false); } },
        { label: 'End session', className: 'btn-primary', onClick: (close) => { close(true); resolve(true); } },
      ],
    }));
  }

  async function endSession() {
    if (!session || !(await confirmEnd())) return;
    try {
      await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/end`, 'POST');
      retryRequest = null;
      await reload(session.id);
      showSuccess('Play session ended. The transcript remains available.');
    } catch (error) { showError(error.message); }
  }

  function init() {
    byId('playBackBtn')?.addEventListener('click', () => routeController.navigate('chronicle', { storyId: activeStoryId }));
    byId('playContractForm')?.addEventListener('submit', saveContract);
    byId('playContractCancel')?.addEventListener('click', () => { editingContract = false; render(); });
    byId('playEditContract')?.addEventListener('click', () => { editingContract = true; render(); });
    byId('playEndSession')?.addEventListener('click', endSession);
    byId('playNewSessionBtn')?.addEventListener('click', () => { session = null; editingContract = false; render(); });
    byId('playSessionSelect')?.addEventListener('change', async (event) => {
      if (!event.target.value) return;
      try { await loadSession(event.target.value); editingContract = false; retryRequest = null; proseRequestKey = null; render(); }
      catch (error) { showError(error.message); }
    });
    byId('playBranchSelect')?.addEventListener('change', async (event) => {
      try {
        const result = await apiCall(`/stories/${activeStoryId}/play-sessions/${session.id}/branch`, 'PUT', { branch_id: event.target.value });
        session = result.session; proposals = []; suggestionKey = null; proseRequestKey = null; render();
      } catch (error) { showError(error.message); }
    });
    byId('playPrepareProse')?.addEventListener('click', prepareProse);
    byId('playRecordTurn')?.addEventListener('click', () => submitTurn(false));
    byId('playComposer')?.addEventListener('submit', (event) => { event.preventDefault(); submitTurn(true); });
    byId('playTurnContent')?.addEventListener('input', () => {
      if (retryRequest && byId('playTurnContent').value.trim()) { retryRequest = null; renderComposer(); }
    });
    byId('playSuggestState')?.addEventListener('click', suggestState);
  }

  function reset() {
    loadToken++;
    activeStoryId = null;
    scene = null;
    sessions = [];
    session = null;
    editingContract = false;
    busy = false;
    retryRequest = null;
    recap = { entries: [], omitted: 0 };
    proposals = [];
    suggestionKey = null;
    proseRequestKey = null;
    for (const id of ['playParticipants', 'playContractSummary', 'playTranscript']) {
      if (byId(id)) byId(id).textContent = '';
    }
    if (byId('playTurnContent')) byId('playTurnContent').value = '';
  }

  return { init, enter, render, reset, setRouter(value) { routeController = value; } };
}
