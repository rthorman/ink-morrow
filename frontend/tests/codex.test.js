'use strict';

import { loadScript, mockFetch, jsonResponse, dialogAction, paidReview } from './dom-helpers.js';

const STORY = { id: 's1', title: 'The Ledger', page_count: 3, total_cost_usd: 0, characters: [] };

function memory() {
  const provenance = { page_id: 'p1', page_number: 1, page_revision_id: 'r1', evidence: [{ quote: 'Mara enters the glass harbor' }] };
  return {
    schema_version: 2,
    world: { id: 'w1', name: 'Old Harbor', genre: 'Gothic', setting: 'A glass coast' },
    characters: [{
      id: 'c1', name: 'Mara', role: 'mc', relation: null, description: 'A cartographer',
      personality: 'Patient', appearance: 'Ink-stained gloves', background: '',
      current: { location: 'glass harbor', condition: null, knowledge: [], possessions: [], personality: 'Patient', appearance: 'Ink-stained gloves', relationship_to_mc: null, relationships: {} },
      evidence: { location: provenance },
    }],
    goals: [{ id: 'g1', text: 'Chart the black tide', status: 'active', provenance }],
    threads: [], world_facts: [], arcs: [],
    events: [{ id: 'e1', text: 'Mara enters the glass harbor.', importance: 'major', type: 'transition', ...provenance }],
    corrections: [], author_canon: [], issues: [],
    history_counts: { events: 1, summaries: 1 },
    coverage: {
      total: 3, ready: 1, memory_cost_usd: 0.01,
      pages: [
        { page_id: 'p1', page_revision_id: 'r1', page_number: 1, status: 'ready' },
        { page_id: 'p2', page_revision_id: 'r2', page_number: 2, status: 'failed', error: 'Bad shape' },
        { page_id: 'p3', page_revision_id: 'r3', page_number: 3, status: 'pending' },
      ],
      failed: [{ page_id: 'p2', page_revision_id: 'r2', page_number: 2, error: 'Bad shape' }],
    },
  };
}

describe('PR13 Codex', () => {
  it('separates foundations and bounded remembered canon with page evidence links', async () => {
    const fetchMock = mockFetch([
      { match: '/stories/s1/continuity/templates', response: jsonResponse(200, { templates: [] }) },
      { match: '/stories/s1/continuity', response: jsonResponse(200, { continuity: memory() }) },
      { match: '/stories/s1/pages', response: jsonResponse(200, { pages: [] }) },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterCodex({ storyId: 's1' });

    expect(document.getElementById('codexFoundations').textContent).toContain('Old Harbor');
    fw.selectCodexTab('canon');
    expect(document.getElementById('codexCanon').textContent).toContain('Mara enters the glass harbor');
    expect(document.querySelector('.codex-evidence__link').textContent).toBe('Page 1');
    expect(document.getElementById('codexCoverage').textContent).toContain('Prepared next-page prose is not committed');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/stories/s1/pages')).toBe(false);

    document.getElementById('codexSearch').value = 'black tide';
    document.getElementById('codexSearch').dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('#codexCanon .codex-fact:not([hidden])')].some((card) => card.textContent.includes('Chart the black tide'))).toBe(true);
    expect([...document.querySelectorAll('#codexCanon .codex-fact:not([hidden])')].some((card) => card.textContent.includes('glass harbor.'))).toBe(false);
  });

  it('applies a separate correction and keeps deterministic impacts as author-disposition warnings', async () => {
    const after = memory();
    after.characters[0].current.location = 'mountain refuge';
    after.corrections = [{ id: 'x1', scope: 'character', subject_id: 'c1', field: 'location', value: 'mountain refuge', evidence: [{ page_revision_id: 'r1', quote: 'Mara enters the glass harbor' }] }];
    after.issues = [{ id: 'i1', correction_id: 'x1', status: 'open', detail: { page_number: 3, matched_terms: ['glass harbor'], reason: 'Later prose mentions the prior state.' } }];
    const fetchMock = mockFetch([
      { match: (url, options) => url === '/api/stories/s1/continuity/corrections' && options.method === 'POST', response: jsonResponse(201, { correction: after.corrections[0], issues: after.issues, continuity: after }) },
      { match: (url, options) => url === '/api/stories/s1/continuity/issues/i1' && options.method === 'PATCH', response: jsonResponse(200, { issue: { ...after.issues[0], status: 'acknowledged' } }) },
      { match: '/stories/s1/continuity/templates', response: jsonResponse(200, { templates: [] }) },
      { match: '/stories/s1/continuity', response: jsonResponse(200, { continuity: memory() }) },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterCodex({ storyId: 's1' });
    fw.selectCodexTab('canon');
    const location = [...document.querySelectorAll('.codex-fact')].find((card) => card.textContent.includes('Mara · Location'));
    location.querySelector('.codex-fact__correct').click();
    const value = document.querySelector('.codex-correction-form textarea');
    value.value = 'mountain refuge';
    await dialogAction('Apply');

    expect(document.getElementById('codexCorrections').textContent).toContain('mountain refuge');
    expect(document.getElementById('codexIssues').textContent).toContain('Later prose mentions the prior state');
    const correctionCall = fetchMock.mock.calls.find(([url]) => url === '/api/stories/s1/continuity/corrections');
    expect(JSON.parse(correctionCall[1].body)).toMatchObject({ scope: 'character', field: 'location', value: 'mountain refuge' });
    expect(correctionCall[1].body).not.toContain('prose');

    [...document.querySelectorAll('#codexIssues button')].find((button) => button.textContent === 'Mark prose intentional').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.some(([url, options]) => url === '/api/stories/s1/continuity/issues/i1' && JSON.parse(options.body).status === 'acknowledged')).toBe(true);
  });

  it('imports only checked template fields and repairs only non-ready pages sequentially', async () => {
    const latest = memory();
    latest.coverage.ready = 3;
    latest.coverage.pages = latest.coverage.pages.map((page) => ({ ...page, status: 'ready' }));
    latest.coverage.failed = [];
    const fetchMock = mockFetch([
      { match: '/providers', response: jsonResponse(200, { roles: [{ role: 'archivist', model_id: 'google/gemini-2.5-flash-lite' }] }) },
      { match: (url, options) => url.includes('/templates/world/w1/import') && options.method === 'POST', response: jsonResponse(201, { snapshot: {}, continuity: memory() }) },
      { match: (url, options) => url.endsWith('/pages/p2/sync') && options.method === 'POST', response: jsonResponse(200, { memory: { status: 'ready', cost_usd: 0.01 } }) },
      { match: (url, options) => url.endsWith('/pages/p3/sync') && options.method === 'POST', response: jsonResponse(200, { memory: { status: 'ready', cost_usd: 0.01 } }) },
      { match: '/stories/s1/continuity/templates', response: jsonResponse(200, { templates: [{ template_kind: 'world', source_template_id: 'w1', changes: [
        { field: 'name', from: 'Old Harbor', to: 'New Harbor' },
        { field: 'setting', from: 'A glass coast', to: 'A basalt coast' },
      ] }] }) },
      { match: '/stories/s1/continuity', response: (() => {
        let count = 0;
        return { ok: true, status: 200, json: () => Promise.resolve({ continuity: count++ ? latest : memory() }) };
      })() },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterCodex({ storyId: 's1' });

    const fields = document.querySelectorAll('.codex-template__change input');
    fields[0].checked = true;
    document.querySelector('.codex-template__form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const importCall = fetchMock.mock.calls.find(([url]) => url.includes('/templates/world/w1/import'));
    expect(JSON.parse(importCall[1].body).fields).toEqual(['name']);

    fw.selectCodexTab('canon');
    document.querySelector('#codexCoverage button').click();
    for (let attempt = 0; attempt < 20 && !document.querySelector('.dialog-manager:not([hidden])'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('google/gemini-2.5-flash-lite');
    await paidReview('confirm');
    for (let attempt = 0; attempt < 50 && !fetchMock.mock.calls.some(([url]) => url.endsWith('/pages/p3/sync')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const repairs = fetchMock.mock.calls.filter(([url]) => /\/pages\/p[123]\/sync$/.test(url)).map(([url]) => url);
    expect(repairs).toEqual(['/api/stories/s1/continuity/pages/p2/sync', '/api/stories/s1/continuity/pages/p3/sync']);
    for (const call of fetchMock.mock.calls.filter(([url]) => /\/pages\/p[23]\/sync$/.test(url))) {
      expect(JSON.parse(call[1].body)).toEqual({});
    }
  });

  it('edits manuscript-local foundations and creates versioned author canon', async () => {
    const afterFoundation = memory();
    afterFoundation.world.setting = 'A coast ruled by bells';
    const afterCanon = memory();
    afterCanon.author_canon = [{
      id: 'a1', kind: 'world_event', subject_id: null, status: 'active',
      revision_number: 1, title: 'The Red Eclipse',
      value: 'It happened four winters before page one.', note: 'Fixed chronology.',
    }];
    const fetchMock = mockFetch([
      { match: (url, options) => url.endsWith('/templates/world/w1') && options.method === 'PUT', response: jsonResponse(200, { snapshot: {}, continuity: afterFoundation }) },
      { match: (url, options) => url.endsWith('/author-canon') && options.method === 'POST', response: jsonResponse(201, { entry: afterCanon.author_canon[0], continuity: afterCanon }) },
      { match: '/stories/s1/continuity/templates', response: jsonResponse(200, { templates: [] }) },
      { match: '/stories/s1/continuity', response: jsonResponse(200, { continuity: memory() }) },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterCodex({ storyId: 's1' });

    const settingCard = [...document.querySelectorAll('#codexFoundations .codex-fact')]
      .find((card) => card.textContent.includes('Setting'));
    settingCard.querySelector('.codex-fact__edit').click();
    document.querySelector('.codex-correction-form textarea').value = 'A coast ruled by bells';
    await dialogAction('Save foundation');
    expect(JSON.parse(fetchMock.mock.calls.find(([url, options]) => url.endsWith('/templates/world/w1') && options.method === 'PUT')[1].body))
      .toEqual({ values: { setting: 'A coast ruled by bells' } });

    fw.selectCodexTab('corrections');
    [...document.querySelectorAll('#codexAuthorCanon button')].find((button) => button.textContent === 'Add author canon').click();
    const form = document.querySelector('.codex-correction-form');
    form.querySelector('select').value = 'world_event';
    form.querySelector('input').value = 'The Red Eclipse';
    form.querySelectorAll('textarea')[0].value = 'It happened four winters before page one.';
    form.querySelectorAll('textarea')[1].value = 'Fixed chronology.';
    await dialogAction('Add to canon');

    const call = fetchMock.mock.calls.find(([url, options]) => url.endsWith('/author-canon') && options.method === 'POST');
    expect(JSON.parse(call[1].body)).toMatchObject({ kind: 'world_event', title: 'The Red Eclipse' });
    expect(document.getElementById('codexAuthorCanon').textContent).toContain('It happened four winters');
  });
});
