'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { adapterForImageModel, boundedText } = require('./modules/imagery/provider-adapters');
const { normalizeImage, MAX_IMAGE_BYTES } = require('./modules/imagery/art-store');

// A 20 MB decoded image expands to a little under 27 MB of base64. Leave a
// small amount of room for the provider envelope while refusing an upstream
// response that could otherwise consume an arbitrary amount of process RAM.
const MAX_IMAGE_RESPONSE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;
const PROVIDER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

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
// when the provider explained itself, a bounded reason. Adapter metadata
// decides whether a client error is a provider-specific refusal contract.
function imageError(error, cfg = {}) {
  const status = error.response?.status;
  const data = error.response?.data;
  let message = null;
  const providerClientError = Number.isFinite(status) && status >= 400 && status < 500;
  if (providerClientError && data !== undefined && data !== null) {
    try {
      const parsed = typeof data === 'string' || Buffer.isBuffer(data) ? JSON.parse(data.toString()) : data;
      message = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : null);
    } catch {
      message = String(data);
    }
  }
  message = boundedText(message);
  const adapter = adapterForImageModel(cfg.model);
  const providerRefusal = adapter.detectsRefusal({ status, reason: message });
  const providerName = boundedText(cfg.profileName, 100) || 'The image provider';
  let publicMessage = 'The image provider failed before returning a usable result.';
  if (providerRefusal) {
    publicMessage = `${adapter.displayName} refused this request${message ? `: ${message}` : '.'}`;
  } else if (message) {
    publicMessage = `${providerName} rejected the image request: ${message}`;
  } else if (providerClientError) {
    publicMessage = `${providerName} rejected the image request (${status}).`;
  }
  const err = new Error(publicMessage);
  err.statusCode = providerClientError ? status : 502;
  err.code = providerRefusal ? 'IMAGE_PROVIDER_REFUSAL' : providerClientError ? 'IMAGE_PROVIDER_REJECTED' : 'IMAGE_PROVIDER_FAILED';
  err.imageProvider = {
    adapter: adapter.id,
    model: String(cfg.model || ''),
    profileId: cfg.profileId || null,
    profileName: providerName,
    refusal: providerRefusal,
    reason: message || null,
  };
  return err;
}

async function generateImage(input) {
  return generateImageWithConfig(imageConfig(), input);
}

async function generateImageWithConfig(cfg, {
  prompt,
  aspectRatio = '3:4',
  resolution = '1K',
  quality = 'low',
  inputReferences = [],
}) {
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
        maxContentLength: MAX_IMAGE_RESPONSE_BYTES,
        maxBodyLength: MAX_IMAGE_RESPONSE_BYTES,
      }
    );
  } catch (error) {
    throw imageError(error, cfg);
  }
  const image = response.data?.data?.[0];
  if (!image?.b64_json) {
    const err = new Error('The image model returned nothing usable.');
    err.statusCode = 502;
    throw err;
  }
  const encoded = image.b64_json;
  const mediaType = String(image.media_type || 'image/png').toLowerCase();
  if (typeof encoded !== 'string' || encoded.length > MAX_IMAGE_BASE64_CHARS ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
      !PROVIDER_IMAGE_TYPES.has(mediaType)) {
    const err = new Error('The image model returned an invalid or oversized image payload.');
    err.statusCode = 502;
    err.code = 'IMAGE_PROVIDER_INVALID_PAYLOAD';
    throw err;
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) {
    const err = new Error('The image model returned invalid base64 image data.');
    err.statusCode = 502;
    err.code = 'IMAGE_PROVIDER_INVALID_PAYLOAD';
    throw err;
  }
  let normalized;
  try {
    normalized = await normalizeImage(decoded, mediaType);
  } catch {
    const err = new Error('The image model returned an unsafe or unreadable image.');
    err.statusCode = 502;
    err.code = 'IMAGE_PROVIDER_INVALID_PAYLOAD';
    throw err;
  }
  return {
    buffer: normalized.buffer,
    mediaType: normalized.mediaType,
    cost: typeof response.data?.usage?.cost === 'number' ? response.data.usage.cost : null,
  };
}

function createImageClient({ providers }) {
  function resolvedConfig() {
    return providers.resolve('scribe', {
      capability: 'image',
      model: process.env.IMAGE_MODEL || 'x-ai/grok-imagine-image-2.0',
    });
  }

  return {
    generateImage: async (input) => {
      const cfg = resolvedConfig();
      try { return await generateImageWithConfig(cfg, input); }
      catch (error) {
        error.message = providers.redact(error.message || 'Image provider request failed.');
        if (error.imageProvider?.reason) {
          error.imageProvider.reason = boundedText(providers.redact(error.imageProvider.reason));
        }
        throw error;
      }
    },
    describeImageProvider() {
      const cfg = resolvedConfig();
      const adapter = adapterForImageModel(cfg.model);
      return {
        adapter: adapter.id,
        model: cfg.model,
        profile_id: cfg.profileId,
        profile_name: cfg.profileName,
        renderable_prompt_instruction: adapter.renderablePromptInstruction,
      };
    },
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
  const kindDir = (kind) => path.join(
    rootDir,
    kind === 'world' ? 'worlds' : kind === 'page' ? 'pages' : kind === 'story' ? 'covers' : kind === 'scribe' ? 'scribes' : 'characters'
  );
  for (const kind of ['world', 'character', 'scribe', 'story', 'page']) {
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
    const file = fileInfo(kind, id);
    if (!file) return null;
    const buffer = fs.readFileSync(file.path);
    const mediaType = file.mediaType;
    return { buffer, mediaType };
  }

  // Transfer/archive code needs a path and size so multi-megabyte paintings
  // can be streamed straight from disk instead of copied onto the JS heap.
  function fileInfo(kind, id) {
    const dir = kindDir(kind);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    const name = names.find((n) => n.startsWith(id + '.'));
    if (!name) return null;
    const filePath = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return null; }
    if (!stat.isFile()) return null;
    const ext = path.extname(name).slice(1).toLowerCase();
    const mediaType = ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp' : 'image/png';
    return { path: filePath, name, mediaType, size: stat.size };
  }

  function pathsFor(kind, id) {
    const dir = kindDir(kind);
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.startsWith(id + '.'))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  }

  function targetPath(kind, id, mediaType) {
    return path.join(kindDir(kind), `${id}.${extFor(mediaType)}`);
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

  return {
    rootDir,
    directoryFor: kindDir,
    targetPath,
    pathsFor,
    fileInfo,
    writeImage,
    readImage,
    deleteImage,
    base64Reference,
  };
}

module.exports = { generateImage, createImageClient, createImageStore, imageConfig, extFor };
