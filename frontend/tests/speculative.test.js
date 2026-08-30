'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const tick = () => new Promise((r) => setTimeout(r, 0));

function storyState(pages, currentPage) {
  return {
    currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: pages.length, total_cost_usd: 0 },
    storyPages: pages,
    currentPage: currentPage === undefined ? pages.length : currentPage,
  };
}

describe('Speculative next-page preparation', () => {
  let fw, fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = loadScript();
  });

  function mockPreviewAndCommit() {
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/pages/preview') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { preview: { expected_page: 2, model: 'x', cost_usd: 0.001 } }));
      }
      if (url.includes('/pages/commit-preview') && options && options.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The prepared continuation.', user_input: null, cost_usd: 0.001 } })
        );
      }
      if (url.includes('/s1/pages') && String(url).includes('/api/stories/s1/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(
          jsonResponse(200, { pages: [{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }] })
        );
      }
      if (url.includes('/pages/generate') && options && options.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The live page.', user_input: null, cost_usd: 0.02 } })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
  }

  it('prepares a page when idling on the last page with no direction', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await tick(); // let the un-awaited speculative call settle

    const previewCall = fetchMock.mock.calls.find((c) => c[0].includes('/pages/preview'));
    expect(previewCall).toBeTruthy();
    expect(JSON.parse(previewCall[1].body).words).toBe(400);

    // The button becomes a green Next Page; the preview cost hits the session ticker
    expect(document.getElementById('generateBtn').textContent).toBe('Next Page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(true);
    expect(fw.state().costs.session).toBeCloseTo(0.001, 8);
    expect(fw.state().costs.story).toBeCloseTo(0, 8); // story total untouched until commit
  });

  it('hides the note while the writer types a direction', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await tick();
    expect(document.getElementById('generateBtn').textContent).toBe('Next Page');

    const input = document.getElementById('userInput');
    input.value = 'she opens the door';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('generateBtn').textContent).toBe('Generate Page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(false);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('generateBtn').textContent).toBe('Next Page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(true);
  });

  it('commits the prepared page instantly on an empty Generate', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await tick();
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/pages/commit-preview')) {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The prepared continuation.', user_input: null, cost_usd: 0.001 } })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.generateNextPage();

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/stories/s1/pages/commit-preview');
    expect(urls.some((u) => u.includes('/pages/generate'))).toBe(false); // no live call needed
    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().currentPage).toBe(2);
    // Session counted the preview once; story total gained the page cost
    expect(fw.state().costs.session).toBeCloseTo(0.001, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.001, 8);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');
  });

  it('uses a live generation when a direction is given', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/pages/generate')) {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The live page.', user_input: 'go left', cost_usd: 0.02 } })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('userInput').value = 'go left';
    await fw.generateNextPage();
    await tick();

    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/commit-preview'))).toBe(false);
    expect(fw.state().storyPages[1].content).toBe('The live page.');
  });

  it('a stale in-flight preview resolved after a direction write never turns the button green', async () => {
    // THE REGRESSION: an old speculative is still in flight when the writer
    // gives a direction. Its server-side preview is invalidated by the live
    // write, but its HTTP response arrives afterwards - it must be ignored,
    // a FRESH preview must fire, and the green button must be real.
    let previewCalls = 0;
    const deferred = [];
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/preview') && options && options.method === 'POST') {
        previewCalls++;
        deferred.push({});
        return new Promise((resolve) => {
          deferred[deferred.length - 1].resolve = resolve;
        });
      }
      if (String(url).includes('/pages/generate') && options && options.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The direction page.', user_input: 'go left', cost_usd: 0.02 } })
        );
      }
      if (String(url).includes('/commit-preview') && options && options.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 3, content: 'The fresh prepared page.', user_input: null, cost_usd: 0.03 } })
        );
      }
      if (String(url).includes('/s1/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(
          jsonResponse(200, { pages: [{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }] })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    fw.maybeStartSpeculative(); // preview #A goes in flight (unresolved)
    await tick();
    expect(previewCalls).toBe(1);

    // The writer gives a direction: live generate, page 2 lands
    document.getElementById('userInput').value = 'go left';
    await fw.generateNextPage();
    await tick();
    expect(previewCalls).toBe(2); // a FRESH preview fired for page 3

    // The STALE #A response arrives late: it must NOT turn the button green
    deferred[0].resolve(jsonResponse(200, { preview: { expected_page: 2, cost_usd: 0.001 } }));
    await tick();
    await tick();
    const btn = document.getElementById('generateBtn');
    expect(btn.classList.contains('next-page')).toBe(false); // the stale lie is dead

    // The fresh preview resolves: NOW the button is green, and pressing it
    // commits the page that was actually prepared
    deferred[1].resolve(jsonResponse(200, { preview: { expected_page: 3, cost_usd: 0.003 } }));
    await tick();
    await tick();
    expect(btn.classList.contains('next-page')).toBe(true);

    document.getElementById('userInput').value = '';
    await fw.generateNextPage();
    await tick();
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/commit-preview'));
    expect(commits).toHaveLength(1); // pressed green, committed - no silent regenerate
    expect(fw.state().storyPages[2].content).toBe('The fresh prepared page.');
    expect(fw.state().storyPages).toHaveLength(3);
  });

  it('falls back to a live call when the prepared page went stale', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await tick(); // let the prepared preview settle before it goes stale
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/commit-preview')) {
        return Promise.resolve(jsonResponse(404, { error: 'No prepared page for this story.' }));
      }
      if (url.includes('/pages/preview')) {
        return Promise.resolve(jsonResponse(500, { error: 'no preview' })); // chained prep fails here
      }
      if (url.includes('/pages/generate')) {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The live page.', user_input: null, cost_usd: 0.02 } })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    await fw.generateNextPage();
    await tick();

    expect(fetchMock.mock.calls.some((c) => c[0].includes('/commit-preview'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(true);
    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().storyPages[1].content).toBe('The live page.');
    expect(document.getElementById('generateBtn').textContent).toBe('Generate Page');
  });

  it('does not prepare a page while viewing an old page', async () => {
    fw.__setStoryState(
      storyState(
        [
          { page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 },
          { page_number: 2, content: 'Two.', user_input: null, cost_usd: 0.01 },
        ],
        1
      )
    );
    fw.displayCurrentPage();
    await fw.maybeStartSpeculative();
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/preview'))).toBe(false);
  });
});