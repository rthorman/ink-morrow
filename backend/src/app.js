'use strict';

const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { chatCompletion, listModels } = require('./ai');
const { buildEpub } = require('./epub');
const { buildPrompt, CONTEXT_WINDOW } = require('./prompt');

const TONES = ['fade-to-black', 'romantic', 'explicit'];

// Model ids from clients are bounded and forwarded verbatim to OpenRouter.
function modelOverrideOf(value) {
  const model = asString(value);
  return model && model.length <= 200 ? model : null;
}
const CAST_ROLES = ['mc', 'supporting', 'background'];

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

function createApp(db, { staticDir = path.join(__dirname, '../../frontend') } = {}) {
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
    if ([description, genre, setting].includes(undefined)) return badRequest(res, 'World fields must be text');

    db.prepare(
      'UPDATE worlds SET name = ?, description = ?, genre = ?, setting = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(name, description, genre, setting, world.id);
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
    res.status(201).json({ character: getCharacter(id) });
  });

  app.put('/api/characters/:id', (req, res) => {
    const character = getCharacter(req.params.id);
    if (!character) return notFound(res, 'Character not found');
    const payload = validateCharacterPayload(req.body, { partial: true, existing: character });
    if (payload.error) return badRequest(res, payload.error);
    db.prepare(
      'UPDATE characters SET name = ?, description = ?, personality = ?, appearance = ?, background = ?, world_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(payload.name, payload.description, payload.personality, payload.appearance, payload.background, payload.world_id, character.id);
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

  function loadContext(story, { excludeLast = false } = {}) {
    const world = story.world_id ? getWorld(story.world_id) : null;
    const cast = normalizeCast(JSON.parse(story.characters || '[]'));
    const characters = cast
      .map((entry) => {
        const character = getCharacter(entry.id);
        return character ? { ...character, role: entry.role, relation: entry.relation, state: entry.state } : null;
      })
      .filter(Boolean);
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

      const ctx = loadContext(story);
      const result = await chatCompletion(
        generationMessages(story, ctx, userInput, wordTarget),
        { model: modelOverride || undefined, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
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
      const result = await chatCompletion(
        generationMessages(story, ctx, last.user_input || 'Continue the story.', wordTarget),
        { model: modelOverrideOf(req.body.model) || undefined, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
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

  // Holds one prepared-but-unsaved next page per story. The client asks for a
  // preview whenever the writer sits on the last page with no direction; a
  // later commit must be stale-checked against the page count.
  const previews = new Map(); // storyId -> { expectedPage, rawContent, model, promptTokens, completionTokens, costUsd }

  function invalidatePreview(storyId) {
    previews.delete(storyId);
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

      const ctx = loadContext(story);
      const result = await chatCompletion(
        generationMessages(story, ctx, 'Continue the story.', wordTarget),
        { model: modelOverride || undefined, ...(wordTarget ? { maxTokens: tokensForWords(wordTarget) } : {}) }
      );

      const expectedPage = storyPages(story.id).length + 1;
      previews.set(story.id, {
        expectedPage,
        rawContent: result.content,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        costUsd: result.cost_usd,
      });
      res.json({ preview: { expected_page: expectedPage, model: result.model, cost_usd: result.cost_usd } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/stories/:id/pages/commit-preview', async (req, res, next) => {
    try {
      const story = getStory(req.params.id);
      if (!story) return notFound(res, 'Story not found');
      const preview = previews.get(story.id);
      if (!preview) return notFound(res, 'No prepared page for this story. Generate normally.');
      if (storyPages(story.id).length + 1 !== preview.expectedPage) {
        invalidatePreview(story.id);
        return res.status(409).json({ error: 'The prepared page has gone stale - the story moved on without it.' });
      }

      const prose = consumeStoryText(story, preview.rawContent); // applies character-state updates
      const id = uuidv4();
      db.prepare(
        'INSERT INTO story_pages (id, story_id, page_number, content, user_input, model, prompt_tokens, completion_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, story.id, preview.expectedPage, prose, null,
        preview.model, preview.promptTokens, preview.completionTokens, preview.costUsd
      );
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(story.id);
      invalidatePreview(story.id);
      res.status(201).json({ page: db.prepare('SELECT * FROM story_pages WHERE id = ?').get(id) });
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