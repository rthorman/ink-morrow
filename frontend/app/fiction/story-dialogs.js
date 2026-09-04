import { el, field, option } from './dom.js';
import { styleField, styleDescription, fourthWallField } from './influence.js';

export function createStoryDialogs({ dialogs, getCurrent, isBusy, localAction }) {
  function open(title, make) {
    const story = getCurrent(); if (!story || story.pending || isBusy()) return;
    const spec = make(story); const error = el('p'); error.setAttribute('role', 'alert');
    dialogs.openDialog({ title, body: [...spec.body, error], dirty: spec.dirtyCheck, actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close() },
      { label: spec.label, className: 'btn-primary', pendingLabel: 'Saving…', onClick: async (close) => {
        if (getCurrent()?.id !== story.id || getCurrent()?.revision !== story.revision) { error.textContent = 'The story changed. Close this dialog and refresh before saving.'; return; }
        const payload = spec.payload(); if (!payload) { error.textContent = 'Complete the required fields.'; return; }
        const result = await localAction(spec.path, spec.method || 'POST', payload);
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved. Your text is still here.';
      } },
    ] });
  }
  return {
    cast: () => open('Add to the cast', () => {
      const name = field('Character name', 'input', '', { maxLength: 200 });
      const description = field('Reader-visible description', 'textarea', '', { maxLength: 2000, rows: 3 });
      const motive = field('Private motive (optional)', 'textarea', '', { maxLength: 1000, rows: 2 });
      return { path: 'cast', label: 'Add cast member', body: [el('p', 'Adding a person does not make you that character. Private motives guide narration but are not shown in the reader recap.'), name.wrapper, description.wrapper, motive.wrapper], payload: () => name.control.value.trim() ? { character: { id: globalThis.crypto.randomUUID(), name: name.control.value.trim(), description: description.control.value.trim(), motive: motive.control.value.trim() } } : null };
    }),
    retire: () => open('Retire a fact', (story) => {
      const fact = field('Fact to retire', 'select'); fact.control.append(...story.state.facts.map((entry) => option(entry.id, entry.text.slice(0, 120))));
      const reason = field('Reason for retiring it', 'input', '', { maxLength: 1500 });
      return { path: 'corrections', label: 'Retire this fact', body: [el('p', 'Remove a fact from current working memory. Earlier prose and earlier path snapshots keep it. Retired facts are no longer supplied to the narrator; do not retire a promise you still want to matter.'), fact.wrapper, reason.wrapper], payload: () => fact.control.value && reason.control.value.trim() ? { remove_id: fact.control.value, reason: reason.control.value.trim() } : null };
    }),
    preferences: () => open('Story preferences', (story) => {
      const style = styleField(story.state.play_style);
      const fourthWall = fourthWallField(style, story.state.fourth_wall);
      const pacing = field('Pacing', 'select'); pacing.control.append(option('reflective', 'Room to linger'), option('balanced', 'Balanced'), option('brisk', 'Keep moving')); pacing.control.value = story.state.pacing;
      const consequences = field('Consequences', 'select'); consequences.control.append(option('gentle', 'Gentle complications'), option('dramatic', 'Dramatic consequences')); consequences.control.value = story.state.consequences;
      const boundaries = field('Tone and boundaries', 'textarea', story.state.boundaries || '', { maxLength: 2000, rows: 3 });
      const voice = field('Narration voice', 'textarea', story.state.voice || '', { maxLength: 1500, rows: 3 });
      const focus = field('Keep attention on (clear to release a previous direction)', 'textarea', story.state.focus || '', { maxLength: 1500, rows: 2 });
      return { path: 'preferences', method: 'PUT', label: 'Save preferences', body: [el('p', 'These preferences shape future narration on this path and restore on rewind. Changing style does not reverse a recorded outcome. Pacing is not randomness.'), style.wrapper, el('p', styleDescription), fourthWall.wrapper, pacing.wrapper, consequences.wrapper, boundaries.wrapper, voice.wrapper, focus.wrapper], payload: () => ({ play_style: style.control.value, fourth_wall: fourthWall.control.value, pacing: pacing.control.value, consequences: consequences.control.value, boundaries: boundaries.control.value, voice: voice.control.value, focus: focus.control.value }) };
    }),
  };
}
