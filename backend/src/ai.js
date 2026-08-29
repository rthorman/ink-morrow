'use strict';

const axios = require('axios');

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let modelsCache = { at: 0, models: null };

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

module.exports = { chatCompletion, listModels, resetModelCache };