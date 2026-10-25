'use strict';
const { keys, text, choice, fail } = require('./model');
const { templateInput, FIELDS } = require('./library-model');
const { ENUMS, FOCUS_AREAS } = require('../scribes/store');
const PERSPECTIVES = ['flexible', 'first-person', 'close-third', 'omniscient'];
const PRESETS = {
  brief: 180,
  developed: 400,
  extended: 800,
  'legacy-short': 180,
};
const LEGACY_FIELDS = [
  'pacing',
  'consequences',
  'boundaries',
  'voice',
  'focus',
  'play_style',
  'fourth_wall',
  'quality_mode',
];
const CONFIG_FIELDS = [
  ...LEGACY_FIELDS,
  'perspective',
  'speaker_id',
  'focal_id',
  'framing_narrator',
  'tense',
  'language',
  'length',
  'genre_description',
  'tone',
  'disclosure',
  'scene_plan',
];
const identifier = (value, label = 'Identity') => {
  const id = text(value, label, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(`${label} is invalid.`);
  return id;
};
const bounded = (value, max, label) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > max)
    fail(`${label} exceeds its byte limit.`, 'CREATIVE_TOO_LARGE', 413);
  return value;
};
function defaults(legacy = false) {
  return {
    pacing: 'balanced',
    consequences: 'gentle',
    boundaries: '',
    voice: '',
    focus: '',
    play_style: 'story-shaping',
    fourth_wall: 'never',
    quality_mode: 'off',
    perspective: 'flexible',
    speaker_id: null,
    focal_id: null,
    framing_narrator: '',
    tense: 'past',
    language: 'English',
    length: {
      preset: legacy ? 'legacy-short' : 'developed',
      target: legacy ? 180 : 400,
      unit: 'words',
      definition_version: 1,
    },
    genre_description: '',
    tone: '',
    disclosure: 'limited',
    scene_plan: null,
  };
}
function configuration(value, castIds, { allowIncomplete = false } = {}) {
  keys(value, CONFIG_FIELDS, 'Creative configuration');
  const result = {};
  for (const [name, values] of Object.entries({
    pacing: ['reflective', 'balanced', 'brisk'],
    consequences: ['gentle', 'dramatic'],
    play_style: ['story-shaping', 'living-world'],
    fourth_wall: ['never', 'rarely', 'freely'],
    quality_mode: ['off', 'standard', 'memory', 'both'],
  }))
    result[name] = choice(value[name], values, defaults()[name], name);
  for (const [name, max] of [
    ['boundaries', 2000],
    ['voice', 1500],
    ['focus', 1500],
  ])
    result[name] = text(value[name], name, max, { optional: true });
  result.perspective = choice(
    value.perspective,
    PERSPECTIVES,
    null,
    'Perspective',
  );
  for (const name of ['speaker_id', 'focal_id']) {
    result[name] = value[name] ?? null;
    if (result[name] !== null && !castIds.includes(result[name]))
      fail(
        `Choose a cast member for ${name.replace('_id', '')}.`,
        'CREATIVE_IDENTITY_MISSING',
        409,
      );
  }
  result.framing_narrator = text(
    value.framing_narrator,
    'Framing narrator',
    1000,
    { optional: true },
  );
  if (
    !allowIncomplete &&
    result.perspective === 'first-person' &&
    !result.speaker_id &&
    !result.framing_narrator
  )
    fail(
      'First person needs a cast speaker or an explicit framing narrator.',
      'CREATIVE_IDENTITY_MISSING',
      409,
    );
  if (
    !allowIncomplete &&
    result.perspective === 'close-third' &&
    !result.focal_id
  )
    fail(
      'Close third needs a focal cast member.',
      'CREATIVE_IDENTITY_MISSING',
      409,
    );
  result.tense = choice(
    value.tense,
    ['past', 'present'],
    null,
    'Narrative tense',
  );
  result.language = text(value.language, 'Prose language', 100);
  keys(
    value.length,
    ['preset', 'target', 'unit', 'definition_version'],
    'Passage length',
  );
  const preset = choice(
    value.length.preset,
    [...Object.keys(PRESETS), 'custom'],
    null,
    'Length preset',
  );
  const target = value.length.target;
  if (
    !Number.isSafeInteger(target) ||
    target < 50 ||
    target > 2000 ||
    value.length.definition_version !== 1
  )
    fail(
      'Choose a length target between 50 and 2,000, with a supported preset definition.',
    );
  if (preset !== 'custom' && target !== PRESETS[preset])
    fail('The target does not match its length preset.');
  result.length = {
    preset,
    target,
    unit: choice(
      value.length.unit,
      ['words', 'characters'],
      null,
      'Length unit',
    ),
    definition_version: 1,
  };
  result.genre_description = text(
    value.genre_description,
    'Genre description',
    1000,
    { optional: true },
  );
  result.tone = text(value.tone, 'Prose tone', 1000, { optional: true });
  result.disclosure = choice(
    value.disclosure,
    ['limited', 'reader-known'],
    null,
    'Disclosure policy',
  );
  result.scene_plan = null;
  if (value.scene_plan !== null && value.scene_plan !== undefined) {
    const plan = value.scene_plan;
    keys(
      plan,
      ['id', 'location', 'time', 'present_ids', 'purpose', 'notes'],
      'Next-scene proposal',
    );
    const ids = plan.present_ids || [];
    if (
      !Array.isArray(ids) ||
      ids.length > 24 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !castIds.includes(id))
    )
      fail('Scene presence must name existing cast members.');
    result.scene_plan = {
      id: identifier(plan.id, 'Scene proposal identity'),
      location: text(plan.location, 'Proposed location', 1000, {
        optional: true,
      }),
      time: text(plan.time, 'Proposed time', 500, { optional: true }),
      present_ids: ids,
      purpose: text(plan.purpose, 'Proposed purpose', 1000, { optional: true }),
      notes: text(plan.notes, 'Scene proposal', 2000, { optional: true }),
    };
  }
  return bounded(result, 32 * 1024, 'Creative configuration');
}
function publicConfiguration(value) {
  return Object.fromEntries(
    [
      'pacing',
      'consequences',
      'play_style',
      'fourth_wall',
      'quality_mode',
      'perspective',
      'speaker_id',
      'focal_id',
      'tense',
      'language',
      'length',
      'disclosure',
    ].map((key) => [key, value[key]]),
  );
}
function referenceFields(kind) {
  return [
    'name',
    'description',
    ...Object.keys(FIELDS[kind]).map((key) => 'data.' + key),
    ...(kind === 'scribe'
      ? [...Object.keys(ENUMS), 'focus_areas', 'entity_kind'].map(
          (key) => 'data.' + key,
        )
      : []),
  ];
}
function reference(kind, value) {
  return bounded(templateInput(kind, value), 64 * 1024, 'Story reference');
}
function selectedReference(kind, prior, proposed, selected) {
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > 40 ||
    new Set(selected).size !== selected.length ||
    selected.some((field) => !referenceFields(kind).includes(field))
  )
    fail('Select supported reference fields to adopt.');
  const result = structuredClone(prior);
  for (const field of selected) {
    if (field.startsWith('data.')) {
      const name = field.slice(5);
      if (!Object.hasOwn(proposed.data || {}, name))
        fail('A selected proposed field is missing.');
      result.data[name] = proposed.data[name];
    } else {
      if (!Object.hasOwn(proposed, field))
        fail('A selected proposed field is missing.');
      result[field] = proposed[field];
    }
  }
  return reference(kind, result);
}
function baselineReference(state, kind, subjectId = null) {
  if (kind === 'character') {
    const person = state.cast.find((person) => person.id === subjectId);
    if (!person) fail('Choose a person already in this story.');
    const frozen = state.library?.characters?.find(
      (entry) => entry.character_id === subjectId,
    )?.snapshot;
    return reference(
      kind,
      frozen
        ? {
            name: frozen.name,
            description: frozen.description,
            data: frozen.data,
          }
        : {
            name: person.name,
            description: person.description,
            data: { motive: person.motive },
          },
    );
  }
  const frozen = state.library?.[kind];
  return reference(
    kind,
    frozen
      ? {
          name: frozen.name,
          description: frozen.description,
          data: frozen.data,
        }
      : {
          name: kind === 'world' ? 'This story’s world' : 'This story’s Scribe',
          description: '',
          data: {},
        },
  );
}
function campaignAdapter(value, castIds) {
  keys(value, ['section', 'fact'], 'Campaign record');
  const map = {
    relationships: ['relationship'],
    promises: ['commitment'],
    debts: ['commitment', 'resource'],
    knowledge: ['fact'],
    secrets: ['fact'],
    goals: ['goal'],
    factions: ['fact'],
    quests: ['goal'],
    conditions: ['fact'],
    inventory: ['resource'],
  };
  if (!map[value.section]?.includes(value.fact?.kind))
    fail('Choose the declared fiction-fact kind for this campaign section.');
  const fact = require('./model').normalizeFact(value.fact, castIds);
  if (
    fact.kind === 'goal' &&
    fact.status === 'resolved' &&
    !['achieved', 'abandoned', 'failed', 'superseded'].includes(
      fact.resolution_disposition,
    )
  )
    fail('Name how the goal ended.');
  if (value.section === 'secrets' && fact.visibility !== 'secret')
    fail('A secret record must remain private until revealed.');
  return {
    section: value.section,
    fact: { ...fact, campaign_section: value.section },
  };
}
module.exports = {
  LEGACY_FIELDS,
  PERSPECTIVES,
  PRESETS,
  CONFIG_FIELDS,
  FOCUS_AREAS,
  identifier,
  bounded,
  defaults,
  configuration,
  publicConfiguration,
  referenceFields,
  reference,
  selectedReference,
  baselineReference,
  campaignAdapter,
};
