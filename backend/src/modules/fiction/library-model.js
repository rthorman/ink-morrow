'use strict';

const { keys, text, choice, fail } = require('./model');
const { CATGIRL_CANON, ENUMS, DEFAULTS, FOCUS_AREAS } = require('../scribes/store');

const KINDS = ['world', 'character', 'scribe'];
const FIELDS = {
  world: { genre: 100, setting: 1000, lore: 6000 },
  character: { appearance: 1000, personality: 1000, background: 2000, motive: 1000 },
  scribe: { appearance: 1000, personality: 1000, background: 1000, feline_traits: 1000, signature_habits: 1000, avoidances: 1000 },
};
function templateInput(kind, value) {
  choice(kind, KINDS, null, 'Catalogue kind');
  keys(value, ['name', 'description', 'data'], 'Catalogue entry');
  const source = value.data === undefined ? {} : value.data; const data = {};
  keys(source, [...Object.keys(FIELDS[kind]), ...(kind === 'scribe' ? [...Object.keys(ENUMS), 'focus_areas', 'entity_kind'] : [])], 'Catalogue fields');
  for (const [field, limit] of Object.entries(FIELDS[kind])) data[field] = text(source[field], field.replaceAll('_', ' '), limit, { optional: true });
  if (kind === 'scribe') {
    data.entity_kind = choice(source.entity_kind, ['catgirl'], 'catgirl', 'Scribe identity');
    for (const [field, options] of Object.entries(ENUMS)) data[field] = choice(source[field], options, DEFAULTS[field], field.replaceAll('_', ' '));
    const focus = source.focus_areas === undefined ? [] : source.focus_areas;
    if (!Array.isArray(focus) || focus.length > FOCUS_AREAS.length || focus.some((item) => !FOCUS_AREAS.includes(item))) fail('Choose supported Scribe focus areas.');
    data.focus_areas = [...new Set(focus)];
  }
  return { name: text(value.name, 'Name', 200), description: text(value.description, 'Description', 2000, { optional: true }), data };
}
function snapshot(entry) {
  return { source_id: entry.id, source_revision: entry.revision, ...templateInput(entry.kind, { name: entry.name, description: entry.description, data: entry.data }) };
}
function validateSnapshot(value, kind) {
  keys(value, ['source_id', 'source_revision', 'name', 'description', 'data'], 'Frozen catalogue entry');
  text(value.source_id, 'Source ID', 80);
  if (!Number.isSafeInteger(value.source_revision) || value.source_revision < 0) fail('Invalid catalogue revision.');
  const normalized = templateInput(kind, { name: value.name, description: value.description, data: value.data });
  if (typeof value.description !== 'string' || !value.data || Object.keys(normalized.data).some((key) => !Object.hasOwn(value.data, key))) fail('Incomplete frozen catalogue entry.');
  if (Object.keys(FIELDS[kind]).some((key) => typeof value.data[key] !== 'string')) fail('Frozen catalogue text must be a string.');
  return value;
}
function validateLibrary(value, castIds) {
  keys(value, ['world', 'scribe', 'characters'], 'Story catalogue copies');
  if (value.world !== null) validateSnapshot(value.world, 'world');
  if (value.scribe !== null) validateSnapshot(value.scribe, 'scribe');
  if (!Array.isArray(value.characters) || value.characters.length > 24) fail('Invalid catalogue cast.');
  const seen = new Set();
  for (const entry of value.characters) {
    keys(entry, ['character_id', 'snapshot'], 'Frozen character');
    if (!castIds.includes(entry.character_id) || seen.has(entry.character_id)) fail('A catalogue copy must name one member of this cast.');
    seen.add(entry.character_id); validateSnapshot(entry.snapshot, 'character');
  }
  return value;
}
function visualTarget(state, kind, subjectId = null) {
  choice(kind, ['cover', 'world', 'character', 'scribe'], null, 'Image target');
  if (kind === 'character') {
    if (!state.cast.some((person) => person.id === subjectId)) fail('Choose a character in this story.');
  } else {
    if (subjectId !== null) fail('Only a character portrait has a character ID.');
    if (kind !== 'cover' && !state.library?.[kind]) fail(`This story has no selected ${kind}.`);
  }
  return `${kind}:${subjectId || ''}`;
}
function validateVisuals(value, state) {
  if (!Array.isArray(value) || value.length > 27) fail('A story supports at most 27 cover and reference images.');
  const seen = new Set();
  for (const item of value) {
    keys(item, ['kind', 'subject_id', 'asset_id', 'alt_text'], 'Story image');
    if (['kind', 'subject_id', 'asset_id', 'alt_text'].some((key) => !Object.hasOwn(item, key))) fail('Incomplete story image.');
    const target = visualTarget(state, item.kind, item.subject_id);
    if (seen.has(target)) fail('Duplicate story image target.');
    seen.add(target); text(item.asset_id, 'Image ID', 80); text(item.alt_text, 'Image description', 1000);
  }
  return value;
}
function imagePrompt(entry, direction) {
  const appearance = entry.data?.appearance || '';
  return [entry.kind === 'scribe' ? `Portrait of ${CATGIRL_CANON.definition}` : `Create a ${entry.kind === 'world' ? 'world reference image' : entry.kind === 'cover' ? 'story cover illustration' : 'character portrait'}.`,
    `Name: ${entry.name}`, `Visible description: ${entry.description}`, `Appearance: ${appearance}`,
    entry.kind === 'world' ? `Setting: ${entry.data.setting}` : '', entry.kind === 'scribe' ? `Feline traits: ${entry.data.feline_traits}` : '',
    `Art direction: ${direction}`, 'No text overlays. Do not invent secret story facts.'].filter(Boolean).join('\n');
}
module.exports = { KINDS, FIELDS, CATGIRL_CANON, ENUMS, DEFAULTS, FOCUS_AREAS, templateInput, snapshot, validateLibrary, validateVisuals, visualTarget, imagePrompt };
