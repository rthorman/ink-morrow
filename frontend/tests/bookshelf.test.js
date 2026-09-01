'use strict';

import { loadScript, mockFetch, jsonResponse, dialogAction, paidReview } from './dom-helpers.js';

const STORAGE = {
  stories: [
    {
      id: 's1',
      title: 'The Kept Tale',
      updated_at: '2026-08-30 10:00:00',
      excerpt: 'The first kept line.',
      disk_bytes: 43 * 1024 * 1024,
      asset_count: 4,
      cover: { status: 'ready', size_bytes: 512 * 1024, cost_usd: 0.06, file_missing: false },
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
        {
          asset_id: 'a1', title: 'Candlelit hall', alt_text: 'A candlelit hall.', size_bytes: 2048,
          content_url: '/api/stories/s1/assets/a1/content',
          placements: [{ id: 'pl1', after_page_id: 'p1', after_page_number: 1, ordinal: 1 }],
        },
        {
          asset_id: 'a2', title: null, alt_text: null, size_bytes: 4096,
          content_url: '/api/stories/s1/assets/a2/content', placements: [],
        },
      ],
    },
    {
      id: 's2',
      title: 'The Bare Tale',
      updated_at: '2026-08-29 10:00:00',
      disk_bytes: 0,
      asset_count: 0,
      cover: { status: 'none', size_bytes: null, cost_usd: null, file_missing: false },
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
    expect(firstPlate.querySelector('img').getAttribute('src')).toBe('/api/stories/s1/assets/a1/content');
    expect(firstPlate.querySelector('img').getAttribute('alt')).toBe('A candlelit hall.');
    expect(firstPlate.textContent).toContain('Candlelit hall');
    expect(firstPlate.querySelector('a').getAttribute('href')).toBe('/api/stories/s1/assets/a1/content?download=1');

    const bare = entries()[1];
    expect(bare.textContent).toContain('No audiobook kept');
    expect(bare.textContent).toContain('No story art kept');
  });

  it('opens one story as an asset interface with downloads and a light delete confirmation', async () => {
    let coverDeleted = false;
    const story = {
      id: 's1', title: 'The Kept Tale', tone: 'romantic', page_count: 6,
      image_status: 'ready', characters: [], total_cost_usd: 0,
    };
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/cover') && options?.method === 'DELETE') {
        coverDeleted = true;
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      }
      if (String(url).endsWith('/storage')) {
        const data = JSON.parse(JSON.stringify(STORAGE));
        if (coverDeleted) {
          data.stories[0].cover = { status: 'deleted', size_bytes: null, cost_usd: null, file_missing: false };
          data.stories[0].disk_bytes -= 512 * 1024;
          data.stories[0].asset_count -= 1;
        }
        return Promise.resolve(jsonResponse(200, data));
      }
      if (String(url).endsWith('/stories')) return Promise.resolve(jsonResponse(200, { stories: [story] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    await fw.openStoryAssets(story);
    const modal = document.getElementById('storyAssetsModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('storyAssetsTitle').textContent).toBe('The Kept Tale');
    expect(document.getElementById('storyAssetsTotal').textContent).toContain('43 MB on disk');
    expect(modal.querySelector('.story-asset-cover').getAttribute('src')).toBe('/api/stories/s1/cover');
    expect([...modal.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
      '/api/stories/s1/export',
      '/api/stories/s1/cover?download=1',
      '/api/stories/s1/audiobook/audio',
      '/api/stories/s1/assets/a1/content?download=1',
    ]));

    const remove = [...modal.querySelectorAll('button')].find((button) => button.textContent === 'Delete cover');
    remove.click();
    expect(await dialogAction('Delete cover')).toBe(true);
    expect(coverDeleted).toBe(true);
    expect(document.getElementById('storyAssetsBody').textContent).toContain('No cover is stored');
    expect(modal.hidden).toBe(false);
  });

  it('inspects continuity and builds missing pages sequentially from the asset interface', async () => {
    const story = {
      id: 's1', title: 'The Kept Tale', tone: 'romantic', page_count: 2,
      image_status: 'ready', characters: [], total_cost_usd: 0,
    };
    let complete = false;
    const continuity = () => ({
      characters: [{
        id: 'c1', name: 'Mara', role: 'mc', current: {
          location: 'the bell tower', condition: 'tired', knowledge: ['the bell is false'], possessions: [],
        },
      }],
      goals: [{ id: 'g1', text: 'Find the real bell', status: 'active' }],
      threads: [], events: [{ page_number: 1, text: 'Mara reached the tower.' }],
      history_counts: { events: 1, summaries: 1 },
      overrides: { characters: {}, goals: {}, threads: {} },
      coverage: {
        total: 2, ready: complete ? 2 : 1, memory_cost_usd: complete ? 0.003 : 0,
        pages: [
          { page_id: 'p1', page_number: 1, status: 'ready' },
          { page_id: 'p2', page_number: 2, status: complete ? 'ready' : 'pending' },
        ],
        failed: [], pending_page_ids: complete ? [] : ['p2'],
      },
    });
    global.fetch.mockImplementation((url, options) => {
      const value = String(url);
      if (value.endsWith('/storage')) return Promise.resolve(jsonResponse(200, STORAGE));
      if (value.endsWith('/stories/s1/continuity') && options?.method === 'GET') {
        return Promise.resolve(jsonResponse(200, { continuity: continuity() }));
      }
      if (value.includes('/continuity/pages/p2/sync')) {
        complete = true;
        return Promise.resolve(jsonResponse(200, {
          memory: { page_id: 'p2', status: 'ready', cost_usd: 0.003 },
          continuity: continuity(),
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [story] }));
    });

    await fw.openStoryAssets(story);
    const section = document.getElementById('storyContinuitySection');
    expect(section.textContent).toContain('1 of 2 text pages remembered');
    expect(section.textContent).toContain('Mara');
    expect(section.textContent).toContain('Find the real bell');
    expect(section.querySelector('[data-continuity-character="c1"]').placeholder).toBe('the bell tower');

    const build = [...section.querySelectorAll('button')].find((button) => button.textContent === 'Build 1 missing');
    build.click();
    expect(await paidReview('confirm')).toBe(true);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/continuity/pages/p2/sync'))).toBe(true);
    expect(document.getElementById('storyContinuitySection').textContent).toContain('2 of 2 text pages remembered');
    // The work belongs to the inspected Library story, not whichever tale is
    // open on the writing desk. With no current story, only Session changes.
    expect(fw.state().costs).toMatchObject({ session: 0.003, story: 0 });
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

  it('deleting art preserves prose numbering and refreshes only the art layer', async () => {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'The Kept Tale', tone: 'romantic', page_count: 3, total_cost_usd: 0 },
      storyPages: [
        { id: 'p1', page_number: 1, content: 'One.', user_input: null },
        { id: 'p2', page_number: 2, content: 'Two.', user_input: null },
        { id: 'p3', page_number: 3, content: 'Three.', user_input: null },
      ],
      storyAssets: {
        assets: [{ id: 'a1', status: 'ready', content_url: '/api/stories/s1/assets/a1/content' }],
        placements: [{ id: 'pl1', asset_id: 'a1', after_page_id: 'p1', ordinal: 1 }],
      },
      currentPage: 3,
    });

    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/assets/a1') && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      if (String(url).includes('/storage')) return Promise.resolve(jsonResponse(200, STORAGE));
      if (String(url).endsWith('/s1/assets')) return Promise.resolve(jsonResponse(200, { assets: [], placements: [] }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.loadBookshelf();
    await new Promise((r) => setTimeout(r, 0));
    entries()[0].querySelectorAll('.bookshelf-plate button')[0].click();
    expect(await dialogAction('Delete art')).toBe(true);

    const delCall = global.fetch.mock.calls.find(([url, options]) => String(url).includes('/assets/a1') && options.method === 'DELETE');
    expect(delCall).toBeTruthy();
    expect(fw.state().storyPages).toHaveLength(3);
    expect(fw.state().currentPage).toBe(3);
    expect(fw.state().storyAssets).toEqual({ assets: [], placements: [] });
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
