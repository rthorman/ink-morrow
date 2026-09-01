'use strict';

import { loadScript, mockFetch, jsonResponse, dialogAction } from './dom-helpers.js';

function catalogueFetch() {
  return mockFetch([
    {
      match: (url, options) => String(url).endsWith('/api/worlds') && (!options || options.method === 'GET'),
      response: jsonResponse(200, { worlds: [
        { id: 'w1', name: 'Home World', description: '', image_status: 'none' },
        { id: 'w2', name: 'Other World', description: '', image_status: 'none' },
      ] }),
    },
    {
      match: (url, options) => String(url).endsWith('/api/characters') && (!options || options.method === 'GET'),
      response: jsonResponse(200, { characters: [
        { id: 'c1', name: 'Resident One', world_id: 'w1', image_status: 'none' },
        { id: 'c2', name: 'Resident Two', world_id: 'w1', image_status: 'none' },
        { id: 'c3', name: 'Outsider', world_id: 'w2', image_status: 'none' },
      ] }),
    },
    {
      match: (url, options) => String(url).endsWith('/api/stories') && (!options || options.method === 'GET'),
      response: jsonResponse(200, { stories: [
        { id: 's1', title: 'Portable Tale', world_id: 'w1', characters: [], tone: 'romantic', page_count: 2, image_status: 'none' },
      ] }),
    },
    { match: '/api/storage', response: jsonResponse(200, { stories: [] }) },
  ]);
}

const exportPlan = {
  token: 'export-token',
  filename: 'home-world.scribetribe',
  download_url: '/api/transfers/exports/export-token',
  estimated_bytes: 4096,
  options: { include_visuals: true, include_audio: false, include_working_history: false },
  exposure: {
    worlds: 1, characters: 2, stories: 0, pages: 0, continuity_rows: 0,
    images: 1, audio_files: 0, includes_device_settings: false,
    excluded: ['API keys', 'credentials', 'passwords', 'paid-action consent'],
    external_worlds: [],
  },
};

describe('portable archive UX', () => {
  let fw;
  let fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = catalogueFetch();
    fw = await loadScript();
    await fw.loadWorlds();
    await fw.loadCharacters();
    await fw.loadStories();
  });

  it('opens a scoped world export with only its residents and reviews exposure before download', async () => {
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/api/transfers/exports/plan')) return Promise.resolve(jsonResponse(200, exportPlan));
      if (String(url).endsWith('/api/worlds')) return Promise.resolve(jsonResponse(200, { worlds: fw.state().worlds }));
      if (String(url).endsWith('/api/characters')) return Promise.resolve(jsonResponse(200, { characters: fw.state().characters }));
      if (String(url).endsWith('/api/stories')) return Promise.resolve(jsonResponse(200, { stories: fw.state().stories }));
      if (String(url).endsWith('/api/storage')) return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    fw.openDataExport({ scope: 'world', id: 'w1' });
    const dialog = document.querySelector('.dialog-manager');
    expect(dialog.hidden).toBe(false);
    expect(document.getElementById('transferExportScope').disabled).toBe(true);
    expect(document.getElementById('transferIncludeVisuals').checked).toBe(true);
    expect(document.getElementById('transferIncludeAudio').checked).toBe(false);
    expect(document.getElementById('transferIncludeHistory').checked).toBe(false);
    expect([...dialog.querySelectorAll('.transfer-resident')].map((label) => label.textContent)).toEqual(['Resident One', 'Resident Two']);
    expect(dialog.textContent).toContain('Never included: API keys');

    expect(await dialogAction('Review export')).toBe(true);
    const planCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/transfers/exports/plan'));
    const payload = JSON.parse(planCall[1].body);
    expect(payload).toMatchObject({
      scope: 'world', id: 'w1', include_visuals: true,
      include_audio: false, include_working_history: false,
      character_ids: ['c1', 'c2'],
    });
    expect(document.querySelector('.dialog-manager__title').textContent).toBe('Review what the archive exposes');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('Continuity rows');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('Optional material included: paintings');
    expect(document.querySelector('.dialog-manager__body').textContent).not.toContain('working history.');
  });

  it('offers the same scoped flow from card More menus', () => {
    const worldCard = document.querySelector('#worldsList .item-card');
    const exportAction = [...worldCard.querySelectorAll('.card-more__item')]
      .find((button) => button.textContent.includes('Export portable'));
    expect(exportAction).toBeTruthy();
    exportAction.click();
    expect(document.getElementById('transferExportScope').value).toBe('world');
    expect(document.getElementById('transferExportEntity').value).toBe('w1');
  });

  it('defaults a full backup to audio and working history, and sends only the settings whitelist object', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/api/transfers/exports/plan')) {
        return Promise.resolve(jsonResponse(200, {
          ...exportPlan,
          options: { include_visuals: true, include_audio: true, include_working_history: true },
          exposure: { ...exportPlan.exposure, audio_files: 1, includes_device_settings: true },
        }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    fw.setSetting('storyFont', 'georgia');
    fw.openDataExport();
    expect(document.getElementById('transferExportScope').value).toBe('full');
    expect(document.getElementById('transferIncludeAudio').checked).toBe(true);
    expect(document.getElementById('transferIncludeHistory').checked).toBe(true);
    expect(await dialogAction('Review export')).toBe(true);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/transfers/exports/plan'));
    const payload = JSON.parse(call[1].body);
    expect(payload.settings.storyFont).toBe('georgia');
    expect(payload.settings).not.toHaveProperty('paidConsent');
  });

  it('shows explicit collision choices and commits the selected whole-entity resolution', async () => {
    const review = {
      token: 'import-token', scope: 'world', expanded_bytes: 1024,
      options: { include_working_history: false },
      exposure: { worlds: 1, characters: 0, stories: 0, pages: 0, continuity_rows: 0, images: 0, audio_files: 0 },
      settings_available: true,
      summary: { entities: 1, assets: 0, conflicts: 1 },
      collisions: [{
        key: 'world:w1', kind: 'world', id: 'w1', name: 'Home World',
        status: 'conflict', local_id: 'w1', local_name: 'Home World',
        recommended: 'copy', choices: ['keep', 'copy', 'replace'],
        same_name_matches: [{ id: 'w1', name: 'Home World' }],
        replace_impact: { characters: 2, stories: 1 },
      }],
    };
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/api/transfers/imports/import-token/commit')) {
        return Promise.resolve(jsonResponse(200, {
          mode: 'merge', counts: { copied: 0, replaced: 1 },
          settings: { storyFont: 'inter', wordsPerPage: 500 }, safety_backup: null,
        }));
      }
      if (String(url).endsWith('/api/worlds')) return Promise.resolve(jsonResponse(200, { worlds: [] }));
      if (String(url).endsWith('/api/characters')) return Promise.resolve(jsonResponse(200, { characters: [] }));
      if (String(url).endsWith('/api/stories')) return Promise.resolve(jsonResponse(200, { stories: [] }));
      if (String(url).endsWith('/api/storage')) return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    fw.openImportReview(review);
    const select = document.querySelector('[data-resolution="world:w1"]');
    expect(select.value).toBe('copy');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('will not guess at a field or page merge');
    select.value = 'replace';
    expect(await dialogAction('Import archive')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/commit'));
    expect(JSON.parse(call[1].body)).toMatchObject({ mode: 'merge', resolutions: { 'world:w1': 'replace' } });
    expect(fw.loadSettings().storyFont).toBe('inter');
    expect(fw.loadSettings().wordsPerPage).toBe(500);
  });

  it('disables per-item choices for replace-all and clearly promises the safety backup', () => {
    fw.openImportReview({
      token: 'full-token', scope: 'full', expanded_bytes: 0,
      options: { include_working_history: true }, exposure: {}, settings_available: false,
      summary: { entities: 1, assets: 0 },
      collisions: [{
        key: 'world:w1', kind: 'world', id: 'w1', name: 'Home World', status: 'conflict',
        local_id: 'w1', local_name: 'Home World', recommended: 'copy',
        choices: ['keep', 'copy', 'replace'], same_name_matches: [], replace_impact: {},
      }],
    });
    const mode = [...document.querySelectorAll('.transfer-field select')]
      .find((select) => [...select.options].some((option) => option.value === 'replace_all'));
    mode.value = 'replace_all';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('[data-resolution="world:w1"]').disabled).toBe(true);
    expect(document.querySelector('.transfer-replace-warning').textContent).toContain('automatically creating a safety backup');
    expect(document.querySelector('.transfer-replace-warning').classList.contains('active')).toBe(true);
  });
});
