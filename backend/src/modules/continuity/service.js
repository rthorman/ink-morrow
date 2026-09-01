'use strict';

// The extractor is deliberately separate from the author. It observes one
// committed page, emits bounded structured deltas, and never gets to rewrite
// the prose. A failed extraction leaves the page valid and visibly retryable.

const EVIDENCE_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 5,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['quote'],
    properties: { quote: { type: 'string' } },
  },
};

const CONTINUITY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'ink_morrow_continuity_delta',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'summary', 'events', 'character_updates', 'goal_updates',
        'thread_updates', 'world_fact_updates', 'arc_updates'],
      properties: {
        schema_version: { const: 2 },
        summary: { type: 'string' },
        events: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'character_ids', 'importance', 'type', 'evidence'],
            properties: {
              id: { type: ['string', 'null'] },
              text: { type: 'string' },
              character_ids: { type: 'array', items: { type: 'string' } },
              importance: { type: 'string', enum: ['minor', 'major'] },
              type: { type: 'string', enum: ['action', 'revelation', 'transition', 'relationship', 'world'] },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        character_updates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['character_id', 'location', 'condition', 'knowledge_gained', 'knowledge_lost',
              'possessions_gained', 'possessions_lost', 'personality', 'appearance',
              'relationships', 'evidence'],
            properties: {
              character_id: { type: 'string' },
              location: { type: ['string', 'null'] },
              condition: { type: ['string', 'null'] },
              knowledge_gained: { type: 'array', items: { type: 'string' } },
              knowledge_lost: { type: 'array', items: { type: 'string' } },
              possessions_gained: { type: 'array', items: { type: 'string' } },
              possessions_lost: { type: 'array', items: { type: 'string' } },
              personality: { type: ['string', 'null'] },
              appearance: { type: ['string', 'null'] },
              relationships: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['character_id', 'summary'],
                  properties: {
                    character_id: { type: 'string' },
                    summary: { type: 'string' },
                  },
                },
              },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        goal_updates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'character_id', 'text', 'status', 'evidence'],
            properties: {
              id: { type: ['string', 'null'] },
              character_id: { type: ['string', 'null'] },
              text: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['pending', 'active', 'fulfilled', 'abandoned'] },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        thread_updates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'status', 'evidence'],
            properties: {
              id: { type: ['string', 'null'] },
              text: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['open', 'resolved'] },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        world_fact_updates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'text', 'status', 'evidence'],
            properties: {
              id: { type: ['string', 'null'] },
              text: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['established', 'superseded'] },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        arc_updates: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['id', 'character_id', 'text', 'movement', 'evidence'],
            properties: {
              id: { type: ['string', 'null'] },
              character_id: { type: ['string', 'null'] },
              text: { type: 'string' },
              movement: { type: 'string', enum: ['advance', 'setback', 'turning_point', 'resolution'] },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
      },
    },
  },
};

const EXTRACTOR_CHARACTER_LIST_LIMIT = 50;
const EXTRACTOR_ACTIVE_ITEM_LIMIT = 40;
const EXTRACTOR_CLOSED_ITEM_LIMIT = 20;
const EXTRACTOR_FACT_LIMIT = 50;
const EXTRACTOR_PAGE_CHARS = 50000;

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
  const clean = String(content || '').replace(/```json|```/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
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
    error: row.error || null,
  };
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
    const characterLines = before.characters.map((character) => {
      const current = character.current;
      return `- ${character.name} [${character.id}], ${character.role}: ` +
        `location=${current.location || 'unknown'}; condition=${current.condition || 'normal'}; ` +
        `personality=${clipped(current.personality || 'unspecified', 1200)}; ` +
        `appearance=${clipped(current.appearance || 'unspecified', 1200)}; ` +
        `relationship=${clipped(current.relationship_to_mc || 'unspecified', 800)}; ` +
        `recent knowledge=${clipped(current.knowledge.slice(-EXTRACTOR_CHARACTER_LIST_LIMIT).join('; ') || 'none recorded', 5000)}; ` +
        `recent possessions=${clipped(current.possessions.slice(-EXTRACTOR_CHARACTER_LIST_LIMIT).join('; ') || 'none recorded', 5000)}`;
    });
    const goals = boundedStatusItems(before.goals, new Set(['pending', 'active']))
      .map((goal) => `- [${goal.id}] ${clipped(goal.text || '(untitled)', 1000)} — ${goal.status}`).join('\n');
    const threads = boundedStatusItems(before.threads, new Set(['open']))
      .map((thread) => `- [${thread.id}] ${clipped(thread.text || '(untitled)', 1000)} — ${thread.status}`).join('\n');
    const worldFacts = latest(before.world_facts.filter((fact) => fact.status === 'established'), EXTRACTOR_FACT_LIMIT)
      .map((fact) => `- [${fact.id}] ${fact.text || '(untitled)'}`).join('\n');
    const system = [
      'You are Ink Morrow’s Archivist. Extract durable changes from ONE already-written canonical story-page revision.',
      'Report only facts caused or made true by this page. Do not treat character sheets, plans, desires, hypothetical language, dialogue commands, or user direction as events unless the prose says they happened.',
      'A goal may move to fulfilled or abandoned when the page resolves it. Do not recreate a resolved goal under a new id.',
      'Reuse the listed id when changing an existing goal, thread, or fact. For knowledge_lost or possessions_lost, copy the prior item text exactly so the local fold can remove it.',
      'Use only listed character ids. Keep summaries factual and compact. Empty arrays are correct when nothing durable changed.',
      'Every durable item must cite one to five short, exact quotations from this page in its evidence array.',
      'Return schema_version 2 and one strict JSON object matching the supplied schema. Unknown fields are forbidden. Return no prose.',
    ].join(' ');
    const user = [
      `STORY: ${story.title}`,
      `STATE BEFORE PAGE ${page.page_number}:`,
      characterLines.join('\n') || '(no fixed cast)',
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

    async function call(useSchema, correction = false) {
      const callMessages = correction
        ? [...messages, { role: 'system', content: 'The previous reply was invalid. Return ONLY one valid JSON object matching every required field.' }]
        : messages;
      try {
        return await chatCompletion(callMessages, {
          model: modelOverride || undefined,
          temperature: 0.1,
          maxTokens: 2200,
          maxBillableAttempts: 1,
          ...(useSchema ? { responseFormat: CONTINUITY_SCHEMA } : {}),
        });
      } catch (error) {
        // Some OpenRouter providers advertise chat but reject JSON Schema.
        // A schema-validation 400 has no successful completion and can safely
        // fall back to the same strict instruction without double-counting.
        if (useSchema && error.upstreamStatus === 400 && !error.billedAttempts) {
          return chatCompletion(callMessages, {
            model: modelOverride || undefined,
            temperature: 0.1,
            maxTokens: 2200,
            maxBillableAttempts: 1,
          });
        }
        throw error;
      }
    }

    let result;
    try {
      result = await call(true);
      combineSpend(total, result);
      let parsed = parseJson(result.content);
      let delta = null;
      if (parsed) {
        try {
          const castIds = store.snapshots(story).map((character) => character.character_id);
          delta = verifyEvidenceQuotes(store.sanitizeDelta(parsed, castIds), page.content);
        } catch {
          delta = null;
        }
      }
      if (!delta) {
        result = await call(false, true);
        combineSpend(total, result);
        parsed = parseJson(result.content);
        if (parsed) {
          const castIds = store.snapshots(story).map((character) => character.character_id);
          delta = verifyEvidenceQuotes(store.sanitizeDelta(parsed, castIds), page.content);
        }
      }
      if (!delta) {
        const error = new Error('The continuity clerk returned invalid structured data twice.');
        error.extractionSpend = total;
        throw error;
      }
      return {
        delta,
        spend: {
          model: total.model || result.model,
          usage: total.usage,
          cost_usd: total.cost_known ? total.cost_usd : null,
          billed_attempts: total.billed_attempts,
        },
      };
    } catch (error) {
      if (!error.extractionSpend) {
        combineSpend(total, error);
        error.extractionSpend = total;
      }
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
