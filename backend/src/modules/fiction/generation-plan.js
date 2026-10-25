'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./model');
const { configuration, defaults, bounded } = require('./creative-model');
const { inputBound } = require('./context-compiler');
const { digest } = require('./drafts');
const { qualityPlan } = require('./quality-plan');
const { reviewRoles } = require('./quality');
function createGenerationPlans({ db, providers }) {
  function capacity(role, model) {
    if (!db)
      return {
        context_tokens: 2000000,
        output_tokens: 16000,
        source: 'injected test transport',
      };
    const configured = providers?.resolve(role, {
      capability: 'chat',
      model,
      credentialOptional: true,
    });
    const limits = configured?.modelLimits;
    if (!limits)
      fail(
        `The ${role === 'archivist' ? 'memory-support' : 'storyteller'} model capacity is unknown. Discover its catalogue or declare its context/output limits in Settings; local reading and editing remain available.`,
        'MODEL_CAPACITY_UNKNOWN',
        409,
      );
    return limits;
  }
  function build(
    context,
    intent,
    messages,
    { model, reasoningEffort, providerId = null } = {},
  ) {
    const payload = JSON.parse(messages.at(-1).content);
    const creative = configuration(
      payload.creative_settings ||
        context.state.creative_baseline ||
        defaults(context.state.version !== 2),
      context.state.cast.map((person) => person.id),
    );
    const purchase = qualityPlan(context.state, providers);
    let bytes = inputBound(messages);
    const candidateBytes = Math.min(
      48000,
      Math.max(12000, creative.length.target * 24 + 8000),
    );
    const reviewCandidateBytes =
      candidateBytes +
      Buffer.byteLength(JSON.stringify(intent.text), 'utf8') * 2 +
      4096;
    const output = Math.min(
      16000,
      Math.max(
        reasoningEffort && reasoningEffort !== 'none' ? 6000 : 2400,
        creative.length.target * 8 + 1600,
      ),
    );
    const selectedCapacity = (role) =>
      capacity(
        role,
        role === 'scribe'
          ? model || purchase.roles.find((item) => item.role === role).model_id
          : purchase.roles.find((item) => item.role === role).model_id,
      );
    const draftCapacity = selectedCapacity('scribe');
    const roles = reviewRoles(purchase.mode);
    let inputCeiling = draftCapacity.context_tokens - output;
    for (const role of roles)
      inputCeiling = Math.min(
        inputCeiling,
        selectedCapacity(role).context_tokens -
          5000 -
          reviewCandidateBytes * 2 -
          2048,
      );
    if (roles.length)
      inputCeiling = Math.min(
        inputCeiling,
        draftCapacity.context_tokens -
          output -
          candidateBytes * 4 -
          reviewCandidateBytes * 2 -
          40000 -
          2048,
      );
    // Remove complete oldest passages only. Ownership, selected constraints and
    // the latest narrative passage survive even when that means refusing a call.
    while (bytes > inputCeiling && payload.recent.length > 1) {
      payload.recent.shift();
      messages[messages.length - 1] = {
        ...messages.at(-1),
        content: JSON.stringify(payload),
      };
      bytes = inputBound(messages);
    }
    const stages = [];
    const add = (role, purpose, input, requestedOutput) => {
      const selected = purchase.roles.find((item) => item.role === role);
      const selectedModel =
        role === 'scribe' ? model || selected.model_id : selected.model_id;
      const limit = capacity(role, selectedModel);
      if (
        requestedOutput > limit.output_tokens ||
        input + requestedOutput > limit.context_tokens
      )
        fail(
          `The ${purpose} stage does not fit the ${role === 'scribe' ? 'storyteller' : 'memory-support'} model. Choose a shorter passage, a larger-capacity model, or turn optional quality off. No request was purchased.`,
          'STORY_CONTEXT_TOO_LARGE',
          409,
        );
      stages.push({
        role,
        purpose,
        model_id: selectedModel || null,
        input_bound: input,
        output_tokens: requestedOutput,
        context_tokens: limit.context_tokens,
        model_output_tokens: limit.output_tokens,
        capacity_source: limit.source,
      });
    };
    add('scribe', 'draft', bytes, output);
    if (roles.length) {
      for (const role of roles)
        add(role, 'review', bytes + reviewCandidateBytes * 2 + 2048, 5000);
      add(
        'scribe',
        'repair',
        bytes + candidateBytes * 4 + reviewCandidateBytes * 2 + 40000 + 2048,
        output,
      );
    }
    const consent = digest({
      version: 1,
      purchase: purchase.review_id,
      stages: stages.map(
        ({
          role,
          purpose,
          model_id,
          output_tokens,
          context_tokens,
          model_output_tokens,
          capacity_source,
        }) => ({
          role,
          purpose,
          model_id,
          output_tokens,
          context_tokens,
          model_output_tokens,
          capacity_source,
        }),
      ),
      reference_ids: Object.values(context.state.reference_heads || {}),
      length: creative.length,
      reasoning: reasoningEffort || null,
      exposure:
        'private branch truth, selected references, cast, boundaries, relevant history and current contribution',
    });
    return bounded(
      {
        version: 1,
        game_id: context.game.id,
        branch_id: context.branch.id,
        head_id: context.branch.head_beat_id,
        revision: context.game.revision,
        configuration_id: context.state.config_revision_id || null,
        reference_ids: Object.values(context.state.reference_heads || {}),
        intent_hash: digest(intent),
        message_hash: digest(messages),
        provider_id: providerId,
        reasoning: reasoningEffort || null,
        quality_review: purchase.review_id,
        consent_id: consent,
        max_calls: purchase.max_calls,
        max_candidate_bytes: candidateBytes,
        manifest: {
          version: 1,
          branch_id: context.branch.id,
          head_id: context.branch.head_beat_id,
          fact_ids: payload.facts.map((fact) => fact.id),
          recent_ids: payload.recent.map((row) => row.beat_id),
          category_bytes: Object.fromEntries(
            Object.entries(payload).map(([name, value]) => [
              name,
              Buffer.byteLength(JSON.stringify(value), 'utf8'),
            ]),
          ),
        },
        stages,
      },
      32768,
      'Narration plan',
    );
  }
  function prepare(plan) {
    if (!db) return { ...plan, id: 'injected-plan', expires_in_seconds: 600 };
    db.prepare(
      'DELETE FROM fiction_operation_plans WHERE request_id IS NULL AND expires_at<?',
    ).run(Date.now());
    if (
      db
        .prepare(
          'SELECT count(*) AS n FROM fiction_operation_plans WHERE game_id=? AND request_id IS NULL',
        )
        .get(plan.game_id).n >= 100
    )
      fail(
        'Too many unsubmitted plans. Wait for an older plan to expire.',
        'STORY_PLAN_LIMIT',
        429,
      );
    const id = randomUUID();
    db.prepare(
      'INSERT INTO fiction_operation_plans(id,game_id,plan_json,expires_at) VALUES(?,?,?,?)',
    ).run(id, plan.game_id, JSON.stringify(plan), Date.now() + 600000);
    return { ...plan, id, expires_in_seconds: 600 };
  }
  function accept(id, plan, request) {
    if (!db) return plan;
    if (!id)
      fail(
        'Prepare and review the narration plan before submitting.',
        'STORY_PLAN_REQUIRED',
        409,
      );
    const row = db
      .prepare('SELECT * FROM fiction_operation_plans WHERE id=? AND game_id=?')
      .get(id, plan.game_id);
    if (!row || digest(JSON.parse(row.plan_json)) !== digest(plan))
      fail(
        'The narration plan changed. Refresh the target and review it again.',
        'STORY_PLAN_CHANGED',
        409,
      );
    if (row.request_id && row.request_id !== request.id)
      fail('That plan belongs to another request.', 'STORY_PLAN_USED', 409);
    if (!row.request_id && row.expires_at < Date.now())
      fail(
        'The unsubmitted narration plan expired. Review a fresh plan.',
        'STORY_PLAN_EXPIRED',
        409,
      );
    const changed = db
      .prepare(
        'UPDATE fiction_operation_plans SET request_id=? WHERE id=? AND (request_id IS NULL OR request_id=?)',
      )
      .run(request.id, id, request.id);
    if (!changed.changes)
      fail(
        'That plan was consumed by another request.',
        'STORY_PLAN_USED',
        409,
      );
    return plan;
  }
  function checkStage(plan, role, purpose, messages, raw = null) {
    const stage = plan.stages.find(
      (stage) => stage.role === role && stage.purpose === purpose,
    );
    if (db && stage) {
      const current = capacity(role, stage.model_id);
      if (
        current.context_tokens !== stage.context_tokens ||
        current.output_tokens !== stage.model_output_tokens ||
        current.source !== stage.capacity_source
      )
        fail(
          'Model capacity changed after review. No further stage was purchased.',
          'STORY_PLAN_CHANGED',
          409,
        );
    }
    if (!stage || inputBound(messages) > stage.input_bound)
      fail(
        'This stage exceeds its reviewed context bound. No further call was dispatched.',
        'STORY_STAGE_TOO_LARGE',
        409,
      );
    if (raw !== null && typeof raw !== 'string')
      fail(
        'The provider did not return a readable JSON candidate.',
        'INVALID_STORY_REPLY',
        502,
      );
    if (
      raw !== null &&
      Buffer.byteLength(raw, 'utf8') > plan.max_candidate_bytes
    )
      fail(
        'The paid candidate exceeded its reviewed size bound. No extra call was dispatched.',
        'STORY_CANDIDATE_TOO_LARGE',
        502,
      );
    return stage;
  }
  return { build, prepare, accept, checkStage };
}
module.exports = { createGenerationPlans };
