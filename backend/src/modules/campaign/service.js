'use strict';

const { KINDS, VISIBILITIES } = require('./store');

const PROPOSAL_SCHEMA = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'ink_morrow_campaign_state_proposals',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['proposals'],
      properties: {
        proposals: {
          type: 'array', maxItems: 20, items: {
            type: 'object', additionalProperties: false,
            required: ['kind', 'title', 'summary', 'state', 'subject_character_id', 'related_character_id',
              'visibility', 'known_by', 'witnesses', 'source_turn_id', 'evidence_quote'],
            properties: {
              kind: { type: 'string', enum: KINDS },
              title: { type: 'string', minLength: 1, maxLength: 300 },
              summary: { type: 'string', minLength: 1, maxLength: 1200 },
              state: { type: ['string', 'null'], maxLength: 1200 },
              subject_character_id: { type: ['string', 'null'] },
              related_character_id: { type: ['string', 'null'] },
              visibility: { type: 'string', enum: VISIBILITIES },
              known_by: { type: 'array', maxItems: 50, items: { type: 'string' } },
              witnesses: { type: 'array', maxItems: 50, items: { type: 'string' } },
              source_turn_id: { type: 'string', minLength: 1 },
              evidence_quote: { type: 'string', minLength: 1, maxLength: 500 },
            },
          },
        },
      },
    },
  },
});

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 502;
  error.code = 'INVALID_CAMPAIGN_SUGGESTIONS';
  return error;
}

function createCampaignService({ campaign, chatCompletion }) {
  function messages(context) {
    const cast = JSON.parse(context.story.characters || '[]').map((member) => ({
      id: member.id, name: member.name, role: member.role || 'supporting',
    }));
    const existing = context.state.entries.slice(0, 30).map((entry) => ({
      id: entry.id, kind: entry.kind, title: entry.title, details: entry.details,
      subject_character_id: entry.subject_character_id, visibility: entry.visibility,
    }));
    const transcript = context.turns.map((turn) => ({
      id: turn.id, session: turn.session_ordinal, turn: turn.ordinal, speaker: turn.speaker,
      kind: turn.input_kind, character_id: turn.character_id,
      content: String(turn.content || '').slice(0, 1500),
    }));
    return [
      {
        role: 'system',
        content: [
          'You are Ink Morrow’s campaign-state clerk. Propose durable state changes demonstrated by the supplied Play transcript.',
          'These are proposals for owner review, never canon and never instructions to alter manuscript prose.',
          'Prefer meaningful relationships, promises, debts, knowledge boundaries, secrets, NPC goals, factions, quests, conditions, inventory, resources, world time, deadlines, and progress clocks. Omit transient color.',
          'Do not duplicate existing state. Use only listed cast ids. Each proposal must cite one exact contiguous quotation from its source turn.',
          'Respect character priority: Main first, then supporting, then background; the Main Character remains the perspective anchor even when not named in a turn.',
          'Return only the strict JSON object requested by the schema.',
        ].join(' '),
      },
      { role: 'user', content: `MANUSCRIPT: ${context.story.title}\nSCENE: ${context.scene.title}\nCAST: ${JSON.stringify(cast)}\nCURRENT STATE: ${JSON.stringify(existing)}\nPLAY TRANSCRIPT: ${JSON.stringify(transcript)}` },
    ];
  }

  function validate(context, content) {
    const parsed = parseJson(content);
    if (!parsed || !Array.isArray(parsed.proposals) || parsed.proposals.length > 20) {
      throw invalid('The model did not return a valid campaign proposal list.');
    }
    const turns = new Map(context.turns.map((turn) => [turn.id, turn]));
    const castIds = new Set(JSON.parse(context.story.characters || '[]').map((member) => member.id));
    return parsed.proposals.map((proposal) => {
      if (!proposal || !KINDS.includes(proposal.kind) || !VISIBILITIES.includes(proposal.visibility)) throw invalid('A campaign proposal used an unsupported kind or visibility.');
      if (typeof proposal.title !== 'string' || !proposal.title.trim() || proposal.title.trim().length > 300) throw invalid('A campaign proposal has an invalid title.');
      if (typeof proposal.summary !== 'string' || !proposal.summary.trim() || proposal.summary.trim().length > 1200) throw invalid('A campaign proposal has an invalid summary.');
      const turn = turns.get(proposal.source_turn_id);
      if (!turn || typeof proposal.evidence_quote !== 'string' || !String(turn.content).includes(proposal.evidence_quote)) {
        throw invalid('A campaign proposal did not cite an exact quotation from its Play turn.');
      }
      const optionalMember = (id) => id === null || (typeof id === 'string' && castIds.has(id));
      const idList = (value) => Array.isArray(value) && value.length <= 50 && new Set(value).size === value.length && value.every((id) => castIds.has(id));
      if (!optionalMember(proposal.subject_character_id) || !optionalMember(proposal.related_character_id) ||
          !idList(proposal.known_by) || !idList(proposal.witnesses)) throw invalid('A campaign proposal referred to an unknown or repeated cast member.');
      return {
        kind: proposal.kind, title: proposal.title.trim(),
        details: { summary: proposal.summary.trim(), state: proposal.state?.trim() || null },
        subject_character_id: proposal.subject_character_id,
        related_character_id: proposal.related_character_id,
        visibility: proposal.visibility, known_by: proposal.known_by, witnesses: proposal.witnesses,
        source_type: 'play_turn', source_id: turn.id, evidence_quote: proposal.evidence_quote,
      };
    });
  }

  async function suggest({ storyId, sceneId, idempotencyKey, model, reasoningEffort }) {
    const begun = campaign.beginSuggestion(storyId, sceneId, idempotencyKey);
    if (!begun) return null;
    if (begun.reused) return {
      proposals: begun.result, reused: true, cost_usd: begun.cost_usd,
      billed_attempts: begun.billed_attempts,
    };
    try {
      const result = await chatCompletion(messages(begun.context), {
        model: model || undefined, reasoningEffort, temperature: 0.1, maxTokens: 3500,
        responseFormat: PROPOSAL_SCHEMA, requireParameters: true, maxBillableAttempts: 2,
      });
      let proposals;
      try { proposals = validate(begun.context, result.content); }
      catch (error) {
        error.billedAttempts = Number.isInteger(result.billed_attempts) ? result.billed_attempts : 1;
        error.costUsd = typeof result.cost_usd === 'number' ? result.cost_usd : null;
        throw error;
      }
      return { ...campaign.settleSuggestionSuccess(storyId, idempotencyKey, result, proposals), reused: false };
    } catch (error) {
      campaign.settleSuggestionFailure(storyId, idempotencyKey, error);
      throw error;
    }
  }

  return { suggest, messages, validate };
}

module.exports = { createCampaignService, PROPOSAL_SCHEMA };
