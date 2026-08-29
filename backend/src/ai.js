'use strict';

const axios = require('axios');

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let modelsCache = { at: 0, models: null };
let speechModelsCache = { at: 0, models: null };
const generationCosts = new Map(); // generation id -> reconciled cost payload

function aiConfig() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    model: process.env.OPENROUTER_MODEL || 'z-ai/glm-5.1',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1500', 10),
    timeout: parseInt(process.env.AI_TIMEOUT_MS || '120000', 10),
    retryBaseDelay: parseInt(process.env.AI_RETRY_BASE_DELAY || '800', 10),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the public OpenRouter model catalog (id, name, context length,
 * USD pricing per 1M tokens). Cached for MODELS_CACHE_TTL_MS.
 */
async function listModels() {
  if (modelsCache.models && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) {
    return modelsCache.models;
  }
  const cfg = aiConfig();
  const response = await axios.get(`${cfg.baseUrl}/models`, { timeout: 15000 });
  const models = (response.data?.data || [])
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context_length: typeof m.context_length === 'number' ? m.context_length : null,
      // OpenRouter prices are USD-per-token strings; expose USD per 1M tokens.
      pricing: {
        prompt_per_mtok: (parseFloat(m.pricing?.prompt) || 0) * 1e6,
        completion_per_mtok: (parseFloat(m.pricing?.completion) || 0) * 1e6,
      },
    }))
    .filter((m) => m.id);
  modelsCache = { at: Date.now(), models };
  return models;
}

// Test hook: clear the cached catalog.
function resetModelCache() {
  modelsCache = { at: 0, models: null };
  speechModelsCache = { at: 0, models: null };
}

/**
 * Speech-model discovery: OpenRouter's catalogue filtered to
 * output_modalities=speech, keeping only models with a published voice list.
 * Cached for MODELS_CACHE_TTL_MS. Normalized to {id, name, voices:[{id,label}]}.
 */
async function listSpeechModels() {
  if (speechModelsCache.models && Date.now() - speechModelsCache.at < MODELS_CACHE_TTL_MS) {
    return speechModelsCache.models;
  }
  const cfg = aiConfig();
  const response = await axios.get(`${cfg.baseUrl}/models`, {
    params: { output_modalities: 'speech' },
    timeout: 15000,
  });
  const models = (response.data?.data || [])
    .filter((m) => typeof m.id === 'string' && Array.isArray(m.supported_voices) && m.supported_voices.length > 0)
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      voices: m.supported_voices.map((v) => {
        const id = typeof v === 'string' ? v : String(v?.id || '');
        return { id, label: humanizeVoiceLabel(id) };
      }).filter((v) => v.id),
    }));
  speechModelsCache = { at: Date.now(), models };
  return models;
}

function humanizeVoiceLabel(id) {
  return String(id)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Server-side speech generation against OpenRouter's dedicated TTS endpoint.
 * Returns a STREAM (axios responseType 'stream'); never buffers the body.
 * Resolves with { stream, contentType, generationId } once headers arrive.
 */
async function createSpeech({ model, voice, input }) {
  const cfg = aiConfig();
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  const response = await axios.post(
    `${cfg.baseUrl}/audio/speech`,
    { model, voice, input, response_format: 'mp3' },
    {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      timeout: cfg.timeout,
    }
  );
  const stream = response.data;
  return {
    stream,
    contentType: response.headers['content-type'] || 'audio/mpeg',
    generationId: response.headers['x-generation-id'] || null,
  };
}

/**
 * Authoritative cost for a generation: OpenRouter's /generation endpoint.
 * Cached per generation id so retries and replays never refetch or double count.
 */
async function fetchGenerationCost(generationId) {
  if (generationCosts.has(generationId)) return generationCosts.get(generationId);
  const cfg = aiConfig();
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  const response = await axios.get(`${cfg.baseUrl}/generation`, {
    params: { id: generationId },
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeout: 15000,
  });
  const data = response.data?.data || {};
  const payload = {
    generation_id: generationId,
    cost_usd: typeof data.total_cost === 'number' ? data.total_cost : null,
    model: data.model || null,
    provider: data.provider_name || null,
    latency_ms: typeof data.latency === 'number' ? data.latency : null,
  };
  generationCosts.set(generationId, payload);
  return payload;
}

/**
 * Best-effort cost for a completion. Returns null when usage or pricing
 * is unavailable (older providers, offline, unknown model).
 */
async function computeCostUsd(model, usage) {
  if (!usage) return null;
  try {
    const models = await listModels();
    const pricing = models.find((m) => m.id === model)?.pricing;
    if (!pricing) return null;
    const cost =
      (usage.prompt_tokens / 1e6) * pricing.prompt_per_mtok +
      (usage.completion_tokens / 1e6) * pricing.completion_per_mtok;
    return Number.isFinite(cost) ? cost : null;
  } catch {
    return null;
  }
}

/**
 * Call an OpenAI-compatible chat completions API with retry/backoff
 * on transient failures (429, 5xx, network errors).
 * Returns { content, model, usage, cost_usd }.
 */
async function chatCompletion(messages, { temperature = 0.85, model, maxTokens } = {}) {
  const cfg = aiConfig();
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  const useModel = (typeof model === 'string' && model.trim()) || cfg.model;
  const useMaxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(Math.round(maxTokens), 16000) : cfg.maxTokens;

  let lastError = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(cfg.retryBaseDelay * attempt);
    }
    try {
      const response = await axios.post(
        `${cfg.baseUrl}/chat/completions`,
        {
          model: useModel,
          messages,
          temperature,
          max_tokens: useMaxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: cfg.timeout,
        }
      );
      const content = response.data?.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error('AI returned an empty response');
      }
      const rawUsage = response.data?.usage;
      const usage = rawUsage
        ? {
            prompt_tokens: rawUsage.prompt_tokens || 0,
            completion_tokens: rawUsage.completion_tokens || 0,
          }
        : null;
      const cost_usd = await computeCostUsd(useModel, usage);
      return { content: content.trim(), model: useModel, usage, cost_usd };
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = !status || RETRYABLE.has(status);
      if (!retryable || attempt === RETRY_ATTEMPTS - 1) {
        break;
      }
    }
  }

  const err = new Error(
    lastError?.response?.status
      ? `AI API error ${lastError.response.status}: ${JSON.stringify(lastError.response.data).slice(0, 300)}`
      : `AI API request failed: ${lastError?.message || 'unknown error'}`
  );
  err.statusCode = lastError?.response?.status && !RETRYABLE.has(lastError.response.status) ? 502 : 504;
  throw err;
}

module.exports = { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost, resetModelCache };