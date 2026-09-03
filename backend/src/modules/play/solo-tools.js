'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { optionalText } = require('../../core/validation');

const KINDS = Object.freeze(['dice', 'oracle', 'table', 'deck', 'fields', 'clock']);

function problem(message, statusCode = 400, code = 'INVALID_SOLO_TOOL') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function boundedText(value, max, label) {
  const clean = optionalText(value, { max });
  if (!clean) throw problem(`${label} must be non-empty text of at most ${max} characters.`);
  return clean;
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw problem(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function diceNotation(value) {
  const clean = String(value || '').trim().toLowerCase().replaceAll(' ', '');
  const match = /^(\d{0,3})d(\d{1,7})(?:([+-])(\d{1,9}))?$/.exec(clean);
  if (!match) throw problem('Dice notation must look like d20, 2d6+1, or 3d8-2.', 400, 'INVALID_DICE_NOTATION');
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[4] || 0) * (match[3] === '-' ? -1 : 1);
  integer(count, 1, 100, 'Dice count');
  integer(sides, 2, 1_000_000, 'Die sides');
  integer(modifier, -1_000_000_000, 1_000_000_000, 'Dice modifier');
  return { notation: `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`, count, sides, modifier };
}

function validateConfig(kind, value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (kind === 'dice') return { notation: diceNotation(input.notation || '1d20').notation };
  if (kind === 'oracle') return { chance: integer(input.chance ?? 50, 1, 99, 'Likelihood') };
  if (kind === 'table') {
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 100) {
      throw problem('A weighted table needs 1 to 100 entries.');
    }
    return { entries: input.entries.map((entry, index) => ({
      label: boundedText(entry?.label, 500, `Table entry ${index + 1}`),
      weight: integer(entry?.weight ?? 1, 1, 1_000_000, `Weight for table entry ${index + 1}`),
    })) };
  }
  if (kind === 'deck') {
    if (!Array.isArray(input.cards) || !input.cards.length || input.cards.length > 500) {
      throw problem('A deck needs 1 to 500 cards.');
    }
    return { cards: input.cards.map((card, index) => boundedText(card, 500, `Card ${index + 1}`)) };
  }
  if (kind === 'fields') {
    if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 30) {
      throw problem('User-defined fields need 1 to 30 named fields.');
    }
    const names = new Set();
    const fields = input.fields.map((field, index) => {
      const name = boundedText(field?.name, 100, `Field ${index + 1}`);
      if (names.has(name.toLowerCase())) throw problem('User-defined field names must be unique.');
      names.add(name.toLowerCase());
      return { name, initial: String(field?.initial ?? '').slice(0, 500) };
    });
    return { fields };
  }
  if (kind === 'clock') return {
    segments: integer(input.segments ?? 6, 2, 20, 'Clock segments'),
    initial: integer(input.initial ?? 0, 0, input.segments ?? 6, 'Initial clock progress'),
  };
  throw problem(`Tool kind must be one of: ${KINDS.join(', ')}.`);
}

function initialState(kind, config, previous = null) {
  if (kind === 'deck') return { remaining: config.cards.map((_, index) => index) };
  if (kind === 'fields') {
    const old = previous?.values || {};
    return { values: Object.fromEntries(config.fields.map((field) => [field.name, Object.hasOwn(old, field.name) ? old[field.name] : field.initial])) };
  }
  if (kind === 'clock') return { current: Math.min(config.segments, previous?.current ?? config.initial) };
  return {};
}

function publicTool(row) {
  return row && {
    ...row,
    active: Boolean(row.active),
    config: parseJson(row.config_json, {}),
    state: parseJson(row.state_json, {}),
    config_json: undefined,
    state_json: undefined,
  };
}

function publicRecord(row) {
  return row && {
    ...row,
    input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, {}),
    input_json: undefined,
    result_json: undefined,
  };
}

function createSoloToolStore(db, { stories, playStore }) {
  const inImmediate = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  function list(storyId, { includeArchived = false } = {}) {
    if (!stories.getStory(storyId)) return null;
    return db.prepare(`SELECT * FROM solo_tools WHERE story_id = ? ${includeArchived ? '' : 'AND active = 1'} ORDER BY ordinal`)
      .all(storyId).map(publicTool);
  }

  function get(storyId, toolId) {
    return publicTool(db.prepare('SELECT * FROM solo_tools WHERE id = ? AND story_id = ?').get(toolId, storyId));
  }

  function create(storyId, body) {
    if (!stories.getStory(storyId)) return null;
    const kind = String(body?.kind || '').trim();
    if (!KINDS.includes(kind)) throw problem(`Tool kind must be one of: ${KINDS.join(', ')}.`);
    const name = boundedText(body?.name, 200, 'Tool name');
    const config = validateConfig(kind, body?.config);
    const state = initialState(kind, config);
    const id = randomUUID();
    inImmediate(() => {
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM solo_tools WHERE story_id = ?').get(storyId).value;
      db.prepare(`INSERT INTO solo_tools (id, story_id, ordinal, kind, name, config_json, state_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, storyId, ordinal, kind, name, JSON.stringify(config), JSON.stringify(state));
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    });
    return get(storyId, id);
  }

  function update(storyId, toolId, body) {
    const existing = get(storyId, toolId);
    if (!existing) return null;
    if (!existing.active) throw problem('An archived tool cannot be edited.', 409, 'SOLO_TOOL_ARCHIVED');
    const name = body?.name === undefined ? existing.name : boundedText(body.name, 200, 'Tool name');
    const config = body?.config === undefined ? existing.config : validateConfig(existing.kind, body.config);
    const state = body?.config === undefined ? existing.state : initialState(existing.kind, config, existing.state);
    db.prepare(`UPDATE solo_tools SET name = ?, config_json = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND story_id = ?`).run(name, JSON.stringify(config), JSON.stringify(state), toolId, storyId);
    db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return get(storyId, toolId);
  }

  function archive(storyId, toolId) {
    const result = db.prepare(`UPDATE solo_tools SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND story_id = ? AND active = 1`).run(toolId, storyId);
    if (result.changes) db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    return Boolean(result.changes);
  }

  function sessionRow(storyId, sessionId) {
    return db.prepare(`SELECT session.*, scene.id AS scene_id, volume.story_id
      FROM play_sessions session JOIN scenes scene ON scene.id = session.scene_id
      JOIN chapters chapter ON chapter.id = scene.chapter_id JOIN volumes volume ON volume.id = chapter.volume_id
      WHERE session.id = ? AND volume.story_id = ?`).get(sessionId, storyId) || null;
  }

  function resolve(tool, input) {
    if (tool.kind === 'dice') {
      const dice = diceNotation(input?.notation || tool.config.notation);
      const rolls = Array.from({ length: dice.count }, () => randomInt(1, dice.sides + 1));
      const total = rolls.reduce((sum, roll) => sum + roll, dice.modifier);
      return { input: { notation: dice.notation }, result: { rolls, modifier: dice.modifier, total }, summary: `${dice.notation} → ${rolls.join(', ')}${dice.modifier ? ` ${dice.modifier > 0 ? '+' : '−'} ${Math.abs(dice.modifier)}` : ''} = ${total}`, state: tool.state };
    }
    if (tool.kind === 'oracle') {
      const chance = integer(input?.chance ?? tool.config.chance, 1, 99, 'Likelihood');
      const roll = randomInt(1, 101);
      const yes = roll <= chance;
      const exceptionalYes = yes && roll <= Math.max(1, Math.floor(chance / 5));
      const exceptionalNo = !yes && roll >= 101 - Math.max(1, Math.floor((100 - chance) / 5));
      const answer = exceptionalYes ? 'Exceptional yes' : exceptionalNo ? 'Exceptional no' : yes ? 'Yes' : 'No';
      return { input: { chance }, result: { roll, answer, yes, exceptional: exceptionalYes || exceptionalNo }, summary: `${chance}% oracle → ${roll}: ${answer}`, state: tool.state };
    }
    if (tool.kind === 'table') {
      const totalWeight = tool.config.entries.reduce((sum, entry) => sum + entry.weight, 0);
      if (!Number.isSafeInteger(totalWeight)) throw problem('Table weights are too large together.');
      const roll = randomInt(totalWeight);
      let cursor = 0;
      const index = tool.config.entries.findIndex((entry) => { cursor += entry.weight; return roll < cursor; });
      const entry = tool.config.entries[index];
      return { input: {}, result: { index, label: entry.label, weight: entry.weight, roll: roll + 1, total_weight: totalWeight }, summary: `Table → ${entry.label}`, state: tool.state };
    }
    if (tool.kind === 'deck') {
      if (input?.action !== undefined && !['draw', 'reset'].includes(input.action)) {
        throw problem('Deck action must be draw or reset.');
      }
      if (input?.action === 'reset') {
        const state = initialState('deck', tool.config);
        return { input: { action: 'reset' }, result: { reset: true, remaining: state.remaining.length }, summary: `Deck reset · ${state.remaining.length} cards ready`, state };
      }
      const remaining = Array.isArray(tool.state.remaining) ? [...tool.state.remaining] : [];
      if (!remaining.length) throw problem('This deck is empty. Reset it explicitly before drawing again.', 409, 'SOLO_DECK_EMPTY');
      const position = randomInt(remaining.length);
      const cardIndex = remaining.splice(position, 1)[0];
      const card = tool.config.cards[cardIndex];
      return { input: { action: 'draw' }, result: { card, card_index: cardIndex, remaining: remaining.length }, summary: `Drew ${card} · ${remaining.length} remaining`, state: { remaining } };
    }
    if (tool.kind === 'fields') {
      const values = input?.values;
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw problem('Supply values for the user-defined fields.');
      const allowed = new Set(tool.config.fields.map((field) => field.name));
      if (Object.keys(values).some((name) => !allowed.has(name))) throw problem('A value refers to an unknown field.');
      const before = { ...(tool.state.values || {}) };
      const after = { ...before };
      const normalized = {};
      for (const field of tool.config.fields) {
        if (!Object.hasOwn(values, field.name)) continue;
        normalized[field.name] = String(values[field.name] ?? '').slice(0, 500);
        after[field.name] = normalized[field.name];
      }
      const changed = tool.config.fields.filter((field) => before[field.name] !== after[field.name]).map((field) => field.name);
      if (!changed.length) throw problem('Change at least one field before committing it.');
      return { input: { values: normalized }, result: { before, after, changed }, summary: `Updated ${changed.join(', ')}`, state: { values: after } };
    }
    const change = integer(input?.change, -tool.config.segments, tool.config.segments, 'Clock change');
    if (!change) throw problem('Clock change cannot be zero.');
    const before = tool.state.current ?? tool.config.initial;
    const after = before + change;
    if (after < 0 || after > tool.config.segments) throw problem(`That change would move the clock outside 0–${tool.config.segments}.`);
    return { input: { change }, result: { before, after, segments: tool.config.segments }, summary: `Clock ${before}/${tool.config.segments} → ${after}/${tool.config.segments}`, state: { current: after } };
  }

  function run(storyId, sessionId, toolId, input = {}) {
    const session = sessionRow(storyId, sessionId);
    if (!session) return null;
    if (session.status !== 'active') throw problem('An ended session is read-only.', 409, 'PLAY_SESSION_ENDED');
    if (db.prepare("SELECT 1 FROM play_ai_requests WHERE session_id = ? AND status = 'in_flight'").get(sessionId)) {
      throw problem('Wait for the Scribe reply before recording a tool result.', 409, 'PLAY_REPLY_IN_FLIGHT');
    }
    const tool = get(storyId, toolId);
    if (!tool || !tool.active) throw problem('Choose an active solo tool.', 404, 'SOLO_TOOL_NOT_FOUND');
    const branch = db.prepare(`SELECT branch.* FROM play_sessions session JOIN play_branches branch
      ON branch.id = session.selected_branch_id WHERE session.id = ?`).get(sessionId);
    if (!branch) throw problem('This session has no active path.', 409, 'PLAY_BRANCH_MISSING');
    const resolution = resolve(tool, input);
    const id = randomUUID();
    inImmediate(() => {
      const ordinal = db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS value FROM play_tool_records WHERE session_id = ?').get(sessionId).value;
      const afterTurn = playStore.listTurns(sessionId, branch.id).at(-1)?.ordinal || 0;
      db.prepare(`INSERT INTO play_tool_records
        (id, story_id, scene_id, session_id, branch_id, ordinal, after_turn_ordinal,
         tool_id, tool_kind, tool_name, input_json, result_json, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, storyId, session.scene_id, sessionId, branch.id, ordinal, afterTurn,
          tool.id, tool.kind, tool.name, JSON.stringify(resolution.input), JSON.stringify(resolution.result), resolution.summary);
      db.prepare('UPDATE solo_tools SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(resolution.state), tool.id);
      db.prepare('UPDATE stories SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(storyId);
    });
    return { record: publicRecord(db.prepare('SELECT * FROM play_tool_records WHERE id = ?').get(id)), tool: get(storyId, toolId) };
  }

  function listForPath(storyId, sessionId, branchId = null) {
    const session = playStore.get(storyId, sessionId, { turns: true });
    if (!session) return null;
    let branch = session.branches.find((item) => item.id === (branchId || session.selected_branch_id));
    if (!branch) return [];
    const chain = [];
    while (branch) {
      chain.unshift(branch);
      branch = branch.parent_branch_id ? session.branches.find((item) => item.id === branch.parent_branch_id) : null;
      if (chain.length > 100) throw problem('Play branch ancestry is too deep.', 409, 'PLAY_BRANCH_DEPTH');
    }
    const records = [];
    for (let index = 0; index < chain.length; index++) {
      const current = chain[index];
      const nextFork = chain[index + 1]?.fork_turn_id;
      const cutoff = nextFork ? session.turns.find((turn) => turn.id === nextFork)?.ordinal
        || db.prepare('SELECT ordinal FROM play_turns WHERE id = ?').get(nextFork)?.ordinal : null;
      records.push(...db.prepare(`SELECT * FROM play_tool_records WHERE session_id = ? AND branch_id = ?
        AND (? IS NULL OR after_turn_ordinal < ?) ORDER BY ordinal`).all(sessionId, current.id, cutoff, cutoff));
    }
    return records.map(publicRecord);
  }

  function listForScene(storyId, sceneId, limit = 200) {
    if (!stories.scenes.get(storyId, sceneId)) return null;
    return db.prepare(`SELECT record.*, branch.name AS branch_name, session.ordinal AS session_ordinal
      FROM play_tool_records record JOIN play_branches branch ON branch.id = record.branch_id
      JOIN play_sessions session ON session.id = record.session_id
      WHERE record.story_id = ? AND record.scene_id = ?
      ORDER BY session.ordinal DESC, record.ordinal DESC LIMIT ?`).all(storyId, sceneId, limit).reverse().map(publicRecord);
  }

  return { list, get, create, update, archive, run, listForPath, listForScene, KINDS };
}

module.exports = { createSoloToolStore, validateConfig, diceNotation, KINDS };
