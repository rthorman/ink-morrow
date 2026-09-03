'use strict';

import { readFileSync } from 'node:fs';
import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const STORY = {
  id: 's-start',
  title: 'Started Tale',
  tone: 'fade-to-black',
  world_id: null,
  characters: [],
  page_count: 1,
  total_cost_usd: 0,
  hierarchy: {
    volumes: [{ id: 'v1', title: 'Volume I', chapters: [{ id: 'c1', title: 'Chapter I', pages: [] }] }],
    summary: { volume_count: 1, chapter_count: 1, page_count: 0 },
  },
};

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function requestBody(options) {
  return options?.body ? JSON.parse(options.body) : null;
}

describe('PR10 Library manuscript start', () => {
  let fetchMock;

  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    fetchMock = mockFetch();
    await loadScript();
  });

  it('keeps an entered opening when the one-sheet is cancelled and reopened', () => {
    document.getElementById('heroStartBtn').click();
    document.getElementById('manuscriptStartName').value = 'Kept title';
    document.getElementById('startManualOpening').value = 'A kept first line.';
    document.getElementById('startManualOpening').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('manuscriptStartCancel').click();

    expect(document.getElementById('manuscriptStartSheet').hidden).toBe(true);
    document.getElementById('heroStartBtn').click();
    expect(document.getElementById('manuscriptStartName').value).toBe('Kept title');
    expect(document.getElementById('startManualOpening').value).toBe('A kept first line.');
  });

  it('creates a valid manual manuscript and Page 1 without provider setup or AI calls', async () => {
    const writes = [];
    fetchMock.mockImplementation((url, options = {}) => {
      const method = options.method || 'GET';
      if (url === '/api/stories' && method === 'POST') {
        writes.push(['story', requestBody(options)]);
        return Promise.resolve(jsonResponse(201, { story: STORY }));
      }
      if (url === '/api/stories/s-start/pages' && method === 'POST') {
        writes.push(['page', requestBody(options)]);
        return Promise.resolve(jsonResponse(201, { page: { id: 'p1', page_number: 1, content: 'A local opening.' } }));
      }
      if (url === '/api/stories' && method === 'GET') return Promise.resolve(jsonResponse(200, { stories: [STORY] }));
      if (url === '/api/stories/s-start/pages' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { pages: [{ id: 'p1', page_number: 1, content: 'A local opening.' }] }));
      }
      if (url === '/api/storage') return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    document.getElementById('heroStartBtn').click();
    document.getElementById('manuscriptStartName').value = 'Started Tale';
    document.getElementById('startManualOpening').value = 'A local opening.';
    document.getElementById('manuscriptStartSubmit').click();
    for (let i = 0; i < 8; i++) await flush();

    expect(writes[0][1]).toMatchObject({ title: 'Started Tale', characters: [], world_id: null, scribe_id: null });
    expect(writes[1][1]).toMatchObject({ content: 'A local opening.' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/providers'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/'))).toBe(false);
    expect(window.location.hash).toBe('#/desk/s-start');
  });

  it('carries a seed to the Desk direction without making a provider request', async () => {
    fetchMock.mockImplementation((url, options = {}) => {
      const method = options.method || 'GET';
      if (url === '/api/stories' && method === 'POST') return Promise.resolve(jsonResponse(201, { story: STORY }));
      if (url === '/api/stories' && method === 'GET') return Promise.resolve(jsonResponse(200, { stories: [STORY] }));
      if (url === '/api/stories/s-start/pages') return Promise.resolve(jsonResponse(200, { pages: [] }));
      if (url === '/api/storage') return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    document.getElementById('heroStartBtn').click();
    document.getElementById('startPathSeed').click();
    document.getElementById('startSeedPremise').value = 'A city forgets one resident every dawn.';
    document.getElementById('startSeedDirection').value = 'Open at the census desk.';
    document.getElementById('manuscriptStartSubmit').click();
    for (let i = 0; i < 8; i++) await flush();

    expect(document.getElementById('userInput').value).toContain('A city forgets one resident every dawn.');
    expect(document.getElementById('userInput').value).toContain('Open at the census desk.');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/providers'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ai/'))).toBe(false);
  });

  it('maps Markdown headings to chapters and preserves their prose locally', async () => {
    const mutations = [];
    fetchMock.mockImplementation((url, options = {}) => {
      const method = options.method || 'GET';
      if (url === '/api/stories' && method === 'POST') return Promise.resolve(jsonResponse(201, { story: STORY }));
      if (method !== 'GET') mutations.push([url, method, requestBody(options)]);
      if (url === '/api/stories' && method === 'GET') return Promise.resolve(jsonResponse(200, { stories: [STORY] }));
      if (url === '/api/stories/s-start/pages' && method === 'GET') return Promise.resolve(jsonResponse(200, { pages: [] }));
      if (url === '/api/storage') return Promise.resolve(jsonResponse(200, { stories: [] }));
      return Promise.resolve(jsonResponse(201, {}));
    });

    document.getElementById('heroImportBtn').click();
    document.getElementById('startImportProse').value = '# Arrival\nFirst chapter text.\n# The Door\nSecond chapter text.';
    document.getElementById('manuscriptStartSubmit').click();
    for (let i = 0; i < 12; i++) await flush();

    expect(mutations).toContainEqual(['/api/stories/s-start/chapters/c1', 'PUT', { title: 'Arrival' }]);
    expect(mutations).toContainEqual(['/api/stories/s-start/volumes/v1/chapters', 'POST', { title: 'The Door' }]);
    const pageBodies = mutations.filter(([url]) => url === '/api/stories/s-start/pages').map(([, , body]) => body.content);
    expect(pageBodies).toEqual(['First chapter text.', 'Second chapter text.']);
  });

  it('reveals provider setup only after the author requests an AI Foundation draft', async () => {
    fetchMock.mockImplementation((url) => {
      if (url === '/api/providers') {
        return Promise.resolve(jsonResponse(200, {
          profiles: [],
          roles: [{ role: 'scribe', status: 'unconfigured', model_id: 'z-ai/glm-5.1' }],
        }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    document.getElementById('heroStartBtn').click();
    expect(document.getElementById('startProviderSetup').hidden).toBe(true);
    document.getElementById('startDraftFoundationsBtn').click();
    await flush();

    expect(document.getElementById('startProviderSetup').hidden).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ai/foundations')).toBe(false);
  });

  it('visibly dismisses a path hint and remembers that choice for the session', () => {
    const style = document.createElement('style');
    style.textContent = [
      readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8'),
      readFileSync(new URL('../styles/features/home.css', import.meta.url), 'utf8'),
    ].join('\n');
    document.head.appendChild(style);

    document.getElementById('heroStartBtn').click();
    const hint = document.getElementById('manuscriptStartHintWrap');
    expect(getComputedStyle(hint).display).toBe('flex');

    document.getElementById('manuscriptStartHintDismiss').click();
    expect(hint.hidden).toBe(true);
    expect(getComputedStyle(hint).display).toBe('none');
    expect(JSON.parse(window.sessionStorage.getItem('im-manuscript-start-hints-v1'))).toContain('manual');

    document.getElementById('manuscriptStartCancel').click();
    document.getElementById('heroStartBtn').click();
    expect(hint.hidden).toBe(true);
  });

  it('shows a disabled busy button while AI drafts Foundations and restores it afterwards', async () => {
    let finishDraft;
    fetchMock.mockImplementation((url, options = {}) => {
      if (url === '/api/providers') {
        return Promise.resolve(jsonResponse(200, {
          profiles: [], roles: [{ role: 'scribe', status: 'available', model_id: 'model' }],
        }));
      }
      if (url === '/api/ai/foundations' && options.method === 'POST') {
        return new Promise((resolve) => { finishDraft = () => resolve(jsonResponse(200, { foundations: {} })); });
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    document.getElementById('heroStartBtn').click();
    const button = document.getElementById('startDraftFoundationsBtn');
    const originalLabel = button.textContent;
    button.click();
    for (let i = 0; i < 4; i++) await flush();
    const confirm = [...document.querySelectorAll('.dialog-manager button')]
      .find((item) => item.textContent.includes('Draft Foundations'));
    confirm.click();
    await flush();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('drafting');

    finishDraft();
    await flush();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.textContent).toBe(originalLabel);
  });
});
