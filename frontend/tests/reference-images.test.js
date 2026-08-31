'use strict';

import { loadScript, mockFetch, jsonResponse, paidReview } from './dom-helpers.js';

function characterRow(overrides = {}) {
  return {
    id: 'c1',
    name: 'Vesna',
    description: 'Ash-mantled courier',
    world_id: null,
    image_status: 'none',
    image_media_type: null,
    image_cost_usd: null,
    image_updated_at: null,
    ...overrides,
  };
}

describe('Reference images on cards', () => {
  let fw;

  async function boot(characters, worlds = []) {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds }) },
    ]);
    fw = await loadScript();
  }

  it('shows the painted portrait for ready characters', async () => {
    await boot([characterRow({ id: 'c1', image_status: 'ready', image_media_type: 'image/png', image_cost_usd: 0.06, image_updated_at: '2026-08-29 20:00:00' })]);
    await fw.loadCharacters();
    const img = document.querySelector('#charactersList .item-card .card-image');
    expect(img).toBeTruthy();
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/characters/c1/image');
    expect(img.getAttribute('alt')).toContain('Vesna');
    expect(document.querySelector('#charactersList .card-more__item').textContent).toContain('Regenerate image (≈$0.06)');
  });

  it('shows placeholders while pending or after failure', async () => {
    await boot([
      characterRow({ id: 'c1', image_status: 'pending' }),
      characterRow({ id: 'c2', name: 'Doomed', image_status: 'failed' }),
    ]);
    await fw.loadCharacters();
    const cards = document.querySelectorAll('#charactersList .item-card');
    expect(cards[0].querySelector('.card-image--pending').textContent).toContain('being painted');
    expect(cards[1].querySelector('.card-image--failed').textContent).toContain('failed');
    // Regeneration always sits in the More menu with its approximate cost
    expect(cards[0].querySelector('.card-more__item').textContent).toContain('Regenerate image (≈$0.06)');
  });

  it('world cards use the world image endpoint', async () => {
    await boot([], [{ id: 'w1', name: 'Emberfall', description: 'Brass and ash', image_status: 'ready', image_media_type: 'image/jpeg' }]);
    await fw.loadWorlds();
    const img = document.querySelector('#worldsList .item-card .card-image');
    expect(img.getAttribute('src')).toBe('/api/worlds/w1/image');
  });

  it('redo POSTs and refreshes the list', async () => {
    await boot([characterRow({ id: 'c1', image_status: 'ready' })]);
    await fw.loadCharacters();
    global.fetch.mockClear();
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/api/characters') && options.method === 'POST' && String(url).endsWith('/image')) {
        return Promise.resolve(jsonResponse(200, { image_status: 'pending' }));
      }
      return Promise.resolve(jsonResponse(200, { characters: [characterRow({ id: 'c1', image_status: 'pending' })] }));
    });

    document.querySelector('#charactersList .card-more__item').click();
    expect(await paidReview('confirm')).toBe(true); // the repaint is reviewed
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const post = fetch.mock.calls.find(([url, options]) => String(url).includes('/image') && options.method === 'POST');
    expect(String(post[0])).toBe('/api/characters/c1/image');
    // the list refreshed to the pending state
    expect(document.querySelector('#charactersList .card-image--pending')).toBeTruthy();
  });

  it('canceling the redo review sends zero image requests and keeps the card', async () => {
    await boot([characterRow({ id: 'c1', image_status: 'ready' })]);
    await fw.loadCharacters();
    global.fetch.mockClear();

    document.querySelector('#charactersList .card-more__item').click();
    expect(await paidReview('cancel')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    const posts = fetch.mock.calls.filter(([url, options]) => String(url).includes('/image') && options.method === 'POST');
    expect(posts).toHaveLength(0);
    expect(document.querySelector('.dialog-manager').hidden).toBe(true);
  });

  it('session cost ticks once per painted image, and again after a redo', async () => {
    await boot([characterRow({ id: 'c1', image_status: 'ready', image_cost_usd: 0.06, image_updated_at: 't1' })]);
    await fw.loadCharacters();
    expect(fw.state().costs.session).toBeCloseTo(0.06);

    await fw.loadCharacters(); // reload: no double charge
    expect(fw.state().costs.session).toBeCloseTo(0.06);

    // A regenerated image has a new updated_at and bills again
    global.fetch.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, {
          characters: [characterRow({ id: 'c1', image_status: 'ready', image_cost_usd: 0.06, image_updated_at: 't2' })],
        })
      )
    );
    await fw.loadCharacters();
    expect(fw.state().costs.session).toBeCloseTo(0.12);
  });

  it('world image costs tick the session too (stories stay untouched)', async () => {
    await boot([], [{ id: 'w1', name: 'E', image_status: 'ready', image_cost_usd: 0.04, image_updated_at: 't1' }]);
    await fw.loadWorlds();
    expect(fw.state().costs.session).toBeCloseTo(0.04);
    expect(fw.state().costs.story).toBeCloseTo(0); // no story involved
  });
});
