'use strict';

// Writing routes: model catalogue, AI drafts, page generate/regenerate, and
// the speculative preview/commit pair. Expected-page snapshots are taken
// BEFORE slow generation; previews are single-use and stale-checked.

const express = require('express');
const { createHash, randomUUID } = require('node:crypto');
const { badRequest, notFound } = require('../../core/http');
const { optionalText, modelOverrideOf, parseReasoningEffort, parseWordTarget, asString } = require('../../core/validation');

function previewKey(preview) {
  if (!preview) return null;
  if (preview.id) return preview.id;
  return createHash('sha256').update(JSON.stringify([
    preview.story_id,
    preview.expected_page,
    preview.raw_content,
    preview.model,
    preview.prompt_tokens,
    preview.completion_tokens,
    preview.cost_usd,
    preview.created_at,
  ])).digest('base64url');
}

function publicPreview(preview) {
  if (!preview) return null;
  if (preview.id && preview.expected_page) {
    return {
      id: preview.id,
      preview_id: preview.id,
      preview_key: preview.id,
      expected_page: preview.expected_page,
      model: preview.model || null,
      cost_usd: preview.cost_usd ?? null,
      operation_id: preview.operation_id || null,
      created_at: preview.created_at || null,
    };
  }
  return {
    expected_page: preview.expected_page,
    model: preview.model || null,
    cost_usd: preview.cost_usd ?? null,
    preview_key: previewKey(preview),
  };
}

function createWritingRouter({ catalog, stories, writing, transactions, ai }) {
  const router = express.Router();

  function idempotencyKey(req) {
    const value = req.get('Idempotency-Key') || req.body?.idempotency_key;
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, 300)
      : randomUUID();
  }

  function writerSessionId(req) {
    const explicit = req.get('X-InkMorrow-Writer-Session') || req.body?.writer_session_id;
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 300);
    const authenticated = req.authSession?.tokenHash;
    return typeof authenticated === 'string' && authenticated.trim()
      ? `compat:${authenticated.trim()}`.slice(0, 300)
      : 'legacy-client';
  }

  function generationSettings(body) {
    return {
      words: parseWordTarget(body.words),
      model: modelOverrideOf(body.model),
      reasoning_effort: parseReasoningEffort(body.reasoning_effort),
    };
  }

  function validateGenerationSettings(body, settings, res) {
    if (body.model !== undefined && !settings.model) {
      badRequest(res, '"model" must be a non-empty string');
      return false;
    }
    if (body.reasoning_effort !== undefined && body.reasoning_effort !== null && body.reasoning_effort !== '' && !settings.reasoning_effort) {
      badRequest(res, '"reasoning_effort" must be one of: none, minimal, low, medium, high, xhigh, max');
      return false;
    }
    return true;
  }

  // OpenRouter catalog proxy for the unlocked settings page (no key needed).
  router.get('/api/models', async (req, res, next) => {
    try {
      res.json({ models: await ai.listModels() });
    } catch (error) {
      error.statusCode = 502;
      next(error);
    }
  });

  // -- AI drafts (world / character fleshing-out) -----------------------------

  router.post('/api/ai/world', async (req, res, next) => {
    try {
      const seeds = {
        name: optionalText(req.body.name, { max: 200 }),
        description: optionalText(req.body.description, { max: 2000 }),
        genre: optionalText(req.body.genre, { max: 100 }),
        setting: optionalText(req.body.setting, { max: 200 }),
      };
      if (Object.values(seeds).includes(undefined)) return badRequest(res, 'World seed fields must be text');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');

      const { world, model, cost_usd, seeds: honored } = await writing.draftWorld(req.body, modelOverride);
      res.json({
        world: {
          name: asString(world.name) || honored.name || 'An Unnamed Realm',
          description: asString(world.description) || '',
          genre: asString(world.genre) || honored.genre || '',
          setting: asString(world.setting) || honored.setting || '',
        },
        model,
        cost_usd,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/ai/character', async (req, res, next) => {
    try {
      const seeds = {
        name: optionalText(req.body.name, { max: 200 }),
        description: optionalText(req.body.description, { max: 2000 }),
        personality: optionalText(req.body.personality, { max: 2000 }),
        appearance: optionalText(req.body.appearance, { max: 2000 }),
        background: optionalText(req.body.background, { max: 2000 }),
      };
      if (Object.values(seeds).includes(undefined)) return badRequest(res, 'Character seed fields must be text');
      const world = req.body.world_id ? catalog.getWorld(req.body.world_id) : null;
      if (req.body.world_id && !world) return badRequest(res, 'world_id does not reference an existing world');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');

      const { character, model, cost_usd, seeds: honored } = await writing.draftCharacter(req.body, modelOverride, world);
      const pick = (key) => asString(character[key]) || honored[key] || '';
      res.json({
        character: {
          name: pick('name') || 'A Nameless Stranger',
          description: pick('description'),
          personality: pick('personality'),
          appearance: pick('appearance'),
          background: pick('background'),
        },
        model,
        cost_usd,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/ai/foundations', async (req, res, next) => {
    try {
      const seeds = {
        premise: optionalText(req.body.premise, { max: 5000 }),
        narrative_voice: optionalText(req.body.narrative_voice, { max: 1000 }),
        point_of_view: optionalText(req.body.point_of_view, { max: 500 }),
        tense: optionalText(req.body.tense, { max: 500 }),
        constraints: optionalText(req.body.constraints, { max: 5000 }),
      };
      if (Object.values(seeds).includes(undefined)) return badRequest(res, 'Foundation seed fields must be text');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const result = await writing.draftFoundations({ ...req.body, ...seeds }, modelOverride);
      const pick = (key) => asString(result.foundations[key]) || result.seeds[key] || '';
      res.json({
        foundations: {
          premise: pick('premise'),
          narrative_voice: pick('narrative_voice'),
          point_of_view: pick('point_of_view'),
          tense: pick('tense'),
          constraints: pick('constraints'),
        },
        model: result.model,
        cost_usd: result.cost_usd,
      });
    } catch (error) {
      next(error);
    }
  });

  // -- generation ---------------------------------------------------------------

  router.post('/api/stories/:id/pages/generate', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const direction = optionalText(req.body.user_input, { max: 10000 });
      if (direction === undefined) return badRequest(res, '"user_input" must be text');
      if (!direction) {
        return res.status(409).json({
          error: 'An empty direction cannot trigger live generation. Prepare a page, then promote its exact identity.',
          code: 'DIRECTION_REQUIRED',
        });
      }
      const generation = generationSettings(req.body);
      if (!validateGenerationSettings(req.body, generation, res)) return;
      const result = await transactions.directedGenerate({
        story,
        key: idempotencyKey(req),
        writerSessionId: writerSessionId(req),
        direction,
        generation,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  // Regenerate the LAST page only, reusing its stored user_input
  router.post('/api/stories/:id/pages/regenerate', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const pages = stories.storyPages(story.id);
      if (pages.length === 0) return badRequest(res, 'Story has no pages to regenerate');
      const last = pages[pages.length - 1];
      if (last.image_media_type) return badRequest(res, 'The last page is a painted plate and has no prose to regenerate');

      const generation = generationSettings(req.body);
      if (!validateGenerationSettings(req.body, generation, res)) return;
      const result = await transactions.regenerate({
        story,
        key: idempotencyKey(req),
        writerSessionId: writerSessionId(req),
        page: last,
        generation,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // -- speculative next-page preview ---------------------------------------------

  // A free metadata lookup restores the green button after a refresh. It
  // deliberately never returns prose: prepared content remains server-side.
  router.get('/api/stories/:id/pages/preview', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ preview: transactions.prepared(story.id) });
  });

  router.post('/api/stories/:id/pages/preview', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const generation = generationSettings(req.body);
      if (!validateGenerationSettings(req.body, generation, res)) return;
      const result = await transactions.prepare({
        story,
        key: idempotencyKey(req),
        writerSessionId: writerSessionId(req),
        generation,
      });
      res.status(result.pending ? 202 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/pages/commit-preview', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const preparedId = asString(req.body.preview_id || req.body.preview_key);
      if (!preparedId) return badRequest(res, '"preview_id" is required');
      const result = transactions.promote({
        story,
        key: idempotencyKey(req),
        writerSessionId: writerSessionId(req),
        preparedId,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/writing-state', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({
      preview: transactions.prepared(story.id),
      lease: transactions.currentLease(story.id),
      costs: transactions.costs(story.id),
    });
  });

  router.post('/api/stories/:id/writer-lease', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ lease: transactions.acquireLease(story.id, writerSessionId(req)) });
  });

  router.delete('/api/stories/:id/writer-lease', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      transactions.releaseLease(story.id, writerSessionId(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/stories/:id/writing-operations/:key', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const operation = transactions.operation(story.id, req.params.key);
    if (!operation) return notFound(res, 'Writing operation not found');
    res.json({ operation });
  });

  router.delete('/api/stories/:id/writing-operations/:key', (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const operation = transactions.cancel(story.id, req.params.key, writerSessionId(req));
      if (!operation) return notFound(res, 'Writing operation not found');
      res.json({ operation });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createWritingRouter, previewKey, publicPreview };
