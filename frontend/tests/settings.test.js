'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

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
  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
  });

  it('defaults: server model, no scriptorium bg, ticker on', async () => {
    const fw = await loadScript();
    expect(fw.state().settings).toEqual({ model: null, scriptoriumBg: false, costTicker: true, storyFont: 'literata', wordsPerPage: 400, narrationModel: null, narrationVoice: null, reasoningEffort: null, storyFontSize: 18, sceneRenderQuality: 'low_1k' });
    expect(document.getElementById('costTicker').hidden).toBe(false);
    expect(document.getElementById('writeSection').classList.contains('scriptorium-bg')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--st-prose-family')).toContain('Literata');
  });

  it('toggles persist to localStorage and apply immediately', async () => {
    const fw = await loadScript();

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
  beforeEach(async () => {
    window.localStorage.clear();
  });

  it('renders the catalog, filters by search, and selects a model', async () => {
    mockModels();
    const fw = await loadScript();

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
    const fw = await loadScript();
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
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.model).toBe('z-ai/glm-5.1');
  });

  it('omits the model field when the server default is used', async () => {
    const fetchMock = mockModels();
    const fw = await loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 0 },
      storyPages: [],
      currentPage: 1,
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Words.', user_input: null, cost_usd: null } })
    );
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect('model' in body).toBe(false);
  });
});

describe('Story font selector', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
  });

  it('renders all presets with the selected one marked', async () => {
    const fw = await loadScript();
    const items = document.querySelectorAll('#fontList .font-item');
    expect(items).toHaveLength(Object.keys(fw.STORY_FONTS).length);
    expect(items[0].classList.contains('selected')).toBe(true); // literata default
    expect(items[0].style.fontFamily).toContain('Literata');
  });

  it('sets the prose CSS variable and persists the choice', async () => {
    const fw = await loadScript();
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

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
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
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

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
    const retry = fw.retryLastPage();
    expect(await paidReview('confirm')).toBe(true);
    await retry;

    // old page cost 0.01 replaced by 0.02 -> story +0.01
    expect(fw.state().costs.story).toBeCloseTo(0.02, 8);
    // The provider billed the full new rewrite; session spend never applies
    // the persisted-page replacement delta.
    expect(fw.state().costs.session).toBeCloseTo(0.02, 8);
  });

  it('books a cheaper rewrite in full without decreasing session spend', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { page: { page_number: 1, content: 'Shorter redo.', user_input: null, cost_usd: 0.004 } })
    );
    const retry = fw.retryLastPage();
    expect(await paidReview('confirm')).toBe(true);
    await retry;

    expect(fw.state().costs.story).toBeCloseTo(0.004, 8);
    expect(fw.state().costs.session).toBeCloseTo(0.004, 8);
  });

  it('hides when the setting is off', async () => {
    fw.setSetting('costTicker', false);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 2, content: 'New.', user_input: null, cost_usd: 0.0025 } })
    );
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;

    expect(fw.state().costs.session).toBeCloseTo(0.0025, 8); // still tracked
    expect(document.getElementById('costTicker').hidden).toBe(true);
  });
});
describe('Words per page setting', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
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
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.words).toBe(400);
  });

  it('clamps and persists edited values', async () => {
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
    const retry = fw.retryLastPage();
    expect(await paidReview('confirm')).toBe(true);
    await retry;
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.words).toBe(400);
  });
});

describe('Reasoning level selector', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
    fw = await loadScript();
  });

  it('appears with a medium default when a reasoning model is selected', async () => {
    fw.setSetting('model', 'z-ai/glm-5.1');
    // Simulate the catalog knowing this model can reason
    fw.__setModelsCache([{ id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} }]);
    fw.renderModelList();

    expect(document.getElementById('reasoningBlock').hidden).toBe(false);
    expect(fw.state().settings.reasoningEffort).toBe('medium');
    expect(document.getElementById('reasoningSelect').value).toBe('medium');
  });

  it('shows reasoning for the server default model and uses its declared capabilities', async () => {
    fw.__setModelsCache([
      {
        id: 'z-ai/glm-5.3',
        name: 'GLM 5.3',
        reasoning: true,
        reasoning_efforts: ['max', 'high', 'low'],
        reasoning_default: 'max',
        reasoning_mandatory: true,
        is_default: true,
        context_length: 200000,
        pricing: {},
      },
    ]);
    fw.renderModelList();

    expect(fw.state().settings.model).toBeNull();
    expect(document.getElementById('currentModel').textContent).toBe('Server default: z-ai/glm-5.3');
    expect(document.getElementById('reasoningBlock').hidden).toBe(false);
    expect([...document.getElementById('reasoningSelect').options].map((option) => option.value)).toEqual([
      'max', 'high', 'low',
    ]);
    expect(document.getElementById('reasoningSelect').value).toBe('max');
    expect(fw.state().settings.reasoningEffort).toBe('max');
  });

  it('renders lower and higher levels only when the selected model supports them', async () => {
    fw.setSetting('model', 'vendor/wide-ladder');
    fw.__setModelsCache([
      {
        id: 'vendor/wide-ladder',
        name: 'Wide Ladder',
        reasoning: true,
        reasoning_efforts: ['xhigh', 'medium', 'low', 'minimal', 'none'],
        reasoning_default: 'xhigh',
        context_length: 1000,
        pricing: {},
      },
    ]);
    fw.renderModelList();
    expect([...document.getElementById('reasoningSelect').options].map((option) => option.value)).toEqual([
      'xhigh', 'medium', 'low', 'minimal', 'none',
    ]);
    expect(document.getElementById('reasoningSelect').value).toBe('xhigh');
  });

  it('is hidden for plain models and the effort is cleared on switch', async () => {
    fw.setSetting('model', 'z-ai/glm-5.1');
    fw.setSetting('reasoningEffort', 'high');
    fw.__setModelsCache([{ id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} }]);
    fw.renderModelList();
    expect(document.getElementById('reasoningBlock').hidden).toBe(false);

    // Switch to a non-reasoning model: selector hides and the effort resets
    fw.setSetting('model', 'plain/model');
    fw.__setModelsCache([
      { id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} },
      { id: 'plain/model', name: 'Plain', reasoning: false, context_length: 1000, pricing: {} },
    ]);
    fw.renderModelList();
    expect(document.getElementById('reasoningBlock').hidden).toBe(true);
    expect(fw.state().settings.reasoningEffort).toBeNull();
  });

  it('sends reasoning_effort with generate only for reasoning models', async () => {
    const fetchMock = global.fetch;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Thoughtful.', user_input: null, cost_usd: null } })
    );
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 0, total_cost_usd: 0 },
      storyPages: [],
      currentPage: 1,
    });

    // Plain model: no reasoning field
    fw.setSetting('model', 'plain/model');
    fw.__setModelsCache([{ id: 'plain/model', name: 'Plain', reasoning: false, context_length: 1000, pricing: {} }]);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 1, content: 'Quick.', user_input: null, cost_usd: null } })
    );
    const gen = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await gen;
    let body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect('reasoning_effort' in body).toBe(false);

    // Reasoning model: effort goes along (a direction forces the live write,
    // skipping the prepared-page commit branch entirely)
    document.getElementById('userInput').value = 'go on';
    fw.setSetting('model', 'z-ai/glm-5.1');
    fw.setSetting('reasoningEffort', 'high');
    fw.__setModelsCache([{ id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} }]);
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 1, total_cost_usd: 0 },
      storyPages: [{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0 }],
      currentPage: 1,
    });
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { page: { page_number: 2, content: 'Deep.', user_input: null, cost_usd: null } })
    );
    const deep = fw.generateNextPage();
    expect(await paidReview('confirm')).toBe(true);
    await deep;
    body = JSON.parse(fetchMock.mock.calls.find((c) => c[1] && c[1].method === 'POST')[1].body);
    expect(body.reasoning_effort).toBe('high');
  });
});

describe('Story font size picker', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
    fw = await loadScript();
  });

  it('defaults to 18px and sets the prose size variable', async () => {
    expect(fw.state().settings.storyFontSize).toBe(18);
    expect(document.documentElement.style.getPropertyValue('--st-prose-size')).toBe('18px');
    expect(document.getElementById('fontSizeSelect').value).toBe('18');
  });

  it('changes persist and update the variable, clamped to a readable range', async () => {
    const select = document.getElementById('fontSizeSelect');
    select.value = '22';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fw.state().settings.storyFontSize).toBe(22);
    expect(document.documentElement.style.getPropertyValue('--st-prose-size')).toBe('22px');
    expect(JSON.parse(window.localStorage.getItem('st-settings')).storyFontSize).toBe(22);

    // Out-of-range values clamp instead of breaking the reading pane
    fw.setSetting('storyFontSize', 99);
    expect(fw.state().settings.storyFontSize).toBe(24);
    expect(document.documentElement.style.getPropertyValue('--st-prose-size')).toBe('24px');
  });
});
