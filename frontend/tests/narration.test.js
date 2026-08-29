'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const SPEECH_MODELS = [
  {
    id: 'or/voice-1',
    name: 'Voice One',
    voices: [
      { id: 'amber', label: 'Amber' },
      { id: 'sapphire_blue', label: 'Sapphire Blue' },
    ],
  },
  {
    id: 'or/voice-2',
    name: 'Voice Two',
    voices: [{ id: 'marble', label: 'Marble' }],
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

  beforeEach(() => {
    window.localStorage.clear();
    mockFetch([
      { match: '/api/speech-models', response: jsonResponse(200, { models: SPEECH_MODELS }) },
    ]);
    fw = loadScript();
  });

  it('defaults to unconfigured narration', () => {
    expect(fw.state().settings.narrationModel).toBeNull();
    expect(fw.state().settings.narrationVoice).toBeNull();
  });

  it('populates the model list and dependent voices', async () => {
    await fw.loadSpeechModels();
    fw.renderNarrationSettings();
    const modelSelect = document.getElementById('narrationModelSelect');
    expect([...modelSelect.options].map((o) => o.value)).toEqual(['', 'or/voice-1', 'or/voice-2']);

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
});

describe('Narration player', () => {
  let fw, fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mockFetch();
    fw = loadScript();
    fw.__setStoryState(storyState(PAGES));
    fw.displayCurrentPage();
  });

  it('explains and points to Settings when unconfigured', () => {
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