'use strict';

const TONE_INSTRUCTIONS = {
  'fade-to-black': 'This story should keep things tasteful: romance and tension are welcome, but intimate moments should fade to black before anything explicit.',
  romantic: 'This story may include sensual, romantic content with emotional intimacy, described evocatively but not graphically.',
  explicit: 'This story is intended for adults (18+) and may include explicit, graphic erotic content between consenting adult characters. All characters in intimate scenes are adults.',
};

// How many recent pages are included verbatim in the AI context window.
const CONTEXT_WINDOW = parseInt(process.env.CONTEXT_WINDOW || '5', 10);

const STATE_MARKER_TEXT = '<<<CHARACTER_STATE>>>';

function characterBlock(c, { withId = false } = {}) {
  const evolved = c.state && typeof c.state === 'object';
  const personality = evolved && c.state.personality ? `${c.state.personality} (as the story has reshaped them)` : (c.personality || '');
  const appearance = evolved && c.state.appearance ? `${c.state.appearance} (as the story has reshaped them)` : (c.appearance || '');
  return (
    `- ${c.name}${withId ? ` [id: ${c.id}]` : ''}: ${c.description || ''}\n` +
    `  Personality: ${personality}\n  Appearance: ${appearance}\n  Background: ${c.background || ''}`
  );
}

function firstSentence(text) {
  const s = String(text || '').trim();
  if (!s) return 'not yet defined';
  const cut = s.split(/\n|(?<=[.!?])\s/)[0];
  return cut.length > 160 ? cut.slice(0, 157) + '…' : cut;
}

function castSections(characters, { withIds = false } = {}) {
  const mc = characters.filter((c) => c.role === 'mc');
  const background = characters.filter((c) => c.role === 'background');
  const supporting = characters.filter((c) => c.role !== 'mc' && c.role !== 'background');
  const sections = [];

  if (mc.length > 0) {
    sections.push(
      'PROTAGONIST / MAIN CHARACTER (the story follows this character; keep their voice, goals and perception central):\n' +
        characterBlock(mc[0], { withId: withIds })
    );
  }
  if (supporting.length > 0) {
    sections.push(
      'SUPPORTING CAST (important to the main character; stay consistent with these details and their current standing with the protagonist):\n' +
        supporting
          .map((c) => {
            const evolvedRelation =
              c.state && typeof c.state === 'object' && c.state.relationship_to_mc ? c.state.relationship_to_mc : null;
            const relation = evolvedRelation
              ? `${evolvedRelation} (as the story has reshaped it; it began as: ${c.relation || 'unspecified'})`
              : (c.relation || 'unspecified');
            return characterBlock(c, { withId: withIds }) + `\n  Relation to the main character: ${relation}`;
          })
          .join('\n')
    );
  }
  if (background.length > 0) {
    sections.push(
      'BACKGROUND FIGURES (minor presences - keep them loose, improvise plausible detail only as the scene needs):\n' +
        background.map((c) => `- ${c.name}: ${firstSentence(c.description)}`).join('\n')
    );
  }
  return sections;
}

// The state-update contract appended to prompts when the story has a cast.
function stateUpdateInstruction(characters) {
  const ids = characters.map((c) => c.id);
  return (
    `CHARACTER STATE UPDATES: after the story text, output a line that reads exactly ${STATE_MARKER_TEXT} ` +
    'followed by one strict JSON object mapping character ids to the fields this page changed, e.g. ' +
    `{"${ids[0]}": {"personality": "...", "appearance": "...", "relationship_to_mc": "..."}}. ` +
    'Include ONLY characters who appear in this page, and ONLY fields that meaningfully changed through its events ' +
    '(injury, revelation, vows, betrayal, grief, new resolve). Evolution is book-paced: compressed and consequence-driven, ' +
    'a chapter-shaped approximation of a person, not lifelike gradual drift. Never restate unchanged fields. ' +
    'If nothing meaningful changed, omit the entire block and end after the story text.'
  );
}

function buildPrompt({ story, world, characters, pages, userInput, wordTarget }) {
  const parts = [];
  parts.push('You are an interactive fiction writer. You write one page at a time and never break the fourth wall.');
  parts.push(`TONE: ${TONE_INSTRUCTIONS[story.tone] || TONE_INSTRUCTIONS['fade-to-black']}`);

  if (world) {
    parts.push(
      `WORLD SETTING:\nName: ${world.name}\nDescription: ${world.description || '(none)'}\nGenre: ${world.genre || '(any)'}\nSetting: ${world.setting || '(any)'}`
    );
    if (world.lore) parts.push(`LOREBOOK (canonical facts of this world - honor them):\n${world.lore}`);
  }

  const castParts = castSections(characters || [], { withIds: true });
  if (castParts.length > 0) {
    parts.push(...castParts);
    parts.push(stateUpdateInstruction(characters));
  } else if ((characters || []).length > 0) {
    parts.push('CHARACTERS:\n' + characters.map((c) => characterBlock(c)).join('\n'));
  }

  const includedPages = (pages && pages.included) || [];
  if (includedPages.length > 0) {
    const omitted = (pages.total || 0) - includedPages.length;
    let context = 'PREVIOUS PAGES:\n';
    if (omitted > 0) {
      context += `[... ${omitted} earlier page(s) omitted for brevity. The tale so far began with: "${pages.firstContent}" ...]\n`;
    }
    context += includedPages.map((p) => `Page ${p.page_number}:\n${p.content}`).join('\n\n');
    parts.push(context);
  }

  parts.push(`USER DIRECTION FOR THE NEXT PAGE: ${userInput}`);
  const lengthLine = wordTarget
    ? `Write the next page of the story (approximately ${wordTarget} words; a little over or under is fine).`
    : 'Write the next page of the story (roughly 300-500 words).';
  parts.push(
    lengthLine +
      ' Continue seamlessly from the previous pages, ' +
      'stay consistent with the world and characters, and honor the user direction. ' +
      'End at a natural moment. Output ONLY the story text - no titles, no meta-commentary, no explanations.'
  );
  return parts.join('\n\n');
}

// What each story tone permits in a *visual* rendering of a scene. Every
// image generator moderates its own way, and a refused generation fails
// wholesale - so EVERY tone composes renderable prompts: implication,
// never explicit anatomy or gore. The 18+ case leans into charged mood
// instead of refused anatomy.
const IMAGE_TONE_INSTRUCTIONS = {
  'fade-to-black':
    'This story keeps things tasteful and the image must too: NEVER depict sex scenes, nudity, or gory/graphic battles. ' +
    'Render such moments obliquely - aftermath, charged stillness, silhouettes, smoke, implied intensity. Nothing explicit.',
  romantic:
    'This story may be sensual: the image carries romantic, sensual mood - closeness, longing, charged atmosphere - ' +
    'rendered suggestively and tastefully, never explicitly.',
  explicit:
    'This story is intended for adults (18+), but the image generator REFUSES explicit content and fails the entire ' +
    'generation. Compose a RENDERABLE image of the adult scene: imply it artfully - shadow, drapery, silhouettes, ' +
    'aftermath, charged tension - with NO explicit nudity or anatomy and no graphic gore; stylized implication only. ' +
    'All characters are adults.',
};

function buildImagePrompt({ story, world, characters, pages }) {
  const parts = [];
  parts.push('You are an art director translating a written scene into a single prompt for an image-generation AI.');
  parts.push(`CONTENT RULES: ${IMAGE_TONE_INSTRUCTIONS[story.tone] || IMAGE_TONE_INSTRUCTIONS['fade-to-black']}`);

  if (world) {
    parts.push(
      `WORLD (sets the overall tone, palette and atmosphere of the image):\n` +
        `Name: ${world.name}\nDescription: ${world.description || '(none)'}\n` +
        `Genre: ${world.genre || '(any)'}\nSetting: ${world.setting || '(any)'}`
    );
    if (world.lore) parts.push(`LOREBOOK:\n${world.lore}`);
  }

  const castParts = castSections(characters || []);
  if (castParts.length > 0) {
    parts.push(...castParts);
    parts.push(
      'Cast appearance notes above reflect how the story has reshaped each character so far. ' +
        'Describe only the characters actually present in the scene to illustrate, AS THEY ARE IN THIS MOMENT: ' +
        'what is happening on the final page changes how they look - a burning character is on fire, ' +
        'an undressed character is undressed, a wounded character is wounded.'
    );
  }

  const includedPages = (pages && pages.included) || [];
  if (includedPages.length > 0) {
    const omitted = (pages.total || 0) - includedPages.length;
    let context = 'PREVIOUS PAGES (context for environment and events):\n';
    if (omitted > 0) {
      context += `[... ${omitted} earlier page(s) omitted for brevity. The tale so far began with: "${pages.firstContent}" ...]\n`;
    }
    context += includedPages.map((p) => `Page ${p.page_number}:\n${p.content}`).join('\n\n');
    parts.push(context);
  }

  parts.push(
    'THE SCENE TO ILLUSTRATE is the final page above. Condense everything into ONE image-generation prompt: ' +
      'the world\'s overall tone, the environment as it stands at this moment, the composition and framing of the shot, ' +
      'and each character present with their appearance exactly as the scene has left them. ' +
      'Aim for 80-160 words of plain descriptive prose, ready to paste into an image generator. ' +
      'Output ONLY the prompt text - no titles, no explanations, no markdown.'
  );
  return parts.join('\n\n');
}

// A character reference portrait: one figure, plain backdrop, reusable as an
// identity reference for later scene illustrations.
function buildCharacterImagePrompt(character) {
  const lines = [
    'Single-character reference portrait for an illustrated storybook: one figure, full body, standing, facing the viewer.',
    `Character: ${character.name}.`,
    `Description: ${character.description || '(unspecified)'}`,
  ];
  if (character.appearance) lines.push(`Appearance: ${character.appearance}`);
  if (character.personality) lines.push(`Personality (let it shape posture and expression): ${character.personality}`);
  if (character.background) lines.push(`Background hints (era, clothing, worn gear): ${character.background}`);
  lines.push(
    'Plain neutral background, soft even light. Only this character - no other people, no creatures, no text, no captions, no watermark.'
  );
  lines.push(
    'The portrait must pass strict image moderation: no explicit nudity or anatomy - imply tastefully through drapery, pose and framing.'
  );
  return lines.join('\n');
}

// A world reference image: a still, EMPTY place. The cast never appears here.
function buildWorldImagePrompt(world) {
  const lines = [
    'Empty establishing-shot environment for an illustrated storybook world: a still, unpopulated place.',
    'STRICTLY NO people, no humanoids, no creatures, no monsters, no animals, no motion, no action - the scene itself only.',
    `World: ${world.name}.`,
  ];
  if (world.description) lines.push(`Description: ${world.description}`);
  if (world.genre) lines.push(`Genre: ${world.genre}`);
  if (world.setting) lines.push(`Setting: ${world.setting}`);
  if (world.lore) lines.push(`Lore (places and atmosphere only - still no people, no creatures): ${world.lore}`);
  lines.push('No text, no captions, no watermark.');
  return lines.join('\n');
}

module.exports = {
  buildPrompt,
  buildImagePrompt,
  buildCharacterImagePrompt,
  buildWorldImagePrompt,
  CONTEXT_WINDOW,
  TONE_INSTRUCTIONS,
  IMAGE_TONE_INSTRUCTIONS,
  castSections,
  stateUpdateInstruction,
};