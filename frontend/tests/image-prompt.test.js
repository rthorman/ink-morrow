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

  it('errors surface ON TOP of an open modal, and inline when none is open', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image') && options.method === 'POST') {
        return Promise.resolve(jsonResponse(502, { error: 'The muse is mute' }));
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    // No modal open: the error lands inline in the section, as always
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const inline = document.querySelector('.error-message');
    expect(inline.classList.contains('message--floating')).toBe(false);
    expect(inline.closest('main')).toBeTruthy();
    inline.remove();

    // Prompt popup open: any error it raises floats above the modal instead
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptText').value = PROMPT_TEXT;
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const floating = document.querySelector('.error-message');
    expect(floating.textContent).toContain('The muse is mute');
    expect(floating.classList.contains('message--floating')).toBe(true);
    expect(floating.closest('body')).toBeTruthy(); // on top of the modal, not buried under it
  });

  it('generates the painted scene from the edited prompt: popup viewer, cost booked', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
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

    // The first paint used the condensed prompt as-is, with the default render
    const firstSend = JSON.parse(fetch.mock.calls.find(([url, options]) => String(url).includes('/scene-image'))[1].body);
    expect(firstSend.prompt).toBe(PROMPT_TEXT);
    expect(firstSend.render).toBe('low_1k');

    // The painting opens in its own zoomable popup, never inline
    const viewer = document.getElementById('sceneImageViewerModal');
    expect(viewer.hidden).toBe(false);
    const img = document.getElementById('sceneViewerImg');
    expect(img.getAttribute('src')).toContain('data:image/png;base64,');
    const costEl = document.getElementById('sceneImageCost');
    expect(costEl.hidden).toBe(false);
    expect(costEl.textContent).toContain('$0.0600');
    expect(costEl.textContent).toContain('2 cast portraits');
    // Scene images belong to the tale: session and story both tick
    expect(fw.state().costs.session).toBeCloseTo(0.06);
    expect(fw.state().costs.story).toBeCloseTo(0.06);

    // Close returns to the prompt popup, which is still open behind the viewer
    document.getElementById('sceneViewerCloseBtn').click();
    expect(viewer.hidden).toBe(true);
    expect(document.getElementById('imagePromptModal').hidden).toBe(false);

    // The user can edit the prompt before painting; the edited text is what's sent
    document.getElementById('imagePromptText').value = PROMPT_TEXT + ' Warmer light.';
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const sceneCalls = fetch.mock.calls.filter(([url, options]) => String(url).includes('/scene-image') && options.method === 'POST');
    expect(JSON.parse(sceneCalls[sceneCalls.length - 1][1].body).prompt).toBe(PROMPT_TEXT + ' Warmer light.');
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(false);
  });

  it('keeps the chosen render quality in settings and sends it when painting', async () => {
    const select = document.getElementById('imageQualitySelect');
    select.value = 'medium_2k';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(JSON.parse(window.localStorage.getItem('st-settings')).sceneRenderQuality).toBe('medium_2k');

    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(
          jsonResponse(200, { image: Buffer.from('x').toString('base64'), media_type: 'image/png', cost_usd: 0.08, references: [] })
        );
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(fetch.mock.calls.find(([url, options]) => String(url).includes('/scene-image'))[1].body);
    expect(body.render).toBe('medium_2k');
  });

  it('shows the repainted prompt when moderation forced a rewrite', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(
          jsonResponse(200, {
            image: Buffer.from('painting').toString('base64'),
            media_type: 'image/png',
            cost_usd: 0.06,
            references: [],
            prompt: 'A softened, renderable take on the scene.',
          })
        );
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById('imagePromptText').value).toBe('A softened, renderable take on the scene.');
    expect(document.querySelector('.success-message').textContent).toContain('rewrote it');
  });

  it('narration, autoplay and illustration buttons gray out without a page or mid-write', () => {
    const readAloud = document.getElementById('readAloudBtn');
    const auto = document.getElementById('narrationAutoBtn');
    const scene = document.getElementById('imagePromptBtn');

    // No story/page: everything grayed
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
    fw.displayCurrentPage();
    expect(readAloud.disabled && auto.disabled && scene.disabled).toBe(true);

    // A real page makes them usable
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
    expect(readAloud.disabled || auto.disabled || scene.disabled).toBe(false);

    // While the scribe writes, they hold still again
    fw.setGenerating(true);
    expect(readAloud.disabled && auto.disabled && scene.disabled).toBe(true);
    fw.setGenerating(false);
    expect(readAloud.disabled || auto.disabled || scene.disabled).toBe(false);
  });

  it('refuses to paint an empty prompt box', async () => {
    document.getElementById('imagePromptBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptText').value = '   ';
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.error-message').textContent).toContain('empty');
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
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
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
    const btn = document.getElementById('imagePromptGenerateBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Generate image');
  });
});

describe('Scene viewer zoom & pan', () => {
  let fw;

  const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

  beforeEach(() => {
    mockFetch();
    fw = loadScript();
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 1, total_cost_usd: 0 },
      storyPages: [{ page_number: 1, content: 'One.', user_input: null, cost_usd: 0 }],
      currentPage: 1,
    });
    fw.openSceneViewer(DATA_URL, 'image/png');
  });

  function viewerImg() {
    return document.getElementById('sceneViewerImg');
  }

  it('opens with the image centered at scale 1 and reopens reset', () => {
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(false);
    expect(fw.__sceneViewerState()).toEqual({ scale: 1, x: 0, y: 0, dataUrl: DATA_URL });
    expect(viewerImg().style.transform).toContain('scale(1)');

    // close wipes the image; reopen starts fresh
    fw.closeSceneViewer();
    expect(fw.__sceneViewerState().dataUrl).toBeNull();
    expect(viewerImg().hasAttribute('src')).toBe(false);
    fw.openSceneViewer(DATA_URL, 'image/png');
    expect(fw.__sceneViewerState()).toEqual({ scale: 1, x: 0, y: 0, dataUrl: DATA_URL });
  });

  it('wheel zooms in and out, clamped to a sane range', () => {
    const img = viewerImg();
    for (let i = 0; i < 5; i++) img.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(fw.__sceneViewerState().scale).toBeGreaterThan(1);
    for (let i = 0; i < 40; i++) img.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(fw.__sceneViewerState().scale).toBeGreaterThanOrEqual(0.25); // clamped floor
  });

  it('drag pans the image; double-click toggles zoom', () => {
    const img = viewerImg();
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'clientX', { value: 0 });
    Object.defineProperty(down, 'clientY', { value: 0 });
    img.dispatchEvent(down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'clientX', { value: 140 });
    Object.defineProperty(move, 'clientY', { value: 60 });
    img.dispatchEvent(move);
    const state = fw.__sceneViewerState();
    expect(state.x).toBe(140);
    expect(state.y).toBe(60);

    img.dispatchEvent(new Event('dblclick', { bubbles: true }));
    expect(fw.__sceneViewerState().scale).toBeGreaterThan(1); // full -> 2.5x
    img.dispatchEvent(new Event('dblclick', { bubbles: true }));
    const reset = fw.__sceneViewerState(); // back to a clean overview
    expect(reset.scale).toBeCloseTo(1);
    expect(reset.x).toBe(0);
    expect(reset.y).toBe(0);
  });

  it('Escape closes only the viewer; the ghost buttons do their jobs', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);

    // Save hands the browser a download link; Close dismisses
    fw.openSceneViewer(DATA_URL, 'image/png');
    let savedHref = null;
    let savedName = null;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { savedHref = this.href; savedName = this.download; };
    try {
      document.getElementById('sceneViewerSaveBtn').click();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    expect(savedHref).toBe(DATA_URL);
    expect(savedName).toBe('scene-page-1.png');
    document.getElementById('sceneViewerCloseBtn').click();
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
  });
});
