'use strict';
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { gunzipSync } = require('node:zlib');
const request = require('supertest');
const { createDb, MIGRATIONS, schemaIdentity } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const {
  createWorkspaceQueries,
} = require('../src/modules/fiction/workspace-queries');
const { createEditorial } = require('../src/modules/fiction/editorial');
const {
  createFictionSaves,
  validateSave,
} = require('../src/modules/fiction/saves');
const { createFictionService } = require('../src/modules/fiction/service');
const {
  createFictionPublication,
} = require('../src/modules/fiction/publication');
const { createOwnerDrafts } = require('../src/modules/fiction/drafts');
const { defaultLayout } = require('../src/modules/fiction/editorial-model');
const { createTestApp } = require('./helpers');
describe('B4 editorial organization on immutable fiction', () => {
  let db, store, queries, editorial, story, service, complete, n;
  beforeEach(() => {
    db = createDb(':memory:');
    store = createFictionStore(db);
    queries = createWorkspaceQueries({ db, store });
    editorial = createEditorial({ db, store, queries });
    story = store.create({ scenario_id: 'garden-after-rain' });
    complete = jest.fn();
    service = createFictionService({ store, chatCompletion: complete });
    n = 0;
  });
  afterEach(() => db.close());
  const target = (layout, extra = {}) => ({
    action_key: 'editorial-' + ++n,
    expected_revision: story.revision,
    target_branch_id: story.active_branch_id,
    expected_head_beat_id: story.head_beat_id,
    expected_editorial_id:
      store.current(story.id).state.editorial_revision_id || null,
    layout,
    ...extra,
  });
  const save = () => createFictionSaves({ db, store, media: {} });
  const value = async () =>
    JSON.parse(gunzipSync(await save().exportSave(story.id)));
  async function scene(prose) {
    complete.mockResolvedValueOnce({
      content: JSON.stringify({
        response_version: 2,
        prose,
        summary: prose,
        effects: [],
      }),
      cost_usd: 0,
      billed_attempts: 1,
    });
    story = (
      await service.reply({
        gameId: story.id,
        expectedRevision: story.revision,
        idempotencyKey: 'scene-' + ++n,
        input: { kind: 'follow' },
      })
    ).story;
  }
  function apply(layout) {
    story = editorial.apply(story.id, target(layout)).story;
    return story;
  }
  test('schema 25 migrates byte-for-byte and interrupted schema 26 rolls back cleanly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-preserve-'));
    try {
      const file = path.join(root, 'old.db');
      fs.copyFileSync(
        path.join(__dirname, 'fixtures/recovery/schema-25.db'),
        file,
      );
      const baseline = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, 'fixtures/recovery/baseline-25.json'),
        ),
      );
      const migrations = MIGRATIONS.map((row) => ({ ...row }));
      const last = migrations.at(-1),
        up = last.up;
      last.up = (handle) => {
        up(handle);
        throw Error('Interrupted editorial migration');
      };
      expect(() => createDb(file, { migrations })).toThrow(
        'Interrupted editorial migration',
      );
      const { DatabaseSync } = require('node:sqlite');
      const raw = new DatabaseSync(file);
      expect(raw.prepare('PRAGMA user_version').get().user_version).toBe(25);
      expect(
        raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='fiction_editorial_revisions'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='fiction_editorial_passages'",
          )
          .get(),
      ).toBeUndefined();
      raw.close();
      let migrated = createDb(file);
      expect(schemaIdentity(migrated).version).toBe(26);
      expect(
        migrated
          .prepare(
            'SELECT * FROM schema_migrations WHERE version<=25 ORDER BY version',
          )
          .all(),
      ).toEqual(baseline.ledger);
      expect(
        migrated
          .prepare('SELECT initial_state_json FROM fiction_games WHERE id=?')
          .get(baseline.game_id).initial_state_json,
      ).toBe(baseline.initial_state);
      expect(
        migrated
          .prepare('SELECT * FROM fiction_beats WHERE game_id=? ORDER BY rowid')
          .all(baseline.game_id),
      ).toEqual(baseline.beats);
      migrated.close();
      migrated = createDb(file);
      expect(schemaIdentity(migrated).version).toBe(26);
      migrated.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('virtual episode layout preserves current book structure until adoption', async () => {
    await scene('Jo waters the seedlings.');
    story = store.episode(story.id, story.revision, { action: 'end' });
    story = store.episode(story.id, story.revision, {
      action: 'start',
      title: 'The next morning',
    });
    await scene('Nell returns with fresh labels.');
    const before = JSON.stringify(store.current(story.id).state);
    const data = editorial.inspect(story.id);
    expect(data.virtual).toBe(true);
    expect(data.groups.map((group) => group.count)).toEqual([2, 1]);
    const document = createFictionPublication({ store, media: {} }).document(
      story.id,
    );
    expect(
      document.volumes[0].chapters.map((chapter) => chapter.title),
    ).toEqual(data.groups.map((group) => group.title));
    expect(JSON.stringify(store.current(story.id).state)).toBe(before);
    expect(
      db.prepare('SELECT count(*) AS n FROM fiction_editorial_revisions').get()
        .n,
    ).toBe(0);
  });
  test('adoption is immutable, idempotent, public bookkeeping and changes no facts or prose', () => {
    const before = store.current(story.id).state;
    const oldBeat = story.head_beat_id;
    const layout = editorial.inspect(story.id).layout;
    layout.chapters[0].title = 'Seedlings and tea';
    const command = target(layout);
    story = editorial.apply(story.id, command).story;
    expect(store.current(story.id).state.facts).toEqual(before.facts);
    expect(store.current(story.id).state.episode).toEqual(before.episode);
    expect(story.beats.find((beat) => beat.id === oldBeat).prose).toContain(
      'Jo',
    );
    expect(() =>
      db
        .prepare("UPDATE fiction_editorial_revisions SET value_json='{}'")
        .run(),
    ).toThrow('immutable');
    expect(editorial.apply(story.id, command).result.replayed).toBe(true);
    expect(
      db.prepare('SELECT count(*) AS n FROM fiction_editorial_revisions').get()
        .n,
    ).toBe(1);
    expect(queries.timeline(story.id).entries[0].record_type).toBe('editorial');
    expect(queries.timeline(story.id).entries[0].is_narrative).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(JSON.stringify(story)).not.toContain('editorial_revision_id');
  });
  test('two volumes keep contiguous ranges and new prose joins only the open tail', async () => {
    const first = story.head_beat_id;
    await scene('Jo makes a label.');
    const second = story.head_beat_id;
    await scene('Nell sets out tea.');
    let layout = editorial.inspect(story.id).layout;
    layout.volumes.push({ id: 'second-volume', title: 'After the rain' });
    layout.chapters[0] = {
      ...layout.chapters[0],
      title: 'The gate',
      through_beat_id: second,
      open_tail: false,
    };
    layout.chapters.push({
      id: 'tea-chapter',
      title: 'Room for tea',
      volume_id: 'second-volume',
      after_beat_id: second,
      through_beat_id: null,
      open_tail: true,
    });
    apply(layout);
    expect(
      editorial.inspect(story.id).groups.map((group) => group.count),
    ).toEqual([2, 1]);
    await scene('Samir pours the tea.');
    expect(
      editorial.inspect(story.id).groups.map((group) => group.count),
    ).toEqual([2, 2]);
    const doc = createFictionPublication({ store, media: {} }).document(
      story.id,
    );
    expect(doc.volumes.map((volume) => volume.title)).toEqual([
      story.title,
      'After the rain',
    ]);
    expect(doc.volumes[0].chapters[0].pages).toHaveLength(2);
    expect(doc.volumes[1].chapters[0].pages).toHaveLength(2);
    expect(editorial.inspect(story.id, { inspection_at: first }).virtual).toBe(
      true,
    );
  });
  test('empty plans and gaps never hide prose or create fake passages', async () => {
    const first = story.head_beat_id;
    await scene('Jo watches the rain.');
    const latest = story.head_beat_id;
    const layout = editorial.inspect(story.id).layout;
    layout.chapters = [
      {
        ...layout.chapters[0],
        title: 'Empty plan',
        after_beat_id: first,
        through_beat_id: first,
        open_tail: false,
      },
      {
        ...layout.chapters[0],
        id: 'future-tail',
        title: 'Later',
        after_beat_id: latest,
        through_beat_id: null,
        open_tail: true,
      },
    ];
    apply(layout);
    const groups = editorial.inspect(story.id).groups;
    expect(groups.map((group) => group.count)).toEqual([1, 0, 1, 0]);
    expect(groups.filter((group) => group.automatic)).toHaveLength(2);
    const doc = createFictionPublication({ store, media: {} }).document(
      story.id,
    );
    expect(
      doc.volumes
        .flatMap((volume) => volume.chapters)
        .flatMap((chapter) => chapter.pages),
    ).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toContain('Empty plan');
    await scene('A new morning begins.');
    expect(editorial.inspect(story.id).groups.at(-1).count).toBe(1);
  });
  test('forks inherit only applicable grouping and never a sibling future', async () => {
    const before = story.head_beat_id;
    const layout = editorial.inspect(story.id).layout;
    layout.chapters[0].title = 'Adopted';
    apply(layout);
    const adopted = story.head_beat_id,
      original = story.active_branch_id;
    await scene('A future on the original path.');
    const future = story.head_beat_id;
    story = store.fork(story.id, story.revision, {
      beat_id: adopted,
      name: 'Alternative',
    });
    await scene('A different future.');
    const alternate = editorial.inspect(story.id);
    expect(alternate.layout.chapters[0].title).toBe('Adopted');
    expect(alternate.groups.at(-1).last_beat_id).not.toBe(future);
    story = store.selectBranch(story.id, story.revision, original);
    story = store.fork(story.id, story.revision, {
      beat_id: before,
      name: 'Before adoption',
    });
    expect(editorial.inspect(story.id).virtual).toBe(true);
    expect(() =>
      editorial.apply(
        story.id,
        target({
          ...layout,
          chapters: [{ ...layout.chapters[0], after_beat_id: future }],
        }),
      ),
    ).toThrow('not a narrative passage');
  });
  test('overlap, chronological reorder, future/non-narrative anchors and stale targets are refused', async () => {
    await scene('A quiet moment.');
    const base = editorial.inspect(story.id).layout;
    const invalid = structuredClone(base);
    invalid.chapters[0].open_tail = false;
    invalid.chapters[0].through_beat_id = story.head_beat_id;
    invalid.chapters.push({ ...base.chapters[0], id: 'overlap' });
    expect(() => editorial.apply(story.id, target(invalid))).toThrow('overlap');
    const action = target(base);
    story = store.preferences(story.id, story.revision, {
      voice: 'A quiet voice.',
    });
    expect(() => editorial.apply(story.id, action)).toThrow('changed');
    const localHead = story.head_beat_id;
    expect(() =>
      editorial.apply(
        story.id,
        target({
          ...base,
          chapters: [{ ...base.chapters[0], after_beat_id: localHead }],
        }),
      ),
    ).toThrow('not a narrative passage');
  });
  test('save copies remap anchors and revision heads, while genuine B3 saves remain playable', async () => {
    await scene('Jo makes room for a visitor.');
    const layout = editorial.inspect(story.id).layout;
    layout.chapters[0].after_beat_id = story.beats[0].id;
    apply(layout);
    const original = store.current(story.id).state.editorial_revision_id;
    const copy = await save().importSave(await save().exportSave(story.id));
    expect(store.current(copy.id).state.editorial_revision_id).not.toBe(
      original,
    );
    expect(
      editorial.inspect(copy.id).layout.chapters[0].after_beat_id,
    ).not.toBe(layout.chapters[0].after_beat_id);
    expect(
      editorial.inspect(copy.id).groups.map((group) => group.count),
    ).toEqual(editorial.inspect(story.id).groups.map((group) => group.count));
    const legacy = await save().importSave(
      fs.readFileSync(
        path.join(__dirname, 'fixtures/recovery/save-b3-v2.inkmorrow5'),
      ),
    );
    expect(editorial.inspect(legacy.id).virtual).toBe(true);
    story = legacy;
    const legacyRows = db
      .prepare('SELECT * FROM fiction_beats WHERE game_id=? ORDER BY rowid')
      .all(story.id);
    const adopted = editorial.inspect(story.id).layout;
    adopted.chapters[0].title = 'A B3 story organized in B4';
    apply(adopted);
    expect(
      (await save().importSave(await save().exportSave(story.id))).title,
    ).toBe(legacy.title);
    for (const row of legacyRows)
      expect(
        db.prepare('SELECT * FROM fiction_beats WHERE id=?').get(row.id),
      ).toEqual(row);
  });
  test('tampered collection parents, anchors, heads, operations and canonical effects cannot import', async () => {
    apply(editorial.inspect(story.id).layout);
    await scene('The garden grows quiet.');
    const valid = await value();
    expect(() => validateSave(valid)).not.toThrow();
    for (const mutate of [
      (v) => (v.editorial.revisions[0].parent_id = v.editorial.revisions[0].id),
      (v) =>
        (v.editorial.revisions[0].value.chapters[0].after_beat_id =
          v.beats.at(-1).id),
      (v) => (v.beats.at(-1).state.editorial_revision_id = null),
      (v) => (v.editorial.revisions[0].value.chapters[0].mystery = 'unknown'),
      (v) =>
        (v.beats.find(
          (beat) => beat.id === v.editorial.revisions[0].beat_id,
        ).input.operation = 'metadata'),
      (v) =>
        v.beats
          .find((beat) => beat.id === v.editorial.revisions[0].beat_id)
          .changes.push({
            op: 'remember',
            fact: v.game.initial_state.facts[0],
          }),
      (v) =>
        v.editorial.revisions.push({
          ...v.editorial.revisions[0],
          id: 'orphan',
        }),
    ]) {
      const bad = structuredClone(valid);
      mutate(bad);
      expect(() => validateSave(bad)).toThrow();
    }
  });
  test('private layout drafts bind their base and tolerate incomplete fields without canonical changes', () => {
    const drafts = createOwnerDrafts(db);
    const layout = editorial.inspect(story.id).layout;
    layout.chapters[0].title = '';
    const scope = {
      type: 'local-reference',
      kind: 'editorial',
      subject_id: null,
      game_id: story.id,
      branch_id: story.active_branch_id,
      head_id: story.head_beat_id,
      base_revision: null,
    };
    const draft = drafts.create({
      scope,
      content: { form: layout, base_revision: null },
    });
    expect(drafts.get(draft.id).content.form.chapters[0].title).toBe('');
    expect(editorial.inspect(story.id).virtual).toBe(true);
    expect(() =>
      drafts.create({
        scope: { ...scope, base_revision: 'wrong-base' },
        content: { form: layout },
      }),
    ).toThrow('base');
  });
  test('lost-response receipts and cancellation fences prevent duplicate or delayed local changes', () => {
    const layout = editorial.inspect(story.id).layout,
      command = target(layout);
    expect(
      store.creativeRecords.status(story.id, command.action_key).status,
    ).toBe('unknown');
    store.creativeRecords.cancel(story.id, command.action_key);
    expect(() => editorial.apply(story.id, command)).toThrow('cancelled');
    const action = target(layout);
    story = editorial.apply(story.id, action).story;
    expect(
      store.creativeRecords.status(story.id, action.action_key).status,
    ).toBe('succeeded');
    expect(editorial.apply(story.id, action).result.replayed).toBe(true);
  });
  test('an empty planned story creates no narrative and frozen documents retain earlier headings', async () => {
    const book = createFictionPublication({ store, media: {} });
    const before = JSON.stringify(book.document(story.id));
    const layout = editorial.inspect(story.id).layout;
    layout.chapters[0].title = 'A new edition heading';
    apply(layout);
    expect(JSON.stringify(book.document(story.id))).not.toBe(before);
    expect(before).not.toContain('A new edition heading');
    story = store.create({
      title: 'A planned story',
      premise: 'A room before the arrival.',
    });
    expect(editorial.inspect(story.id).passage_count).toBe(0);
    apply(editorial.inspect(story.id).layout);
    expect(editorial.inspect(story.id).groups[0].count).toBe(0);
    expect(() => book.document(story.id)).toThrow('Continue');
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM fiction_beats WHERE game_id=? AND kind IN ('opening','scene')",
        )
        .get(story.id).n,
    ).toBe(0);
    const portable = await value();
    expect(() => validateSave(portable)).not.toThrow();
  });
  test('outline and passage paging remain pinned when a newer episode arrives', async () => {
    for (let index = 1; index <= 80; index++) {
      story = store.episode(story.id, story.revision, { action: 'end' });
      story = store.episode(story.id, story.revision, {
        action: 'start',
        title: 'Episode ' + index,
      });
      await scene('Moment ' + index + ' in the garden.');
    }
    const first = editorial.inspect(story.id, { outline: '1' });
    expect(first.groups).toHaveLength(80);
    expect(first.next_offset).toBe(80);
    const choices = editorial.passages(story.id);
    expect(choices.passages).toHaveLength(80);
    expect(choices.next_offset).toBe(80);
    story = store.episode(story.id, story.revision, { action: 'end' });
    story = store.episode(story.id, story.revision, {
      action: 'start',
      title: 'A later episode',
    });
    await scene('A later moment outside the pinned outline.');
    const last = editorial.inspect(story.id, {
      outline: '1',
      offset: first.next_offset,
      branch_id: first.view_branch_id,
      inspection_at: first.inspection_head_id,
    });
    expect(last.groups).toHaveLength(1);
    expect(last.groups[0].title).toBe('Episode 80');
    expect(last.groups[0].count).toBe(1);
    expect(last.next_offset).toBeNull();
    expect(
      editorial.passages(story.id, { q: 'Moment 80' }).passages,
    ).toHaveLength(1);
  }, 20000);
  test('large automatic layouts preserve book structure without applying new-record limits', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      id: 'p-' + index,
      kind: 'scene',
      prose: 'A moment.',
      episode_number: index,
      episode_title: 'Episode ' + index,
    }));
    const state = store.current(story.id).state;
    const virtual = store.editorialValue(story.id, state, rows, story.title);
    expect(virtual.groups).toHaveLength(600);
    expect(defaultLayout(rows, story.title).chapters).toHaveLength(600);
    expect(
      createFictionPublication({
        store: { ...store, publicationRows: () => rows },
        media: {},
      }).document(story.id).volumes[0].chapters,
    ).toHaveLength(600);
  });
});
test('editorial inspection and commands use the authenticated production route', async () => {
  const locked = createTestApp({ authRequired: true, legacyEnabled: false });
  try {
    expect(
      (await request(locked.app).get('/api/fiction/missing/editorial')).status,
    ).toBe(401);
  } finally {
    locked.close();
  }
  const fixture = createTestApp({ legacyEnabled: false });
  try {
    let story = (
      await request(fixture.app)
        .post('/api/fiction')
        .send({ scenario_id: 'garden-after-rain' })
    ).body.story;
    const layout = (
      await request(fixture.app).get(`/api/fiction/${story.id}/editorial`)
    ).body.layout;
    layout.chapters[0].title = 'A changed chapter';
    const input = {
      expected_revision: story.revision,
      target_branch_id: story.active_branch_id,
      expected_head_beat_id: story.head_beat_id,
      layout,
    };
    expect(
      (
        await request(fixture.app)
          .post(`/api/fiction/${story.id}/editorial/preview`)
          .send(input)
      ).status,
    ).toBe(200);
    const saved = await request(fixture.app)
      .post(`/api/fiction/${story.id}/commands/editorial`)
      .send({
        ...input,
        action_key: 'production-editorial',
        expected_editorial_id: null,
      });
    expect(saved.status).toBe(200);
    story = saved.body.story;
    expect(story.generation).toBeDefined();
    expect(
      (
        await request(fixture.app).get(
          `/api/fiction/${story.id}/editorial?outline=1`,
        )
      ).body.groups[0].title,
    ).toBe('A changed chapter');
    expect(
      (await request(fixture.app).get(`/api/fiction/${story.id}/book/json`))
        .body.volumes[0].chapters[0].title,
    ).toBe('A changed chapter');
    expect(
      fixture.db.prepare('SELECT count(*) AS n FROM fiction_requests').get().n,
    ).toBe(0);
  } finally {
    fixture.close();
  }
});
