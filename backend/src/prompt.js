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

module.exports = { buildPrompt, CONTEXT_WINDOW, TONE_INSTRUCTIONS, castSections, stateUpdateInstruction };