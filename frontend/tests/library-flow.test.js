'use strict';

// Library collection-first behavior (D10): returning users see the story
// collection before the long creation form; New story reveals it and
// focuses Title; a genuinely empty library opens the form with guidance.

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

function storiesResponse(...stories) {
  return jsonResponse(200, {
    stories,
    worlds: [],
    characters: [],
  });
}

describe('Library story creation disclosure', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
  });

  it('with stories present, the collection comes first and the form waits behind New story', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse({ id: 's1', title: 'Existing Tale', page_count: 1 })));
    await fw.loadStories();
    const wrap = document.getElementById('storyCreateWrap');
    const btn = document.getElementById('storyNewBtn');
    expect(wrap.hidden).toBe(true); // collection-first
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('storiesList').textContent).toContain('Existing Tale');

    // Activating New story reveals the form and focuses the first field
    btn.click();
    expect(wrap.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.getElementById('storyTitle'));

    // The choice survives a re-render (renderStories never re-collapses)
    fw.renderStories?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(wrap.hidden).toBe(false);
  });

  it('an empty library opens the form for the novice, with honest guidance', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap').hidden).toBe(false);
    // The empty state does not claim the user pressed anything: the button
    // still reads collapsed, the form is simply open.
    expect(document.getElementById('storyNewBtn').getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('storiesList').textContent).toContain('shelves are bare');
  });

  it('after a story is created the library is collection-first again', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse()));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap').hidden).toBe(false);

    // A story now exists (e.g. created in another window): the form folds
    document.getElementById('storyNewBtn').setAttribute('aria-expanded', 'false');
    fetchMock.mockImplementation(() => Promise.resolve(storiesResponse({ id: 's2', title: 'New Tale', page_count: 0 })));
    await fw.loadStories();
    expect(document.getElementById('storyCreateWrap').hidden).toBe(true);
    expect(document.getElementById('storiesList').textContent).toContain('New Tale');
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
