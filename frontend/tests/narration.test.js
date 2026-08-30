'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const SPEECH_MODELS = [
  {
    id: 'or/voice-1',
    name: 'Voice One',
    voices: [
      { id: 'amber', label: 'Amber' },
      { id: 'sapphire_blue', label: 'Sapphire Blue' },
    ],
    pricing: { prompt_per_mchar: 15, completion_per_mtok: 0 }, // $15 per 1M chars
  },
  {
    id: 'or/voice-2',
    name: 'Voice Two',
    voices: [{ id: 'marble', label: 'Marble' }],
    pricing: { prompt_per_mchar: 0, completion_per_mtok: 0 }, // free
  },
  {
    id: 'or/voice-3',
    name: 'Voice Three',
    voices: [{ id: 'gem', label: 'Gem' }],
    pricing: { prompt_per_mchar: 1, completion_per_mtok: 20 }, // chars + audio tokens
  },
];

function storyState(pages, currentPage) {
  return {
    currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: pages.length, total_cost_usd: 0 },
    storyPages: pages,
    currentPage: currentPage === undefined ? pages.length : currentPage,
  };
}

const PAGES = [{ page_number: 1, content: 'The tide came in.', user_input: null, cost_usd: 0.01 }];

function narrateResponse({ ok = true, status = 200, generationId = 'gen-n01', cacheHit = false, body = null } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => (name === 'X-Generation-Id' ? generationId : name === 'X-Narration-Cache' ? (cacheHit ? 'hit' : null) : null) },
    json: () => Promise.resolve(body || {}),
    blob: () => Promise.resolve({ size: 42 }),
  };
}

describe('Narration settings', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch([
      { match: '/api/speech-models', response: jsonResponse(200, { models: SPEECH_MODELS }) },
    ]);
    fw = await loadScript();
  });

  it('defaults to unconfigured narration', async () => {
    expect(fw.state().settings.narrationModel).toBeNull();
    expect(fw.state().settings.narrationVoice).toBeNull();
  });

  it('populates the model list and dependent voices', async () => {
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    const modelSelect = document.getElementById('narrationModelSelect');
    expect([...modelSelect.options].map((o) => o.value)).toEqual(['', 'or/voice-1', 'or/voice-2', 'or/voice-3']);

    modelSelect.value = 'or/voice-1';
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fw.state().settings.narrationModel).toBe('or/voice-1');

    const voiceSelect = document.getElementById('narrationVoiceSelect');
    expect(voiceSelect.disabled).toBe(false);
    expect([...voiceSelect.options].map((o) => o.value)).toEqual(['', 'amber', 'sapphire_blue']);

    voiceSelect.value = 'amber';
    voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fw.state().settings.narrationVoice).toBe('amber');
    expect(JSON.parse(window.localStorage.getItem('st-settings')).narrationVoice).toBe('amber');
  });

  it('changing the model clears an incompatible saved voice', async () => {
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');

    const modelSelect = document.getElementById('narrationModelSelect');
    modelSelect.value = 'or/voice-2';
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(fw.state().settings.narrationModel).toBe('or/voice-2');
    expect(fw.state().settings.narrationVoice).toBeNull(); // cleared immediately
    const voiceSelect = document.getElementById('narrationVoiceSelect');
    expect([...voiceSelect.options].map((o) => o.value)).toEqual(['', 'marble']); // repopulated
  });

  it('clears a saved model that vanished from the catalogue', async () => {
    fw.setSetting('narrationModel', 'or/gone-away');
    fw.setSetting('narrationVoice', 'amber');
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    expect(fw.state().settings.narrationModel).toBeNull();
    expect(fw.state().settings.narrationVoice).toBeNull();
  });

  it('labels each narrator with the approximate cost of one page', async () => {
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    const labels = [...document.getElementById('narrationModelSelect').options].map((o) => o.textContent);
    // 400 words ≈ 2600 chars; voice-1 is $15/1M chars → $0.039 a page
    expect(labels[1]).toBe('Voice One — ≈$0.0390 per page');
    expect(labels[2]).toBe('Voice Two — free');
    // voice-3 adds audio-token pricing: 2600×$1/1M + 8000 tokens×$20/1M = $0.1626
    expect(labels[3]).toBe('Voice Three — ≈$0.1626 per page');
  });

  it('relabels the cost estimate when the words-per-page target changes', async () => {
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    fw.setSetting('wordsPerPage', 200); // applySettings re-renders the labels
    const labels = [...document.getElementById('narrationModelSelect').options].map((o) => o.textContent);
    expect(labels[1]).toBe('Voice One — ≈$0.0195 per page');
    expect(labels[2]).toBe('Voice Two — free');
  });
});

describe('Narration player', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
    fw.__setStoryState(storyState(PAGES));
    fw.displayCurrentPage();
  });

  it('explains and points to Settings when unconfigured', async () => {
    document.getElementById('readAloudBtn').click();
    expect(document.querySelector('.error-message').textContent).toContain('not configured');
    expect(document.getElementById('settingsSection').classList.contains('active')).toBe(true);
  });

  it('streams the current page, pauses, resumes, and stops', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    fetchMock.mockImplementation((url, options) => {
      if (String(url).includes('/narrate')) {
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ model: 'or/voice-1', voice: 'amber' });
        return Promise.resolve(narrateResponse());
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('readAloudBtn').click(); // starting
    await new Promise((r) => setTimeout(r, 0));

    const audio = fw.__lastNarrationAudio();
    expect(audio.src).toBeTruthy();
    audio.dispatchEvent(new Event('playing'));
    expect(document.getElementById('readAloudBtn').textContent).toBe('Pause');
    expect(document.getElementById('narrationStopBtn').hidden).toBe(false);

    document.getElementById('readAloudBtn').click(); // pause
    expect(document.getElementById('readAloudBtn').textContent).toBe('Resume');

    document.getElementById('readAloudBtn').click(); // resume
    expect(document.getElementById('readAloudBtn').textContent).toBe('Pause');

    document.getElementById('narrationStopBtn').click(); // stop
    expect(document.getElementById('readAloudBtn').textContent).toBe('Read aloud');
    expect(document.getElementById('narrationStopBtn').hidden).toBe(true);
  });

  it('settles the generation cost exactly once', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    let costCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) return Promise.resolve(narrateResponse({ generationId: 'gen-bill01' }));
      if (String(url).includes('/generation-cost')) {
        costCalls++;
        return Promise.resolve(jsonResponse(200, { cost_usd: 0.009, model: 'or/voice-1' }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const audio = fw.__lastNarrationAudio();
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 0));

    expect(costCalls).toBe(1);
    expect(fw.state().costs.session).toBeCloseTo(0.009, 8);
    expect(fw.state().costs.story).toBeCloseTo(0.009, 8);

    // Replaying the same generation never bills twice
    audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 0));
    expect(costCalls).toBe(1);
    expect(fw.state().costs.session).toBeCloseTo(0.009, 8);
  });

  it('a cache hit never bills at all', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    let costCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) return Promise.resolve(narrateResponse({ cacheHit: true, generationId: 'gen-cache01' }));
      if (String(url).includes('/generation-cost')) {
        costCalls++;
        return Promise.resolve(jsonResponse(200, { cost_usd: 0.009 }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const audio = fw.__lastNarrationAudio();
    audio.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 0));

    expect(costCalls).toBe(0);
    expect(fw.state().costs.session).toBe(0);
  });

  it('page navigation stops the stream', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) return Promise.resolve(narrateResponse());
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const audio = fw.__lastNarrationAudio();
    audio.dispatchEvent(new Event('playing'));
    expect(document.getElementById('readAloudBtn').textContent).toBe('Pause');

    fw.__setStoryState({ storyPages: [...PAGES, { page_number: 2, content: 'Two.', user_input: null }], currentPage: 2 });
    fw.navigatePage(-1);
    expect(document.getElementById('readAloudBtn').textContent).toBe('Read aloud');
  });

  it('shows a failed state and Retry when narration errors', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) {
        return Promise.resolve(narrateResponse({ ok: false, status: 429, body: { error: 'rate limited' } }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('readAloudBtn').textContent).toBe('Retry reading');
    expect(document.querySelector('.error-message').textContent).toContain('rate limited');
  });
});
describe('Narration autoplay', () => {
  let fw, fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = await loadScript();
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
  });

  function twoPages() {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 2, total_cost_usd: 0 },
      storyPages: [
        { page_number: 1, content: 'One.', user_input: null, cost_usd: 0 },
        { page_number: 2, content: 'Two.', user_input: null, cost_usd: 0 },
      ],
      currentPage: 1,
    });
    fw.displayCurrentPage();
  }

  it('flips to the next page and keeps narrating until the tale ends', async () => {
    twoPages();
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) {
        return Promise.resolve(narrateResponse({ generationId: 'gen-auto1' }));
      }
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('narrationAutoBtn').click(); // autoplay on
    expect(document.getElementById('narrationAutoBtn').classList.contains('active')).toBe(true);

    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    let audio = fw.__lastNarrationAudio();
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('ended')); // page one done

    await new Promise((r) => setTimeout(r, 500)); // breath between pages
    expect(fw.state().currentPage).toBe(2); // flipped
    expect(document.getElementById('pageIndicator').textContent).toBe('Page 2 of 2');
    await new Promise((r) => setTimeout(r, 0));
    audio = fw.__lastNarrationAudio(); // narrating page two now
    expect(audio).not.toBe(null);
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('ended')); // the tale ends

    await new Promise((r) => setTimeout(r, 50));
    expect(fw.state().currentPage).toBe(2); // no page after the last
    expect(document.querySelector('.success-message').textContent).toContain('end of the written tale');
  });

  it('autoplay survives Stop being pressed only for playback, and can be toggled off', async () => {
    twoPages();
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/narrate')) return Promise.resolve(narrateResponse({ generationId: 'gen-auto2' }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    document.getElementById('narrationAutoBtn').click();
    document.getElementById('readAloudBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    const audio = fw.__lastNarrationAudio();
    audio.dispatchEvent(new Event('playing'));

    document.getElementById('narrationStopBtn').click(); // user halts playback
    expect(document.getElementById('readAloudBtn').textContent).toBe('Read aloud');

    document.getElementById('narrationAutoBtn').click(); // toggle autoplay off
    expect(document.getElementById('narrationAutoBtn').classList.contains('active')).toBe(false);

    audio.dispatchEvent(new Event('ended')); // a stale end must not resurrect the chain
    await new Promise((r) => setTimeout(r, 500));
    expect(fw.state().currentPage).toBe(1);
  });
});
