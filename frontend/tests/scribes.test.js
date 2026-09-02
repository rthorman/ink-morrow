'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

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
});
