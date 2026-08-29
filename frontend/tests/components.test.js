'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

describe('Worlds components', () => {
  let fw;

  beforeEach(() => {
    mockFetch([
      {
        match: '/api/worlds',
        method: 'GET',
        response: jsonResponse(200, {
          worlds: [
            { id: 'w1', name: 'Gothic Vale', description: 'Dark and misty', genre: 'Gothic', setting: 'Victorian' },
            { id: 'w2', name: 'Neon City', description: 'Wet streets', genre: 'Cyberpunk', setting: 'Future' },
          ],
        }),
      },
    ]);
    fw = loadScript();
  });

  it('renders world cards with safe text and delete buttons', async () => {
    await fw.loadWorlds();
    const cards = document.querySelectorAll('#worldsList .item-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('h4').textContent).toBe('Gothic Vale');
    expect(cards[0].querySelector('.item-meta').textContent).toBe('Gothic · Victorian');
    expect(cards[0].querySelector('.card-delete')).toBeTruthy();
  });

  it('populates world selects and preserves selection', async () => {
    await fw.loadWorlds();
    const select = document.getElementById('characterWorld');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'w1', 'w2']);

    select.value = 'w2';
    await fw.loadWorlds(); // reload keeps the choice
    expect(select.value).toBe('w2');
  });

  it('submits the world form via POST and resets it', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { world: { id: 'w9' } }));

    document.getElementById('worldName').value = 'New Realm';
    document.getElementById('worldGenre').value = 'Fantasy';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('worldForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let async handler complete

    const [url, options] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(url).toBe('/api/worlds');
    expect(JSON.parse(options.body).name).toBe('New Realm');
    expect(document.getElementById('worldName').value).toBe(''); // form reset
  });
});

describe('Characters and casting', () => {
  let fw;

  beforeEach(async () => {
    mockFetch([
      {
        match: (url, options) => url.includes('/api/worlds') && (!options || options.method === 'GET'),
        response: jsonResponse(200, {
          worlds: [{ id: 'w1', name: 'Realm One', description: '', genre: '', setting: '' }],
        }),
      },
      {
        match: (url, options) => url.includes('/api/characters') && (!options || options.method === 'GET'),
        response: jsonResponse(200, {
          characters: [
            { id: 'c1', name: 'Realm Knight', world_id: 'w1' },
            { id: 'c2', name: 'Outsider', world_id: 'w2' },
            { id: 'c3', name: 'Drifter', world_id: null },
          ],
        }),
      },
    ]);
    fw = loadScript();
    await fw.loadWorlds();
    await fw.loadCharacters();
  });

  it('orders the cast checkboxes: chosen-world characters first', () => {
    document.getElementById('storyWorld').value = 'w1';
    fw.updateCharacterCheckboxes();

    const labels = [...document.querySelectorAll('#characterCheckboxes label span')];
    expect(labels.map((l) => l.textContent)).toEqual(['Realm Knight', 'Outsider (other world)', 'Drifter']);
  });

  it('marks characters from other worlds when casting across worlds', () => {
    document.getElementById('storyWorld').value = 'w1';
    fw.updateCharacterCheckboxes();

    const checkboxes = document.querySelectorAll('#characterCheckboxes input');
    expect(checkboxes[0].classList.contains('in-world')).toBe(true); // knight belongs to realm
    expect(checkboxes[1].classList.contains('in-world')).toBe(false); // outsider doesn't
  });

  it('creates a story with the checked cast and chosen tone', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { story: { id: 's1', title: 'Tale', page_count: 0 } }));

    document.getElementById('storyTitle').value = 'Tale';
    document.getElementById('storyTone').value = 'explicit';
    document.querySelectorAll('#characterCheckboxes input')[0].checked = true;
    document.querySelectorAll('#characterCheckboxes input')[2].checked = true;

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('storyForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [url, options] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(url).toBe('/api/stories');
    const body = JSON.parse(options.body);
    expect(body.title).toBe('Tale');
    expect(body.tone).toBe('explicit');
    expect(body.characters).toEqual([
      { id: 'c1', role: 'supporting' },
      { id: 'c3', role: 'supporting' },
    ]);
  });

  it('casts exactly one MC and demotes the previous protagonist', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { story: { id: 's9', title: 'Tale', page_count: 0 } }));

    document.getElementById('storyWorld').value = 'w1';
    fw.updateCharacterCheckboxes();

    const rows = [...document.querySelectorAll('#characterCheckboxes .cast-row')];
    rows[0].querySelector('input').checked = true;
    rows[0].querySelector('input').dispatchEvent(new Event('change'));
    rows[1].querySelector('input').checked = true;
    rows[1].querySelector('input').dispatchEvent(new Event('change'));

    // Crown the knight, then crown the outsider - the knight must step down.
    rows[0].querySelector('.cast-role').value = 'mc';
    rows[0].querySelector('.cast-role').dispatchEvent(new Event('change'));
    rows[1].querySelector('.cast-role').value = 'mc';
    rows[1].querySelector('.cast-role').dispatchEvent(new Event('change'));

    expect([...document.querySelectorAll('.cast-role')].map((s) => s.value)).toEqual([
      'supporting', // knight demoted
      'mc', // outsider is the protagonist now
      'supporting',
    ]);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('storyForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.characters).toEqual([
      { id: 'c1', role: 'supporting' },
      { id: 'c2', role: 'mc' },
    ]);
  });
});

describe('Generation and export flows', () => {
  let fw, fetchMock;

  beforeEach(() => {
    fetchMock = mockFetch();
    fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'My Tale', tone: 'romantic', page_count: 1 },
      storyPages: [{ page_number: 1, content: 'Existing.', user_input: 'go' }],
      currentPage: 1,
    });
    fw.displayCurrentPage();
  });

  it('generates a page through the API and appends it to the reader', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 2, content: 'Fresh ink.', user_input: 'continue' } })
    );
    document.getElementById('userInput').value = 'continue';

    await fw.generateNextPage();

    const [url, options] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(url).toBe('/api/stories/s1/pages/generate');
    expect(JSON.parse(options.body).user_input).toBe('continue');

    const state = fw.state();
    expect(state.storyPages).toHaveLength(2);
    expect(state.currentPage).toBe(2);
    expect(document.getElementById('storyContent').textContent).toContain('Fresh ink.');
    expect(document.getElementById('scribeStatus').textContent).toContain('complete');
  });

  it('keeps the reader intact and shows an error when generation fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'AI on strike' }));
    await fw.generateNextPage();

    expect(fw.state().storyPages).toHaveLength(1);
    expect(document.getElementById('scribeStatus').textContent).toContain('troubled');
    expect(document.querySelector('.error-message').textContent).toContain('AI on strike');
  });

  it('blocks generate with no story selected', async () => {
    fw.__setStoryState({ currentStory: null });
    await fw.generateNextPage();
    expect(document.querySelector('.error-message').textContent).toContain('select a story');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/stories/s1/pages/generate', expect.anything());
  });

  it('regenerates the last page via the retry endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { page: { page_number: 1, content: 'Rewritten.', user_input: 'go' } })
    );
    await fw.retryLastPage();

    const [url, options] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(url).toBe('/api/stories/s1/pages/regenerate');
    expect(fw.state().storyPages[0].content).toBe('Rewritten.');
  });

  it('refuses retry when not viewing the last page', async () => {
    fw.__setStoryState({
      storyPages: [
        { page_number: 1, content: 'Existing.', user_input: 'go' },
        { page_number: 2, content: 'Later page', user_input: null },
      ],
      currentPage: 1,
    });
    await fw.retryLastPage();
    expect(document.querySelector('.error-message').textContent).toContain('last page');
  });

  it('exports the story as an EPUB download', async () => {
    const createObjectURL = jest.fn(() => 'blob:mock');
    const revokeObjectURL = jest.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/epub+zip' },
      blob: () => Promise.resolve({ size: 1234 }),
    });

    const clicks = [];
    HTMLAnchorElement.prototype.click = function () {
      clicks.push(this.download);
    };

    await fw.exportStory();

    const url = fetchMock.mock.calls.map((c) => c[0]).find((u) => u.endsWith('/export'));
    expect(url).toBe('/api/stories/s1/export');
    expect(clicks).toEqual(['my_tale.epub']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});

describe('Delete page flow', () => {
  it('deletes the currently viewed page and reloads', async () => {
    const fetchMock = mockFetch();
    const fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 2 },
      storyPages: [
        { page_number: 1, content: 'One', user_input: null },
        { page_number: 2, content: 'Two', user_input: null },
      ],
      currentPage: 2,
    });
    fw.displayCurrentPage();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { pages: [{ page_number: 1, content: 'One', user_input: null }] }));

    window.confirm = () => true;
    await fw.deleteCurrentPage();

    const called = fetchMock.mock.calls.map((c) => c[0]);
    expect(called).toContain('/api/stories/s1/pages/2');
    expect(fw.state().storyPages).toHaveLength(1);
    expect(fw.state().currentPage).toBe(1);
  });
});