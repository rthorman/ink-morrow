'use strict';
const { randomUUID } = require('node:crypto');
const { keys, fail } = require('./model');
const { canonical, digest } = require('./drafts');
const model = require('./creative-model');
const subjectKey = (kind, id = null) => `${kind}:${id || ''}`;
function createCreativeCollections({
  db,
  current,
  transaction,
  assertRevision,
  assertIdle,
  append,
  memory,
  view,
}) {
  const revision = (table, game, id) =>
    db
      .prepare(`SELECT * FROM ${table} WHERE game_id=? AND id=?`)
      .get(game, id) ||
    fail('Creative revision not found.', 'CREATIVE_REVISION_MISSING', 404);
  function config(game, state) {
    const value = state.config_revision_id
      ? JSON.parse(
          revision('fiction_config_revisions', game, state.config_revision_id)
            .value_json,
        )
      : state.creative_baseline || {
          ...model.defaults(state.version !== 2),
          ...Object.fromEntries(
            model.LEGACY_FIELDS.filter((key) => state[key] !== undefined).map(
              (key) => [key, state[key]],
            ),
          ),
        };
    return { ...value, focus: state.focus ?? value.focus };
  }

  function reference(game, state, kind, id = null) {
    const key = subjectKey(kind, id);
    const head = state.reference_heads?.[key];
    return head
      ? JSON.parse(
          revision('fiction_reference_revisions', game, head).value_json,
        )
      : model.baselineReference(state, kind, id);
  }
  function upgrade(game, state, newStory = false) {
    if (state.version === 2) return structuredClone(state);
    const baseline = newStory
      ? {
          ...model.defaults(false),
          ...Object.fromEntries(
            model.LEGACY_FIELDS.filter((key) => state[key] !== undefined).map(
              (key) => [key, state[key]],
            ),
          ),
        }
      : config(game, state);
    return {
      ...structuredClone(state),
      version: 2,
      creative_baseline: baseline,
      config_revision_id: null,
      reference_heads: {},
      opportunity_round: { round: 0, used: [] },
      consumed_scene_plan_id: null,
    };
  }
  function effective(game, state) {
    const result = structuredClone(state);
    result.creative = config(game, state);
    result.creative_sources = {
      configuration: state.config_revision_id || 'baseline',
      references: { ...state.reference_heads },
    };
    result.library = structuredClone(
      state.library || { world: null, scribe: null, characters: [] },
    );
    for (const kind of ['world', 'scribe']) {
      const id = state.reference_heads?.[subjectKey(kind)];
      if (id) {
        const value = reference(game, state, kind);
        result.library[kind] = { source_id: id, source_revision: 0, ...value };
      }
    }
    result.cast = result.cast.map((person) => {
      const head = state.reference_heads?.[subjectKey('character', person.id)];
      if (!head) return person;
      const value = reference(game, state, 'character', person.id);
      const snapshot = { source_id: head, source_revision: 0, ...value };
      result.library.characters = result.library.characters.filter(
        (entry) => entry.character_id !== person.id,
      );
      result.library.characters.push({ character_id: person.id, snapshot });
      return {
        ...person,
        description: value.description,
        motive: value.data.motive,
      };
    });
    result.creative_scene_plan =
      result.creative.scene_plan &&
      state.consumed_scene_plan_id !== result.creative.scene_plan.id
        ? result.creative.scene_plan
        : null;
    return result;
  }
  function envelope(input, extra) {
    keys(
      input,
      [
        'action_key',
        'expected_revision',
        'target_branch_id',
        'expected_head_beat_id',
        ...extra,
      ],
      'Creative command',
    );
    model.identifier(input.action_key, 'Action key');
  }
  function command(game, input, kind, extra, produce) {
    envelope(input, extra);
    const fingerprint = digest({ kind, input });
    let result;
    transaction(() => {
      const prior = db
        .prepare(
          'SELECT * FROM fiction_command_receipts WHERE game_id=? AND action_key=?',
        )
        .get(game, input.action_key);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(
            'This local action key belongs to different content.',
            'IDEMPOTENCY_CONFLICT',
            409,
          );
        result = { ...JSON.parse(prior.result_json), replayed: true };
        return;
      }
      if (
        db
          .prepare(
            'SELECT 1 FROM fiction_command_fences WHERE game_id=? AND action_key=?',
          )
          .get(game, input.action_key)
      )
        fail(
          'This local change was cancelled before dispatch.',
          'CREATIVE_COMMAND_CANCELLED',
          409,
        );
      const context = current(game);
      assertRevision(context.game, input.expected_revision);
      assertIdle(game);
      if (
        context.branch.id !== input.target_branch_id ||
        context.branch.head_beat_id !== input.expected_head_beat_id
      )
        fail(
          'The active destination changed. Review this action again.',
          'STORY_TARGET_CHANGED',
          409,
        );
      const count = db
        .prepare(
          'SELECT (SELECT count(*) FROM fiction_config_revisions WHERE game_id=?)+(SELECT count(*) FROM fiction_reference_revisions WHERE game_id=?) AS n',
        )
        .get(game, game).n;
      if (['configuration', 'reference'].includes(kind) && count >= 10000)
        fail(
          'This story reached the 10,000 creative-revision limit.',
          'CREATIVE_LIMIT',
          413,
        );
      const beatId = randomUUID(),
        revisionId = randomUUID();
      const state = structuredClone(context.state);
      state.version = 2;
      state.creative_baseline ||= config(game, context.state);
      state.config_revision_id ??= null;
      state.reference_heads ||= {};
      state.opportunity_round ||= { round: 0, used: [] };
      state.consumed_scene_plan_id ??= null;
      const produced = produce(context, state, beatId, revisionId);
      append(context, {
        id: beatId,
        kind: produced.kind || 'correction',
        summary: produced.summary,
        input: { operation: kind, ...produced.input },
        state,
        changes: produced.changes || [],
      });
      result = { beat_id: beatId, revision_id: revisionId, ...produced.result };
      db.prepare(
        'INSERT INTO fiction_command_receipts(game_id,action_key,fingerprint,kind,beat_id,result_json) VALUES(?,?,?,?,?,?)',
      ).run(
        game,
        input.action_key,
        fingerprint,
        kind,
        beatId,
        canonical(result),
      );
    });
    return { story: view(game), result };
  }
  function configure(game, input) {
    return command(
      game,
      input,
      'configuration',
      ['expected_config_id', 'patch'],
      (context, state, beatId, id) => {
        if ((state.config_revision_id || null) !== input.expected_config_id)
          fail(
            'The creative configuration changed. Compare the current version.',
            'CREATIVE_CONFLICT',
            409,
          );
        keys(input.patch, model.CONFIG_FIELDS, 'Creative settings patch');
        if (!Object.keys(input.patch).length)
          fail('Change a setting before saving.');
        const prior = config(game, state);
        const proposed = { ...prior, ...input.patch };
        if (input.patch.scene_plan)
          proposed.scene_plan = { ...input.patch.scene_plan, id };
        const value = model.configuration(
          proposed,
          state.cast.map((person) => person.id),
          { allowIncomplete: true },
        );
        const publicChange =
          canonical(model.publicConfiguration(value)) !==
          canonical(model.publicConfiguration(prior));
        db.prepare(
          'INSERT INTO fiction_config_revisions(id,game_id,parent_id,beat_id,value_json,public_change) VALUES(?,?,?,?,?,?)',
        ).run(
          id,
          game,
          state.config_revision_id,
          beatId,
          canonical(value),
          Number(publicChange),
        );
        state.config_revision_id = id;
        for (const field of model.LEGACY_FIELDS) state[field] = value[field];
        return {
          summary: 'Creative settings were revised for future narration.',
          result: { settings: value, public_change: publicChange },
        };
      },
    );
  }
  function adopt(game, input) {
    return command(
      game,
      input,
      'reference',
      [
        'kind',
        'subject_id',
        'expected_reference_id',
        'proposed',
        'selected_fields',
        'source',
        'acknowledge_overlaps',
        'binding_fact_ids',
      ],
      (context, state, beatId, id) => {
        if (!['world', 'scribe', 'character'].includes(input.kind))
          fail('Choose world, character or Scribe.');
        const subject = input.subject_id ?? null;
        if ((input.kind === 'character') !== (subject !== null))
          fail('Only a cast reference names a subject.');
        const key = subjectKey(input.kind, subject);
        const parent = state.reference_heads[key] || null;
        if (parent !== input.expected_reference_id)
          fail(
            'The effective story reference changed. Compare both versions.',
            'CREATIVE_CONFLICT',
            409,
          );
        const prior = reference(game, state, input.kind, subject);
        let proposed = input.proposed;
        let source = null;
        if (input.source) {
          keys(
            input.source,
            ['template_id', 'template_revision'],
            'Template source',
          );
          const row = db
            .prepare(
              'SELECT * FROM fiction_templates WHERE id=? AND kind=? AND deleted=0',
            )
            .get(input.source.template_id, input.kind);
          if (!row || row.revision !== input.source.template_revision)
            fail(
              'The reusable template changed. Refresh its comparison.',
              'TEMPLATE_CHANGED',
              409,
            );
          source = { ...input.source };
          proposed ||= {
            name: row.name,
            description: row.description,
            data: JSON.parse(row.data_json),
          };
        }
        const bindings =
          input.binding_fact_ids ||
          (parent
            ? JSON.parse(
                revision('fiction_reference_revisions', game, parent)
                  .bindings_json,
              )
            : []);
        if (
          !Array.isArray(bindings) ||
          bindings.length > 32 ||
          new Set(bindings).size !== bindings.length ||
          bindings.some(
            (id) => !memory.get(game, context.branch.head_beat_id, id),
          )
        )
          fail(
            'Bind only existing, unretired facts from this path.',
            'INVALID_REFERENCE_BINDING',
            409,
          );
        const value = input.selected_fields?.length
          ? model.selectedReference(
              input.kind,
              prior,
              proposed,
              input.selected_fields,
            )
          : prior;
        if (
          !input.selected_fields?.length &&
          input.binding_fact_ids === undefined
        )
          fail('Select reference fields or declared fact bindings.');
        const selectedValues = (input.selected_fields || [])
          .map((field) =>
            field.startsWith('data.')
              ? value.data[field.slice(5)]
              : value[field],
          )
          .filter((value) => typeof value === 'string' && value.length >= 8);
        const overlaps = context.state.facts
          .filter(
            (fact) =>
              fact.status === 'active' &&
              ((subject !== null && fact.actor_id === subject) ||
                selectedValues.some((value) =>
                  fact.text.toLowerCase().includes(value.toLowerCase()),
                )),
          )
          .slice(0, 12)
          .map((fact) => ({
            id: fact.id,
            text: fact.text,
            visibility: fact.visibility,
          }));
        if (overlaps.length && input.acknowledge_overlaps !== true)
          fail(
            'Established facts overlap this reference. Review them; adoption cannot override recorded truth.',
            'REFERENCE_OVERLAP',
            409,
          );
        const publicValue = (entry) => ({
          name: entry.name,
          description: entry.description,
          appearance: entry.data.appearance || '',
          setting: entry.data.setting || '',
        });
        const publicChange =
          canonical(publicValue(prior)) !== canonical(publicValue(value));
        db.prepare(
          'INSERT INTO fiction_reference_revisions(id,game_id,subject_kind,subject_id,parent_id,beat_id,value_json,source_json,bindings_json,public_change) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          game,
          input.kind,
          subject,
          parent,
          beatId,
          canonical(value),
          source ? canonical(source) : null,
          canonical(bindings),
          Number(publicChange),
        );
        state.reference_heads[key] = id;
        return {
          summary: `The story-local ${input.kind === 'scribe' ? 'Scribe' : input.kind} reference was revised.`,
          result: {
            subject: key,
            reference: value,
            binding_fact_ids: bindings,
            known_overlaps: overlaps,
            public_change: publicChange,
          },
        };
      },
    );
  }
  function declareCampaign(game, input) {
    return command(
      game,
      input,
      'campaign',
      ['record', 'reason'],
      (context, state, beatId) => {
        const { fact } = model.campaignAdapter(
          input.record,
          state.cast.map((person) => person.id),
        );
        fact.evidence_beat_id = beatId;
        const prior = memory.get(game, context.branch.head_beat_id, fact.id);
        const reason = require('./model').text(
          input.reason,
          'Declaration reason',
          1500,
        );
        const index = state.facts.findIndex((entry) => entry.id === fact.id);
        if (index < 0) state.facts.push(fact);
        else state.facts[index] = fact;
        require('./memory').compactFacts(state);
        return {
          summary: 'An owner-declared campaign record was updated.',
          input: { reason },
          changes: [
            {
              op: 'correct',
              fact,
              prior_evidence_beat_id: prior?.evidence_beat_id || null,
            },
          ],
          result: { revision_id: null, record: fact, reason },
        };
      },
    );
  }
  function rename(game, input) {
    return command(game, input, 'metadata', ['title'], (context, state) => {
      const title = require('./model').text(input.title, 'Story title', 200);
      db.prepare('UPDATE fiction_games SET title=? WHERE id=?').run(
        title,
        game,
      );
      return {
        summary: 'The story title was changed.',
        result: { revision_id: null, title },
      };
    });
  }
  function afterAppend(game, beatId) {
    const publicChange = db
      .prepare(
        'SELECT public_change FROM fiction_config_revisions WHERE game_id=? AND beat_id=? UNION ALL SELECT public_change FROM fiction_reference_revisions WHERE game_id=? AND beat_id=?',
      )
      .get(game, beatId, game, beatId)?.public_change;
    if (publicChange !== undefined)
      db.prepare(
        'UPDATE fiction_history_index SET reader_visible=? WHERE beat_id=?',
      ).run(publicChange, beatId);
  }
  function reindex(game) {
    const rows = db
      .prepare(
        'SELECT h.beat_id,b.parent_id,h.reader_visible FROM fiction_history_index h JOIN fiction_beats b ON b.id=h.beat_id WHERE h.game_id=? ORDER BY h.depth',
      )
      .all(game);
    const latest = new Map();
    for (const row of rows) {
      afterAppend(game, row.beat_id);
      const visible = db
        .prepare(
          'SELECT reader_visible FROM fiction_history_index WHERE beat_id=?',
        )
        .get(row.beat_id).reader_visible;
      const previous = latest.get(row.parent_id) || null;
      db.prepare(
        'UPDATE fiction_history_index SET previous_reader_id=? WHERE beat_id=?',
      ).run(previous, row.beat_id);
      latest.set(row.beat_id, visible ? row.beat_id : previous);
    }
  }
  function episode(game, input) {
    return command(
      game,
      input,
      'episode',
      ['action', 'title', 'summary', 'question', 'closure_kind'],
      (context, state) => {
        if (input.action === 'end') {
          if (state.episode.status !== 'active')
            fail('This episode has already ended.');
          const closure = input.closure_kind || 'open-ending';
          if (!['open-ending', 'vignette', 'resolved-thread'].includes(closure))
            fail('Choose a supported episode closure.');
          if (
            closure === 'resolved-thread' &&
            !state.episode.goal_ids.some((id) => {
              const fact = memory.get(game, context.branch.head_beat_id, id);
              return (
                fact?.status === 'resolved' &&
                fact.resolution_disposition === 'achieved'
              );
            })
          )
            fail(
              'A resolved-thread ending needs an actually achieved recorded goal. Choose an open ending or vignette instead.',
              'INVALID_EPISODE_CLOSURE',
              409,
            );
          state.episode = {
            ...state.episode,
            status: 'ended',
            summary: require('./model').text(
              input.summary,
              'Episode summary',
              2000,
              { optional: true },
            ),
            closure_kind: closure,
          };
        } else if (input.action === 'start') {
          if (state.episode.status !== 'ended')
            fail('Finish the current episode first.');
          state.episode = require('./episodes').makeEpisode(
            {
              number: state.episode.number + 1,
              title: require('./model').text(
                input.title || 'Another episode',
                'Episode title',
                200,
              ),
              question: require('./model').text(
                input.question,
                'Episode question',
                500,
                { optional: true },
              ),
            },
            memory.facts(game, context.branch.head_beat_id, {
              kind: 'goal',
              status: 'active',
              publicOnly: true,
              limit: 6,
            }),
          );
        } else if (input.action === 'undo') {
          const head = db
            .prepare(
              'SELECT kind,parent_id FROM fiction_beats WHERE game_id=? AND id=?',
            )
            .get(game, context.branch.head_beat_id);
          const previous = head?.parent_id
            ? JSON.parse(
                db
                  .prepare('SELECT state_json FROM fiction_beats WHERE id=?')
                  .get(head.parent_id).state_json,
              )
            : JSON.parse(context.game.initial_state_json);
          if (
            head?.kind !== 'episode' ||
            state.episode.status !== 'ended' ||
            previous.episode.status !== 'active' ||
            previous.episode.number !== state.episode.number
          )
            fail(
              'That ending has later activity. Explore an alternative path to revisit it.',
              'EPISODE_UNDO_STALE',
              409,
            );
          state.episode = previous.episode;
        } else fail('Choose start, end or immediate undo.');
        return {
          kind: 'episode',
          summary:
            input.action === 'end'
              ? 'The episode ends. You can stop here.'
              : input.action === 'undo'
                ? 'The episode ending was undone.'
                : `Episode ${state.episode.number}: ${state.episode.title}`,
          result: { revision_id: null, episode: state.episode },
        };
      },
    );
  }
  function boundFacts(game, state, head) {
    const ids = [
      ...new Set(
        Object.values(state.reference_heads || {}).flatMap((id) =>
          JSON.parse(
            revision('fiction_reference_revisions', game, id).bindings_json,
          ),
        ),
      ),
    ];
    const result = [];
    for (let at = 0; at < ids.length; at += 128)
      result.push(
        ...memory.facts(game, head, {
          ids: ids.slice(at, at + 128),
          limit: 128,
        }),
      );
    return result;
  }
  function status(game, key) {
    current(game);
    model.identifier(key, 'Action key');
    const receipt = db
      .prepare(
        'SELECT result_json FROM fiction_command_receipts WHERE game_id=? AND action_key=?',
      )
      .get(game, key);
    if (receipt)
      return {
        status: 'succeeded',
        result: JSON.parse(receipt.result_json),
        can_start_new: true,
      };
    return db
      .prepare(
        'SELECT 1 FROM fiction_command_fences WHERE game_id=? AND action_key=?',
      )
      .get(game, key)
      ? { status: 'cancelled-before-dispatch', can_start_new: true }
      : { status: 'unknown', can_start_new: false };
  }
  function cancel(game, key) {
    let result;
    transaction(() => {
      result = status(game, key);
      if (result.status === 'unknown')
        db.prepare(
          'INSERT OR IGNORE INTO fiction_command_fences(game_id,action_key) VALUES(?,?)',
        ).run(game, key);
      result = status(game, key);
    });
    return result;
  }
  function inspect(game) {
    const context = current(game);
    const state = context.state;
    return {
      game_id: game,
      revision: context.game.revision,
      target_branch_id: context.branch.id,
      expected_head_beat_id: context.branch.head_beat_id,
      config_revision_id: state.config_revision_id || null,
      settings: config(game, state),
      reference_heads: state.reference_heads || {},
      reference_bindings: Object.fromEntries(
        Object.entries(state.reference_heads || {}).map(([key, id]) => [
          key,
          JSON.parse(
            revision('fiction_reference_revisions', game, id).bindings_json,
          ),
        ]),
      ),
      references: {
        world: reference(game, state, 'world'),
        scribe: reference(game, state, 'scribe'),
        characters: state.cast.map((person) => ({
          character_id: person.id,
          value: reference(game, state, 'character', person.id),
        })),
      },
      cast: state.cast.map(({ motive: _motive, ...person }) => person),
      facts: [
        ...new Map(
          [
            ...boundFacts(game, state, context.branch.head_beat_id),
            ...memory.facts(game, context.branch.head_beat_id, { limit: 32 }),
          ].map((fact) => [fact.id, fact]),
        ).values(),
      ],
      private: true,
    };
  }
  return {
    config,
    reference,
    upgrade,
    effective,
    configure,
    adopt,
    declareCampaign,
    rename,
    episode,
    boundFacts,
    status,
    cancel,
    inspect,
    afterAppend,
    reindex,
  };
}
module.exports = { createCreativeCollections, subjectKey };
