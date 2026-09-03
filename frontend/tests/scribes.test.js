'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

const SCRIBE = {
  id: 'scribe-1', entity_kind: 'catgirl', name: 'Morrow Bell',
  description: 'A patient keeper of endings.', image_status: 'none', revision_number: 1,
  diction: 'ornate', sentence_rhythm: 'flowing', narrative_distance: 'intimate',
  figurative_language: 'balanced', description_density: 'immersive', dialogue_tendency: 'balanced',
  exposition_style: 'implicit', humor: 'dry', scene_tempo: 'measured',
  progress_appetite: 'develop', tension_tolerance: 'high', aftermath_dwell: 'patient',
  focus_areas: ['interiority', 'consequences'],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('The Tribe UI', () => {
  it('uses Tribe as the collection tab and renders first-class Scribe craft cards', async () => {
    mockFetch([{ match: '/api/scribes', response: jsonResponse(200, { scribes: [SCRIBE] }) }]);
    await loadScript();
    document.getElementById('tribeBtn').click();
    await flush();
    expect(window.location.hash).toBe('#/tribe');
    expect(document.getElementById('tribeBtn').textContent).toBe('Tribe');
    expect(document.getElementById('scribesList').textContent).toContain('Morrow Bell');
    expect(document.getElementById('scribesList').textContent).toContain('Adult catgirl · revision 1');
    expect(document.getElementById('scribesList').textContent).toContain('ornate diction');
  }, 20000);

  it('shows a disabled progress label while AI designs a Scribe', async () => {
    let finishDraft;
    const fetchMock = mockFetch();
    fetchMock.mockImplementation((url, options = {}) => {
      if (url === '/api/ai/scribe' && options.method === 'POST') {
        return new Promise((resolve) => {
          finishDraft = () => resolve(jsonResponse(200, { scribe: SCRIBE, cost_usd: 0.001 }));
        });
      }
      return Promise.resolve(jsonResponse(200, { scribes: [], worlds: [], characters: [], stories: [] }));
    });
    await loadScript();
    const button = document.getElementById('scribeAiBtn');
    const originalLabel = button.textContent;
    button.click();
    expect(await paidReview('confirm')).toBe(true);
    await flush();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('designing');

    finishDraft();
    await flush();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.textContent).toBe(originalLabel);
  });
});
