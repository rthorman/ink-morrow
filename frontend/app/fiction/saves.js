import { apiFetch } from '../core/api.js';
import { el, field } from './dom.js';
import { downloadFile } from './media.js';

const MIME = 'application/vnd.inkmorrow.fiction-save';
export function createSaveDialogs({ dialogs, getCurrent, getLive, runAction }) {
  const warning = 'A playable save is unencrypted and contains all paths, hidden story truth, private motives and your directions. Keep it private. It includes illustrations and recorded spend, but no credentials, payment consent or pending requests.';
  function save() {
    const story = getCurrent(); if (!story || story.pending) return;
    const error = el('p'); error.setAttribute('role', 'alert');
    dialogs.openDialog({ title: 'Download a playable save', body: [el('p', warning), el('p', 'For a reader-safe book instead, choose Export this reading path. Save limits: 10,000 moments, 64 MB file / 128 MB expanded.'), error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Download private save', className: 'btn-primary', pendingLabel: 'Preparing save…', onClick: async (close) => {
        if (getCurrent()?.id !== story.id) return;
        const result = await runAction(async (live) => { await downloadFile(`/api/fiction/${story.id}/save`, 'InkMorrow-story.inkmorrow5', live); return {}; });
        if (result.ok) close(true); else if (!result.stale) error.textContent = result.error || 'Not saved.';
      } },
    ] });
  }
  function importSave() {
    const live = getLive();
    const file = field('InkMorrow 5 save file (up to 64 MB)', 'input', '', { type: 'file', accept: '.inkmorrow5' });
    const error = el('p'); error.setAttribute('role', 'alert');
    const post = async (path, selected) => {
      const response = await apiFetch(`/api/fiction/saves/${path}`, { method: 'POST', headers: { 'Content-Type': MIME }, body: selected });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Import failed.'); return body;
    };
    dialogs.openDialog({ title: 'Import a playable save', body: [el('p', 'Import creates a separate story. Nothing is overwritten and no AI request is started. Earlier InkMorrow databases and .inkmorrow archives are not accepted.'), file.wrapper, error], actions: [
      { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
      { label: 'Check this save', className: 'btn-primary', pendingLabel: 'Checking save…', onClick: async () => {
        const selected = file.control.files?.[0];
        if (!selected || selected.size > 64 * 1024 * 1024) { error.textContent = 'Choose an .inkmorrow5 save no larger than 64 MB.'; return; }
        try {
          const { preview } = await post('preview', selected); if (!live()) return;
          const failure = el('p'); failure.setAttribute('role', 'alert');
          dialogs.openDialog({ title: `Import ${preview.title}?`, body: [el('p', `${preview.paths} paths · ${preview.moments} moments · ${preview.images} images`), el('p', warning), failure], actions: [
            { label: 'Cancel', className: 'btn-secondary', onClick: (close) => close(true) },
            { label: 'Import as a new story', className: 'btn-primary', pendingLabel: 'Importing…', onClick: async (close) => {
              try {
                const { story } = await post('import', selected); if (!live()) return;
                close(true); window.location.hash = `#/story/${encodeURIComponent(story.id)}`;
              } catch (issue) { if (live()) failure.textContent = `${issue.message} If the connection was lost, check Your stories before retrying: the copy may already exist.`; }
            } },
          ] });
        } catch (issue) { if (live()) error.textContent = issue.message; }
      } },
    ] });
  }
  return { save, importSave };
}
