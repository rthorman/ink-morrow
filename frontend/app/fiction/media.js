import { apiFetch } from '../core/api.js';
import { el, field, option } from './dom.js';

export async function downloadFile(url, filename, live = () => true) {
  const response = await apiFetch(url);
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Download failed.'); }
  const blob = await response.blob(); if (!live()) return;
  const href = URL.createObjectURL(blob); const link = el('a'); link.href = href; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function createMediaDialogs({ api, dialogs, getCurrent, isBusy, runAction, localAction }) {
  function illustrate() {
    const story = getCurrent(); if (!story || isBusy() || story.pending) return;
    const target = field('Story moment', 'select');
    const scenes = story.beats.filter((beat) => ['opening', 'scene'].includes(beat.kind));
    target.control.append(...scenes.map((beat) => option(beat.id, beat.prose.slice(0, 100))));
    if (scenes.length) target.control.value = scenes.at(-1).id;
    const alt = field('Image description (required for readers and export)', 'textarea', '', { maxLength: 1000, rows: 2 });
    const direction = field('Art direction (AI only)', 'textarea', '', { maxLength: 2000, rows: 3 });
    const describeTarget = () => { alt.control.value = story.state.illustrations?.find((item) => item.beat_id === target.control.value)?.alt_text || ''; };
    target.control.addEventListener('change', describeTarget); describeTarget();
    const shape = field('Image shape (AI only)', 'select'); shape.control.append(option('4:3', 'Landscape'), option('3:4', 'Portrait'), option('1:1', 'Square'), option('16:9', 'Wide'));
    const file = field('Upload an image instead (up to 20 MB)', 'input', '', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' });
    const error = el('p'); error.setAttribute('role', 'alert');
    const selected = story.illustration_generation;
    const valid = () => {
      if (getCurrent()?.id !== story.id || getCurrent()?.revision !== story.revision) { error.textContent = 'The story changed. Close this dialog and refresh before adding an image.'; return false; }
      if (!target.control.value || !alt.control.value.trim()) { error.textContent = 'Choose a story moment and describe the image.'; return false; }
      return true;
    };
    const show = () => dialogs.openDialog({ title: 'Illustrate a moment', body: [
      el('p', 'Images appear above their passage here and on their own page before that passage in EPUB. Replacing an image affects this path; earlier snapshots keep the old one.'),
      el('p', 'Only loaded story moments are listed. Use Read earlier moments to reach an older passage.'),
      target.wrapper, alt.wrapper, direction.wrapper, shape.wrapper, file.wrapper,
      el('p', selected?.provider ? `Illustrator: ${selected.provider.display_name} · ${selected.model_id}` : 'Choose an illustrator in Settings to paint with AI. Upload remains available.'), error,
    ], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Save description only', className: 'btn-secondary', pendingLabel: 'Saving description…', onClick: async (close) => {
        if (!valid()) return;
        const result = await localAction('images/describe', 'POST', { beat_id: target.control.value, alt_text: alt.control.value.trim() });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not saved.';
      } },
      { label: 'Remove current illustration', className: 'btn-secondary', pendingLabel: 'Removing…', onClick: async (close) => {
        if (!getCurrent()?.state.illustrations?.some((item) => item.beat_id === target.control.value)) { error.textContent = 'This moment has no illustration on the current path.'; return; }
        if (getCurrent()?.id !== story.id || getCurrent()?.revision !== story.revision) { error.textContent = 'The story changed. Reopen this dialog.'; return; }
        const result = await localAction('images/remove', 'POST', { beat_id: target.control.value });
        if (result?.ok) close(true); else error.textContent = result?.error || 'Not removed.';
      } },
      { label: 'Upload image', className: 'btn-secondary', pendingLabel: 'Uploading…', onClick: async (close) => {
        if (!valid()) return;
        if (!file.control.files?.[0]) { error.textContent = 'Choose an image file.'; return; }
        if (file.control.files[0].size > 20 * 1024 * 1024) { error.textContent = 'Choose an image no larger than 20 MB.'; return; }
        const form = new FormData(); form.append('image', file.control.files[0]); form.append('beat_id', target.control.value);
        form.append('alt_text', alt.control.value.trim()); form.append('expected_revision', story.revision);
        const result = await runAction(async () => {
          const response = await apiFetch(`/api/fiction/${story.id}/images/upload`, { method: 'POST', body: form });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed.'); return data;
        });
        if (result.ok) close(true); else if (!result.stale) error.textContent = result.error || 'Not uploaded. Your selection is still here.';
      } },
      { label: 'Paint with AI', className: 'btn-primary', pendingLabel: 'Preparing image…', disabled: !selected?.provider, onClick: async (close) => {
        if (!valid()) return;
        const input = { beat_id: target.control.value, alt_text: alt.control.value.trim(), direction: direction.control.value.trim(), aspect_ratio: shape.control.value,
          provider_id: selected.provider.id, model: selected.model_id };
        const result = await runAction(async (live) => {
          const approved = await dialogs.confirmPaid({ title: 'Paint this moment?', body: 'The selected passage and your art direction go to the illustrator. No hidden story facts, other passages or uploaded image references are sent. One image request; no automatic retry.',
            review: { action: 'Paint a story moment', object: story.title, model: `${selected.provider.display_name} · ${selected.model_id}`, quantity: 'One image', sends: 'Selected passage and art direction', estimate: 0.05, note: 'A rough image-call estimate, not a price cap. A failed attempt may still cost money.' }, confirmLabel: 'Paint this image' });
          if (!approved || !live()) return null;
          return api(`/fiction/${story.id}/images/generate`, 'POST', { expected_revision: story.revision, idempotency_key: crypto.randomUUID(), input });
        });
        if (result.ok) close(true);
        else if (!result.stale) { error.textContent = result.error || ''; show(); }
      } },
    ] });
    show(); // synchronous: no catalogue, model or provider wait before feedback
  }
  function exportBook() {
    const story = getCurrent(); if (!story || isBusy() || story.pending) return;
    const format = field('Book format', 'select');
    format.control.append(...['epub', 'pdf', 'html', 'docx', 'odt', 'rtf', 'md', 'txt', 'json'].map((id) => option(id, id.toUpperCase())));
    const author = field('Author credit (optional)', 'input', '', { maxLength: 300 });
    const language = field('Book language', 'input', 'en', { maxLength: 40 });
    const error = el('p'); error.setAttribute('role', 'alert');
    dialogs.openDialog({ title: 'Export this reading path', body: [el('p', 'A readable book, not a playable save: only this path’s prose and placed images. Private facts, motives, directions, questions and other paths are excluded. No AI request. EPUB images have their own pages; prose stays resizable.'), format.wrapper, author.wrapper, language.wrapper, error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Download book', className: 'btn-primary', pendingLabel: 'Building book…', onClick: async (close) => {
        if (getCurrent()?.id !== story.id || getCurrent()?.revision !== story.revision) { error.textContent = 'The story changed. Reopen export to choose the current path.'; return; }
        const result = await runAction(async (live) => {
          const query = new URLSearchParams({ author: author.control.value.trim(), language: language.control.value.trim(), expected_revision: story.revision, branch_id: story.active_branch_id });
          await downloadFile(`/api/fiction/${story.id}/book/${format.control.value}?${query}`, `InkMorrow-story.${format.control.value}`, live); return {};
        });
        if (result.ok) close(true); else if (!result.stale) error.textContent = result.error || 'Not exported.';
      } },
    ] });
  }
  return { illustrate, exportBook };
}
