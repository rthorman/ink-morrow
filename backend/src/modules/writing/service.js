'use strict';

// Writing service: prompt/context orchestration, quality expectations,
// continuity-ledger retrieval, and speculative previews. The AI adapter
// (ai.js), prompt builder (prompt.js) and quality rules (quality.js) stay
// the domain modules they already were.

const { buildPrompt, CONTEXT_WINDOW } = require('../../prompt');
const { splitStateBlock } = require('../stories/cast');

// Rough token budget for a target length (words + instructions + headroom).
function tokensForWords(words) {
  return words * 2 + 250;
}

// Quality expectations for story pages: when the writer asked for a
// specific length, hold the scribe to at least a quarter of it (floor 15
// words - "a little under" is fine, a tenth is not). A target-less
// (legacy) request is only checked for emptiness, truncation and language.
function pageQuality(wordTarget) {
  return wordTarget ? { minWords: Math.max(15, Math.round(wordTarget * 0.25)) } : {};
}

function parseAiJson(content) {
  const cleaned = String(content).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function createWritingService({ catalog, stories, continuity, chatCompletion }) {
  function castCharacters(story) {
    return continuity.contextForPrompt(story).characters;
  }

  function loadContext(story, { excludeLast = false, userInput = '' } = {}) {
    const world = story.world_id ? catalog.getWorld(story.world_id) : null;
    const allPages = stories.storyPages(story.id);
    const excluded = excludeLast && allPages.length ? [allPages[allPages.length - 1].id] : [];
    if (excludeLast) allPages.pop();
    const included = allPages.slice(-CONTEXT_WINDOW);
    const memory = continuity.contextForPrompt(story, {
      userInput,
      excludePageIds: excluded,
      throughPageNumber: excludeLast && allPages.length ? allPages[allPages.length - 1].page_number : null,
      recentPageIds: included.map((page) => page.id),
    });
    return {
      world,
      characters: memory.characters,
      continuity: memory,
      pages: {
        total: allPages.length,
        included,
      },
    };
  }

  function generationMessages(story, ctx, userInput, wordTarget) {
    return [
      { role: 'system', content: 'You are a talented, disciplined fiction writer.' },
      { role: 'user', content: buildPrompt({
        story, world: ctx.world, characters: ctx.characters, continuity: ctx.continuity,
        pages: ctx.pages, userInput, wordTarget,
      }) },
    ];
  }

  // Old providers/previews can still carry the pre-3.1 marker. Strip it so it
  // never leaks into prose, but never trust it as state: only the independent
  // page-linked extractor may change continuity now.
  function consumeStoryText(rawContent) {
    const { prose } = splitStateBlock(rawContent);
    if (!prose) {
      const err = new Error('AI returned an empty response');
      err.statusCode = 502;
      throw err;
    }
    return prose;
  }

  // One shared generation call shape for generate/regenerate/preview.
  function completePage({ story, userInput, wordTarget, modelOverride, reasoningEffort, excludeLast = false }) {
    const ctx = loadContext(story, { excludeLast, userInput });
    return chatCompletion(
      generationMessages(story, ctx, userInput, wordTarget),
      {
        model: modelOverride || undefined,
        reasoningEffort,
        quality: pageQuality(wordTarget),
        ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}),
      }
    );
  }

  // -- AI drafts (world / character fleshing-out) -----------------------------

  const DRAFT_LENGTHS = {
    short: { label: 'short', world: 'Keep the description to 2-3 vivid sentences.', character: 'Keep each field to 1-2 sentences except the description (2-3 sentences).' },
    medium: { label: 'medium', world: 'Aim for roughly 120-180 words of description.', character: 'Aim for roughly 25-50 words per field.' },
    long: { label: 'long', world: 'Aim for roughly 300-450 words of description, rich but disciplined.', character: 'Aim for roughly 60-110 words per field.' },
  };

  function draftVariantLine(variant) {
    return variant > 1
      ? `This is take ${variant}: the user rejected earlier drafts. Produce a DISTINCTLY different interpretation - different central tension, texture and emphasis. Do not recycle the previous ideas.`
      : '';
  }

  async function runDraft(buildPrompt, modelOverride) {
    const SYSTEM_BASE =
      'You are a precise creative assistant for an interactive-fiction tool. You always answer with a single strict JSON object and nothing else - no markdown fences, no commentary.';

    const attempt = (extraNote) =>
      chatCompletion(
        [
          { role: 'system', content: extraNote ? `${SYSTEM_BASE} ${extraNote}` : SYSTEM_BASE },
          { role: 'user', content: buildPrompt() },
        ],
        { model: modelOverride || undefined, temperature: 0.95 }
      );

    // Unseeded drafts make some models ramble; one corrective retry keeps
    // the UX stable. Both attempts are billed, so both costs are summed.
    let first = await attempt();
    let parsed = parseAiJson(first.content);
    let billedAttempts = Number.isInteger(first.billed_attempts) ? first.billed_attempts : 1;
    let costKnown = typeof first.cost_usd === 'number' && Number.isFinite(first.cost_usd);
    let cost = costKnown ? first.cost_usd : 0;
    if (!parsed) {
      let second;
      try {
        second = await attempt('Your previous answer was not a valid JSON object. This time return ONLY the JSON object.');
      } catch (error) {
        const secondAttempts = Number.isInteger(error.billedAttempts) ? error.billedAttempts : 0;
        const secondCostKnown = typeof error.costUsd === 'number' && Number.isFinite(error.costUsd);
        error.billedAttempts = billedAttempts + secondAttempts;
        error.costUsd = secondAttempts === 0
          ? (costKnown ? cost : null)
          : (costKnown && secondCostKnown ? cost + error.costUsd : null);
        throw error;
      }
      billedAttempts += Number.isInteger(second.billed_attempts) ? second.billed_attempts : 1;
      const secondCostKnown = typeof second.cost_usd === 'number' && Number.isFinite(second.cost_usd);
      if (secondCostKnown) cost += second.cost_usd;
      costKnown = costKnown && secondCostKnown;
      parsed = parseAiJson(second.content);
      first = second;
    }
    if (!parsed) {
      const err = new Error('The scribe scribbled something illegible. Try again.');
      err.statusCode = 502;
      err.billedAttempts = billedAttempts;
      err.costUsd = costKnown ? cost : null;
      throw err;
    }
    return { parsed, result: first, cost_usd: costKnown ? cost : null };
  }

  function draftLengthAndVariant(body) {
    const length = DRAFT_LENGTHS[body.length] ? body.length : 'medium';
    const variant = Math.min(Math.max(parseInt(body.variant, 10) || 1, 1), 50);
    return { length, variant };
  }

  async function draftWorld(body, modelOverride) {
    const seeds = {
      name: body.name,
      description: body.description,
      genre: body.genre,
      setting: body.setting,
    };
    const { length, variant } = draftLengthAndVariant(body);
    const { parsed, result, cost_usd } = await runDraft(() => {
      const seedLines = Object.entries(seeds)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
      return [
        'Flesh out a fictional world for interactive fiction. It must feel consistent and believable: an internal logic that holds, a history that explains the present, and one striking central tension a story could grow from.',
        'Genre and setting must cohere with the description.',
        seedLines.length ? `THE USER'S SEED (honor it; keep any given name unless it is empty, and build outward from these hints):\n${seedLines.join('\n')}` : 'The user gave no seed - invent freely.',
        DRAFT_LENGTHS[length].world,
        draftVariantLine(variant),
        'Return strict JSON with exactly these keys: {"name": string, "description": string, "genre": string (a short phrase, max ~40 chars), "setting": string (a short phrase, max ~60 chars)}',
      ].filter(Boolean).join('\n\n');
    });
    return {
      world: parsed,
      model: result.model,
      cost_usd,
      seeds,
    };
  }

  async function draftCharacter(body, modelOverride, world) {
    const seeds = {
      name: body.name,
      description: body.description,
      personality: body.personality,
      appearance: body.appearance,
      background: body.background,
    };
    const { length, variant } = draftLengthAndVariant(body);
    const { parsed, result, cost_usd } = await runDraft(() => {
      const seedLines = Object.entries(seeds)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
      return [
        'Flesh out a fictional character for interactive fiction. The character should be statistically unusual - someone you do not meet in every story - yet NEVER a caricature. Psychological believability is the highest law: real motives, a specific internal contradiction, coping habits, and things they avoid. Avoid stock clichés (the chosen one, the amnesiac, the brooding loner, the quirky manic pixie) unless you subvert them with fresh, concrete specifics. Appearance serves character, not a character sheet.',
        world ? `THE WORLD they live in (stay consistent with it):\nName: ${world.name}\nDescription: ${world.description || '(none)'}\nGenre: ${world.genre || '(any)'}\nSetting: ${world.setting || '(any)'}` : '',
        seedLines.length ? `THE USER'S SEED (honor it; keep any given name unless it is empty, and build outward from these hints):\n${seedLines.join('\n')}` : 'The user gave no seed - invent freely.',
        DRAFT_LENGTHS[length].character,
        draftVariantLine(variant),
        'Return strict JSON with exactly these keys: {"name": string, "description": string, "personality": string, "appearance": string, "background": string}',
      ].filter(Boolean).join('\n\n');
    });
    return {
      character: parsed,
      model: result.model,
      cost_usd,
      seeds,
    };
  }

  async function draftFoundations(body, modelOverride) {
    const seeds = {
      premise: body.premise,
      narrative_voice: body.narrative_voice,
      point_of_view: body.point_of_view,
      tense: body.tense,
      constraints: body.constraints,
    };
    const { variant } = draftLengthAndVariant(body);
    const { parsed, result, cost_usd } = await runDraft(() => {
      const seedLines = Object.entries(seeds)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${value}`);
      return [
        'Draft compact foundations for a long-form work of narrative fiction. Preserve the author as the dominant co-author: propose intent and craft choices, never plot the entire book or write opening prose.',
        seedLines.length
          ? `THE AUTHOR'S SEED (honor every supplied field and build only into blank fields):\n${seedLines.join('\n')}`
          : 'The author supplied no seed. Propose a coherent but editable starting point.',
        'Keep premise and constraints under 120 words each. Keep narrative_voice, point_of_view, and tense under 40 words each.',
        'The client will present every proposed field separately for the author to accept, edit, or ignore.',
        draftVariantLine(variant),
        'Return strict JSON with exactly these keys: {"premise": string, "narrative_voice": string, "point_of_view": string, "tense": string, "constraints": string}',
      ].filter(Boolean).join('\n\n');
    });
    return { foundations: parsed, model: result.model, cost_usd, seeds };
  }

  return {
    castCharacters,
    loadContext,
    generationMessages,
    consumeStoryText,
    completePage,
    parseAiJson,
    draftWorld,
    draftCharacter,
    draftFoundations,
    DRAFT_LENGTHS,
  };
}

module.exports = { createWritingService, tokensForWords, pageQuality, parseAiJson };
