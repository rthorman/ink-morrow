'use strict';

// The one sequential entity-reference-image queue. Creation responds
// instantly; portraits/scenes land when the model finishes. The queue owns
// its arrays and drain loop - callers only see commands.

const { buildCharacterImagePrompt, buildScribeImagePrompt, buildWorldImagePrompt, buildStoryCoverPrompt } = require('../../prompt');

function createImageQueue({ db, continuity, generateImage, imageStore, logger, autoImagesEnabled }) {
  const tableFor = (kind) => (
    kind === 'world' ? 'worlds' : kind === 'story' ? 'stories' : kind === 'scribe' ? 'scribes' : 'characters'
  );
  const queue = [];
  const inFlight = new Set(); // 'character:<id>' keys being generated
  let working = false;
  let disposed = false;

  // Provider work is process-local. A pending row surviving a restart cannot
  // complete, and treating it as live makes every future retry a no-op.
  for (const table of ['worlds', 'characters', 'scribes', 'stories']) {
    db.prepare(
      `UPDATE ${table} SET image_status = 'failed', image_updated_at = CURRENT_TIMESTAMP WHERE image_status = 'pending'`
    ).run();
  }

  function enqueue(kind, id, { auto = false } = {}) {
    if (disposed) return;
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
    if (working || disposed) return;
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
          let prompt;
          let inputReferences = [];
          if (kind === 'scribe') {
            // Unlike ordinary art blurbs, Scribe direction can never replace
            // the adult-catgirl canon that the composed prompt enforces.
            prompt = buildScribeImagePrompt({ ...row, focus_areas: JSON.parse(row.focus_areas || '[]') });
          } else if (row.image_prompt && row.image_prompt.trim()) {
            prompt = row.image_prompt;
          } else if (kind === 'world') {
            prompt = buildWorldImagePrompt(row);
          } else if (kind === 'story') {
            const world = row.world_id ? db.prepare('SELECT * FROM worlds WHERE id = ?').get(row.world_id) : null;
            const rank = (entry) => (entry.role === 'mc' ? 0 : entry.role === 'supporting' ? 1 : 2);
            const characters = continuity.contextForPrompt(row).characters
              .slice()
              .sort((a, b) => rank(a) - rank(b));
            prompt = buildStoryCoverPrompt({ story: row, world, characters });
            const urls = [];
            for (const character of characters.slice(0, 3)) {
              const url = imageStore.base64Reference('character', character.id);
              if (url) urls.push(url);
            }
            const worldUrl = world ? imageStore.base64Reference('world', world.id) : null;
            if (worldUrl) urls.push(worldUrl);
            inputReferences = urls.map((url) => ({ type: 'image_url', image_url: { url } }));
          } else {
            prompt = buildCharacterImagePrompt(row);
          }
          const result = await generateImage({
            prompt,
            // Characters are reused as identity references, worlds set mood:
            quality: kind === 'world' ? 'low' : 'medium',
            resolution: '1K',
            aspectRatio: kind === 'story' ? '2:3' : '3:4',
            inputReferences,
          });
          // A delete can happen while the provider is painting. Only a row
          // that is still pending may receive the result; otherwise discard
          // it rather than resurrecting an asset the user just removed.
          const live = db.prepare('SELECT image_status FROM ' + table + ' WHERE id = ?').get(id);
          if (!live || live.image_status !== 'pending') continue;
          imageStore.writeImage(kind, id, result.buffer, result.mediaType);
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'ready', image_media_type = ?, image_cost_usd = ?, image_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND image_status = 'pending'"
          ).run(result.mediaType, result.cost, id);
        } catch (error) {
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'failed', image_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND image_status = 'pending'"
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
    if (disposed || !process.env.OPENROUTER_API_KEY || !autoImagesEnabled) return;
    for (const row of db
      .prepare("SELECT id FROM characters WHERE image_status IS NULL OR image_status = 'none'")
      .all()) {
      enqueue('character', row.id);
    }
    for (const row of db.prepare("SELECT id FROM worlds WHERE image_status IS NULL OR image_status = 'none'").all()) {
      enqueue('world', row.id);
    }
    for (const row of db.prepare("SELECT id FROM scribes WHERE image_status IS NULL OR image_status = 'none'").all()) {
      enqueue('scribe', row.id);
    }
  }

  // Test/runtime disposal: stop accepting work, drop queued items. Files and
  // DB rows already written are persisted user data and stay.
  function dispose() {
    disposed = true;
    queue.length = 0;
    for (const key of inFlight) {
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator);
      const id = key.slice(separator + 1);
      db.prepare(
        `UPDATE ${tableFor(kind)} SET image_status = 'failed', image_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND image_status = 'pending'`
      ).run(id);
    }
  }

  return { enqueue, backfill, dispose };
}

module.exports = { createImageQueue };
