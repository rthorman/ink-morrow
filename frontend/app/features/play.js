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
      target.appendChild(item);
    }
    target.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
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
    renderComposer();
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

  async function reload(preferredId = null) {
    const result = await apiCall(`/stories/${activeStoryId}/scenes/${scene.id}/play-sessions`);
    sessions = result.sessions || [];
    const selected = preferredId || result.active?.id || sessions[0]?.id || null;
    session = null;
    if (selected) await loadSession(selected);
    render();
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
      try { await loadSession(event.target.value); editingContract = false; retryRequest = null; render(); }
      catch (error) { showError(error.message); }
    });
    byId('playRecordTurn')?.addEventListener('click', () => submitTurn(false));
    byId('playComposer')?.addEventListener('submit', (event) => { event.preventDefault(); submitTurn(true); });
    byId('playTurnContent')?.addEventListener('input', () => {
      if (retryRequest && byId('playTurnContent').value.trim()) { retryRequest = null; renderComposer(); }
    });
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
    for (const id of ['playParticipants', 'playContractSummary', 'playTranscript']) {
      if (byId(id)) byId(id).textContent = '';
    }
    if (byId('playTurnContent')) byId('playTurnContent').value = '';
  }

  return { init, enter, render, reset, setRouter(value) { routeController = value; } };
}
