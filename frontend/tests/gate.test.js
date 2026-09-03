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
  format: 'ink-morrow-publication-document', schema_version: 1,
  metadata: { title: 'Gate Tale', subtitle: null, author: 'Ada', language: 'en', description: null, publisher: null, rights: null, date: null },
  front_matter: [],
  volumes: [{ ordinal: 1, title: 'Volume I', chapters: [{ ordinal: 1, title: 'Chapter I', pages: [{ ordinal: 1, blocks: [{ type: 'paragraph', text: 'First display page.' }] }, { ordinal: 2, blocks: [{ type: 'paragraph', text: 'Second display page.' }, { type: 'art', asset_key: 'asset-1', alt_text: ASSET.alt_text, position: 'after' }] }] }] }],
  back_matter: [],
  assets: [{ key: 'asset-1', media_type: 'image/webp', sha256: 'a'.repeat(64), width: 100, height: 100, title: ASSET.title, alt_text: ASSET.alt_text, content_base64: 'AA==' }],
};

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }

function installFetch() {
  let shares = [];
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
    if (target.includes('/publication-shares?story_id=s1') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { shares }));
    }
    if (target.endsWith('/publications/snap1/shares') && method === 'POST') {
      const share = {
        id: 'share1', snapshot_id: 'snap1', snapshot_sha256: 'b'.repeat(64), story_id: 's1',
        status: 'active', created_at: '2026-09-01T08:00:00.000Z', expires_at: '2026-09-08T08:00:00.000Z', revoked_at: null,
        share_url: `/share/#${'c'.repeat(43)}`,
      };
      shares = [{ ...share, share_url: undefined }];
      return Promise.resolve(jsonResponse(201, { share }));
    }
    if (target.endsWith('/publication-shares/share1/revoke') && method === 'POST') {
      shares = [{ ...shares[0], status: 'revoked', revoked_at: '2026-09-01T09:00:00.000Z' }];
      return Promise.resolve(jsonResponse(200, { share: shares[0] }));
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

  it('creates a one-time immutable reading-copy link and revokes it', async () => {
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGate({ storyId: 's1' });
    expect(document.getElementById('gateCreateShareBtn').disabled).toBe(true);

    document.getElementById('gatePublicationForm').requestSubmit();
    await tick();
    expect(document.getElementById('gateCreateShareBtn').disabled).toBe(false);
    document.getElementById('gateCreateShareBtn').click();
    await tick();
    await tick();

    const creation = fetch.mock.calls.find(([url]) => String(url).endsWith('/publications/snap1/shares'));
    expect(JSON.parse(creation[1].body)).toEqual({ expires_in_seconds: 604800 });
    expect(document.getElementById('gateShareUrl').value).toMatch(/\/share\/#c{43}$/);
    expect(document.getElementById('gateShareReveal').hidden).toBe(false);
    expect(document.getElementById('gateShareList').textContent).toContain('Active');

    document.querySelector('#gateShareList button').click();
    expect(document.querySelector('.dialog-manager__body').textContent).toContain('cannot be undone');
    expect(await dialogAction('Revoke permanently')).toBe(true);
    await tick();
    await tick();
    expect(document.getElementById('gateShareReveal').hidden).toBe(true);
    expect(document.getElementById('gateShareList').textContent).toContain('revoked');
    expect(fetch.mock.calls.some(([url]) => /provider|models|completion|generate/.test(String(url)))).toBe(false);
  });

  it('invalidates the previous manuscript snapshot while a different Gate is loading', async () => {
    const fw = await loadScript();
    fw.__setStoryState(STORY);
    await fw.enterGate({ storyId: 's1' });
    document.getElementById('gatePublicationForm').requestSubmit();
    await tick();
    expect(document.getElementById('gateCreateShareBtn').disabled).toBe(false);

    let resolveAssets;
    let resolveShares;
    global.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.endsWith('/stories/s2/assets')) {
        return new Promise((resolve) => { resolveAssets = () => resolve(jsonResponse(200, { assets: [], placements: [] })); });
      }
      if (target.includes('/publication-shares?story_id=s2')) {
        return new Promise((resolve) => { resolveShares = () => resolve(jsonResponse(200, { shares: [] })); });
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    fw.__setStoryState({
      currentStory: { ...STORY.currentStory, id: 's2', title: 'Second Gate Tale' },
      storyPages: [],
    });

    const entering = fw.enterGate({ storyId: 's2' });
    expect(document.getElementById('gateSection').getAttribute('aria-busy')).toBe('true');
    expect(document.getElementById('gateBackupBtn').disabled).toBe(true);
    expect(document.getElementById('gateReviewPublicationBtn').disabled).toBe(true);
    expect(document.getElementById('gateCreateShareBtn').disabled).toBe(true);
    expect(document.getElementById('gateShareReveal').hidden).toBe(true);
    expect(document.getElementById('gateStatus').textContent).toContain('Opening publication assets');

    await tick();
    resolveAssets();
    resolveShares();
    await entering;
    expect(document.getElementById('gateSection').getAttribute('aria-busy')).toBe('false');
    expect(document.getElementById('gatePublicationTitle').value).toBe('Second Gate Tale');
    expect(document.getElementById('gateReviewPublicationBtn').disabled).toBe(false);
    expect(document.getElementById('gateCreateShareBtn').disabled).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/publications/snap1/shares'))).toBe(false);
  });
});
