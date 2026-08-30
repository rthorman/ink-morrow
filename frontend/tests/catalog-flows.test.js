import { loadScript, mockFetch, jsonResponse, dialogAction, paidReview } from './dom-helpers.js';

function flush(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Create without image (generate_image field)', () => {
  it('worlds: the default paints; Create without image sends generate_image:false', async () => {
    const fetchMock = mockFetch();
    await loadScript();

    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/worlds') && options.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { world: { id: 'w1', name: 'Quiet Vale' } }));
      }
      return Promise.resolve(jsonResponse(200, { worlds: [], characters: [], stories: [] }));
    });

    document.getElementById('worldName').value = 'Painted Vale';
    document.getElementById('worldForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(await paidReview('confirm')).toBe(true); // the default path paints: reviewed
    await flush(0);
    const defaultCall = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith('/worlds') && options.method === 'POST');
    expect(JSON.parse(defaultCall[1].body).generate_image).toBeUndefined(); // old-client behavior preserved

    fetchMock.mockClear();
    document.getElementById('worldName').value = 'Quiet Vale';
    const noImage = { submitter: document.getElementById('worldNoImageBtn') };
    const event = new Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'submitter', { value: noImage.submitter });
    document.getElementById('worldForm').dispatchEvent(event);
    await flush(0);
    const quietCall = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith('/worlds') && options.method === 'POST');
    expect(JSON.parse(quietCall[1].body).generate_image).toBe(false);
  });

  it('characters: Create without image skips the portrait', async () => {
    const fetchMock = mockFetch();
    await loadScript();
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith('/characters') && options.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { character: { id: 'c1', name: 'N' } }));
      }
      return Promise.resolve(jsonResponse(200, { worlds: [], characters: [], stories: [] }));
    });

    document.getElementById('characterName').value = 'Quiet One';
    const event = new Event('submit', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'submitter', { value: document.getElementById('characterNoImageBtn') });
    document.getElementById('characterForm').dispatchEvent(event);
    await flush(0);
    const call = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith('/characters') && options.method === 'POST');
    expect(JSON.parse(call[1].body).generate_image).toBe(false);
  });
});

describe('Explicit-tone acknowledgement (contextual, not a global gate)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('asks once on first explicit selection, then never again', async () => {
    mockFetch();
    await loadScript();
    const tone = document.getElementById('storyTone');

    tone.value = 'explicit';
    tone.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(0);
    const dialog = document.querySelector('.dialog-manager');
    expect(dialog.hidden).toBe(false);
    expect(dialog.querySelector('.dialog-manager__title').textContent).toContain('Explicit tone');

    // Declining reverts to tasteful without acknowledging
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Choose a different tone').click();
    await flush(0);
    expect(tone.value).toBe('fade-to-black');
    expect(window.localStorage.getItem('st-tone-explicit-ok')).toBeNull();

    // Acknowledging stores the choice
    tone.value = 'explicit';
    tone.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(0);
    [...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('I am 18 or older')).click();
    await flush(0);
    expect(window.localStorage.getItem('st-tone-explicit-ok')).toBe('1');

    // Subsequent selections never ask
    tone.value = 'romantic';
    tone.dispatchEvent(new Event('change', { bubbles: true }));
    tone.value = 'explicit';
    tone.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(0);
    expect(document.querySelector('.dialog-manager').hidden).toBe(true);
  });

  it('tasteful and romantic tones are never gated', async () => {
    mockFetch();
    await loadScript();
    const tone = document.getElementById('storyTone');
    for (const value of ['fade-to-black', 'romantic']) {
      tone.value = value;
      tone.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await flush(0);
    expect(!document.querySelector('.dialog-manager') || document.querySelector('.dialog-manager').hidden).toBe(true);
  });
});

describe('Dirty entity editors guard their drafts', () => {
  it('a dirty world editor asks before Escape discards; cancel keeps the draft', async () => {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters: [] }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds: [{ id: 'w1', name: 'Emberfall', description: '', genre: '', setting: '' }] }) },
      { match: '/api/stories', response: jsonResponse(200, { stories: [] }) },
    ]);
    const fw = await loadScript();
    await fw.loadWorlds();
    await flush(0);

    document.querySelector('#worldsList .item-card').click();
    const modal = document.getElementById('worldEditorModal');
    expect(modal.hidden).toBe(false);

    // Clean close: Escape closes immediately
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(0);
    expect(modal.hidden).toBe(true);

    // Dirty close: Escape asks first
    document.querySelector('#worldsList .item-card').click();
    document.getElementById('worldEditName').value = 'Emberfall Reborn';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(0);
    const dialog = document.querySelector('.dialog-manager');
    expect(dialog.querySelector('.dialog-manager__title').textContent).toContain('Discard changes');

    // Keep the draft: the editor re-opens with the edit intact
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    await flush(0);
    expect(document.getElementById('worldEditName').value).toBe('Emberfall Reborn');
    expect(modal.hidden).toBe(false);

    // Discard on demand
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush(0);
    expect(await dialogAction('Discard changes')).toBe(true);
    expect(modal.hidden).toBe(true);
  });
});
