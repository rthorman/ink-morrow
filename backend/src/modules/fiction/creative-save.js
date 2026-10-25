'use strict';
const { keys, fail, normalizeFact } = require('./model');
const model = require('./creative-model');
const { canonical } = require('./drafts');
const {
  validateAssembly,
  ordinaryQuote,
  validateEffectSources,
} = require('./narrative-assembly');
const NEW_STATE = [
  'creative_baseline',
  'config_revision_id',
  'reference_heads',
  'opportunity_round',
  'consumed_scene_plan_id',
  'scene_frame',
];
const stripFact = (fact) => {
  const old = { ...fact };
  for (const field of [
    'campaign_section',
    'claim_kind',
    'resolution_disposition',
  ])
    delete old[field];
  return old;
};
function validateCreativeSave(value, validateV1) {
  keys(
    value.creative,
    ['version', 'configurations', 'references', 'assemblies'],
    'Creative collections',
  );
  if (value.creative.version !== 1)
    fail('Unsupported creative collection version.', 'INVALID_SAVE');
  const rows = value.creative;

  for (const name of ['configurations', 'references', 'assemblies'])
    if (!Array.isArray(rows[name]) || rows[name].length > 10000)
      fail('Invalid creative collection count.', 'INVALID_SAVE');
  if (
    rows.configurations.length + rows.references.length > value.beats.length ||
    rows.configurations.length + rows.references.length > 10000
  )
    fail('Too many published creative revisions.', 'INVALID_SAVE');
  const beats = new Map(value.beats.map((beat) => [beat.id, beat]));
  const children = new Map();
  for (const beat of beats.values()) {
    if (!children.has(beat.parent_id)) children.set(beat.parent_id, []);
    children.get(beat.parent_id).push(beat.id);
  }
  const starts = new Map(),
    ends = new Map();
  let time = 0;
  const stack = (children.get(null) || []).map((id) => [id, false]);
  while (stack.length) {
    const [id, done] = stack.pop();
    if (done) {
      ends.set(id, time++);
      continue;
    }
    if (starts.has(id)) fail('Creative ancestry is cyclic.', 'INVALID_SAVE');
    starts.set(id, time++);
    stack.push([id, true]);
    for (const child of children.get(id) || []) stack.push([child, false]);
  }
  const ancestor = (head, source) =>
    source === null ||
    Boolean(
      head !== null &&
        starts.has(source) &&
        starts.has(head) &&
        starts.get(source) <= starts.get(head) &&
        ends.get(source) >= ends.get(head),
    );
  const before = (beat) =>
    beat.parent_id === null
      ? value.game.initial_state
      : beats.get(beat.parent_id)?.state;
  const produced = new Set();
  const configs = new Map(),
    refs = new Map();
  for (const [name, map] of [
    ['configurations', configs],
    ['references', refs],
  ])
    for (const row of rows[name]) {
      keys(
        row,
        name === 'configurations'
          ? ['id', 'parent_id', 'beat_id', 'value', 'public_change']
          : [
              'id',
              'parent_id',
              'beat_id',
              'kind',
              'subject_id',
              'value',
              'source',
              'binding_fact_ids',
              'public_change',
            ],
        'Published creative revision',
      );
      model.identifier(row.id);
      if (configs.has(row.id) || refs.has(row.id))
        fail('Duplicate creative revision identity.', 'INVALID_SAVE');
      const beat = beats.get(row.beat_id);
      if (beat?.changes?.length)
        fail(
          'Adopting a reference or setting cannot establish events.',
          'INVALID_SAVE',
        );
      if (
        !beat ||
        produced.has(beat.id) ||
        beat.kind !== 'correction' ||
        beat.state.version !== 2
      )
        fail(
          'A creative revision needs its own local producing record.',
          'INVALID_SAVE',
        );
      produced.add(beat.id);
      if (![0, 1].includes(row.public_change))
        fail('Invalid creative visibility.', 'INVALID_SAVE');
      if (name === 'configurations') {
        const normalized = model.configuration(
          row.value,
          beat.state.cast.map((person) => person.id),
          { allowIncomplete: true },
        );
        if (canonical(normalized) !== canonical(row.value))
          fail(
            'Incomplete or noncanonical published configuration.',
            'INVALID_SAVE',
          );
      } else {
        if (
          !Array.isArray(row.binding_fact_ids) ||
          row.binding_fact_ids.length > 32 ||
          new Set(row.binding_fact_ids).size !== row.binding_fact_ids.length
        )
          fail('Invalid reference fact bindings.', 'INVALID_SAVE');
        if (
          !['world', 'scribe', 'character'].includes(row.kind) ||
          (row.kind === 'character') !== (row.subject_id !== null)
        )
          fail('Invalid reference subject.', 'INVALID_SAVE');
        if (
          row.kind === 'character' &&
          !beat.state.cast.some((person) => person.id === row.subject_id)
        )
          fail('Unknown reference cast subject.', 'INVALID_SAVE');
        const normalized = model.reference(row.kind, row.value);
        if (canonical(normalized) !== canonical(row.value))
          fail(
            'Incomplete or noncanonical published reference.',
            'INVALID_SAVE',
          );
        if (row.source !== null) {
          keys(
            row.source,
            ['template_id', 'template_revision'],
            'Inert template provenance',
          );
          model.identifier(row.source.template_id);
          if (
            !Number.isSafeInteger(row.source.template_revision) ||
            row.source.template_revision < 0
          )
            fail('Invalid inert template revision.', 'INVALID_SAVE');
        }
      }
      map.set(row.id, row);
    }
  const baseConfig = (state) => state.creative_baseline || model.defaults(true);
  const refKey = (row) => row.kind + ':' + (row.subject_id || '');
  const publicReference = (entry) => ({
    name: entry.name,
    description: entry.description,
    appearance: entry.data.appearance || '',
    setting: entry.data.setting || '',
  });
  for (const row of configs.values()) {
    const beat = beats.get(row.beat_id),
      prior = before(beat),
      parent = row.parent_id === null ? null : configs.get(row.parent_id);
    if (
      !prior ||
      (prior.config_revision_id || null) !== row.parent_id ||
      beat.state.config_revision_id !== row.id ||
      (row.parent_id !== null &&
        (!parent ||
          parent.beat_id === beat.id ||
          !ancestor(beat.parent_id, parent.beat_id)))
    )
      fail('Invalid configuration parent or producer.', 'INVALID_SAVE');
    if (
      Number(
        canonical(model.publicConfiguration(row.value)) !==
          canonical(
            model.publicConfiguration(parent?.value || baseConfig(prior)),
          ),
      ) !== row.public_change
    )
      fail('Incorrect configuration public projection.', 'INVALID_SAVE');
    if (row.value.scene_plan) {
      const producer = configs.get(row.value.scene_plan.id);
      if (
        !producer ||
        producer.value.scene_plan?.id !== producer.id ||
        canonical(producer.value.scene_plan) !==
          canonical(row.value.scene_plan) ||
        (producer.id !== row.id && !ancestor(beat.parent_id, producer.beat_id))
      )
        fail(
          'Unknown, changed or future scene proposal producer.',
          'INVALID_SAVE',
        );
    }
  }
  for (const row of refs.values()) {
    const beat = beats.get(row.beat_id),
      prior = before(beat),
      key = refKey(row),
      parent = row.parent_id === null ? null : refs.get(row.parent_id);
    if (
      !prior ||
      (prior.reference_heads?.[key] || null) !== row.parent_id ||
      beat.state.reference_heads?.[key] !== row.id ||
      (row.parent_id !== null &&
        (!parent ||
          refKey(parent) !== key ||
          parent.beat_id === beat.id ||
          !ancestor(beat.parent_id, parent.beat_id)))
    )
      fail('Invalid reference parent, subject or producer.', 'INVALID_SAVE');
    const base =
      parent?.value || model.baselineReference(prior, row.kind, row.subject_id);
    if (
      Number(
        canonical(publicReference(row.value)) !==
          canonical(publicReference(base)),
      ) !== row.public_change
    )
      fail('Incorrect reference public projection.', 'INVALID_SAVE');
  }
  const refsByBeat = new Map(
    [...refs.values()].map((row) => [row.beat_id, row]),
  );
  const factsAt = new Map(
    value.game.initial_state.facts.map((fact) => [fact.id, fact]),
  );
  const walk = (children.get(null) || []).map((id) => ({ id, leaving: false }));
  while (walk.length) {
    const entry = walk.pop();
    if (entry.leaving) {
      for (const [id, fact] of [...entry.undo].reverse())
        if (fact === undefined) factsAt.delete(id);
        else factsAt.set(id, fact);
      continue;
    }
    const beat = beats.get(entry.id),
      row = refsByBeat.get(entry.id);
    if (row && row.binding_fact_ids.some((id) => !factsAt.has(id)))
      fail(
        'A reference binds a foreign, future or retired fact.',
        'INVALID_SAVE',
      );
    const undo = [];
    for (const change of beat.changes)
      if (change.fact) {
        undo.push([change.fact.id, factsAt.get(change.fact.id)]);
        if (change.op === 'remove') factsAt.delete(change.fact.id);
        else factsAt.set(change.fact.id, change.fact);
      }
    walk.push({ leaving: true, undo });
    for (const id of children.get(entry.id) || [])
      walk.push({ id, leaving: false });
  }
  const configsByBeat = new Map(
    [...configs.values()].map((row) => [row.beat_id, row]),
  );
  for (const beat of beats.values())
    if (beat.state.version === 2) {
      const prior = before(beat);
      if (!prior) fail('Missing creative predecessor.', 'INVALID_SAVE');
      const ownConfig = configsByBeat.get(beat.id),
        ownRef = refsByBeat.get(beat.id);
      if (
        beat.state.config_revision_id !==
        (ownConfig?.id || prior.config_revision_id || null)
      )
        fail(
          'Configuration changed without a producing revision.',
          'INVALID_SAVE',
        );
      const expectedHeads = { ...(prior.reference_heads || {}) };
      if (ownRef) expectedHeads[refKey(ownRef)] = ownRef.id;
      if (canonical(expectedHeads) !== canonical(beat.state.reference_heads))
        fail(
          'References changed without a producing revision.',
          'INVALID_SAVE',
        );
      const expectedBaseline =
        prior.version === 2
          ? prior.creative_baseline
          : {
              ...model.defaults(true),
              ...Object.fromEntries(
                model.LEGACY_FIELDS.filter(
                  (key) => prior[key] !== undefined,
                ).map((key) => [key, prior[key]]),
              ),
            };
      if (
        canonical(expectedBaseline) !== canonical(beat.state.creative_baseline)
      )
        fail('Creative baseline was silently rewritten.', 'INVALID_SAVE');
    }
  const reachedConfigs = new Set(),
    reachedRefs = new Set();
  const follow = (map, reached, id) => {
    let row = map.get(id);
    while (row && !reached.has(row.id)) {
      reached.add(row.id);
      row = row.parent_id === null ? null : map.get(row.parent_id);
    }
  };
  const projectState = (state, head) => {
    if (state.version !== 2) return state;
    for (const field of NEW_STATE.filter((field) => field !== 'scene_frame'))
      if (!Object.hasOwn(state, field))
        fail('Incomplete version-2 creative snapshot.', 'INVALID_SAVE');
    if (
      canonical(
        model.configuration(
          state.creative_baseline,
          state.cast.map((person) => person.id),
          { allowIncomplete: true },
        ),
      ) !== canonical(state.creative_baseline)
    )
      fail('Incomplete creative baseline.', 'INVALID_SAVE');
    if (state.creative_baseline.scene_plan)
      fail(
        'Initial creative baselines cannot contain a produced scene proposal.',
        'INVALID_SAVE',
      );
    keys(
      state.reference_heads,
      Object.keys(state.reference_heads),
      'Reference heads',
    );
    if (Object.keys(state.reference_heads).length > 26)
      fail('Too many reference subjects.', 'INVALID_SAVE');
    if (state.config_revision_id !== null) {
      const row = configs.get(state.config_revision_id);
      if (!row || !ancestor(head, row.beat_id))
        fail(
          'Configuration is from another path or the future.',
          'INVALID_SAVE',
        );
      follow(configs, reachedConfigs, row.id);
    }
    for (const [key, id] of Object.entries(state.reference_heads)) {
      const row = refs.get(id);
      if (
        !row ||
        refKey(row) !== key ||
        !ancestor(head, row.beat_id) ||
        (row.kind === 'character' &&
          !state.cast.some((person) => person.id === row.subject_id))
      )
        fail(
          'Reference is from another subject, path or future.',
          'INVALID_SAVE',
        );
      follow(refs, reachedRefs, row.id);
    }
    keys(state.opportunity_round, ['round', 'used'], 'Opportunity schedule');
    if (
      !Number.isSafeInteger(state.opportunity_round.round) ||
      state.opportunity_round.round < 0 ||
      !Array.isArray(state.opportunity_round.used) ||
      state.opportunity_round.used.length > 12 ||
      new Set(state.opportunity_round.used).size !==
        state.opportunity_round.used.length ||
      state.opportunity_round.used.some(
        (kind) =>
          ![
            'commitment',
            'quiet',
            'opportunity',
            'rest',
            'discovery',
            'connection',
            'exploration',
            'relationship',
          ].includes(kind),
      )
    )
      fail('Invalid opportunity round.', 'INVALID_SAVE');
    if (state.consumed_scene_plan_id !== null) {
      const row = configs.get(state.consumed_scene_plan_id);
      if (
        !row ||
        row.value.scene_plan?.id !== row.id ||
        !ancestor(head, row.beat_id)
      )
        fail('Consumed proposal is outside this ancestry.', 'INVALID_SAVE');
      follow(configs, reachedConfigs, row.id);
    }
    if (state.scene_frame !== undefined && state.scene_frame !== null) {
      keys(
        state.scene_frame,
        ['location', 'time', 'present_ids', 'beat_id', 'evidence'],
        'Established scene frame',
      );
      if (
        !ancestor(head, state.scene_frame.beat_id) ||
        !beats
          .get(state.scene_frame.beat_id)
          ?.prose.includes(state.scene_frame.evidence)
      )
        fail(
          'Scene circumstances need ancestral narrative evidence.',
          'INVALID_SAVE',
        );
    }
    if (
      state.episode.closure_kind !== undefined &&
      (state.episode.status !== 'ended' ||
        !['open-ending', 'vignette', 'resolved-thread'].includes(
          state.episode.closure_kind,
        ))
    )
      fail('Invalid episode closure.', 'INVALID_SAVE');
    const projected = {
      ...state,
      episode: { ...state.episode },
      version: 1,
      facts: state.facts.map((fact) => {
        normalizeFact(
          fact,
          state.cast.map((person) => person.id),
          { evidenceBeatId: fact.evidence_beat_id },
        );
        return stripFact(fact);
      }),
    };
    for (const field of NEW_STATE) delete projected[field];
    delete projected.episode.closure_kind;
    // Technical v1 image validation receives an effective reference only in this
    // temporary validation projection; the saved historical JSON is unchanged.
    projected.library = {
      ...state.library,
      characters: [...state.library.characters],
    };
    for (const kind of ['world', 'scribe']) {
      const row = refs.get(state.reference_heads[kind + ':']);
      if (row)
        projected.library[kind] = {
          source_id: row.id,
          source_revision: 0,
          ...row.value,
        };
    }
    return projected;
  };
  const projected = {
    ...value,
    version: 1,
    game: {
      ...value.game,
      initial_state: projectState(value.game.initial_state, null),
    },
    beats: value.beats.map((beat) => {
      const state = projectState(beat.state, beat.id);
      const input = { ...beat.input };
      if (beat.state.version === 2) {
        if (
          input.operation !== undefined &&
          ![
            'configuration',
            'reference',
            'campaign',
            'metadata',
            'episode',
          ].includes(input.operation)
        )
          fail('Unknown local operation.', 'INVALID_SAVE');
        delete input.operation;
      }
      return {
        ...beat,
        input,
        state,
        changes: beat.changes.map((change) => {
          if (beat.state.version !== 2) return change;
          const old = { ...change };
          delete old.claim_kind;
          delete old.resolution_disposition;
          return { ...old, ...(old.fact ? { fact: stripFact(old.fact) } : {}) };
        }),
      };
    }),
  };
  delete projected.creative;
  delete projected.evidence;
  validateV1(projected);
  if (reachedConfigs.size !== configs.size || reachedRefs.size !== refs.size)
    fail(
      'The save contains unreachable published creative revisions.',
      'INVALID_SAVE',
    );
  const assemblies = new Map();
  for (const row of rows.assemblies) {
    keys(row, ['beat_id', 'manifest'], 'Narrative assembly record');
    const beat = beats.get(row.beat_id);
    if (
      !beat ||
      assemblies.has(row.beat_id) ||
      !['opening', 'scene', 'clarification'].includes(beat.kind)
    )
      fail('Invalid narrative assembly ownership.', 'INVALID_SAVE');
    validateAssembly(row.manifest, beat);
    assemblies.set(beat.id, row.manifest);
  }
  const evidenceKeys = new Set(
    value.evidence.map((row) => row.beat_id + ':' + row.change_index),
  );
  for (const beat of beats.values()) {
    if (
      beat.state.version === 2 &&
      beat.changes.some(
        (change, index) => !evidenceKeys.has(beat.id + ':' + index),
      )
    )
      fail('A new change is missing its exact source.', 'INVALID_SAVE');
    const manifest = assemblies.get(beat.id);
    if (
      beat.state.version === 2 &&
      ['opening', 'scene', 'clarification'].includes(beat.kind) &&
      !manifest
    )
      fail(
        'A new narrative snapshot is missing its source assembly.',
        'INVALID_SAVE',
      );
    if (manifest && beat.state.version === 2) {
      for (const change of beat.changes) {
        if (
          manifest.response_version === 2 &&
          ![
            'intention',
            'attempt',
            'reported-claim',
            'occurred-event',
          ].includes(change.claim_kind)
        )
          fail('A new change lacks its claim classification.', 'INVALID_SAVE');
        if (
          change.op === 'resolve' &&
          change.fact?.kind === 'goal' &&
          ![
            'achieved',
            'abandoned',
            'failed',
            'superseded',
            'legacy-unspecified',
          ].includes(change.fact.resolution_disposition)
        )
          fail('A resolved goal lacks its actual disposition.', 'INVALID_SAVE');
      }
    }
  }
  for (const state of [
    value.game.initial_state,
    ...value.beats.map((beat) => beat.state),
  ])
    if (state.version === 2 && state.scene_frame) {
      const frame = state.scene_frame;
      const source = beats.get(frame.beat_id),
        manifest = assemblies.get(frame.beat_id);
      if (
        typeof frame.location !== 'string' ||
        frame.location.length > 1000 ||
        typeof frame.time !== 'string' ||
        frame.time.length > 500 ||
        typeof frame.evidence !== 'string' ||
        !frame.evidence.length ||
        frame.evidence.length > 1000 ||
        !source ||
        !['opening', 'scene'].includes(source.kind) ||
        !manifest ||
        !ordinaryQuote(manifest, source.prose, frame.evidence) ||
        !Array.isArray(frame.present_ids) ||
        frame.present_ids.length > 24 ||
        frame.present_ids.some(
          (id) => !state.cast.some((person) => person.id === id),
        )
      )
        fail(
          'Established scene framing lacks ordinary narrative provenance.',
          'INVALID_SAVE',
        );
    }
  for (const evidence of value.evidence) {
    const manifest = assemblies.get(evidence.beat_id);
    if (!manifest) continue;
    const beat = beats.get(evidence.beat_id);
    if (
      evidence.source_kind === 'narration' &&
      !ordinaryQuote(manifest, beat.prose, evidence.quote)
    )
      fail(
        'Occurrence evidence cites inserted speech or an aside.',
        'INVALID_SAVE',
      );
    if (
      beat.state.version === 2 &&
      evidence.source_kind === 'submitted_input'
    ) {
      const change = beat.changes[evidence.change_index];
      if (!change) fail('Unknown effect source.', 'INVALID_SAVE');
      validateEffectSources(
        [
          {
            ...change,
            id: change.fact?.id,
            evidence: evidence.quote,
            source_kind: evidence.source_kind,
          },
        ],
        {
          prose: validateAssembly(manifest, beat).narration,
          intent: beat.input,
          performance: manifest.speech,
          protocol: manifest.response_version,
          modern: true,
          lookup: (id) => beat.state.facts.find((fact) => fact.id === id),
        },
      );
    }
  }
  return { beats, configs, refs, assemblies, ancestor };
}
module.exports = { validateCreativeSave, NEW_STATE };
