'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const CHARACTER = {
  id: 'c1',
  name: 'Vesna',
  description: 'Ash-mantled courier',
  personality: 'Wry',
  appearance: 'Grey cloak',
  background: 'Debt to the guild',
  world_id: null,
  image_status: 'ready',
  image_media_type: 'image/png',
  image_cost_usd: 0.06,
  image_updated_at: 't1',
  image_prompt: 'A courier in rain, ink style.',
};

const WORLD = {
  id: 'w1',
  name: 'Emberfall',
  description: 'Brass and ash',
  genre: 'Dark Fantasy',
  setting: 'Volcanic empire',
  lore: 'The aqueduct of teeth rings at dusk.',
  image_status: 'ready',
  image_media_type: 'image/jpeg',
  image_cost_usd: 0.04,
  image_updated_at: 't1',
  image_prompt: null,
};

async function flush(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('Entity editors', () => {
  let fw;

  beforeEach(async () => {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters: [CHARACTER] }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds: [WORLD] }) },
      { match: '/api/stories', response: jsonResponse(200, { stories: [] }) },
    ]);
    fw = await loadScript();
  });

  it('opens the character editor on card click, but not from its buttons', async () => {
    await fw.loadCharacters();
    const card = document.querySelector('#charactersList .item-card');
    card.querySelector('.card-edit').click(); // the explicit Edit button opens it
    expect(document.getElementById('characterEditorModal').hidden).toBe(false);
    document.getElementById('charEditCancelBtn').click(); // clean (not dirty) close
    expect(document.getElementById('characterEditorModal').hidden).toBe(true);

    card.click();
    const modal = document.getElementById('characterEditorModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('charEditName').value).toBe('Vesna');
    expect(document.getElementById('charEditAppearance').value).toBe('Grey cloak');
    expect(document.getElementById('charEditImagePrompt').value).toBe('A courier in rain, ink style.');

    document.getElementById('charEditCancelBtn').click();
    expect(modal.hidden).toBe(true);
  });

  it('saves the character sheet (with the image blurb) through PUT', async () => {
    await fw.loadCharacters();
    document.querySelector('#charactersList .item-card').click();
    document.getElementById('charEditName').value = 'Vesna of the Ash';
    document.getElementById('charEditImagePrompt').value = 'A courier in snow, charcoal.';
    document.getElementById('charEditDescription').value = 'Changed by the story';
    document.getElementById('characterEditorForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush(0);
    await flush(0);

    const put = fetch.mock.calls.find(([url, options]) => String(url).includes('/api/characters') && options.method === 'PUT');
    expect(String(put[0])).toBe('/api/characters/c1');
    expect(JSON.parse(put[1].body)).toEqual({
      name: 'Vesna of the Ash',
      description: 'Changed by the story',
      personality: 'Wry',
      appearance: 'Grey cloak',
      background: 'Debt to the guild',
      image_prompt: 'A courier in snow, charcoal.',
    });
    expect(document.getElementById('characterEditorModal').hidden).toBe(true);
    expect(document.querySelector('.success-message').textContent).toContain('saved');
  });

  it('"Save & redo image" saves first, then regenerates the portrait', async () => {
    await fw.loadCharacters();
    document.querySelector('#charactersList .item-card').click();
    document.getElementById('charEditImagePrompt').value = 'A stained-glass saint.';
    document.getElementById('charEditRedoImageBtn').click();
    await flush(0);
    await flush(0);
    await flush(0);

    const put = fetch.mock.calls.find(([url, options]) => String(url).includes('/api/characters') && options.method === 'PUT');
    expect(JSON.parse(put[1].body).image_prompt).toBe('A stained-glass saint.');
    const redo = fetch.mock.calls.find(([url, options]) => String(url).endsWith('/image') && options.method === 'POST');
    expect(String(redo[0])).toBe('/api/characters/c1/image');
    expect(document.getElementById('characterEditorModal').hidden).toBe(true);
  });

  it('world editor edits the lorebook and refreshes everything that shows the world', async () => {
    await fw.loadWorlds();
    document.querySelector('#worldsList .item-card').click();
    const modal = document.getElementById('worldEditorModal');
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('worldEditLore').value).toBe('The aqueduct of teeth rings at dusk.');

    document.getElementById('worldEditLore').value = 'The moon never sets over the brass city.';
    document.getElementById('worldEditorForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush(0);
    await flush(0);

    const put = fetch.mock.calls.find(([url, options]) => String(url).includes('/api/worlds') && options.method === 'PUT');
    expect(String(put[0])).toBe('/api/worlds/w1');
    expect(JSON.parse(put[1].body).lore).toBe('The moon never sets over the brass city.');
    expect(modal.hidden).toBe(true);
    // Stories live on the canonical world: their lists refresh too
    expect(fetch.mock.calls.some(([url, options]) => String(url).includes('/api/stories') && (!options || options.method === 'GET'))).toBe(true);
  });

  it('a ready image whose file is missing degrades to a placeholder, not a broken <img>', async () => {
    await fw.loadCharacters();
    const img = document.querySelector('#charactersList .item-card .card-image');
    expect(img.tagName).toBe('IMG');
    img.dispatchEvent(new Event('error')); // the server 404s (legacy copy without files)
    expect(document.querySelector('#charactersList .card-image--failed').textContent).toContain('missing');
    expect(document.querySelector('#charactersList .card-more__item')).toBeTruthy(); // regeneration still offered
  });
});
