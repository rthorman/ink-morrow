'use strict';

import { loadScript, jsonResponse, dialogAction, paidReview } from './dom-helpers.js';
import { jest } from '@jest/globals';

const STORY = {
  currentStory: { id: 's1', title: 'Gallery Tale', tone: 'romantic', page_count: 2, total_cost_usd: 0 },
  storyPages: [
    { id: 'p1', page_number: 1, content: 'First canonical page.', user_input: null, cost_usd: 0 },
    { id: 'p2', page_number: 2, content: 'Second canonical page.', user_input: null, cost_usd: 0 },
  ],
  currentPage: 2,
};

const UPLOAD = {
  id: 'a-upload', story_id: 's1', source: 'uploaded', status: 'ready',
  content_url: '/api/stories/s1/assets/a-upload/content', title: 'Owner image', alt_text: null,
  provider_reference_allowed: true, width: 1200, height: 800, size_bytes: 32000,
  media_type: 'image/webp', metadata: { stripped: true }, provider_provenance: null, spend_usd: 0,
};

const GENERATED = {
  id: 'a-generated', story_id: 's1', source: 'ai-generated', status: 'ready',
  content_url: '/api/stories/s1/assets/a-generated/content', title: 'Painted scene', alt_text: 'A painted hall.',
  provider_reference_allowed: false, width: 1024, height: 1536, size_bytes: 64000,
  media_type: 'image/webp', metadata: { stripped: true }, spend_usd: 0.04,
  provider_provenance: {
    prompt: 'A candlelit hall.',
    provider: { adapter: 'grok', model: 'grok-imagine', profile_name: 'Grok Imagine' },
    references: ['a-upload'],
  },
};

const PLACEMENT = { id: 'place-1', story_id: 's1', asset_id: 'a-upload', after_page_id: 'p1', ordinal: 1 };
const ANCHORS = { anchors: [{ page_id: 'p1', page_number: 1 }, { page_id: 'p2', page_number: 2 }] };

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installGalleryFetch({ assets = [UPLOAD, GENERATED], placements = [PLACEMENT] } = {}) {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (target.endsWith('/assets/anchors')) return Promise.resolve(jsonResponse(200, ANCHORS));
    if (target.endsWith('/assets') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { assets, placements }));
    }
    if (target.includes('/placements/') && method === 'PATCH') {
      return Promise.resolve(jsonResponse(200, { placement: { ...PLACEMENT, after_page_id: 'p2' } }));
    }
    if (target.endsWith('/assets/upload') && method === 'POST') {
      return Promise.resolve(jsonResponse(201, { asset: UPLOAD }));
    }
    if (target.endsWith('/image-prompt') && method === 'POST') {
      return Promise.resolve(jsonResponse(200, { prompt: 'An editable Gallery painting prompt.' }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

describe('PR 14 unified Gallery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:local-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  });

  it('shows uploaded and generated art together with provenance, alt warning, and explicit reference selection', async () => {
    installGalleryFetch();
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGallery({ storyId: 's1' });

    expect(document.getElementById('galleryPaintBtn').classList.contains('btn-primary')).toBe(true);
    expect(document.getElementById('galleryUploadBtn').classList.contains('btn-primary')).toBe(true);
    const cards = [...document.querySelectorAll('.gallery-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Source: uploaded locally');
    expect(cards[0].textContent).toContain('needs alt text');
    expect(cards[1].textContent).toContain('Source: AI-generated via Grok Imagine');
    expect(cards[1].textContent).toContain('References sent: 1');

    const reference = cards[0].querySelector('input[aria-label^="Select"]');
    expect(reference.disabled).toBe(false);
    reference.click();
    expect(document.getElementById('galleryReferenceSummary').textContent).toContain('1 explicitly approved');
    expect(fw.__selectedAssetReferences()).toEqual(['a-upload']);

    fw.openGalleryPaint();
    expect(await dialogAction('Draft visible prompt')).toBe(true);
    expect(await paidReview('confirm')).toBe(true);
    await tick();
    expect(fw.__selectedAssetReferences()).toEqual(['a-upload']);
  });

  it('shows Paint with AI as busy until the current manuscript anchors are ready', async () => {
    let resolveAnchors;
    global.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.endsWith('/assets/anchors')) {
        return new Promise((resolve) => { resolveAnchors = () => resolve(jsonResponse(200, ANCHORS)); });
      }
      if (target.endsWith('/assets')) {
        return Promise.resolve(jsonResponse(200, { assets: [], placements: [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    const fw = await loadScript();
    fw.__setStoryState(STORY);

    const entering = fw.enterGallery({ storyId: 's1' });
    await tick();
    const paint = document.getElementById('galleryPaintBtn');
    expect(paint.disabled).toBe(true);
    expect(paint.textContent).toBe('Loading pages…');
    expect(paint.getAttribute('aria-busy')).toBe('true');
    paint.click();
    expect(document.querySelector('.dialog-manager:not([hidden])')).toBeNull();

    resolveAnchors();
    await entering;
    expect(paint.disabled).toBe(false);
    expect(paint.textContent).toBe('Paint with AI');
    expect(paint.getAttribute('aria-busy')).toBe('false');
    paint.click();
    expect(document.querySelector('.dialog-manager__title').textContent).toBe('Paint with AI');
  });

  it('moves a stable placement without mutating prose, numbering, or the active page', async () => {
    installGalleryFetch();
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGallery({ storyId: 's1' });
    const before = JSON.stringify(fw.state().storyPages);
    const card = document.querySelector('.gallery-card');
    const placementSelect = card.querySelector('.gallery-placement select');
    placementSelect.value = 'p2';
    [...card.querySelectorAll('button')].find((button) => button.textContent === 'Move').click();
    await tick();
    await tick();

    const call = fetch.mock.calls.find(([url, options]) => String(url).includes('/placements/place-1') && options.method === 'PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ after_page_id: 'p2', ordinal: 1 });
    expect(JSON.stringify(fw.state().storyPages)).toBe(before);
    expect(fw.state().currentPage).toBe(2);
  });

  it('previews and uploads a local file without making any provider request', async () => {
    installGalleryFetch({ assets: [], placements: [] });
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGallery({ storyId: 's1' });
    const file = new File(['local raster bytes'], 'owner-image.png', { type: 'image/png' });

    fw.openGalleryUpload(file);
    expect(document.querySelector('.gallery-upload img').src).toContain('blob:local-preview');
    expect(document.querySelector('.gallery-upload__notice').textContent).toContain('does not classify or judge image subject matter');
    expect(await dialogAction('Upload image')).toBe(true);
    await tick();
    await tick();

    const upload = fetch.mock.calls.find(([url, options]) => String(url).endsWith('/assets/upload') && options.method === 'POST');
    expect(upload[1].body).toBeInstanceOf(FormData);
    expect(upload[1].body.get('image').name).toBe('owner-image.png');
    expect(upload[1].body.get('provider_reference_allowed')).toBe('false');
    expect(fetch.mock.calls.some(([url]) => /scene-image|image-prompt/.test(String(url)))).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(fw.state().storyPages).toHaveLength(2);
  });
});
