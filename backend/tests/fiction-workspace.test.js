'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gunzipSync, gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { createDb, MIGRATIONS, schemaIdentity } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createWorkspaceQueries } = require('../src/modules/fiction/workspace-queries');
const { createOwnerDrafts } = require('../src/modules/fiction/drafts');
const { createFictionSaves, validateSave } = require('../src/modules/fiction/saves');
const { createFictionMedia } = require('../src/modules/fiction/media');
const { createFictionService } = require('../src/modules/fiction/service');
const fixture = path.join(__dirname, 'fixtures/recovery');
describe('bounded historical workspace and private recovery', () => {
  let db, store, queries, drafts, root;
  beforeEach(() => {
    db = createDb(':memory:');
    store = createFictionStore(db);
    queries = createWorkspaceQueries({ db, store });
    drafts = createOwnerDrafts(db);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-b2-'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const start = () => store.create({ scenario_id: 'drowned-bell' });
  test('genuine schema-23 rows and ledger survive upgrade and reopen byte for byte', () => {
    const file = path.join(root, 'old.db');
    fs.copyFileSync(path.join(fixture, 'schema-23.db'), file);
    const baseline = JSON.parse(fs.readFileSync(path.join(fixture, 'baseline.json')));
    let old = createDb(file);
    expect(schemaIdentity(old).version).toBe(24);
    expect(old.prepare('SELECT * FROM schema_migrations WHERE version<=23 ORDER BY version').all()).toEqual(
      baseline.ledger
    );
    expect(
      old.prepare('SELECT initial_state_json FROM fiction_games WHERE id=?').get(baseline.game_id).initial_state_json
    ).toBe(baseline.initial);
    expect(old.prepare('SELECT * FROM fiction_beats WHERE game_id=? ORDER BY rowid').all(baseline.game_id)).toEqual(
      baseline.beats
    );
    const ledger = old.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    old.close();
    old = createDb(file);
    expect(old.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).toEqual(ledger);
    old.close();
  });
  test('an interrupted migration rolls back its schema, projections and ledger', () => {
    const file = path.join(root, 'rollback.db');
    fs.copyFileSync(path.join(fixture, 'schema-23.db'), file);
    const bad = MIGRATIONS.map((m) => ({ ...m }));
    const up = bad[23].up;
    bad[23].up = (handle) => {
      up(handle);
      throw Error('Injected interruption');
    };
    expect(() => createDb(file, { migrations: bad })).toThrow('Injected interruption');
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(file);
    expect(raw.prepare('PRAGMA user_version').get().user_version).toBe(23);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='fiction_owner_drafts'").get()).toBeUndefined();
    raw.close();
    const repaired = createDb(file);
    expect(schemaIdentity(repaired).version).toBe(24);
    repaired.close();
  });
  test('frozen version-1 dependencies match their reviewed manifest and reject invented fields', () => {
    const folder = path.join(__dirname, '../src/modules/fiction/save-v1');
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
    for (const [name, hash] of Object.entries(manifest))
      expect(
        createHash('sha256')
          .update(fs.readFileSync(path.join(folder, name)))
          .digest('hex')
      ).toBe(hash);
    const value = JSON.parse(gunzipSync(fs.readFileSync(path.join(fixture, 'save-v1.inkmorrow5'))));
    expect(() => validateSave(value)).not.toThrow();
    value.game.initial_state.future_field = true;
    expect(() => validateSave(value)).toThrow();
  });
  test('public filtering precedes pagination; timeline, evidence and passage boundaries never activate another path', () => {
    let story = start();
    const opening = story.head_beat_id;
    const home = story.active_branch_id;
    for (let n = 0; n < 85; n++)
      story = store.correct(story.id, story.revision, {
        fact: { id: `hidden-${n}`, kind: 'fact', text: `Hidden ${n}`, visibility: 'secret' },
        reason: 'Private correction'
      });
    story = store.correct(story.id, story.revision, {
      fact: { id: 'promise', kind: 'fact', text: 'A public promise', visibility: 'public' },
      reason: 'Private reason marker'
    });
    const publicHead = story.head_beat_id;
    story=store.preferences(story.id,story.revision,{voice:'Private style only'});
    expect(queries.timeline(story.id,{limit:1}).entries[0].id).toBe(publicHead);
    story = store.fork(story.id, story.revision, { name: 'Sibling', beat_id: opening });
    const sibling = story.active_branch_id;
    story = store.correct(story.id, story.revision, {
      fact: { id: 'sibling', kind: 'fact', text: 'Sibling-only record', visibility: 'public' },
      reason: 'Sibling reason'
    });
    const revision = story.revision;
    const timeline = queries.timeline(story.id, { branch_id: home, limit: 1 });
    expect(timeline.entries[0].id).toBe(publicHead);
    expect(timeline.next_cursor).toBeTruthy();
    const earlier = queries.timeline(story.id, { branch_id: home, limit: 1, cursor: timeline.next_cursor });
    expect(earlier.entries[0].id).toBe(opening);
    expect(earlier.next_cursor).toBeNull();
    expect(() => queries.timeline(story.id, { branch_id: sibling, cursor: timeline.next_cursor })).toThrow(
      'window changed'
    );
    expect(() => queries.evidence(story.id, publicHead, { branch_id: sibling })).toThrow('outside');
    expect(() => queries.passages(story.id, publicHead, { branch_id: home })).toThrow('narrative passage');
    const publicText = JSON.stringify([
      queries.workspace(story.id, { branch_id: home }),
      queries.codex(story.id, { branch_id: home }),
      queries.evidence(story.id, publicHead, { branch_id: home })
    ]);
    expect(publicText).not.toContain('Private reason marker');
    expect(publicText).not.toContain('Hidden 84');
    expect(publicText).not.toContain('Sibling-only record');
    expect(JSON.stringify(queries.planning(story.id, { branch_id: home }))).toContain('Hidden');
    expect(store.view(story.id)).toMatchObject({ revision, active_branch_id: sibling });
    expect(
      queries
        .codex(story.id, { branch_id: home, inspection_at: opening })
        .records.some((r) => r.text === 'A public promise')
    ).toBe(false);
  });
  test('private drafts use compare-and-swap, typed ancestral destinations and an immutable prepared submission', () => {
    let story = start();
    const original = story.active_branch_id;
    const scope = {
      type: 'contribution',
      game_id: story.id,
      branch_id: original,
      head_id: story.head_beat_id,
      kind: 'steer'
    };
    let draft = drafts.create({ scope, content: { text: 'Private direction' } });
    expect(drafts.byScope(scope).id).toBe(draft.id);
    draft = drafts.patch(draft.id, { expected_revision: 1, content: { text: 'Updated private direction' } });
    expect(() => drafts.patch(draft.id, { expected_revision: 1, content: { text: 'Other tab' } })).toThrow(
      'another tab'
    );
    draft = drafts.patch(draft.id, {
      expected_revision: 2,
      submitted: {
        action_key: 'prepared-action',
        target: { game_id: story.id, branch_id: original, head_beat_id: story.head_beat_id, revision: story.revision }
      }
    });
    expect(draft.submitted.content.text).toBe('Updated private direction');
    draft = drafts.patch(draft.id, { expected_revision: 3, content: { text: 'Newer editing' } });
    expect(draft.submitted.content.text).toBe('Updated private direction');
    story = store.fork(story.id, story.revision, { name: 'Separate', beat_id: null });
    story = store.correct(story.id, story.revision, {
      fact: { id: 'other', kind: 'fact', text: 'Other branch', visibility: 'public' },
      reason: 'Local'
    });
    expect(() =>
      drafts.create({ scope: { ...scope, head_id: story.head_beat_id }, content: { text: 'Foreign' } })
    ).toThrow('moment not found');
    drafts.remove(draft.id, draft.revision);
    expect(() => drafts.get(draft.id)).toThrow('unavailable');
  });
  test('version-2 saves keep exact evidence, remap identities, omit private drafts, and import genuine version-1 saves', async () => {
    const media = createFictionMedia({ db, store, rootDir: root });
    const saves = createFictionSaves({ db, store, media });
    let story = start();
    story = store.correct(story.id, story.revision, {
      fact: { id: 'tea', kind: 'commitment', text: 'Mara will bring tea.', visibility: 'public' },
      reason: 'Owner assertion'
    });
    drafts.create({ scope: { type: 'setup', id: 'private-setup' }, content: { title: 'Draft never exported' } });
    const bytes = await saves.exportSave(story.id);
    const value = JSON.parse(gunzipSync(bytes));
    expect(value.version).toBe(2);
    expect(value.evidence).toHaveLength(1);
    expect(JSON.stringify(value)).not.toContain('Draft never exported');
    const imported = await saves.importSave(bytes);
    const importedRows = store.evidenceRecords.rows(imported.id, imported.head_beat_id, true);
    expect(importedRows[0].sha256).toBe(value.evidence[0].sha256);
    expect(importedRows[0].beat_id).not.toBe(value.evidence[0].beat_id);
    value.evidence[0].quote = 'Invented quote';
    await expect(saves.importSave(gzipSync(JSON.stringify(value)))).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    expect((await saves.importSave(fs.readFileSync(path.join(fixture, 'save-v1.inkmorrow5')))).title).toBeTruthy();
  });
  test('accepted new prose stores exact source bytes and Ask does not create a narrative passage', async () => {
    let story = start();
    const complete = jest
      .fn()
      .mockResolvedValue({
        content: JSON.stringify({
          prose: 'Mara brings tea to the quay.',
          summary: 'Tea arrives.',
          effects: [
            {
              op: 'remember',
              fact: { id: 'arrived', kind: 'fact', text: 'Tea has arrived.', visibility: 'public' },
              evidence: 'Mara brings tea'
            }
          ]
        }),
        cost_usd: 0,
        billed_attempts: 1
      });
    const service = createFictionService({ store, chatCompletion: complete });
    story = (
      await service.reply({
        gameId: story.id,
        expectedRevision: story.revision,
        idempotencyKey: 'precise',
        input: { kind: 'follow' }
      })
    ).story;
    const result = queries.evidence(story.id, story.head_beat_id);
    expect(result.sources[0].quote).toBe('Mara brings tea');
    expect(result.sources[0].sha256).toBe(createHash('sha256').update('Mara brings tea to the quay.').digest('hex'));
    complete.mockResolvedValue({
      content: JSON.stringify({ prose: 'The public quay is quiet.', summary: 'A clarification.', effects: [] }),
      cost_usd: 0,
      billed_attempts: 1
    });
    story = (
      await service.reply({
        gameId: story.id,
        expectedRevision: story.revision,
        idempotencyKey: 'ask',
        input: { kind: 'ask', text: 'Where are we?' }
      })
    ).story;
    expect(() => queries.passages(story.id, story.head_beat_id)).toThrow('narrative passage');
  });
  test('authenticated recovery routes require CSRF and cancellation fences prevent delayed purchases', async () => {
    const request = require('supertest');
    const { createTestApp, setupOwner } = require('./helpers');
    const fixture = createTestApp({ authRequired: true, legacyEnabled: false });
    try {
      const agent = request.agent(fixture.app);
      const owner = await setupOwner(agent, fixture.app);
      const headers = { 'X-InkMorrow-CSRF': owner.csrf_token };
      await request(fixture.app).get('/api/fiction/drafts').expect(401);
      await agent
        .post('/api/fiction/drafts')
        .send({ scope: { type: 'setup', id: 'setup' }, content: { title: 'Private' } })
        .expect(403);
      const created = await agent.post('/api/fiction').set(headers).send({ scenario_id: 'drowned-bell' }).expect(201);
      const story = created.body.story;
      const response = await agent.get(`/api/fiction/${story.id}/planning`).expect(200);
      expect(response.headers['cache-control']).toContain('no-store');
      const status = await agent.get(`/api/fiction/actions/not-dispatched?game_id=${story.id}`).expect(200);
      expect(status.body).toMatchObject({ status: 'unknown', can_start_new: false });
      await agent
        .post('/api/fiction/actions/not-dispatched/cancel')
        .set(headers)
        .send({ game_id: story.id })
        .expect(200);
      const rejected = await agent
        .post(`/api/fiction/${story.id}/replies`)
        .set(headers)
        .send({ expected_revision: story.revision, idempotency_key: 'not-dispatched', input: { kind: 'follow' } })
        .expect(409);
      expect(rejected.body.code).toBe('STORY_ACTION_CANCELLED');
      expect(fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n).toBe(0);
    } finally {
      fixture.close();
    }
  });
  test('exact setup creation consumes one acknowledged draft and import retries recover one copy', async () => {
    const payload = { title: 'One new story', premise: 'A quiet harbour.' };
    let draft = drafts.create({ scope: { type: 'setup', id: 'new' }, content: payload });
    draft = drafts.patch(draft.id, {
      expected_revision: draft.revision,
      submitted: { action_key: 'create-once', target: { purpose: 'story-creation' } }
    });
    const action = { draft_id: draft.id, draft_revision: draft.revision, action_key: 'create-once' };
    const command = drafts.prepareCreation('story', action, payload);
    const story = store.create(payload, { onCreated: command.finish });
    expect(drafts.lastCreation({type:'setup',id:'new'})).toMatchObject({result_id:story.id,action_key:'create-once'});
    expect(drafts.prepareCreation('story', action, payload)).toEqual({ replayed: true, result_id: story.id });
    expect(() => drafts.get(draft.id)).toThrow('unavailable');
    expect(() => drafts.prepareCreation('story', action, { ...payload, title: 'Changed' })).toThrow(
      'different content'
    );
    const media = createFictionMedia({ db, store, rootDir: root });
    const saves = createFictionSaves({ db, store, media });
    const bytes = await saves.exportSave(story.id);
    const first = await saves.importSave(bytes, 'one-import');
    const replay = await saves.importSave(bytes, 'one-import');
    expect(replay.id).toBe(first.id);
    expect(store.list()).toHaveLength(2);
  });
});
