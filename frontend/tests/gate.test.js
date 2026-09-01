'use strict';

import { loadScript, jsonResponse, dialogAction } from './dom-helpers.js';
import { jest } from '@jest/globals';

const STORY = {
  currentStory: { id: 's1', title: 'Gate Tale', updated_at: '2026-09-01 07:00:00', page_count: 2, total_cost_usd: 0 },
  storyPages: [
    { id: 'p1', page_number: 1, content: 'First display page.' },
    { id: 'p2', page_number: 2, content: 'Second display page.' },
  ],
  currentPage: 2,
};

const ASSET = {
  id: 'a1', title: 'Tower plate', alt_text: 'A tower under moonlight.', content_url: '/api/stories/s1/assets/a1/content',
};

const DOCUMENT = {
  format: 'scribetribe-publication-document', schema_version: 1,
  metadata: { title: 'Gate Tale', subtitle: null, author: 'Ada', language: 'en', description: null, publisher: null, rights: null, date: null },
  front_matter: [],
  volumes: [{ ordinal: 1, title: 'Volume I', chapters: [{ ordinal: 1, title: 'Chapter I', pages: [{ ordinal: 1, blocks: [{ type: 'paragraph', text: 'First display page.' }] }, { ordinal: 2, blocks: [{ type: 'paragraph', text: 'Second display page.' }, { type: 'art', asset_key: 'asset-1', alt_text: ASSET.alt_text, position: 'after' }] }] }] }],
  back_matter: [],
  assets: [{ key: 'asset-1', media_type: 'image/webp', sha256: 'a'.repeat(64), width: 100, height: 100, title: ASSET.title, alt_text: ASSET.alt_text, content_base64: 'AA==' }],
};

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

function installFetch() {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (target.endsWith('/stories/s1/assets') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { assets: [ASSET], placements: [{ id: 'pl1', asset_id: 'a1', after_page_id: 'p2', ordinal: 1 }] }));
    }
    if (target.endsWith('/stories/s1/publications') && method === 'POST') {
      return Promise.resolve(jsonResponse(201, { snapshot: { id: 'snap1', sha256: 'b'.repeat(64), warnings: [], formats: ['epub', 'pdf'], document: DOCUMENT } }));
    }
    if (target.endsWith('/publications/snap1/exports') && method === 'POST') {
      return Promise.resolve(jsonResponse(202, { job: { id: 'job1', snapshot_id: 'snap1', snapshot_sha256: 'b'.repeat(64), formats: ['epub', 'pdf'], status: 'queued', completed_formats: 0, total_formats: 2, outputs: [] } }));
    }
    if (target.endsWith('/publication-jobs/job1') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { job: {
        id: 'job1', snapshot_id: 'snap1', snapshot_sha256: 'b'.repeat(64), formats: ['epub', 'pdf'], status: 'ready', completed_formats: 2, total_formats: 2,
        outputs: [
          { format: 'epub', filename: 'gate-tale.epub', download_url: '/api/publication-jobs/job1/files/gate-tale.epub' },
          { format: 'pdf', filename: 'gate-tale.pdf', download_url: '/api/publication-jobs/job1/files/gate-tale.pdf' },
        ],
      } }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
}

describe('PR 16 Gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFetch();
  });

  it('separates backup from publication and builds many formats from one reviewed snapshot', async () => {
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGate({ storyId: 's1' });

    expect(document.getElementById('gateBackupBtn').textContent).toContain('project backup');
    expect(document.getElementById('gatePublicationTitle').value).toBe('Gate Tale');
    expect(document.querySelectorAll('#gateArtList [data-asset-id]')).toHaveLength(1);
    document.querySelector('#gateArtList [data-asset-id]').click();
    document.getElementById('gatePublicationAuthor').value = 'Ada';
    document.getElementById('gatePublicationForm').requestSubmit();
    await tick();

    const publicationCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/stories/s1/publications'));
    expect(JSON.parse(publicationCall[1].body)).toEqual(expect.objectContaining({
      metadata: { title: 'Gate Tale', author: 'Ada', language: 'en' },
      art: { asset_ids: ['a1'] },
      expected_story_updated_at: STORY.currentStory.updated_at,
    }));
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('One immutable book');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('Excluded: directions, continuity');
    expect(await dialogAction('Build 2 formats')).toBe(true);
    await tick();
    await tick();

    const jobCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/publications/snap1/exports'));
    expect(JSON.parse(jobCall[1].body)).toEqual({ formats: ['epub', 'pdf'] });
    expect(document.getElementById('gateJobStatus').textContent).toContain('2 publication files ready');
    expect([...document.querySelectorAll('#gateJobDownloads a')].map((link) => link.textContent)).toEqual(['Download EPUB', 'Download PDF']);
    expect(fetch.mock.calls.some(([url]) => /provider|models|completion|generate/.test(String(url)))).toBe(false);
  });

  it('opens full-fidelity project backup on a separate explicit review path', async () => {
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGate({ storyId: 's1' });
    document.getElementById('gateBackupBtn').click();
    expect(document.querySelector('.dialog-manager__title').textContent).toContain('one story and all of its dependencies');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('working history');
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('Never included: API keys');
  });
});
