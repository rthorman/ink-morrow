'use strict';

import { loadScript, mockFetch, jsonResponse, dialogAction } from './dom-helpers.js';

const STORAGE = {
  stories: [
    {
      id: 's1',
      title: 'The Kept Tale',
      updated_at: '2026-08-30 10:00:00',
      audiobook: {
        story_id: 's1',
        status: 'ready',
        duration_s: 5400,
        size_bytes: 42 * 1024 * 1024,
        cost_usd: 0.75,
        model: 'or/voice-1',
        voice: 'amber',
        updated_at: '2026-08-30 10:00:00',
        stale: false,
        file_missing: false,
      },
      plates: [
        { page_number: 2, image_prompt: 'A candlelit hall.', size_bytes: 2048 },
        { page_number: 5, image_prompt: null, size_bytes: 4096 },
      ],
    },
    {
      id: 's2',
      title: 'The Bare Tale',
      updated_at: '2026-08-29 10:00:00',
      audiobook: null,
      plates: [],
    },
  ],
};

describe('Bookshelf page', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch([{ match: '/storage', response: jsonResponse(200, STORAGE) }]);
    fw = await loadScript();
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
  });

  function entries() {
    return [...document.querySelectorAll('.bookshelf-entry')];
  }

  it('lists every tale with its kept things, honest sizes, and download links', async () => {
    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));

    expect(entries()).toHaveLength(2);
    const kept = entries()[0];
    expect(kept.querySelector('h3').textContent).toBe('The Kept Tale');
    expect(kept.querySelector('.bookshelf-audio p').textContent).toContain('1 h 30 min');
    expect(kept.querySelector('.bookshelf-audio p').textContent).toContain('42 MB');
    expect(kept.querySelector('.bookshelf-audio p').textContent).toContain('$0.7500');
    const download = kept.querySelector('.bookshelf-audio a');
    expect(download.getAttribute('href')).toBe('/api/stories/s1/audiobook/audio');
    expect(download.textContent).toBe('Download');

    const plates = kept.querySelectorAll('.bookshelf-plate');
    expect(plates).toHaveLength(2);
    const firstPlate = plates[0];
    expect(firstPlate.querySelector('img').getAttribute('src')).toBe('/api/stories/s1/pages/2/image');
    expect(firstPlate.querySelector('img').getAttribute('alt')).toBe('A candlelit hall.');
    expect(firstPlate.textContent).toContain('Page 2');
    expect(firstPlate.querySelector('a').getAttribute('href')).toBe('/api/stories/s1/pages/2/image?download=1');

    const bare = entries()[1];
    expect(bare.textContent).toContain('No audiobook kept');
    expect(bare.textContent).toContain('No plates kept');
  });

  it('deleting the audiobook asks, then clears it from the shelf', async () => {
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/audiobook') && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      if (String(url).includes('/storage')) return Promise.resolve(jsonResponse(200, STORAGE));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));
    const deleteBtn = entries()[0].querySelector('.bookshelf-audio button');
    deleteBtn.click();
    expect(await dialogAction('Delete audiobook')).toBe(true);

    const call = global.fetch.mock.calls.find(([url, options]) => String(url).includes('/audiobook') && options.method === 'DELETE');
    expect(String(call[0])).toContain('/stories/s1/audiobook');
    // The shelf reloaded after the delete
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/storage')).length).toBeGreaterThanOrEqual(2);
  });

  it('deleting a plate warns about renumbering and refreshes an open reader', async () => {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'The Kept Tale', tone: 'romantic', page_count: 3, total_cost_usd: 0 },
      storyPages: [
        { page_number: 1, content: 'One.', user_input: null },
        { page_number: 2, content: '', image_media_type: 'image/png', cost_usd: 0 },
        { page_number: 3, content: 'Three.', user_input: null },
      ],
      currentPage: 3,
    });

    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/pages/2') && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      if (String(url).includes('/storage')) return Promise.resolve(jsonResponse(200, STORAGE));
      if (String(url).endsWith('/s1/pages')) return Promise.resolve(jsonResponse(200, { pages: [{ page_number: 1, content: 'One.', user_input: null }, { page_number: 2, content: 'Three.', user_input: null }] }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));
    entries()[0].querySelectorAll('.bookshelf-plate button')[0].click();
    expect(await dialogAction('Delete page 2')).toBe(true);

    const delCall = global.fetch.mock.calls.find(([url, options]) => String(url).includes('/pages/2') && options.method === 'DELETE');
    expect(delCall).toBeTruthy();
    // The open reader reloaded onto the renumbered pages
    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().currentPage).toBe(2);
  });

  it('a refused confirmation deletes nothing', async () => {
    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));
    entries()[0].querySelector('.bookshelf-audio button').click();
    expect(await dialogAction('Cancel')).toBe(true);
    expect(global.fetch.mock.calls.some(([url, options]) => options && options.method === 'DELETE')).toBe(false);
  });

  it('surfaces a loading failure instead of an empty shelf', async () => {
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/storage')) return Promise.resolve(jsonResponse(500, { error: 'The shelf collapsed' }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('bookshelfList').textContent).toContain('The shelf collapsed');
  });
});
