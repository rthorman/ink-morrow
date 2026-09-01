'use strict';

// 4.0: every entry point opens the same complete Library manuscript start.

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

function storiesResponse(...stories) {
  return jsonResponse(200, {
    stories,
    worlds: [],
    characters: [],
  });
}

describe('Library management and canonical manuscript creation', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
  });

  it('shows existing stories and routes the Desk New story control to the canonical sheet', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse({ id: 's1', title: 'Existing Tale', page_count: 1 })));
    await fw.loadStories();
    const btn = document.getElementById('storyNewBtn');
    expect(document.getElementById('storyCreateWrap')).toBeNull();
    expect(document.getElementById('storiesList').textContent).toContain('Existing Tale');

    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('manuscriptStartSheet').hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('startManualOpening'));
  });

  it('an empty manuscript catalogue returns to the Library one-sheet without duplicating the Desk form', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap')).toBeNull();
    expect(document.getElementById('storiesList').textContent).toContain('No manuscripts are bound');
    document.querySelector('#storiesList button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.hash).toBe('#/library');
    expect(document.getElementById('manuscriptStartSheet').hidden).toBe(false);
    expect(document.getElementById('storyCreateWrap')).toBeNull();
  });

  it('redirects a bare first-story Desk visit to the complete canonical sheet', async () => {
    window.history.replaceState(null, '', window.location.href.split('#')[0] + '#/desk');
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('manuscriptStartSheet').hidden).toBe(false);
    expect(document.getElementById('manuscriptStartTone').options).toHaveLength(3);
    expect(document.getElementById('manuscriptStartTone').value).toBe('fade-to-black');
    expect(document.getElementById('castModeCentered')).toBeTruthy();
    expect(document.getElementById('castModeEnsemble')).toBeTruthy();
  });
});

describe('Bounded catalog previews', () => {
  it('long world and character descriptions clamp on the card, full text intact', async () => {
    window.localStorage.clear();
    const longWorld = 'A '.repeat(400) + 'long description';
    const longChar = 'B '.repeat(400) + 'long biography';
    const fetchMock = mockFetch();
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/api/worlds')) {
        return Promise.resolve(jsonResponse(200, { worlds: [{ id: 'w1', name: 'Long World', description: longWorld, genre: 'g', setting: 's', image_status: 'none' }] }));
      }
      if (String(url).includes('/api/characters')) {
        return Promise.resolve(jsonResponse(200, { characters: [{ id: 'c1', name: 'Long Char', description: longChar, world_id: null, image_status: 'none' }] }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    const fw = await loadScript();
    await fw.loadWorlds();
    await fw.loadCharacters();

    const worldDesc = document.querySelector('#worldsList .item-card .item-card__desc');
    const charDesc = document.querySelector('#charactersList .item-card .item-card__desc');
    expect(worldDesc).toBeTruthy();
    expect(charDesc).toBeTruthy();
    // The FULL text is in the DOM for assistive technology; only the box clamps
    expect(worldDesc.textContent).toBe(longWorld);
    expect(charDesc.textContent).toBe(longChar);
    // The clamp is carried by the class (real-browser computed-style and
    // bounding checks live in the Playwright matrix, where line-clamp runs).
  });
});
