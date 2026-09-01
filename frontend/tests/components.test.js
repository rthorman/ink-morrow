'use strict';

import { jest } from '@jest/globals';
import { loadScript, mockFetch, jsonResponse, dialogAction, paidReview } from './dom-helpers.js';

describe('Worlds components', () => {
  let fw;

  beforeEach(async () => {
    window.sessionStorage.clear();
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
    fw = await loadScript();
  });

  it('renders world cards with safe text and delete buttons', async () => {
    await fw.loadWorlds();
    const cards = document.querySelectorAll('#worldsList .item-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('h4').textContent).toBe('Gothic Vale');
    expect(cards[0].querySelector('.item-meta').textContent).toBe('Gothic · Victorian');
    expect(cards[0].querySelector('.card-edit')).toBeTruthy();
    expect(cards[0].querySelector('.card-more__item--danger')).toBeTruthy();
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
    // Creating a world paints its scene by default: pass the paid review.
    expect(await paidReview('confirm')).toBe(true);
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
    window.sessionStorage.clear();
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
    fw = await loadScript();
    await fw.loadWorlds();
    await fw.loadCharacters();
  });

  it('offers uncast characters in the pickers, world-mates first', async () => {
    document.getElementById('startWorld').value = 'w1';
    fw.renderCastBuilder();
    const mcOptions = [...document.getElementById('mcSelect').options].map((o) => o.textContent);
    expect(mcOptions).toEqual(['— Choose who the manuscript follows —', 'Realm Knight', 'Outsider (other world)', 'Drifter']);
  });

  it('locks the MC once chosen and removes them from the member pool', async () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();

    expect(document.getElementById('mcSelect').disabled).toBe(true);
    expect(fw.storyCast()).toEqual([{ id: 'c1', role: 'mc', relation: null }]);

    const memberOptions = [...document.getElementById('castCharSelect').options].map((o) => o.value);
    expect(memberOptions).toEqual(['', 'c2', 'c3']); // MC no longer offered
    const leadRow = document.querySelector('#castList .cast-list__row--mc');
    expect(leadRow.querySelector('.cast-list__name').textContent).toBe('Realm Knight');
    expect(leadRow.querySelector('.cast-list__role').textContent).toBe('Lead');
  });

  it('replacing the MC puts the old one back in the pool', async () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();
    document.querySelector('#castList .cast-list__remove').click();
    expect(fw.storyCast()).toEqual([]);
    expect([...document.getElementById('mcSelect').options].map((o) => o.value)).toContain('c1');
  });

  it('switches from a centered lead to an ensemble without dropping that character', async () => {
    document.getElementById('castModeCentered').click();
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();

    document.getElementById('castModeEnsemble').click();

    expect(fw.castMode()).toBe('ensemble');
    expect(fw.storyCast()).toEqual([{ id: 'c1', role: 'supporting', relation: null }]);
    expect(document.getElementById('castLeadRow').hidden).toBe(true);
    expect(document.getElementById('castModeEnsemble').getAttribute('aria-checked')).toBe('true');
  });

  it('adds supporting and background members through the real button with visible roles', async () => {
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();

    document.getElementById('castCharSelect').value = 'c2';
    document.getElementById('castTierSelect').value = 'supporting';
    document.getElementById('castRelation').value = 'owes her a life-debt from the war';
    document.getElementById('castAddBtn').click();

    document.getElementById('castCharSelect').value = 'c3';
    document.getElementById('castTierSelect').value = 'background';
    document.getElementById('castRelation').value = '';
    document.getElementById('castAddBtn').click();

    expect(fw.storyCast()).toEqual([
      { id: 'c1', role: 'mc', relation: null },
      { id: 'c2', role: 'supporting', relation: 'owes her a life-debt from the war' },
      { id: 'c3', role: 'background', relation: null },
    ]);
    expect([...document.querySelectorAll('#castList .cast-list__role')].map((el) => el.textContent)).toEqual([
      'Lead',
      'Supporting',
      'Background',
    ]);
  });

  it('preserves an in-progress member across a passive character-catalog refresh', async () => {
    document.getElementById('castCharSelect').value = 'c3';
    document.getElementById('castTierSelect').value = 'background';
    document.getElementById('castRelation').value = 'a witness the lead has not noticed';

    // Portrait polling calls loadCharacters(), which used to clear all three
    // controls and make a slow Add-to-cast interaction silently do nothing.
    await fw.loadCharacters();

    expect(document.getElementById('castCharSelect').value).toBe('c3');
    expect(document.getElementById('castTierSelect').value).toBe('background');
    expect(document.getElementById('castRelation').value).toBe('a witness the lead has not noticed');

    document.getElementById('castAddBtn').click();
    expect(fw.storyCast()).toEqual([
      { id: 'c3', role: 'background', relation: 'a witness the lead has not noticed' },
    ]);
    expect(document.querySelector('#castList .cast-list__role').textContent).toBe('Background');
  });

  it('relation edits in the cast list update the entry', async () => {
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

    document.getElementById('manuscriptStartName').value = 'Tale';
    document.getElementById('manuscriptStartTone').value = 'explicit';
    document.getElementById('startManualOpening').value = 'The tale begins.';
    document.getElementById('mcSelect').value = 'c1';
    fw.chooseMainCharacter();
    document.getElementById('castCharSelect').value = 'c3';
    document.getElementById('castTierSelect').value = 'supporting';
    document.getElementById('castRelation').value = 'her long-lost sister';
    document.getElementById('castAddBtn').click();

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('manuscriptStartForm').dispatchEvent(event);
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
    // Return any POST /stories to a created story; the list includes it so
    // the post-create navigation to the writing desk can resolve the tale.
    fetchMock.mockImplementation((url, options) => {
      if (options && options.method === 'POST') return Promise.resolve(jsonResponse(201, { story: { id: 's9', title: 'Tale', page_count: 0 } }));
      if (String(url).endsWith('/stories')) return Promise.resolve(jsonResponse(200, { stories: [{ id: 's9', title: 'Tale', page_count: 0 }] }));
      return Promise.resolve(jsonResponse(200, {}));
    });
    document.getElementById('manuscriptStartName').value = 'Tale';
    document.getElementById('startManualOpening').value = 'The tale begins.';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    document.getElementById('manuscriptStartForm').dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/stories') && options.method === 'POST');
    const body = JSON.parse(call[1].body);
    expect(body.characters).toEqual([]); // the scribe takes an ensemble as willingly as a lead
    expect(document.querySelector('.error-message')).toBeNull();
  });

  it('creates from Write with the chosen maturity and an optional paid cover', async () => {
    window.localStorage.removeItem('st-paid-consent-v1');
    const fetchMock = global.fetch;
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/api/stories') && options?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { story: { id: 's-cover', title: 'Veiled', page_count: 0 } }));
      }
      if (String(url).endsWith('/api/stories')) {
        return Promise.resolve(jsonResponse(200, { stories: [{ id: 's-cover', title: 'Veiled', page_count: 0 }] }));
      }
      if (String(url).endsWith('/api/storage')) return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });
    document.getElementById('manuscriptStartName').value = 'Veiled';
    document.getElementById('manuscriptStartTone').value = 'romantic';
    document.getElementById('startManualOpening').value = 'A veiled beginning.';
    const event = new Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'submitter', { value: document.getElementById('manuscriptStartWithCover') });
    document.getElementById('manuscriptStartForm').dispatchEvent(event);
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith('/api/stories') && options?.method === 'POST');
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({ title: 'Veiled', tone: 'romantic', generate_image: true });
  });
});


describe('Generation and export flows', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    fetchMock = mockFetch();
    fw = await loadScript();
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

    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

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
    document.getElementById('userInput').value = 'Continue despite the danger.';
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

    expect(fw.state().storyPages).toHaveLength(1);
    expect(document.getElementById('scribeStatus').textContent).toContain('troubled');
    expect(document.querySelector('.error-message').textContent).toContain('AI on strike');
  });

  it('blocks generate with no story selected', async () => {
    fw.__setStoryState({ currentStory: null });
    await fw.generateNextPage();
    expect(document.querySelector('.error-message').textContent).toContain('choose a manuscript');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/stories/s1/pages/generate', expect.anything());
  });

  it('regenerates the last page via the retry endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { page: { page_number: 1, content: 'Rewritten.', user_input: 'go' } })
    );
    const retry = fw.retryLastPage();
    expect(await paidReview('confirm')).toBe(true);
    await retry;

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
    const fw = await loadScript();
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

    const deleting = fw.deleteCurrentPage();
    expect(await dialogAction('Delete page 2')).toBe(true);
    await deleting;

    const called = fetchMock.mock.calls.map((c) => c[0]);
    expect(called).toContain('/api/stories/s1/pages/2');
    expect(fw.state().storyPages).toHaveLength(1);
    expect(fw.state().currentPage).toBe(1);
  });
});
