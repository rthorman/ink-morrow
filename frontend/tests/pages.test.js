'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

describe('Reading old pages (read-only)', () => {
  let fw;

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 3, total_cost_usd: 0 },
      storyPages: [
        { page_number: 1, content: 'One.', user_input: 'begin' },
        { page_number: 2, content: 'Two.', user_input: null },
        { page_number: 3, content: 'Three.', user_input: 'go on' },
      ],
      currentPage: 1,
    });
  });

  it('shows the past-page bar and disables writing on an old page', async () => {
    fw.displayCurrentPage();
    expect(document.getElementById('pastPageBar').hidden).toBe(false);
    expect(document.getElementById('pastPageBar').textContent).toContain('2 pages come after');
    expect(document.getElementById('userInput').disabled).toBe(true);
    expect(document.getElementById('generateBtn').disabled).toBe(true);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 1 of 3');
  });

  it('hides the bar and re-enables writing on the last page', async () => {
    fw.__setStoryState({ currentPage: 3 });
    fw.displayCurrentPage();
    expect(document.getElementById('pastPageBar').hidden).toBe(true);
    expect(document.getElementById('userInput').disabled).toBe(false);
    expect(document.getElementById('generateBtn').disabled).toBe(false);
  });

  it('refuses to generate while viewing an old page', async () => {
    const fetchMock = global.fetch;
    await fw.generateNextPage();
    expect(document.querySelector('.error-message').textContent).toContain('last page');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/stories/s1/pages/generate', expect.anything());
  });
});

describe('Burn everything after this page', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    fetchMock = mockFetch();
    fw = await loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 3, total_cost_usd: 0 },
      storyPages: [
        { page_number: 1, content: 'One.', user_input: null },
        { page_number: 2, content: 'Two.', user_input: null },
        { page_number: 3, content: 'Three.', user_input: null },
      ],
      currentPage: 1,
    });
    fw.displayCurrentPage();
  });

  it('opens the destructive dialog with a clear warning, cancel keeps everything', async () => {
    document.getElementById('deleteAfterBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = document.querySelector('.dialog-manager');
    expect(dialog.hidden).toBe(false);
    expect(dialog.querySelector('.dialog-manager__title').textContent).toContain('Return story to page 1?');
    expect(dialog.querySelector('.dialog-manager__body').textContent).toContain('Pages 2–3');
    expect(dialog.querySelector('.dialog-manager__body').textContent).toContain('recovery copy');

    // Cancel keeps every page and closes
    const cancel = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    cancel.click();
    expect(dialog.hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/stories/s1/pages?after=1', expect.anything());
  });

  it('confirming the dialog truncates and reloads', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/pages?after=1')) return Promise.resolve(jsonResponse(200, { deleted: 2, remaining: 1 }));
      if (String(url).includes('/pages') && String(url).includes('/s1')) return Promise.resolve(jsonResponse(200, { pages: [{ page_number: 1, content: 'One.', user_input: null }] }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('deleteAfterBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = document.querySelector('.dialog-manager');
    const confirmBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Return story to page 1');
    confirmBtn.click();
    expect(dialog.hidden).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const called = fetchMock.mock.calls.map((c) => c[0]);
    expect(called).toContain('/api/stories/s1/pages?after=1');
    expect(fw.state().storyPages).toHaveLength(1);
    expect(fw.state().currentPage).toBe(1);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 1 of 1');
  });

  it('the button does nothing on the last page', async () => {
    fw.__setStoryState({ currentPage: 3 });
    fw.displayCurrentPage();
    document.getElementById('deleteAfterBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = document.querySelector('.dialog-manager');
    expect(!dialog || dialog.hidden).toBe(true); // nothing opened
  });
});
