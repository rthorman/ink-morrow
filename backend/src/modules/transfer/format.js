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
const CONTINUITY_DELTA_FIELDS = [
  'revision_id', 'story_id', 'status', 'schema_version', 'delta_json',
  'provider_result_json', 'spend_usd', 'error_code', 'created_at', 'updated_at',
  'content_hash', 'summary', 'model', 'prompt_tokens', 'completion_tokens', 'error',
];
const TEMPLATE_SNAPSHOT_FIELDS = [
  'id', 'story_id', 'template_kind', 'source_template_id', 'source_revision',
  'snapshot_json', 'created_at',
];
const CORRECTION_FIELDS = [
  'id', 'story_id', 'scope', 'subject_id', 'correction_json', 'created_at', 'updated_at',
];
const AUTHOR_CANON_ENTRY_FIELDS = [
  'id', 'story_id', 'kind', 'subject_id', 'status', 'created_at', 'updated_at',
];
const AUTHOR_CANON_REVISION_FIELDS = [
  'id', 'entry_id', 'revision_number', 'title', 'value_json', 'note', 'created_at',
];
const PREVIEW_FIELDS = [
  'story_id', 'expected_page', 'raw_content', 'model', 'prompt_tokens',
  'completion_tokens', 'cost_usd', 'created_at',
];
// Writer-session and lease identities are deliberately absent from portable
// archives. They are process-local coordination data, not project history.
const WRITING_OPERATION_FIELDS = [
  'id', 'story_id', 'sequence', 'idempotency_key', 'request_hash', 'kind',
  'status', 'expected_tail_page_id', 'expected_tail_revision_id',
  'context_fingerprint', 'request_json', 'provider_result_json', 'result_json',
  'spend_usd', 'billed_attempts', 'error_code', 'error_message', 'created_at',
  'updated_at', 'finished_at',
];
const PREPARED_PAGE_FIELDS = [
  'story_id', 'id', 'operation_id', 'expected_page', 'expected_tail_page_id',
  'expected_tail_revision_id', 'context_fingerprint', 'context_json', 'content',
  'provider_result_json', 'spend_usd', 'created_at', 'updated_at',
];
const AUDIOBOOK_FIELDS = [
  'story_id', 'model', 'voice', 'status', 'pages_done', 'pages_total',
  'size_bytes', 'duration_s', 'cost_usd', 'fingerprint', 'error',
  'created_at', 'updated_at',
];
const ART_ASSET_FIELDS = [
  'id', 'story_id', 'source', 'status', 'source_media_type', 'media_type',
  'sha256', 'size_bytes', 'width', 'height', 'title', 'alt_text',
  'metadata_json', 'provider_result_json', 'spend_usd', 'created_at', 'updated_at',
];
const ASSET_PLACEMENT_FIELDS = [
  'id', 'story_id', 'asset_id', 'after_page_id', 'ordinal', 'created_at', 'updated_at',
];
const PUBLICATION_SNAPSHOT_FIELDS = [
  'id', 'story_id', 'schema_version', 'document_json', 'sha256', 'created_at',
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

function safeSlug(value, fallback = 'ink-morrow') {
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
  return `${safeSlug(name || (scope === 'full' ? 'ink-morrow-backup' : scope))}-${stamp}${ARCHIVE_EXTENSION}`;
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

function continuityDeltaRecord(row, { includeWorkingHistory }) {
  const delta = pick(row, CONTINUITY_DELTA_FIELDS);
  if (!includeWorkingHistory) {
    delta.provider_result_json = null;
    delta.spend_usd = 0;
    delta.model = null;
    delta.prompt_tokens = null;
    delta.completion_tokens = null;
    delta.error = null;
    delta.error_code = null;
  }
  return delta;
}

function templateSnapshotRecord(row) {
  return pick(row, TEMPLATE_SNAPSHOT_FIELDS);
}

function correctionRecord(row) {
  return pick(row, CORRECTION_FIELDS);
}

function authorCanonEntryRecord(row) {
  return pick(row, AUTHOR_CANON_ENTRY_FIELDS);
}

function authorCanonRevisionRecord(row) {
  return pick(row, AUTHOR_CANON_REVISION_FIELDS);
}

function previewRecord(row) {
  return pick(row, PREVIEW_FIELDS);
}

function writingOperationRecord(row) {
  return pick(row, WRITING_OPERATION_FIELDS);
}

function preparedPageRecord(row) {
  return pick(row, PREPARED_PAGE_FIELDS);
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
function semanticEntity(kind, bundle, { includeHierarchy = true, includeArtStore = true } = {}) {
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
  const assetIndexById = new Map((bundle.art_assets || []).map((asset, index) => [asset.id, index + 1]));
  const semanticAssets = (bundle.art_assets || []).map((asset) => without(asset, [
    'id', 'story_id', 'created_at', 'updated_at', 'provider_reference_allowed',
  ]));
  const semanticPlacements = (bundle.asset_placements || []).map((placement) => ({
    asset: assetIndexById.get(placement.asset_id) || null,
    after_page_number: pageNumberById.get(placement.after_page_id) || null,
    ordinal: placement.ordinal,
  }));
  return {
    record: without(bundle.record, [
      'id', 'created_at', 'updated_at', 'image_status', 'image_media_type',
      'image_cost_usd', 'image_updated_at',
    ]),
    pages: (bundle.pages || []).map((page) => without(page, ['id', 'story_id', 'created_at'])),
    ...(includeHierarchy ? { hierarchy: semanticHierarchy } : {}),
    revisions: semanticRevisions,
    ...(includeArtStore ? {
      art_assets: semanticAssets,
      asset_placements: semanticPlacements,
    } : {}),
    snapshots: (bundle.snapshots || []).map((row) => without(row, ['story_id', 'created_at'])),
    template_snapshots: (bundle.template_snapshots || []).map((row) => without(row, ['id', 'story_id', 'created_at'])),
    memory: (bundle.memory || []).map((row) => ({
      ...without(row, ['page_id', 'story_id', 'created_at', 'updated_at']),
      page_number: pageNumberById.get(row.page_id) || null,
    })),
    continuity_deltas: (bundle.continuity_deltas || []).map((row) =>
      without(row, ['story_id', 'created_at', 'updated_at'])),
    corrections: (bundle.corrections || []).map((row) =>
      without(row, ['id', 'story_id', 'created_at', 'updated_at'])),
    author_canon_entries: (bundle.author_canon_entries || []).map((row) =>
      without(row, ['id', 'story_id', 'created_at', 'updated_at'])),
    author_canon_revisions: (bundle.author_canon_revisions || []).map((row) =>
      without(row, ['id', 'entry_id', 'created_at'])),
    writing_operations: (bundle.writing_operations || []).map((row) => {
      const request = parseJson(row.request_json, {});
      if (request?.page_id) request.page_number = pageNumberById.get(request.page_id) || null;
      if (request && typeof request === 'object') delete request.page_id;
      return {
        sequence: row.sequence,
        idempotency_key: row.idempotency_key,
        kind: row.kind,
        status: row.status,
        expected_tail_page_number: pageNumberById.get(row.expected_tail_page_id) || null,
        request,
        provider_result: parseJson(row.provider_result_json, null),
        spend_usd: row.spend_usd,
        billed_attempts: row.billed_attempts,
        error_code: row.error_code,
        error_message: row.error_message,
      };
    }),
    prepared_page: bundle.prepared_page ? {
      expected_page: bundle.prepared_page.expected_page,
      expected_tail_page_number: pageNumberById.get(bundle.prepared_page.expected_tail_page_id) || null,
      generation: parseJson(bundle.prepared_page.context_json, {})?.generation || {},
      content: bundle.prepared_page.content,
      provider_result: parseJson(bundle.prepared_page.provider_result_json, null),
      spend_usd: bundle.prepared_page.spend_usd,
    } : null,
    // `preview` is the schema-1..5 compatibility shape.
    preview: bundle.preview ? without(bundle.preview, ['story_id', 'created_at']) : null,
    audiobook: bundle.audiobook ? without(bundle.audiobook, ['story_id', 'created_at', 'updated_at', 'fingerprint']) : null,
    publication_snapshots: (bundle.publication_snapshots || []).map((row) => ({
      schema_version: row.schema_version,
      sha256: row.sha256,
      document: parseJson(row.document_json, null),
    })),
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
  CONTINUITY_DELTA_FIELDS,
  TEMPLATE_SNAPSHOT_FIELDS,
  CORRECTION_FIELDS,
  AUTHOR_CANON_ENTRY_FIELDS,
  AUTHOR_CANON_REVISION_FIELDS,
  PREVIEW_FIELDS,
  WRITING_OPERATION_FIELDS,
  PREPARED_PAGE_FIELDS,
  AUDIOBOOK_FIELDS,
  ART_ASSET_FIELDS,
  ASSET_PLACEMENT_FIELDS,
  PUBLICATION_SNAPSHOT_FIELDS,
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
  continuityDeltaRecord,
  templateSnapshotRecord,
  correctionRecord,
  authorCanonEntryRecord,
  authorCanonRevisionRecord,
  previewRecord,
  writingOperationRecord,
  preparedPageRecord,
  audiobookRecord,
  semanticHash,
  sanitizeSettings,
  validId,
};
