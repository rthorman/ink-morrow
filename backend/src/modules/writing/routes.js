'use strict';

// Writing routes: model catalogue, AI drafts, page generate/regenerate, and
// the speculative preview/commit pair. Expected-page snapshots are taken
// BEFORE slow generation; previews are single-use and stale-checked.

const express = require('express');
const { badRequest, notFound } = require('../../core/http');
const { optionalText, modelOverrideOf, parseReasoningEffort, parseWordTarget, asString } = require('../../core/validation');

function createWritingRouter({ catalog, stories, writing, continuity, ai }) {
  const router = express.Router();

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

  // -- generation ---------------------------------------------------------------

  router.post('/api/stories/:id/pages/generate', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const userInput = optionalText(req.body.user_input, { max: 10000 }) || 'Continue the story.';
      if (userInput === undefined) return badRequest(res, '"user_input" must be text');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort !== undefined && req.body.reasoning_effort !== null && req.body.reasoning_effort !== '' && !reasoningEffort) {
        return badRequest(res, '"reasoning_effort" must be one of: none, minimal, low, medium, high, xhigh, max');
      }

      const result = await writing.completePage({ story, userInput, wordTarget, modelOverride, reasoningEffort });
      const prose = writing.consumeStoryText(result.content);
      let page = stories.insertGeneratedPage(story.id, {
        content: prose,
        userInput,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        costUsd: result.cost_usd,
      });
      stories.invalidatePreview(story.id);
      const synced = await continuity.maybeSyncPage(stories.getStory(story.id), page, { model: result.model });
      page = synced.page || page;
      res.status(201).json({ page });
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

      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      const result = await writing.completePage({
        story,
        userInput: last.user_input || 'Continue the story.',
        wordTarget,
        modelOverride: modelOverrideOf(req.body.model),
        reasoningEffort,
        excludeLast: true,
      });
      const prose = writing.consumeStoryText(result.content);

      let page = stories.replaceGeneratedPage(last.id, {
        content: prose,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        costUsd: result.cost_usd,
      });
      const synced = await continuity.maybeSyncPage(stories.getStory(story.id), page, { model: result.model });
      page = synced.page || page;
      res.json({ page });
    } catch (error) {
      next(error);
    }
  });

  // -- speculative next-page preview ---------------------------------------------

  router.post('/api/stories/:id/pages/preview', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);

      // Snapshot the page count BEFORE the (slow) generation: a preview that
      // raced with a live write must never commit wrong-context prose as a
      // later page - the commit staleness check catches it instead.
      const expectedPage = stories.storyPages(story.id).length + 1;
      const result = await writing.completePage({ story, userInput: 'Continue the story.', wordTarget, modelOverride, reasoningEffort });
      stories.upsertPreview.run(
        story.id,
        expectedPage,
        result.content,
        result.model,
        result.usage?.prompt_tokens ?? null,
        result.usage?.completion_tokens ?? null,
        result.cost_usd
      );
      res.json({ preview: { expected_page: expectedPage, model: result.model, cost_usd: result.cost_usd } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/stories/:id/pages/commit-preview', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const preview = stories.getPreview.get(story.id);
      if (!preview) return notFound(res, 'No prepared page for this story. Generate normally.');
      if (stories.storyPages(story.id).length + 1 !== preview.expected_page) {
        stories.invalidatePreview(story.id);
        return res.status(409).json({ error: 'The prepared page has gone stale - the story moved on without it.' });
      }

      const prose = writing.consumeStoryText(preview.raw_content);
      let page = stories.insertGeneratedPage(story.id, {
        content: prose,
        userInput: null,
        model: preview.model,
        promptTokens: preview.prompt_tokens,
        completionTokens: preview.completion_tokens,
        costUsd: preview.cost_usd,
        pageNumber: preview.expected_page,
      });
      stories.invalidatePreview(story.id);
      const synced = await continuity.maybeSyncPage(stories.getStory(story.id), page, { model: preview.model });
      page = synced.page || page;
      res.status(201).json({ page });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createWritingRouter };
