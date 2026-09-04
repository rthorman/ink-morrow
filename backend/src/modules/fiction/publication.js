'use strict';

const { PUBLICATION_FORMAT, PUBLICATION_SCHEMA_VERSION, blocksOf, validatePublicationDocument } = require('../publication/document');
const { renderPublication } = require('../publication/adapters');
const { keys, text, fail } = require('./model');

// The game supplies one reader-safe PublicationDocument to every adapter.
// No transcript, directions, private state, other paths or credentials travel.
function createFictionPublication({ store, media }) {
  let exporting = false;
  function document(gameId, input = {}) {
    keys(input, ['author', 'language', 'expected_revision', 'branch_id'], 'Book metadata');
    const author = text(input.author, 'Author credit', 300, { optional: true });
    const language = input.language === undefined ? 'en' : text(input.language, 'Language', 40);
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail('Use a language tag such as en or en-GB.');
    const { game, branch, state } = store.current(gameId);
    if ((input.expected_revision !== undefined && (!/^\d+$/.test(String(input.expected_revision)) || Number(input.expected_revision) !== game.revision)) ||
        (input.branch_id !== undefined && input.branch_id !== branch.id)) fail('The reading path changed. Reopen export before downloading.', 'STORY_CHANGED', 409);
    const rows = store.publicationRows(gameId, branch.head_beat_id);
    const placements = new Map((state.illustrations || []).map((item) => [item.beat_id, item]));
    const assets = []; const chapters = []; const assetKeys = new Map(); let byteCount = 0;
    for (const beat of rows) {
      if (!['opening', 'scene'].includes(beat.kind) || !beat.prose.trim()) continue;
      byteCount += Buffer.byteLength(beat.prose);
      let chapter = chapters.at(-1);
      if (!chapter || chapter.episode !== beat.episode_number) {
        chapter = { ordinal: chapters.length + 1, title: beat.episode_title, episode: beat.episode_number, pages: [] };
        chapters.push(chapter);
      }
      const blocks = []; const placed = placements.get(beat.id);
      if (placed) {
        let key = assetKeys.get(placed.asset_id);
        if (!key) {
          const asset = media.read(gameId, placed.asset_id);
          byteCount += asset.byte_size;
          if (byteCount > 64 * 1024 * 1024) fail('This illustrated book exceeds the 64 MB content limit.', 'BOOK_TOO_LARGE', 413);
          key = `asset-${assets.length + 1}`; assetKeys.set(placed.asset_id, key);
          assets.push({ key, media_type: asset.media_type, sha256: asset.sha256, width: asset.width, height: asset.height,
            title: placed.caption || null, alt_text: placed.alt_text, content_base64: asset.buffer.toString('base64') });
        }
        blocks.push({ type: 'art', asset_key: key, alt_text: placed.alt_text, position: 'before' });
      }
      if (byteCount > 64 * 1024 * 1024) fail('This book exceeds the 64 MB content limit.', 'BOOK_TOO_LARGE', 413);
      blocks.push(...blocksOf(beat.prose));
      chapter.pages.push({ ordinal: chapter.pages.length + 1, blocks });
    }
    if (!chapters.length) fail('Continue the story before exporting its prose.');
    return validatePublicationDocument({ format: PUBLICATION_FORMAT, schema_version: PUBLICATION_SCHEMA_VERSION,
      metadata: { title: game.title, author, language }, front_matter: [], back_matter: [], assets,
      volumes: [{ ordinal: 1, title: game.title, chapters: chapters.map(({ episode, ...chapter }) => chapter) }] });
  }
  return { document, export: async (id, format, input) => {
    if (exporting) fail('Another book is being built. Try again after it finishes.', 'BOOK_BUSY', 409);
    exporting = true;
    try { return await renderPublication(document(id, input), format); }
    finally { exporting = false; }
  } };
}

module.exports = { createFictionPublication };
