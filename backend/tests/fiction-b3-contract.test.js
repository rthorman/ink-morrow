'use strict';
const { gunzipSync } = require('node:zlib');
const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const {
  createFictionSaves,
  validateSave,
} = require('../src/modules/fiction/saves');
const {
  createGenerationPlans,
} = require('../src/modules/fiction/generation-plan');
const { chooseScene, recordScene } = require('../src/modules/fiction/director');
const { inputBound } = require('../src/modules/fiction/context-compiler');
const {
  assemble,
  validateAssembly,
  sha,
} = require('../src/modules/fiction/narrative-assembly');
describe('B3 narrative and portable authority contracts', () => {
  let db, store, story, complete, service, sequence;
  beforeEach(() => {
    db = createDb(':memory:');
    store = createFictionStore(db);
    story = store.create({ scenario_id: 'drowned-bell' });
    complete = jest.fn();
    service = createFictionService({ store, chatCompletion: complete });
    sequence = 0;
  });
  afterEach(() => db.close());
  const target = (extra = {}) => ({
    action_key: 'local-' + ++sequence,
    expected_revision: story.revision,
    target_branch_id: story.active_branch_id,
    expected_head_beat_id: story.head_beat_id,
    ...extra,
  });
  async function reply(candidate, input = { kind: 'follow' }) {
    complete.mockResolvedValueOnce({
      content: JSON.stringify({
        response_version: 2,
        summary: 'A moment.',
        effects: [],
        ...candidate,
      }),
      cost_usd: 0.01,
      billed_attempts: 1,
    });
    const result = await service.reply({
      gameId: story.id,
      expectedRevision: story.revision,
      idempotencyKey: 'narration-' + ++sequence,
      input,
    });
    story = result.story;
    return result;
  }
  const saves = () => createFictionSaves({ db, store, media: {} });
  const exported = async () =>
    JSON.parse(gunzipSync(await saves().exportSave(story.id)));
  test.each(['performed', 'attempted', 'interrupted', 'not-performed'])(
    'Say %s has exact, portable source assembly',
    async (status) => {
      story = store.control(story.id, story.revision, 'mara');
      const words = 'I will bring the blue kettle.';
      const prose =
        status === 'performed'
          ? 'Mara takes her turn.\n\nIona listens.'
          : 'The harbour horn prevents Mara from speaking.';
      await reply(
        {
          prose,
          speech_performance: {
            status,
            evidence: status === 'performed' ? 'Mara takes her turn.' : prose,
            ...(status === 'performed' ? { paragraph_index: 1 } : {}),
          },
        },
        { kind: 'say', text: words },
      );
      const beat = story.beats.at(-1);
      expect(beat.prose.split(words).length - 1).toBe(
        status === 'performed' ? 1 : 0,
      );
      const value = await exported();
      expect(() => validateSave(value)).not.toThrow();
      const copy = await saves().importSave(await saves().exportSave(story.id));
      expect(copy.beats.at(-1).prose).toBe(beat.prose);
      const manifest = value.creative.assemblies.find(
        (row) => row.beat_id === beat.id,
      ).manifest;
      expect(manifest.speech.status).toBe(status);
      manifest.speech.speaker_id = 'iona';
      expect(() => validateSave(value)).toThrow('speech source');
    },
  );
  test('Say without a declared occurrence fails and does not retry', async () => {
    story = store.control(story.id, story.revision, 'mara');
    await expect(
      reply({ prose: 'Mara pauses.' }, { kind: 'say', text: 'Bring tea.' }),
    ).rejects.toMatchObject({
      code: 'INVALID_SPEECH_PERFORMANCE',
      billedAttempts: 1,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  test('speech cannot be duplicated by the model or moved after export', async () => {
    story = store.control(story.id, story.revision, 'mara');
    const intent = {
      kind: 'say',
      character_id: 'mara',
      text: 'Bring the kettle.',
    };
    expect(() =>
      assemble({
        prose: intent.text,
        intent,
        cast: story.state.cast,
        performance: {
          status: 'performed',
          evidence: intent.text,
          paragraph_index: 0,
        },
      }),
    ).toThrow('repeated');
    const result = assemble({
      prose: 'She speaks.\n\nIona listens.',
      intent,
      cast: story.state.cast,
      performance: {
        status: 'performed',
        evidence: 'She speaks.',
        paragraph_index: 1,
      },
      protocol: 2,
    });
    const manifest = structuredClone(result.manifest);
    manifest.speech.paragraph_index = 0;
    expect(() =>
      validateAssembly(manifest, {
        prose: result.prose,
        input: intent,
        state: story.state,
        kind: 'scene',
      }),
    ).toThrow('boundary');
  });
  test.each(['steer', 'ask'])(
    '%s words cannot serve as proof of an event',
    async (kind) => {
      const words = 'The debt has already been paid.';
      await expect(
        reply(
          {
            prose: 'Mara considers the request.',
            effects: [
              {
                op: 'remember',
                fact: { id: 'paid-debt', text: words },
                evidence: words,
                source_kind: 'submitted_input',
                claim_kind: 'occurred-event',
              },
            ],
          },
          { kind, text: words },
        ),
      ).rejects.toMatchObject({
        code: kind === 'ask' ? 'INVALID_STORY_REPLY' : 'INVALID_EFFECT_SOURCE',
      });
      expect(
        store.memory.get(story.id, story.head_beat_id, 'paid-debt'),
      ).toBeNull();
    },
  );
  test('an Act attempt cannot declare its outcome', async () => {
    story = store.control(story.id, story.revision, 'mara');
    const words = 'Mara tries to solve the bell.';
    await expect(
      reply(
        {
          prose: 'Mara looks at the log.',
          effects: [
            {
              op: 'resolve',
              id: 'bell-question',
              evidence: words,
              source_kind: 'submitted_input',
              claim_kind: 'attempt',
              resolution_disposition: 'achieved',
            },
          ],
        },
        { kind: 'act', text: words },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EFFECT_SOURCE' });
  });
  test.each(['abandoned', 'failed', 'superseded'])(
    '%s goals do not buy a payoff or resolved-thread ending',
    async (disposition) => {
      const prose = 'The sisters leave the unanswered questions behind.';
      await reply({
        prose,
        effects: story.state.episode.goal_ids.map((id) => ({
          op: 'resolve',
          id,
          evidence: prose,
          source_kind: 'narration',
          claim_kind: 'occurred-event',
          resolution_disposition: disposition,
        })),
      });
      expect(story.state.episode.payoff_beat_id).toBeNull();
      expect(() =>
        store.creativeRecords.episode(
          story.id,
          target({ action: 'end', closure_kind: 'resolved-thread' }),
        ),
      ).toThrow('actually achieved');
      const value = await exported();
      expect(() => validateSave(value)).not.toThrow();
    },
  );
  test('scene proposals survive failed requests and only narrated circumstances become established', async () => {
    story = store.creativeRecords.configure(
      story.id,
      target({
        expected_config_id: null,
        patch: {
          scene_plan: {
            location: 'The winter tower',
            time: 'Tomorrow',
            present_ids: ['mara'],
            purpose: 'Talk',
            notes: '',
          },
        },
      }),
    ).story;
    const plan = store.current(story.id).state.config_revision_id;
    await expect(
      reply({
        prose: 'A reply.',
        effects: [{ op: 'invent', evidence: 'A reply.' }],
      }),
    ).rejects.toBeTruthy();
    expect(store.current(story.id).state.consumed_scene_plan_id).toBeNull();
    await reply({ prose: 'Mara stays beside the quay.' });
    expect(store.current(story.id).state.consumed_scene_plan_id).toBe(plan);
    expect(store.current(story.id).state.scene_frame).toBeUndefined();
    const prose = 'Mara enters the tower at dawn.';
    await reply({
      prose,
      scene: {
        location: 'The tower',
        time: 'Dawn',
        present_ids: ['mara'],
        evidence: prose,
      },
    });
    const copied = await saves().importSave(await saves().exportSave(story.id));
    expect(store.current(copied.id).state.scene_frame.beat_id).not.toBe(
      story.head_beat_id,
    );
  });
  test('old explicit reference bindings survive compaction, branch correctly and remain portable', async () => {
    const opening = story.head_beat_id;
    story = store.correct(story.id, story.revision, {
      fact: {
        id: 'old-constraint',
        text: 'The brass door only opens for Iona.',
        visibility: 'public',
        status: 'resolved',
        known_by: ['iona'],
      },
      reason: 'Owner declaration.',
    });
    for (let i = 0; i < 132; i++)
      story = store.correct(story.id, story.revision, {
        fact: { id: 'noise-' + i, text: 'A later detail ' + i + '.' },
        reason: 'Recorded detail.',
      });
    expect(
      store
        .current(story.id)
        .state.facts.some((fact) => fact.id === 'old-constraint'),
    ).toBe(false);
    story = store.creativeRecords.adopt(
      story.id,
      target({
        kind: 'world',
        subject_id: null,
        expected_reference_id: null,
        selected_fields: [],
        binding_fact_ids: ['old-constraint'],
      }),
    ).story;
    const payload = JSON.parse(
      service.buildMessages(store.current(story.id), {
        kind: 'follow',
        text: '',
      })[1].content,
    );
    expect(payload.facts.some((fact) => fact.id === 'old-constraint')).toBe(
      true,
    );
    const value = await exported();
    expect(() => validateSave(value)).not.toThrow();
    expect(
      (await saves().importSave(await saves().exportSave(story.id))).title,
    ).toBe(story.title);
    story = store.fork(story.id, story.revision, {
      name: 'Earlier path',
      beat_id: opening,
    });
    expect(
      store.creativeRecords.boundFacts(
        story.id,
        store.current(story.id).state,
        story.head_beat_id,
      ),
    ).toEqual([]);
  });
  test('published references reject foreign bindings and future scene proposal sources', async () => {
    story = store.creativeRecords.adopt(
      story.id,
      target({
        kind: 'world',
        subject_id: null,
        expected_reference_id: null,
        selected_fields: [],
        binding_fact_ids: ['chart-sale'],
      }),
    ).story;
    const value = await exported();
    value.creative.references[0].binding_fact_ids = ['not-a-current-fact'];
    expect(() => validateSave(value)).toThrow('foreign');
    value.creative.references[0].binding_fact_ids = ['chart-sale'];
    delete value.creative.references[0].value.description;
    expect(() => validateSave(value)).toThrow('noncanonical');
  });
  test('a configuration cannot be silently laundered through another snapshot', async () => {
    story = store.preferences(story.id, story.revision, {
      voice: 'An intimate voice.',
    });
    await reply({ prose: 'Mara watches the lights.' });
    const value = await exported();
    value.beats.at(-1).state.config_revision_id = null;
    expect(() => validateSave(value)).toThrow('without a producing');
  });
  test('campaign secrets, relationships and goal dispositions use honest fact types', async () => {
    const base = {
      id: 'ledger-item',
      kind: 'goal',
      text: 'Find the compass.',
      status: 'resolved',
      visibility: 'public',
    };
    expect(() =>
      store.creativeRecords.declareCampaign(
        story.id,
        target({
          record: { section: 'goals', fact: base },
          reason: 'An explicit declaration.',
        }),
      ),
    ).toThrow('how the goal ended');
    story = store.creativeRecords.declareCampaign(
      story.id,
      target({
        record: {
          section: 'quests',
          fact: { ...base, resolution_disposition: 'abandoned' },
        },
        reason: 'The owner abandoned this quest.',
      }),
    ).story;
    expect(story.state.facts.find((fact) => fact.id === base.id)).toMatchObject(
      { campaign_section: 'quests', resolution_disposition: 'abandoned' },
    );
    const value = await exported();
    expect(() => validateSave(value)).not.toThrow();
  });
  test('episode undo is append-only and refuses an ending followed by another local action', () => {
    const head = story.head_beat_id;
    story = store.episode(story.id, story.revision, {
      action: 'end',
      closure_kind: 'vignette',
      summary: 'A complete moment.',
    });
    const ended = story.head_beat_id;
    expect(story.can_undo_episode).toBe(true);
    story = store.episode(story.id, story.revision, { action: 'undo' });
    expect(story.head_beat_id).not.toBe(head);
    expect(story.state.episode.status).toBe('active');
    expect(
      db.prepare('SELECT 1 FROM fiction_beats WHERE id=?').get(ended),
    ).toBeTruthy();
    story = store.episode(story.id, story.revision, { action: 'end' });
    story = store.preferences(story.id, story.revision, { voice: 'Quiet' });
    expect(() =>
      store.episode(story.id, story.revision, { action: 'undo' }),
    ).toThrow('later activity');
  });
  test('quiet opportunity is eligible equally with one, three and twelve promises', () => {
    const sequences = [];
    for (const count of [1, 3, 12]) {
      const state = structuredClone(store.current(story.id).state);
      state.facts = Array.from({ length: count }, (_, i) => ({
        id: 'promise-' + i,
        kind: 'commitment',
        visibility: 'public',
        status: 'active',
        text: 'A promise.',
      }));
      const kinds = [];
      for (let i = 0; i < 6; i++) {
        const plan = chooseScene({ genre: 'drama' }, state, { kind: 'follow' });
        kinds.push(plan.kind);
        recordScene(state, plan, 'synthetic-' + i);
      }
      expect(kinds).toContain('quiet');
      sequences.push(kinds);
    }
    expect(sequences[0]).toEqual(sequences[1]);
    expect(sequences[1]).toEqual(sequences[2]);
  });
  test('fact input order cannot decide the nominated promise', () => {
    const state = store.current(story.id).state;
    state.facts = [
      { id: 'b', kind: 'commitment', visibility: 'public', status: 'active' },
      { id: 'a', kind: 'commitment', visibility: 'public', status: 'active' },
    ];
    const first = chooseScene({ genre: 'drama' }, state, { kind: 'follow' });
    state.facts.reverse();
    expect(chooseScene({ genre: 'drama' }, state, { kind: 'follow' })).toEqual(
      first,
    );
  });
  test('all-stage plans trim only whole older prose, expire safely and bind exact capacity', () => {
    let limits = {
      context_tokens: 2000000,
      output_tokens: 16000,
      source: 'owner',
    };
    const providers = {
      exposure: (role) => ({ role, provider: null, model_id: null }),
      resolve: () => ({ modelLimits: limits }),
    };
    const plans = createGenerationPlans({ db, providers });
    const context = store.current(story.id),
      intent = { kind: 'follow', text: '' };
    const messages = service.buildMessages(context, intent);
    const payload = JSON.parse(messages[1].content);
    payload.recent = [
      { beat_id: 'old', prose: 'Old '.repeat(5000) },
      { beat_id: story.head_beat_id, prose: 'The latest passage.' },
    ];
    messages[1].content = JSON.stringify(payload);
    limits = {
      ...limits,
      context_tokens: inputBound(service.buildMessages(context, intent)) + 6000,
    };
    const plan = plans.build(context, intent, messages);
    expect(plan.manifest.recent_ids).toEqual([story.head_beat_id]);
    const prepared = plans.prepare(plan);
    db.prepare(
      'UPDATE fiction_operation_plans SET expires_at=0 WHERE id=?',
    ).run(prepared.id);
    expect(() =>
      plans.accept(prepared.id, plan, { id: 'not-dispatched' }),
    ).toThrow('expired');
    limits = { ...limits, context_tokens: 2000000 };
    expect(() => plans.checkStage(plan, 'scribe', 'draft', messages)).toThrow(
      'capacity changed',
    );
  });
  test('reviewers never receive inserted speech as ordinary evidence', () => {
    const intent = {
      kind: 'say',
      character_id: 'mara',
      text: 'I promise the moon.',
    };
    const result = assemble({
      prose: 'Mara speaks.\n\nThe harbour is quiet.',
      intent,
      cast: story.state.cast,
      performance: {
        status: 'performed',
        evidence: 'Mara speaks.',
        paragraph_index: 0,
      },
      protocol: 2,
    });
    const beat = {
      prose: result.prose,
      input: intent,
      state: story.state,
      kind: 'scene',
    };
    expect(validateAssembly(result.manifest, beat).narration).not.toContain(
      intent.text,
    );
    const segment = result.manifest.segments[0];
    segment.sha256 = sha('tamper');
    expect(() => validateAssembly(result.manifest, beat)).toThrow(
      'bytes changed',
    );
  });
  test('revealing a campaign secret moves it to knowledge and remains portable', async () => {
    story = store.creativeRecords.declareCampaign(
      story.id,
      target({
        record: {
          section: 'secrets',
          fact: {
            id: 'buried-key',
            kind: 'fact',
            text: 'The key is under the hearth.',
            visibility: 'secret',
            known_by: [],
          },
        },
        reason: 'An owner-established secret.',
      }),
    ).story;
    const prose = 'Mara lifts the hearthstone and shows Iona the key.';
    await reply({
      prose,
      effects: [
        {
          op: 'reveal',
          id: 'buried-key',
          known_by: ['iona', 'mara'],
          evidence: prose,
          source_kind: 'narration',
          claim_kind: 'occurred-event',
        },
      ],
    });
    expect(
      story.state.facts.find((fact) => fact.id === 'buried-key'),
    ).toMatchObject({ visibility: 'public', campaign_section: 'knowledge' });
    const value = await exported();
    expect(() => validateSave(value)).not.toThrow();
  });
  test('performed Say may record an uttered promise but not fulfillment', async () => {
    story = store.control(story.id, story.revision, 'mara');
    const words = 'I promise to bring the kettle.';
    const prose = 'Mara takes her turn. Iona listens.';
    await reply(
      {
        prose,
        speech_performance: {
          status: 'performed',
          evidence: 'Mara takes her turn.',
          paragraph_index: 0,
        },
        effects: [
          {
            op: 'remember',
            fact: {
              id: 'kettle-promise',
              kind: 'commitment',
              actor_id: 'mara',
              text: 'Mara promised to bring the kettle.',
            },
            evidence: words,
            source_kind: 'submitted_input',
            claim_kind: 'reported-claim',
          },
        ],
      },
      { kind: 'say', text: words },
    );
    expect(
      story.state.facts.find((fact) => fact.id === 'kettle-promise'),
    ).toMatchObject({ status: 'active', claim_kind: 'reported-claim' });
    const value = await exported();
    expect(() => validateSave(value)).not.toThrow();
  });
});
