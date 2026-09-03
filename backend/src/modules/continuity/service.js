'use strict';

// The extractor is deliberately separate from the author. It observes one
// committed page, emits bounded structured deltas, and never gets to rewrite
// the prose. A failed extraction leaves the page valid and visibly retryable.

// The provider-facing schema is deliberately flatter than the durable v2
// delta. Large, deeply nested schemas are less portable across providers and
// force models to emit a forest of nulls and empty arrays. We validate this
// compact observation list locally, then deterministically compile it into
// the richer revision-bound delta stored by Ink Morrow.
const CONTINUITY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'ink_morrow_page_observations',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'summary', 'summary_evidence', 'events',
        'character_changes', 'story_changes'],
      properties: {
        schema_version: {
          type: 'integer', enum: [2],
          description: 'Always 2.',
        },
        summary: {
          type: 'string',
          description: 'A compact, page-specific account of what occurs or changes in this page.',
        },
        summary_evidence: {
          type: 'array', minItems: 1, maxItems: 3,
          description: 'One to three short exact quotations copied verbatim from the canonical page that ground the summary.',
          items: { type: 'string' },
        },
        events: {
          type: 'array', maxItems: 20,
          description: 'Significant actions, revelations, transitions, relationship moments, or world events in this page.',
          items: {
            type: 'object', additionalProperties: false,
            required: ['text', 'character_ids', 'importance', 'type', 'evidence_quote'],
            properties: {
              text: { type: 'string', description: 'A concise factual observation supported by the quotation.' },
              character_ids: {
                type: 'array', maxItems: 12, items: { type: 'string' },
                description: 'Only ids from the supplied cast index.',
              },
              importance: { type: 'string', enum: ['minor', 'major'] },
              type: { type: 'string', enum: ['action', 'revelation', 'transition', 'relationship', 'world'] },
              evidence_quote: { type: 'string', description: 'A short exact quotation copied verbatim from this page.' },
            },
          },
        },
        character_changes: {
          type: 'array', maxItems: 60,
          description: 'Atomic character-state changes. Emit one entry for each field that actually changes.',
          items: {
            type: 'object', additionalProperties: false,
            required: ['character_id', 'field', 'value', 'related_character_id', 'evidence_quote'],
            properties: {
              character_id: { type: 'string', description: 'The changed character id from the cast index.' },
              field: {
                type: 'string',
                enum: ['location', 'condition', 'knowledge_gain', 'knowledge_loss',
                  'possession_gain', 'possession_loss', 'personality', 'appearance', 'relationship'],
              },
              value: { type: 'string', description: 'The new state or exact gained/lost item.' },
              related_character_id: {
                type: ['string', 'null'],
                description: 'The other cast id for relationship changes; null for every other field.',
              },
              evidence_quote: { type: 'string', description: 'A short exact quotation copied verbatim from this page.' },
            },
          },
        },
        story_changes: {
          type: 'array', maxItems: 40,
          description: 'Goal, open-thread, world-fact, and character-arc changes caused by this page.',
          items: {
            type: 'object', additionalProperties: false,
            required: ['kind', 'id', 'character_id', 'text', 'state', 'evidence_quote'],
            properties: {
              kind: { type: 'string', enum: ['goal', 'thread', 'world_fact', 'arc'] },
              id: { type: ['string', 'null'] },
              character_id: { type: ['string', 'null'] },
              text: { type: ['string', 'null'] },
              state: {
                type: 'string',
                enum: ['pending', 'active', 'fulfilled', 'abandoned', 'open', 'resolved',
                  'established', 'superseded', 'advance', 'setback', 'turning_point', 'resolution'],
              },
              evidence_quote: { type: 'string', description: 'A short exact quotation copied verbatim from this page.' },
            },
          },
        },
      },
    },
  },
};

const EXTRACTOR_CHARACTER_LIST_LIMIT = 50;
const EXTRACTOR_DETAILED_CHARACTER_LIMIT = 24;
const EXTRACTOR_ACTIVE_ITEM_LIMIT = 24;
const EXTRACTOR_CLOSED_ITEM_LIMIT = 8;
const EXTRACTOR_FACT_LIMIT = 30;
const EXTRACTOR_PAGE_CHARS = 32000;

function clipped(value, max) {
  const raw = String(value || '');
  return raw.length > max ? raw.slice(0, max) + '… [clipped]' : raw;
}

function latest(items, limit) {
  return [...items]
    .sort((a, b) => (Number(a.page_number) || 0) - (Number(b.page_number) || 0))
    .slice(-limit);
}

function boundedStatusItems(items, activeStatuses) {
  const active = latest(items.filter((item) => activeStatuses.has(item.status)), EXTRACTOR_ACTIVE_ITEM_LIMIT);
  const closed = latest(items.filter((item) => !activeStatuses.has(item.status)), EXTRACTOR_CLOSED_ITEM_LIMIT);
  return [...active, ...closed];
}

function parseJson(content) {
  let clean = String(content || '').trim();
  const fenced = clean.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) clean = fenced[1].trim();
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function verifyEvidenceQuotes(delta, pageContent) {
  if (delta?.schema_version !== 2) return delta;
  const page = String(pageContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const items = [
    ...(delta.events || []),
    ...(delta.character_updates || []),
    ...(delta.goal_updates || []),
    ...(delta.thread_updates || []),
    ...(delta.world_fact_updates || []),
    ...(delta.arc_updates || []),
  ];
  for (const item of items) {
    for (const evidence of item.evidence || []) {
      const quote = String(evidence.quote || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!quote || !page.includes(quote)) {
        const error = new Error('Continuity evidence must quote the canonical page directly.');
        error.code = 'INVALID_CONTINUITY_EVIDENCE';
        throw error;
      }
    }
  }
  return delta;
}

function spendOf(value) {
  return {
    model: value?.model || null,
    usage: value?.usage || null,
    cost_usd: typeof value?.cost_usd === 'number'
      ? value.cost_usd
      : typeof value?.costUsd === 'number' ? value.costUsd : null,
    billed_attempts: Number.isInteger(value?.billed_attempts)
      ? value.billed_attempts
      : Number.isInteger(value?.billedAttempts) ? value.billedAttempts : 0,
  };
}

function combineSpend(total, value) {
  const next = spendOf(value);
  total.model = next.model || total.model;
  total.billed_attempts += next.billed_attempts;
  if (next.usage) {
    total.usage.prompt_tokens += Number(next.usage.prompt_tokens) || 0;
    total.usage.completion_tokens += Number(next.usage.completion_tokens) || 0;
  }
  if (typeof next.cost_usd === 'number' && Number.isFinite(next.cost_usd)) total.cost_usd += next.cost_usd;
  else if (next.billed_attempts > 0) total.cost_known = false;
  return total;
}

function publicMemory(row) {
  if (!row) return null;
  return {
    page_id: row.page_id,
    page_revision_id: row.revision_id || null,
    schema_version: row.schema_version || null,
    status: row.status,
    summary: row.summary || null,
    model: row.model || null,
    prompt_tokens: row.prompt_tokens ?? null,
    completion_tokens: row.completion_tokens ?? null,
    cost_usd: row.cost_usd ?? 0,
    error_code: row.error_code || null,
    error: row.error || null,
  };
}

function boundedLines(lines, maxChars) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const value = String(line || '');
    if (used + value.length + 1 > maxChars) break;
    kept.push(value);
    used += value.length + 1;
  }
  if (kept.length < lines.length) kept.push(`… ${lines.length - kept.length} older or less relevant entries omitted`);
  return kept.join('\n');
}

function castRolePriority(role) {
  if (role === 'mc') return 0;
  if (role === 'supporting') return 1;
  if (role === 'background') return 2;
  return 3;
}

function relevantCharacters(characters, page) {
  const source = `${page.content || ''}\n${page.user_input || ''}`.toLocaleLowerCase();
  const entries = characters.map((character, index) => {
    const name = String(character.name || '').toLocaleLowerCase();
    const named = name.length > 1 && source.includes(name);
    const rolePriority = castRolePriority(String(character.role || '').toLocaleLowerCase());
    return { character, index, named, rolePriority };
  });
  const selected = [];
  const add = (entry) => {
    if (selected.length < EXTRACTOR_DETAILED_CHARACTER_LIMIT && !selected.includes(entry)) selected.push(entry);
  };
  // A centered manuscript's Main Character remains the perspective anchor
  // even on a page that uses only pronouns or does not name them at all.
  entries.filter((entry) => entry.rolePriority === 0).forEach(add);
  entries.filter((entry) => entry.named && entry.rolePriority !== 0)
    .sort((a, b) => a.rolePriority - b.rolePriority || a.index - b.index)
    .forEach(add);
  entries.filter((entry) => !entry.named && entry.rolePriority !== 0)
    .sort((a, b) => a.rolePriority - b.rolePriority || a.index - b.index)
    .forEach(add);
  return selected.map((entry) => entry.character);
}

function invalidOutput(message, code = 'INVALID_CONTINUITY_OUTPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidOutput(`${path} must be an object.`, 'INVALID_CONTINUITY_SCHEMA');
  }
  return value;
}

function wireKeys(value, expected, path) {
  wireObject(value, path);
  const wanted = [...expected].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    const missing = wanted.filter((key) => !actual.includes(key));
    const unknown = actual.filter((key) => !wanted.includes(key));
    throw invalidOutput(
      `${path} has the wrong fields${missing.length ? `; missing ${missing.join(', ')}` : ''}` +
      `${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}.`,
      'INVALID_CONTINUITY_SCHEMA'
    );
  }
}

function wireString(value, path, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw invalidOutput(`${path} must be non-empty text of at most ${max} characters.`, 'INVALID_CONTINUITY_SCHEMA');
  }
  return value.trim();
}

function wireNullableString(value, path, max = 2000) {
  return value === null ? null : wireString(value, path, max);
}

function wireArray(value, path, max) {
  if (!Array.isArray(value) || value.length > max) {
    throw invalidOutput(`${path} must be an array of at most ${max} items.`, 'INVALID_CONTINUITY_SCHEMA');
  }
  return value;
}

function normalizedQuote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function exactPageQuote(value, pageContent, path) {
  const quote = wireString(value, path, 500);
  if (quote.length < 4 || !normalizedQuote(pageContent).includes(normalizedQuote(quote))) {
    throw invalidOutput(
      `${path} must be an exact quotation copied from the canonical page.`,
      'INVALID_CONTINUITY_EVIDENCE'
    );
  }
  return quote;
}

function significantWords(value) {
  return new Set((String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]{3,}/gu) || []));
}

function assertSpecificSummary(summary, pageContent) {
  if (summary.length < 16) {
    throw invalidOutput('summary is too short to identify this page.', 'EMPTY_CONTINUITY_MEMORY');
  }
  const pageWords = significantWords(pageContent);
  if (pageWords.size && ![...significantWords(summary)].some((word) => pageWords.has(word))) {
    throw invalidOutput(
      'summary is generic or unsupported; it must name something found on this page.',
      'UNGROUNDED_CONTINUITY_SUMMARY'
    );
  }
}

function compileObservations(input, pageContent, castIds, validateDelta) {
  wireKeys(input, ['schema_version', 'summary', 'summary_evidence', 'events', 'character_changes', 'story_changes'], 'response');
  if (input.schema_version !== 2) {
    throw invalidOutput('schema_version must equal 2.', 'INVALID_CONTINUITY_SCHEMA');
  }
  const cast = new Set(castIds);
  const summary = wireString(input.summary, 'summary', 1600);
  assertSpecificSummary(summary, pageContent);
  const summaryEvidence = wireArray(input.summary_evidence, 'summary_evidence', 3);
  if (!summaryEvidence.length) {
    throw invalidOutput('summary_evidence must contain at least one exact page quotation.', 'EMPTY_CONTINUITY_MEMORY');
  }
  summaryEvidence.forEach((quote, index) => exactPageQuote(quote, pageContent, `summary_evidence[${index}]`));

  const events = wireArray(input.events, 'events', 20).map((raw, index) => {
    const path = `events[${index}]`;
    wireKeys(raw, ['text', 'character_ids', 'importance', 'type', 'evidence_quote'], path);
    const characterIds = wireArray(raw.character_ids, `${path}.character_ids`, 12)
      .map((id, characterIndex) => wireString(id, `${path}.character_ids[${characterIndex}]`, 100));
    if (characterIds.some((id) => !cast.has(id))) {
      throw invalidOutput(`${path}.character_ids contains an id outside the cast index.`, 'INVALID_CONTINUITY_CHARACTER');
    }
    if (!['minor', 'major'].includes(raw.importance)) {
      throw invalidOutput(`${path}.importance is invalid.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    if (!['action', 'revelation', 'transition', 'relationship', 'world'].includes(raw.type)) {
      throw invalidOutput(`${path}.type is invalid.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    return {
      id: null,
      text: wireString(raw.text, `${path}.text`, 1200),
      character_ids: [...new Set(characterIds)],
      importance: raw.importance,
      type: raw.type,
      evidence: [{ quote: exactPageQuote(raw.evidence_quote, pageContent, `${path}.evidence_quote`) }],
    };
  });

  const scalarFields = new Set(['location', 'condition', 'personality', 'appearance']);
  const listFields = Object.freeze({
    knowledge_gain: 'knowledge_gained', knowledge_loss: 'knowledge_lost',
    possession_gain: 'possessions_gained', possession_loss: 'possessions_lost',
  });
  const characters = new Map();
  const characterChanges = wireArray(input.character_changes, 'character_changes', 60);
  for (const [index, raw] of characterChanges.entries()) {
    const path = `character_changes[${index}]`;
    wireKeys(raw, ['character_id', 'field', 'value', 'related_character_id', 'evidence_quote'], path);
    const characterId = wireString(raw.character_id, `${path}.character_id`, 100);
    if (!cast.has(characterId)) {
      throw invalidOutput(`${path}.character_id is outside the cast index.`, 'INVALID_CONTINUITY_CHARACTER');
    }
    const allowedFields = new Set([...scalarFields, ...Object.keys(listFields), 'relationship']);
    if (!allowedFields.has(raw.field)) {
      throw invalidOutput(`${path}.field is invalid.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    const relatedId = wireNullableString(raw.related_character_id, `${path}.related_character_id`, 100);
    if (raw.field === 'relationship') {
      if (!relatedId || !cast.has(relatedId) || relatedId === characterId) {
        throw invalidOutput(`${path}.related_character_id must name another character in the cast.`, 'INVALID_CONTINUITY_CHARACTER');
      }
    } else if (relatedId !== null) {
      throw invalidOutput(`${path}.related_character_id must be null unless field is relationship.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    const value = wireString(raw.value, `${path}.value`, 2000);
    const evidence = [{ quote: exactPageQuote(raw.evidence_quote, pageContent, `${path}.evidence_quote`) }];
    if (!characters.has(characterId)) {
      characters.set(characterId, {
        character_id: characterId,
        location: null, condition: null, knowledge_gained: [], knowledge_lost: [],
        possessions_gained: [], possessions_lost: [], personality: null, appearance: null,
        relationships: [], evidence: [],
      });
    }
    const update = characters.get(characterId);
    if (scalarFields.has(raw.field)) {
      if (update[raw.field] !== null) {
        throw invalidOutput(`${path} duplicates the ${raw.field} change for this character.`, 'AMBIGUOUS_CONTINUITY_MEMORY');
      }
      update[raw.field] = value;
    } else if (raw.field === 'relationship') {
      if (update.relationships.some((item) => item.character_id === relatedId)) {
        throw invalidOutput(`${path} duplicates a relationship change for this character pair.`, 'AMBIGUOUS_CONTINUITY_MEMORY');
      }
      update.relationships.push({ character_id: relatedId, summary: value });
    } else {
      update[listFields[raw.field]].push(value);
    }
    if (!update.evidence.some((item) => normalizedQuote(item.quote) === normalizedQuote(evidence[0].quote)) && update.evidence.length < 5) {
      update.evidence.push(...evidence);
    }
  }

  const goal_updates = [];
  const thread_updates = [];
  const world_fact_updates = [];
  const arc_updates = [];
  const states = Object.freeze({
    goal: new Set(['pending', 'active', 'fulfilled', 'abandoned']),
    thread: new Set(['open', 'resolved']),
    world_fact: new Set(['established', 'superseded']),
    arc: new Set(['advance', 'setback', 'turning_point', 'resolution']),
  });
  const storyChanges = wireArray(input.story_changes, 'story_changes', 40);
  for (const [index, raw] of storyChanges.entries()) {
    const path = `story_changes[${index}]`;
    wireKeys(raw, ['kind', 'id', 'character_id', 'text', 'state', 'evidence_quote'], path);
    if (!states[raw.kind] || !states[raw.kind].has(raw.state)) {
      throw invalidOutput(`${path}.state is invalid for ${raw.kind || 'this change'}.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    const id = wireNullableString(raw.id, `${path}.id`, 100);
    const characterId = wireNullableString(raw.character_id, `${path}.character_id`, 100);
    if (characterId && !cast.has(characterId)) {
      throw invalidOutput(`${path}.character_id is outside the cast index.`, 'INVALID_CONTINUITY_CHARACTER');
    }
    if (['thread', 'world_fact'].includes(raw.kind) && characterId !== null) {
      throw invalidOutput(`${path}.character_id must be null for ${raw.kind}.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    const itemText = wireNullableString(raw.text, `${path}.text`, 1000);
    if (!id && !itemText) {
      throw invalidOutput(`${path} needs text when it does not reuse an existing id.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    if (raw.kind === 'arc' && !itemText) {
      throw invalidOutput(`${path}.text is required for an arc change.`, 'INVALID_CONTINUITY_SCHEMA');
    }
    const evidence = [{ quote: exactPageQuote(raw.evidence_quote, pageContent, `${path}.evidence_quote`) }];
    if (raw.kind === 'goal') goal_updates.push({ id, character_id: characterId, text: itemText, status: raw.state, evidence });
    if (raw.kind === 'thread') thread_updates.push({ id, text: itemText, status: raw.state, evidence });
    if (raw.kind === 'world_fact') world_fact_updates.push({ id, text: itemText, status: raw.state, evidence });
    if (raw.kind === 'arc') arc_updates.push({ id, character_id: characterId, text: itemText, movement: raw.state, evidence });
  }

  if (events.length + characterChanges.length + storyChanges.length === 0) {
    throw invalidOutput(
      'The response contains no page observation. Record at least one evidence-backed event or change.',
      'EMPTY_CONTINUITY_MEMORY'
    );
  }

  return validateDelta({
    schema_version: 2, summary, events, character_updates: [...characters.values()],
    goal_updates, thread_updates, world_fact_updates, arc_updates,
  }, castIds);
}

function createContinuityService({ db, stories, store, chatCompletion, autoEnabled = true }) {
  // A prepared-page commit starts extraction after responding, while the
  // browser may immediately ask for that result to update its cost ticker.
  // Both callers must join one provider job, never purchase duplicate memory.
  const pageSyncs = new Map();

  function extractionMessages(story, page) {
    // Crucially, page N is interpreted against the fold through N-1. Later
    // pages can never leak facts backward during a manual memory build.
    const before = store.project(story, { throughPageNumber: page.page_number - 1 });
    const indexedCast = before.characters
      .map((character, index) => ({ character, index }))
      .sort((a, b) => castRolePriority(a.character.role) - castRolePriority(b.character.role) || a.index - b.index)
      .map((entry) => entry.character);
    const castIndex = boundedLines(indexedCast.map((character) =>
      `- ${clipped(character.name, 160)} [${character.id}], ${character.role || 'cast'}`
    ), 16000);
    const characterLines = relevantCharacters(before.characters, page).map((character) => {
      const current = character.current;
      return `- ${character.name} [${character.id}], ${character.role}: ` +
        `location=${current.location || 'unknown'}; condition=${current.condition || 'normal'}; ` +
        `personality=${clipped(current.personality || 'unspecified', 500)}; ` +
        `appearance=${clipped(current.appearance || 'unspecified', 500)}; ` +
        `relationship=${clipped(current.relationship_to_mc || 'unspecified', 400)}; ` +
        `recent knowledge=${clipped(current.knowledge.slice(-EXTRACTOR_CHARACTER_LIST_LIMIT).join('; ') || 'none recorded', 1200)}; ` +
        `recent possessions=${clipped(current.possessions.slice(-EXTRACTOR_CHARACTER_LIST_LIMIT).join('; ') || 'none recorded', 1200)}`;
    });
    const detailedCast = boundedLines(characterLines, 18000);
    const goals = boundedLines(boundedStatusItems(before.goals, new Set(['pending', 'active']))
      .map((goal) => `- [${goal.id}] ${clipped(goal.text || '(untitled)', 1000)} — ${goal.status}`), 8000);
    const threads = boundedLines(boundedStatusItems(before.threads, new Set(['open']))
      .map((thread) => `- [${thread.id}] ${clipped(thread.text || '(untitled)', 1000)} — ${thread.status}`), 8000);
    const worldFacts = boundedLines(latest(before.world_facts.filter((fact) => fact.status === 'established'), EXTRACTOR_FACT_LIMIT)
      .map((fact) => `- [${fact.id}] ${clipped(fact.text || '(untitled)', 1000)}`), 8000);
    const system = [
      'You are Ink Morrow’s Archivist. Extract durable changes from ONE already-written canonical story-page revision.',
      'Report only facts caused or made true by this page. Do not treat character sheets, plans, desires, hypothetical language, dialogue commands, or user direction as events unless the prose says they happened.',
      'A goal may move to fulfilled or abandoned when the page resolves it. Do not recreate a resolved goal under a new id.',
      'Reuse the listed id when changing an existing goal, thread, or fact. For knowledge_lost or possessions_lost, copy the prior item text exactly so the local fold can remove it.',
      'Use only listed character ids. Keep the summary factual, compact, and specific to this page.',
      'When the cast has a Main Character, treat that character as the continuing perspective anchor even if this page does not repeat their name.',
      'Copy every evidence quotation exactly from the canonical page. Do not paraphrase evidence.',
      'Each character_changes entry changes exactly one field. related_character_id is used only for relationship changes.',
      'Use story_changes for goals, threads, world facts, and arcs; the state must be valid for its kind.',
      'Every non-empty story page needs at least one evidence-backed event or change. Never return a generic summary with three empty arrays.',
      'Return schema_version 2 and one strict JSON object matching the supplied compact observation schema. Unknown fields are forbidden. Return no prose.',
    ].join(' ');
    const user = [
      `STORY: ${story.title}`,
      `CAST INDEX (identity only; use only these ids):\n${castIndex || '(no fixed cast)'}`,
      `DETAILED STATE FOR PAGE-RELEVANT CAST BEFORE PAGE ${page.page_number}:\n${detailedCast || '(none)'}`,
      `GOALS BEFORE:\n${goals || '(none)'}`,
      `OPEN/RESOLVED THREADS BEFORE:\n${threads || '(none)'}`,
      `ESTABLISHED STORY FACTS BEFORE:\n${worldFacts || '(none)'}`,
      page.user_input ? `AUTHOR DIRECTION THAT LED TO THIS PAGE (context only; not proof it happened):\n${clipped(page.user_input, 4000)}` : '',
      `CANONICAL PAGE ${page.page_number} REVISION ${page.revision_id}:\n${clipped(page.content, EXTRACTOR_PAGE_CHARS)}`,
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  async function extract(story, page, modelOverride) {
    const messages = extractionMessages(story, page);
    const total = { model: null, usage: { prompt_tokens: 0, completion_tokens: 0 }, cost_usd: 0, cost_known: true, billed_attempts: 0 };
    const castIds = store.snapshots(story).map((character) => character.character_id);

    function repairMessages(previousContent, failure) {
      const feedback = clipped(failure?.message || 'The response was unusable.', 700);
      return [
        ...messages,
        ...(previousContent ? [{ role: 'assistant', content: clipped(previousContent, 12000) }] : []),
        {
          role: 'system',
          content: `That response failed Ink Morrow's local validation: ${feedback} ` +
            'Correct the stated defect. Re-read the canonical page, copy evidence exactly, and return only the complete JSON object.',
        },
      ];
    }

    async function call(preferredMode = 'schema', previousContent = '', failure = null) {
      const callMessages = failure ? repairMessages(previousContent, failure) : messages;
      let mode = preferredMode;
      while (true) {
        const format = mode === 'schema'
          ? { responseFormat: CONTINUITY_SCHEMA, requireParameters: true }
          : mode === 'json'
            ? { responseFormat: { type: 'json_object' }, requireParameters: true }
            : {};
        try {
          const result = await chatCompletion(callMessages, {
            model: modelOverride || undefined,
            temperature: 0.1,
            maxTokens: 4000,
            // Gemini 2.5 uses a numeric thinking budget. Sending the generic
            // effort "none" can be mapped to a non-zero minimum and consume
            // the entire completion before the JSON answer. A zero budget is
            // the provider-supported way to reserve the output for memory.
            reasoningMaxTokens: 0,
            maxBillableAttempts: 1,
            ...format,
          });
          return { result, mode };
        } catch (error) {
          // Structured-output support is endpoint-specific. Walk down from
          // JSON Schema to JSON object to strict prompt-only JSON, but only
          // when the refusal bought no completion.
          const unsupported = [400, 404, 422].includes(error.upstreamStatus) && !error.billedAttempts;
          if (unsupported && mode !== 'plain') {
            mode = mode === 'schema' ? 'json' : 'plain';
            continue;
          }
          error.continuityFormat = mode;
          throw error;
        }
      }
    }

    function decode(result) {
      const parsed = parseJson(result.content);
      if (!parsed) {
        throw invalidOutput('The Archivist did not return one complete JSON object.', 'INVALID_CONTINUITY_JSON');
      }
      return compileObservations(parsed, page.content, castIds, (delta, ids) =>
        verifyEvidenceQuotes(store.sanitizeDelta(delta, ids), page.content));
    }

    let firstResult = null;
    let firstMode = 'schema';
    let firstFailure = null;
    try {
      const first = await call('schema');
      firstResult = first.result;
      firstMode = first.mode;
      combineSpend(total, firstResult);
      const delta = decode(firstResult);
      return {
        delta,
        spend: {
          model: total.model || firstResult.model, usage: total.usage,
          cost_usd: total.cost_known ? total.cost_usd : null,
          billed_attempts: total.billed_attempts,
        },
      };
    } catch (error) {
      if (!firstResult) combineSpend(total, error);
      firstFailure = error;
      firstMode = error.continuityFormat || firstMode;
      const locallyRepairable = Boolean(firstResult) ||
        ['AI_EMPTY_RESPONSE', 'AI_TRUNCATED_RESPONSE'].includes(error.code);
      if (!locallyRepairable) {
        error.extractionSpend = total;
        throw error;
      }
    }

    try {
      const second = await call(firstMode, firstResult?.content || '', firstFailure);
      combineSpend(total, second.result);
      const delta = decode(second.result);
      return {
        delta,
        spend: {
          model: total.model || second.result.model, usage: total.usage,
          cost_usd: total.cost_known ? total.cost_usd : null,
          billed_attempts: total.billed_attempts,
        },
      };
    } catch (secondFailure) {
      if (!secondFailure.extractionSpend) combineSpend(total, secondFailure);
      const error = invalidOutput(
        `The Archivist returned unusable memory twice. First: ${firstFailure?.message || 'invalid output'} Second: ${secondFailure.message}`,
        secondFailure.code || 'INVALID_CONTINUITY_OUTPUT'
      );
      error.extractionSpend = total;
      throw error;
    }
  }

  async function runSyncPage(story, page, { model, force = false } = {}) {
    if (!page || page.story_id !== story.id) throw new Error('Page does not belong to this story');
    const canonical = store.pageForExtraction(page.id);
    if (!canonical || canonical.story_id !== story.id) throw new Error('Page has no canonical revision');
    if (canonical.image_media_type || !String(canonical.content || '').trim()) return { skipped: true, reason: 'non-text page' };
    const hash = store.contentHash(canonical.content);
    const current = store.getPageMemory(canonical.id);
    if (!force && current?.status === 'ready' && current.content_hash === hash) {
      return { memory: publicMemory(current), page: stories.getPageById(canonical.id), unchanged: true };
    }

    const begun = store.beginPage(canonical);
    try {
      const { delta, spend } = await extract(story, begun.page, model || undefined);
      const row = store.finishPage(begun.page, begun.hash, delta, spend);
      return { memory: publicMemory(row), page: stories.getPageById(canonical.id), delta };
    } catch (error) {
      const raw = error.extractionSpend || spendOf(error);
      const spend = {
        model: raw.model || model || null,
        usage: raw.usage || { prompt_tokens: 0, completion_tokens: 0 },
        cost_usd: raw.cost_known === false ? null : raw.cost_usd,
        billed_attempts: raw.billed_attempts || 0,
      };
      const row = store.failPage(begun.page, begun.hash, error, spend);
      return { memory: publicMemory(row), page: stories.getPageById(canonical.id), failed: true };
    }
  }

  function syncPage(story, page, options = {}) {
    const canonical = page ? store.pageForExtraction(page.id) : null;
    const key = canonical ? `${canonical.id}:${canonical.revision_id}` : page?.id;
    const existing = pageSyncs.get(key);
    if (existing) return existing;
    let task;
    task = runSyncPage(story, page, options).finally(() => {
      if (pageSyncs.get(key) === task) pageSyncs.delete(key);
    });
    pageSyncs.set(key, task);
    return task;
  }

  async function maybeSyncPage(story, page, options = {}) {
    if (!autoEnabled) return { page };
    return syncPage(story, page, options);
  }

  function contextForPrompt(story, { userInput = '', excludePageIds = [], throughPageNumber = null, recentPageIds = [] } = {}) {
    const projection = store.project(story, { throughPageNumber, excludePageIds });
    const relevant = store.searchRelevant(
      story.id,
      `${userInput} ${projection.characters.map((character) => character.name).join(' ')}`,
      { excludePageIds: [...excludePageIds, ...recentPageIds], limit: 6 }
    );
    return { ...projection, relevant, coverage: store.coverageSummary(story) };
  }

  function view(story) {
    return store.continuityView(story);
  }

  async function summarizeImpact(story, issueIds, { model } = {}) {
    if (!Array.isArray(issueIds) || issueIds.length < 1 || issueIds.length > 50 ||
        issueIds.some((id) => typeof id !== 'string' || !id.trim())) {
      const error = new Error('"issue_ids" must contain between 1 and 50 issue ids');
      error.statusCode = 400;
      throw error;
    }
    const wanted = new Set(issueIds);
    const issues = store.issueRows(story.id).filter((issue) => wanted.has(issue.id));
    if (issues.length !== wanted.size) {
      const error = new Error('One or more continuity issues do not belong to this story');
      error.statusCode = 400;
      throw error;
    }
    const correctionById = new Map(view(story).corrections.map((row) => [row.id, row]));
    const payload = issues.map((issue) => ({
      issue_id: issue.id,
      status: issue.status,
      page_number: issue.detail?.page_number || null,
      reason: issue.detail?.reason || null,
      matched_terms: (issue.detail?.matched_terms || []).slice(0, 12),
      correction: (() => {
        const row = correctionById.get(issue.correction_id);
        return row ? {
          scope: row.scope,
          subject_id: row.subject_id,
          field: row.field,
          value: clipped(typeof row.value === 'string' ? row.value : JSON.stringify(row.value), 1000),
        } : null;
      })(),
    }));
    const result = await chatCompletion([
      {
        role: 'system',
        content: 'Summarize deterministic continuity warnings for an author. Explain possible conflicts plainly. Do not propose or apply prose changes, decide canon, or add facts. Return concise prose only.',
      },
      { role: 'user', content: `STORY: ${story.title}\nWARNINGS:\n${JSON.stringify(payload)}` },
    ], {
      model: model || undefined,
      temperature: 0.1,
      maxTokens: 600,
      maxBillableAttempts: 1,
    });
    return {
      summary: String(result?.content || '').trim().slice(0, 6000),
      model: result?.model || model || null,
      usage: result?.usage || null,
      cost_usd: typeof result?.cost_usd === 'number' ? result.cost_usd : null,
      billed_attempts: Number.isInteger(result?.billed_attempts) ? result.billed_attempts : 0,
    };
  }

  return {
    extract,
    syncPage,
    maybeSyncPage,
    contextForPrompt,
    view,
    summarizeImpact,
    isAutoEnabled: () => autoEnabled,
  };
}

module.exports = { createContinuityService, CONTINUITY_SCHEMA, parseJson, verifyEvidenceQuotes, publicMemory };
