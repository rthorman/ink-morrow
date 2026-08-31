'use strict';

// Narration: segmentation at sentence boundaries, the bounded in-memory
// audio cache (replays never re-bill), bisect-retry synthesis, and WAV
// wrapping for pcm-only narrators.

const crypto = require('crypto');

const NARRATION_MAX_CHARS = 16000;
const NARRATION_SEGMENT_CHARS = 1800; // many narrators reject longer input outright
const NARRATION_MIN_SEGMENT_CHARS = 300; // below this, halving cannot help
const NARRATION_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const NARRATION_ENTRY_MAX_BYTES = 8 * 1024 * 1024; // single-page cap
const NARRATION_PCM_MAX_BYTES = 24 * 1024 * 1024; // raw pcm buffering guard

function normalizeNarrationText(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createNarration({ createSpeech }) {
  // Keyed by sha256(text)+model+voice; value is the completed audio (mp3 or a
  // WAV-wrapped pcm) so an in-session replay never triggers (or bills) a
  // second upstream generation.
  const cache = new Map();

  function cacheKey(text, model, voice) {
    return crypto.createHash('sha256').update(text).digest('hex') + '|' + model + '|' + voice;
  }

  function remember(key, buffer, contentType, generationId) {
    if (buffer.length === 0 || buffer.length > NARRATION_ENTRY_MAX_BYTES) return;
    cache.set(key, { buffer, contentType, generationId, bytes: buffer.length });
    let total = 0;
    for (const entry of cache.values()) total += entry.bytes;
    while (total > NARRATION_CACHE_MAX_BYTES && cache.size > 1) {
      const oldest = cache.keys().next().value; // insertion order ~ LRU
      total -= cache.get(oldest).bytes;
      cache.delete(oldest);
    }
  }

  // Split narratable text into segments at sentence boundaries. Providers cap
  // input length (Deepgram ~2000 chars, others less), so a full page is fed to
  // them piece by piece.
  function splitSegments(text, limit = NARRATION_SEGMENT_CHARS) {
    const segments = [];
    let current = '';
    const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (current.trim()) segments.push(current.trim());
        current = '';
        for (let i = 0; i < sentence.length; i += limit) segments.push(sentence.slice(i, i + limit).trim());
        continue;
      }
      if (current && current.length + sentence.length > limit) {
        segments.push(current.trim());
        current = '';
      }
      current += sentence;
    }
    if (current.trim()) segments.push(current.trim());
    return segments.filter(Boolean);
  }

  // Split text into exactly two halves at a sentence boundary near the middle
  // (hard-splitting an overlong sentence when there is no boundary).
  function bisect(text) {
    const half = Math.floor(text.length / 2);
    const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    let first = '';
    let i = 0;
    for (; i < sentences.length; i++) {
      if (first.length && first.length + sentences[i].length > half) break;
      first += sentences[i];
    }
    if (i === 0) {
      // The very first sentence crosses the middle: hard-split it.
      first = sentences[0].slice(0, half);
      const rest = sentences[0].slice(half) + sentences.slice(1).join('');
      return [first.trim(), rest.trim()].filter(Boolean);
    }
    return [first.trim(), sentences.slice(i).join('').trim()].filter(Boolean);
  }

  // Synthesize one segment, pushing each upstream result into `results`.
  // When a provider refuses even a within-limit segment (400/413 — limits
  // vary and are undocumented), bisect at sentence boundaries and recurse.
  async function synthesize(model, voice, text, results) {
    try {
      results.push(await createSpeech({ model, voice, input: text }));
    } catch (error) {
      const status = error.statusCode || 0;
      if ((status === 400 || status === 413) && text.length > NARRATION_MIN_SEGMENT_CHARS) {
        for (const piece of bisect(text)) {
          await synthesize(model, voice, piece, results);
        }
        return;
      }
      throw error;
    }
  }

  // 44-byte WAV header for OpenAI-style pcm: 24kHz 16-bit signed LE mono.
  function wavHeader(dataBytes) {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + dataBytes, 4);
    b.write('WAVE', 8);
    b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); // fmt chunk size
    b.writeUInt16LE(1, 20); // PCM
    b.writeUInt16LE(1, 22); // mono
    b.writeUInt32LE(24000, 24); // sample rate
    b.writeUInt32LE(48000, 28); // byte rate
    b.writeUInt16LE(2, 32); // block align
    b.writeUInt16LE(16, 34); // bits per sample
    b.write('data', 36);
    b.writeUInt32LE(dataBytes, 40);
    return b;
  }

  // pcm narrators cannot stream through (the WAV header needs the total size),
  // so their segments are collected and delivered as one complete WAV.
  async function collectPcm(results) {
    const parts = [];
    let total = 0;
    for (const result of results) {
      await new Promise((resolve, reject) => {
        result.stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > NARRATION_PCM_MAX_BYTES) {
            const err = new Error('This page is too long for this narrator in one breath. Try an mp3 narrator or a shorter page.');
            err.statusCode = 413;
            reject(err);
            result.stream.destroy();
            return;
          }
          parts.push(chunk);
        });
        result.stream.on('end', resolve);
        result.stream.on('error', reject);
      });
    }
    return Buffer.concat(parts);
  }

  function collectStream(stream) {
    return new Promise((resolve, reject) => {
      const parts = [];
      stream.on('data', (chunk) => parts.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(parts)));
      stream.on('error', reject);
    });
  }

  function dispose() {
    cache.clear();
  }

  return {
    cache,
    cacheKey,
    remember,
    splitSegments,
    synthesize,
    wavHeader,
    collectPcm,
    collectStream,
    dispose,
    limits: {
      NARRATION_MAX_CHARS,
      NARRATION_ENTRY_MAX_BYTES,
    },
  };
}

module.exports = { createNarration, normalizeNarrationText };
