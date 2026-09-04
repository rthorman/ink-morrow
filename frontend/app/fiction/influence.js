import { el, button, field, option } from './dom.js';

export const styleDescription = 'Story-shaping follows your desired developments within continuity and boundaries. Living-world lets people and circumstances resist: an honest attempt is not a promised success. Neither style requires an avatar or constant conflict.';
export function styleField(value = 'story-shaping') {
  const input = field('Play style', 'select');
  input.control.append(option('story-shaping', 'Story-shaping — guide the outcome'), option('living-world', 'Living-world — discover what is possible'));
  input.control.value = value; return input;
}

export function fourthWallField(style, value = 'never') {
  const input = field('Characters may break the fourth wall', 'select');
  input.control.append(option('never', 'Never'), option('rarely', 'Rarely'), option('freely', 'Freely'));
  input.control.value = value;
  const help = el('p', 'Characters may knowingly address you, the reader. Rarely permits at most one address in six narrated passages. Freely allows it when fitting, not on every turn. This does not weaken resistance or reveal secrets.');
  help.id = `${input.control.id}-help`; input.control.setAttribute('aria-describedby', help.id); input.wrapper.append(help);
  const sync = () => { input.wrapper.hidden = style.control.value !== 'living-world'; input.control.disabled = input.wrapper.hidden; };
  style.control.addEventListener('change', sync); sync(); return input;
}

// All invitations derive from reader-visible records. They fill a draft, never
// submit a choice, invoke a model, or speak for an inhabited character.
export function invitations(story) {
  if (story.state.control.character_id) return ['Let the other people react, stopping before my character needs to decide.', 'Linger on the surroundings and give the moment room.'];
  const active = story.state.facts.filter((fact) => fact.status === 'active');
  const promise = active.find((fact) => fact.kind === 'commitment');
  const goal = active.find((fact) => fact.kind === 'goal');
  return [promise ? `Explore what this promise asks of the cast: ${promise.text}` : 'Stay with the different things these people want.',
    goal ? `Look for a possible next step, without deciding the outcome: ${goal.text}` : 'Explore a detail of the place that invites curiosity.',
    'Let the cast share a quiet moment without introducing a new crisis.'];
}

export function createInfluence({ api, dialogs, getCurrent, isBusy, localAction, send, setDirection, correct }) {
  const $ = (id) => document.getElementById(id);
  const same = (story) => getCurrent()?.id === story.id && getCurrent()?.revision === story.revision && getCurrent()?.active_branch_id === story.active_branch_id;
  function evidence(beatId) {
    const story = getCurrent(); if (!story || isBusy()) return;
    const body = el('div'); body.append(el('p', 'Loading the recorded moment…')); body.setAttribute('role', 'status');
    dialogs.openDialog({ title: 'Recorded evidence', body: [body], actions: [{ label: 'Close', className: 'btn-secondary', onClick: (close) => close(true) }] });
    api(`/fiction/${story.id}/evidence/${encodeURIComponent(beatId)}`).then(({ beat }) => {
      if (!same(story)) return;
      body.replaceChildren(el('p', beat.summary));
      if (beat.prose) for (const paragraph of beat.prose.split(/\n\s*\n/)) body.append(el('p', paragraph));
      else body.append(el('p', 'This was a local state change; earlier prose was not rewritten.'));
      for (const change of beat.changes || []) if (change.fact) body.append(el('p', change.fact.text));
    }).catch((error) => { if (same(story)) body.textContent = error.message; });
  }
  function sourceButton(id, label = 'Read recorded evidence') {
    const node = button(label, () => evidence(id)); node.dataset.fictionRead = 'true'; return node;
  }
  function retire(fact) {
    const story = getCurrent(); if (!story || isBusy()) return;
    const reason = field('Reason for retiring it', 'input', '', { maxLength: 1500 }); const error = el('p'); error.setAttribute('role', 'alert');
    dialogs.openDialog({ title: 'Retire this remembered fact?', body: [el('p', fact.text), el('p', 'It will stop guiding future narration on this path. Earlier evidence remains. This is not needed to free memory.'), reason.wrapper, error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close() },
      { label: 'Retire fact', className: 'btn-primary', pendingLabel: 'Saving…', onClick: async (close) => {
        if (!same(story) || !reason.control.value.trim()) { error.textContent = 'Supply a reason, or refresh if the story changed.'; return; }
        const result = await localAction('corrections', 'POST', { remove_id: fact.id, reason: reason.control.value.trim() });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved.';
      } },
    ] });
  }
  function recall() {
    const story = getCurrent(); if (!story || isBusy()) return;
    const query = field('Find a remembered fact', 'input', '', { maxLength: 200 });
    const results = el('div'); results.setAttribute('role', 'status'); let serial = 0;
    const search = async () => {
      const ticket = ++serial; results.textContent = 'Searching this path…';
      try {
        const data = await api(`/fiction/${story.id}/memory?q=${encodeURIComponent(query.control.value)}`);
        if (!same(story) || ticket !== serial) return;
        results.replaceChildren(el('p', data.facts.length ? 'Up to 32 relevant records. Refine the words to find an older detail.' : 'No current remembered facts found.'));
        for (const fact of data.facts) {
          const card = el('div', '', 'fiction-detail-card'); card.append(el('p', fact.text));
          if (fact.evidence_beat_id) card.append(sourceButton(fact.evidence_beat_id)); else card.append(el('p', 'Established at the beginning.'));
          card.append(button('Correct this fact', () => correct(fact)), button('Retire this fact', () => retire(fact))); results.append(card);
        }
      } catch (error) { if (same(story) && ticket === serial) results.textContent = error.message; }
    };
    query.control.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } });
    dialogs.openDialog({ title: 'Recall this path', body: [el('p', 'Search current public facts, including older records outside the working set. No AI request is made. Secrets, retired facts and other paths are excluded.'), query.wrapper, results], actions: [
      { label: 'Close', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Search memory', className: 'btn-primary', pendingLabel: 'Searching…', onClick: search },
    ] });
    query.control.focus();
  }
  function render(story) {
    const style = story.state.play_style || 'story-shaping';
    $('fictionPlayStyle').textContent = style === 'living-world' ? 'Living-world · Attempts can meet credible resistance.' : 'Story-shaping · Your direction guides developments.';
    if (style === 'living-world') $('fictionPlayStyle').textContent += ` Fourth-wall dialogue: ${{ never: 'Never', rarely: 'Rarely', freely: 'Freely' }[story.state.fourth_wall || 'never']}.`;
    $('fictionFocusText').textContent = story.state.focus ? `Ongoing focus: ${story.state.focus}` : '';
    $('fictionFocus').hidden = !story.state.focus;
    const root = $('fictionInvitations'); root.replaceChildren();
    for (const invitation of invitations(story)) root.append(button(invitation, () => {
      if (!same(story) || isBusy() || $('fictionDirection').value.trim()) return;
      setDirection(invitation); $('fictionInputKind').value = 'steer'; $('fictionDirectionScope').value = 'moment'; controls(false); $('fictionDirection').focus();
    }));
    const challenges = $('fictionChallenges'); challenges.replaceChildren();
    for (const challenge of story.state.challenges || []) {
      const card = el('div', '', 'fiction-detail-card'); card.append(el('h3', challenge.label));
      const decision = (story.state.adjudications || []).find((entry) => entry.challenge_id === challenge.id);
      if (decision) card.append(el('p', `Recorded outcome: ${decision.explanation}`), sourceButton(decision.beat_id, 'Read the decision moment'));
      if (challenge.actor_id === story.state.control.character_id) card.append(el('p', 'You inhabit this person. Supply their decision through Act, or release control to use these invitations.'));
      else for (const approach of challenge.approaches) card.append(button(approach.label, () => send('steer', { challenge_id: challenge.id, approach_id: approach.id, text: `${challenge.label}: ${approach.label}` })));
      challenges.append(card);
    }
    $('fictionChallengeSection').hidden = !(story.state.challenges || []).length;
  }
  function controls(blocked) {
    const ended = getCurrent()?.state.episode.status === 'ended';
    $('fictionDirectionScope').disabled = Boolean(blocked || $('fictionInputKind').value !== 'steer');
    for (const node of $('fictionInvitations').querySelectorAll('button')) node.disabled = Boolean(blocked || ended || $('fictionDirection').value.trim());
    for (const node of $('fictionChallenges').querySelectorAll('button')) node.disabled = Boolean(blocked || ended);
    for (const node of document.querySelectorAll('[data-fiction-read]')) node.disabled = Boolean(blocked);
    $('fictionRecall').disabled = Boolean(blocked); $('fictionClearFocus').disabled = Boolean(blocked);
  }
  $('fictionRecall').addEventListener('click', recall);
  $('fictionClearFocus').addEventListener('click', () => localAction('preferences', 'PUT', { focus: '' }));
  return { render, controls, sourceButton };
}
