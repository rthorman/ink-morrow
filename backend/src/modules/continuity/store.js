'use strict';

// Local, deterministic narrative memory. Every derived fact is carried by a
// committed page id; folding the remaining ready rows recreates the state
// after deletion or regeneration without a second AI call.

const crypto = require('crypto');
const { parseCastJson } = require('../stories/cast');

const CHARACTER_FIELDS = ['location', 'condition', 'personality', 'appearance', 'relationship_to_mc'];
const GOAL_STATUSES = new Set(['pending', 'active', 'fulfilled', 'abandoned']);
const THREAD_STATUSES = new Set(['open', 'resolved']);
const FACT_STATUSES = new Set(['established', 'superseded']);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function text(value, max = 2000) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function textList(value, { maxItems = 30, max = 500 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const clean = text(item, max);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
}

function stableId(prefix, ...parts) {
  const key = parts.map((part) => String(part || '').trim().toLowerCase()).join('|');
  return `${prefix}_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function contentHash(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

function sanitizeDelta(input, castIds) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowedCharacters = new Set(castIds || []);
  const summary = text(value.summary, 1600) || 'No durable change was recorded for this page.';

  const events = [];
  for (const raw of Array.isArray(value.events) ? value.events.slice(0, 20) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const eventText = text(raw.text, 1200);
    if (!eventText) continue;
    const character_ids = textList(raw.character_ids, { maxItems: 12, max: 100 })
      .filter((id) => allowedCharacters.has(id));
    const importance = raw.importance === 'major' ? 'major' : 'minor';
    const type = ['action', 'revelation', 'transition', 'relationship', 'world'].includes(raw.type)
      ? raw.type
      : 'action';
    events.push({ text: eventText, character_ids, importance, type });
  }

  const character_updates = [];
  for (const raw of Array.isArray(value.character_updates) ? value.character_updates.slice(0, 30) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !allowedCharacters.has(raw.character_id)) continue;
    const update = { character_id: raw.character_id };
    for (const field of CHARACTER_FIELDS) {
      const clean = text(raw[field], 2000);
      if (clean) update[field] = clean;
    }
    for (const field of ['knowledge_gained', 'knowledge_lost', 'possessions_gained', 'possessions_lost']) {
      const list = textList(raw[field]);
      if (list.length) update[field] = list;
    }
    if (Object.keys(update).length > 1) character_updates.push(update);
  }

  const goal_updates = [];
  for (const raw of Array.isArray(value.goal_updates) ? value.goal_updates.slice(0, 30) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const goalText = text(raw.text, 1000);
    const characterId = allowedCharacters.has(raw.character_id) ? raw.character_id : null;
    const id = text(raw.id, 100) || (goalText ? stableId('goal', characterId, goalText) : null);
    const status = GOAL_STATUSES.has(raw.status) ? raw.status : null;
    if (!id || (!goalText && !status)) continue;
    goal_updates.push({ id, character_id: characterId, ...(goalText ? { text: goalText } : {}), status: status || 'pending' });
  }

  const thread_updates = [];
  for (const raw of Array.isArray(value.thread_updates) ? value.thread_updates.slice(0, 30) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const threadText = text(raw.text, 1000);
    const id = text(raw.id, 100) || (threadText ? stableId('thread', threadText) : null);
    const status = THREAD_STATUSES.has(raw.status) ? raw.status : null;
    if (!id || (!threadText && !status)) continue;
    thread_updates.push({ id, ...(threadText ? { text: threadText } : {}), status: status || 'open' });
  }

  const world_fact_updates = [];
  for (const raw of Array.isArray(value.world_fact_updates) ? value.world_fact_updates.slice(0, 30) : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const factText = text(raw.text, 1000);
    const id = text(raw.id, 100) || (factText ? stableId('fact', factText) : null);
    const status = FACT_STATUSES.has(raw.status) ? raw.status : null;
    if (!id || (!factText && !status)) continue;
    world_fact_updates.push({ id, ...(factText ? { text: factText } : {}), status: status || 'established' });
  }

  return { summary, events, character_updates, goal_updates, thread_updates, world_fact_updates };
}

function addUnique(list, values) {
  const byLower = new Map(list.map((item) => [item.toLowerCase(), item]));
  for (const value of values || []) if (!byLower.has(value.toLowerCase())) byLower.set(value.toLowerCase(), value);
  return [...byLower.values()];
}

function removeValues(list, values) {
  const removed = new Set((values || []).map((item) => item.toLowerCase()));
  return list.filter((item) => !removed.has(item.toLowerCase()));
}

function sanitizeOverrides(input, castIds, knownGoalIds = [], knownThreadIds = []) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowedCharacters = new Set(castIds || []);
  const allowedGoals = new Set(knownGoalIds);
  const allowedThreads = new Set(knownThreadIds);
  const characters = {};
  for (const [id, raw] of Object.entries(value.characters || {})) {
    if (!allowedCharacters.has(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const clean = {};
    for (const field of CHARACTER_FIELDS) {
      const v = text(raw[field], 2000);
      if (v) clean[field] = v;
    }
    const knowledge = textList(raw.knowledge);
    const possessions = textList(raw.possessions);
    if (knowledge.length) clean.knowledge = knowledge;
    if (possessions.length) clean.possessions = possessions;
    if (Object.keys(clean).length) characters[id] = clean;
  }
  const goals = {};
  for (const [id, raw] of Object.entries(value.goals || {})) {
    const status = raw && GOAL_STATUSES.has(raw.status) ? raw.status : null;
    if (allowedGoals.has(id) && status) goals[id] = { status };
  }
  const threads = {};
  for (const [id, raw] of Object.entries(value.threads || {})) {
    const status = raw && THREAD_STATUSES.has(raw.status) ? raw.status : null;
    if (allowedThreads.has(id) && status) threads[id] = { status };
  }
  return { characters, goals, threads };
}

function createContinuityStore(db) {
  const insertSnapshot = db.prepare(`
    INSERT OR IGNORE INTO story_character_snapshots
      (story_id, character_id, name, description, personality, appearance, background, source_updated_at)
    SELECT ?, id, name, description, personality, appearance, background, updated_at
      FROM characters WHERE id = ?
  `);

  function ensureSnapshots(story) {
    const cast = parseCastJson(story.characters);
    for (const entry of cast) insertSnapshot.run(story.id, entry.id);
    return cast;
  }

  function snapshots(story) {
    const cast = ensureSnapshots(story);
    const rows = db.prepare('SELECT * FROM story_character_snapshots WHERE story_id = ?').all(story.id);
    const byId = new Map(rows.map((row) => [row.character_id, row]));
    return cast.map((entry) => {
      const row = byId.get(entry.id);
      return row ? { ...row, role: entry.role, relation: entry.relation, manual_state: entry.state || null } : null;
    }).filter(Boolean);
  }

  function memoryRows(storyId, { throughPageNumber = null, excludePageIds = [] } = {}) {
    const excludes = new Set(excludePageIds);
    return db.prepare(`
      SELECT m.*, p.page_number
        FROM story_memory_pages m
        JOIN story_pages p ON p.id = m.page_id
       WHERE m.story_id = ? AND m.status = 'ready'
       ORDER BY p.page_number, p.id
    `).all(storyId).filter((row) =>
      (throughPageNumber === null || row.page_number <= throughPageNumber) && !excludes.has(row.page_id)
    );
  }

  function project(story, options = {}) {
    const snapshotRows = snapshots(story);
    const characters = snapshotRows.map((snapshot) => ({
      id: snapshot.character_id,
      name: snapshot.name,
      role: snapshot.role,
      relation: snapshot.relation,
      description: snapshot.description || '',
      personality: snapshot.personality || '',
      appearance: snapshot.appearance || '',
      background: snapshot.background || '',
      state: {},
      current: {
        location: null,
        condition: null,
        knowledge: [],
        possessions: [],
        personality: snapshot.personality || '',
        appearance: snapshot.appearance || '',
        relationship_to_mc: snapshot.relation || null,
      },
      manual_state: snapshot.manual_state,
    }));
    const characterById = new Map(characters.map((character) => [character.id, character]));
    const goals = new Map();
    const threads = new Map();
    const worldFacts = new Map();
    const events = [];
    const summaries = [];

    for (const row of memoryRows(story.id, options)) {
      const delta = parseJson(row.delta_json, {});
      if (row.summary) summaries.push({ page_id: row.page_id, page_number: row.page_number, text: row.summary });
      for (const event of delta.events || []) events.push({ ...event, page_id: row.page_id, page_number: row.page_number });
      for (const update of delta.character_updates || []) {
        const character = characterById.get(update.character_id);
        if (!character) continue;
        for (const field of CHARACTER_FIELDS) {
          if (update[field]) {
            character.current[field] = update[field];
            character.state[field] = update[field];
          }
        }
        character.current.knowledge = addUnique(character.current.knowledge, update.knowledge_gained);
        character.current.knowledge = removeValues(character.current.knowledge, update.knowledge_lost);
        character.current.possessions = addUnique(character.current.possessions, update.possessions_gained);
        character.current.possessions = removeValues(character.current.possessions, update.possessions_lost);
      }
      for (const update of delta.goal_updates || []) {
        const previous = goals.get(update.id) || { id: update.id, character_id: update.character_id || null };
        goals.set(update.id, { ...previous, ...update, page_id: row.page_id, page_number: row.page_number });
      }
      for (const update of delta.thread_updates || []) {
        const previous = threads.get(update.id) || { id: update.id };
        threads.set(update.id, { ...previous, ...update, page_id: row.page_id, page_number: row.page_number });
      }
      for (const update of delta.world_fact_updates || []) {
        const previous = worldFacts.get(update.id) || { id: update.id };
        worldFacts.set(update.id, { ...previous, ...update, page_id: row.page_id, page_number: row.page_number });
      }
    }

    // The pre-3.1 in-story sheet becomes an explicit user override rather
    // than mutable AI state. It remains useful and always wins over extraction.
    for (const character of characters) {
      for (const field of ['personality', 'appearance', 'relationship_to_mc']) {
        const value = text(character.manual_state?.[field]);
        if (value) {
          character.current[field] = value;
          character.state[field] = value;
        }
      }
    }

    const rawOverrides = parseJson(story.continuity_overrides || '{}', {});
    const overrides = sanitizeOverrides(rawOverrides, characters.map((c) => c.id), [...goals.keys()], [...threads.keys()]);
    for (const [id, update] of Object.entries(overrides.characters)) {
      const character = characterById.get(id);
      if (!character) continue;
      Object.assign(character.current, update);
      Object.assign(character.state, update);
    }
    for (const [id, update] of Object.entries(overrides.goals)) Object.assign(goals.get(id), update);
    for (const [id, update] of Object.entries(overrides.threads)) Object.assign(threads.get(id), update);

    return {
      characters,
      goals: [...goals.values()],
      threads: [...threads.values()],
      world_facts: [...worldFacts.values()],
      events,
      summaries,
      overrides,
    };
  }

  function coverage(story) {
    const pages = db.prepare(`
      SELECT p.id, p.page_number, p.continuity_cost_usd, m.status, m.error
        FROM story_pages p
        LEFT JOIN story_memory_pages m ON m.page_id = p.id
       WHERE p.story_id = ? AND p.image_media_type IS NULL AND TRIM(p.content) <> ''
       ORDER BY p.page_number
    `).all(story.id);
    const pending = pages.filter((page) => !page.status).map((page) => page.id);
    const failed = pages.filter((page) => page.status === 'failed').map((page) => ({ page_id: page.id, page_number: page.page_number, error: page.error }));
    const ready = pages.filter((page) => page.status === 'ready').length;
    const memoryCost = pages.reduce((sum, page) => sum + (Number(page.continuity_cost_usd) || 0), 0);
    return {
      total: pages.length,
      ready,
      pages: pages.map((page) => ({
        page_id: page.id,
        page_number: page.page_number,
        status: page.status || 'pending',
        error: page.error || null,
      })),
      pending_page_ids: pending,
      failed,
      memory_cost_usd: memoryCost,
    };
  }

  // Generation needs only two counts. Avoid constructing a page-by-page
  // coverage transcript on every write; the full form is reserved for the
  // Library inspector.
  function coverageSummary(story) {
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN m.status = 'ready' THEN 1 ELSE 0 END), 0) AS ready
        FROM story_pages p
        LEFT JOIN story_memory_pages m ON m.page_id = p.id
       WHERE p.story_id = ? AND p.image_media_type IS NULL AND TRIM(p.content) <> ''
    `).get(story.id);
    return { total: Number(row.total) || 0, ready: Number(row.ready) || 0 };
  }

  function continuityView(story, options = {}) {
    const folded = project(story, options);
    const eventCount = folded.events.length;
    const summaryCount = folded.summaries.length;
    return {
      ...folded,
      // Bound UI/API history on low-powered hosts. Current state still folds
      // every delta; only the inspection transcript is clipped.
      events: folded.events.slice(-200),
      summaries: folded.summaries.slice(-200),
      history_counts: { events: eventCount, summaries: summaryCount },
      coverage: coverage(story),
    };
  }

  function beginPage(page) {
    const hash = contentHash(page.content);
    db.prepare(`
      INSERT INTO story_memory_pages (page_id, story_id, content_hash, status, updated_at)
      VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
      ON CONFLICT(page_id) DO UPDATE SET
        content_hash = excluded.content_hash, status = 'pending', summary = NULL,
        delta_json = NULL, error = NULL, updated_at = CURRENT_TIMESTAMP
    `).run(page.id, page.story_id, hash);
    db.prepare('DELETE FROM story_memory_search WHERE page_id = ?').run(page.id);
    try { db.prepare('DELETE FROM story_memory_fts WHERE page_id = ?').run(page.id); } catch { /* LIKE fallback */ }
    return hash;
  }

  function addPageSpend(pageId, result) {
    const prompt = Number(result?.usage?.prompt_tokens) || 0;
    const completion = Number(result?.usage?.completion_tokens) || 0;
    const cost = typeof result?.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? result.cost_usd : 0;
    db.prepare(`
      UPDATE story_pages SET
        continuity_model = COALESCE(?, continuity_model),
        continuity_prompt_tokens = COALESCE(continuity_prompt_tokens, 0) + ?,
        continuity_completion_tokens = COALESCE(continuity_completion_tokens, 0) + ?,
        continuity_cost_usd = COALESCE(continuity_cost_usd, 0) + ?
      WHERE id = ?
    `).run(result?.model || null, prompt, completion, cost, pageId);
  }

  function finishPage(page, hash, delta, result) {
    const searchText = [delta.summary, ...delta.events.map((event) => event.text),
      ...delta.goal_updates.map((goal) => goal.text || ''), ...delta.thread_updates.map((thread) => thread.text || '')]
      .filter(Boolean).join('\n');
    db.exec('BEGIN');
    try {
      addPageSpend(page.id, result);
      db.prepare(`
        UPDATE story_memory_pages SET status = 'ready', content_hash = ?, summary = ?, delta_json = ?,
          model = ?, prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, error = NULL,
          updated_at = CURRENT_TIMESTAMP WHERE page_id = ?
      `).run(hash, delta.summary, JSON.stringify(delta), result.model || null,
        result.usage?.prompt_tokens ?? null, result.usage?.completion_tokens ?? null,
        typeof result.cost_usd === 'number' ? result.cost_usd : 0, page.id);
      db.prepare('INSERT OR REPLACE INTO story_memory_search (page_id, story_id, content) VALUES (?, ?, ?)')
        .run(page.id, page.story_id, searchText);
      try {
        db.prepare('DELETE FROM story_memory_fts WHERE page_id = ?').run(page.id);
        db.prepare('INSERT INTO story_memory_fts (page_id, story_id, content) VALUES (?, ?, ?)').run(page.id, page.story_id, searchText);
      } catch { /* LIKE fallback */ }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return db.prepare('SELECT * FROM story_memory_pages WHERE page_id = ?').get(page.id);
  }

  function failPage(page, hash, error, result = {}) {
    db.exec('BEGIN');
    try {
      addPageSpend(page.id, result);
      db.prepare(`
        UPDATE story_memory_pages SET status = 'failed', content_hash = ?, model = ?,
          prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE page_id = ?
      `).run(hash, result.model || null, result.usage?.prompt_tokens ?? null,
        result.usage?.completion_tokens ?? null,
        typeof result.cost_usd === 'number' ? result.cost_usd : 0,
        text(error?.message || error, 1000) || 'Continuity extraction failed', page.id);
      db.exec('COMMIT');
    } catch (writeError) {
      db.exec('ROLLBACK');
      throw writeError;
    }
    return db.prepare('SELECT * FROM story_memory_pages WHERE page_id = ?').get(page.id);
  }

  function getPageMemory(pageId) {
    return db.prepare('SELECT * FROM story_memory_pages WHERE page_id = ?').get(pageId);
  }

  function clear(storyId) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM story_memory_search WHERE story_id = ?').run(storyId);
      try { db.prepare('DELETE FROM story_memory_fts WHERE story_id = ?').run(storyId); } catch { /* fallback */ }
      db.prepare('DELETE FROM story_memory_pages WHERE story_id = ?').run(storyId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveOverrides(story, input) {
    const folded = project(story);
    const clean = sanitizeOverrides(input, folded.characters.map((c) => c.id),
      folded.goals.map((g) => g.id), folded.threads.map((t) => t.id));
    db.prepare('UPDATE stories SET continuity_overrides = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(clean), story.id);
    return clean;
  }

  function searchRelevant(storyId, query, { excludePageIds = [], limit = 6 } = {}) {
    const tokens = [...new Set(String(query || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])].slice(0, 12);
    if (!tokens.length) return [];
    const excluded = new Set(excludePageIds);
    let rows = [];
    try {
      const match = tokens.map((token) => `${token.replace(/[^a-z0-9]/g, '')}*`).filter(Boolean).join(' OR ');
      rows = db.prepare(`
        SELECT page_id, content FROM story_memory_fts
         WHERE story_id = ? AND story_memory_fts MATCH ?
         ORDER BY bm25(story_memory_fts) LIMIT ?
      `).all(storyId, match, Math.max(limit * 2, 12));
    } catch {
      const clauses = tokens.map(() => 'LOWER(content) LIKE ?').join(' OR ');
      rows = db.prepare(`SELECT page_id, content FROM story_memory_search WHERE story_id = ? AND (${clauses}) LIMIT ?`)
        .all(storyId, ...tokens.map((token) => `%${token}%`), Math.max(limit * 2, 12));
    }
    const pageNo = db.prepare('SELECT page_number FROM story_pages WHERE id = ?');
    return rows.filter((row) => !excluded.has(row.page_id)).slice(0, limit).map((row) => ({
      page_id: row.page_id,
      page_number: pageNo.get(row.page_id)?.page_number || null,
      text: row.content.slice(0, 2400),
    }));
  }

  return {
    contentHash,
    sanitizeDelta,
    ensureSnapshots,
    snapshots,
    memoryRows,
    project,
    coverage,
    coverageSummary,
    continuityView,
    beginPage,
    finishPage,
    failPage,
    getPageMemory,
    clear,
    saveOverrides,
    searchRelevant,
  };
}

module.exports = { createContinuityStore, sanitizeDelta, contentHash, stableId };
