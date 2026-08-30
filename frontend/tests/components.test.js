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

  it('offers uncast characters in the pickers, world-mates first', () => {
    document.getElementById('storyWorld').value = 'w1';
    fw.renderCastBuilder();
    const mcOptions = [...document.getElementById('mcSelect').options].map((o) => o.textContent);
    expect(mcOptions).toEqual(['— Choose who the story follows (optional) —', 'Realm Knight', 'Outsider (other world)', 'Drifter']);
  });

  it('locks the MC once chosen and removes them from the member pool', () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();

    expect(document.getElementById('mcSelect').disabled).toBe(true);
    expect(fw.storyCast()).toEqual([{ id: 'c1', role: 'mc', relation: null }]);

    const memberOptions = [...document.getElementById('castCharSelect').options].map((o) => o.value);
    expect(memberOptions).toEqual(['', 'c2', 'c3']); // MC no longer offered
    expect(document.querySelector('#castList .cast-list__row--mc .cast-list__name').textContent).toContain('Realm Knight — Main Character');
  });

  it('replacing the MC puts the old one back in the pool', () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();
    document.querySelector('#castList .cast-list__remove').click();
    expect(fw.storyCast()).toEqual([]);
    expect([...document.getElementById('mcSelect').options].map((o) => o.value)).toContain('c1');
  });

  it('adds supporting members one at a time with a relation', () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();

    document.getElementById('castCharSelect').value = 'c2';
    document.getElementById('castTierSelect').value = 'supporting';
    document.getElementById('castRelation').value = 'owes her a life-debt from the war';
    fw.addCastMember();

    document.getElementById('castCharSelect').value = 'c3';
    document.getElementById('castTierSelect').value = 'background';
    document.getElementById('castRelation').value = '';
    fw.addCastMember();

    expect(fw.storyCast()).toEqual([
      { id: 'c1', role: 'mc', relation: null },
      { id: 'c2', role: 'supporting', relation: 'owes her a life-debt from the war' },
      { id: 'c3', role: 'background', relation: null },
    ]);
  });

  it('relation edits in the cast list update the entry', () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();
    document.getElementById('castCharSelect').value = 'c2';
    document.getElementById('castRelation').value = 'sworn shield';
    fw.addCastMember();

    const relationInput = document.querySelector('#castList .cast-list__relation');
    relationInput.value = 'sworn shield, now doubting';
    relationInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fw.storyCast()[1].relation).toBe('sworn shield, now doubting');
  });

  it('creates a story with the cast and chosen tone', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { story: { id: 's1', title: 'Tale', page_count: 0 } }));

    document.getElementById('storyTitle').value = 'Tale';
    document.getElementById('storyTone').value = 'explicit';
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();
    document.getElementById('castCharSelect').value = 'c3';
    document.getElementById('castRelation').value = 'her long-lost sister';
    fw.addCastMember();

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('storyForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [url, options] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(url).toBe('/api/stories');
    const body = JSON.parse(options.body);
    expect(body.title).toBe('Tale');
    expect(body.tone).toBe('explicit');
    expect(body.characters).toEqual([
      { id: 'c1', role: 'mc', relation: null, state: null },
      { id: 'c3', role: 'supporting', relation: 'her long-lost sister', state: null },
    ]);
    // Cast resets after a successful creation
    expect(fw.storyCast()).toEqual([]);
  });

  it('creates a story with no Main Character (an ensemble tale)', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockClear();
    // Return any POST /stories to a created story; capture the sent body
    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse(201, { story: { id: 's9', title: 'Tale' } })));
    document.getElementById('storyTitle').value = 'Tale';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('storyForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/stories') && options.method === 'POST');
    const body = JSON.parse(call[1].body);
    expect(body.characters).toEqual([]); // the scribe takes an ensemble as willingly as a lead
    expect(document.querySelector('.error-message')).toBeNull();
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

    const [url] = fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST');
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