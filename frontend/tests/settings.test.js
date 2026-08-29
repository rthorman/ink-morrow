'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const MODELS = [
  { id: 'z-ai/glm-5.1', name: 'GLM 5.1', context_length: 128000, pricing: { prompt_per_mtok: 1.5, completion_per_mtok: 2 } },
  { id: 'a/other-model', name: 'Other Model', context_length: 64000, pricing: { prompt_per_mtok: 10, completion_per_mtok: 30 } },
];

function mockModels() {
  return mockFetch([
    { match: '/api/models', response: jsonResponse(200, { models: MODELS }) },
  ]);
}

describe('Settings defaults and persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetch();
  });

  it('defaults: server model, no scriptorium bg, ticker on', () => {
    const fw = loadScript();
    expect(fw.state().settings).toEqual({ model: null, scriptoriumBg: false, costTicker: true, storyFont: 'literata', wordsPerPage: 400, narrationModel: null, narrationVoice: null });
    expect(document.getElementById('costTicker').hidden).toBe(false);
    expect(document.getElementById('writeSection').classList.contains('scriptorium-bg')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--st-prose-family')).toContain('Literata');
  });

  it('toggles persist to localStorage and apply immediately', () => {
    const fw = loadScript();

    document.getElementById('costTickerToggle').checked = false;
    document.getElementById('costTickerToggle').dispatchEvent(new Event('change'));
    expect(fw.state().settings.costTicker).toBe(false);
    expect(document.getElementById('costTicker').hidden).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('st-settings')).costTicker).toBe(false);

    document.getElementById('scriptoriumBgToggle').checked = true;
    document.getElementById('scriptoriumBgToggle').dispatchEvent(new Event('change'));
    expect(fw.state().settings.scriptoriumBg).toBe(true);
    expect(document.getElementById('writeSection').classList.contains('scriptorium-bg')).toBe(true);
  });
});

describe('Model picker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the catalog, filters by search, and selects a model', async () => {
    mockModels();
    const fw = loadScript();

    await fw.loadModels();
    fw.renderModelList();
    let items = document.querySelectorAll('#modelList .model-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('$1.50');
    expect(items[0].textContent).toContain('128k ctx');

    document.getElementById('modelSearch').value = 'other';
    fw.renderModelList();
    items = document.querySelectorAll('#modelList .model-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('a/other-model');

    items[0].click();
    expect(fw.state().settings.model).toBe('a/other-model');
    expect(document.getElementById('currentModel').textContent).toContain('a/other-model');

    document.getElementById('modelResetBtn').click();
    expect(fw.state().settings.model).toBeNull();
    expect(document.getElementById('currentModel').textContent).toContain('server default');
  });

  it('sends the selected model with generate requests', async () => {
    const fetchMock = mockModels();
    const fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 0 },
      storyPages: [],
      currentPage: 1,
    });

    await fw.loadModels();
    fw.setSetting('model', 'z-ai/glm-5.1');

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Words.', user_input: null, cost_usd: null } })
    );
    await fw.generateNextPage();

    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.model).toBe('z-ai/glm-5.1');
  });

  it('omits the model field when the server default is used', async () => {
    const fetchMock = mockModels();
    const fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 0 },
      storyPages: [],
      currentPage: 1,
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Words.', user_input: null, cost_usd: null } })
    );
    await fw.generateNextPage();

    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect('model' in body).toBe(false);
  });
});

describe('Story font selector', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockFetch();
  });

  it('renders all presets with the selected one marked', () => {
    const fw = loadScript();
    const items = document.querySelectorAll('#fontList .font-item');
    expect(items).toHaveLength(Object.keys(fw.STORY_FONTS).length);
    expect(items[0].classList.contains('selected')).toBe(true); // literata default
    expect(items[0].style.fontFamily).toContain('Literata');
  });

  it('sets the prose CSS variable and persists the choice', () => {
    const fw = loadScript();
    const mono = [...document.querySelectorAll('#fontList .font-item')].find((b) =>
      b.textContent.includes('IBM Plex Mono')
    );
    mono.click();

    expect(fw.state().settings.storyFont).toBe('mono');
    expect(document.documentElement.style.getPropertyValue('--st-prose-family')).toContain('IBM Plex Mono');
    expect(JSON.parse(window.localStorage.getItem('st-settings')).storyFont).toBe('mono');
    const selectedNow = document.querySelector('#fontList .font-item.selected');
    expect(selectedNow.textContent).toContain('IBM Plex Mono');
  });
});

describe('Cost ticker', () => {
  let fw, fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 1, total_cost_usd: 0.01 },
      storyPages: [{ page_number: 1, content: 'Existing.', user_input: null, cost_usd: 0.01 }],
      currentPage: 1,
    });
  });

  it('accumulates session and story cost from generated pages', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 2, content: 'New.', user_input: null, cost_usd: 0.0025 } })
    );
    await fw.generateNextPage();

    expect(fw.state().costs.session).toBeCloseTo(0.0025, 8);
    const ticker = document.getElementById('costTicker');
    expect(ticker.hidden).toBe(false);
    expect(ticker.textContent).toContain('$0.0025'); // session
    expect(ticker.textContent).toContain('$0.0125'); // story = 0.01 + 0.0025
  });

  it('adjusts the story total by the cost delta when retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { page: { page_number: 1, content: 'Redone.', user_input: null, cost_usd: 0.02 } })
    );
    await fw.retryLastPage();

    // old page cost 0.01 replaced by 0.02 -> story +0.01
    expect(fw.state().costs.story).toBeCloseTo(0.02, 8);
    expect(fw.state().costs.session).toBeCloseTo(0.01, 8);
  });

  it('hides when the setting is off', async () => {
    fw.setSetting('costTicker', false);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 2, content: 'New.', user_input: null, cost_usd: 0.0025 } })
    );
    await fw.generateNextPage();

    expect(fw.state().costs.session).toBeCloseTo(0.0025, 8); // still tracked
    expect(document.getElementById('costTicker').hidden).toBe(true);
  });
});
describe('Words per page setting', () => {
  let fw, fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 0, total_cost_usd: 0 },
      storyPages: [],
      currentPage: 1,
    });
  });

  it('defaults to 400 and is sent with generate requests', async () => {
    expect(fw.state().settings.wordsPerPage).toBe(400);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Words.', user_input: null, cost_usd: null } })
    );
    await fw.generateNextPage();
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.words).toBe(400);
  });

  it('clamps and persists edited values', () => {
    const input = document.getElementById('wordsPerPageInput');
    input.value = '5000';
    input.dispatchEvent(new Event('change'));
    expect(fw.state().settings.wordsPerPage).toBe(2000);
    expect(input.value).toBe('2000');
    expect(JSON.parse(window.localStorage.getItem('st-settings')).wordsPerPage).toBe(2000);

    input.value = '120';
    input.dispatchEvent(new Event('change'));
    expect(fw.state().settings.wordsPerPage).toBe(120);
  });

  it('is sent with retry requests too', async () => {
    fw.__setStoryState({
      storyPages: [{ page_number: 1, content: 'Old.', user_input: null, cost_usd: null }],
      currentPage: 1,
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { page: { page_number: 1, content: 'New.', user_input: null, cost_usd: null } })
    );
    await fw.retryLastPage();
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.words).toBe(400);
  });
});
