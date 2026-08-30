'use strict';

// Catalog store: worlds and characters SQL. Worlds are canonical (stories
// reference the live row); characters receive immutable per-story snapshots
// when cast, with later evolution held by the continuity ledger.

const { v4: uuidv4 } = require('uuid');
const { optionalText, asString } = require('../../core/validation');

function createCatalogStore(db) {
  const getWorld = (id) => db.prepare('SELECT * FROM worlds WHERE id = ?').get(id);
  const getCharacter = (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);

  function listWorlds() {
    return db.prepare('SELECT * FROM worlds ORDER BY updated_at DESC').all();
  }

  function listCharacters(worldId = null) {
    return worldId
      ? db.prepare('SELECT * FROM characters WHERE world_id = ? ORDER BY updated_at DESC').all(worldId)
      : db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all();
  }

  function createWorld({ name, description, genre, setting }) {
    const id = uuidv4();
    db.prepare('INSERT INTO worlds (id, name, description, genre, setting) VALUES (?, ?, ?, ?, ?)').run(
      id, name, description, genre, setting
    );
    return { id, world: getWorld(id) };
  }

  function updateWorld(world, { name, description, genre, setting, lore, imagePrompt }) {
    db.prepare(
      'UPDATE worlds SET name = ?, description = ?, genre = ?, setting = ?, lore = ?, image_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(name, description, genre, setting, lore, imagePrompt, world.id);
    return getWorld(world.id);
  }

  function worldReferenceCounts(worldId) {
    return {
      characters: db.prepare('SELECT COUNT(*) AS c FROM characters WHERE world_id = ?').get(worldId).c,
      stories: db.prepare('SELECT COUNT(*) AS c FROM stories WHERE world_id = ?').get(worldId).c,
    };
  }

  function deleteWorld(worldId) {
    db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
  }

  function createCharacter(payload) {
    const id = uuidv4();
    db.prepare(
      'INSERT INTO characters (id, name, description, personality, appearance, background, world_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, payload.name, payload.description, payload.personality, payload.appearance, payload.background, payload.world_id);
    return { id, character: getCharacter(id) };
  }

  function updateCharacter(characterId, payload) {
    db.prepare(
      'UPDATE characters SET name = ?, description = ?, personality = ?, appearance = ?, background = ?, world_id = ?, image_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(payload.name, payload.description, payload.personality, payload.appearance, payload.background, payload.world_id, payload.image_prompt, characterId);
    return getCharacter(characterId);
  }

  function deleteCharacter(characterId) {
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  }

  // -- payload validation ------------------------------------------------------
  // World create: name required, others optional text.
  function validateWorldCreatePayload(body) {
    const name = optionalText(body.name, { max: 200 });
    if (name === null || name === undefined) return { error: '"name" is required' };
    const description = optionalText(body.description);
    const genre = optionalText(body.genre, { max: 100 });
    const setting = optionalText(body.setting, { max: 200 });
    if ([description, genre, setting].includes(undefined)) return { error: 'World fields must be text' };
    return { name, description, genre, setting };
  }

  function validateWorldUpdatePayload(body, world) {
    const name = body.name === undefined ? world.name : optionalText(body.name, { max: 200 });
    if (name === null || name === undefined) return { error: '"name" cannot be empty' };
    const description = body.description === undefined ? world.description : optionalText(body.description);
    const genre = body.genre === undefined ? world.genre : optionalText(body.genre, { max: 100 });
    const setting = body.setting === undefined ? world.setting : optionalText(body.setting, { max: 200 });
    // The lorebook lives here, deliberately out of the creation form.
    const lore = body.lore === undefined ? world.lore : optionalText(body.lore, { max: 20000 });
    // Editable blurb sent to the image generator (empty = auto-composed)
    const imagePrompt = body.image_prompt === undefined ? world.image_prompt : optionalText(body.image_prompt, { max: 2000 });
    if ([description, genre, setting, lore, imagePrompt].includes(undefined)) {
      return { error: 'World fields must be text' };
    }
    return { name, description, genre, setting, lore, imagePrompt };
  }

  function validateCharacterPayload(body, { partial = false, existing = null } = {}) {
    const name = body.name === undefined
      ? (partial ? existing.name : null)
      : optionalText(body.name, { max: 200 });
    if (name === null || name === undefined) return { error: '"name" is required' };

    const fields = {};
    for (const key of ['description', 'personality', 'appearance', 'background']) {
      const value = body[key] === undefined
        ? (partial ? existing[key] : null)
        : optionalText(body[key]);
      if (value === undefined) return { error: `"${key}" must be text` };
      fields[key] = value;
    }

    // Editable blurb sent to the image generator (empty = auto-composed)
    const imagePrompt = body.image_prompt === undefined
      ? (partial ? existing.image_prompt : null)
      : optionalText(body.image_prompt, { max: 2000 });
    if (imagePrompt === undefined) return { error: '"image_prompt" must be text' };
    fields.image_prompt = imagePrompt;

    let world_id = existing ? existing.world_id : null;
    if (body.world_id !== undefined) {
      world_id = body.world_id === null || body.world_id === '' ? null : asString(body.world_id);
      if (world_id && !getWorld(world_id)) return { error: 'world_id does not reference an existing world' };
    } else if (!partial && body.world_id === undefined) {
      world_id = null;
    }

    return { name, ...fields, world_id };
  }

  return {
    getWorld,
    getCharacter,
    listWorlds,
    listCharacters,
    createWorld,
    updateWorld,
    worldReferenceCounts,
    deleteWorld,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    validateWorldCreatePayload,
    validateWorldUpdatePayload,
    validateCharacterPayload,
  };
}

module.exports = { createCatalogStore };
