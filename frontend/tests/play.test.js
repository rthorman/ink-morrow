'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

const STORY = {
  id: 's1', title: 'The Bell Below', page_count: 0, total_cost_usd: 0,
  characters: [
    { id: 'lead-1', role: 'mc' },
    { id: 'guide-1', role: 'supporting' },
  ],
};
const SCENE = {
  id: 'scene-1', title: 'At the sealed stair', mode: 'play',
  viewpoint_character_id: 'lead-1', location: 'Under the bell tower',
  stakes: 'The sleepers may wake.',
};
const SESSION = {
  id: 'ps1', scene_id: SCENE.id, ordinal: 1, status: 'active',
  participants: [
    { character_id: 'lead-1', name: 'Mara Vale', role: 'mc', controller: 'owner' },
    { character_id: 'guide-1', name: 'Bell Warden', role: 'supporting', controller: 'scribe' },
  ],
  scribe_initiative: 'high', challenge: 'balanced', pacing: 'brisk',
  consequences: 'meaningful', allow_character_death: false,
  suggestions: 'on_request', player_interiority: 'owner_only', notes: null,
  scene: SCENE, turn_count: 1, total_cost_usd: 0, cost_known: true,
  turns: [{
    id: 'turn-1', session_id: 'ps1', ordinal: 1, speaker: 'scribe',
    input_kind: 'response', character_id: null, content: 'The stair waits in a skin of dust.',
    source: 'ai', cost_known: true,
  }],
};

function handlers(extra = []) {
  return [
    ...extra,
    { match: (url, options) => url === '/api/stories/s1/scenes' && options.method === 'GET', response: jsonResponse(200, { scenes: [SCENE] }) },
    { match: (url, options) => url === '/api/stories/s1/scenes/scene-1/play-sessions' && options.method === 'GET', response: jsonResponse(200, { sessions: [{ ...SESSION, turns: undefined }], active: SESSION }) },
    { match: (url, options) => url === '/api/stories/s1/play-sessions/ps1' && options.method === 'GET', response: jsonResponse(200, { session: SESSION }) },
    { match: (url, options) => url === '/api/stories/s1/solo-tools' && options.method === 'GET', response: jsonResponse(200, { tools: [] }) },
    { match: (url, options) => url === '/api/stories/s1/play-sessions/ps1/tool-results' && options.method === 'GET', response: jsonResponse(200, { records: [] }) },
  ];
}

describe('optional Play workspace', () => {
  it('renders contract-bound working history and records a free turn without a paid request', async () => {
    const fetchMock = mockFetch(handlers([
      {
        match: (url, options) => url === '/api/stories/s1/play-sessions/ps1/turns' && options.method === 'POST',
        response: jsonResponse(201, { turn: { id: 'turn-2' }, reused: false }),
      },
    ]));
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterPlay({ storyId: 's1', sceneId: 'scene-1' });

    expect(document.getElementById('playSceneName').textContent).toContain('At the sealed stair');
    expect(document.getElementById('playContractPanel').hidden).toBe(true);
    expect(document.getElementById('playSessionPanel').hidden).toBe(false);
    expect(document.getElementById('playTranscript').textContent).toContain('The stair waits');
    expect(document.getElementById('playContractSummary').textContent).toContain('Mara Vale: owner');
    expect(document.getElementById('playContractSummary').textContent).toContain('character death barred');

    document.getElementById('playTurnKind').value = 'ask';
    document.getElementById('playTurnContent').value = 'What can Mara hear below?';
    document.getElementById('playRecordTurn').click();
    for (let attempt = 0; attempt < 20 && !fetchMock.mock.calls.some(([url]) => url.endsWith('/turns')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/turns'));
    expect(JSON.parse(call[1].body)).toMatchObject({
      kind: 'ask', character_id: null, content: 'What can Mara hear below?',
      idempotency_key: expect.stringMatching(/^play:/),
    });
    expect(document.querySelector('.dialog-manager')?.hidden ?? true).toBe(true);
    for (let attempt = 0; attempt < 20 && document.getElementById('playRecordTurn').disabled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });

  it('reviews a paid Scribe turn and states that it remains outside manuscript prose', async () => {
    const fetchMock = mockFetch(handlers([
      {
        match: (url, options) => url === '/api/stories/s1/play-sessions/ps1/replies' && options.method === 'POST',
        response: jsonResponse(201, { response_turn: { id: 'turn-2' }, cost_usd: 0.01 }),
      },
    ]));
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterPlay({ storyId: 's1', sceneId: 'scene-1' });

    document.getElementById('playTurnContent').value = 'I lift the latch without opening it.';
    document.getElementById('playComposer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('does not become manuscript prose');
    expect(await paidReview('confirm')).toBe(true);
    for (let attempt = 0; attempt < 20 && !fetchMock.mock.calls.some(([url]) => url.endsWith('/replies')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/replies'));
    expect(JSON.parse(call[1].body)).toMatchObject({
      kind: 'act', content: 'I lift the latch without opening it.',
      idempotency_key: expect.stringMatching(/^play:/),
    });
    for (let attempt = 0; attempt < 20 && document.getElementById('playSendTurn').disabled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });

  it('runs a solo tool locally without opening paid review', async () => {
    const tool = { id: 'tool-1', name: 'Risk', kind: 'dice', config: { notation: '2d6+1' }, state: {}, active: true };
    const fetchMock = mockFetch(handlers([
      { match: (url, options) => url === '/api/stories/s1/solo-tools' && options.method === 'GET', response: jsonResponse(200, { tools: [tool] }) },
      {
        match: (url, options) => url === '/api/stories/s1/play-sessions/ps1/tool-results' && options.method === 'POST',
        response: jsonResponse(201, { tool, record: { id: 'result-1', tool_name: 'Risk', tool_kind: 'dice', after_turn_ordinal: 1, summary: '2d6+1 → 4, 5 + 1 = 10' } }),
      },
    ]));
    const fw = await loadScript();
    fw.__setStoryState({ currentStory: STORY, storyPages: [] });
    await fw.enterPlay({ storyId: 's1', sceneId: 'scene-1' });

    const roll = [...document.querySelectorAll('#playToolRunner button')].find((button) => button.textContent === 'Roll and record');
    expect(roll).toBeTruthy();
    roll.click();
    for (let attempt = 0; attempt < 20 && !fetchMock.mock.calls.some(([url, options]) => url.endsWith('/tool-results') && options.method === 'POST'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const call = fetchMock.mock.calls.find(([url, options]) => url.endsWith('/tool-results') && options.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({ tool_id: 'tool-1', input: { notation: '2d6+1' } });
    for (let attempt = 0; attempt < 20 && !document.getElementById('playToolRecords').textContent.includes('= 10'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(document.getElementById('playToolRecords').textContent).toContain('= 10');
    expect(document.querySelector('.dialog-manager')?.hidden ?? true).toBe(true);
  });
});
