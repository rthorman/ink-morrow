'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const STORY = { id: 's1', title: 'Long Chronicle', page_count: 161, total_cost_usd: 0, characters: [] };

function outline(pageCount = 161) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    id: `p${index + 1}`,
    ordinal: index + 1,
    display_number: index + 1,
    kind: 'text',
    excerpt: index === 4 ? 'A quiet scene.\n***\nThe next movement.' : `Bounded excerpt ${index + 1}.`,
    has_scene_break: index === 4,
    continuity_status: index === 2 ? 'failed' : index < 100 ? 'ready' : 'pending',
    continuity_error: index === 2 ? 'The Archivist did not return one valid JSON object.' : null,
    continuity_error_code: index === 2 ? 'INVALID_CONTINUITY_JSON' : null,
    continuity_model: index === 2 ? 'google/gemini-2.5-flash-lite' : null,
    art_count: index === 8 ? 2 : 0,
    is_copyedited: index === 10,
  }));
  return {
    summary: {
      volume_count: 1,
      chapter_count: 1,
      page_count: pageCount,
      continuity: { ready: Math.min(100, pageCount), total: pageCount },
      placed_art_count: 2,
      prepared: { id: 'prepared-1', expected_page: pageCount + 1, cost_usd: 0.01 },
      active_tail: { volume_id: 'v1', chapter_id: 'c1', page_id: `p${pageCount}` },
    },
    volumes: [{ id: 'v1', ordinal: 1, title: 'Volume I', chapters: [
      { id: 'c1', ordinal: 1, title: 'Chapter I', pages },
    ] }],
  };
}

function safeRecovery() {
  return {
    id: 'r-safe',
    status: 'recoverable',
    page_count: 2,
    removed_range: { first: 160, last: 161 },
    created_at: '2026-08-31T10:00:00.000Z',
    expires_at: '2026-09-30T10:00:00.000Z',
    restore: { state: 'safe', available: true, reason: null },
  };
}

describe('PR12 Chronicle', () => {
  it('renders a bounded page window with publication, memory, art, scene, and tail markers', async () => {
    const fetchMock = mockFetch([
      { match: '/stories/s1/hierarchy', response: jsonResponse(200, { hierarchy: outline() }) },
      { match: '/stories/s1/recoveries', response: jsonResponse(200, { recoveries: [] }) },
      {
        match: (url, options) => url === '/api/stories/s1/pages' && options.method === 'GET',
        response: jsonResponse(200, { pages: Array.from({ length: 161 }, (_, index) => ({
          id: `p${index + 1}`, page_number: index + 1, content: `Full page ${index + 1}.`,
        })) }),
      },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterChronicle({ storyId: 's1' });

    expect(document.querySelectorAll('.chronicle-page')).toHaveLength(80);
    expect(document.getElementById('chronicleSummary').textContent).toContain('Page 162');
    expect(document.getElementById('chronicleOutline').textContent).toContain('Scene break in preview');
    expect(document.getElementById('chronicleOutline').textContent).toContain('2 placed art');
    expect(document.getElementById('chronicleStatus').textContent).toContain('Only short excerpts are loaded');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/stories/s1/pages')).toBe(false);

    const failed = document.querySelector('.chronicle-marker--failed');
    expect(failed.tagName).toBe('BUTTON');
    failed.click();
    expect(document.querySelector('.dialog-manager__title').textContent).toContain('page 3');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('INVALID_CONTINUITY_JSON');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('google/gemini-2.5-flash-lite');
    expect([...document.querySelectorAll('.dialog-manager button')]
      .some((button) => button.textContent === 'Open Codex repair')).toBe(true);
    document.querySelector('.dialog-manager .btn-secondary').click();

    document.getElementById('chroniclePageJump').value = '161';
    fw.revealChroniclePage();
    expect(document.querySelectorAll('.chronicle-page')).toHaveLength(1);
    expect(document.querySelector('.chronicle-page__open').textContent).toBe('Open page 161');
    expect(document.getElementById('chronicleOutline').textContent).toContain('Active tail');

    document.querySelector('.chronicle-page__open').click();
    for (let attempt = 0; attempt < 20 && fw.state().storyPages.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fw.state().currentPage).toBe(161);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 161 of 161');
  });

  it('restores only server-declared safe recovery copies and always offers JSON export', async () => {
    const safe = safeRecovery();
    const unsafe = {
      ...safe,
      id: 'r-unsafe',
      restore: { state: 'unsafe', available: false, reason: 'The surviving manuscript changed.' },
    };
    const fetchMock = mockFetch([
      { match: '/stories/s1/hierarchy', response: jsonResponse(200, { hierarchy: outline(159) }) },
      { match: (url, options) => url === '/api/stories/s1/recoveries/r-safe/restore' && options.method === 'POST', response: jsonResponse(200, { restored: 2 }) },
      { match: '/stories/s1/recoveries', response: jsonResponse(200, { recoveries: [safe, unsafe] }) },
    ]);
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: { ...STORY, page_count: 159 }, storyPages: [] });
    await fw.enterChronicle({ storyId: 's1' });

    const cards = document.querySelectorAll('.chronicle-recovery');
    expect(cards).toHaveLength(2);
    expect(cards[1].querySelector('button').disabled).toBe(true);
    expect(cards[1].querySelector('a').href).toContain('/api/stories/s1/recoveries/r-unsafe/export');

    const restoring = fw.restoreChronicleRecovery(safe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('.dialog-manager .btn-primary').click();
    await restoring;
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/stories/s1/recoveries/r-safe/restore');
    expect(call[1].method).toBe('POST');
  });
});
