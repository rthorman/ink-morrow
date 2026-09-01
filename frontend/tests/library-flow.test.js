'use strict';

// 3.0.5 separation: Library manages stories/assets; the complete creation
// form (including maturity) lives at the writing desk.

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

function storiesResponse(...stories) {
  return jsonResponse(200, {
    stories,
    worlds: [],
    characters: [],
  });
}

describe('Library management and Write story creation', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
  });

  it('shows existing stories in Library while creation remains at Write', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse({ id: 's1', title: 'Existing Tale', page_count: 1 })));
    await fw.loadStories();
    const wrap = document.getElementById('storyCreateWrap');
    const btn = document.getElementById('storyNewBtn');
    expect(wrap.closest('#writeSection')).toBeTruthy();
    expect(wrap.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('storiesList').textContent).toContain('Existing Tale');

    // The Write control reveals the form and focuses its first field.
    btn.click();
    expect(wrap.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.getElementById('storyTitle'));

    // Library re-rendering never closes a draft at the writing desk.
    fw.renderStories?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(wrap.hidden).toBe(false);
  });

  it('an empty manuscript catalogue returns to the Library one-sheet without duplicating the Desk form', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap').hidden).toBe(true);
    expect(document.getElementById('storyNewBtn').getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('storiesList').textContent).toContain('No manuscripts are bound');
    document.querySelector('#storiesList button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.hash).toBe('#/library');
    expect(document.getElementById('manuscriptStartSheet').hidden).toBe(false);
    expect(document.getElementById('storyCreateWrap').hidden).toBe(true);
  });

  it('opens the complete form automatically at Write for a first story', async () => {
    window.history.replaceState(null, '', window.location.href.split('#')[0] + '#/desk');
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap').hidden).toBe(false);
    expect(document.getElementById('storyTone').options).toHaveLength(3);
    expect(document.getElementById('storyTone').value).toBe('fade-to-black');
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
