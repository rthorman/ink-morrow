'use strict';

const TONE_INSTRUCTIONS = {
  'fade-to-black': 'This story should keep things tasteful: romance and tension are welcome, but intimate moments should fade to black before anything explicit.',
  romantic: 'This story may include sensual, romantic content with emotional intimacy, described evocatively but not graphically.',
  explicit: 'This story is intended for adults (18+) and may include explicit, graphic erotic content between consenting adult characters. All characters in intimate scenes are adults.',
};

// How many recent pages are included verbatim in the AI context window.
const CONTEXT_WINDOW = parseInt(process.env.CONTEXT_WINDOW || '5', 10);

function characterBlock(c) {
  return (
    `- ${c.name}: ${c.description || ''}\n` +
    `  Personality: ${c.personality || ''}\n  Appearance: ${c.appearance || ''}\n  Background: ${c.background || ''}`
  );
}

function firstSentence(text) {
  const s = String(text || '').trim();
  if (!s) return 'not yet defined';
  const cut = s.split(/\n|(?<=[.!?])\s/)[0];
  return cut.length > 160 ? cut.slice(0, 157) + '…' : cut;
}

function castSections(characters) {
  const mc = characters.filter((c) => c.role === 'mc');
  const background = characters.filter((c) => c.role === 'background');
  const supporting = characters.filter((c) => c.role !== 'mc' && c.role !== 'background');
  const sections = [];

  if (mc.length > 0) {
    sections.push(
      'PROTAGONIST (the story follows this character; keep their voice, goals and perception central):\n' +
        characterBlock(mc[0])
    );
  }
  if (supporting.length > 0) {
    sections.push(
      'SUPPORTING CAST (important to the protagonist; stay consistent with these details):\n' +
        supporting.map(characterBlock).join('\n')
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

function buildPrompt({ story, world, characters, pages, userInput, wordTarget }) {
  const parts = [];
  parts.push('You are an interactive fiction writer. You write one page at a time and never break the fourth wall.');
  parts.push(`TONE: ${TONE_INSTRUCTIONS[story.tone] || TONE_INSTRUCTIONS['fade-to-black']}`);

  if (world) {
    parts.push(
      `WORLD SETTING:\nName: ${world.name}\nDescription: ${world.description || '(none)'}\nGenre: ${world.genre || '(any)'}\nSetting: ${world.setting || '(any)'}`
    );
  }

  const castParts = castSections(characters || []);
  if (castParts.length > 0) {
    parts.push(...castParts);
  } else if ((characters || []).length > 0) {
    parts.push('CHARACTERS:\n' + characters.map(characterBlock).join('\n'));
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

module.exports = { buildPrompt, CONTEXT_WINDOW, TONE_INSTRUCTIONS, castSections };