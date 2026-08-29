'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const AI_WORLD = {
  name: 'The Ashen Marches',
  description: 'A drowned kingdom where the tide remembers names.',
  genre: 'Gothic fantasy',
  setting: 'Tidal ruins',
};

describe('AI world drafts', () => {
  let fw, fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mockFetch([
      { match: '/api/ai/world', response: jsonResponse(200, { world: AI_WORLD, cost_usd: 0.001, model: 'x' }) },
    ]);
    fw = loadScript();
  });

  it('seeds from the form, renders editable fields, and saves on request', async () => {
    document.getElementById('worldName').value = 'Ashen';
    document.getElementById('worldGenre').value = 'Gothic';
    fw.openAiDraft('world');
    expect(document.getElementById('aiDraftModal').hidden).toBe(false);
    expect(document.querySelectorAll('#aiDraftBody .seg-btn')).toHaveLength(3);

    // Generate sends the seeds + chosen length
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/api/ai/world') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { world: AI_WORLD, cost_usd: 0.001, model: 'x' }));
      }
      return Promise.resolve(jsonResponse(200, { worlds: [] }));
    });
    document.querySelector('#aiDraftBody .seg-btn[data-length="short"], #aiDraftBody .seg-btn:nth-child(1)').click?.();
    // choose "Short" via the segmented control
    const segButtons = [...document.querySelectorAll('#aiDraftBody .seg-btn')];
    segButtons[0].click(); // short
    const genBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent.includes('Ask the scribe'));
    genBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const draftCall = fetchMock.mock.calls.find((c) => c[0].includes('/api/ai/world'));
    expect(draftCall).toBeTruthy();
    const body = JSON.parse(draftCall[1].body);
    expect(body.name).toBe('Ashen');
    expect(body.genre).toBe('Gothic');
    expect(body.length).toBe('short');
    expect(body.variant).toBe(1);

    // Draft fields are rendered and editable
    const nameInput = document.getElementById('draft-name');
    expect(nameInput.value).toBe('The Ashen Marches');
    nameInput.value = 'The Ashen Marches, Revised';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Session cost picked up the draft
    expect(fw.state().costs.session).toBeCloseTo(0.001, 8);

    // Save posts the edited draft to the normal API
    fetchMock.mockClear();
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/api/ai/world')) return Promise.resolve(jsonResponse(200, { world: AI_WORLD, cost_usd: 0, model: 'x' }));
      if (url.includes('/api/worlds') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { world: { id: 'w9', name: 'The Ashen Marches, Revised' } }));
      }
      return Promise.resolve(jsonResponse(200, { worlds: [] }));
    });
    const saveBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent === 'Save as World');
    saveBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saveCall = fetchMock.mock.calls.find((c) => c[0] === '/api/worlds');
    expect(saveCall).toBeTruthy();
    expect(JSON.parse(saveCall[1].body).name).toBe('The Ashen Marches, Revised');
    expect(document.getElementById('aiDraftModal').hidden).toBe(true);
  });

  it('regenerate asks for a different take', async () => {
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/api/ai/world') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { world: AI_WORLD, cost_usd: 0, model: 'x' }));
      }
      return Promise.resolve(jsonResponse(200, { worlds: [] }));
    });
    fw.openAiDraft('world');
    const genBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent.includes('Ask the scribe'));
    genBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchMock.mockClear();

    const regenBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent.includes('Regenerate'));
    regenBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const draftCall = fetchMock.mock.calls.find((c) => c[0].includes('/api/ai/world'));
    expect(JSON.parse(draftCall[1].body).variant).toBe(2);
  });
});

describe('AI character drafts', () => {
  it('seeds world_id and saves with it', async () => {
    const fetchMock = mockFetch();
    const AI_CHAR = {
      name: 'Quist',
      description: 'A locksmith who cannot stop opening things.',
      personality: 'Precise, quietly obsessive',
      appearance: 'Ink-stained fingers, coat of keys',
      background: 'Dismissed vault-keeper',
    };
    // The app loads worlds/characters/stories on boot; feed it a world so the
    // character select contains 'w1' and survives updateWorldSelects.
    fetchMock.mockImplementation((url, options) => {
      if (url.includes('/api/ai/character') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { character: AI_CHAR, cost_usd: 0, model: 'x' }));
      }
      if (url.includes('/api/characters') && options && options.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { character: { id: 'c9', name: 'Quist' } }));
      }
      if (url.includes('/api/worlds')) {
        return Promise.resolve(jsonResponse(200, { worlds: [{ id: 'w1', name: 'Realm', description: '', genre: '', setting: '' }] }));
      }
      return Promise.resolve(jsonResponse(200, { characters: [], stories: [] }));
    });

    const fw = loadScript();
    // Let the app's boot loads (worlds/characters/stories) settle first
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.getElementById('characterName').value = 'locksmith';
    const worldSelect = document.getElementById('characterWorld');
    worldSelect.value = 'w1';

    fw.openAiDraft('character');
    const genBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent.includes('Ask the scribe'));
    genBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const draftCall = fetchMock.mock.calls.find((c) => c[0].includes('/api/ai/character'));
    expect(JSON.parse(draftCall[1].body).world_id).toBe('w1');
    expect(JSON.parse(draftCall[1].body).name).toBe('locksmith');

    const saveBtn = [...document.querySelectorAll('#aiDraftBody button')].find((b) => b.textContent === 'Save as Character');
    saveBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saveCall = fetchMock.mock.calls.find((c) => c[0] === '/api/characters' && c[1] && c[1].method === 'POST');
    const savedBody = JSON.parse(saveCall[1].body);
    expect(savedBody.name).toBe('Quist');
    expect(savedBody.world_id).toBe('w1');
  });
});