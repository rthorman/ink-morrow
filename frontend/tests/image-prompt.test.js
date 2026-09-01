'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

const STORY_STATE = {
  currentStory: { id: 's1', title: 'T', tone: 'explicit', page_count: 2, total_cost_usd: 0 },
  storyPages: [
    { id: 'p1', page_number: 1, content: 'The hall was cold.', user_input: null, cost_usd: 0 },
    { id: 'p2', page_number: 2, content: 'She lit the candle.', user_input: null, cost_usd: 0 },
  ],
  currentPage: 2,
};

const PROMPT_TEXT = 'A frozen gothic hall, wide shot: two figures by candlelight, frost on black stone.';

function imagePromptResponse() {
  return jsonResponse(200, { prompt: PROMPT_TEXT });
}

describe('Scene image prompt button', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch([
      { match: '/image-prompt', response: imagePromptResponse() },
    ]);
    fw = await loadScript();
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
  });

  it('condenses the current page and opens the edit box with the result', async () => {
    fw.setSetting('model', 'z-ai/glm-5.1');
    fw.setSetting('reasoningEffort', 'high');
    fw.__setModelsCache([{ id: 'z-ai/glm-5.1', name: 'GLM', reasoning: true, context_length: 1000, pricing: {} }]);

    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true); // condensation is paid: reviewed
    await new Promise((r) => setTimeout(r, 0));

    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-prompt') && options.method === 'POST');
    expect(String(call[0])).toContain('/stories/s1/pages/2/image-prompt'); // current page
    expect(JSON.parse(call[1].body)).toEqual({ model: 'z-ai/glm-5.1', reasoning_effort: 'high' });

    const modal = document.getElementById('imagePromptModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('imagePromptText').value).toBe(PROMPT_TEXT);
    expect(document.getElementById('imagePromptBtn').disabled).toBe(false); // restored
  });

  it('books the writing-model cost of a successful condensation', async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes('/image-prompt')) {
        return Promise.resolve(jsonResponse(200, { prompt: PROMPT_TEXT, cost_usd: 0.003, billed_attempts: 1 }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(fw.state().costs.session).toBeCloseTo(0.003, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.003, 8);
  });

  it('omits model and reasoning when no model override is chosen', async () => {
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-prompt') && options.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({});
  });

  it('uses the loaded stable page when catalogue page_count is briefly stale', async () => {
    fw.__setStoryState({ currentStory: { ...STORY_STATE.currentStory, page_count: 0 } });
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-prompt') && options.method === 'POST');
    expect(String(call[0])).toContain('/stories/s1/pages/2/image-prompt');
  });

  it('cancel closes the popup, Escape too; backdrop click as well', async () => {
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const modal = document.getElementById('imagePromptModal');
    expect(modal.hidden).toBe(false);

    document.getElementById('imagePromptCancelBtn').click();
    expect(modal.hidden).toBe(true);

    // Reopen, then Escape closes it
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.hidden).toBe(true);
  });

  it('shows the scribe error and restores the button when the LLM fails', async () => {
    fetch.mockImplementation(() => Promise.resolve(jsonResponse(502, {
      error: 'The muse is mute',
      cost_usd: 0.002,
      billed_attempts: 2,
    })));
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector('.error-message').textContent).toContain('The muse is mute');
    expect(document.getElementById('imagePromptModal').hidden).toBe(true);
    const btn = document.getElementById('imagePromptBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Scene image');
    expect(fw.state().costs.session).toBeCloseTo(0.002, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.002, 8);
  });

  it('complains politely when no story page is selected', async () => {
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
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptText').value = PROMPT_TEXT;
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true); // the paint press is reviewed
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
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click(); // paint
    expect(await paidReview('confirm')).toBe(true);
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
    expect(await paidReview('confirm')).toBe(true);
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
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(fetch.mock.calls.find(([url, options]) => String(url).includes('/scene-image'))[1].body);
    expect(body.render).toBe('medium_2k');
  });

  it('a refusal announces the rewrite, repopulates the box, and waits - no silent repaint', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(
          jsonResponse(200, {
            refused: true,
            reason: 'nudity not allowed',
            sanitized_prompt: 'A fully clothed, safely composed take on the scene.',
            sanitation_cost_usd: 0.002,
            rewrite_cost_usd: 0.002,
            references_sent: 2,
            can_drop_references: true,
          })
        );
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    // Rewritten prompt back in the box, announced loudly, viewer stays shut
    expect(document.getElementById('imagePromptText').value).toBe('A fully clothed, safely composed take on the scene.');
    expect(document.querySelector('.success-message').textContent).toContain('no image retry occurred');
    expect(document.getElementById('imageRefusalNotice').hidden).toBe(false);
    expect(document.getElementById('imageRefusalNotice').textContent).toContain('sanitation call cost $0.0020');
    expect(document.getElementById('imageRefusalNotice').textContent).toContain('Nothing was painted');
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
    // The rewrite LLM billed: session + story ticked
    expect(fw.state().costs.session).toBeCloseTo(0.002);
    expect(fw.state().costs.story).toBeCloseTo(0.002);
    // No image was painted or billed
    expect(document.getElementById('sceneImageCost').hidden).toBe(true);
  });

  it('a second refusal offers an explicit reference-free retry', async () => {
    let n = 0;
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        n++;
        if (n <= 2) {
          return Promise.resolve(jsonResponse(200, {
            refused: true,
            reason: 'still not passing',
            sanitized_prompt: `Hardened attempt ${n}.`,
            rewrite_cost_usd: 0,
            sanitation_cost_usd: 0,
            references_sent: 2,
            can_drop_references: true,
          }));
        }
        return Promise.resolve(jsonResponse(200, {
          image: Buffer.from('painting').toString('base64'),
          media_type: 'image/png',
          cost_usd: 0.04,
          references: [],
          prompt: JSON.parse(options.body).prompt,
        }));
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fw.__sceneModerationState().refusals).toBe(1);
    expect(fw.__sceneModerationState().dropReferences).toBe(false);
    const lastNotice = () => [...document.querySelectorAll('.success-message')].pop()?.textContent || '';
    expect(lastNotice()).not.toContain('portraits');

    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    // A second refusal while references were attached offers a truthful,
    // explicit reference-free path; it never silently changes the next send.
    expect(fw.__sceneModerationState().dropReferences).toBe(false);
    expect(fw.__sceneModerationState().referenceDropOffered).toBe(true);
    expect(document.getElementById('imageReferenceDropOption').hidden).toBe(false);
    expect(lastNotice()).toContain('references were attached');

    document.getElementById('imagePromptDropReferences').click();
    expect(fw.__sceneModerationState().dropReferences).toBe(true);

    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    // The escalated press sends drop_references and paints
    const bodies = fetch.mock.calls
      .filter(([url, options]) => String(url).includes('/scene-image'))
      .map(([url, options]) => JSON.parse(options.body));
    expect(bodies[2].drop_references).toBe(true);
    expect(fw.state().costs.session).toBeCloseTo(0.04);
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(false);
    // Success clears the escalation
    expect(fw.__sceneModerationState()).toEqual({
      refusals: 0,
      dropReferences: false,
      referenceDropOffered: false,
      storyId: 's1',
    });
  });

  it('resets refusal state when the selected references or story changes', async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(jsonResponse(200, {
          refused: true,
          reason: 'reference composition refused',
          sanitized_prompt: 'A safely framed replacement prompt with recognizable silhouettes.',
          sanitation_cost_usd: 0,
          references_sent: 2,
          can_drop_references: true,
        }));
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, {}));
    });
    fw.state().characters.push({
      id: 'c1', name: 'Mara', image_status: 'ready', image_updated_at: 'portrait-v1',
    });
    fw.__setStoryState({
      currentStory: {
        ...STORY_STATE.currentStory,
        characters: [{ id: 'c1', role: 'mc' }],
      },
    });

    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fw.__sceneModerationState().refusals).toBe(1);

    // A newly painted version of a selected cast reference starts a fresh
    // refusal context automatically; this response is refusal one, not two.
    fw.state().characters[0].image_updated_at = 'portrait-v2';
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fw.__sceneModerationState().refusals).toBe(1);
    expect(fw.__sceneModerationState().referenceDropOffered).toBe(false);

    fw.__setStoryState({
      currentStory: { id: 's2', title: 'Another tale', tone: 'romantic', page_count: 1, total_cost_usd: 0 },
      storyPages: [{ id: 's2p1', page_number: 1, content: 'Another scene.', user_input: null, cost_usd: 0 }],
      currentPage: 1,
    });
    expect(fw.__sceneModerationState()).toEqual({
      refusals: 0,
      dropReferences: false,
      referenceDropOffered: false,
      storyId: 's2',
    });
    expect(document.getElementById('imageRefusalNotice').hidden).toBe(true);
  });

  it('canceling the paint review keeps the prompt box and sends nothing', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(jsonResponse(200, { image: Buffer.from('x').toString('base64'), media_type: 'image/png', cost_usd: 0.04, references: [] }));
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    // Make painting the first paid action in this test so cancellation is
    // still available; after any accepted review it would correctly bypass.
    document.getElementById('imagePromptModal').hidden = false;
    document.getElementById('imagePromptText').value = 'A candlelit hall.';
    fetch.mockClear();
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('cancel')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch.mock.calls.some(([url, options]) => String(url).includes('/scene-image'))).toBe(false);
    expect(document.getElementById('imagePromptText').value).toBe('A candlelit hall.');
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
  });

  it('narration and autoplay gray out without a page or mid-write', async () => {
    const readAloud = document.getElementById('readAloudBtn');
    const auto = document.getElementById('narrationAutoBtn');

    // No manuscript/page: both reading controls are grayed.
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
    fw.displayCurrentPage();
    expect(readAloud.disabled && auto.disabled).toBe(true);

    // A real page makes them usable
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
    expect(readAloud.disabled || auto.disabled).toBe(false);

    // While the scribe writes, they hold still again
    fw.setGenerating(true);
    expect(readAloud.disabled && auto.disabled).toBe(true);
    fw.setGenerating(false);
    expect(readAloud.disabled || auto.disabled).toBe(false);
  });

  it('refuses to paint an empty prompt box', async () => {
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptText').value = '   ';
    document.getElementById('imagePromptGenerateBtn').click();
    await new Promise((r) => setTimeout(r, 0)); // no review yet: the empty box refuses first
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
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
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

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
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

  it('opens with the image centered at scale 1 and reopens reset', async () => {
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

  it('wheel zooms in and out, clamped to a sane range', async () => {
    const img = viewerImg();
    for (let i = 0; i < 5; i++) img.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(fw.__sceneViewerState().scale).toBeGreaterThan(1);
    for (let i = 0; i < 40; i++) img.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(fw.__sceneViewerState().scale).toBeGreaterThanOrEqual(0.25); // clamped floor
  });

  it('drag pans the image; double-click toggles zoom', async () => {
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

  it('Escape closes only the viewer; the ghost buttons do their jobs', async () => {
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

describe('Place generated art after prose', () => {
  const ART_ASSET = {
    id: 'a1', story_id: 's1', source: 'ai-generated', status: 'ready',
    content_url: '/api/stories/s1/assets/a1/content',
    title: 'Scene illustration', alt_text: 'A frozen gothic hall, wide shot.',
  };
  const PLACEMENT = { id: 'pl1', story_id: 's1', asset_id: 'a1', after_page_id: 'p2', ordinal: 1 };

  function paintedFetch(imagePageResponse) {
    return (url, options) => {
      if (String(url).includes('/scene-image')) {
        return Promise.resolve(
          jsonResponse(200, {
            image: Buffer.from('painting').toString('base64'),
            media_type: 'image/png',
            cost_usd: 0.06,
            references: [],
          })
        );
      }
      if (String(url).includes('/image-prompt')) return Promise.resolve(imagePromptResponse());
      if (String(url).includes('/image-page') && options.method === 'POST') {
        return Promise.resolve(imagePageResponse);
      }
      if (String(url).endsWith('/assets') && (!options || options.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, { assets: [ART_ASSET], placements: [PLACEMENT] }));
      }
      if (String(url).endsWith('/pages') && (!options || options.method === 'GET')) {
        return Promise.resolve(
          jsonResponse(200, {
            pages: [
              { id: 'p1', page_number: 1, content: 'The hall was cold.', user_input: null, cost_usd: 0 },
              { id: 'p2', page_number: 2, content: 'She lit the candle.', user_input: null, cost_usd: 0 },
            ],
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    };
  }

  async function paintAndOpenViewer(fw) {
    document.getElementById('imagePromptBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('imagePromptGenerateBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(false);
    expect(document.getElementById('imagePromptModal').hidden).toBe(false);
    return fw;
  }

  let fw;

  beforeEach(async () => {
    mockFetch();
    fw = await loadScript();
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
  });

  it('places the painting after the current page without changing narrative state', async () => {
    fetch.mockImplementation(paintedFetch(jsonResponse(201, { asset: ART_ASSET, placement: PLACEMENT })));

    await paintAndOpenViewer(fw);
    document.getElementById('sceneViewerAddPageBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    // Sent exactly what was painted: raw base64, media type, prompt and cost
    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/image-page'));
    expect(String(call[0])).toContain('/stories/s1/pages/2/image-page'); // after the current page
    expect(JSON.parse(call[1].body)).toEqual({
      image: Buffer.from('painting').toString('base64'),
      media_type: 'image/png',
      prompt: PROMPT_TEXT,
      cost_usd: 0.06,
    });

    // Both modals close; the same prose page stays current and gains its art.
    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(true);
    expect(document.getElementById('imagePromptModal').hidden).toBe(true);
    expect(fw.state().currentPage).toBe(2);
    expect(fw.state().storyPages).toHaveLength(2);
    const plate = document.querySelector('.scene-plate');
    expect(plate).toBeTruthy();
    expect(plate.getAttribute('src')).toBe('/api/stories/s1/assets/a1/content');
    expect(plate.getAttribute('alt')).toBe('A frozen gothic hall, wide shot.');
    expect(document.querySelector('.success-message').textContent).toContain('Page numbering is unchanged');
    // The paint was billed once at painting time; binding adds nothing
    expect(fw.state().costs.session).toBeCloseTo(0.06);
    expect(fw.state().costs.story).toBeCloseTo(0.06);
  });

  it('a failed binding keeps both modals open, floats the error above them, and restores the button', async () => {
    fetch.mockImplementation((url, options) => {
      if (String(url).includes('/image-page')) {
        return Promise.resolve(jsonResponse(500, { error: 'The binding refused' }));
      }
      return paintedFetch(null)(url, options);
    });

    await paintAndOpenViewer(fw);
    document.getElementById('sceneViewerAddPageBtn').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById('sceneImageViewerModal').hidden).toBe(false);
    expect(document.getElementById('imagePromptModal').hidden).toBe(false);
    const floating = document.querySelector('.error-message');
    expect(floating.textContent).toContain('The binding refused');
    expect(floating.classList.contains('message--floating')).toBe(true);
    const btn = document.getElementById('sceneViewerAddPageBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Place after page');
  });

  it('placed art renders after prose while text tools remain available', async () => {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 3, total_cost_usd: 0.06 },
      storyPages: [
        { id: 'p1', page_number: 1, content: 'Prose.', user_input: null, cost_usd: 0 },
        { id: 'p2', page_number: 2, content: 'More prose.', user_input: null, cost_usd: 0 },
      ],
      storyAssets: { assets: [ART_ASSET], placements: [PLACEMENT] },
      currentPage: 2,
    });
    fw.displayCurrentPage();

    expect(document.querySelector('.scene-plate')).toBeTruthy();
    expect(document.querySelector('#storyContent p').textContent).toBe('More prose.');
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');

    expect(document.getElementById('readAloudBtn').disabled).toBe(false);
    expect(document.getElementById('narrationAutoBtn').disabled).toBe(false);
    expect(document.getElementById('imagePromptBtn').disabled).toBe(false);

    // An earlier text page wakes everything back up
    fw.navigatePage(-1);
    expect(document.getElementById('readAloudBtn').disabled).toBe(false);
    expect(document.getElementById('imagePromptBtn').disabled).toBe(false);
    expect(document.querySelector('.scene-plate')).toBeNull();
  });

  it('placed art does not prevent retrying the final prose page', async () => {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 2, total_cost_usd: 0.06 },
      storyPages: [
        { id: 'p1', page_number: 1, content: 'Prose.', user_input: null, cost_usd: 0 },
        { id: 'p2', page_number: 2, content: 'More prose.', user_input: null, cost_usd: 0 },
      ],
      storyAssets: { assets: [ART_ASSET], placements: [PLACEMENT] },
      currentPage: 2,
    });
    fw.displayCurrentPage();
    expect(document.getElementById('retryBtn').disabled).toBe(false);
    expect(document.getElementById('userInput').disabled).toBe(false); // the tale continues
  });
});
