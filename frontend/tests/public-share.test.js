'use strict';

import { jest } from '@jest/globals';
import { jsonResponse } from './dom-helpers.js';

const TOKEN = 'c'.repeat(43);

function documentFixture() {
  return {
    format: 'ink-morrow-publication-document', schema_version: 1,
    metadata: { title: '<Frozen Tale>', subtitle: null, author: 'Ada', language: 'en', description: null, publisher: null, rights: null, date: null },
    front_matter: [],
    volumes: [{ ordinal: 1, title: '', chapters: [{ ordinal: 1, title: 'Opening', pages: [{ ordinal: 1, blocks: [{ type: 'paragraph', text: '<script>not markup</script>' }] }] }] }],
    back_matter: [], assets: [],
  };
}

function shell() {
  document.body.innerHTML = '<p id="shareStatus"></p><article id="shareDocument" hidden></article>';
  window.location.hash = TOKEN;
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

describe('isolated public reading-copy viewer', () => {
  beforeEach(() => shell());

  it('uses only the capability endpoint and renders publication text without HTML execution', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(200, { publication: {
      snapshot_sha256: 'b'.repeat(64), created_at: '2026-09-01T08:00:00.000Z', expires_at: null,
      document: documentFixture(),
    } })));
    await import(`../app/public-share.js?success=${Date.now()}`);
    await tick();

    expect(fetch).toHaveBeenCalledWith('/api/public-share', expect.objectContaining({
      headers: { Authorization: `Share ${TOKEN}` }, credentials: 'omit', cache: 'no-store',
    }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.getElementById('shareDocument').textContent).toContain('<script>not markup</script>');
    expect(document.querySelector('#shareDocument script')).toBeNull();
    expect(document.getElementById('shareDocument').hidden).toBe(false);
  });

  it('shows the same unavailable state for a failed capability', async () => {
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse(404, { error: 'unavailable' })));
    await import(`../app/public-share.js?failed=${Date.now()}`);
    await tick();
    expect(document.getElementById('shareStatus').textContent).toContain('expired or been revoked');
    expect(document.getElementById('shareDocument').hidden).toBe(true);
  });
});
