'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { assertTechnicalInput, MAX_IMAGE_BYTES } = require('../imagery/art-store');

const PUBLICATION_FORMAT = 'ink-morrow-publication-document';
const PUBLICATION_SCHEMA_VERSION = 1;
const PUBLICATION_FORMATS = Object.freeze(['docx', 'odt', 'rtf', 'epub', 'pdf', 'html', 'md', 'txt', 'json']);
const INPUT_FIELDS = new Set(['metadata', 'front_matter', 'back_matter', 'art', 'expected_story_updated_at']);
const METADATA_FIELDS = new Set(['title', 'subtitle', 'author', 'language', 'description', 'publisher', 'rights', 'date']);
const MATTER_ROLES = new Set(['dedication', 'preface', 'acknowledgments', 'afterword', 'about-author', 'other']);

function publicationError(message, statusCode = 400, code = 'INVALID_PUBLICATION') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw publicationError(`${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length) throw publicationError(`${label} contains private or unsupported fields: ${unknown.join(', ')}.`, 400, 'PUBLICATION_FIELD_NOT_ALLOWED');
}

function text(value, { label, max, required = false, fallback = null } = {}) {
  if (value === undefined || value === null) {
    if (required && !fallback) throw publicationError(`${label} is required.`);
    return fallback;
  }
  if (typeof value !== 'string') throw publicationError(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw publicationError(`${label} is required.`);
  if (normalized.length > max) throw publicationError(`${label} must be ${max} characters or fewer.`);
  return normalized || fallback;
}

function blocksOf(value) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() });
    paragraph = [];
  };
  for (const line of normalized.split('\n')) {
    if (/^\s*(?:\*{3,}|-{3,}|#(?:\s+#){2,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'scene_break' });
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function normalizeMatter(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw publicationError(`${label} must be an array of at most 50 sections.`);
  return value.map((section, index) => {
    exactFields(section, new Set(['role', 'title', 'text']), `${label}[${index}]`);
    const role = text(section.role, { label: `${label}[${index}].role`, max: 40, required: true });
    if (!MATTER_ROLES.has(role)) throw publicationError(`${label}[${index}].role is not supported.`);
    const titleValue = text(section.title, { label: `${label}[${index}].title`, max: 300, fallback: '' });
    const content = text(section.text, { label: `${label}[${index}].text`, max: 1_000_000, fallback: '' });
    return { role, title: titleValue, blocks: blocksOf(content) };
  });
}

function normalizeInput(body, storyTitle) {
  const input = body === undefined ? {} : body;
  exactFields(input, INPUT_FIELDS, 'Publication request');
  const metadataInput = input.metadata === undefined ? {} : input.metadata;
  exactFields(metadataInput, METADATA_FIELDS, 'metadata');
  const language = text(metadataInput.language, { label: 'metadata.language', max: 40, fallback: 'en' });
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw publicationError('metadata.language must be a language tag such as en or en-GB.');
  const metadata = {
    title: text(metadataInput.title, { label: 'metadata.title', max: 300, required: true, fallback: storyTitle }),
    subtitle: text(metadataInput.subtitle, { label: 'metadata.subtitle', max: 300 }),
    author: text(metadataInput.author, { label: 'metadata.author', max: 300, fallback: '' }),
    language,
    description: text(metadataInput.description, { label: 'metadata.description', max: 4000 }),
    publisher: text(metadataInput.publisher, { label: 'metadata.publisher', max: 300 }),
    rights: text(metadataInput.rights, { label: 'metadata.rights', max: 1000 }),
    date: text(metadataInput.date, { label: 'metadata.date', max: 40 }),
  };
  const artInput = input.art === undefined ? { asset_ids: [] } : input.art;
  exactFields(artInput, new Set(['asset_ids']), 'art');
  if (!Array.isArray(artInput.asset_ids) || artInput.asset_ids.length > 1000 ||
      artInput.asset_ids.some((id) => typeof id !== 'string' || !id.trim())) {
    throw publicationError('art.asset_ids must be an array of at most 1000 asset IDs.');
  }
  return {
    metadata,
    frontMatter: normalizeMatter(input.front_matter, 'front_matter'),
    backMatter: normalizeMatter(input.back_matter, 'back_matter'),
    selectedAssetIds: [...new Set(artInput.asset_ids)],
    expectedStoryUpdatedAt: input.expected_story_updated_at === undefined
      ? null
      : text(input.expected_story_updated_at, { label: 'expected_story_updated_at', max: 80, required: true }),
  };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function hashDocument(document) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

function validatePublicationDocument(document) {
  const invalid = (detail) => publicationError(`Publication document is invalid: ${detail}.`, 400, 'PUBLICATION_DOCUMENT_INVALID');
  const fields = (value, allowed, label, required = allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be an object`);
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid(`${label} contains an unknown field`);
    if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) throw invalid(`${label} is missing a required field`);
  };
  const bounded = (value, max, { nullable = false, required = false } = {}) => {
    if (nullable && (value === null || value === undefined)) return true;
    return typeof value === 'string' && value.length <= max && (!required || value.length > 0);
  };
  fields(document, ['format', 'schema_version', 'metadata', 'front_matter', 'volumes', 'back_matter', 'assets'], 'document');
  if (document.format !== PUBLICATION_FORMAT || document.schema_version !== PUBLICATION_SCHEMA_VERSION) {
    throw invalid('format or schema version is unsupported');
  }
  fields(document.metadata, [...METADATA_FIELDS], 'metadata', ['title', 'author', 'language']);
  if (!bounded(document.metadata.title, 300, { required: true }) ||
      !bounded(document.metadata.author, 300) ||
      !bounded(document.metadata.language, 40, { required: true }) ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(document.metadata.language) ||
      !bounded(document.metadata.subtitle, 300, { nullable: true }) ||
      !bounded(document.metadata.description, 4000, { nullable: true }) ||
      !bounded(document.metadata.publisher, 300, { nullable: true }) ||
      !bounded(document.metadata.rights, 1000, { nullable: true }) ||
      !bounded(document.metadata.date, 40, { nullable: true })) {
    throw invalid('metadata does not match schema 1');
  }

  if (!Array.isArray(document.assets) || document.assets.length > 1000) throw invalid('assets are not bounded');
  const assetKeys = new Set();
  for (const [index, asset] of document.assets.entries()) {
    const label = `assets[${index}]`;
    fields(asset, ['key', 'media_type', 'sha256', 'width', 'height', 'title', 'alt_text', 'content_base64'], label);
    if (!/^asset-[1-9][0-9]*$/.test(asset.key) || assetKeys.has(asset.key) ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(asset.media_type) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.width) || asset.width < 1 || asset.width > 4096 ||
        !Number.isSafeInteger(asset.height) || asset.height < 1 || asset.height > 4096 ||
        !bounded(asset.title, 300, { nullable: true }) || !bounded(asset.alt_text, 1000) ||
        typeof asset.content_base64 !== 'string' ||
        asset.content_base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.content_base64)) {
      throw invalid(`${label} does not match schema 1`);
    }
    const content = Buffer.from(asset.content_base64, 'base64');
    if (content.toString('base64') !== asset.content_base64 ||
        createHash('sha256').update(content).digest('hex') !== asset.sha256) {
      throw invalid(`${label} bytes do not match their digest`);
    }
    try { assertTechnicalInput(content, asset.media_type); }
    catch { throw invalid(`${label} is not an exact safe raster container`); }
    assetKeys.add(asset.key);
  }

  let pageCount = 0;
  let blockCount = 0;
  const blockList = (blocks, label) => {
    if (!Array.isArray(blocks)) throw invalid(`${label} must be an array`);
    blockCount += blocks.length;
    if (blockCount > 2_000_000) throw invalid('block count exceeds the supported limit');
    for (const [index, block] of blocks.entries()) {
      const blockLabel = `${label}[${index}]`;
      if (!block || typeof block !== 'object' || Array.isArray(block)) throw invalid(`${blockLabel} must be an object`);
      if (block.type === 'paragraph') {
        fields(block, ['type', 'text'], blockLabel);
        if (!bounded(block.text, 1_000_000)) throw invalid(`${blockLabel} contains invalid prose`);
      } else if (block.type === 'scene_break') {
        fields(block, ['type'], blockLabel);
      } else if (block.type === 'art') {
        fields(block, ['type', 'asset_key', 'alt_text', 'position'], blockLabel);
        if (!assetKeys.has(block.asset_key) || !bounded(block.alt_text, 1000) ||
            !['before', 'after'].includes(block.position)) throw invalid(`${blockLabel} contains an invalid art reference`);
      } else {
        throw invalid(`${blockLabel} has an unsupported type`);
      }
    }
  };
  const matter = (sections, label) => {
    if (!Array.isArray(sections) || sections.length > 50) throw invalid(`${label} is not bounded`);
    for (const [index, section] of sections.entries()) {
      fields(section, ['role', 'title', 'blocks'], `${label}[${index}]`);
      if (!MATTER_ROLES.has(section.role) || !bounded(section.title, 300)) throw invalid(`${label}[${index}] does not match schema 1`);
      blockList(section.blocks, `${label}[${index}].blocks`);
    }
  };
  matter(document.front_matter, 'front_matter');
  matter(document.back_matter, 'back_matter');
  if (!Array.isArray(document.volumes) || document.volumes.length > 1000) throw invalid('volumes are not bounded');
  for (const [volumeIndex, volume] of document.volumes.entries()) {
    fields(volume, ['ordinal', 'title', 'chapters'], `volumes[${volumeIndex}]`);
    if (!Number.isSafeInteger(volume.ordinal) || volume.ordinal < 1 || !bounded(volume.title, 300) ||
        !Array.isArray(volume.chapters) || volume.chapters.length > 10_000) throw invalid(`volumes[${volumeIndex}] does not match schema 1`);
    for (const [chapterIndex, chapter] of volume.chapters.entries()) {
      const label = `volumes[${volumeIndex}].chapters[${chapterIndex}]`;
      fields(chapter, ['ordinal', 'title', 'pages'], label);
      if (!Number.isSafeInteger(chapter.ordinal) || chapter.ordinal < 1 || !bounded(chapter.title, 300) || !Array.isArray(chapter.pages)) {
        throw invalid(`${label} does not match schema 1`);
      }
      pageCount += chapter.pages.length;
      if (pageCount > 100_000) throw invalid('page count exceeds the supported limit');
      for (const [pageIndex, page] of chapter.pages.entries()) {
        const pageLabel = `${label}.pages[${pageIndex}]`;
        fields(page, ['ordinal', 'blocks'], pageLabel);
        if (!Number.isSafeInteger(page.ordinal) || page.ordinal < 1) throw invalid(`${pageLabel} has an invalid ordinal`);
        blockList(page.blocks, `${pageLabel}.blocks`);
      }
    }
  }
  return document;
}

function createPublicationService({ db, stories, artStore }) {
  const insertSnapshot = db.prepare(`
    INSERT INTO publication_snapshots (id, story_id, schema_version, document_json, sha256)
    VALUES (?, ?, ?, ?, ?)
  `);

  function storyRows(storyId) {
    return db.prepare(`
      SELECT volume.ordinal AS volume_ordinal, volume.title AS volume_title,
             chapter.ordinal AS chapter_ordinal, chapter.title AS chapter_title,
             page.id AS page_id, page.ordinal AS page_ordinal,
             display.content AS display_content
        FROM volumes volume
        JOIN chapters chapter ON chapter.volume_id = volume.id
        LEFT JOIN pages page ON page.chapter_id = chapter.id
        LEFT JOIN page_revisions display ON display.id = page.display_revision_id
       WHERE volume.story_id = ?
       ORDER BY volume.ordinal, chapter.ordinal, page.ordinal
    `).all(storyId);
  }

  function snapshot(storyId, body = {}) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const story = stories.getStory(storyId);
      if (!story) throw publicationError('Story not found.', 404, 'STORY_NOT_FOUND');
      const input = normalizeInput(body, story.title);
      if (input.expectedStoryUpdatedAt && input.expectedStoryUpdatedAt !== story.updated_at) {
        throw publicationError('The story changed after publication review. Review it again.', 409, 'PUBLICATION_STORY_CHANGED');
      }

      const selected = new Set(input.selectedAssetIds);
      const art = artStore.list(storyId);
      const assetById = new Map(art.assets.map((asset) => [asset.id, asset]));
      const placedIds = new Set(art.placements.map((placement) => placement.asset_id));
      for (const id of selected) {
        if (!assetById.has(id)) throw publicationError(`Selected art ${id} does not exist.`, 400, 'PUBLICATION_ART_MISSING');
        if (!placedIds.has(id)) throw publicationError(`Selected art ${id} is not placed in the manuscript.`, 400, 'PUBLICATION_ART_UNPLACED');
      }

      const assets = [];
      const keyByAssetId = new Map();
      const warnings = [];
      for (const id of input.selectedAssetIds) {
        const asset = assetById.get(id);
        const content = artStore.readAsset(storyId, id);
        if (!content) throw publicationError(`Selected art ${id} is unavailable.`, 409, 'PUBLICATION_ART_UNAVAILABLE');
        const key = `asset-${assets.length + 1}`;
        const altText = String(asset.alt_text || '').trim();
        if (!altText) warnings.push({ code: 'ART_ALT_TEXT_MISSING', asset_key: key, message: 'Selected art has no accessible description.' });
        keyByAssetId.set(id, key);
        assets.push({
          key,
          media_type: asset.media_type,
          sha256: asset.sha256,
          width: Number(asset.width),
          height: Number(asset.height),
          title: asset.title || null,
          alt_text: altText,
          content_base64: content.buffer.toString('base64'),
        });
      }

      const placementsByPage = new Map();
      const beforeStory = [];
      for (const placement of art.placements) {
        if (!selected.has(placement.asset_id)) continue;
        const asset = assetById.get(placement.asset_id);
        const block = {
          type: 'art',
          asset_key: keyByAssetId.get(placement.asset_id),
          alt_text: String(asset.alt_text || '').trim(),
          position: placement.after_page_id === null ? 'before' : 'after',
        };
        if (placement.after_page_id === null) beforeStory.push({ ordinal: placement.ordinal, block });
        else {
          if (!placementsByPage.has(placement.after_page_id)) placementsByPage.set(placement.after_page_id, []);
          placementsByPage.get(placement.after_page_id).push({ ordinal: placement.ordinal, block });
        }
      }
      beforeStory.sort((left, right) => left.ordinal - right.ordinal);
      for (const list of placementsByPage.values()) list.sort((left, right) => left.ordinal - right.ordinal);

      const volumes = [];
      let currentVolume;
      let currentChapter;
      for (const row of storyRows(storyId)) {
        if (!currentVolume || currentVolume.ordinal !== row.volume_ordinal) {
          currentVolume = { ordinal: row.volume_ordinal, title: row.volume_title || '', chapters: [] };
          volumes.push(currentVolume);
          currentChapter = null;
        }
        if (!currentChapter || currentChapter.ordinal !== row.chapter_ordinal) {
          currentChapter = { ordinal: row.chapter_ordinal, title: row.chapter_title || '', pages: [] };
          currentVolume.chapters.push(currentChapter);
        }
        if (row.page_id) {
          const blocks = blocksOf(row.display_content);
          for (const item of placementsByPage.get(row.page_id) || []) blocks.push(item.block);
          currentChapter.pages.push({ ordinal: row.page_ordinal, blocks });
        }
      }
      if (beforeStory.length) {
        const firstChapter = volumes[0]?.chapters[0];
        if (!firstChapter) throw publicationError('The manuscript hierarchy is incomplete.', 409, 'PUBLICATION_HIERARCHY_INVALID');
        if (!firstChapter.pages.length) firstChapter.pages.push({ ordinal: 1, blocks: [] });
        firstChapter.pages[0].blocks.unshift(...beforeStory.map((item) => item.block));
      }

      const document = freeze({
        format: PUBLICATION_FORMAT,
        schema_version: PUBLICATION_SCHEMA_VERSION,
        metadata: input.metadata,
        front_matter: input.frontMatter,
        volumes,
        back_matter: input.backMatter,
        assets,
      });
      validatePublicationDocument(document);
      const documentJson = JSON.stringify(document);
      const sha256 = hashDocument(document);
      const id = randomUUID();
      insertSnapshot.run(id, storyId, PUBLICATION_SCHEMA_VERSION, documentJson, sha256);
      const record = db.prepare('SELECT created_at FROM publication_snapshots WHERE id = ?').get(id);
      db.exec('COMMIT');
      return freeze({ id, sha256, created_at: record.created_at, warnings, document });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* original error wins */ }
      throw error;
    }
  }

  function get(snapshotId) {
    const row = db.prepare('SELECT id, story_id, schema_version, document_json, sha256, created_at FROM publication_snapshots WHERE id = ?').get(snapshotId);
    if (!row) return null;
    const document = JSON.parse(row.document_json);
    let valid = true;
    try { validatePublicationDocument(document); } catch { valid = false; }
    if (!valid || row.schema_version !== PUBLICATION_SCHEMA_VERSION || hashDocument(document) !== row.sha256) {
      throw publicationError('The publication snapshot failed its integrity check.', 500, 'PUBLICATION_INTEGRITY_FAILED');
    }
    return freeze({ id: row.id, sha256: row.sha256, created_at: row.created_at, document });
  }

  return { snapshot, get, formats: PUBLICATION_FORMATS };
}

module.exports = {
  PUBLICATION_FORMAT,
  PUBLICATION_SCHEMA_VERSION,
  PUBLICATION_FORMATS,
  blocksOf,
  freeze,
  hashDocument,
  validatePublicationDocument,
  createPublicationService,
};
