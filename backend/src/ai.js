'use strict';

const axios = require('axios');
const { checkReply } = require('./quality');

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERATION_COST_TTL_MS = 24 * 60 * 60 * 1000;
const GENERATION_COST_MAX_ENTRIES = 2000;
const MAX_CATALOGUE_RESPONSE_BYTES = 10 * 1024 * 1024;

let modelsCache = new Map();
let speechModelsCache = new Map();
const generationCosts = new Map(); // generation id -> reconciled cost payload

function cachedGenerationCost(key) {
  const entry = generationCosts.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= GENERATION_COST_TTL_MS) {
    generationCosts.delete(key);
    return null;
  }
  // Map insertion order is our LRU order. Refresh a successful read.
  generationCosts.delete(key);
  generationCosts.set(key, entry);
  return entry.payload;
}

function rememberGenerationCost(key, payload) {
  generationCosts.delete(key);
  generationCosts.set(key, { at: Date.now(), payload });
  while (generationCosts.size > GENERATION_COST_MAX_ENTRIES) {
    generationCosts.delete(generationCosts.keys().next().value);
  }
}

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

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text' && typeof part.text === 'string') return part.text;
    if (typeof part?.content === 'string') return part.content;
    return '';
  }).join('');
}

function hasVisibleReasoning(message) {
  const value = message?.reasoning ?? message?.reasoning_content;
  if (typeof value === 'string') return Boolean(value.trim());
  return Array.isArray(value) && value.length > 0;
}

/**
 * Fetch the public OpenRouter model catalog (id, name, context length,
 * USD pricing per 1M tokens). Cached for MODELS_CACHE_TTL_MS.
 */
async function listModels() {
  return listModelsWithConfig(aiConfig());
}

async function listModelsWithConfig(cfg, onCatalogue = null) {
  const cacheKey = `${cfg.profileId || 'environment'}|${cfg.baseUrl}|${cfg.model || ''}`;
  const cached = modelsCache.get(cacheKey);
  if (cached?.models && Date.now() - cached.at < MODELS_CACHE_TTL_MS) return cached.models;
  const response = await axios.get(`${cfg.baseUrl}/models`, {
    ...(cfg.apiKey ? { headers: { Authorization: `Bearer ${cfg.apiKey}` } } : {}),
    timeout: Math.min(cfg.timeout || 15000, 30000),
    maxContentLength: MAX_CATALOGUE_RESPONSE_BYTES,
  });
  const effortVocabulary = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const models = (response.data?.data || [])
    .map((m) => {
      const detail = m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : {};
      const declared = Array.isArray(detail.supported_efforts)
        ? detail.supported_efforts.filter((effort) => effortVocabulary.has(effort))
        : [];
      const reasoning =
        (Array.isArray(m.supported_parameters) && m.supported_parameters.includes('reasoning')) ||
        declared.length > 0 || Boolean(detail.mandatory) || Boolean(detail.default_effort);
      // Older catalogue responses only carried the boolean supported
      // parameter. Preserve their established three-level UI as fallback.
      const efforts = reasoning ? (declared.length ? declared : ['low', 'medium', 'high']) : [];
      const defaultEffort = efforts.includes(detail.default_effort)
        ? detail.default_effort
        : efforts.includes('medium') ? 'medium' : efforts[0] || null;
      return {
        id: m.id,
        name: m.name || m.id,
        context_length: typeof m.context_length === 'number' ? m.context_length : null,
        reasoning,
        reasoning_efforts: efforts,
        reasoning_default: defaultEffort,
        reasoning_mandatory: Boolean(detail.mandatory),
        is_default: m.id === cfg.model,
        // OpenRouter prices are USD-per-token strings; expose USD per 1M tokens.
        pricing: {
          prompt_per_mtok: (parseFloat(m.pricing?.prompt) || 0) * 1e6,
          completion_per_mtok: (parseFloat(m.pricing?.completion) || 0) * 1e6,
        },
      };
    })
    .filter((m) => m.id);
  modelsCache.set(cacheKey, { at: Date.now(), models });
  onCatalogue?.(cfg, models, 'chat');
  return models;
}

// Test hook: clear the cached catalog.
function resetModelCache() {
  modelsCache = new Map();
  speechModelsCache = new Map();
  generationCosts.clear();
}

/**
 * Speech-model discovery: OpenRouter's catalogue filtered to
 * output_modalities=speech, keeping only models with a published voice list.
 * Cached for MODELS_CACHE_TTL_MS. Normalized to {id, name, voices:[{id,label}]}.
 */
async function listSpeechModels() {
  return listSpeechModelsWithConfig(aiConfig());
}

async function listSpeechModelsWithConfig(cfg, onCatalogue = null) {
  const cacheKey = `${cfg.profileId || 'environment'}|${cfg.baseUrl}`;
  const cached = speechModelsCache.get(cacheKey);
  if (cached?.models && Date.now() - cached.at < MODELS_CACHE_TTL_MS) return cached.models;
  const response = await axios.get(`${cfg.baseUrl}/models`, {
    params: { output_modalities: 'speech' },
    ...(cfg.apiKey ? { headers: { Authorization: `Bearer ${cfg.apiKey}` } } : {}),
    timeout: Math.min(cfg.timeout || 15000, 30000),
    maxContentLength: MAX_CATALOGUE_RESPONSE_BYTES,
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
      // Gemini-class narrators only speak pcm (delivered as WAV), which cannot
      // be bound into a single-sound audiobook — flagged so clients can say why.
      pcm: /gemini/i.test(m.id),
      // TTS pricing: prompt is USD per input character, completion USD per
      // output token (Gemini-style models). Exposed per 1M units.
      pricing: {
        prompt_per_mchar: (parseFloat(m.pricing?.prompt) || 0) * 1e6,
        completion_per_mtok: (parseFloat(m.pricing?.completion) || 0) * 1e6,
      },
    }));
  speechModelsCache.set(cacheKey, { at: Date.now(), models });
  onCatalogue?.(cfg, models, 'speech');
  return models;
}

function humanizeVoiceLabel(id) {
  return String(id)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Reads a fully-buffered error body out of an axios failure. The body may be
// a plain value (tests, non-stream errors) or a readable stream (real axios).
async function speechErrorBody(data) {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string' || Buffer.isBuffer(data)) return data;
  if (typeof data.pipe !== 'function') return JSON.stringify(data);
  return await new Promise((resolve) => {
    const parts = [];
    data.on('data', (c) => parts.push(c));
    data.on('end', () => resolve(Buffer.concat(parts)));
    data.on('error', () => resolve(Buffer.concat(parts)));
  });
}

// Turns an axios failure into an Error that carries the upstream status and,
// when the provider bothered to explain itself, the real reason.
async function speechError(error) {
  const status = error.response?.status;
  const providerRefusal = Number.isFinite(status) && status >= 400 && status < 500;
  const raw = providerRefusal ? await speechErrorBody(error.response?.data) : null;
  let message = null;
  if (raw !== null && raw !== undefined && (!Buffer.isBuffer(raw) || raw.length)) {
    try {
      const parsed = JSON.parse(raw.toString());
      message = parsed?.error?.message || parsed?.error || null;
    } catch {
      message = String(raw).slice(0, 200);
    }
  }
  const err = new Error(
    message
      ? `The narrator refused this page: ${message}`
      : providerRefusal
        ? `The narrator provider rejected this page (${status}).`
        : 'The narrator provider failed before returning usable audio.'
  );
  err.statusCode = providerRefusal ? status : 502;
  return err;
}

/**
 * Server-side speech generation against OpenRouter's dedicated TTS endpoint.
 * Returns a STREAM (axios responseType 'stream'); never buffers the body.
 * Resolves with { stream, contentType, generationId, format } once headers
 * arrive. Tries mp3 first; models that only speak pcm (Gemini TTS) are
 * detected from the provider's refusal and retried transparently.
 */
async function createSpeech(input) {
  return createSpeechWithConfig(aiConfig(), input);
}

async function createSpeechWithConfig(cfg, { model, voice, input, responseFormat = 'mp3' }) {
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key is not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  let format = responseFormat;
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(
        `${cfg.baseUrl}/audio/speech`,
        { model, voice, input, response_format: format },
        {
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
          timeout: cfg.timeout,
        }
      );
      return {
        stream: response.data,
        contentType: response.headers['content-type'] || (format === 'pcm' ? 'audio/pcm' : 'audio/mpeg'),
        generationId: response.headers['x-generation-id'] || null,
        format,
      };
    } catch (error) {
      const err = await speechError(error);
      // pcm-only narrators (e.g. Gemini TTS) refuse mp3: fall back once.
      if (
        format !== 'pcm' &&
        Number.isFinite(error.response?.status) &&
        error.response.status === 400 &&
        /pcm/i.test(err.message)
      ) {
        format = 'pcm';
        lastError = err;
        continue;
      }
      if (RETRYABLE.has(error.response?.status) && attempt < RETRY_ATTEMPTS - 1) {
        await sleep(cfg.retryBaseDelay * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Speech generation failed');
}

/**
 * Authoritative cost for a generation: OpenRouter's /generation endpoint.
 * Cached per generation id so retries and replays never refetch or double count.
 */
async function fetchGenerationCost(generationId) {
  return fetchGenerationCostWithConfig(aiConfig(), generationId);
}

async function fetchGenerationCostWithConfig(cfg, generationId) {
  const cacheKey = `${cfg.profileId || 'environment'}|${generationId}`;
  const cached = cachedGenerationCost(cacheKey);
  if (cached) return cached;
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  const response = await axios.get(`${cfg.baseUrl}/generation`, {
    params: { id: generationId },
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeout: 15000,
    maxContentLength: 1024 * 1024,
  });
  const data = response.data?.data || {};
  const payload = {
    generation_id: generationId,
    cost_usd: typeof data.total_cost === 'number' ? data.total_cost : null,
    model: data.model || null,
    provider: data.provider_name || null,
    latency_ms: typeof data.latency === 'number' ? data.latency : null,
  };
  rememberGenerationCost(cacheKey, payload);
  return payload;
}

/**
 * Best-effort cost for a completion. Returns null when usage or pricing
 * is unavailable (older providers, offline, unknown model).
 */
async function computeCostUsd(cfg, model, usage, onCatalogue = null) {
  if (!usage) return null;
  try {
    const models = await listModelsWithConfig(cfg, onCatalogue);
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
 *
 * `quality` opts in to output checks the provider does NOT flag as errors:
 * empty or clearly truncated replies, and replies in a language the user's
 * own material contradicts. Bad replies are retried (a language slip gets one
 * explicit "reply in English" nudge); if the last attempt is still bad, the
 * call fails with a clear message instead of delivering garbage.
 */
async function chatCompletion(
  messages,
  { temperature = 0.85, model, maxTokens, reasoningEffort, quality, responseFormat, requireParameters, maxBillableAttempts } = {}
) {
  return chatCompletionWithConfig(aiConfig(), messages, {
    temperature, model, maxTokens, reasoningEffort, quality, responseFormat, requireParameters, maxBillableAttempts,
  });
}

async function chatCompletionWithConfig(
  cfg,
  messages,
  { temperature = 0.85, model, maxTokens, reasoningEffort, quality, responseFormat, requireParameters, maxBillableAttempts } = {},
  onCatalogue = null
) {
  if (!cfg.apiKey) {
    const err = new Error('OpenRouter API key not configured. Set OPENROUTER_API_KEY in backend/.env');
    err.statusCode = 503;
    throw err;
  }
  const useModel = (typeof model === 'string' && model.trim()) || cfg.model;
  const useReasoningEffort = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)
    ? reasoningEffort
    : null;
  let useMaxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(Math.round(maxTokens), 16000) : cfg.maxTokens;
  if (useReasoningEffort && useReasoningEffort !== 'none') {
    // Reasoning tokens come out of the same budget: give the model room to think.
    useMaxTokens = Math.max(useMaxTokens, 6000);
  }

  // The user's own prompt material anchors the expected language.
  const languageReference = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  let attemptMessages = messages;
  let languageNudgeSent = false;
  let lastError = null;
  let lastQualityProblem = null;
  let lastFinishReason = null;
  let lastReasoningOnly = false;
  // A locally rejected response was still a successful provider completion
  // and can therefore be billable. Keep the full spend across quality
  // retries instead of returning only the final, accepted attempt.
  let billedAttempts = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let sawUsage = false;
  let totalCostUsd = 0;
  let allCostsKnown = true;
  const billableAttemptLimit = Number.isInteger(maxBillableAttempts) && maxBillableAttempts > 0
    ? maxBillableAttempts
    : Number.POSITIVE_INFINITY;

  const accruedUsage = () =>
    sawUsage ? { prompt_tokens: promptTokens, completion_tokens: completionTokens } : null;
  const accruedCost = () =>
    billedAttempts > 0 && allCostsKnown ? totalCostUsd : null;
  const attachSpend = (error) => {
    if (billedAttempts > 0) {
      error.billedAttempts = billedAttempts;
      error.usage = accruedUsage();
      error.costUsd = accruedCost();
    }
    return error;
  };

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(cfg.retryBaseDelay * attempt);
    }
    try {
      const response = await axios.post(
        `${cfg.baseUrl}/chat/completions`,
        {
          model: useModel,
          messages: attemptMessages,
          temperature,
          max_tokens: useMaxTokens,
          ...(useReasoningEffort ? { reasoning: { effort: useReasoningEffort } } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...(requireParameters ? { provider: { require_parameters: true } } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: cfg.timeout,
        }
      );
      const choice = response.data?.choices?.[0] || {};
      const message = choice.message || {};
      const content = messageText(message.content);
      const finishReason = choice.finish_reason || choice.native_finish_reason || null;
      const rawUsage = response.data?.usage;
      const usage = rawUsage
        ? {
            prompt_tokens: rawUsage.prompt_tokens || 0,
            completion_tokens: rawUsage.completion_tokens || 0,
          }
        : null;
      const cost_usd = await computeCostUsd(cfg, useModel, usage, onCatalogue);
      billedAttempts += 1;
      if (usage) {
        sawUsage = true;
        promptTokens += usage.prompt_tokens;
        completionTokens += usage.completion_tokens;
      }
      if (typeof cost_usd === 'number' && Number.isFinite(cost_usd)) totalCostUsd += cost_usd;
      else allCostsKnown = false;

      const problem = ['length', 'max_tokens'].includes(finishReason)
        ? 'truncated'
        : !content || !content.trim()
          ? 'empty'
        : quality
          ? checkReply(content, quality, languageReference)
          : null;
      if (problem) {
        // A wrong language earns one explicit instruction before the
        // remaining attempts are burned on the same mistake.
        if (problem === 'language' && !languageNudgeSent) {
          languageNudgeSent = true;
          attemptMessages = [
            ...messages,
            { role: 'system', content: 'Important: write your reply in English only.' },
          ];
        }
        const qErr = new Error(
          problem === 'empty'
            ? 'AI returned an empty response'
            : problem === 'truncated'
              ? 'The reply arrived clearly truncated'
              : 'The reply arrived in the wrong language'
        );
        qErr.qualityProblem = problem;
        qErr.finishReason = finishReason;
        qErr.reasoningOnly = problem === 'empty' && hasVisibleReasoning(message);
        qErr.retryable = true;
        throw qErr;
      }
      return {
        content: content.trim(),
        model: useModel,
        usage: accruedUsage(),
        cost_usd: accruedCost(),
        billed_attempts: billedAttempts,
        finish_reason: finishReason,
      };
    } catch (error) {
      lastError = error;
      lastQualityProblem = error.qualityProblem || null;
      lastFinishReason = error.finishReason || null;
      lastReasoningOnly = error.reasoningOnly === true;
      const status = error.response?.status;
      const retryable = !status || RETRYABLE.has(status) || error.retryable === true;
      // Some consumers advertise an exact paid retry ceiling. They may still
      // retry transport/429 failures before any completion is returned, but a
      // successfully billed empty/rejected output must respect that ceiling.
      if (!retryable || billedAttempts >= billableAttemptLimit || attempt === RETRY_ATTEMPTS - 1) {
        break;
      }
    }
  }

  if (lastQualityProblem) {
    const err = new Error(
      lastQualityProblem === 'empty'
        ? lastReasoningOnly
          ? 'The model returned internal reasoning but no final answer. Nothing was saved - try again.'
          : `The model returned nothing but silence: no final answer${lastFinishReason ? ` (finish reason: ${lastFinishReason})` : ''}. Nothing was saved - try again.`
        : lastQualityProblem === 'truncated'
          ? `The model's reply was cut off or incomplete${lastFinishReason ? ` (finish reason: ${lastFinishReason})` : ''}. Nothing was saved - try again, or lower the words-per-page setting.`
          : 'The scribe kept answering in a different language. Nothing was saved \u2014 try again.'
    );
    err.statusCode = 502;
    err.code = lastQualityProblem === 'empty'
      ? 'AI_EMPTY_RESPONSE'
      : lastQualityProblem === 'truncated' ? 'AI_TRUNCATED_RESPONSE' : 'AI_LANGUAGE_MISMATCH';
    err.finishReason = lastFinishReason;
    throw attachSpend(err);
  }

  const err = new Error(
    lastError?.response?.status
      ? `AI API error ${lastError.response.status}. The provider rejected or failed the request.`
      : 'AI API request failed before a usable response was received.'
  );
  // Callers with a capability fallback (for example JSON Schema → strict
  // plain JSON) need the provider status without parsing our friendly text.
  err.upstreamStatus = lastError?.response?.status || null;
  err.statusCode = lastError?.response?.status && !RETRYABLE.has(lastError.response.status) ? 502 : 504;
  throw attachSpend(err);
}

function createAiClient({ providers }) {
  const catalogueObserved = (cfg, models, capability) => providers.recordCatalogue(cfg.profileId, models, capability);
  const catalogConfig = (profileId, role = 'scribe') => providers.catalogConfig(profileId, role);
  const safe = async (operation) => {
    try { return await operation(); }
    catch (error) {
      error.message = providers.redact(error.message || 'Provider request failed.');
      throw error;
    }
  };
  const completion = (role) => async (messages, options = {}) => {
    const cfg = providers.resolve(role, { capability: 'chat', model: options.model });
    return safe(() => chatCompletionWithConfig(cfg, messages, { ...options, model: cfg.model }, catalogueObserved));
  };
  return {
    chatCompletion: completion('scribe'),
    archivistCompletion: completion('archivist'),
    listModels: async () => safe(() => listModelsWithConfig(catalogConfig(null, 'scribe'), catalogueObserved)),
    listModelsForProfile: async (profileId) => safe(() => listModelsWithConfig(catalogConfig(profileId), catalogueObserved)),
    listSpeechModels: async () => safe(() => listSpeechModelsWithConfig(catalogConfig(null, 'narrator'), catalogueObserved)),
    createSpeech: async (input) => {
      const cfg = providers.resolve('narrator', { capability: 'speech', model: input.model });
      return safe(() => createSpeechWithConfig(cfg, { ...input, model: cfg.model }));
    },
    fetchGenerationCost: async (generationId) => {
      const cfg = providers.resolve('narrator', { capability: 'generation-cost' });
      return safe(() => fetchGenerationCostWithConfig(cfg, generationId));
    },
  };
}

module.exports = {
  chatCompletion,
  listModels,
  listSpeechModels,
  createSpeech,
  fetchGenerationCost,
  resetModelCache,
  createAiClient,
};
