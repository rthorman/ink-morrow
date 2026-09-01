'use strict';

// Scene imagery service: condensing a page into a tone-honoring image
// prompt, rendering it with cast identity references, and the
// announce-and-wait moderation flow (never a silent repaint).

const { buildImagePrompt, CONTEXT_WINDOW } = require('../../prompt');
const { optionalText, asString, modelOverrideOf, parseReasoningEffort } = require('../../core/validation');
const { adapterById } = require('./provider-adapters');

const RENDER_VARIANTS = {
  low_1k: { quality: 'low', resolution: '1K' },
  medium_2k: { quality: 'medium', resolution: '2K' },
};

function createImageryService({
  catalog,
  stories,
  continuity,
  chatCompletion,
  generateImage,
  describeImageProvider = () => ({ adapter: 'generic', renderable_prompt_instruction: null }),
  imageStore,
  artStore = null,
}) {
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
        {
          role: 'user',
          content: buildImagePrompt({
            story,
            world,
            characters,
            pages,
            providerInstruction: describeImageProvider().renderable_prompt_instruction,
          }),
        },
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

  // Render the scene. Only the selected provider adapter may classify a
  // failure as a refusal and produce an announce-and-wait sanitation prompt.
  async function renderScene({ story, page, body }) {
    const prompt = optionalText(body.prompt, { max: 4000 });
    if (!prompt) return { error: '"prompt" is required (use the condensed scene prompt)' };
    const modelOverride = modelOverrideOf(body.model);
    if (body.model !== undefined && !modelOverride) return { error: '"model" must be a non-empty string' };
    const reasoningEffort = parseReasoningEffort(body.reasoning_effort);
    const providerDescription = describeImageProvider();
    const variant = body.render === undefined ? 'low_1k' : asString(body.render);
    if (!RENDER_VARIANTS[variant]) {
      return { error: '"render" must be one of: low_1k, medium_2k' };
    }
    if (body.drop_references !== undefined && typeof body.drop_references !== 'boolean') {
      return { error: '"drop_references" must be a boolean' };
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

    const assetReferences = body.reference_asset_ids === undefined
      ? []
      : artStore?.resolveReferences(story.id, body.reference_asset_ids) || [];
    for (const reference of assetReferences) inputReferences.push(reference.input);

    // Reference-free generation is a deliberate request. A refusal response
    // may offer it, but neither server nor client silently enables it.
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
      const provider = error.imageProvider;
      const adapter = adapterById(provider?.adapter);
      if (!provider?.refusal || adapter.id === 'generic' || typeof adapter.sanitationMessages !== 'function') throw error;
      const reason = provider.reason || 'No provider reason was supplied.';
      const rewrite = await chatCompletion(
        adapter.sanitationMessages({ prompt, reason }),
        { model: modelOverride || undefined, reasoningEffort, maxTokens: 800, quality: { minWords: 20 } }
      );
      const sanitizedPrompt = adapter.sanitizedPrompt(rewrite.content);
      const sanitationCost = typeof rewrite.cost_usd === 'number' && Number.isFinite(rewrite.cost_usd)
        ? rewrite.cost_usd
        : null;
      if (!sanitizedPrompt) {
        const invalid = new Error(`${adapter.displayName} sanitation returned no usable prompt.`);
        invalid.statusCode = 502;
        invalid.code = 'INVALID_SANITATION_OUTPUT';
        invalid.costUsd = sanitationCost;
        invalid.billedAttempts = rewrite.billed_attempts;
        throw invalid;
      }
      return {
        refused: true,
        adapter: adapter.id,
        reason,
        sanitized_prompt: sanitizedPrompt,
        sanitation_cost_usd: sanitationCost,
        sanitation_model: rewrite.model || null,
        sanitation_billed_attempts: rewrite.billed_attempts || 1,
        // Compatibility while the 3.x client name ages out.
        rewrite_cost_usd: sanitationCost,
        references_sent: inputReferences.length,
        can_drop_references: inputReferences.length > 0,
      };
    }
    return {
      image: result.buffer.toString('base64'),
      media_type: result.mediaType,
      cost_usd: result.cost,
      references: dropReferences ? [] : resolvedReferences,
      asset_references: dropReferences ? [] : assetReferences.map((reference) => reference.id),
      prompt,
      provider: {
        adapter: providerDescription.adapter,
        model: providerDescription.model,
        profile_name: providerDescription.profile_name,
      },
    };
  }

  return { condensePrompt, renderScene };
}

module.exports = { createImageryService };
