'use strict';

// Writing routes: model catalogue, AI drafts, page generate/regenerate, and
// the speculative preview/commit pair. Expected-page snapshots are taken
// BEFORE slow generation; previews are single-use and stale-checked.

const express = require('express');
const { createHash } = require('node:crypto');
const { badRequest, notFound } = require('../../core/http');
const { optionalText, modelOverrideOf, parseReasoningEffort, parseWordTarget, asString } = require('../../core/validation');

function previewKey(preview) {
  if (!preview) return null;
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
  return {
    expected_page: preview.expected_page,
    model: preview.model || null,
    cost_usd: preview.cost_usd ?? null,
    preview_key: previewKey(preview),
  };
}

function paidConflict(res, result, error, code) {
  return res.status(409).json({
    error,
    code,
    cost_usd: result.cost_usd ?? null,
    billed_attempts: Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1,
  });
}

function createWritingRouter({ catalog, stories, writing, continuity, ai }) {
  const router = express.Router();
  // Multi-tab requests can overlap even though one browser state machine does
  // not. Only the newest request for a story may publish a prepared page.
  const latestPreviewAttempt = new Map();
  let previewAttemptSequence = 0;

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

      const expectedPage = stories.nextPageNumber(story.id);
      const contextRevision = stories.previewRevision(story.id);
      const result = await writing.completePage({ story, userInput, wordTarget, modelOverride, reasoningEffort });
      if (
        stories.nextPageNumber(story.id) !== expectedPage ||
        stories.previewRevision(story.id) !== contextRevision
      ) {
        return paidConflict(
          res,
          result,
          'The story changed while this page was being written, so the stale prose was not saved.',
          'WRITE_SUPERSEDED'
        );
      }
      const prose = writing.consumeStoryText(result.content);
      let page = stories.insertGeneratedPage(story.id, {
        content: prose,
        userInput,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        costUsd: result.cost_usd,
        pageNumber: expectedPage,
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
      const contextRevision = stories.previewRevision(story.id);
      const result = await writing.completePage({
        story,
        userInput: last.user_input || 'Continue the story.',
        wordTarget,
        modelOverride: modelOverrideOf(req.body.model),
        reasoningEffort,
        excludeLast: true,
      });
      const currentPages = stories.storyPages(story.id);
      const currentLast = currentPages[currentPages.length - 1];
      if (
        !currentLast ||
        currentLast.id !== last.id ||
        currentLast.content !== last.content ||
        stories.previewRevision(story.id) !== contextRevision
      ) {
        return paidConflict(
          res,
          result,
          'The story changed while this rewrite was being written, so the stale prose was not saved.',
          'REWRITE_SUPERSEDED'
        );
      }
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

  // A free metadata lookup restores the green button after a refresh. It
  // deliberately never returns prose: prepared content remains server-side.
  router.get('/api/stories/:id/pages/preview', (req, res) => {
    const story = stories.getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const preview = stories.getPreview.get(story.id);
    if (!preview) return res.json({ preview: null });
    if (stories.nextPageNumber(story.id) !== preview.expected_page) {
      stories.invalidatePreview(story.id);
      return res.json({ preview: null });
    }
    res.json({ preview: publicPreview(preview) });
  });

  router.post('/api/stories/:id/pages/preview', async (req, res, next) => {
    let attempt = null;
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort !== undefined && req.body.reasoning_effort !== null && req.body.reasoning_effort !== '' && !reasoningEffort) {
        return badRequest(res, '"reasoning_effort" must be one of: none, minimal, low, medium, high, xhigh, max');
      }

      // Snapshot the page count BEFORE the (slow) generation: a preview that
      // raced with any context mutation is billed but never written into the
      // preview slot. This prevents an old reply from overwriting a newer,
      // valid prepared page in the database.
      const expectedPage = stories.nextPageNumber(story.id);
      const contextRevision = stories.previewRevision(story.id);
      attempt = ++previewAttemptSequence;
      latestPreviewAttempt.set(story.id, attempt);
      const result = await writing.completePage({ story, userInput: 'Continue the story.', wordTarget, modelOverride, reasoningEffort });
      const superseded = latestPreviewAttempt.get(story.id) !== attempt;
      const contextChanged = stories.previewRevision(story.id) !== contextRevision;
      const pageMoved = stories.nextPageNumber(story.id) !== expectedPage;
      if (superseded || contextChanged || pageMoved) {
        return res.status(409).json({
          error: 'The prepared page finished after the story moved on, so it was not saved.',
          code: 'PREVIEW_SUPERSEDED',
          cost_usd: result.cost_usd ?? null,
          billed_attempts: Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1,
        });
      }
      stories.upsertPreview.run(
        story.id,
        expectedPage,
        result.content,
        result.model,
        result.usage?.prompt_tokens ?? null,
        result.usage?.completion_tokens ?? null,
        result.cost_usd
      );
      res.json({ preview: publicPreview(stories.getPreview.get(story.id)) });
    } catch (error) {
      next(error);
    } finally {
      if (attempt !== null && latestPreviewAttempt.get(req.params.id) === attempt) {
        latestPreviewAttempt.delete(req.params.id);
      }
    }
  });

  router.post('/api/stories/:id/pages/commit-preview', async (req, res, next) => {
    try {
      const story = stories.getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const preview = stories.getPreview.get(story.id);
      if (!preview) return notFound(res, 'No prepared page for this story. Generate normally.');
      if (req.body.preview_key !== undefined && typeof req.body.preview_key !== 'string') {
        return badRequest(res, '"preview_key" must be a string');
      }
      const requestedKey = asString(req.body.preview_key);
      if (requestedKey && requestedKey !== previewKey(preview)) {
        return res.status(409).json({
          error: 'A newer prepared page replaced this one. Refresh the writing desk before committing.',
          code: 'PREVIEW_REPLACED',
        });
      }
      if (stories.nextPageNumber(story.id) !== preview.expected_page) {
        stories.invalidatePreview(story.id);
        return res.status(409).json({ error: 'The prepared page has gone stale - the story moved on without it.' });
      }

      const prose = writing.consumeStoryText(preview.raw_content);
      const page = stories.insertGeneratedPage(story.id, {
        content: prose,
        userInput: null,
        model: preview.model,
        promptTokens: preview.prompt_tokens,
        completionTokens: preview.completion_tokens,
        costUsd: preview.cost_usd,
        pageNumber: preview.expected_page,
      });
      stories.invalidatePreview(story.id);
      const continuityPending = continuity.isAutoEnabled();
      // The prepared prose is committed before another provider call begins.
      // Respond immediately, then let the continuity clerk work behind the
      // reader. A client sync request joins this same in-flight job.
      res.status(201).json({ page, continuity_pending: continuityPending });
      if (continuityPending) {
        void continuity.maybeSyncPage(stories.getStory(story.id), page, { model: preview.model }).catch(() => {});
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createWritingRouter, previewKey, publicPreview };
