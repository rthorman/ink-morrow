'use strict';

function clipped(value, limit) {
  const text = String(value || '').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function contractInstructions(session) {
  const controlled = (controller) => session.participants
    .filter((participant) => participant.controller === controller)
    .map((participant) => `${participant.name} (${participant.role})`)
    .join(', ') || 'none';
  return [
    `Owner-controlled participants: ${controlled('owner')}.`,
    `Scribe-controlled participants: ${controlled('scribe')}.`,
    `Shared-control participants: ${controlled('shared')}.`,
    `Scribe initiative: ${session.scribe_initiative}. Challenge: ${session.challenge}. Pacing: ${session.pacing}.`,
    `Consequences: ${session.consequences}. Character death explicitly allowed: ${session.allow_character_death ? 'yes' : 'NO'}.`,
    `Suggestions: ${session.suggestions}. Player interiority: ${session.player_interiority}.`,
    session.notes ? `Additional table contract: ${session.notes}` : '',
  ].filter(Boolean).join('\n');
}

function createPlayService({ store, stories, continuity, chatCompletion }) {
  function buildMessages(story, session, ownerTurn) {
    const recentPages = stories.storyPages(story.id).slice(-3);
    const memory = continuity.contextForPrompt(story, {
      userInput: ownerTurn.content,
      recentPageIds: recentPages.map((page) => page.id),
    });
    const characterContext = (memory.characters || []).map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      description: clipped(character.description, 800),
      personality: clipped(character.personality, 800),
      current_state: character.state || null,
    }));
    const turns = store.listTurns(session.id).slice(-24).map((turn) => ({
      ordinal: turn.ordinal,
      speaker: turn.speaker,
      kind: turn.input_kind,
      character_id: turn.character_id,
      content: clipped(turn.content, 1500),
    }));
    const scribe = stories.storyWithMeta(story).scribe;
    const scribeCraft = scribe ? {
      name: scribe.name,
      personality: clipped(scribe.personality, 700),
      diction: scribe.diction,
      sentence_rhythm: scribe.sentence_rhythm,
      narrative_distance: scribe.narrative_distance,
      figurative_language: scribe.figurative_language,
      description_density: scribe.description_density,
      dialogue_tendency: scribe.dialogue_tendency,
      humor: scribe.humor,
      scene_tempo: scribe.scene_tempo,
      progress_appetite: scribe.progress_appetite,
      tension_tolerance: scribe.tension_tolerance,
      aftermath_dwell: scribe.aftermath_dwell,
      focus_areas: scribe.focus_areas,
      signature_habits: clipped(scribe.signature_habits, 700),
      avoidances: clipped(scribe.avoidances, 700),
    } : null;
    return [
      {
        role: 'system',
        content: [
          'You are the Scribe facilitating an opt-in single-owner textual roleplay scene inside Ink Morrow.',
          'Continue the immediate situation with concrete sensory action, NPC behavior, and consequences. Do not summarize an unwritten future and do not turn this into polished manuscript prose.',
          'CONTROL IS ABSOLUTE: never decide, speak for, think for, or complete an action for an owner-controlled participant. For shared participants you may offer limited reactions or openings but must leave consequential choices to the owner. You may fully portray Scribe-controlled participants.',
          'Respect the declared consequence and death permissions. If death is not allowed, do not kill any established character. Respect the suggestion setting; when suggestions are off, do not append choices or advice.',
          'Treat Act and Say as in-world input. Treat Ask as a direct out-of-character question and answer it plainly without advancing time unless needed. Treat Direct as owner guidance for framing and facilitation.',
          'Answer only with the next Scribe turn. Never claim to roll dice or invent a random result; deterministic tools are recorded separately.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `MANUSCRIPT: ${story.title}`,
          `SCENE: ${session.scene.title}`,
          `SCENE FRAME: ${JSON.stringify({
            mode: session.scene.mode,
            location: session.scene.location,
            story_time: session.scene.story_time,
            purpose: session.scene.purpose,
            stakes: session.scene.stakes,
          })}`,
          `SESSION ZERO CONTRACT:\n${contractInstructions(session)}`,
          memory.world ? `WORLD:\n${JSON.stringify({
            name: memory.world.name,
            description: clipped(memory.world.description, 1800),
            genre: memory.world.genre,
            setting: memory.world.setting,
            lore: clipped(memory.world.lore, 1800),
          })}` : '',
          `CAST AND CURRENT STATE:\n${JSON.stringify(characterContext)}`,
          memory.relevant?.length
            ? `RELEVANT REMEMBERED CANON:\n${clipped(JSON.stringify(memory.relevant), 8000)}`
            : '',
          recentPages.length ? `RECENT MANUSCRIPT EXCERPTS (context only; do not rewrite):\n${recentPages.map((page) => clipped(page.content, 1600)).join('\n---\n')}` : '',
          scribeCraft ? `BOUND SCRIBE CRAFT PROFILE:\n${JSON.stringify(scribeCraft)}` : '',
          `SESSION TRANSCRIPT:\n${JSON.stringify(turns)}`,
          `Respond now to owner turn ${ownerTurn.ordinal} (${ownerTurn.input_kind}).`,
        ].filter(Boolean).join('\n\n'),
      },
    ];
  }

  async function reply({ storyId, sessionId, turn, idempotencyKey, model, reasoningEffort }) {
    const story = stories.getStory(storyId);
    if (!story) return null;
    const begun = store.beginAiRequest(storyId, sessionId, turn, idempotencyKey);
    if (!begun) return null;
    if (begun.reused) {
      return {
        owner_turn: begun.ownerTurn,
        response_turn: begun.responseTurn,
        reused: true,
        cost_usd: begun.responseTurn?.cost_usd ?? null,
      };
    }
    const session = store.get(storyId, sessionId);
    try {
      const result = await chatCompletion(buildMessages(story, session, begun.ownerTurn), {
        model: model || undefined,
        reasoningEffort,
        temperature: session.challenge === 'harsh' ? 0.9 : 0.8,
        maxTokens: session.pacing === 'reflective' ? 1000 : session.pacing === 'brisk' ? 550 : 750,
        quality: { minWords: 3 },
        maxBillableAttempts: 2,
      });
      let settled;
      try {
        settled = store.settleAiSuccess(storyId, sessionId, idempotencyKey, result);
      } catch (error) {
        error.billedAttempts = Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1;
        error.costUsd = typeof result.cost_usd === 'number' ? result.cost_usd : null;
        throw error;
      }
      return {
        ...settled,
        reused: false,
        cost_usd: typeof result.cost_usd === 'number' ? result.cost_usd : null,
        billed_attempts: Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1,
      };
    } catch (error) {
      store.settleAiFailure(sessionId, idempotencyKey, error);
      throw error;
    }
  }

  return { reply, buildMessages };
}

module.exports = { createPlayService, contractInstructions };
