'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

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

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
  });

  function mockPreviewAndCommit() {
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/pages/preview') && options && options.method === 'POST') {
        const expectedPage = (fw?.state().storyPages.length || 0) + 1;
        return Promise.resolve(jsonResponse(200, {
          preview: { expected_page: expectedPage, preview_key: `preview-${expectedPage}`, model: 'x', cost_usd: 0.001 },
        }));
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

  it('selecting a story alone sends NO paid preview (consent gate)', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await tick();
    await tick();

    // The free status read may run, but no paid POST fires until an explicitly
    // confirmed action starts preparation.
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/preview') && c[1]?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(false);
    expect(document.getElementById('generateBtn').textContent).toBe('Prepare next page');
  });

  it('a confirmed directed write relies on the server-owned successor; canceling writes nothing', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();

    // CANCEL: zero paid requests, the direction stays in the field.
    document.getElementById('userInput').value = 'she opens the door';
    const canceled = fw.generateNextPage();
    expect(await paidReview('cancel')).toBe(true);
    await canceled;
    await tick();
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/preview') && c[1]?.method === 'POST')).toBe(false);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(false);
    expect(document.getElementById('userInput').value).toBe('she opens the door');

    // CONFIRM: the write goes through. This legacy mock reports no server
    // successor, so the client must not invent a second paid POST.
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    await tick(); // let the un-awaited speculative call settle

    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/preview') && c[1]?.method === 'POST')).toBe(false);
    expect(document.getElementById('generateBtn').textContent).toBe('Prepare next page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(false);
    expect(fw.state().costs.session).toBeCloseTo(0.02, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.02, 8); // the written page; preview commits later
  });

  it('hides the note while the writer types a direction', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await fw.maybeStartSpeculative(); // the consented post-write preparation
    await tick();
    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');

    const input = document.getElementById('userInput');
    input.value = 'she opens the door';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('generateBtn').textContent).toBe('Generate as directed');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(false);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(true);
  });

  it('disables an empty-direction press while preparation is still in flight', async () => {
    let resolvePreview;
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/preview') && options?.method === 'POST') {
        return new Promise((resolve) => { resolvePreview = resolve; });
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();

    const preparation = fw.maybeStartSpeculative();
    await tick();
    const button = document.getElementById('generateBtn');
    expect(button.textContent).toBe('Preparing next page…');
    expect(button.disabled).toBe(true);

    const input = document.getElementById('userInput');
    input.value = 'take the left stair';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button.textContent).toBe('Generate as directed');
    expect(button.disabled).toBe(false);

    resolvePreview(jsonResponse(200, {
      preview: { expected_page: 2, preview_key: 'ready-2', cost_usd: 0.001 },
    }));
    await preparation;
    expect(button.textContent).toBe('Generate as directed');
    expect(document.getElementById('preparedNote').textContent).toContain('Confirming this direction replaces it');
  });

  it('keeps an already-paid prepared page when a directed write is canceled', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    await fw.maybeStartSpeculative();
    fetchMock.mockClear();

    const input = document.getElementById('userInput');
    input.value = 'turn back toward the river';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const generation = fw.generateNextPage();
    expect(await paidReview('cancel')).toBe(true);
    await generation;

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pages/generate'))).toBe(false);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');
    expect(document.getElementById('generateBtn').classList.contains('next-page')).toBe(true);
  });

  it('restores a stored prepared page after a browser reload without paid work', async () => {
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/api/stories/s1/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          pages: [{ id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 }],
        }));
      }
      if (String(url).endsWith('/api/stories/s1/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          preview: { expected_page: 2, preview_key: 'persisted-preview', cost_usd: 0.001 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([]));
    await fw.loadStoryPages();

    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(fw.state().costs.session).toBe(0); // historical spend is not re-booked on refresh
  });

  it('commits the prepared page on an empty Generate after its continuity/successor review', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await fw.maybeStartSpeculative(); // prepare as a confirmed write would
    await tick();
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/pages/commit-preview')) {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The prepared continuation.', user_input: null, cost_usd: 0.001 } })
        );
      }
      if (url.includes('/pages/preview')) {
        return Promise.resolve(jsonResponse(200, { preview: { expected_page: 3, model: 'x', cost_usd: 0.001 } }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    // Cancel first: the prepared page and its green button remain intact.
    const canceled = fw.generateNextPage();
    expect(await paidReview('cancel')).toBe(true);
    await canceled;
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/commit-preview'))).toBe(false);

    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/stories/s1/pages/commit-preview');
    const commitCall = fetchMock.mock.calls.find((c) => c[0].includes('/commit-preview'));
    expect(JSON.parse(commitCall[1].body)).toEqual(expect.objectContaining({
      preview_id: 'preview-2',
      idempotency_key: expect.stringMatching(/^promote:/),
      writer_session_id: expect.stringMatching(/^writer/),
    }));
    expect(urls.some((u) => u.includes('/pages/generate'))).toBe(false); // no live call needed
    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().currentPage).toBe(2);
    await tick();
    // The old mock did not advertise a server successor, so no speculative
    // cost or duplicate request is fabricated by the browser.
    expect(fw.state().costs.session).toBeCloseTo(0.001, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.001, 8);
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');
    expect(document.getElementById('generateBtn').textContent).toBe('Prepare next page');
    expect(fetchMock.mock.calls.filter((c) => c[0].includes('/pages/preview') && c[1]?.method === 'POST')).toHaveLength(0);
  });

  it('shows the committed page before continuity finishes while chaining one successor', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    await fw.maybeStartSpeculative();
    fetchMock.mockClear();

    let resolveContinuity;
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/commit-preview') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, {
          page: { id: 'p2', page_number: 2, content: 'Visible before memory.', cost_usd: 0.001 },
          continuity_pending: true,
          successor_pending: true,
        }));
      }
      if (String(url).includes('/continuity/pages/p2/sync') && options?.method === 'POST') {
        return new Promise((resolve) => { resolveContinuity = resolve; });
      }
      if (String(url).includes('/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          preview: { expected_page: 3, preview_id: 'page-3', preview_key: 'page-3', cost_usd: 0.002 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    const commit = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await commit;
    expect(document.getElementById('storyContent').textContent).toContain('Visible before memory.');
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pages/generate'))).toBe(false);
    await tick();
    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');

    resolveContinuity(jsonResponse(200, {
      memory: { status: 'ready', cost_usd: 0.004 },
      page: { id: 'p2', page_number: 2, content: 'Visible before memory.', cost_usd: 0.001, continuity_cost_usd: 0.004 },
    }));
    await tick();
    await tick();
    expect(fw.state().costs.session).toBeCloseTo(0.007, 8); // prepared + successor + continuity
    expect(fw.state().costs.story).toBeCloseTo(0.005, 8); // committed prose + continuity
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
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    await tick();

    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/commit-preview'))).toBe(false);
    expect(fw.state().storyPages[1].content).toBe('The live page.');
  });

  it('does not apply a completed write to a different story selected mid-flight', async () => {
    let resolveGeneration;
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/generate') && options?.method === 'POST') {
        return new Promise((resolve) => { resolveGeneration = resolve; });
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ id: 's1-p1', page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    document.getElementById('userInput').value = 'continue story one';

    const generation = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await tick();
    fw.__setStoryState({
      currentStory: { id: 's2', title: 'Other', page_count: 0, total_cost_usd: 0 },
      storyPages: [],
      currentPage: 1,
    });
    fw.displayCurrentPage();

    resolveGeneration(jsonResponse(201, {
      page: { id: 's1-p2', page_number: 2, content: 'Story one finished later.', cost_usd: 0.02 },
    }));
    await generation;

    expect(fw.state().currentStory.id).toBe('s2');
    expect(fw.state().storyPages).toEqual([]);
    expect(fw.state().costs.session).toBeCloseTo(0.02, 8);
    expect(fw.state().costs.story).toBeCloseTo(0, 8);
  });

  it('does not erase a new direction typed while the current page is finishing', async () => {
    let resolveGeneration;
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/generate') && options?.method === 'POST') {
        return new Promise((resolve) => { resolveGeneration = resolve; });
      }
      if (String(url).includes('/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          preview: { expected_page: 3, preview_id: 'typed-ahead-successor', preview_key: 'typed-ahead-successor', cost_usd: 0.001 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    const input = document.getElementById('userInput');
    input.value = 'finish the crossing';

    const generation = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await tick();
    input.value = 'then search the far bank';
    resolveGeneration(jsonResponse(201, {
      page: { id: 'p2', page_number: 2, content: 'The crossing ends.', cost_usd: 0.02 },
      successor_pending: true,
    }));
    await generation;
    await tick();

    expect(input.value).toBe('then search the far bank');
    expect(fetchMock.mock.calls.some(([url, options]) =>
      String(url).includes('/pages/preview') && (!options || options.method === 'GET')
    )).toBe(true);
    expect(document.getElementById('preparedNote').textContent).toContain('Confirming this direction replaces it');
  });

  it('ignores an older story-page load that resolves after a newer selection', async () => {
    const pageResolvers = {};
    fetchMock.mockImplementation((url, options) => {
      const value = String(url);
      if (value.endsWith('/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, { preview: null }));
      }
      if (value.endsWith('/pages') && (!options || options.method === 'GET')) {
        const storyId = value.includes('/stories/s1/') ? 's1' : 's2';
        return new Promise((resolve) => { pageResolvers[storyId] = resolve; });
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    fw.__setStoryState(storyState([]));
    const firstLoad = fw.loadStoryPages();
    await tick();
    fw.__setStoryState({
      currentStory: { id: 's2', title: 'Other', page_count: 1, total_cost_usd: 0 },
      storyPages: [],
      currentPage: 1,
    });
    const secondLoad = fw.loadStoryPages();
    await tick();

    pageResolvers.s2(jsonResponse(200, {
      pages: [{ id: 's2-p1', page_number: 1, content: 'The selected story.' }],
    }));
    await secondLoad;
    pageResolvers.s1(jsonResponse(200, {
      pages: [{ id: 's1-p1', page_number: 1, content: 'The stale story.' }],
    }));
    await firstLoad;

    expect(fw.state().currentStory.id).toBe('s2');
    expect(fw.state().storyPages.map((page) => page.id)).toEqual(['s2-p1']);
    expect(document.getElementById('storyContent').textContent).toContain('The selected story.');
  });

  it('ignores a stale preparation reply and paints only the server-owned successor', async () => {
    let previewCalls = 0;
    const deferred = [];
    let previewReads = 0;
    let resolveSuccessorRead;
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
          jsonResponse(201, {
            page: { page_number: 2, content: 'The direction page.', user_input: 'go left', cost_usd: 0.02 },
            successor_pending: true,
          })
        );
      }
      if (String(url).endsWith('/pages/preview') && (!options || options.method === 'GET')) {
        previewReads++;
        if (previewReads === 1) return Promise.resolve(jsonResponse(200, { preview: null }));
        return new Promise((resolve) => { resolveSuccessorRead = resolve; });
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
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    await tick();
    expect(previewCalls).toBe(1); // no second paid POST from the browser

    // The stale POST reply arrives late: it must not turn the button green.
    deferred[0].resolve(jsonResponse(200, { preview: { expected_page: 2, cost_usd: 0.001 } }));
    await tick();
    await tick();
    const btn = document.getElementById('generateBtn');
    expect(btn.classList.contains('next-page')).toBe(false); // the stale lie is dead

    // Only the free reconciliation read of the server-owned successor may
    // paint the real green action.
    resolveSuccessorRead(jsonResponse(200, {
      preview: { expected_page: 3, preview_id: 'successor-3', preview_key: 'successor-3', cost_usd: 0.003 },
    }));
    await tick();
    await tick();
    expect(btn.classList.contains('next-page')).toBe(true);
    // Both provider operations are still visible in Session spend.
    expect(fw.state().costs.session).toBeCloseTo(0.024, 8); // live .02 + stale .001 + fresh .003

    document.getElementById('userInput').value = '';
    const commit = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true); // prepared commit + disclosed follow-up work
    await commit;
    await tick();
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/commit-preview'));
    expect(commits).toHaveLength(1); // pressed green, committed - no silent regenerate
    expect(fw.state().storyPages[2].content).toBe('The fresh prepared page.');
    expect(fw.state().storyPages).toHaveLength(3);
  });

  it('never falls back to a paid live call when the prepared page went stale', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    await fw.loadStoryPages();
    await fw.maybeStartSpeculative(); // a confirmed write prepares; here it goes stale
    await tick(); // let the prepared preview settle before it goes stale
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/commit-preview')) {
        return Promise.resolve(jsonResponse(404, { error: 'No prepared page for this story.' }));
      }
      if (url.includes('/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, { preview: null }));
      }
      if (url.includes('/pages/generate')) {
        return Promise.resolve(
          jsonResponse(201, { page: { page_number: 2, content: 'The live page.', user_input: null, cost_usd: 0.02 } })
        );
      }
      if (url.endsWith('/api/stories/s1/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          pages: [{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }],
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    await tick();

    expect(fetchMock.mock.calls.some((c) => c[0].includes('/commit-preview'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0].includes('/pages/generate'))).toBe(false);
    expect(fw.state().storyPages).toHaveLength(1);
    expect(document.getElementById('generateBtn').textContent).toBe('Prepare next page');
    expect(document.querySelector('.error-message').textContent).toContain('No replacement page was generated');
  });

  it('reconciles an interrupted successful commit and still prepares exactly one successor', async () => {
    mockPreviewAndCommit();
    fw.__setStoryState(storyState([{ id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    await fw.maybeStartSpeculative();
    fetchMock.mockClear();
    let previewReads = 0;
    fetchMock.mockImplementation((url, options) => {
      const value = String(url);
      if (value.includes('/commit-preview') && options?.method === 'POST') {
        return Promise.reject(new Error('connection dropped after send'));
      }
      if (value.endsWith('/api/stories/s1/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, { pages: [
          { id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 },
          { id: 'p2', page_number: 2, content: 'Committed despite the dropped response.', cost_usd: 0.001 },
        ] }));
      }
      if (value.endsWith('/pages/preview') && (!options || options.method === 'GET')) {
        previewReads++;
        return Promise.resolve(jsonResponse(200, previewReads === 1
          ? { preview: null }
          : { preview: { expected_page: 3, preview_id: 'successor-3', preview_key: 'successor-3', cost_usd: 0.002 } }));
      }
      if (value.includes('/continuity/pages/p2/sync') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, {
          memory: { status: 'ready', cost_usd: 0 },
          page: { id: 'p2', page_number: 2, content: 'Committed despite the dropped response.', cost_usd: 0.001 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    const commit = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await commit;
    await tick();
    await tick();

    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().storyPages[1].content).toContain('dropped response');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/pages/generate'))).toBe(false);
    expect(fetchMock.mock.calls.filter(([url, options]) =>
      String(url).endsWith('/pages/preview') && options?.method === 'POST'
    )).toHaveLength(0);
    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');
  });

  it('discloses authoring, continuity and preparation with bounded retry ceilings', async () => {
    fw.setSetting('model', 'priced/model');
    fw.__setModelsCache([
      {
        id: 'priced/model',
        name: 'Priced',
        reasoning: false,
        pricing: { prompt_per_mtok: 2, completion_per_mtok: 4 },
      },
    ]);
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    document.getElementById('userInput').value = 'go on';

    const gen = fw.generateNextPage();
    const review = document.querySelector('.dialog-manager__body').textContent;
    expect(review).toContain('Also bills');
    expect(review).toContain('prepare the next page');
    expect(review).toContain('Retry ceiling');
    expect(review).toContain('up to three billable quality attempts');
    expect(await paidReview('cancel')).toBe(true);
    await gen;
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/pages/generate'))).toBe(false);
  });

  it('does not start a successor preview after a failed live write and books known failed spend', async () => {
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/generate') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(502, {
          error: 'The reply arrived cut off. Nothing was saved.',
          cost_usd: 0.006,
          billed_attempts: 3,
        }));
      }
      if (String(url).includes('/pages/preview')) {
        return Promise.resolve(jsonResponse(200, { preview: { cost_usd: 0.9 } }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    document.getElementById('userInput').value = 'go on';

    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    await tick();

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/pages/preview') && c[1]?.method === 'POST')).toBe(false);
    expect(fw.state().storyPages).toHaveLength(1);
    expect(fw.state().costs.session).toBeCloseTo(0.006, 8);
    expect(fw.state().costs.story).toBeCloseTo(0, 8);
    expect(document.getElementById('userInput').value).toBe('go on');
  });

  it('restores an in-flight prepared page that finishes after a directed write fails', async () => {
    let resolvePreview;
    fetchMock.mockImplementation((url, options) => {
      const value = String(url);
      if (value.endsWith('/pages/preview') && options?.method === 'POST') {
        return new Promise((resolve) => { resolvePreview = resolve; });
      }
      if (value.endsWith('/pages/generate') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(502, {
          error: 'The directed write failed.',
          cost_usd: 0.006,
          billed_attempts: 1,
        }));
      }
      if (value.endsWith('/pages/preview') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, {
          preview: { expected_page: 2, preview_key: 'surviving-preview', cost_usd: 0.001 },
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ id: 'p1', page_number: 1, content: 'One.', cost_usd: 0.01 }]));
    fw.displayCurrentPage();
    const preparation = fw.maybeStartSpeculative();
    await tick();

    const input = document.getElementById('userInput');
    input.value = 'take the dangerous road';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const generation = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await generation;

    resolvePreview(jsonResponse(200, {
      preview: { expected_page: 2, preview_key: 'surviving-preview', cost_usd: 0.001 },
    }));
    await preparation;
    await tick();
    await tick();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.getElementById('generateBtn').textContent).toBe('Use prepared page');
    expect(fw.state().costs.session).toBeCloseTo(0.007, 8);
  });

  it('does not start a successor preview after a failed rewrite and books known failed spend', async () => {
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/pages/regenerate') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(502, {
          error: 'The rewrite arrived cut off. Nothing was saved.',
          cost_usd: 0.004,
          billed_attempts: 2,
        }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    fw.__setStoryState(storyState([{ page_number: 1, content: 'Original.', user_input: null, cost_usd: 0.01 }]));
    fw.displayCurrentPage();

    const retry = fw.retryLastPage();
    expect(await paidReview('confirm')).toBe(true);
    await retry;
    await tick();

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/pages/preview'))).toBe(false);
    expect(fw.state().storyPages[0].content).toBe('Original.');
    expect(fw.state().costs.session).toBeCloseTo(0.004, 8);
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
