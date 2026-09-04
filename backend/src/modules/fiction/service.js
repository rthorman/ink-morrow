'use strict';

const { randomUUID } = require('node:crypto');
const { LIMITS, fail, keys, text, validateIntent, applyEffects } = require('./model');

function contextFacts(state, direction) {
  const words = new Set(direction.toLowerCase().match(/[\p{L}]{3,}/gu) || []);
  return state.facts.map((fact, index) => ({ fact, index, score:
    (fact.status === 'active' ? 4 : 0) + (['commitment', 'goal'].includes(fact.kind) ? 3 : 0) +
    (fact.visibility === 'secret' ? 2 : 0) +
    [...words].filter((word) => fact.text.toLowerCase().includes(word)).length * 3,
  })).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 32).map(({ fact }) => fact);
}

function createFictionService({ store, chatCompletion }) {
  function buildMessages(context, intent) {
    const { game, branch, state } = context;
    const recent = store.historyRows(game.id, branch.head_beat_id, 12).map((row) => ({ kind: row.kind, prose: row.prose.slice(-1500), summary: row.summary }));
    return [
      { role: 'system', content: [
        'You narrate InkMorrow playable fiction. The user is normally a reader-director OUTSIDE the cast, never an assumed protagonist or avatar.',
        'Follow develops the cast naturally. Steer is an editorial request, not an in-world action. Act/Say expresses only the explicitly inhabited character\'s intent. Ask is out-of-story clarification: do not advance time or state.',
        'When a character is inhabited, never invent their decisions, speech, thoughts, commitments or completed actions. Continue may develop the surroundings and other people, then stop before a decision belonging to that character. Resolve only actions explicitly supplied by the user.',
        'Respect content boundaries. Maintain independent motives and established facts. Quiet expression needs a fitting response, not arbitrary permanent consequences. Plans and possibilities are not completed events. Do not force quests, danger, cliffhangers or a question at the end of every passage.',
        'Secret facts are world truth, not reader or character knowledge. Do not disclose them in prose or summary unless the scene actually reveals them and a reveal effect records the discovery. Never change a secret to defeat a correct deduction. Characters may use only what they know.',
        'History marked clarification is out-of-story discussion, never an event that happened. Do not use a clarification to expose hidden truths the reader has not discovered.',
        'Return a JSON object with exactly prose (readable story text), summary (brief reader-safe recap), and effects (array, empty when nothing durable changes). No Markdown fences.',
        'Effects: remember uses {op:"remember",fact:{id,kind,text,visibility,known_by,status,actor_id,value},evidence}; resolve uses {op:"resolve",id,evidence}; reveal uses {op:"reveal",id,known_by,evidence}; adjust uses {op:"adjust",id,amount,evidence}.',
        'Fact kind is fact|commitment|relationship|goal|resource; visibility public|secret; status active|resolved; actor_id is a cast ID or null; value is numeric for resources, otherwise null. known_by contains cast IDs. IDs are short alphanumeric identifiers with hyphens or underscores.',
        'Every effect evidence must be an exact quotation from this response\'s prose or the user\'s input. Remember creates a NEW fact ID and cannot rewrite existing truth. Do not invent commitments for an inhabited character. Use no more than twelve effects. Never emit control, cast, or episode changes.',
        'The application owns accounting and any random resolution. Do not pretend to have rolled dice. Produce a complete, satisfying beat rather than a fixed page count.',
      ].join('\n') },
      { role: 'user', content: JSON.stringify({
        story: { title: game.title, premise: game.premise, genre: game.genre },
        cast: state.cast.map((character) => ({ ...character, description: character.description.slice(0, 600), motive: character.motive.slice(0, 400) })),
        control: state.control, boundaries: state.boundaries, pacing: state.pacing, consequences: state.consequences,
        episode: state.episode, focus: state.focus, facts: contextFacts(state, intent.text), recent, input: intent,
      }) },
    ];
  }

  async function reply({ gameId, expectedRevision, idempotencyKey, input, model, reasoningEffort }) {
    const started = store.beginRequest(gameId, expectedRevision, idempotencyKey, { input, model: model ?? null, reasoningEffort: reasoningEffort ?? null });
    if (started.reused) return { ...store.requestResult(started.request), story: store.view(gameId), reused: true };
    const { request, context } = started;
    let usage = { costUsd: null, billedAttempts: 0, model: model ?? null };
    try {
      const intent = validateIntent(input, context.state);
      const result = await chatCompletion(buildMessages(context, intent), {
        model: model || undefined, reasoningEffort, temperature: 0.8,
        maxTokens: context.state.pacing === 'reflective' ? 2400 : context.state.pacing === 'brisk' ? 1400 : 1900,
        responseFormat: { type: 'json_object' }, maxBillableAttempts: 1,
      });
      usage = { model: result.model || model || null, costUsd: result.cost_usd ?? null, billedAttempts: result.billed_attempts ?? 1 };
      let parsed;
      try { parsed = JSON.parse(result.content); }
      catch { fail('The narrator returned an unreadable story response. Nothing was added.', 'INVALID_STORY_REPLY', 502); }
      keys(parsed, ['prose', 'summary', 'effects'], 'Narrator response');
      const prose = text(parsed.prose, 'Story prose', LIMITS.prose);
      const summary = text(parsed.summary, 'Story summary', 1000);
      if (intent.kind === 'ask' && (!Array.isArray(parsed.effects) || parsed.effects.length)) fail('A clarification cannot advance story state.', 'INVALID_STORY_REPLY', 502);
      const beatId = randomUUID();
      const { state, changes } = applyEffects(context.state, parsed.effects, { prose, input: intent, beatId });
      if (intent.kind === 'steer') state.focus = intent.text.slice(0, 1500);
      const committedId = store.completeRequest(request, { id: beatId, kind: intent.kind === 'ask' ? 'clarification' : 'scene', prose, summary, input: intent, state, changes }, usage);
      return { story: store.view(gameId), beat_id: committedId, cost_usd: usage.costUsd, billed_attempts: usage.billedAttempts, model: usage.model, reused: false };
    } catch (error) {
      if (error.billedAttempts) usage = { ...usage, billedAttempts: error.billedAttempts, costUsd: error.costUsd ?? null };
      // Provider output validation is a bad upstream response, not a user's
      // input mistake. Preserve the actual known charge even when no beat saves.
      if (usage.billedAttempts && error.statusCode === 400) { error.statusCode = 502; error.code = 'INVALID_STORY_REPLY'; }
      store.failRequest(request.id, error.code || 'STORY_REQUEST_FAILED', usage);
      error.billedAttempts = usage.billedAttempts;
      error.costUsd = usage.costUsd;
      throw error;
    }
  }
  return { reply, buildMessages };
}

module.exports = { createFictionService, contextFacts };
