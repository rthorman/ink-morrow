'use strict';

// Scene imagery service: condensing a page into a tone-honoring image
// prompt, rendering it with cast identity references, and the
// announce-and-wait moderation flow (never a silent repaint).

const { buildImagePrompt, CONTEXT_WINDOW } = require('../../prompt');
const { optionalText, asString, modelOverrideOf, parseReasoningEffort } = require('../../core/validation');

const RENDER_VARIANTS = {
  low_1k: { quality: 'low', resolution: '1K' },
  medium_2k: { quality: 'medium', resolution: '2K' },
};

function createImageryService({ catalog, stories, continuity, chatCompletion, generateImage, imageStore }) {
  function castCharacters(story, throughPageNumber = null) {
    return continuity.contextForPrompt(story, { throughPageNumber }).characters.map((character) => {
      // Portrait readiness is operational catalogue metadata, not character
      // identity. Keep using the latest file/status while prose fields stay
      // frozen to the story snapshot.
      const catalogue = catalog.getCharacter(character.id);
      return { ...character, image_status: catalogue?.image_status || 'none' };
    });
  }

  // Pages up to and including the target page, windowed like generation.
  function pagesUpTo(story, page) {
    const allPages = stories.storyPages(story.id);
    const upto = allPages.slice(0, allPages.findIndex((p) => p.page_number === page.page_number) + 1);
    return {
      total: upto.length,
      included: upto.slice(-CONTEXT_WINDOW),
      firstContent: upto.length > 0 ? upto[0].content.slice(0, 500) : null,
    };
  }

  // Condense the page (plus predecessors), world, and cast state into a
  // prompt an image-generation AI can consume.
  async function condensePrompt({ story, page, modelOverride, reasoningEffort }) {
    const world = story.world_id ? catalog.getWorld(story.world_id) : null;
    const characters = castCharacters(story, page.page_number);
    const pages = pagesUpTo(story, page);
    const result = await chatCompletion(
      [
        { role: 'system', content: 'You are a precise, disciplined art director.' },
        { role: 'user', content: buildImagePrompt({ story, world, characters, pages }) },
      ],
      { model: modelOverride || undefined, reasoningEffort, maxTokens: 800, quality: { minWords: 30 } }
    );
    return {
      prompt: String(result.content || '').trim(),
      model: result.model,
      cost_usd: result.cost_usd,
      billed_attempts: result.billed_attempts,
    };
  }

  // Render the scene. On a provider moderation refusal (400), rewrite the
  // prompt aggressively safe and ANNOUNCE it back - the user reviews the
  // textbox and presses Generate again themselves.
  async function renderScene({ story, page, body }) {
    const prompt = optionalText(body.prompt, { max: 4000 });
    if (!prompt) return { error: '"prompt" is required (use the condensed scene prompt)' };
    const modelOverride = modelOverrideOf(body.model);
    if (body.model !== undefined && !modelOverride) return { error: '"model" must be a non-empty string' };
    const reasoningEffort = parseReasoningEffort(body.reasoning_effort);
    const variant = body.render === undefined ? 'low_1k' : asString(body.render);
    if (!RENDER_VARIANTS[variant]) {
      return { error: '"render" must be one of: low_1k, medium_2k' };
    }

    // Identity references: MC first, then supporting cast, then background.
    const cast = castCharacters(story)
      .sort((a, b) => {
        const rank = (c) => (c.role === 'mc' ? 0 : c.role === 'supporting' ? 1 : 2);
        return rank(a) - rank(b);
      })
      .map((c) => ({ id: c.id, name: c.name, status: c.image_status }))
      .filter((c) => c.status === 'ready')
      .slice(0, 3);
    const inputReferences = [];
    const resolvedReferences = [];
    for (const c of cast) {
      const url = imageStore.base64Reference('character', c.id);
      if (!url) continue; // ready status but the file is gone (legacy copy): skip gracefully
      inputReferences.push({ type: 'image_url', image_url: { url } });
      resolvedReferences.push(c.id);
    }

    // The client may drop the identity references after repeated refusals:
    // portraits painted from forced-nudity sheets offend moderation too.
    const dropReferences = body.drop_references === true;
    if (dropReferences) inputReferences.length = 0;

    const paintOptions = {
      aspectRatio: '2:3', // book-plate portrait
      resolution: RENDER_VARIANTS[variant].resolution,
      quality: RENDER_VARIANTS[variant].quality,
      inputReferences,
    };
    let result;
    try {
      result = await generateImage({ prompt, ...paintOptions });
    } catch (error) {
      if (error.statusCode !== 400) throw error;
      const reason = (error.message.match(/refused this request: (.*)$/) || [null, '(no reason given)'])[1];
      const rewrite = await chatCompletion(
        [
          {
            role: 'system',
            content:
              'You are a strict image-moderation compliance rewriter. You take refused image prompts and return ' +
              'ONLY a fully SAFE version that will pass automatic moderation.',
          },
          {
            role: 'user',
            content:
              `An image generator refused this prompt, saying: "${reason}".\n\n` +
              'Rewrite it so it will DEFINITELY pass strict content moderation:\n' +
              '- Fully clothed or draped figures. ZERO nudity, zero explicit anatomy, zero sexual content or activity.\n' +
              '- ZERO graphic violence: no wounds, blood, gore - stylized aftermath at most.\n' +
              '- Keep the place, mood, composition and each character\'s recognisable identity, described safely.\n' +
              '- When in doubt, remove more; a bland but passable prompt beats a vivid but refused one.\n' +
              'Output ONLY the rewritten prompt, nothing else.\n\n' +
              `REFUSED PROMPT:\n${prompt}`,
          },
        ],
        { model: modelOverride || undefined, reasoningEffort, maxTokens: 800, quality: { minWords: 20 } }
      );
      return {
        refused: true,
        reason,
        sanitized_prompt: rewrite.content.trim(),
        rewrite_cost_usd: rewrite.cost_usd || 0,
      };
    }
    return {
      image: result.buffer.toString('base64'),
      media_type: result.mediaType,
      cost_usd: result.cost,
      references: dropReferences ? [] : resolvedReferences,
      prompt,
    };
  }

  return { condensePrompt, renderScene };
}

module.exports = { createImageryService };
