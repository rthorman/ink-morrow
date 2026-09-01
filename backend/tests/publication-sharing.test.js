'use strict';

const request = require('supertest');
const { createTestApp, setupOwner } = require('./helpers');
const { capabilityHash } = require('../src/modules/publication/shares');

describe('PR 17 immutable snapshot sharing', () => {
  let fixture;
  let now;

  beforeEach(() => {
    now = new Date('2026-09-01T08:00:00.000Z');
    fixture = createTestApp({ authRequired: true, clock: () => new Date(now) });
  });
  afterEach(() => fixture.close());

  async function ownerSnapshot() {
    const owner = request.agent(fixture.app);
    const unlocked = await setupOwner(owner, fixture.app);
    const storyResponse = await owner.post('/api/stories')
      .set('X-ScribeTribe-CSRF', unlocked.csrf_token)
      .send({ title: 'Frozen Lantern', characters: [] })
      .expect(201);
    const story = storyResponse.body.story;
    await owner.post(`/api/stories/${story.id}/pages`)
      .set('X-ScribeTribe-CSRF', unlocked.csrf_token)
      .send({ content: 'The public paragraph.', user_input: 'PRIVATE-CANARY-DIRECTION' })
      .expect(201);
    const snapshotResponse = await owner.post(`/api/stories/${story.id}/publications`)
      .set('X-ScribeTribe-CSRF', unlocked.csrf_token)
      .send({ metadata: { author: 'A. Writer' } })
      .expect(201);
    return { owner, csrf: unlocked.csrf_token, story, snapshot: snapshotResponse.body.snapshot };
  }

  it('stores only a hash and lets an unauthenticated reader see only the immutable allowlisted document', async () => {
    const source = await ownerSnapshot();
    const created = await source.owner.post(`/api/publications/${source.snapshot.id}/shares`)
      .set('X-ScribeTribe-CSRF', source.csrf)
      .send({ expires_in_seconds: 604800 })
      .expect(201);
    const share = created.body.share;
    const capability = new URL(`http://localhost${share.share_url}`).hash.slice(1);
    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = fixture.db.prepare('SELECT capability_hash FROM shares WHERE id = ?').get(share.id);
    expect(stored.capability_hash).toBe(capabilityHash(capability));
    expect(stored.capability_hash).not.toBe(capability);

    await source.owner.post(`/api/stories/${source.story.id}/pages`)
      .set('X-ScribeTribe-CSRF', source.csrf)
      .send({ content: 'A later live edit.' })
      .expect(201);

    const publicReader = await request(fixture.app)
      .get('/api/public-share')
      .set('Authorization', `Share ${capability}`)
      .expect(200);
    expect(publicReader.headers['cache-control']).toContain('no-store');
    expect(publicReader.body.publication.snapshot_sha256).toBe(source.snapshot.sha256);
    expect(JSON.stringify(publicReader.body)).toContain('The public paragraph.');
    expect(JSON.stringify(publicReader.body)).not.toContain('A later live edit.');
    expect(JSON.stringify(publicReader.body)).not.toContain('PRIVATE-CANARY-DIRECTION');
    expect(JSON.stringify(publicReader.body)).not.toContain(capability);
    expect(JSON.stringify(fixture.logEntries)).not.toContain(capability);

    await request(fixture.app).get('/api/stories').expect(401);
    await request(fixture.app).get('/api/providers').expect(401);
  });

  it('expires and revokes capabilities with one indistinguishable fail-closed response', async () => {
    const source = await ownerSnapshot();
    const first = await source.owner.post(`/api/publications/${source.snapshot.id}/shares`)
      .set('X-ScribeTribe-CSRF', source.csrf)
      .send({ expires_in_seconds: 300 })
      .expect(201);
    const firstToken = new URL(`http://localhost${first.body.share.share_url}`).hash.slice(1);
    now = new Date('2026-09-01T08:05:00.000Z');
    await request(fixture.app).get('/api/public-share').set('Authorization', `Share ${firstToken}`)
      .expect(404, { error: 'This reading-copy link is unavailable.' });

    const second = await source.owner.post(`/api/publications/${source.snapshot.id}/shares`)
      .set('X-ScribeTribe-CSRF', source.csrf)
      .send({ expires_in_seconds: null })
      .expect(201);
    const secondToken = new URL(`http://localhost${second.body.share.share_url}`).hash.slice(1);
    await request(fixture.app).get('/api/public-share').set('Authorization', `Share ${secondToken}`).expect(200);
    await source.owner.post(`/api/publication-shares/${second.body.share.id}/revoke`)
      .set('X-ScribeTribe-CSRF', source.csrf).send({}).expect(200);
    await request(fixture.app).get('/api/public-share').set('Authorization', `Share ${secondToken}`)
      .expect(404, { error: 'This reading-copy link is unavailable.' });
    await request(fixture.app).get('/api/public-share').set('Authorization', 'Share not-a-capability')
      .expect(404, { error: 'This reading-copy link is unavailable.' });

    expect(() => fixture.db.prepare("UPDATE shares SET status = 'active', revoked_at = NULL WHERE id = ?")
      .run(second.body.share.id)).toThrow(/one-way/);
    expect(() => fixture.db.prepare('UPDATE shares SET capability_hash = ? WHERE id = ?')
      .run('f'.repeat(64), second.body.share.id)).toThrow(/immutable/);
  });

  it('never returns a capability again when listing owner-visible shares', async () => {
    const source = await ownerSnapshot();
    const created = await source.owner.post(`/api/publications/${source.snapshot.id}/shares`)
      .set('X-ScribeTribe-CSRF', source.csrf).send({}).expect(201);
    const capability = new URL(`http://localhost${created.body.share.share_url}`).hash.slice(1);
    const listing = await source.owner.get(`/api/publication-shares?story_id=${source.story.id}`).expect(200);
    expect(listing.body.shares).toHaveLength(1);
    expect(JSON.stringify(listing.body)).not.toContain(capability);
    expect(listing.body.shares[0]).not.toHaveProperty('share_url');
  });
});
