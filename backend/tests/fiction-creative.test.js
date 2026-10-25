'use strict';
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createDb, schemaIdentity } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionSaves } = require('../src/modules/fiction/saves');
const { createFictionService } = require('../src/modules/fiction/service');
const {
  createGenerationPlans,
} = require('../src/modules/fiction/generation-plan');
const { createOwnerDrafts } = require('../src/modules/fiction/drafts');
describe('story-local creative authority', () => {
  let db, store, story;
  beforeEach(() => {
    db = createDb(':memory:');
    store = createFictionStore(db);
    story = store.create({ scenario_id: 'drowned-bell' });
  });
  afterEach(() => db.close());
  const target = (key, extra = {}) => ({
    action_key: key,
    expected_revision: story.revision,
    target_branch_id: story.active_branch_id,
    expected_head_beat_id: story.head_beat_id,
    ...extra,
  });
  test('schema-24 baseline bytes and ledger survive the appended migration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-old-'));
    try {
      const file = path.join(root, 'old.db');
      fs.copyFileSync(
        path.join(__dirname, 'fixtures/recovery/schema-24.db'),
        file,
      );
      const baseline = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, 'fixtures/recovery/baseline-24.json'),
        ),
      );
      const old = createDb(file);
      expect(schemaIdentity(old).version).toBe(25);
      expect(
        old
          .prepare(
            'SELECT * FROM schema_migrations WHERE version<=24 ORDER BY version',
          )
          .all(),
      ).toEqual(baseline.ledger);
      expect(
        old
          .prepare('SELECT * FROM fiction_beats WHERE game_id=? ORDER BY rowid')
          .all(baseline.game_id),
      ).toEqual(baseline.beats);
      old.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('local configuration is immutable, branch scoped, replayable and independent of pacing', () => {
    const opening = story.head_beat_id;
    const action = target('extended', {
      expected_config_id: null,
      patch: {
        length: {
          preset: 'extended',
          target: 800,
          unit: 'words',
          definition_version: 1,
        },
      },
    });
    story = store.creativeRecords.configure(story.id, action).story;
    expect(story.state.creative.length.target).toBe(800);
    expect(() =>
      db.prepare("UPDATE fiction_config_revisions SET value_json='{}'").run(),
    ).toThrow('immutable');
    story = store.preferences(story.id, story.revision, { pacing: 'brisk' });
    expect(story.state.creative.length.target).toBe(800);
    expect(
      store.creativeRecords.configure(story.id, action).result.replayed,
    ).toBe(true);
    story = store.fork(story.id, story.revision, {
      name: 'Before the setting',
      beat_id: opening,
    });
    expect(story.state.creative.length.preset).toBe('developed');
  });
  test('only selected reference fields change and narrative facts remain untouched', () => {
    const before = JSON.stringify(store.current(story.id).state.facts);
    const prior = store.creativeRecords.reference(
      story.id,
      store.current(story.id).state,
      'character',
      'mara',
    );
    const proposed = {
      ...prior,
      description: 'An impatient archivist.',
      data: {
        ...prior.data,
        motive: 'PRIVATE new wish',
        background: 'PRIVATE proposed backstory',
      },
    };
    story = store.creativeRecords.adopt(
      story.id,
      target('motive', {
        kind: 'character',
        subject_id: 'mara',
        expected_reference_id: null,
        proposed,
        selected_fields: ['data.motive'],
        acknowledge_overlaps: true,
      }),
    ).story;
    expect(story.state.cast[0].description).not.toBe(proposed.description);
    expect(JSON.stringify(story)).not.toContain('PRIVATE new wish');
    const effective = store.effectiveState(
      story.id,
      store.current(story.id).state,
    );
    expect(effective.cast[0].motive).toBe('PRIVATE new wish');
    expect(JSON.stringify(store.current(story.id).state.facts)).toBe(before);
  });
  test('a proposed scene does not move cast, reveal knowledge or complete facts', () => {
    const before = JSON.stringify(store.current(story.id).state.facts);
    story = store.creativeRecords.configure(
      story.id,
      target('scene', {
        expected_config_id: null,
        patch: {
          scene_plan: {
            location: 'Winter castle',
            time: 'Tomorrow',
            present_ids: ['mara'],
            purpose: 'Ask for shelter',
            notes: 'A proposal only',
          },
        },
      }),
    ).story;
    expect(store.current(story.id).state.scene_frame).toBeUndefined();
    expect(JSON.stringify(story)).not.toContain('Winter castle');
    expect(JSON.stringify(store.current(story.id).state.facts)).toBe(before);
  });
  test('creative save copies remap heads and preserve genuine B2 saves', async () => {
    story = store.creativeRecords.configure(
      story.id,
      target('save', {
        expected_config_id: null,
        patch: { perspective: 'close-third', focal_id: 'mara' },
      }),
    ).story;
    const saves = createFictionSaves({
      db,
      store,
      media: {
        read() {
          throw Error('No fixture images');
        },
      },
    });
    const bytes = await saves.exportSave(story.id);
    const original = store.current(story.id).state.config_revision_id;
    const imported = await saves.importSave(bytes);
    expect(imported.state.creative.perspective).toBe('close-third');
    expect(store.current(imported.id).state.config_revision_id).not.toBe(
      original,
    );
    expect(
      (
        await saves.importSave(
          fs.readFileSync(
            path.join(__dirname, 'fixtures/recovery/save-b2-v2.inkmorrow5'),
          ),
        )
      ).title,
    ).toBeTruthy();
  });
  test('recent context survives many intervening local records and length is explicit', () => {
    for (let n = 0; n < 20; n++)
      story = store.preferences(story.id, story.revision, {
        voice: 'Tone ' + n,
      });
    const service = createFictionService({ store, chatCompletion: jest.fn() });
    const data = JSON.parse(
      service.buildMessages(store.current(story.id), {
        kind: 'follow',
        text: '',
      })[1].content,
    );
    expect(data.recent).toHaveLength(1);
    expect(data.recent[0].kind).toBe('opening');
    expect(data.creative_settings.length.target).toBe(400);
  });
  test('incomplete perspective fails before any provider call', async () => {
    story = store.creativeRecords.configure(
      story.id,
      target('speaker', {
        expected_config_id: null,
        patch: {
          perspective: 'first-person',
          speaker_id: null,
          framing_narrator: '',
        },
      }),
    ).story;
    const complete = jest.fn();
    const service = createFictionService({ store, chatCompletion: complete });
    await expect(
      service.reply({
        gameId: story.id,
        expectedRevision: story.revision,
        idempotencyKey: 'incomplete',
        input: { kind: 'follow' },
      }),
    ).rejects.toMatchObject({ code: 'CREATIVE_IDENTITY_MISSING' });
    expect(complete).not.toHaveBeenCalled();
  });
  test('unknown or insufficient model capacity blocks preparation without purchasing', () => {
    const service = createFictionService({ store, chatCompletion: jest.fn() });
    const context = store.current(story.id),
      intent = { kind: 'follow', text: '' };
    const messages = service.buildMessages(context, intent);
    const unknown = createGenerationPlans({
      db,
      providers: {
        exposure: (role) => ({ role, provider: null, model_id: null }),
        resolve: () => ({ modelLimits: null }),
      },
    });
    expect(() => unknown.build(context, intent, messages)).toThrow(
      'capacity is unknown',
    );
    const small = createGenerationPlans({
      db,
      providers: {
        exposure: (role) => ({ role, provider: null, model_id: null }),
        resolve: () => ({
          modelLimits: {
            context_tokens: 4096,
            output_tokens: 1024,
            source: 'owner',
          },
        }),
      },
    });
    expect(() => small.build(context, intent, messages)).toThrow(
      'does not fit',
    );
    expect(store.view(story.id).spend.known_usd).toBe(0);
  });
  test('local-reference drafts bind their base and survive conflicts without affecting canon', () => {
    const drafts = createOwnerDrafts(db);
    const state = store.current(story.id).state;
    const scope = {
      type: 'local-reference',
      game_id: story.id,
      branch_id: story.active_branch_id,
      head_id: story.head_beat_id,
      kind: 'character',
      subject_id: 'mara',
      base_revision: null,
    };
    const draft = drafts.create({
      scope,
      content: {
        form: store.creativeRecords.reference(
          story.id,
          state,
          'character',
          'mara',
        ),
        selected_fields: [],
      },
    });
    expect(drafts.get(draft.id).scope).toEqual(scope);
    expect(() =>
      drafts.patch(draft.id, { expected_revision: 0, content: draft.content }),
    ).toThrow('another tab');
    expect(store.view(story.id).revision).toBe(story.revision);
  });
  test('an interrupted schema-25 migration leaves schema 24 intact and can reopen', () => {
    const { MIGRATIONS } = require('../src/db');
    const { DatabaseSync } = require('node:sqlite');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-rollback-'));
    try {
      const file = path.join(root, 'story.db');
      fs.copyFileSync(
        path.join(__dirname, 'fixtures/recovery/schema-24.db'),
        file,
      );
      const migrations = MIGRATIONS.map((row) => ({ ...row }));
      const last = migrations.at(-1);
      const up = last.up;
      last.up = (handle) => {
        up(handle);
        throw Error('Interrupted B3');
      };
      expect(() => createDb(file, { migrations })).toThrow('Interrupted B3');
      const raw = new DatabaseSync(file);
      expect(raw.prepare('PRAGMA user_version').get().user_version).toBe(24);
      expect(
        raw
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='fiction_config_revisions'",
          )
          .get(),
      ).toBeUndefined();
      raw.close();
      const reopened = createDb(file);
      expect(schemaIdentity(reopened).version).toBe(25);
      reopened.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
