'use strict';
const { configuration, defaults } = require('./creative-model');
const { createHash } = require('node:crypto');
// This is a conservative serialized UTF-8 bound, not a tokenizer estimate. It
// counts one token per byte plus protocol overhead and never drops authority.
const inputBound = (messages) =>
  Buffer.byteLength(JSON.stringify(messages), 'utf8') +
  messages.length * 32 +
  256;
function compileContext({ store, context, intent, plan, decision, messages }) {
  const state = store.effectiveState(context.game.id, context.state);
  const creative = configuration(
    state.creative || defaults(context.state.version !== 2),
    state.cast.map((person) => person.id),
  );
  const payload = JSON.parse(messages.at(-1).content);
  const head = context.branch.head_beat_id;
  const mentioned = state.cast
    .filter(
      (person) =>
        intent.text.toLowerCase().includes(person.name.toLowerCase()) ||
        creative.focal_id === person.id ||
        creative.speaker_id === person.id ||
        state.control.character_id === person.id,
    )
    .map((person) => person.id);
  const foundationIds = JSON.parse(context.game.initial_state_json)
    .facts.filter((fact) => fact.visibility === 'secret')
    .map((fact) => fact.id);
  const foundation = foundationIds.length
    ? store.memory.facts(context.game.id, head, {
        ids: foundationIds,
        limit: 128,
      })
    : [];
  const binding = [
    ...(store.creativeRecords?.boundFacts(
      context.game.id,
      context.state,
      head,
    ) || []),
    ...foundation,
    ...store.memory.facts(context.game.id, head, {
      visibility: 'secret',
      actorIds: mentioned,
      limit: 32,
    }),
  ];
  const exact = plan.fact_ids
    .map((id) => store.memory.get(context.game.id, head, id))
    .filter(Boolean);
  const relevant = store.memory.facts(context.game.id, head, {
    query: `${intent.text} ${state.focus}`,
    actorIds: mentioned,
    limit: 32,
  });
  const obligations = store.memory.facts(context.game.id, head, {
    kind: 'commitment',
    status: 'active',
    actorIds: mentioned,
    limit: 16,
  });
  const resources = store.memory.facts(context.game.id, head, {
    kind: 'resource',
    actorIds: mentioned,
    limit: 8,
  });
  const consequences = store.memory.facts(context.game.id, head, {
    status: 'resolved',
    actorIds: mentioned,
    limit: 12,
  });
  const facts = [
    ...new Map(
      [
        ...binding,
        ...exact,
        ...obligations,
        ...resources,
        ...consequences,
        ...relevant,
        ...payload.facts,
      ].map((fact) => [fact.id, fact]),
    ).values(),
  ];
  payload.cast = state.cast;
  payload.catalogue_context = state.library;
  payload.facts = facts;
  payload.creative_settings = creative;
  payload.scene_circumstances = state.scene_frame || null;
  payload.next_scene_proposal = state.creative_scene_plan || null;
  payload.authority_order = [
    'application rules and ownership',
    'recorded branch truth and knowledge',
    'current contribution and scope',
    'established scene and cast',
    'explicit creative settings',
    'frozen or locally revised Scribe craft',
    'provisional opportunity',
  ];
  payload.scene_plan = plan;
  payload.adjudication = decision;
  payload.recent = store
    .narrativeRows(context.game.id, head, 12)
    .map((row) => ({
      beat_id: row.id,
      kind: row.kind,
      prose: row.prose,
      summary: row.summary,
    }));
  const system = [
    messages[0].content,
    'Creative settings control the telling, not recorded events. Perspective does not assign the reader a character. A Scribe is a narration preference, never an automatically introduced person. Explicit settings outrank Scribe craft; both remain below ownership, boundaries and recorded truth.',
    'Reference descriptions, motives, background, world lore and a proposed next scene are reference intent/data. They never silently correct recorded facts. A proposed location/time/presence is not an already completed transition.',
    'Narrate in creative_settings.language and creative_settings.tense. Respect the explicit speaker or focal identity. Flexible perspective changes intentionally at scene boundaries; omniscience still respects knowledge disclosure and inhabited interiority.',
    `Target approximately ${creative.length.target} ${creative.length.unit} (${creative.length.preset}; definition ${creative.length.definition_version}), independently of pacing. This is a creative target, not a minimum. Stop early at an owned decision. Do not pad or force crisis. Language-specific units are approximate; preserve complete JSON.`,
    'Completed, failed, abandoned and superseded goals have distinct meanings. Plans, attempts, reported claims and narrated occurred events are not interchangeable. A quiet or goal-free scene can be complete.',
  ].join('\n');
  const compiled = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) },
  ];
  const manifest = {
    version: 1,
    game_id: context.game.id,
    branch_id: context.branch.id,
    head_id: head,
    configuration_id: context.state.config_revision_id || null,
    reference_ids: Object.values(context.state.reference_heads || {}),
    fact_ids: facts.map((fact) => fact.id),
    recent_ids: payload.recent.map((row) => row.beat_id),
    categories: Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        Buffer.byteLength(JSON.stringify(value), 'utf8'),
      ]),
    ),
    input_bound: inputBound(compiled),
    contract_sha256: createHash('sha256')
      .update(JSON.stringify(compiled))
      .digest('hex'),
    counter:
      'serialized UTF-8 bytes plus protocol overhead; conservative one-token-per-byte bound',
  };
  return { messages: compiled, manifest, creative, payload };
}
module.exports = { compileContext, inputBound };
