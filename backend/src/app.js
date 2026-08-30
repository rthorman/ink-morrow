'use strict';

const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { chatCompletion, listModels, listSpeechModels, createSpeech, fetchGenerationCost } = require('./ai');
const { buildEpub } = require('./epub');
const { generateImage, createImageStore } = require('./images');
const {
  buildPrompt,
  buildImagePrompt,
  buildCharacterImagePrompt,
  buildWorldImagePrompt,
  CONTEXT_WINDOW,
} = require('./prompt');

const TONES = ['fade-to-black', 'romantic', 'explicit'];

// Model ids from clients are bounded and forwarded verbatim to OpenRouter.
function modelOverrideOf(value) {
  const model = asString(value);
  return model && model.length <= 200 ? model : null;
}
const CAST_ROLES = ['mc', 'supporting', 'background'];
const REASONING_EFFORTS = ['low', 'medium', 'high'];

function parseReasoningEffort(value) {
  if (value === undefined || value === null || value === '') return null;
  const effort = asString(value);
  return REASONING_EFFORTS.includes(effort) ? effort : null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function asString(value) {
  return typeof value === 'string' ? value.trim() : null;
}

function optionalText(value, { max = 10000 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined; // wrong type
  const s = value.trim();
  if (s.length > max) return undefined;
  return s || null;
}

function requiredText(value, { max = 200 } = {}) {
  const s = optionalText(value, { max });
  return s === null || s === undefined ? s : s; // caller checks null/undefined
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function notFound(res, message) {
  return res.status(404).json({ error: message });
}

// ---------------------------------------------------------------------------
// App factory - injectable db so tests never touch the real database
// ---------------------------------------------------------------------------

function createApp(
  db,
  { staticDir = path.join(__dirname, '../../frontend'), imageDir = path.join(__dirname, '../../database/images') } = {}
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Simple request log (skip static + health noise + test runs)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && process.env.NODE_ENV !== 'test') {
      console.log(`${req.method} ${req.path}`);
    }
    next();
  });

  // -- helpers -------------------------------------------------------------

  const getWorld = (id) => db.prepare('SELECT * FROM worlds WHERE id = ?').get(id);
  const getCharacter = (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const getStory = (id) => db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  const storyPages = (storyId) =>
    db.prepare('SELECT * FROM story_pages WHERE story_id = ? ORDER BY page_number').all(storyId);

  const storyWithMeta = (story) => ({
    ...story,
    characters: normalizeCast(JSON.parse(story.characters || '[]')),
    page_count: db.prepare('SELECT COUNT(*) AS c FROM story_pages WHERE story_id = ?').get(story.id).c,
    total_cost_usd: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM story_pages WHERE story_id = ?').get(story.id).s,
  });

  // Cast entries are {id, role, relation, state}. role is mc|supporting|
  // background; relation is free text (supporting cast's tie to the MC at the
  // story's start); state holds the per-story mutable instance of a character
  // (personality/appearance/relationship as the story reshapes them).
  function normalizeCastEntry(entry) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim()) {
      const role = entry.role === undefined || entry.role === null ? 'supporting' : asString(entry.role);
      if (!role || !CAST_ROLES.includes(role)) {
        return { error: `"characters[].role" must be one of: ${CAST_ROLES.join(', ')}` };
      }
      const relation = entry.relation === undefined || entry.relation === null ? null : optionalText(entry.relation, { max: 2000 });
      if (relation === undefined) return { error: '"characters[].relation" must be text' };
      const state = entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state) ? entry.state : null;
      return { id: entry.id.trim(), role, relation, state };
    }
    return { error: '"characters" must contain {id, role} cast entries' };
  }

  function normalizeCast(entries) {
    return (Array.isArray(entries) ? entries : []).map((e) => {
      const n = normalizeCastEntry(e);
      return n.error ? null : n;
    }).filter(Boolean);
  }

  // Validates a cast payload: entries exist, roles are legal, at most one MC.
  function validateCastPayload(value) {
    if (!Array.isArray(value)) return { error: '"characters" must be an array of character ids' };
    const cast = [];
    for (const entry of value) {
      const normalized = normalizeCastEntry(entry);
      if (normalized.error) return { error: normalized.error };
      if (!getCharacter(normalized.id)) return { error: `characters contains unknown id: ${normalized.id}` };
      cast.push(normalized);
    }
    if (cast.filter((c) => c.role === 'mc').length > 1) {
      return { error: 'A story can follow only one main character. Move the others to supporting or background.' };
    }
    return { cast };
  }

  // -- reference images (characters & worlds) -------------------------------
  // Generated in the background through a sequential queue: creation
  // responds instantly, the portrait/scene lands when the model finishes.

  const imageStore = createImageStore(imageDir);
  const imageQueue = [];
  const imageInFlight = new Set(); // 'character:<id>' keys being generated
  let imageWorking = false;
  // Auto-generation (creation + boot backfill) can be silenced in tests so it
  // never steals mocked upstream calls; explicit redo always works.
  const autoImagesEnabled = process.env.NODE_ENV !== 'test' || process.env.ENABLE_BACKGROUND_IMAGES === '1';

  const tableFor = (kind) => (kind === 'world' ? 'worlds' : 'characters');

  function enqueueEntityImage(kind, id, { auto = false } = {}) {
    if (auto && !autoImagesEnabled) return;
    const key = kind + ':' + id;
    if (imageInFlight.has(key)) return; // already queued or generating
    const table = tableFor(kind);
    const row = db.prepare('SELECT image_status FROM ' + table + ' WHERE id = ?').get(id);
    if (!row) return;
    if (row.image_status === 'pending' || imageInFlight.has(key)) return;
    imageInFlight.add(key);
    db.prepare('UPDATE ' + table + " SET image_status = 'pending' WHERE id = ?").run(id);
    imageQueue.push({ kind, id });
    drainImageQueue();
  }

  async function drainImageQueue() {
    if (imageWorking) return;
    imageWorking = true;
    try {
      while (imageQueue.length > 0) {
        const { kind, id } = imageQueue.shift();
        const key = kind + ':' + id;
        const table = tableFor(kind);
        try {
          const row = db.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(id);
          if (!row) continue; // deleted while queued
          // An edited blurb overrides the auto-composed one
          const prompt =
            row.image_prompt && row.image_prompt.trim()
              ? row.image_prompt
              : kind === 'world'
                ? buildWorldImagePrompt(row)
                : buildCharacterImagePrompt(row);
          const result = await generateImage({
            prompt,
            // Characters are reused as identity references, worlds set mood:
            quality: kind === 'world' ? 'low' : 'medium',
            resolution: '1K',
            aspectRatio: '3:4',
          });
          imageStore.writeImage(kind, id, result.buffer, result.mediaType);
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'ready', image_media_type = ?, image_cost_usd = ?, image_updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(result.mediaType, result.cost, id);
        } catch (error) {
          db.prepare(
            'UPDATE ' + table + " SET image_status = 'failed', image_updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(id);
          console.error(`Reference image (${kind} ${id}) failed:`, error.message);
        } finally {
          imageInFlight.delete(key);
        }
      }
    } finally {
      imageWorking = false;
    }
  }

  function serveEntityImage(kind, req, res) {
    const table = tableFor(kind);
    const row = db.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(req.params.id);
    if (!row) return notFound(res, 'Not found');
    if (row.image_status !== 'ready') {
      return res.status(404).json({ error: kind === 'world' ? 'World has no image yet.' : 'Character has no image yet.' });
    }
    const image = imageStore.readImage(kind, row.id);
    if (!image) return notFound(res, 'Image file is missing');
    res.setHeader('Content-Type', image.mediaType);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(image.buffer);
  }

  app.get('/api/worlds/:id/image', (req, res) => serveEntityImage('world', req, res));
  app.post('/api/worlds/:id/image', (req, res) => {
    const world = getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    enqueueEntityImage('world', world.id);
    return res.json({ image_status: 'pending' });
  });

  app.get('/api/characters/:id/image', (req, res) => serveEntityImage('character', req, res));
  app.post('/api/characters/:id/image', (req, res) => {
    const character = getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    enqueueEntityImage('character', character.id);
    return res.json({ image_status: 'pending' });
  });

  // Backfill: existing entities get their reference image in the background
  // as soon as the server boots with an API key configured.
  if (process.env.OPENROUTER_API_KEY && autoImagesEnabled) {
    for (const row of db
      .prepare("SELECT id FROM characters WHERE image_status IS NULL OR image_status = 'none'")
      .all()) {
      enqueueEntityImage('character', row.id);
    }
    for (const row of db.prepare("SELECT id FROM worlds WHERE image_status IS NULL OR image_status = 'none'").all()) {
      enqueueEntityImage('world', row.id);
    }
  }

  // -- worlds --------------------------------------------------------------

  app.get('/api/worlds', (req, res) => {
    res.json({ worlds: db.prepare('SELECT * FROM worlds ORDER BY updated_at DESC').all() });
  });

  app.get('/api/worlds/:id', (req, res) => {
    const world = getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    res.json({ world });
  });

  app.post('/api/worlds', (req, res) => {
    const name = optionalText(req.body.name, { max: 200 });
    if (name === null || name === undefined) return badRequest(res, '"name" is required');
    const description = optionalText(req.body.description);
    const genre = optionalText(req.body.genre, { max: 100 });
    const setting = optionalText(req.body.setting, { max: 200 });
    if ([description, genre, setting].includes(undefined)) return badRequest(res, 'World fields must be text');

    const id = uuidv4();
    db.prepare('INSERT INTO worlds (id, name, description, genre, setting) VALUES (?, ?, ?, ?, ?)').run(
      id, name, description, genre, setting
    );
    enqueueEntityImage('world', id, { auto: true }); // reference image in the background
    res.status(201).json({ world: getWorld(id) });
  });

  app.put('/api/worlds/:id', (req, res) => {
    const world = getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');

    const name = req.body.name === undefined ? world.name : optionalText(req.body.name, { max: 200 });
    if (name === null || name === undefined) return badRequest(res, '"name" cannot be empty');
    const description = req.body.description === undefined ? world.description : optionalText(req.body.description);
    const genre = req.body.genre === undefined ? world.genre : optionalText(req.body.genre, { max: 100 });
    const setting = req.body.setting === undefined ? world.setting : optionalText(req.body.setting, { max: 200 });
    // The lorebook lives here, deliberately out of the creation form.
    const lore = req.body.lore === undefined ? world.lore : optionalText(req.body.lore, { max: 20000 });
    // Editable blurb sent to the image generator (empty = auto-composed)
    const imagePrompt = req.body.image_prompt === undefined ? world.image_prompt : optionalText(req.body.image_prompt, { max: 2000 });
    if ([description, genre, setting, lore, imagePrompt].includes(undefined)) {
      return badRequest(res, 'World fields must be text');
    }

    db.prepare(
      'UPDATE worlds SET name = ?, description = ?, genre = ?, setting = ?, lore = ?, image_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(name, description, genre, setting, lore, imagePrompt, world.id);
    res.json({ world: getWorld(world.id) });
  });

  app.delete('/api/worlds/:id', (req, res) => {
    const world = getWorld(req.params.id);
    if (!world) return notFound(res, 'World not found');
    const characters = db.prepare('SELECT COUNT(*) AS c FROM characters WHERE world_id = ?').get(world.id).c;
    const stories = db.prepare('SELECT COUNT(*) AS c FROM stories WHERE world_id = ?').get(world.id).c;
    if (characters > 0 || stories > 0) {
      return res.status(409).json({
        error: `World is referenced by ${characters} character(s) and ${stories} story(ies). Delete or reassign them first.`,
      });
    }
    db.prepare('DELETE FROM worlds WHERE id = ?').run(world.id);
    imageStore.deleteImage('world', world.id); // never leave orphans
    res.status(204).end();
  });

  // -- characters ----------------------------------------------------------

  app.get('/api/characters', (req, res) => {
    const { world_id } = req.query;
    const rows = world_id
      ? db.prepare('SELECT * FROM characters WHERE world_id = ? ORDER BY updated_at DESC').all(world_id)
      : db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all();
    res.json({ characters: rows });
  });

  app.get('/api/characters/:id', (req, res) => {
    const character = getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    res.json({ character });
  });

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

  app.post('/api/characters', (req, res) => {
    const payload = validateCharacterPayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO characters (id, name, description, personality, appearance, background, world_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, payload.name, payload.description, payload.personality, payload.appearance, payload.background, payload.world_id);
    enqueueEntityImage('character', id, { auto: true }); // reference portrait in the background
    res.status(201).json({ character: getCharacter(id) });
  });

  app.put('/api/characters/:id', (req, res) => {
    const character = getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    const payload = validateCharacterPayload(req.body, { partial: true, existing: character });
    if (payload.error) return badRequest(res, payload.error);
    db.prepare(
      'UPDATE characters SET name = ?, description = ?, personality = ?, appearance = ?, background = ?, world_id = ?, image_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(payload.name, payload.description, payload.personality, payload.appearance, payload.background, payload.world_id, payload.image_prompt, character.id);
    res.json({ character: getCharacter(character.id) });
  });

  app.delete('/api/characters/:id', (req, res) => {
    const character = getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    // Remove the character from any story casts that reference it
    const stories = db.prepare('SELECT id, characters FROM stories').all();
    const update = db.prepare('UPDATE stories SET characters = ? WHERE id = ?');
    for (const story of stories) {
      const cast = JSON.parse(story.characters || '[]');
      const idOf = (entry) => (typeof entry === 'string' ? entry : entry && entry.id);
      if (cast.some((entry) => idOf(entry) === character.id)) {
        update.run(JSON.stringify(cast.filter((entry) => idOf(entry) !== character.id)), story.id);
      }
    }
    db.prepare('DELETE FROM characters WHERE id = ?').run(character.id);
    imageStore.deleteImage('character', character.id); // never leave orphans
    res.status(204).end();
  });

  // -- stories -------------------------------------------------------------

  app.get('/api/stories', (req, res) => {
    const { world_id } = req.query;
    const rows = world_id
      ? db.prepare('SELECT * FROM stories WHERE world_id = ? ORDER BY updated_at DESC').all(world_id)
      : db.prepare('SELECT * FROM stories ORDER BY updated_at DESC').all();
    res.json({ stories: rows.map(storyWithMeta) });
  });

  app.get('/api/stories/:id', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ story: storyWithMeta(story) });
  });

  function validateStoryPayload(body, { partial = false, existing = null } = {}) {
    const title = body.title === undefined
      ? (partial ? existing.title : null)
      : optionalText(body.title, { max: 300 });
    if (title === null || title === undefined) return { error: '"title" is required' };

    let world_id = existing ? existing.world_id : null;
    if (body.world_id !== undefined) {
      world_id = body.world_id === null || body.world_id === '' ? null : asString(body.world_id);
      if (world_id && !getWorld(world_id)) return { error: 'world_id does not reference an existing world' };
    }

    let tone = existing ? existing.tone : 'fade-to-black';
    if (body.tone !== undefined) {
      tone = asString(body.tone);
      if (!TONES.includes(tone)) return { error: `"tone" must be one of: ${TONES.join(', ')}` };
    }

    let cast = existing ? normalizeCast(JSON.parse(existing.characters || '[]')) : [];
    if (body.characters !== undefined) {
      const result = validateCastPayload(body.characters);
      if (result.error) return { error: result.error };
      cast = result.cast;
    }

    return { title, world_id, tone, cast };
  }

  app.post('/api/stories', (req, res) => {
    const payload = validateStoryPayload(req.body);
    if (payload.error) return badRequest(res, payload.error);
    const id = uuidv4();
    db.prepare('INSERT INTO stories (id, title, world_id, characters, tone) VALUES (?, ?, ?, ?, ?)').run(
      id, payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone
    );
    res.status(201).json({ story: storyWithMeta(getStory(id)) });
  });

  app.put('/api/stories/:id', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const payload = validateStoryPayload(req.body, { partial: true, existing: story });
    if (payload.error) return badRequest(res, payload.error);
    db.prepare(
      'UPDATE stories SET title = ?, world_id = ?, characters = ?, tone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(payload.title, payload.world_id, JSON.stringify(payload.cast), payload.tone, story.id);
    res.json({ story: storyWithMeta(getStory(story.id)) });
  });

  app.delete('/api/stories/:id', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    db.prepare('DELETE FROM story_pages WHERE story_id = ?').run(story.id);
    db.prepare('DELETE FROM stories WHERE id = ?').run(story.id);
    invalidatePreview(story.id);
    res.status(204).end();
  });

  // -- pages ---------------------------------------------------------------

  app.get('/api/stories/:id/pages', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    res.json({ pages: storyPages(story.id) });
  });

  app.post('/api/stories/:id/pages', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const content = optionalText(req.body.content, { max: 50000 });
    if (content === null || content === undefined) return badRequest(res, '"content" is required');
    const user_input = optionalText(req.body.user_input, { max: 10000 });

    const id = uuidv4();
    const page_number =
      db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM story_pages WHERE story_id = ?').get(story.id).n;
    db.prepare('INSERT INTO story_pages (id, story_id, page_number, content, user_input) VALUES (?, ?, ?, ?, ?)').run(
      id, story.id, page_number, content, user_input
    );
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(story.id);
    invalidatePreview(story.id);
    res.status(201).json({ page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(id) });
  });

  app.delete('/api/stories/:id/pages/:number', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const result = db
      .prepare('DELETE FROM story_pages WHERE story_id = ? AND page_number = ?')
      .run(story.id, parseInt(req.params.number, 10));
    if (result.changes === 0) return notFound(res, 'Page not found');
    invalidatePreview(story.id);
    res.status(204).end();
  });

  // -- models ---------------------------------------------------------------

  // Public OpenRouter catalog proxy for the settings page (no key needed).
  app.get('/api/models', async (req, res, next) => {
    try {
      res.json({ models: await listModels() });
    } catch (error) {
      error.statusCode = 502;
      next(error);
    }
  });

  // -- generation ----------------------------------------------------------

  // Approximate page length requested by the client (50-2000 words).
  function parseWordTarget(value) {
    if (value === undefined || value === null) return null;
    const words = parseInt(value, 10);
    if (!Number.isFinite(words)) return null;
    return Math.min(Math.max(words, 50), 2000);
  }

  // Rough token budget for a target length (words + instructions + headroom).
  function tokensForWords(words) {
    return words * 2 + 250;
  }

  function castCharacters(story) {
    const cast = normalizeCast(JSON.parse(story.characters || '[]'));
    return cast
      .map((entry) => {
        const character = getCharacter(entry.id);
        return character ? { ...character, role: entry.role, relation: entry.relation, state: entry.state } : null;
      })
      .filter(Boolean);
  }

  function loadContext(story, { excludeLast = false } = {}) {
    const world = story.world_id ? getWorld(story.world_id) : null;
    const characters = castCharacters(story);
    const allPages = storyPages(story.id);
    if (excludeLast) allPages.pop();
    const included = allPages.slice(-CONTEXT_WINDOW);
    return {
      world,
      characters,
      pages: {
        total: allPages.length,
        included,
        firstContent: allPages.length > 0 ? allPages[0].content.slice(0, 500) : null,
      },
    };
  }

  // -- per-story mutable character state -------------------------------------

  const STATE_MARKER = '<<<CHARACTER_STATE>>>';
  const STATE_FIELDS = ['personality', 'appearance', 'relationship_to_mc'];

  // The model appends a state block after the prose. Split it off so pages
  // never store the marker; a missing block simply means "nothing changed".
  function splitStateBlock(content) {
    const idx = content.indexOf(STATE_MARKER);
    if (idx === -1) return { prose: content.trim(), stateJson: null };
    return {
      prose: content.slice(0, idx).trim(),
      stateJson: content.slice(idx + STATE_MARKER.length).trim() || null,
    };
  }

  function applyStateUpdate(story, stateObj) {
    if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) return false;
    const cast = normalizeCast(JSON.parse(story.characters || '[]'));
    let changed = false;
    for (const entry of cast) {
      const upd = stateObj[entry.id];
      if (!upd || typeof upd !== 'object' || Array.isArray(upd)) continue;
      const state = entry.state && typeof entry.state === 'object' ? { ...entry.state } : {};
      for (const field of STATE_FIELDS) {
        const value = upd[field];
        if (typeof value === 'string' && value.trim()) {
          state[field] = value.trim().slice(0, 2000);
          changed = true;
        }
      }
      if (Object.keys(state).length > 0) entry.state = state;
    }
    if (changed) {
      db.prepare('UPDATE stories SET characters = ? WHERE id = ?').run(JSON.stringify(cast), story.id);
    }
    return changed;
  }

  function consumeStoryText(story, rawContent) {
    const { prose, stateJson } = splitStateBlock(rawContent);
    if (!prose) {
      const err = new Error('AI returned an empty response');
      err.statusCode = 502;
      throw err;
    }
    if (stateJson) {
      const stateObj = parseAiJson(stateJson);
      if (stateObj) applyStateUpdate(story, stateObj);
    }
    return prose;
  }

  app.post('/api/stories/:id/pages/generate', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const userInput = optionalText(req.body.user_input, { max: 10000 }) || 'Continue the story.';
      if (userInput === undefined) return badRequest(res, '"user_input" must be text');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      if (req.body.reasoning_effort !== undefined && req.body.reasoning_effort !== null && req.body.reasoning_effort !== '' && !reasoningEffort) {
        return badRequest(res, '"reasoning_effort" must be one of: low, medium, high');
      }

      const ctx = loadContext(story);
      const result = await chatCompletion(
        generationMessages(story, ctx, userInput, wordTarget),
        { model: modelOverride || undefined, reasoningEffort, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
      );
      const prose = consumeStoryText(story, result.content);

      const id = uuidv4();
      const page_number =
        db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM story_pages WHERE story_id = ?').get(story.id).n;
      db.prepare(
        'INSERT INTO story_pages (id, story_id, page_number, content, user_input, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, story.id, page_number, prose, userInput,
        result.model, result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null, result.cost_usd
      );
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(story.id);
      invalidatePreview(story.id);
      res.status(201).json({ page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  });

  // Regenerate the LAST page only, reusing its stored user_input
  app.post('/api/stories/:id/pages/regenerate', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const pages = storyPages(story.id);
      if (pages.length === 0) return badRequest(res, 'Story has no pages to regenerate');
      const last = pages[pages.length - 1];

      const ctx = loadContext(story, { excludeLast: true });
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      const result = await chatCompletion(
        generationMessages(story, ctx, last.user_input || 'Continue the story.', wordTarget),
        { model: modelOverrideOf(req.body.model) || undefined, reasoningEffort, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
      );
      const prose = consumeStoryText(story, result.content);

      db.prepare(
        'UPDATE story_pages SET content = ?, created_at = CURRENT_TIMESTAMP, model = ?, prompt_tokens = ?, completion_tokens = ?, cost_usd = ? WHERE id = ?'
      ).run(
        prose, result.model,
        result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null, result.cost_usd,
        last.id
      );
      invalidatePreview(story.id);
      res.json({ page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(last.id) });
    } catch (error) {
      next(error);
    }
  });

  // Condense the current page (plus its predecessors), the world and the
  // in-story cast state into a prompt an image-generation AI can consume.
  app.post('/api/stories/:id/pages/:number/image-prompt', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = db
        .prepare('SELECT * FROM story_pages WHERE story_id = ? AND page_number = ?')
        .get(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');

      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);

      const world = story.world_id ? getWorld(story.world_id) : null;
      const characters = castCharacters(story);
      const allPages = storyPages(story.id);
      const upto = allPages.slice(0, allPages.findIndex((p) => p.page_number === page.page_number) + 1);
      const pages = {
        total: upto.length,
        included: upto.slice(-CONTEXT_WINDOW),
        firstContent: upto.length > 0 ? upto[0].content.slice(0, 500) : null,
      };

      const result = await chatCompletion(
        [
          { role: 'system', content: 'You are a precise, disciplined art director.' },
          { role: 'user', content: buildImagePrompt({ story, world, characters, pages }) },
        ],
        { model: modelOverride || undefined, reasoningEffort, maxTokens: 800 }
      );
      res.json({ prompt: String(result.content || '').trim() });
    } catch (error) {
      next(error);
    }
  });

  // Render the scene as an actual image: the (user-editable, tone-honoring)
  // prompt from above drives generation, while the cast's reference portraits
  // ride along as identity references (the story's current cast, so refs track
  // whatever the story has done to them).
  app.post('/api/stories/:id/pages/:number/scene-image', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = db
        .prepare('SELECT * FROM story_pages WHERE story_id = ? AND page_number = ?')
        .get(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');
      const prompt = optionalText(req.body.prompt, { max: 4000 });
      if (!prompt) return badRequest(res, '"prompt" is required (use the condensed scene prompt)');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);
      const RENDER_VARIANTS = {
        low_1k: { quality: 'low', resolution: '1K' },
        medium_2k: { quality: 'medium', resolution: '2K' },
      };
      const variant = req.body.render === undefined ? 'low_1k' : asString(req.body.render);
      if (!RENDER_VARIANTS[variant]) {
        return badRequest(res, '"render" must be one of: low_1k, medium_2k');
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
      const dropReferences = req.body.drop_references === true;
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
        // The provider's moderation refused. Do NOT repaint silently: rewrite
        // the prompt to be aggressively safe, then announce it back - the
        // user reviews the textbox and presses Generate again themselves.
        if (error.statusCode !== 400) throw error;
        const reason = (error.message.match(/refused this request: (.*)$/) || [, '(no reason given)'])[1];
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
          { model: modelOverride || undefined, reasoningEffort, maxTokens: 800 }
        );
        return res.json({
          refused: true,
          reason,
          sanitized_prompt: rewrite.content.trim(),
          rewrite_cost_usd: rewrite.cost_usd || 0,
        });
      }
      res.json({
        image: result.buffer.toString('base64'),
        media_type: result.mediaType,
        cost_usd: result.cost,
        references: dropReferences ? [] : resolvedReferences,
        prompt,
      });
    } catch (error) {
      next(error);
    }
  });

  // -- export --------------------------------------------------------------

  app.get('/api/stories/:id/export', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const world = story.world_id ? getWorld(story.world_id) : null;
    const cast = normalizeCast(JSON.parse(story.characters || '[]'));
    const characters = cast
      .map(({ id, role }) => {
        const character = getCharacter(id);
        return character ? { ...character, role } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.role === 'mc' ? -1 : b.role === 'mc' ? 1 : 0));

    const epub = buildEpub({
      title: story.title,
      world,
      characters,
      pages: storyPages(story.id),
    });

    const filename = `${story.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'story'}.epub`;
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(epub);
  });

  // -- AI drafts (world / character fleshing-out) ---------------------------

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
    let cost = first.cost_usd || 0;
    if (!parsed) {
      const second = await attempt('Your previous answer was not a valid JSON object. This time return ONLY the JSON object.');
      cost += second.cost_usd || 0;
      parsed = parseAiJson(second.content);
      first = second;
    }
    if (!parsed) {
      const err = new Error('The scribe scribbled something illegible. Try again.');
      err.statusCode = 502;
      throw err;
    }
    return { parsed, result: first, cost_usd: cost || null };
  }

  app.post('/api/ai/world', async (req, res, next) => {
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
      const length = DRAFT_LENGTHS[req.body.length] ? req.body.length : 'medium';
      const variant = Math.min(Math.max(parseInt(req.body.variant, 10) || 1, 1), 50);

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

      res.json({
        world: {
          name: asString(parsed.name) || seeds.name || 'An Unnamed Realm',
          description: asString(parsed.description) || '',
          genre: asString(parsed.genre) || seeds.genre || '',
          setting: asString(parsed.setting) || seeds.setting || '',
        },
        model: result.model,
        cost_usd,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/character', async (req, res, next) => {
    try {
      const seeds = {
        name: optionalText(req.body.name, { max: 200 }),
        description: optionalText(req.body.description, { max: 2000 }),
        personality: optionalText(req.body.personality, { max: 2000 }),
        appearance: optionalText(req.body.appearance, { max: 2000 }),
        background: optionalText(req.body.background, { max: 2000 }),
      };
      if (Object.values(seeds).includes(undefined)) return badRequest(res, 'Character seed fields must be text');
      const world = req.body.world_id ? getWorld(req.body.world_id) : null;
      if (req.body.world_id && !world) return badRequest(res, 'world_id does not reference an existing world');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const length = DRAFT_LENGTHS[req.body.length] ? req.body.length : 'medium';
      const variant = Math.min(Math.max(parseInt(req.body.variant, 10) || 1, 1), 50);

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

      const pick = (key) => asString(parsed[key]) || seeds[key] || '';
      res.json({
        character: {
          name: pick('name') || 'A Nameless Stranger',
          description: pick('description'),
          personality: pick('personality'),
          appearance: pick('appearance'),
          background: pick('background'),
        },
        model: result.model,
        cost_usd,
      });
    } catch (error) {
      next(error);
    }
  });

  // -- speculative next-page preview ----------------------------------------

  // Holds one prepared-but-unsaved next page per story - in the DATABASE,
  // not memory: the browser keeps its green "Next Page" across server
  // restarts, so the prepared page must survive them too. A later commit is
  // stale-checked against the page count and the preview is single-use.
  const upsertPreview = db.prepare(
    'INSERT OR REPLACE INTO story_previews (story_id, expected_page, raw_content, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const getPreview = db.prepare('SELECT * FROM story_previews WHERE story_id = ?');
  const deletePreview = db.prepare('DELETE FROM story_previews WHERE story_id = ?');

  function invalidatePreview(storyId) {
    deletePreview.run(storyId);
  }

  function generationMessages(story, ctx, userInput, wordTarget) {
    return [
      { role: 'system', content: 'You are a talented, disciplined fiction writer.' },
      { role: 'user', content: buildPrompt({ story, world: ctx.world, characters: ctx.characters, pages: ctx.pages, userInput, wordTarget }) },
    ];
  }

  app.post('/api/stories/:id/pages/preview', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const modelOverride = modelOverrideOf(req.body.model);
      if (req.body.model !== undefined && !modelOverride) return badRequest(res, '"model" must be a non-empty string');
      const wordTarget = parseWordTarget(req.body.words);
      const reasoningEffort = parseReasoningEffort(req.body.reasoning_effort);

      // Snapshot the page count BEFORE the (slow) generation: a preview that
      // raced with a live write must never commit wrong-context prose as a
      // later page - the commit staleness check catches it instead.
      const expectedPage = storyPages(story.id).length + 1;
      const ctx = loadContext(story);
      const result = await chatCompletion(
        generationMessages(story, ctx, 'Continue the story.', wordTarget),
        { model: modelOverride || undefined, reasoningEffort, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
      );
      upsertPreview.run(
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

  app.post('/api/stories/:id/pages/commit-preview', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const preview = getPreview.get(story.id);
      if (!preview) return notFound(res, 'No prepared page for this story. Generate normally.');
      if (storyPages(story.id).length + 1 !== preview.expected_page) {
        invalidatePreview(story.id);
        return res.status(409).json({ error: 'The prepared page has gone stale - the story moved on without it.' });
      }

      const prose = consumeStoryText(story, preview.raw_content); // applies character-state updates
      const id = uuidv4();
      db.prepare(
        'INSERT INTO story_pages (id, story_id, page_number, content, user_input, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, story.id, preview.expected_page, prose, null,
        preview.model, preview.prompt_tokens, preview.completion_tokens, preview.cost_usd
      );
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(story.id);
      invalidatePreview(story.id);
      res.status(201).json({ page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(id) });
    } catch (error) {
      next(error);
    }
  });

  // -- narration (streaming page read-aloud) ---------------------------------

  const NARRATION_MAX_CHARS = 16000;
  const NARRATION_SEGMENT_CHARS = 1800; // many narrators reject longer input outright
  const NARRATION_MIN_SEGMENT_CHARS = 300; // below this, halving cannot help
  const NARRATION_CACHE_MAX_BYTES = 32 * 1024 * 1024;
  const NARRATION_ENTRY_MAX_BYTES = 8 * 1024 * 1024; // single-page cap
  const NARRATION_PCM_MAX_BYTES = 24 * 1024 * 1024; // raw pcm buffering guard
  // Keyed by sha256(text)+model+voice; value is the completed audio (mp3 or a
  // WAV-wrapped pcm) so an in-session replay never triggers (or bills) a
  // second upstream generation.
  const narrationCache = new Map();
  const crypto = require('crypto');

  function narrationCacheKey(text, model, voice) {
    return crypto.createHash('sha256').update(text).digest('hex') + '|' + model + '|' + voice;
  }

  function rememberNarration(key, buffer, contentType, generationId) {
    if (buffer.length === 0 || buffer.length > NARRATION_ENTRY_MAX_BYTES) return;
    narrationCache.set(key, { buffer, contentType, generationId, bytes: buffer.length });
    let total = 0;
    for (const entry of narrationCache.values()) total += entry.bytes;
    while (total > NARRATION_CACHE_MAX_BYTES && narrationCache.size > 1) {
      const oldest = narrationCache.keys().next().value; // insertion order ~ LRU
      total -= narrationCache.get(oldest).bytes;
      narrationCache.delete(oldest);
    }
  }

  // Split narratable text into segments at sentence boundaries. Providers cap
  // input length (Deepgram ~2000 chars, others less), so a full page is fed to
  // them piece by piece.
  function splitNarrationSegments(text, limit = NARRATION_SEGMENT_CHARS) {
    const segments = [];
    let current = '';
    const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (current.trim()) segments.push(current.trim());
        current = '';
        for (let i = 0; i < sentence.length; i += limit) segments.push(sentence.slice(i, i + limit).trim());
        continue;
      }
      if (current && current.length + sentence.length > limit) {
        segments.push(current.trim());
        current = '';
      }
      current += sentence;
    }
    if (current.trim()) segments.push(current.trim());
    return segments.filter(Boolean);
  }

  // Split text into exactly two halves at a sentence boundary near the middle
  // (hard-splitting an overlong sentence when there is no boundary).
  function bisectNarration(text) {
    const half = Math.floor(text.length / 2);
    const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    let first = '';
    let i = 0;
    for (; i < sentences.length; i++) {
      if (first.length && first.length + sentences[i].length > half) break;
      first += sentences[i];
    }
    if (i === 0) {
      // The very first sentence crosses the middle: hard-split it.
      first = sentences[0].slice(0, half);
      const rest = sentences[0].slice(half) + sentences.slice(1).join('');
      return [first.trim(), rest.trim()].filter(Boolean);
    }
    return [first.trim(), sentences.slice(i).join('').trim()].filter(Boolean);
  }

  // Synthesize one segment, pushing each upstream result into `results`.
  // When a provider refuses even a within-limit segment (400/413 — limits
  // vary and are undocumented), bisect at sentence boundaries and recurse.
  async function synthesizeNarration(model, voice, text, results) {
    try {
      results.push(await createSpeech({ model, voice, input: text }));
    } catch (error) {
      const status = error.statusCode || 0;
      if ((status === 400 || status === 413) && text.length > NARRATION_MIN_SEGMENT_CHARS) {
        for (const piece of bisectNarration(text)) {
          await synthesizeNarration(model, voice, piece, results);
        }
        return;
      }
      throw error;
    }
  }

  // 44-byte WAV header for OpenAI-style pcm: 24kHz 16-bit signed LE mono.
  function wavHeader(dataBytes) {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + dataBytes, 4);
    b.write('WAVE', 8);
    b.write('fmt ', 12);
    b.writeUInt32LE(16, 16); // fmt chunk size
    b.writeUInt16LE(1, 20); // PCM
    b.writeUInt16LE(1, 22); // mono
    b.writeUInt32LE(24000, 24); // sample rate
    b.writeUInt32LE(48000, 28); // byte rate
    b.writeUInt16LE(2, 32); // block align
    b.writeUInt16LE(16, 34); // bits per sample
    b.write('data', 36);
    b.writeUInt32LE(dataBytes, 40);
    return b;
  }

  // pcm narrators cannot stream through (the WAV header needs the total size),
  // so their segments are collected and delivered as one complete WAV.
  async function collectNarrationPcm(results) {
    const parts = [];
    let total = 0;
    for (const result of results) {
      await new Promise((resolve, reject) => {
        result.stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > NARRATION_PCM_MAX_BYTES) {
            const err = new Error('This page is too long for this narrator in one breath. Try an mp3 narrator or a shorter page.');
            err.statusCode = 413;
            reject(err);
            result.stream.destroy();
            return;
          }
          parts.push(chunk);
        });
        result.stream.on('end', resolve);
        result.stream.on('error', reject);
      });
    }
    return Buffer.concat(parts);
  }

  function normalizeNarrationText(content) {
    return String(content || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  app.get('/api/speech-models', async (req, res, next) => {
    try {
      res.json({ models: await listSpeechModels() });
    } catch (error) {
      error.statusCode = 502;
      next(error);
    }
  });

  app.post('/api/stories/:id/pages/:number/narrate', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const page = db
        .prepare('SELECT * FROM story_pages WHERE story_id = ? AND page_number = ?')
        .get(story.id, parseInt(req.params.number, 10));
      if (!page) return notFound(res, 'Page not found');

      // Model and voice are validated against the live catalogue, never trusted.
      const model = asString(req.body.model);
      const voice = asString(req.body.voice);
      const catalogue = await listSpeechModels();
      const entry = catalogue.find((m) => m.id === model);
      if (!model || !voice || !entry || !entry.voices.some((v) => v.id === voice)) {
        return res.status(400).json({
          error: 'Narration is not configured with a valid model and voice. Choose both in Settings.',
        });
      }

      const text = normalizeNarrationText(page.content);
      if (!text) return badRequest(res, 'This page has no narratable text.');
      if (text.length > NARRATION_MAX_CHARS) {
        return res.status(413).json({ error: 'This page is too long to narrate in one breath. Shorten or split it first.' });
      }

      // In-session replay: serve the remembered audio without a new generation.
      const key = narrationCacheKey(text, model, voice);
      const cached = narrationCache.get(key);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('X-Narration-Cache', 'hit');
        if (cached.generationId) res.setHeader('X-Generation-Id', cached.generationId);
        return res.send(cached.buffer);
      }

      // Segment the page and synthesize each piece (halving retries on
      // provider limits). All headers must arrive before the body starts so
      // every generation id is known up front for honest cost accounting.
      const segments = splitNarrationSegments(text);
      const results = [];
      for (const segment of segments) {
        await synthesizeNarration(model, voice, segment, results);
      }
      const generationIds = results.map((r) => r.generationId).filter(Boolean);
      const joinedGenerationId = generationIds.join(',') || null;

      // pcm narrators: one complete WAV (the header needs the total size).
      if (results[0].format === 'pcm') {
        const pcm = await collectNarrationPcm(results);
        const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
        res.setHeader('Content-Type', 'audio/wav');
        if (joinedGenerationId) res.setHeader('X-Generation-Id', joinedGenerationId);
        rememberNarration(key, wav, 'audio/wav', joinedGenerationId);
        return res.send(wav);
      }

      // mp3 narrators: stream segments back-to-back with backpressure.
      const contentType = results[0].contentType || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      if (joinedGenerationId) res.setHeader('X-Generation-Id', joinedGenerationId);

      const chunks = [];
      let remembered = 0;
      let aborted = false;
      res.on('close', () => {
        // A real client disconnect mid-stream: abort upstream work.
        if (!res.writableEnded) {
          aborted = true;
          results.forEach((r) => r.stream.destroy());
        }
      });
      let index = 0;
      const pipeNext = () => {
        if (aborted) return;
        if (index >= results.length) {
          if (!aborted) rememberNarration(key, Buffer.concat(chunks), contentType, joinedGenerationId);
          return res.end();
        }
        const stream = results[index++].stream;
        stream.on('data', (chunk) => {
          if (remembered + chunk.length <= NARRATION_ENTRY_MAX_BYTES) {
            chunks.push(chunk);
            remembered += chunk.length;
          }
          if (!res.write(chunk)) stream.pause();
        });
        res.on('drain', () => stream.resume());
        stream.on('end', pipeNext);
        stream.on('error', (error) => {
          if (aborted) return res.end();
          results.forEach((r) => r.stream.destroy());
          res.end();
          console.error('Narration upstream error:', error.message);
        });
      };
      pipeNext();
    } catch (error) {
      next(error);
    }
  });

  // Authoritative TTS cost for a generation (or a comma-joined set of
  // segment generations), idempotent and server-cached per id.
  app.get('/api/ai/generation-cost', async (req, res, next) => {
    try {
      const id = asString(req.query.id);
      const ids = id ? id.split(',') : [];
      if (!ids.length || ids.some((single) => !/^[a-zA-Z0-9-]{8,64}$/.test(single))) {
        return badRequest(res, '"id" must be a generation id');
      }
      try {
        const costs = [];
        for (const single of ids) costs.push(await fetchGenerationCost(single));
        const total = costs.reduce((sum, cost) => sum + (typeof cost.cost_usd === 'number' ? cost.cost_usd : 0), 0);
        res.json({
          generation_id: id,
          cost_usd: total,
          model: costs[0]?.model || null,
          provider: costs[0]?.provider || null,
          latency_ms: costs[0]?.latency_ms || null,
        });
      } catch (error) {
        // Metadata not ready yet: tell the client to retry shortly.
        if (error.response?.status === 404 || error.response?.status === 429) {
          return res.status(202).json({ error: 'Cost metadata is not ready yet. Retry shortly.' });
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  // -- truncation ----------------------------------------------------------

  // Delete every page AFTER the given page number, making it the last page.
  app.delete('/api/stories/:id/pages', (req, res) => {
    const story = getStory(req.params.id);
    if (!story) return notFound(res, 'Story not found');
    const after = parseInt(req.query.after, 10);
    if (!Number.isFinite(after) || after < 1) return badRequest(res, '"after" must be a positive page number');
    const result = db
      .prepare('DELETE FROM story_pages WHERE story_id = ? AND page_number > ?')
      .run(story.id, after);
    invalidatePreview(story.id);
    res.json({ deleted: result.changes, remaining: storyPages(story.id).length });
  });

  // -- static frontend + error handling -------------------------------------

  if (staticDir) {
    app.use(express.static(staticDir));
    // SPA-ish fallback for non-API GET routes
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((req, res) => notFound(res, 'Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('Unhandled error:', error.message);
    res.status(status).json({ error: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };