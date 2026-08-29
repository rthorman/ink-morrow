'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

describe('Reading old pages (read-only)', () => {
  let fw;

  beforeEach(() => {
    mockFetch();
    fw = loadScript();
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

  it('shows the past-page bar and disables writing on an old page', () => {
    fw.displayCurrentPage();
    expect(document.getElementById('pastPageBar').hidden).toBe(false);
    expect(document.getElementById('pastPageBar').textContent).toContain('2 pages come after');
    expect(document.getElementById('userInput').disabled).toBe(true);
    expect(document.getElementById('generateBtn').disabled).toBe(true);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 1 of 3');
  });

  it('hides the bar and re-enables writing on the last page', () => {
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

  beforeEach(() => {
    fetchMock = mockFetch();
    fw = loadScript();
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

  it('opens the modal with a clear warning, cancel keeps everything', () => {
    document.getElementById('deleteAfterBtn').click();
    const modal = document.getElementById('burnModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('burnBody').textContent).toContain('2 pages come after Page 1');
    expect(document.getElementById('burnBody').textContent).toContain('no recovery');

    document.getElementById('burnCancelBtn').click();
    expect(modal.hidden).toBe(true);
  });

  it('slide-to-yes truncates and reloads; partial slides do nothing', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/pages?after=1') && arguments) return Promise.resolve(jsonResponse(200, { deleted: 2, remaining: 1 }));
      if (String(url).includes('/pages') && String(url).includes('/s1')) return Promise.resolve(jsonResponse(200, { pages: [{ page_number: 1, content: 'One.', user_input: null }] }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('deleteAfterBtn').click();
    const slider = document.getElementById('burnSlider');

    slider.value = 60;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('burnModal').hidden).toBe(false); // not far enough

    slider.value = 100;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('burnModal').hidden).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const called = fetchMock.mock.calls.map((c) => c[0]);
    expect(called).toContain('/api/stories/s1/pages?after=1');
    expect(fw.state().storyPages).toHaveLength(1);
    expect(fw.state().currentPage).toBe(1);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 1 of 1');
  });

  it('the button does nothing on the last page', () => {
    fw.__setStoryState({ currentPage: 3 });
    fw.displayCurrentPage();
    document.getElementById('deleteAfterBtn').click();
    expect(document.getElementById('burnModal').hidden).toBe(true);
  });
});