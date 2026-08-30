'use strict';

const axios = require('axios');
const { checkReply } = require('./quality');

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
  speechModelsCache = { at: Date.now(), models };
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
  const raw = await speechErrorBody(error.response?.data);
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
      : error.message || 'Speech generation failed'
  );
  err.statusCode = Number.isFinite(status) && status >= 400 && status < 500 ? status : 502;
  return err;
}

/**
 * Server-side speech generation against OpenRouter's dedicated TTS endpoint.
 * Returns a STREAM (axios responseType 'stream'); never buffers the body.
 * Resolves with { stream, contentType, generationId, format } once headers
 * arrive. Tries mp3 first; models that only speak pcm (Gemini TTS) are
 * detected from the provider's refusal and retried transparently.
 */
async function createSpeech({ model, voice, input, responseFormat = 'mp3' }) {
  const cfg = aiConfig();
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
 *
 * `quality` opts in to output checks the provider does NOT flag as errors:
 * empty or clearly truncated replies, and replies in a language the user's
 * own material contradicts. Bad replies are retried (a language slip gets one
 * explicit "reply in English" nudge); if the last attempt is still bad, the
 * call fails with a clear message instead of delivering garbage.
 */
async function chatCompletion(
  messages,
  { temperature = 0.85, model, maxTokens, reasoningEffort, quality, responseFormat, maxBillableAttempts } = {}
) {
  const cfg = aiConfig();
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
      const rawUsage = response.data?.usage;
      const usage = rawUsage
        ? {
            prompt_tokens: rawUsage.prompt_tokens || 0,
            completion_tokens: rawUsage.completion_tokens || 0,
          }
        : null;
      const cost_usd = await computeCostUsd(useModel, usage);
      billedAttempts += 1;
      if (usage) {
        sawUsage = true;
        promptTokens += usage.prompt_tokens;
        completionTokens += usage.completion_tokens;
      }
      if (typeof cost_usd === 'number' && Number.isFinite(cost_usd)) totalCostUsd += cost_usd;
      else allCostsKnown = false;

      const problem = !content || !content.trim()
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
        qErr.retryable = true;
        throw qErr;
      }
      return {
        content: content.trim(),
        model: useModel,
        usage: accruedUsage(),
        cost_usd: accruedCost(),
        billed_attempts: billedAttempts,
      };
    } catch (error) {
      lastError = error;
      lastQualityProblem = error.qualityProblem || null;
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
        ? 'The scribe returned nothing but silence. Try again.'
        : lastQualityProblem === 'truncated'
          ? 'The scribe\u2019s reply arrived cut off mid-sentence (the model hit its limits). Nothing was saved \u2014 try again, or lower the words-per-page setting.'
          : 'The scribe kept answering in a different language. Nothing was saved \u2014 try again.'
    );
    err.statusCode = 502;
    throw attachSpend(err);
  }

  const err = new Error(
    lastError?.response?.status
      ? `AI API error ${lastError.response.status}: ${JSON.stringify(lastError.response.data).slice(0, 300)}`
      : `AI API request failed: ${lastError?.message || 'unknown error'}`
  );
  // Callers with a capability fallback (for example JSON Schema → strict
  // plain JSON) need the provider status without parsing our friendly text.
  err.upstreamStatus = lastError?.response?.status || null;
  err.statusCode = lastError?.response?.status && !RETRYABLE.has(lastError.response.status) ? 502 : 504;
  throw attachSpend(err);
}

module.exports = { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost, resetModelCache };
