'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

const MODELS = [
  { id: 'or/voice-1', name: 'Voice One', pcm: false, voices: [{ id: 'amber', label: 'Amber' }], pricing: { prompt_per_mchar: 15, completion_per_mtok: 0 } },
  { id: 'google/gemini-tts', name: 'Gemini TTS', pcm: true, voices: [{ id: 'sage', label: 'Sage' }], pricing: { prompt_per_mchar: 1, completion_per_mtok: 0 } },
];

const STORY_STATE = {
  currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 3, total_cost_usd: 0 },
  storyPages: [
    { page_number: 1, content: 'w '.repeat(150), user_input: null, cost_usd: 0 },
    { page_number: 2, content: '', image_media_type: 'image/png', image_prompt: 'A plate.', cost_usd: 0.04 },
    { page_number: 3, content: 'w '.repeat(150), user_input: null, cost_usd: 0 },
  ],
  currentPage: 3,
};

function pendingRow(overrides = {}) {
  return { story_id: 's1', status: 'pending', pages_done: 0, pages_total: 2, queue_position: 0, ...overrides };
}

describe('Audiobook modal', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch([{ match: '/speech-models', response: jsonResponse(200, { models: MODELS }) }]);
    fw = await loadScript();
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
  });

  function modalFetch(audiobookResponse) {
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/speech-models')) return Promise.resolve(jsonResponse(200, { models: MODELS }));
      if (String(url).includes('/audiobook')) return Promise.resolve(audiobookResponse);
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
  }

  async function openWith() {
    await fw.openAudiobookModal();
    await new Promise((r) => setTimeout(r, 0));
    return document.getElementById('audiobookModal');
  }

  it('explains when no narrator is chosen, and the start button stays disabled', async () => {
    modalFetch(jsonResponse(200, { audiobook: null }));
    await openWith();
    expect(document.getElementById('audiobookModalBody').textContent).toContain('No narrator chosen');
    expect(document.getElementById('audiobookExisting').hidden).toBe(true);
    expect(document.getElementById('audiobookStartBtn').disabled).toBe(true);
    expect(document.getElementById('audiobookModal').hidden).toBe(false);
  });

  it('explains why a pcm-only narrator cannot be bound into a book', async () => {
    fw.setSetting('narrationModel', 'google/gemini-tts');
    fw.setSetting('narrationVoice', 'sage');
    modalFetch(jsonResponse(200, { audiobook: null }));
    await openWith();
    expect(document.getElementById('audiobookModalBody').textContent).toContain('WAV-only');
    expect(document.getElementById('audiobookStartBtn').disabled).toBe(true);
  });

  it('advertises the narrator and honest estimates, and the button starts the job', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/speech-models')) return Promise.resolve(jsonResponse(200, { models: MODELS }));
      if (String(url).includes('/audiobook')) {
        if (options && options.method === 'POST') return Promise.resolve(jsonResponse(201, { audiobook: pendingRow() }));
        return Promise.resolve(jsonResponse(200, { audiobook: null }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    await openWith();

    const body = document.getElementById('audiobookModalBody').textContent;
    expect(body).toContain('Narrator: Voice One · voice Amber');
    expect(body).toContain('2 pages'); // the plate is not narratable
    expect(body).toContain('≈2 min'); // 300 words at 150 wpm
    expect(body).toContain('≈$0.0090'); // 600 chars at $15 per 1M
    expect(document.getElementById('audiobookStartBtn').disabled).toBe(false);

    // The explicit button carries the price; POST carries the chosen narrator
    expect(document.getElementById('audiobookStartBtn').textContent).toContain('Create audiobook (≈$0.0090)');
    document.getElementById('audiobookStartBtn').click();
    // The final start is the shared paid review: cancel first keeps the modal
    // flow intact and sends nothing.
    expect(await paidReview('cancel')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch.mock.calls.some(([url, options]) => String(url).includes('/audiobook') && options.method === 'POST')).toBe(false);
    expect(document.getElementById('audiobookModal').hidden).toBe(false); // reopened with its facts

    document.getElementById('audiobookStartBtn').click();
    expect(await paidReview('confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    const call = global.fetch.mock.calls.find(([url, options]) => String(url).includes('/audiobook') && options.method === 'POST');
    expect(String(call[0])).toContain('/stories/s1/audiobook');
    expect(JSON.parse(call[1].body)).toEqual({ model: 'or/voice-1', voice: 'amber' });
    expect(document.getElementById('audiobookModal').hidden).toBe(true);

    const banner = document.getElementById('audiobookBanner');
    expect(banner.hidden).toBe(false);
    expect(document.getElementById('audiobookBannerText').textContent).toContain('page 0 of 2');
    expect(document.getElementById('audiobookProgress').hidden).toBe(false);
  });

  it('shows the existing book in the modal and blocks the start button while one is being read', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    modalFetch(jsonResponse(200, { audiobook: pendingRow() }));
    await openWith();
    expect(document.getElementById('audiobookExisting').hidden).toBe(false);
    expect(document.getElementById('audiobookExisting').textContent).toContain('already being read');
    expect(document.getElementById('audiobookStartBtn').disabled).toBe(true);
  });
});

describe('Audiobook banner', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
    fw = await loadScript();
    fw.__setStoryState(STORY_STATE);
    fw.displayCurrentPage();
  });

  function actions() {
    return document.getElementById('audiobookBannerActions');
  }

  it('tracks progress while reading, reports queue waits, and Stop cancels', async () => {
    fw.updateAudiobookBanner(pendingRow({ pages_done: 1 }));
    expect(document.getElementById('audiobookBanner').hidden).toBe(false);
    expect(document.getElementById('audiobookBannerText').textContent).toContain('page 1 of 2');
    expect(document.getElementById('audiobookProgressFill').style.width).toBe('50%');
    expect(actions().textContent).toContain('Stop');

    fw.updateAudiobookBanner(pendingRow({ queue_position: 2 }));
    expect(document.getElementById('audiobookBannerText').textContent).toContain('2 tales are ahead');
    expect(document.getElementById('audiobookProgress').hidden).toBe(true);

    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/audiobook/cancel')) return Promise.resolve(jsonResponse(200, { audiobook: { status: 'failed', error: 'Cancelled.' } }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });
    actions().querySelector('button').click();
    await new Promise((r) => setTimeout(r, 0));
    const cancelCall = global.fetch.mock.calls.find(([url, options]) => String(url).includes('/cancel'));
    expect(String(cancelCall[0])).toContain('/stories/s1/audiobook/cancel');
    expect(document.getElementById('audiobookBannerText').textContent).toContain('Cancelled');
  });

  it('offers Download and Hide when ready; Hide is remembered per reading', async () => {
    const ready = { story_id: 's1', status: 'ready', duration_s: 7200, cost_usd: 0.5, updated_at: '2026-08-30 10:00:00' };
    fw.updateAudiobookBanner(ready);
    const banner = document.getElementById('audiobookBanner');
    expect(banner.hidden).toBe(false);
    expect(document.getElementById('audiobookBannerText').textContent).toContain('The audiobook is ready');
    expect(document.getElementById('audiobookBannerText').textContent).toContain('2 h 0 min');
    expect(document.getElementById('audiobookBannerText').textContent).toContain('$0.5000');
    const download = actions().querySelector('a');
    expect(download.getAttribute('href')).toBe('/api/stories/s1/audiobook/audio');
    expect(download.textContent).toBe('Download');
    expect(fw.state().costs.session).toBeCloseTo(0.5); // ticked once

    [...actions().querySelectorAll('button')].find((b) => b.textContent === 'Hide').click();
    expect(banner.hidden).toBe(true);

    // Same reading again: stays hidden (the Bookshelf owns the download)
    fw.updateAudiobookBanner(ready);
    expect(banner.hidden).toBe(true);
    expect(fw.state().costs.session).toBeCloseTo(0.5); // never re-ticked

    // A fresh reading announces itself once more
    fw.updateAudiobookBanner({ ...ready, updated_at: '2026-08-30 12:00:00', cost_usd: 0.2 });
    expect(banner.hidden).toBe(false);
    expect(fw.state().costs.session).toBeCloseTo(0.7);
  });

  it('flags a stale ready book and offers a retry after failure', async () => {
    fw.updateAudiobookBanner({ story_id: 's1', status: 'ready', duration_s: 60, cost_usd: 0, updated_at: 'x', stale: true });
    expect(document.getElementById('audiobookBannerText').textContent).toContain('tale has changed');

    fw.updateAudiobookBanner({ story_id: 's1', status: 'failed', error: 'The narrator fell silent.', updated_at: 'y' });
    expect(document.getElementById('audiobookBannerText').textContent).toContain('The narrator fell silent');
    expect(actions().textContent).toContain('Open audiobook');
    expect(actions().textContent).toContain('Hide');
  });

  it('shows nothing without a story or a row', async () => {
    fw.updateAudiobookBanner(null);
    expect(document.getElementById('audiobookBanner').hidden).toBe(true);
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
    fw.updateAudiobookBanner(pendingRow());
    expect(document.getElementById('audiobookBanner').hidden).toBe(true);
  });
});
