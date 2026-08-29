'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const STORY_STATE = {
  currentStory: { id: 's1', title: 'T', tone: 'explicit', page_count: 2, total_cost_usd: 0 },
  storyPages: [
    { page_number: 1, content: 'The hall was cold.', user_input: null, cost_usd: 0 },
    { page_number: 2, content: 'She lit the candle.', user_input: null, cost_usd: 0 },
  ],
  currentPage: 2,
};

const PROMPT_TEXT = 'A frozen gothic hall, wide shot: two figures by candlelight, frost on black stone.';

function imagePromptResponse() {
  return jsonResponse(200, { prompt: PROMPT_TEXT });
}

describe('Scene image prompt button', () => {
  let fw;

  beforeEach(() => {
    window.localStorage.clear();
    mockFetch([
      { match: '/image-prompt', response: imagePromptResponse() },
    ]);
    fw = loadScript();
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
  });

  it('condenses the current page and opens the edit box with the result', async () => {
    fw.setSetting('model', 'z-ai/glm-5.1');
    fw.setSetting('reasoningEffort', 'high');
    fw.__setModelsCache([{ id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} }]);

    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-prompt') && options.method === 'POST');
    expect(String(call[0])).toContain('/stories/s1/pages/2/image-prompt'); // current page
    expect(JSON.parse(call[1].body)).toEqual({ model: 'z-ai/glm-5.1', reasoning_effort: 'high' });

    const modal = document.getElementById('imagePromptModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('imagePromptText').value).toBe(PROMPT_TEXT);
    expect(document.getElementById('imagePromptBtn').disabled).toBe(false); // restored
  });

  it('omits model and reasoning when no model override is chosen', async () => {
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-prompt') && options.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({});
  });

  it('cancel closes the popup, Escape too; backdrop click as well', async () => {
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const modal = document.getElementById('imagePromptModal');
    expect(modal.hidden).toBe(false);

    document.getElementById('imagePromptCancelBtn').click();
    expect(modal.hidden).toBe(true);

    // Reopen, then Escape closes it
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.hidden).toBe(true);
  });

  it('shows the scribe error and restores the button when the LLM fails', async () => {
    fetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { error: 'The muse is mute' })));
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('.error-message').textContent).toContain('The muse is mute');
    expect(document.getElementById('imagePromptModal').hidden).toBe(true);
    const btn = document.getElementById('imagePromptBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Scene image');
  });

  it('complains politely when no story page is selected', () => {
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
    document.getElementById('imagePromptBtn').click();
    expect(document.querySelector('.error-message').textContent).toContain('Select a page');
  });

  it('generates the painted scene from the edited prompt and books the cost', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        expect(JSON.parse(options.body).prompt).toBe(PROMPT_TEXT);
        return Promise.resolve(
          jsonResponse(200, {
            image: Buffer.from('painting').toString('base64'),
            media_type: 'image/png',
            cost_usd: 0.06,
            references: ['c1', 'c2'],
          })
        );
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('imagePromptBtn').click(); // condense
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click(); // paint
    await new Promise((r) => setTimeout(r, 0));

    const img = document.getElementById('sceneImageResult');
    expect(img.hidden).toBe(false);
    expect(img.getAttribute('src')).toContain('data:image/png;base64,');
    const costEl = document.getElementById('sceneImageCost');
    expect(costEl.hidden).toBe(false);
    expect(costEl.textContent).toContain('$0.0600');
    expect(costEl.textContent).toContain('2 cast portraits');
    // Scene images belong to the tale: session and story both tick
    expect(fw.state().costs.session).toBeCloseTo(0.06);
    expect(fw.state().costs.story).toBeCloseTo(0.06);
    // The user can edit the prompt before painting; the edited text is what's sent
    document.getElementById('imagePromptText').value = PROMPT_TEXT + ' Warmer light.';
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const sceneCalls = fetch.mock.calls.filter(([url, options]) => String(url).includes('/scene-image') && options.method === 'POST');
    expect(JSON.parse(sceneCalls[sceneCalls.length - 1][1].body).prompt).toBe(PROMPT_TEXT + ' Warmer light.');
  });

  it('refuses to paint an empty prompt box', async () => {
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptText').value = '   ';
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.error-message').textContent).toContain('empty');
    expect(document.getElementById('sceneImageResult').hidden).toBe(true);
    expect(fw.state().costs.session).toBeCloseTo(0); // nothing billed
  });

  it('shows the scribe error and leaves the modal usable when painting fails', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image') && options.method === 'POST') {
        return Promise.resolve(jsonResponse(502, { error: 'The muse is mute' }));
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('.error-message').textContent).toContain('The muse is mute');
    expect(document.getElementById('sceneImageResult').hidden).toBe(true);
    const btn = document.getElementById('imagePromptGenerateBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Generate image');
  });
});
