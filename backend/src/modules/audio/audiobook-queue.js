'use strict';

// The one sequential whole-story audiobook queue. Jobs narrate text pages in
// order (noncanonical art is outside this list), reuse the narration cache (unchanged pages
// are free), append to a temp file, and rename it into place when done.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeNarrationText } = require('./narration');

function createAudiobookQueue({ db, audioDir, stories, narration, listSpeechModels, fetchGenerationCost, logger }) {
  function audioFileFor(storyId, tmp = false) {
    return path.join(audioDir, storyId + (tmp ? '.mp3.tmp' : '.mp3'));
  }

  function getAudiobook(storyId) {
    return db.prepare('SELECT * FROM audiobooks WHERE story_id = ?').get(storyId);
  }

  function audiobookTextPages(storyId) {
    return stories.storyPages(storyId).filter((p) => !p.image_media_type && normalizeNarrationText(p.content));
  }

  function audiobookFingerprint(model, voice, pages) {
    const hash = crypto.createHash('sha256');
    hash.update(`${model}\n${voice}\n`);
    for (const page of pages) hash.update(`${page.id}\n${normalizeNarrationText(page.content)}\n`);
    return hash.digest('hex');
  }

  const queue = []; // story ids waiting for the reader
  const cancelFlags = new Set(); // story ids asked to stop mid-tale
  let current = null; // the story being read right now
  let working = false;

  // The row plus derived metadata: staleness (the tale changed since it was
  // read) and, while pending, the queue position (0 = reading right now).
  function audiobookWithMeta(row, story) {
    const pages = audiobookTextPages(story.id);
    const meta = { ...row };
    meta.stale = row.status === 'ready' && Boolean(row.fingerprint) &&
      row.fingerprint !== audiobookFingerprint(row.model, row.voice, pages);
    if (row.status === 'pending') {
      meta.queue_position = current === story.id ? 0 : Math.max(1, queue.indexOf(story.id) + 1);
    }
    if (row.status === 'ready') {
      // Legacy grace: a ready row without its file degrades, never 500s.
      meta.file_missing = !fs.existsSync(audioFileFor(story.id));
    }
    return meta;
  }

  function writeAll(fd, buffer) {
    let offset = 0;
    while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset);
  }

  async function runJob(storyId) {
    const row = getAudiobook(storyId);
    if (!row || row.status !== 'pending') return; // deleted/cancelled while queued
    const pages = audiobookTextPages(storyId);
    const tmp = audioFileFor(storyId, true);
    const fd = fs.openSync(tmp, 'w');
    let done = 0;
    let cost = 0;
    try {
      for (const page of pages) {
        if (cancelFlags.has(storyId)) throw new Error('Cancelled.');
        const text = normalizeNarrationText(page.content);
        const key = narration.cacheKey(text, row.model, row.voice);
        let buffer = narration.cache.get(key)?.buffer;
        const generationIds = [];
        if (!buffer) {
          // Same discipline as the per-page endpoint: segment at sentence
          // boundaries, bisect on provider refusals, remember for reuse.
          const segments = narration.splitSegments(text);
          const results = [];
          for (const segment of segments) {
            await narration.synthesize(row.model, row.voice, segment, results);
          }
          if (results[0].format === 'pcm') {
            throw new Error('This narrator speaks WAV-only; audiobooks need an mp3 narrator. Pick another in Settings.');
          }
          const pieces = [];
          for (const result of results) pieces.push(await narration.collectStream(result.stream));
          // A cancel that arrived mid-page must still land before the write.
          if (cancelFlags.has(storyId)) throw new Error('Cancelled.');
          buffer = Buffer.concat(pieces);
          for (const result of results) if (result.generationId) generationIds.push(result.generationId);
          narration.remember(key, buffer, results[0].contentType || 'audio/mpeg', generationIds.join(',') || null);
        }
        writeAll(fd, buffer);
        // Authoritative cost, best-effort: replays (cache hits) cost nothing.
        for (const id of generationIds) {
          try {
            const c = await fetchGenerationCost(id);
            if (typeof c.cost_usd === 'number') cost += c.cost_usd;
          } catch { /* metadata lag: the book still reads */ }
        }
        done++;
        db.prepare(
          "UPDATE audiobooks SET pages_done = ?, cost_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE story_id = ? AND status = 'pending'"
        ).run(done, cost, storyId);
      }
      fs.closeSync(fd);
      const size = fs.statSync(tmp).size;
      const words = pages.reduce((sum, p) => sum + normalizeNarrationText(p.content).split(/\s+/).length, 0);
      fs.renameSync(tmp, audioFileFor(storyId));
      db.prepare(
        "UPDATE audiobooks SET status = 'ready', pages_done = ?, size_bytes = ?, duration_s = ?, updated_at = CURRENT_TIMESTAMP WHERE story_id = ? AND status = 'pending'"
      ).run(pages.length, size, Math.round(words / 2.5), storyId);
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
      const cancelled = cancelFlags.has(storyId) || error.message === 'Cancelled.';
      db.prepare(
        "UPDATE audiobooks SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE story_id = ? AND status = 'pending'"
      ).run(cancelled ? 'Cancelled.' : error.message || 'Audiobook generation failed.', storyId);
      if (!cancelled) logger.error(`Audiobook job failed: ${error.message}`);
    } finally {
      cancelFlags.delete(storyId);
    }
  }

  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length > 0) {
        current = queue.shift();
        await runJob(current);
      }
    } finally {
      current = null;
      working = false;
    }
  }

  function enqueue(storyId) {
    queue.push(storyId);
    drain();
  }

  // Cancel a queued job (marks it failed immediately) or flag a running one
  // (the runner checks between pages).
  function cancel(storyId) {
    const queued = queue.indexOf(storyId);
    if (queued >= 0) {
      queue.splice(queued, 1);
      db.prepare(
        "UPDATE audiobooks SET status = 'failed', error = 'Cancelled.', updated_at = CURRENT_TIMESTAMP WHERE story_id = ?"
      ).run(storyId);
      cancelFlags.delete(storyId);
    } else {
      cancelFlags.add(storyId);
    }
  }

  // Story deletion: dequeue, stop a running job, remove row + files.
  function abandonStory(storyId) {
    const queued = queue.indexOf(storyId);
    if (queued >= 0) queue.splice(queued, 1);
    if (getAudiobook(storyId)?.status === 'pending') cancelFlags.add(storyId);
    for (const file of [audioFileFor(storyId), audioFileFor(storyId, true)]) {
      try { fs.unlinkSync(file); } catch { /* never there */ }
    }
  }

  function createPending(storyId, model, voice, pages) {
    db.prepare(
      'INSERT OR REPLACE INTO audiobooks (story_id, model, voice, status, pages_done, pages_total, cost_usd, fingerprint, updated_at) VALUES (?, ?, ?, ?, 0, ?, 0, ?, CURRENT_TIMESTAMP)'
    ).run(storyId, model, voice, 'pending', pages.length, audiobookFingerprint(model, voice, pages));
  }

  function deleteRow(storyId) {
    db.prepare('DELETE FROM audiobooks WHERE story_id = ?').run(storyId);
  }

  // Test/runtime disposal: stop accepting work and clear the queue. A job
  // mid-run finishes its current cleanup; persisted rows are never touched.
  function dispose() {
    queue.length = 0;
  }

  return {
    audioFileFor,
    getAudiobook,
    audiobookTextPages,
    audiobookFingerprint,
    audiobookWithMeta,
    enqueue,
    cancel,
    abandonStory,
    createPending,
    deleteRow,
    dispose,
  };
}

module.exports = { createAudiobookQueue };
