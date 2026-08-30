'use strict';

// Audio routes: speech catalogue, per-page narrate (streaming mp3 / WAV
// fallback), authoritative generation cost, and the audiobook lifecycle.

const fs = require('fs');
const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { asString } = require('../../core/validation');
const { normalizeNarrationText } = require('./narration');

function createAudioRouter({ stories, narration, audiobooks, ai, logger }) {
  const router = express.Router();
  const { NARRATION_MAX_CHARS, NARRATION_ENTRY_MAX_BYTES } = narration.limits;

  router.get('/api/speech-models', async (req, res, next) => {
    try {
      res.json({ models: await ai.listSpeechModels() });
    } catch (error) {
      error.statusCode = 502;
      next(error);
    }
  });

  router.post('/api/stories/:id/pages/:number/narrate', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = stories.getPageByNumber(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');

      // Model and voice are validated against the live catalogue, never trusted.
      const model = asString(req.body.model);
      const voice = asString(req.body.voice);
      const catalogue = await ai.listSpeechModels();
      const entry = catalogue.find((m) => m.id === model);
      if (!model || !voice || !entry || !entry.voices.some((v) => v.id === voice)) {
        return res.status(400).json({
          error: 'Narration is not configured with a valid model and voice. Choose both in Settings.',
        });
      }

      const text = normalizeNarrationText(page.content);
      if (!text) return badRequest(res, 'This page has no narratable text.');
      if (text.length > NARRATION_MAX_CHARS) {
        return res.status(413).json({ error: 'This page is too long to narrate in one breath. Shorten or split it first.' });
      }

      // In-session replay: serve the remembered audio without a new generation.
      const key = narration.cacheKey(text, model, voice);
      const cached = narration.cache.get(key);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('X-Narration-Cache', 'hit');
        if (cached.generationId) res.setHeader('X-Generation-Id', cached.generationId);
        return res.send(cached.buffer);
      }

      // Segment the page and synthesize each piece (halving retries on
      // provider limits). All headers must arrive before the body starts so
      // every generation id is known up front for honest cost accounting.
      const segments = narration.splitSegments(text);
      const results = [];
      for (const segment of segments) {
        await narration.synthesize(model, voice, segment, results);
      }
      const generationIds = results.map((r) => r.generationId).filter(Boolean);
      const joinedGenerationId = generationIds.join(',') || null;

      // pcm narrators: one complete WAV (the header needs the total size).
      if (results[0].format === 'pcm') {
        const pcm = await narration.collectPcm(results);
        const wav = Buffer.concat([narration.wavHeader(pcm.length), pcm]);
        res.setHeader('Content-Type', 'audio/wav');
        if (joinedGenerationId) res.setHeader('X-Generation-Id', joinedGenerationId);
        narration.remember(key, wav, 'audio/wav', joinedGenerationId);
        return res.send(wav);
      }

      // mp3 narrators: stream segments back-to-back with backpressure.
      const contentType = results[0].contentType || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      if (joinedGenerationId) res.setHeader('X-Generation-Id', joinedGenerationId);

      const chunks = [];
      let remembered = 0;
      let aborted = false;
      res.on('close', () => {
        // A real client disconnect mid-stream: abort upstream work.
        if (!res.writableEnded) {
          aborted = true;
          results.forEach((r) => r.stream.destroy());
        }
      });
      let index = 0;
      const pipeNext = () => {
        if (aborted) return;
        if (index >= results.length) {
          if (!aborted) narration.remember(key, Buffer.concat(chunks), contentType, joinedGenerationId);
          return res.end();
        }
        const stream = results[index++].stream;
        stream.on('data', (chunk) => {
          if (remembered + chunk.length <= NARRATION_ENTRY_MAX_BYTES) {
            chunks.push(chunk);
            remembered += chunk.length;
          }
          if (!res.write(chunk)) stream.pause();
        });
        res.on('drain', () => stream.resume());
        stream.on('end', pipeNext);
        stream.on('error', (error) => {
          if (aborted) return res.end();
          results.forEach((r) => r.stream.destroy());
          res.end();
          logger.error(`Narration upstream error: ${error.message}`);
        });
      };
      pipeNext();
    } catch (error) {
      next(error);
    }
  });

  // Authoritative TTS cost for a generation (or a comma-joined set of
  // segment generations), idempotent and server-cached per id.
  router.get('/api/ai/generation-cost', async (req, res, next) => {
    try {
      const id = asString(req.query.id);
      const ids = id ? id.split(',') : [];
      if (!ids.length || ids.some((single) => !/^[a-zA-Z0-9-]{8,64}$/.test(single))) {
        return badRequest(res, '"id" must be a generation id');
      }
      try {
        const costs = [];
        for (const single of ids) costs.push(await ai.fetchGenerationCost(single));
        const total = costs.reduce((sum, cost) => sum + (typeof cost.cost_usd === 'number' ? cost.cost_usd : 0), 0);
        res.json({
          generation_id: id,
          cost_usd: total,
          model: costs[0]?.model || null,
          provider: costs[0]?.provider || null,
          latency_ms: costs[0]?.latency_ms || null,
        });
      } catch (error) {
        // Metadata not ready yet: tell the client to retry shortly.
        if (error.response?.status === 404 || error.response?.status === 429) {
          return res.status(202).json({ error: 'Cost metadata is not ready yet. Retry shortly.' });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  // -- audiobooks ---------------------------------------------------------------

  router.post('/api/stories/:id/audiobook', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const existing = audiobooks.getAudiobook(story.id);
      if (existing && existing.status === 'pending') {
        return res.status(409).json({ error: 'This tale is already being read aloud.' });
      }
      const model = asString(req.body.model);
      const voice = asString(req.body.voice);
      const catalogue = await ai.listSpeechModels();
      const entry = catalogue.find((m) => m.id === model);
      if (!model || !voice || !entry || !entry.voices.some((v) => v.id === voice)) {
        return res.status(400).json({ error: 'Narration is not configured with a valid model and voice. Choose both in Settings.' });
      }
      if (entry.pcm) {
        return res.status(400).json({ error: 'This narrator speaks WAV-only; audiobooks need an mp3 narrator. Pick another in Settings.' });
      }
      const pages = audiobooks.audiobookTextPages(story.id);
      if (pages.length === 0) return badRequest(res, 'This tale has no narratable pages yet.');
      audiobooks.createPending(story.id, model, voice, pages);
      // A fresh reading replaces the old one; never leave stale bytes behind.
      for (const file of [audiobooks.audioFileFor(story.id), audiobooks.audioFileFor(story.id, true)]) {
        try { fs.unlinkSync(file); } catch { /* nothing there */ }
      }
      audiobooks.enqueue(story.id);
      res.status(201).json({ audiobook: audiobooks.audiobookWithMeta(audiobooks.getAudiobook(story.id), story) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/audiobook', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const row = audiobooks.getAudiobook(story.id);
    res.json({ audiobook: row ? audiobooks.audiobookWithMeta(row, story) : null });
  });

  router.post('/api/stories/:id/audiobook/cancel', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const row = audiobooks.getAudiobook(story.id);
    if (!row || row.status !== 'pending') return badRequest(res, 'No audiobook is being generated for this tale.');
    audiobooks.cancel(story.id);
    res.json({ audiobook: audiobooks.audiobookWithMeta(audiobooks.getAudiobook(story.id), story) });
  });

  router.get('/api/stories/:id/audiobook/audio', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const row = audiobooks.getAudiobook(story.id);
    if (!row || row.status !== 'ready') return notFound(res, 'Audiobook not found');
    const file = audiobooks.audioFileFor(story.id);
    if (!fs.existsSync(file)) return notFound(res, 'Audiobook file is missing');
    const slug = story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story';
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-audiobook.mp3"`);
    fs.createReadStream(file).pipe(res);
  });

  router.delete('/api/stories/:id/audiobook', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const row = audiobooks.getAudiobook(story.id);
    if (!row) return notFound(res, 'Audiobook not found');
    if (row.status === 'pending') audiobooks.cancel(story.id);
    audiobooks.deleteRow(story.id);
    for (const file of [audiobooks.audioFileFor(story.id), audiobooks.audioFileFor(story.id, true)]) {
      try { fs.unlinkSync(file); } catch { /* nothing there */ }
    }
    res.status(204).end();
  });

  return router;
}

module.exports = { createAudioRouter };
