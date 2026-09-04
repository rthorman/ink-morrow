'use strict';

const FOURTH_WALL_MODES = ['never', 'rarely', 'freely'];
const RARE_SCENE_GAP = 6;

function fourthWallContext(state, intent) {
  const mode = state.fourth_wall || 'never';
  const cast = state.cast.filter((person) => person.id !== state.control.character_id).map((person) => person.id);
  const gapReady = state.last_fourth_wall_scene == null || (state.scene_count || 0) + 1 - state.last_fourth_wall_scene >= RARE_SCENE_GAP;
  return { mode, allowed: state.play_style === 'living-world' && intent.kind !== 'ask' && cast.length > 0
    && (mode === 'freely' || (mode === 'rarely' && gapReady)),
  eligible_character_ids: cast, max_text_characters: 600 };
}

function validateAside(value, state, intent, { keys, text, fail }) {
  if (value === undefined || value === null) return null;
  const permission = fourthWallContext(state, intent);
  if (!permission.allowed) fail('A fourth-wall address is not permitted in this response. Nothing was added.', 'FOURTH_WALL_NOT_ALLOWED', 502);
  keys(value, ['character_id', 'text'], 'Fourth-wall address');
  if (!permission.eligible_character_ids.includes(value.character_id)) fail('The narrator cannot supply a fourth-wall address for this character.', 'OWNED_CHARACTER_BOUNDARY', 502);
  return { character: state.cast.find((person) => person.id === value.character_id), text: text(value.text, 'Fourth-wall address', permission.max_text_characters) };
}

module.exports = { FOURTH_WALL_MODES, RARE_SCENE_GAP, fourthWallContext, validateAside };
