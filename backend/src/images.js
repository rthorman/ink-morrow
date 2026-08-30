'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Grok Imagine Image 2.0 via OpenRouter's dedicated Image API. Billing is
// all-or-nothing upstream: a failed generation throws and is never charged.
function imageConfig() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    model: process.env.IMAGE_MODEL || 'x-ai/grok-imagine-image-2.0',
    timeout: parseInt(process.env.IMAGE_TIMEOUT_MS || '180000', 10),
  };
}

/**
 * Generates one image. `inputReferences` is an array of
 * { type: 'image_url', image_url: { url: 'data:<mime>;base64,…' } }
 * entries (base64 data URLs, per the Image API contract).
 * Resolves with { buffer, mediaType, cost }.
 */
// Turns an axios failure into an Error carrying the upstream status and,
// when the provider explained itself, the real reason. 4xx pass through
// (a moderation refusal is a 400 the caller may want to retry around).
function imageError(error) {
  const status = error.response?.status;
  const data = error.response?.data;
  let message = null;
  if (data !== undefined && data !== null) {
    try {
      const parsed = typeof data === 'string' || Buffer.isBuffer(data) ? JSON.parse(data.toString()) : data;
      message = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : null);
    } catch {
      message = String(data).slice(0, 200);
    }
  }
  const err = new Error(
    message ? `The image model refused this request: ${message}` : error.message || 'Image generation failed'
  );
  err.statusCode = Number.isFinite(status) && status >= 400 && status < 500 ? status : 502;
  return err;
}

async function generateImage({
  prompt,
  aspectRatio = '3:4',
  resolution = '1K',
  quality = 'low',
  inputReferences = [],
}) {
  const cfg = imageConfig();
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key is not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  let response;
  try {
    response = await axios.post(
      `${cfg.baseUrl}/images`,
      {
        model: cfg.model,
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        quality,
        ...(inputReferences.length > 0 ? { input_references: inputReferences } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: cfg.timeout,
      }
    );
  } catch (error) {
    throw imageError(error);
  }
  const image = response.data?.data?.[0];
  if (!image?.b64_json) {
    const err = new Error('The image model returned nothing usable.');
    err.statusCode = 502;
    throw err;
  }
  return {
    buffer: Buffer.from(image.b64_json, 'base64'),
    mediaType: image.media_type || 'image/png',
    cost: typeof response.data?.usage?.cost === 'number' ? response.data.usage.cost : null,
  };
}

function extFor(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/webp') return 'webp';
  return 'png';
}

// Reference and scene images live on disk next to the database (never in the
// DB itself); served through dedicated API routes with the stored media type.
function createImageStore(rootDir) {
  const kindDir = (kind) => path.join(rootDir, kind === 'world' ? 'worlds' : kind === 'page' ? 'pages' : 'characters');
  for (const kind of ['world', 'character', 'page']) {
    fs.mkdirSync(kindDir(kind), { recursive: true });
  }

  function writeImage(kind, id, buffer, mediaType) {
    const ext = extFor(mediaType);
    const dir = kindDir(kind);
    for (const old of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (old.startsWith(id + '.')) fs.unlinkSync(path.join(dir, old)); // replace stale versions
    }
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer);
    return mediaType;
  }

  function readImage(kind, id) {
    const dir = kindDir(kind);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const name = names.find((n) => n.startsWith(id + '.'));
    if (!name) return null;
    const buffer = fs.readFileSync(path.join(dir, name));
    const ext = path.extname(name).slice(1);
    const mediaType = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return { buffer, mediaType };
  }

  function deleteImage(kind, id) {
    const dir = kindDir(kind);
    for (const old of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (old.startsWith(id + '.')) {
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* already gone */ }
      }
    }
  }

  function base64Reference(kind, id) {
    const image = readImage(kind, id);
    if (!image) return null;
    return `data:${image.mediaType};base64,${image.buffer.toString('base64')}`;
  }

  return { writeImage, readImage, deleteImage, base64Reference };
}

module.exports = { generateImage, createImageStore, imageConfig };
