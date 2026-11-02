"use strict";
// A derived selection of existing branch records. Nothing here is a new event,
// a character scheduler, a semantic verdict, or permission to control the reader.
const NEXT_MOVE_GATE = [
  "After reading the supplied history, choose the present purpose from the whole established person. Let a feasible method produce something observably said, chosen or done, with an appropriate response or changed circumstance. Do not print this planning.",
  "Preserve the last result. Acceptance can develop; a fulfilled practical goal can finish. A rephrased refused remedy is not new progress. Changed evidence, a different feasible tactic, a competing interest, or deliberate costly persistence may matter. Authored fixation remains possible; no compulsory adaptability, novelty or virtue.",
  "Quiet enjoyment, competent routine, silence, rest and completion can carry a scene. Do not invent another summons, broken item, emergency or subplot merely to reactivate the opening problem. No crisis quota or compulsory durable effect.",
  "Check ownership, physical presence, possession, significance, knowledge and reported claims separately against their sources. A salient object has not moved or changed owner merely because it is remembered. Intentions, references and proposed scenes have not happened yet.",
  "Enact only narrator-owned choices or explicit submitted character intent. Leave an inhabited character’s voluntary speech, decisions, feelings and commitments to the user. Stop naturally at their consequential choice; do not substitute a handover question for available NPC action.",
];
function narrativeDrive({
  state,
  facts,
  recent,
  chapter,
  outcomes,
  actorIds,
  plan,
  sources,
  head,
}) {
  const byId = new Map(sources.map((item) => [item.fact_id, item]));
  const source = (fact) => ({
    ...byId.get(fact.id),
    fact_id: fact.id,
    status: fact.status,
    claim_kind: fact.claim_kind || "unspecified",
  });
  const active = facts.filter((fact) => fact.status === "active");
  const resolved = facts.filter((fact) => fact.status === "resolved");
  const events = recent
    .slice(-3)
    .map((row) => ({ beat_id: row.beat_id, kind: row.kind }));
  const recentIds = new Set(
    [head, ...events.map((row) => row.beat_id)].filter(Boolean),
  );
  return {
    version: 1,
    authority:
      "Selected branch truth persists independently of this bounded attention selection. Missing from this selection never means erased, resolved, present, owned, known, or false.",
    current_attention: {
      actor_ids: actorIds,
      focus: state.focus || "",
      provisional_opportunity: plan.kind,
    },
    character_anchors: {
      cast_ids: state.cast.map((person) => person.id),
      reference_revision_ids: Object.values(state.reference_heads || {}),
      sources:
        "Complete effective cast and catalogue_context above; preserve voice, motives, competing values, limits, loyalties and authored willingness to bear costs. Repeated descriptions do not multiply intensity. Interests have uses beyond the opening problem.",
    },
    memory_sources: facts.map(source),
    relationship_records: facts
      .filter((fact) => fact.kind === "relationship")
      .slice(0, 16)
      .map(source),
    recorded_outcomes: outcomes,
    handoff: {
      editorial_context: chapter,
      recent_narrative_sources: events,
      last_recorded_scene_source: state.scene_frame?.beat_id || null,
      changed_records: facts
        .filter((fact) => recentIds.has(byId.get(fact.id)?.source_beat_id))
        .slice(0, 12)
        .map(source),
      active_intentions: active
        .filter(
          (fact) =>
            fact.kind === "goal" ||
            fact.claim_kind === "intention" ||
            fact.claim_kind === "attempt",
        )
        .slice(0, 8)
        .map(source),
      unresolved_commitments: active
        .filter((fact) => fact.kind === "commitment")
        .slice(0, 8)
        .map(source),
      recorded_milestones: resolved.slice(0, 12).map((fact) => ({
        ...source(fact),
        resolution_disposition: fact.resolution_disposition || "unspecified",
      })),
      interpretation:
        "These are source-linked records, not a synopsis of invented events or a schedule. Chapter boundaries do not move time/place or resolve anything. Active promises are not automatically due now; respect evidenced timing. Plan or attempt sources cannot become completed payoffs. A recorded achievement permits aftermath without resetting the relationship or reopening its practical problem.",
    },
  };
}
const CONTINUITY_RULES = [
  "Use narrative_continuity as a bounded, source-linked attention aid, not a replacement for recorded truth or character identity. Keep offscreen consequences intact without forcing every scene to mention them. Current relevance does not establish physical presence, possession, permission, knowledge or agreement.",
  "Use the complete cast and effective reference material, including voice, motives, competing values, limits and established tolerance for costs. Let an interest sustain independent activity after success or rejection. Do not reduce a person to the opening task or sanitize their authored priorities into the safest agreeable choice.",
  "When an enacted method, refusal, acceptance or milestone has lasting consequences, retain a concise evidenced fact or develop the applicable relationship/expectation using existing effect fields. Record what actually happened, its actor and knowledge scope; do not turn a rejected method into a universal prohibition or an unperformed intention into an event. No effect is required for an ordinary quiet beat.",
  "The provisional scene_plan is an available opportunity, not a requirement to alternate categories, summon another problem or interrupt a playable activity. Let current purposes and consequences decide whether it fits.",
  "When actual narration changes location, time or presence, use the existing scene field with exact ordinary prose evidence. Do not infer arrival, departure or ownership from a remembered object, catalogue portrait or proposed scene.",
  "Before producing the response, apply next_move_gate after the history and handoff. It guides the existing narration call only; do not add planning fields, print private reasoning or change the response schema. Ask remains clarification with no story continuation, time advance, new knowledge or effects.",
];
module.exports = { narrativeDrive, NEXT_MOVE_GATE, CONTINUITY_RULES };
