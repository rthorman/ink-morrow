'use strict';

// The one sequential entity-reference-image queue. Creation responds
// instantly; portraits/scenes land when the model finishes. The queue owns
// its arrays and drain loop - callers only see commands.

const { buildCharacterImagePrompt, buildWorldImagePrompt } = require('../../prompt');

function createImageQueue({ db, generateImage, imageStore, logger, autoImagesEnabled }) {
  const tableFor = (kind) => (kind === 'world' ? 'worlds' : 'characters');
  const queue = [];
  const inFlight = new Set(); // 'character:<id>' keys being generated
  let working = false;

  function enqueue(kind, id, { auto = false } = {}) {
    if (auto && !autoImagesEnabled) return;
    const key = kind + ':' + id;
    if (inFlight.has(key)) return; // already queued or generating
    const table = tableFor(kind);
    const row = db.prepare('SELECT image_status FROM ' + table + ' WHERE id = ?').get(id);
    if (!row) return;
    if (row.image_status === 'pending' || inFlight.has(key)) return;
    inFlight.add(key);
    db.prepare('UPDATE ' + table + " SET image_status = 'pending' WHERE id = ?").run(id);
    queue.push({ kind, id });
    drain();
  }

  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length > 0) {
        const { kind, id } = queue.shift();
        const key = kind + ':' + id;
        const table = tableFor(kind);
        try {
          const row = db.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(id);
          if (!row) continue; // deleted while queued
          // An edited blurb overrides the auto-composed one
          const prompt =
            row.image_prompt && row.image_prompt.trim()
              ? row.image_prompt
              : kind === 'world'
                ? buildWorldImagePrompt(row)
                : buildCharacterImagePrompt(row);
          const result = await generateImage({
            prompt,
            // Characters are reused as identity references, worlds set mood:
            quality: kind === 'world' ? 'low' : 'medium',
            resolution: '1K',
            aspectRatio: '3:4',
          });
          imageStore.writeImage(kind, id, result.buffer, result.mediaType);
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'ready', image_media_type = ?, image_cost_usd = ?, image_updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(result.mediaType, result.cost, id);
        } catch (error) {
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'failed', image_updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(id);
          logger.error(`Reference image (${kind} ${id}) failed: ${error.message}`);
        } finally {
          inFlight.delete(key);
        }
      }
    } finally {
      working = false;
    }
  }

  // Backfill: existing entities get their reference image in the background
  // as soon as the server boots with an API key configured.
  function backfill() {
    if (!process.env.OPENROUTER_API_KEY || !autoImagesEnabled) return;
    for (const row of db
      .prepare("SELECT id FROM characters WHERE image_status IS NULL OR image_status = 'none'")
      .all()) {
      enqueue('character', row.id);
    }
    for (const row of db.prepare("SELECT id FROM worlds WHERE image_status IS NULL OR image_status = 'none'").all()) {
      enqueue('world', row.id);
    }
  }

  // Test/runtime disposal: stop accepting work, drop queued items. Files and
  // DB rows already written are persisted user data and stay.
  function dispose() {
    queue.length = 0;
  }

  return { enqueue, backfill, dispose };
}

module.exports = { createImageQueue };
