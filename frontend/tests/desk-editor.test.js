'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const STORY = { id: 's1', title: 'Draft', page_count: 2, total_cost_usd: 0, characters: [] };
const PAGES = [
  { id: 'p1', story_id: 's1', page_number: 1, content: 'Earlier prose.', user_input: 'begin' },
  { id: 'p2', story_id: 's1', page_number: 2, content: 'Tail prose.', user_input: 'continue' },
];

function setDesk(fw, currentPage = 2) {
  fw.__setStoryState({ currentStory: STORY, storyPages: PAGES.map((page) => ({ ...page })), currentPage });
  fw.displayCurrentPage();
}

describe('PR11 Desk page editing', () => {
  it('autosaves active-tail prose as a canonical revision and paints the saved state', async () => {
    const fetchMock = mockFetch([
      { match: '/pages/p2/revisions', response: jsonResponse(200, { page: { ...PAGES[1], content: 'Revised tail.' } }) },
    ]);
    const fw = await loadScript();
    setDesk(fw);

    expect(document.getElementById('deskPageEditBtn').textContent).toBe('Edit active page');
    fw.openPageEditor();
    const editor = document.getElementById('deskPageEditorText');
    editor.value = 'Revised tail.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await fw.savePageEdit();

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/stories/s1/pages/p2/revisions');
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body)).toEqual({ content: 'Revised tail.' });
    expect(document.getElementById('deskPageSaveState').textContent).toContain('Canonical revision saved');
    expect(document.getElementById('storyContent').textContent).toContain('Revised tail.');
  });

  it('copyedits historical display prose without an AI or Archivist request', async () => {
    const fetchMock = mockFetch([
      { match: '/pages/p1/copyedits', response: jsonResponse(201, { page: { ...PAGES[0], content: 'Polished display prose.' } }) },
    ]);
    const fw = await loadScript();
    setDesk(fw, 1);

    expect(document.getElementById('deskPageEditBtn').textContent).toBe('Copyedit this page');
    fw.openPageEditor();
    expect(document.getElementById('deskPageEditorNotice').textContent).toContain('Canonical prose and Archivist facts stay unchanged');
    const editor = document.getElementById('deskPageEditorText');
    editor.value = 'Polished display prose.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await fw.savePageEdit();

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain('/api/stories/s1/pages/p1/copyedits');
    expect(urls.some((url) => /\/api\/(ai|continuity)/.test(url))).toBe(false);
    expect(document.getElementById('deskPageSaveState').textContent).toContain('canon unchanged');
  });

  it('queues prose typed while an autosave response is still in flight', async () => {
    const fetchMock = mockFetch();
    const fw = await loadScript();
    setDesk(fw);
    let resolveFirst;
    let revisionCalls = 0;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    fetchMock.mockImplementation((url) => {
      if (url === '/api/stories/s1/pages/p2/revisions') {
        revisionCalls++;
        if (revisionCalls === 1) return firstResponse;
        return Promise.resolve(jsonResponse(200, { page: { ...PAGES[1], content: 'Second draft.' } }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    fw.openPageEditor();
    const editor = document.getElementById('deskPageEditorText');
    editor.value = 'First draft.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    const firstSave = fw.savePageEdit();
    editor.value = 'Second draft.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    resolveFirst(jsonResponse(200, { page: { ...PAGES[1], content: 'First draft.' } }));

    expect(await firstSave).toBe(false);
    expect(editor.value).toBe('Second draft.');
    await fw.savePageEdit();
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url === '/api/stories/s1/pages/p2/revisions')
      .map(([, options]) => JSON.parse(options.body).content);
    expect(bodies).toEqual(['First draft.', 'Second draft.']);
    expect(document.getElementById('deskPageSaveState').textContent).toContain('Canonical revision saved');
  });

  it('preserves a conflicting draft and can load the latest server revision', async () => {
    mockFetch([
      {
        match: '/pages/p2/revisions',
        response: jsonResponse(409, { error: 'Only the active tail page can be substantively edited.', code: 'TAIL_ONLY' }),
      },
      {
        match: (url, options) => url === '/api/stories/s1/pages/p2' && options.method === 'GET',
        response: jsonResponse(200, { page: { ...PAGES[1], content: 'Newest server prose.' } }),
      },
    ]);
    const fw = await loadScript();
    setDesk(fw);
    fw.openPageEditor();
    const editor = document.getElementById('deskPageEditorText');
    editor.value = 'My preserved conflicting draft.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(await fw.savePageEdit()).toBe(false);
    expect(editor.value).toBe('My preserved conflicting draft.');
    expect(document.getElementById('deskPageSaveState').dataset.state).toBe('conflict');
    expect(document.getElementById('deskPageReloadLatest').hidden).toBe(false);

    await fw.reloadLatestPage();
    expect(editor.value).toBe('Newest server prose.');
    expect(document.getElementById('deskPageSaveState').textContent).toContain('Latest server revision loaded');
  });

  it('keeps prose visible when autosave is offline', async () => {
    const fetchMock = mockFetch();
    const fw = await loadScript();
    setDesk(fw);
    fetchMock.mockImplementation((url) => {
      if (url === '/api/stories/s1/pages/p2/revisions') return Promise.reject(new Error('offline'));
      return Promise.resolve(jsonResponse(200, {}));
    });
    fw.openPageEditor();
    const editor = document.getElementById('deskPageEditorText');
    editor.value = 'Prose written without a connection.';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(await fw.savePageEdit()).toBe(false);
    expect(editor.value).toBe('Prose written without a connection.');
    expect(document.getElementById('deskPageSaveState').dataset.state).toBe('offline');
  });
});

describe('PR11 recoverable return-to-page', () => {
  it('names the removed range and restores it with the one-click undo token', async () => {
    const fetchMock = mockFetch([
      {
        match: (url, options) => url === '/api/stories/s1/pages?after=1' && options.method === 'DELETE',
        response: jsonResponse(200, {
          deleted: 1,
          remaining: 1,
          removed_range: { first: 2, last: 2 },
          recovery: { id: 'r1', expires_at: '2030-01-01T00:00:00.000Z' },
          undo: { token: 'undo-secret', expires_at: '2030-01-01T00:01:00.000Z' },
        }),
      },
      { match: '/recoveries/r1/undo', response: jsonResponse(200, { restored: 1 }) },
      {
        match: (url, options) => url === '/api/stories/s1/pages' && options.method === 'GET',
        response: jsonResponse(200, { pages: PAGES }),
      },
      { match: '/pages/preview', response: jsonResponse(200, { preview: null }) },
      { match: '/assets', response: jsonResponse(200, { assets: [], placements: [] }) },
    ]);
    const fw = await loadScript();
    setDesk(fw, 1);

    await fw.burnAfterCurrentPage();
    expect(document.getElementById('deskRecoveryBanner').hidden).toBe(false);
    expect(document.getElementById('deskRecoveryText').textContent).toContain('Page 2 left the active manuscript');
    await fw.undoReturn();

    const undoCall = fetchMock.mock.calls.find(([url]) => url === '/api/stories/s1/recoveries/r1/undo');
    expect(undoCall[1].method).toBe('POST');
    expect(JSON.parse(undoCall[1].body)).toEqual({ undo_token: 'undo-secret' });
    expect(document.getElementById('deskRecoveryBanner').hidden).toBe(true);
  });
});

