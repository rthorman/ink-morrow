'use strict';

// Public archive contract.  The ZIP is deliberately made of ordinary JSON
// and media files: future versions can migrate it without ever depending on
// a particular SQLite layout.

const crypto = require('crypto');
const {
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  ARCHIVE_EXTENSION,
} = require('../../release');
const ARCHIVE_MANIFEST_SCHEMA = require('./archive-manifest-v2.schema.json');
const ENTITY_KINDS = new Set(['world', 'character', 'story']);
const EXPORT_SCOPES = new Set(['world', 'character', 'story', 'full']);

const WORLD_FIELDS = [
  'id', 'name', 'description', 'genre', 'setting', 'lore', 'image_prompt',
  'image_status', 'image_media_type', 'image_cost_usd', 'image_updated_at',
  'created_at', 'updated_at',
];
const CHARACTER_FIELDS = [
  'id', 'name', 'description', 'personality', 'appearance', 'background',
  'world_id', 'image_prompt', 'image_status', 'image_media_type',
  'image_cost_usd', 'image_updated_at', 'created_at', 'updated_at',
];
const STORY_FIELDS = [
  'id', 'title', 'world_id', 'characters', 'tone', 'image_prompt',
  'continuity_overrides', 'image_status', 'image_media_type',
  'image_cost_usd', 'image_updated_at', 'created_at', 'updated_at',
];
const PAGE_FIELDS = [
  'id', 'story_id', 'page_number', 'content', 'user_input', 'model',
  'prompt_tokens', 'completion_tokens', 'cost_usd', 'image_media_type',
  'image_prompt', 'continuity_model', 'continuity_prompt_tokens',
  'continuity_completion_tokens', 'continuity_cost_usd', 'created_at',
];
const VOLUME_FIELDS = [
  'id', 'story_id', 'ordinal', 'title', 'created_at', 'updated_at',
];
const CHAPTER_FIELDS = [
  'id', 'volume_id', 'ordinal', 'title', 'created_at', 'updated_at',
];
const HIERARCHY_PAGE_FIELDS = [
  'id', 'chapter_id', 'ordinal', 'canonical_revision_id',
  'display_revision_id', 'created_at', 'updated_at',
];
const REVISION_FIELDS = [
  'id', 'page_id', 'parent_revision_id', 'kind', 'content', 'direction',
  'source', 'model', 'prompt_tokens', 'completion_tokens', 'cost_usd',
  'created_at',
];
const SNAPSHOT_FIELDS = [
  'story_id', 'character_id', 'name', 'description', 'personality',
  'appearance', 'background', 'source_updated_at', 'created_at',
];
const MEMORY_FIELDS = [
  'page_id', 'story_id', 'content_hash', 'status', 'summary', 'delta_json',
  'model', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'error',
  'schema_version', 'created_at', 'updated_at',
];
const PREVIEW_FIELDS = [
  'story_id', 'expected_page', 'raw_content', 'model', 'prompt_tokens',
  'completion_tokens', 'cost_usd', 'created_at',
];
const AUDIOBOOK_FIELDS = [
  'story_id', 'model', 'voice', 'status', 'pages_done', 'pages_total',
  'size_bytes', 'duration_s', 'cost_usd', 'fingerprint', 'error',
  'created_at', 'updated_at',
];

function pick(row, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row || {}, field)) result[field] = row[field];
  }
  return result;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(canonicalJson(value) + '\n', 'utf8');
}

function safeSlug(value, fallback = 'scribe-tribe') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return slug || fallback;
}

function archiveFilename(scope, name) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safeSlug(name || (scope === 'full' ? 'scribe-tribe-backup' : scope))}-${stamp}${ARCHIVE_EXTENSION}`;
}

function cleanImageFields(record, { hasVisual, includeWorkingHistory }) {
  record.image_status = hasVisual ? 'ready' : 'none';
  if (!hasVisual) record.image_media_type = null;
  if (!includeWorkingHistory) {
    record.image_prompt = null;
    record.image_cost_usd = null;
    record.image_updated_at = null;
  }
  return record;
}

function worldRecord(row, options) {
  return cleanImageFields(pick(row, WORLD_FIELDS), options);
}

function characterRecord(row, options) {
  return cleanImageFields(pick(row, CHARACTER_FIELDS), options);
}

function storyRecord(row, options) {
  const record = cleanImageFields(pick(row, STORY_FIELDS), options);
  record.characters = parseJson(record.characters, []);
  record.continuity_overrides = parseJson(record.continuity_overrides, {});
  return record;
}

function pageRecord(row, { includeWorkingHistory }) {
  const page = pick(row, PAGE_FIELDS);
  if (!includeWorkingHistory) {
    page.user_input = null;
    page.model = null;
    page.prompt_tokens = null;
    page.completion_tokens = null;
    page.cost_usd = null;
    page.image_prompt = null;
    page.continuity_model = null;
    page.continuity_prompt_tokens = null;
    page.continuity_completion_tokens = null;
    page.continuity_cost_usd = 0;
  }
  return page;
}

function volumeRecord(row) {
  return pick(row, VOLUME_FIELDS);
}

function chapterRecord(row) {
  return pick(row, CHAPTER_FIELDS);
}

function hierarchyPageRecord(row) {
  return pick(row, HIERARCHY_PAGE_FIELDS);
}

function revisionRecord(row, { includeWorkingHistory }) {
  const revision = pick(row, REVISION_FIELDS);
  if (!includeWorkingHistory) {
    revision.direction = null;
    revision.model = null;
    revision.prompt_tokens = null;
    revision.completion_tokens = null;
    revision.cost_usd = 0;
  }
  return revision;
}

function snapshotRecord(row) {
  return pick(row, SNAPSHOT_FIELDS);
}

function memoryRecord(row, { includeWorkingHistory }) {
  const memory = pick(row, MEMORY_FIELDS);
  if (!includeWorkingHistory) {
    memory.model = null;
    memory.prompt_tokens = null;
    memory.completion_tokens = null;
    memory.cost_usd = 0;
    memory.error = null;
  }
  return memory;
}

function previewRecord(row) {
  return pick(row, PREVIEW_FIELDS);
}

function audiobookRecord(row, { includeWorkingHistory } = {}) {
  const audiobook = pick(row, AUDIOBOOK_FIELDS);
  if (!includeWorkingHistory) audiobook.cost_usd = 0;
  return audiobook;
}

function without(object, keys) {
  const result = { ...object };
  for (const key of keys) delete result[key];
  return result;
}

// Semantic equality is deliberately independent of timestamps, an entity's
// own primary id, and transient image status. Story pages are compared by
// order; dependency ids remain meaningful so differently linked graphs are
// never collapsed into one collision result.
function semanticEntity(kind, bundle, { includeHierarchy = true } = {}) {
  if (kind === 'world') {
    return without(bundle.record, [
      'id', 'created_at', 'updated_at', 'image_status', 'image_media_type',
      'image_cost_usd', 'image_updated_at',
    ]);
  }
  if (kind === 'character') {
    return without(bundle.record, [
      'id', 'created_at', 'updated_at', 'image_status', 'image_media_type',
      'image_cost_usd', 'image_updated_at',
    ]);
  }
  const pageNumberById = new Map((bundle.pages || []).map((page) => [page.id, page.page_number]));
  const hierarchy = bundle.hierarchy || { volumes: [], chapters: [], pages: [] };
  const chaptersByVolume = new Map();
  for (const chapter of hierarchy.chapters || []) {
    if (!chaptersByVolume.has(chapter.volume_id)) chaptersByVolume.set(chapter.volume_id, []);
    chaptersByVolume.get(chapter.volume_id).push(chapter);
  }
  const hierarchyPagesByChapter = new Map();
  for (const page of hierarchy.pages || []) {
    if (!hierarchyPagesByChapter.has(page.chapter_id)) hierarchyPagesByChapter.set(page.chapter_id, []);
    hierarchyPagesByChapter.get(page.chapter_id).push(page);
  }
  const semanticHierarchy = (hierarchy.volumes || [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((volume) => ({
      ordinal: volume.ordinal,
      title: volume.title,
      chapters: (chaptersByVolume.get(volume.id) || [])
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((chapter) => ({
          ordinal: chapter.ordinal,
          title: chapter.title,
          pages: (hierarchyPagesByChapter.get(chapter.id) || [])
            .slice()
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((page) => pageNumberById.get(page.id) || null),
        })),
    }));
  const revisionsByPage = new Map();
  for (const revision of bundle.revisions || []) {
    if (!revisionsByPage.has(revision.page_id)) revisionsByPage.set(revision.page_id, []);
    revisionsByPage.get(revision.page_id).push(revision);
  }
  const hierarchyPageById = new Map((hierarchy.pages || []).map((page) => [page.id, page]));
  const semanticRevisions = (bundle.pages || []).map((page) => {
    const rows = (revisionsByPage.get(page.id) || []).slice()
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || left.id.localeCompare(right.id));
    const indexById = new Map(rows.map((row, index) => [row.id, index + 1]));
    const placement = hierarchyPageById.get(page.id) || {};
    return {
      page_number: page.page_number,
      canonical: indexById.get(placement.canonical_revision_id) || null,
      display: indexById.get(placement.display_revision_id) || null,
      revisions: rows.map((row) => ({
        parent: indexById.get(row.parent_revision_id) || null,
        kind: row.kind,
        content: row.content,
        direction: row.direction,
        source: row.source,
        model: row.model,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        cost_usd: row.cost_usd,
      })),
    };
  });
  return {
    record: without(bundle.record, [
      'id', 'created_at', 'updated_at', 'image_status', 'image_media_type',
      'image_cost_usd', 'image_updated_at',
    ]),
    pages: (bundle.pages || []).map((page) => without(page, ['id', 'story_id', 'created_at'])),
    ...(includeHierarchy ? { hierarchy: semanticHierarchy } : {}),
    revisions: semanticRevisions,
    snapshots: (bundle.snapshots || []).map((row) => without(row, ['story_id', 'created_at'])),
    memory: (bundle.memory || []).map((row) => ({
      ...without(row, ['page_id', 'story_id', 'created_at', 'updated_at']),
      page_number: pageNumberById.get(row.page_id) || null,
    })),
    preview: bundle.preview ? without(bundle.preview, ['story_id', 'created_at']) : null,
    audiobook: bundle.audiobook ? without(bundle.audiobook, ['story_id', 'created_at', 'updated_at', 'fingerprint']) : null,
  };
}

function semanticHash(kind, bundle, options) {
  return sha256(canonicalJson(semanticEntity(kind, bundle, options)));
}

const ALLOWED_SETTING_KEYS = new Set([
  'model', 'scriptoriumBg', 'costTicker', 'storyFont', 'wordsPerPage',
  'narrationModel', 'narrationVoice', 'reasoningEffort', 'storyFontSize',
  'sceneRenderQuality',
]);
const STORY_FONTS = new Set(['literata', 'cormorant', 'georgia', 'inter', 'mono']);
const REASONING = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);

function boundedString(value, max = 500) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function sanitizeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const clean = {};
  for (const key of ALLOWED_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (key === 'scriptoriumBg' || key === 'costTicker') clean[key] = Boolean(value);
    else if (key === 'wordsPerPage') clean[key] = Math.min(2000, Math.max(50, parseInt(value, 10) || 400));
    else if (key === 'storyFontSize') clean[key] = Math.min(24, Math.max(14, parseInt(value, 10) || 18));
    else if (key === 'storyFont' && STORY_FONTS.has(value)) clean[key] = value;
    else if (key === 'sceneRenderQuality' && ['low_1k', 'medium_2k'].includes(value)) clean[key] = value;
    else if (key === 'reasoningEffort') clean[key] = REASONING.has(value) ? value : null;
    else clean[key] = boundedString(value);
  }
  return clean;
}

function validId(value) {
  // Entity/page ids become filenames for paintings and audio after import.
  // Archives therefore accept only opaque path-safe ids (native ids are UUIDs).
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);
}

module.exports = {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_EXTENSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  ARCHIVE_MANIFEST_SCHEMA,
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  ENTITY_KINDS,
  EXPORT_SCOPES,
  WORLD_FIELDS,
  CHARACTER_FIELDS,
  STORY_FIELDS,
  PAGE_FIELDS,
  VOLUME_FIELDS,
  CHAPTER_FIELDS,
  HIERARCHY_PAGE_FIELDS,
  REVISION_FIELDS,
  SNAPSHOT_FIELDS,
  MEMORY_FIELDS,
  PREVIEW_FIELDS,
  AUDIOBOOK_FIELDS,
  pick,
  canonicalJson,
  jsonBuffer,
  sha256,
  safeSlug,
  archiveFilename,
  worldRecord,
  characterRecord,
  storyRecord,
  pageRecord,
  volumeRecord,
  chapterRecord,
  hierarchyPageRecord,
  revisionRecord,
  snapshotRecord,
  memoryRecord,
  previewRecord,
  audiobookRecord,
  semanticHash,
  sanitizeSettings,
  validId,
};
