'use strict';

const { randomUUID } = require('node:crypto');
const { LIMITS, fail, keys, text, validateIntent, applyEffects } = require('./model');
const { chooseScene, recordScene } = require('./director');
const { adjudicate } = require('./resistance');
const { fourthWallContext, validateAside } = require('./fourth-wall');

function contextFacts(state, direction) {
  const words = new Set(direction.toLowerCase().match(/[\p{L}]{3,}/gu) || []);
  return state.facts.map((fact, index) => ({ fact, index, score:
    (fact.status === 'active' ? 4 : 0) + (['commitment', 'goal'].includes(fact.kind) ? 3 : 0) +
    (fact.visibility === 'secret' ? 2 : 0) +
    [...words].filter((word) => fact.text.toLowerCase().includes(word)).length * 3,
  })).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 32).map(({ fact }) => fact);
}

function createFictionService({ store, chatCompletion, providers = null }) {
  function buildMessages(context, intent, plan = chooseScene(context.game, context.state, intent), decision = null) {
    const { game, branch, state } = context;
    const recent = store.historyRows(game.id, branch.head_beat_id, 12).map((row) => ({ kind: row.kind, prose: row.prose.slice(-1500), summary: row.summary }));
    return [
      { role: 'system', content: [
        'You narrate InkMorrow playable fiction. The user is normally a reader-director OUTSIDE the cast, never an assumed protagonist or avatar.',
        'Follow develops the cast naturally. Steer is an editorial request, not an in-world action. Act/Say expresses only the explicitly inhabited character\'s intent. Ask is out-of-story clarification: do not advance time or state.',
        'A moment-scoped direction applies to this response only and takes priority over ongoing focus here. An ongoing direction replaces focus after a successful response. Do not treat earlier one-moment directions in history as permanent instructions.',
        'When a character is inhabited, never invent their decisions, speech, thoughts, commitments or completed actions. Continue may develop the surroundings and other people, then stop before a decision belonging to that character. Resolve only actions explicitly supplied by the user.',
        'Respect content boundaries. Maintain independent motives and established facts. Quiet expression needs a fitting response, not arbitrary permanent consequences. Plans and possibilities are not completed events. Do not force quests, danger, cliffhangers or a question at the end of every passage.',
        'In story-shaping, honour the requested development within continuity and character ownership. In living-world, honour the intent but not a demanded outcome: motives, knowledge, relationships and circumstances determine credible cooperation or refusal. Repetition alone is not new leverage; genuinely sufficient evidence may change a decision. Neither style requires conflict or an avatar.',
        'Fourth-wall permission concerns CHARACTERS knowingly addressing the real reader, not ordinary in-world dialogue. Never: keep characters inside the fiction. Rarely: an occasional fitting aside, only when fourth_wall.allowed is true. Freely: such asides are welcome when fitting, never compulsory. Story-shaping and Ask never use character asides. Ordinary second-person dialogue between cast members is not a fourth-wall break.',
        'Only when fourth_wall.allowed is true may you optionally add aside:{character_id,text}, using an eligible character and at most 600 characters. Otherwise omit aside or use null. Put the entire direct address in aside, never smuggle it into prose or summary. The application labels and appends it to the passage. Do not speak for an inhabited character, the user, or an assumed avatar. An aside cannot reveal undiscovered secrets, change world truth or knowledge, grant a challenge, pressure the user to keep playing or spend money, or weaken a refusal. Earlier text labelled a character speaking “to you” is a fourth-wall aside, not new in-world knowledge. Effects and resolution evidence must come from ordinary prose or authorised input, never from an aside.',
        'Structured challenges and adjudications are application-owned. Never grant a challenge through ordinary prose, an effect, invented permission or a claimed prior agreement. With no adjudication, leave its disputed outcome open and invite its explicit approach controls when relevant. If adjudication is supplied, narrate exactly that outcome, without contradicting its explanation; add resolution with exactly outcome and evidence, where evidence quotes this response. Do not alter requirements. A refusal is not a reason for arbitrary punishment.',
        'Secret facts are world truth, not reader or character knowledge. Do not disclose them in prose or summary unless the scene actually reveals them and a reveal effect records the discovery. Never change a secret to defeat a correct deduction. Characters may use only what they know.',
        'History marked clarification is out-of-story discussion, never an event that happened. Do not use a clarification to expose hidden truths the reader has not discovered.',
        'Return a JSON object with prose (readable story text), summary (one reader-safe sentence), and effects (array, empty when nothing durable changes), plus the optional aside described above. Only when adjudication is supplied, also include resolution as specified above; otherwise no other fields. No Markdown fences. Aim for 120–220 words of prose, or 80–140 when brisk; at most four concise effects normally. Finish the complete JSON within the output budget.',
        'Effects: remember uses {op:"remember",fact:{id,kind,text,visibility,known_by,status,actor_id,value},evidence}; resolve uses {op:"resolve",id,evidence}; reveal uses {op:"reveal",id,known_by,evidence}; adjust uses {op:"adjust",id,amount,evidence}.',
        'Fact kind is fact|commitment|relationship|goal|resource; visibility public|secret; status active|resolved; actor_id is a cast ID or null; value is numeric for resources, otherwise null. known_by contains cast IDs. IDs are short alphanumeric identifiers with hyphens or underscores.',
        'Every effect evidence must be an exact quotation from this response\'s prose or the user\'s input. Remember creates a NEW fact ID and cannot rewrite existing truth. Do not invent commitments for an inhabited character. Never emit control or episode changes.',
        'A genuinely new person appearing by name may use {op:"introduce",character:{id,name,description,motive},evidence}. Reuse existing people; never duplicate names. Describe only reader-visible traits, keep private motives in motive. Introduction never hands control to the user.',
        'The scene_plan is a provisional opportunity, not an event that has happened. Its target facts should causally shape this beat when appropriate. Respect the user direction and owned-character boundary over the suggested pattern. Narration voice changes style, not authority. The remaining_fact_slots limit is per response, not a lifetime story limit.',
        'The application owns accounting and any random resolution. Do not pretend to have rolled dice. Produce a complete, satisfying beat rather than a fixed page count.',
      ].join('\n') },
      { role: 'user', content: JSON.stringify({
        story: { title: game.title, premise: game.premise, genre: game.genre },
        cast: state.cast.map((character) => ({ ...character, description: character.description.slice(0, 600), motive: character.motive.slice(0, 400) })),
        control: state.control, boundaries: state.boundaries, pacing: state.pacing, consequences: state.consequences,
        play_style: state.play_style || 'story-shaping', challenges: state.challenges || [], adjudications: state.adjudications || [], adjudication: decision,
        fourth_wall: fourthWallContext(state, intent),
        episode: state.episode, focus: state.focus, narration_voice: state.voice || '',
        facts: [...new Map([...state.facts.filter((fact) => plan.fact_ids.includes(fact.id)),
          ...store.memory.facts(game.id, branch.head_beat_id, { query: `${intent.text} ${state.focus}` }),
          ...contextFacts(state, `${intent.text} ${state.focus}`)].map((fact) => [fact.id, fact])).values()].slice(0, 32),
        remaining_fact_slots: 12, remaining_cast_slots: LIMITS.cast - state.cast.length,
        scene_plan: plan, recent, input: intent,
      }) },
    ];
  }

  async function reply({ gameId, expectedRevision, idempotencyKey, input, model, reasoningEffort, providerId = null }) {
    const started = store.beginRequest(gameId, expectedRevision, idempotencyKey, { input, model: model ?? null, reasoningEffort: reasoningEffort ?? null, providerId });
    if (started.reused) return { ...store.requestResult(started.request), story: store.view(gameId), reused: true };
    const { request, context } = started;
    let usage = { costUsd: null, billedAttempts: 0, model: model ?? null };
    try {
      const intent = validateIntent(input, context.state);
      const lookup = (id, includeRemoved = false) => store.memory.get(gameId, context.branch.head_beat_id, id, includeRemoved);
      const decision = adjudicate(context.state, intent, lookup, fail);
      const previous = decision && (context.state.adjudications || []).find((entry) => entry.challenge_id === decision.challenge_id);
      if (decision && previous?.basis === decision.basis) {
        const beatId = store.completeRequest(request, { kind: 'clarification', prose: `The circumstances have not changed. ${previous.explanation}`, summary: 'The previous adjudication still applies. No AI request was made.', input: intent, state: context.state }, { costUsd: 0, billedAttempts: 0 });
        return { story: store.view(gameId), beat_id: beatId, cost_usd: 0, billed_attempts: 0, reused: false, repeated_adjudication: true };
      }
      if (providerId && providers) {
        const selected = providers.exposure('scribe');
        if (selected.provider?.id !== providerId || selected.model_id !== model) fail('The storyteller configuration changed. Refresh and review the new provider before continuing.', 'STORY_PROVIDER_CHANGED', 409);
      }
      const plan = chooseScene(context.game, context.state, intent);
      const messages = buildMessages(context, intent, plan, decision);
      // Once dispatch may occur, a lost response or process crash means cost is
      // unknown, not zero. There is no transport retry for this single purchase.
      store.dispatchRequest(request.id, model); usage.billedAttempts = 1;
      const result = await chatCompletion(messages, {
        model: model || undefined, reasoningEffort, temperature: 0.8,
        maxTokens: context.state.pacing === 'reflective' ? 2400 : context.state.pacing === 'brisk' ? 1400 : 1900,
        responseFormat: { type: 'json_object' }, maxBillableAttempts: 1, maxAttempts: 1,
      });
      usage = { model: result.model || model || null, costUsd: result.cost_usd ?? null, billedAttempts: result.billed_attempts ?? 1 };
      let parsed;
      try { parsed = JSON.parse(result.content); }
      catch { fail('The narrator returned an unreadable story response. Nothing was added.', 'INVALID_STORY_REPLY', 502); }
      keys(parsed, ['prose', 'summary', 'effects', 'aside', ...(decision ? ['resolution'] : [])], 'Narrator response');
      const prose = text(parsed.prose, 'Story prose', LIMITS.prose);
      const summary = text(parsed.summary, 'Story summary', 1000);
      const aside = validateAside(parsed.aside, context.state, intent, { keys, text, fail });
      const savedProse = aside ? `${prose}\n\n${aside.character.name}, to you: “${aside.text}”` : prose;
      if (savedProse.length > LIMITS.prose) fail('The passage and fourth-wall address exceed the story limit.', 'INVALID_STORY_REPLY', 502);
      if (decision) {
        keys(parsed.resolution, ['outcome', 'evidence'], 'Resolution');
        const evidence = text(parsed.resolution.evidence, 'Resolution evidence', 1000);
        if (parsed.resolution.outcome !== decision.outcome || !prose.includes(evidence)) fail('The narrator did not honour the adjudicated outcome. Nothing was added.', 'INVALID_STORY_RESOLUTION', 502);
      }
      if (intent.kind === 'ask' && (!Array.isArray(parsed.effects) || parsed.effects.length)) fail('A clarification cannot advance story state.', 'INVALID_STORY_REPLY', 502);
      const beatId = randomUUID();
      const { state, changes } = applyEffects(context.state, parsed.effects, { prose, input: intent, beatId, lookup });
      if (decision) state.adjudications = [...(state.adjudications || []).filter((entry) => entry.challenge_id !== decision.challenge_id), { ...decision, beat_id: beatId }];
      if (intent.kind === 'steer' && intent.direction_scope === 'ongoing') state.focus = intent.text.slice(0, 1500);
      recordScene(state, plan, beatId);
      if (aside) state.last_fourth_wall_scene = state.scene_count;
      const committedId = store.completeRequest(request, { id: beatId, kind: intent.kind === 'ask' ? 'clarification' : 'scene', prose: savedProse, summary, input: intent, state, changes }, usage);
      return { story: store.view(gameId), beat_id: committedId, cost_usd: usage.costUsd, billed_attempts: usage.billedAttempts, model: usage.model, reused: false };
    } catch (error) {
      if (Number.isInteger(error.billedAttempts)) usage = { ...usage, billedAttempts: error.billedAttempts, costUsd: error.costUsd ?? null };
      // Provider output validation is a bad upstream response, not a user's
      // input mistake. Preserve the actual known charge even when no beat saves.
      if (usage.billedAttempts && error.statusCode === 400) { error.statusCode = 502; error.code = 'INVALID_STORY_REPLY'; }
      store.failRequest(request.id, error.code || 'STORY_REQUEST_FAILED', usage);
      error.billedAttempts = usage.billedAttempts;
      error.costUsd = usage.costUsd;
      throw error;
    }
  }
  function reviewChallenge(gameId, expectedRevision, input) {
    const context = store.current(gameId);
    if (context.game.revision !== expectedRevision) fail('The story changed. Refresh before reviewing this approach.', 'STORY_CHANGED', 409);
    const intent = validateIntent(input, context.state);
    const decision = adjudicate(context.state, intent, (id) => store.memory.get(gameId, context.branch.head_beat_id, id), fail);
    if (!decision) fail('Choose a structured challenge.');
    const previous = context.state.adjudications.find((entry) => entry.challenge_id === decision.challenge_id);
    const repeated = previous?.basis === decision.basis;
    return { requires_generation: !repeated, explanation: repeated ? previous.explanation : null, revision: expectedRevision };
  }
  return { reply, buildMessages, reviewChallenge };
}

module.exports = { createFictionService, contextFacts };
