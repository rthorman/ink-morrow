// Portable archives and full backup/restore.  Exports are reviewed before a
// streamed download starts; imports are staged and collision-planned before
// the first database write.  This feature never calls an AI provider.

import { formatMb } from '../core/dom.js';

const SCOPE_LABELS = {
  full: 'Everything — full backup',
  world: 'One world and chosen residents',
  character: 'One character and their home world',
  story: 'One story and all of its dependencies',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function labeledControl(labelText, control) {
  const label = element('label', 'transfer-field');
  label.append(element('span', 'transfer-field__label', labelText), control);
  return label;
}

function toggle(id, labelText, hint) {
  const label = element('label', 'toggle-row transfer-toggle');
  label.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  const copy = element('span');
  copy.appendChild(document.createTextNode(labelText));
  if (hint) copy.append(element('small', 'transfer-toggle__hint', hint));
  label.append(input, copy);
  return { label, input };
}

function exposureList(exposure) {
  const list = element('dl', 'transfer-exposure');
  const rows = [
    ['Worlds', exposure.worlds],
    ['Characters', exposure.characters],
    ['Stories', exposure.stories],
    ['Pages', exposure.pages],
    ['Continuity rows', exposure.continuity_rows],
    ['Images', exposure.images],
    ['Audio files', exposure.audio_files],
  ];
  for (const [label, value] of rows) {
    const wrap = element('div');
    wrap.append(element('dt', '', label), element('dd', '', String(value || 0)));
    list.appendChild(wrap);
  }
  return list;
}

export function createTransfer({ api, state, notify, features, dialogs }) {
  const { apiCall, apiFetch, API_BASE_URL } = api;
  const { showError, showSuccess } = notify;
  let importing = false;

  function collectionFor(scope) {
    if (scope === 'world') return state.data.worlds;
    if (scope === 'character') return state.data.characters;
    if (scope === 'story') return state.data.stories;
    return [];
  }

  function entityName(scope, row) {
    return scope === 'story' ? row.title : row.name;
  }

  function openExport(preset = {}) {
    const body = element('div', 'transfer-dialog');
    const intro = element('p', 'transfer-intro',
      'Build a portable ScribeTribe archive. Nothing is sent to an AI provider; the file is assembled locally and downloaded by your browser.');
    body.appendChild(intro);

    const scope = document.createElement('select');
    scope.id = 'transferExportScope';
    for (const [value, label] of Object.entries(SCOPE_LABELS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      scope.appendChild(option);
    }
    scope.value = preset.scope || 'full';
    scope.disabled = Boolean(preset.scope);
    body.appendChild(labeledControl('What to export', scope));

    const entitySelect = document.createElement('select');
    entitySelect.id = 'transferExportEntity';
    const entityField = labeledControl('Choose the item', entitySelect);
    body.appendChild(entityField);

    const residents = element('fieldset', 'transfer-fieldset');
    residents.appendChild(element('legend', '', 'Residents to include'));
    const residentList = element('div', 'transfer-residents');
    residents.appendChild(residentList);
    body.appendChild(residents);

    const visuals = toggle('transferIncludeVisuals', 'Include paintings', 'World scenes, portraits, covers, and story plates.');
    const audio = toggle('transferIncludeAudio', 'Include audiobook audio', 'Always an explicit choice; MP3 files can dominate archive size.');
    const history = toggle('transferIncludeHistory', 'Include working history', 'Author directions, prepared pages, prompts, model/token/cost traces, and continuity diagnostics.');
    visuals.input.checked = true;
    audio.input.checked = scope.value === 'full';
    history.input.checked = scope.value === 'full';
    body.append(visuals.label, audio.label, history.label);

    const privacy = element('div', 'transfer-privacy');
    privacy.append(
      element('h3', '', 'Before the file leaves this machine'),
      element('p', '', 'Archives can expose manuscript prose, character and world notes, relationships, maturity choices, and any included media. Working history can also expose your private directions and provider usage.'),
      element('p', '', 'Never included: API keys, credentials, secret vault material, passwords, or remembered paid-action consent.')
    );
    body.appendChild(privacy);

    function renderResidents() {
      residentList.textContent = '';
      residents.hidden = scope.value !== 'world' || !entitySelect.value;
      if (residents.hidden) return;
      const choices = state.data.characters.filter((character) => character.world_id === entitySelect.value);
      if (!choices.length) {
        residentList.appendChild(element('p', 'setting-hint', 'This world has no resident characters.'));
        return;
      }
      for (const character of choices) {
        const label = element('label', 'transfer-resident');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = character.id;
        checkbox.checked = true;
        label.append(checkbox, document.createTextNode(character.name));
        residentList.appendChild(label);
      }
    }

    function renderEntities() {
      const collection = collectionFor(scope.value);
      entitySelect.textContent = '';
      entityField.hidden = scope.value === 'full';
      if (scope.value === 'full') {
        renderResidents();
        return;
      }
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = collection.length ? '— Choose —' : `— No ${scope.value}s available —`;
      entitySelect.appendChild(placeholder);
      for (const row of collection) {
        const option = document.createElement('option');
        option.value = row.id;
        option.textContent = entityName(scope.value, row);
        entitySelect.appendChild(option);
      }
      if (preset.id && collection.some((row) => row.id === preset.id)) {
        entitySelect.value = preset.id;
        entitySelect.disabled = true;
      }
      renderResidents();
    }

    scope.addEventListener('change', () => {
      audio.input.checked = scope.value === 'full';
      history.input.checked = scope.value === 'full';
      renderEntities();
    });
    entitySelect.addEventListener('change', renderResidents);
    renderEntities();

    dialogs.openDialog({
      title: preset.scope ? `Export ${SCOPE_LABELS[preset.scope].toLowerCase()}` : 'Export or back up the scriptorium',
      body,
      actions: [
        { label: 'Cancel', className: 'btn-secondary', autofocus: true, onClick: () => dialogs.close(true) },
        {
          label: 'Review export', className: 'btn-primary', onClick: async () => {
            const id = entitySelect.value;
            if (scope.value !== 'full' && !id) {
              showError(`Choose a ${scope.value} to export.`);
              return;
            }
            const payload = {
              scope: scope.value,
              ...(scope.value === 'full' ? {} : { id }),
              include_visuals: visuals.input.checked,
              include_audio: audio.input.checked,
              include_working_history: history.input.checked,
              ...(scope.value === 'full' ? { settings: state.settings } : {}),
            };
            if (scope.value === 'world') {
              payload.character_ids = [...residentList.querySelectorAll('input:checked')].map((input) => input.value);
            }
            try {
              const plan = await apiCall('/transfers/exports/plan', 'POST', payload);
              openExportReview(plan, preset);
            } catch (error) {
              showError(error.message);
            }
          },
        },
      ],
    });
  }

  function openExportReview(plan, preset) {
    const body = element('div', 'transfer-dialog');
    body.append(
      element('p', 'transfer-intro', `Ready to download ${plan.filename}. The estimate below is before ZIP compression.`),
      exposureList(plan.exposure),
      element('p', 'transfer-size', `Estimated archive contents: ${formatMb(plan.estimated_bytes || 0)}`)
    );
    if (plan.exposure.external_worlds?.length) {
      body.appendChild(element('p', 'transfer-warning',
        `Also included for cast dependencies: ${plan.exposure.external_worlds.map((world) => world.name).join(', ')}.`));
    }
    const included = [];
    if (plan.options.include_visuals) included.push('paintings');
    if (plan.options.include_audio) included.push('audio');
    if (plan.options.include_working_history) included.push('working history');
    if (plan.exposure.includes_device_settings) included.push('device settings');
    body.append(
      element('p', '', included.length ? `Optional material included: ${included.join(', ')}.` : 'No optional media or working history is included.'),
      element('p', 'setting-hint', `Excluded: ${(plan.exposure.excluded || []).join(', ')}.`)
    );
    dialogs.openDialog({
      title: 'Review what the archive exposes',
      body,
      actions: [
        { label: 'Back', className: 'btn-secondary', autofocus: true, onClick: () => openExport(preset) },
        {
          label: 'Download archive', className: 'btn-primary', onClick: () => {
            const link = document.createElement('a');
            link.href = plan.download_url;
            link.download = plan.filename;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            dialogs.close(true);
            showSuccess('Archive download started.');
          },
        },
      ],
    });
  }

  async function multipartPreflight(file) {
    const data = new FormData();
    data.append('archive', file, file.name);
    data.append('current_settings', JSON.stringify(state.settings));
    let response;
    try {
      response = await apiFetch(`${API_BASE_URL}/transfers/imports/preflight`, { method: 'POST', body: data });
    } catch {
      throw new Error('Cannot reach the server - is it running?');
    }
    let body = null;
    try { body = await response.json(); } catch { /* error below has fallback */ }
    if (!response.ok) throw new Error(body?.error || `Import preflight failed (${response.status})`);
    return body;
  }

  async function cancelImport(token) {
    try { await apiFetch(`${API_BASE_URL}/transfers/imports/${token}`, { method: 'DELETE' }); } catch { /* token expires safely */ }
  }

  function choiceLabel(choice, collision) {
    if (choice === 'keep') return collision.status === 'identical'
      ? `Reuse local “${collision.local_name}”`
      : 'Keep local version; skip this archive version';
    if (choice === 'copy') return 'Import as a new copy';
    if (choice === 'replace') return 'Replace the local version';
    return 'Add from the archive with its original identity';
  }

  function impactText(impact) {
    if (!impact) return '';
    return Object.entries(impact)
      .filter(([, value]) => value !== false && value !== 0)
      .map(([key, value]) => `${String(key).replaceAll('_', ' ')}: ${value === true ? 'yes' : value}`)
      .join(' · ');
  }

  function collisionRow(collision) {
    const row = element('section', `transfer-collision transfer-collision--${collision.status}`);
    row.dataset.collisionKey = collision.key;
    row.appendChild(element('h3', '', `${collision.name} · ${collision.kind}`));
    const statusCopy = collision.status === 'conflict'
      ? 'Same identity, different contents. ScribeTribe will not guess at a field or page merge.'
      : collision.status === 'identical'
        ? `Identical contents already exist as “${collision.local_name}”.`
        : collision.status === 'same-name'
          ? 'The name already exists, but the identity and contents differ.'
          : 'New to this scriptorium.';
    row.appendChild(element('p', 'transfer-collision__status', statusCopy));
    if (collision.same_name_matches?.length && collision.status !== 'identical') {
      row.appendChild(element('p', 'setting-hint',
        `Same-name local item${collision.same_name_matches.length === 1 ? '' : 's'}: ${collision.same_name_matches.map((entry) => entry.name).join(', ')}.`));
    }
    const impact = impactText(collision.replace_impact);
    if (impact) row.appendChild(element('p', 'setting-hint', `Replacing would affect ${impact}.`));
    const select = document.createElement('select');
    select.dataset.resolution = collision.key;
    for (const choice of collision.choices) {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = choiceLabel(choice, collision) + (choice === collision.recommended ? ' — recommended' : '');
      select.appendChild(option);
    }
    select.value = collision.recommended;
    row.appendChild(labeledControl('Import choice', select));
    return row;
  }

  async function refreshAfterImport(mode) {
    if (mode === 'replace_all') features.write.resetAfterStoryDeletion();
    await features.worlds.loadWorlds();
    await Promise.all([features.characters.loadCharacters(), features.stories.loadStories()]);
    features.bookshelf.loadBookshelf();
  }

  function importResult(result) {
    if (!result.safety_backup) {
      showSuccess('Archive imported. The catalogue has been refreshed.');
      return;
    }
    const body = element('div', 'transfer-dialog');
    body.append(
      element('p', '', 'The full restore is complete. Before replacing anything, ScribeTribe saved the previous local data as a portable safety backup.'),
      element('p', 'setting-hint', 'The backup remains on this machine; download a copy now if you want it elsewhere.')
    );
    const link = element('a', 'btn btn-secondary', 'Download pre-restore safety backup');
    link.href = result.safety_backup.download_url;
    link.download = result.safety_backup.filename;
    body.appendChild(link);
    dialogs.openDialog({
      title: 'Restore complete; old ink preserved',
      body,
      actions: [{ label: 'Done', className: 'btn-primary', autofocus: true, onClick: () => dialogs.close(true) }],
    });
  }

  function openImportReview(review) {
    const body = element('div', 'transfer-dialog transfer-import-review');
    body.append(
      element('p', 'transfer-intro',
        `Staged safely: ${review.summary.entities} linked item${review.summary.entities === 1 ? '' : 's'} and ${review.summary.assets} media file${review.summary.assets === 1 ? '' : 's'} (${formatMb(review.expanded_bytes || 0)} expanded). No local data has changed.`),
      exposureList(review.exposure || {})
    );
    if (review.options.include_working_history) {
      body.appendChild(element('p', 'transfer-warning', 'This archive contains working history, including private author directions and provider traces.'));
    }

    let mode = null;
    if (review.scope === 'full') {
      mode = document.createElement('select');
      const merge = document.createElement('option');
      merge.value = 'merge';
      merge.textContent = 'Merge into what is here (recommended)';
      const replace = document.createElement('option');
      replace.value = 'replace_all';
      replace.textContent = 'Replace everything with this backup';
      mode.append(merge, replace);
      body.appendChild(labeledControl('Full backup restore mode', mode));
      body.appendChild(element('p', 'transfer-warning transfer-replace-warning',
        'Replace everything removes current worlds, characters, stories, pages, paintings, and audio after automatically creating a safety backup.'));
    }

    const restoreSettings = review.settings_available
      ? toggle('transferRestoreSettings', 'Restore device settings', 'Writing model choices and appearance only; no API keys, passwords, or consent flags.')
      : null;
    if (restoreSettings) {
      restoreSettings.input.checked = review.scope === 'full';
      body.appendChild(restoreSettings.label);
    }

    const collisions = element('div', 'transfer-collisions');
    for (const collision of review.collisions) collisions.appendChild(collisionRow(collision));
    body.appendChild(collisions);
    body.appendChild(element('p', 'setting-hint',
      'Dependencies are remapped together. Stories are kept, copied, or replaced as whole manuscripts; pages are never silently spliced.'));

    function updateMode() {
      const replacing = mode?.value === 'replace_all';
      for (const select of collisions.querySelectorAll('[data-resolution]')) select.disabled = replacing;
      body.querySelector('.transfer-replace-warning')?.classList.toggle('active', replacing);
      const commitButton = document.querySelector('.dialog-manager__actions .btn-primary');
      if (commitButton) commitButton.textContent = replacing ? 'Replace all & restore' : 'Import archive';
    }
    mode?.addEventListener('change', updateMode);
    updateMode();

    const freeClose = () => cancelImport(review.token);
    dialogs.openDialog({
      title: 'Review import and resolve collisions',
      body,
      onFreeClose: freeClose,
      actions: [
        {
          label: 'Cancel import', className: 'btn-secondary', autofocus: true, onClick: async () => {
            await cancelImport(review.token);
            dialogs.close(true);
          },
        },
        {
          label: 'Import archive', className: 'btn-primary', onClick: async () => {
            const resolutions = {};
            for (const select of collisions.querySelectorAll('[data-resolution]')) resolutions[select.dataset.resolution] = select.value;
            for (const button of document.querySelectorAll('.dialog-manager__actions button')) button.disabled = true;
            try {
              const result = await apiCall(`/transfers/imports/${review.token}/commit`, 'POST', {
                mode: mode?.value || 'merge',
                resolutions,
                restore_settings: Boolean(restoreSettings?.input.checked),
              });
              if (result.settings) state.restoreSettings(result.settings);
              dialogs.close(true);
              await refreshAfterImport(result.mode);
              importResult(result);
            } catch (error) {
              for (const button of document.querySelectorAll('.dialog-manager__actions button')) button.disabled = false;
              showError(error.message);
            }
          },
        },
      ],
    });
    updateMode(); // action buttons now exist, so its label can reflect the mode
  }

  async function reviewFile(file) {
    if (!file || importing) return;
    importing = true;
    const button = document.getElementById('dataImportBtn');
    const status = document.getElementById('dataTransferStatus');
    if (button) button.disabled = true;
    if (status) status.textContent = `Staging and checking ${file.name} (${formatMb(file.size)})…`;
    try {
      const review = await multipartPreflight(file);
      if (status) status.textContent = 'Archive checked. Review the import choices in the dialog.';
      openImportReview(review);
    } catch (error) {
      if (status) status.textContent = '';
      showError(error.message);
    } finally {
      importing = false;
      if (button) button.disabled = false;
      const input = document.getElementById('dataImportFile');
      if (input) input.value = '';
    }
  }

  function init() {
    document.getElementById('dataExportBtn')?.addEventListener('click', () => openExport());
    const input = document.getElementById('dataImportFile');
    const button = document.getElementById('dataImportBtn');
    button?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => reviewFile(input.files?.[0]));
  }

  return { openExport, openImportReview, reviewFile, init };
}
