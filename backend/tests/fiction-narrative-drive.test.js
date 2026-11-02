"use strict";
const { createDb } = require("../src/db");
const { createFictionStore } = require("../src/modules/fiction/store");
const { createFictionService } = require("../src/modules/fiction/service");
const { createFictionSaves } = require("../src/modules/fiction/saves");
const {
  createGenerationPlans,
} = require("../src/modules/fiction/generation-plan");
const { createEditorial } = require("../src/modules/fiction/editorial");
const {
  createWorkspaceQueries,
} = require("../src/modules/fiction/workspace-queries");
const { defaultLayout } = require("../src/modules/fiction/editorial-model");
const { createLibraryDrafts } = require("../src/modules/fiction/library-draft");
describe("N1–N6 grounded continuity inputs, not live literary proof", () => {
  let db, store, service, story, complete, sequence;
  const fact = (id, text, extra = {}) => ({
    id,
    text,
    kind: "fact",
    visibility: "public",
    known_by: ["jo"],
    ...extra,
  });
  beforeEach(() => {
    db = createDb(":memory:");
    store = createFictionStore(db);
    sequence = 0;
    story = store.create(
      {
        title: "The garden after acceptance",
        premise: "The cast can enjoy their lives.",
        opening:
          "Jo keeps the silver watch in her coat. Samir sits beside the open gate.",
        cast: [
          {
            id: "jo",
            name: "Jo",
            description: "A careful gardener with a dry, precise voice.",
            motive:
              "Values craft and friendship; will pay a real cost to protect either.",
          },
          {
            id: "samir",
            name: "Samir",
            description: "A musician who enjoys silence.",
            motive: "Wants company without surrendering his own music.",
          },
        ],
        facts: [
          fact("watch", "Jo owns the silver watch and keeps it in her coat.", {
            actor_id: "jo",
            claim_kind: "occurred-event",
          }),
          fact("concealed", "Only Jo knows the watch contains a letter.", {
            visibility: "secret",
          }),
          fact(
            "relationship",
            "Jo and Samir have accepted a continuing relationship.",
            {
              kind: "relationship",
              actor_id: "jo",
              toward_id: "samir",
              facet: "affection",
            },
          ),
          fact(
            "promise",
            "Jo promised to bring seedlings when the rain stops.",
            { kind: "commitment", actor_id: "jo" },
          ),
        ],
      },
      {
        library: {
          world: null,
          scribe: null,
          characters: [
            {
              character_id: "jo",
              snapshot: {
                source_id: "jo-reference",
                source_revision: 0,
                name: "Jo",
                description: "Her gardening is only part of her life.",
                data: {
                  appearance: "Work-worn gloves.",
                  personality:
                    "Wry and patient; enjoys music independently of any repair job.",
                  background:
                    "Has refused convenient bargains before. " +
                    "An established interest. ".repeat(35) +
                    "Never trades a confidence for praise.",
                  motive:
                    "Competing duties to craft and a friend; accepts a lost commission rather than betrayal.",
                },
              },
            },
          ],
        },
      },
    );
    complete = jest.fn();
    service = createFictionService({ store, chatCompletion: complete });
  });
  afterEach(() => db.close());
  test("character development preserves authored priorities in one unsaved existing-call draft", async () => {
    const seed = {
      name: "Jo",
      description: "A musician outside her opening problem.",
      data: {
        personality: "A determined fixation is part of her identity.",
        motive: "Accepts losing a commission rather than betraying a friend.",
      },
    };
    const entry = {
      ...seed,
      data: {
        ...seed.data,
        appearance: "Ink-stained gloves.",
        background: "Enjoys rehearsing after work.",
      },
    };
    const chat = jest.fn().mockResolvedValue({
      content: JSON.stringify(entry),
      cost_usd: 0,
      billed_attempts: 1,
    });
    const drafts = createLibraryDrafts({
      db,
      providers: {
        exposure: () => ({ provider: { id: "text" }, model_id: "model" }),
        resolve: () => ({}),
      },
      chatCompletion: chat,
    });
    const input = {
      seed,
      length: "medium",
      provider_id: "text",
      model: "model",
    };
    const result = await drafts.draft("character", "whole-person", input);
    const messages = chat.mock.calls[0][0];
    const sentSeed = JSON.parse(
      messages[1].content
        .split("USER SEED JSON:\n")[1]
        .split("\n\nReturn only strict JSON")[0],
    );
    expect(sentSeed).toMatchObject(seed);
    expect(messages[1].content).toContain(
      "after acceptance, rejection and success",
    );
    expect(result.entry.data.motive).toBe(seed.data.motive);
    expect(
      (await drafts.draft("character", "whole-person", input)).reused,
    ).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM fiction_templates").get().n,
    ).toBe(0);
    expect(store.view(story.id).revision).toBe(story.revision);
  });
  const payload = (intent = { kind: "follow", text: "" }) =>
    JSON.parse(
      service.buildMessages(store.current(story.id), intent)[1].content,
    );
  async function scene(
    prose,
    { effects = [], input = { kind: "follow" }, resolution, scene: frame } = {},
  ) {
    complete.mockResolvedValueOnce({
      content: JSON.stringify({
        response_version: 2,
        prose,
        summary: prose.slice(0, 1000),
        effects,
        ...(resolution ? { resolution } : {}),
        ...(frame ? { scene: frame } : {}),
      }),
      billed_attempts: 1,
      cost_usd: 0,
    });
    story = (
      await service.reply({
        gameId: story.id,
        expectedRevision: story.revision,
        idempotencyKey: "scene-" + ++sequence,
        input,
      })
    ).story;
    return story.head_beat_id;
  }
  test("an offscreen method outcome retains exact original evidence beyond the recent prose window", async () => {
    const quote =
      "Samir declines the same repair offer; he wants to play his own music.";
    const source = await scene(quote, {
      effects: [
        {
          op: "remember",
          fact: fact("refused-remedy", quote, {
            actor_id: "samir",
            claim_kind: "occurred-event",
          }),
          claim_kind: "occurred-event",
          source_kind: "narration",
          evidence: quote,
        },
      ],
    });
    for (let n = 0; n < 14; n++) await scene(`A quiet garden passage ${n}.`);
    const before = db
      .prepare("SELECT count(*) AS n FROM fiction_beats")
      .get().n;
    const p = payload({ kind: "steer", text: "Stay with Samir." });
    expect(p.recent.map((r) => r.beat_id)).not.toContain(source);
    expect(p.facts.find((f) => f.id === "refused-remedy").text).toBe(quote);
    expect(
      p.narrative_continuity.memory_sources.find(
        (s) => s.fact_id === "refused-remedy",
      ),
    ).toMatchObject({
      source_beat_id: source,
      source_kind: "narration",
      source_field: "prose",
      quote,
    });
    expect(db.prepare("SELECT count(*) AS n FROM fiction_beats").get().n).toBe(
      before,
    );
    expect(complete).toHaveBeenCalledTimes(15);
  });
  test("complete character anchors and separate possession/knowledge survive attention selection", () => {
    const p = payload({ kind: "steer", text: "Samir remembers the watch." });
    expect(p.cast.find((c) => c.id === "jo").motive).toContain(
      "pay a real cost",
    );
    expect(
      p.catalogue_context.characters[0].snapshot.data.background,
    ).toContain("Never trades a confidence for praise.");
    expect(
      p.catalogue_context.characters[0].snapshot.data.personality,
    ).toContain("independently");
    expect(p.facts.find((f) => f.id === "watch")).toMatchObject({
      actor_id: "jo",
      known_by: ["jo"],
    });
    expect(p.facts.find((f) => f.id === "concealed").known_by).toEqual(["jo"]);
    expect(
      p.narrative_continuity.memory_sources.find((s) => s.fact_id === "watch")
        .source_kind,
    ).toBe("initial_fact");
    expect(p.narrative_continuity.character_anchors.cast_ids).toEqual([
      "jo",
      "samir",
    ]);
    expect(complete).not.toHaveBeenCalled();
  });
  test("a local assertion and an intention remain distinct from narrated completion", () => {
    story = store.correct(story.id, story.revision, {
      fact: fact(
        "planned-delivery",
        "Jo intends to bring seedlings tomorrow.",
        { kind: "goal", actor_id: "jo", claim_kind: "intention" },
      ),
      reason: "Retain an intention, not an achieved goal.",
    });
    const p = payload();
    const source = p.narrative_continuity.memory_sources.find(
      (s) => s.fact_id === "planned-delivery",
    );
    expect(source).toMatchObject({
      source_kind: "owner_assertion",
      source_field: "changes.fact.text",
      claim_kind: "intention",
      status: "active",
    });
    expect(
      p.narrative_continuity.handoff.active_intentions.map((f) => f.fact_id),
    ).toContain("planned-delivery");
    expect(
      p.narrative_continuity.handoff.recorded_milestones.map((f) => f.fact_id),
    ).not.toContain("planned-delivery");
    expect(p.episode.phase).not.toBe("payoff");
  });
  test("related people are retrieved through the relationship target as well as its actor", () => {
    for (let n = 0; n < 40; n++)
      story = store.correct(story.id, story.revision, {
        fact: fact("unrelated-" + n, "An unrelated stable observation " + n, {
          kind: "relationship",
          actor_id: "jo",
          facet: "expectation",
        }),
        reason: "Synthetic memory pressure.",
      });
    const matches = store.memory.facts(story.id, story.head_beat_id, {
      kind: "relationship",
      actorIds: ["samir"],
      limit: 1,
    });
    expect(matches[0].id).toBe("relationship");
    const p = payload({ kind: "steer", text: "Follow Samir." });
    expect(
      p.narrative_continuity.relationship_records.map((r) => r.fact_id),
    ).toContain("relationship");
  });
  test("a sibling/future acceptance and its quote do not enter the fork context", async () => {
    const opening = story.head_beat_id;
    await scene("UNIQUE FUTURE: Samir accepts the commission.", {
      effects: [
        {
          op: "remember",
          fact: fact("future-acceptance", "UNIQUE FUTURE acceptance", {
            claim_kind: "occurred-event",
            actor_id: "samir",
          }),
          claim_kind: "occurred-event",
          source_kind: "narration",
          evidence: "Samir accepts the commission.",
        },
      ],
    });
    story = store.fork(story.id, story.revision, {
      name: "Before the commission",
      beat_id: opening,
    });
    const p = payload();
    expect(JSON.stringify(p)).not.toContain("UNIQUE FUTURE");
    expect(
      p.narrative_continuity.memory_sources.some(
        (s) => s.fact_id === "future-acceptance",
      ),
    ).toBe(false);
  });
  test("prior structured refusals remain sourced after changed grounds permit acceptance", async () => {
    story = store.create({
      title: "A guarded garden",
      premise: "Jo needs adequate authority.",
      opening: "Jo waits at the gate.",
      play_style: "living-world",
      cast: [{ id: "jo", name: "Jo" }],
      challenges: [
        {
          id: "gate",
          label: "Open the gate",
          actor_id: "jo",
          motive: "Protect the garden.",
          success: "Jo opens the gate after permission.",
          refusal: "Jo declines without permission.",
          flexible: false,
          approaches: [
            {
              id: "permit",
              label: "Show permission",
              requires: [
                {
                  fact_id: "permission",
                  status: "active",
                  known_by: "jo",
                  minimum: null,
                },
              ],
            },
          ],
        },
      ],
    });
    const input = {
      kind: "steer",
      text: "Ask Jo to open it.",
      challenge_id: "gate",
      approach_id: "permit",
    };
    const refused = await scene("Jo keeps the gate shut.", {
      input,
      resolution: { outcome: "refused", evidence: "Jo keeps the gate shut." },
    });
    story = store.correct(story.id, story.revision, {
      fact: fact("permission", "Jo has received valid permission."),
      reason: "New sufficient grounds.",
    });
    const granted = await scene("Jo opens the gate.", {
      input,
      resolution: { outcome: "granted", evidence: "Jo opens the gate." },
    });
    const outcomes = payload().narrative_continuity.recorded_outcomes;
    expect(outcomes).toEqual([
      expect.objectContaining({
        source_beat_id: refused,
        outcome: "refused",
        approach_id: "permit",
      }),
      expect.objectContaining({
        source_beat_id: granted,
        outcome: "granted",
        approach_id: "permit",
      }),
    ]);
    story = store.fork(story.id, story.revision, {
      name: "Before authority",
      beat_id: refused,
    });
    expect(
      payload().narrative_continuity.recorded_outcomes.map((o) => o.outcome),
    ).toEqual(["refused"]);
  });
  test("chapter handoff selects an empty next chapter without inventing time, prose or achievement", () => {
    const opening = story.head_beat_id;
    const layout = defaultLayout(
      store.publicationRows(story.id, opening),
      story.title,
    );
    layout.chapters[0].open_tail = false;
    layout.chapters[0].through_beat_id = opening;
    layout.chapters.push({
      id: "chapter-next",
      title: "After the rain",
      volume_id: layout.volumes[0].id,
      after_beat_id: opening,
      through_beat_id: null,
      open_tail: true,
    });
    const editorial = createEditorial({
      db,
      store,
      queries: createWorkspaceQueries({ db, store }),
    });
    story = editorial.apply(story.id, {
      action_key: "handoff-layout",
      expected_revision: story.revision,
      target_branch_id: story.active_branch_id,
      expected_head_beat_id: story.head_beat_id,
      expected_editorial_id: null,
      layout,
    }).story;
    const p = payload();
    expect(p.narrative_continuity.handoff.editorial_context).toMatchObject({
      mode: "editorial",
      new_chapter: true,
      chapter: { id: "chapter-next", after_source_beat_id: opening },
      previous_chapter: { through_source_beat_id: opening },
    });
    expect(
      p.narrative_continuity.handoff.unresolved_commitments.map(
        (c) => c.fact_id,
      ),
    ).toContain("promise");
    expect(p.recent).toHaveLength(1);
    expect(p.episode.phase).toBe("opening");
  });
  test("a quiet Follow with three promises uses one call and leaves accepted relationships intact", async () => {
    for (let n = 0; n < 2; n++)
      story = store.correct(story.id, story.revision, {
        fact: fact("promise-" + n, "A promise for a later day " + n, {
          kind: "commitment",
          actor_id: "jo",
        }),
        reason: "Synthetic outstanding commitment.",
      });
    const prose =
      "Jo waters the seedlings while Samir plays a tune for his own pleasure.";
    await scene(prose);
    const p = JSON.parse(complete.mock.calls[0][0][1].content);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(p.narrative_continuity.handoff.unresolved_commitments).toHaveLength(
      3,
    );
    expect(p.control.character_id).toBeNull();
    expect(Object.keys(p).at(-1)).toBe("next_move_gate");
    expect(
      story.state.facts.find((f) => f.id === "relationship").text,
    ).toContain("accepted");
    expect(story.beats.at(-1).changes).toEqual([]);
    expect(story.state.episode.status).toBe("active");
  });
  test("current-format save copy remaps source links; bounded context refuses undersized capacity before purchase", async () => {
    const quote = "Jo declines a bargain that would betray her friend.";
    const original = await scene(quote, {
      effects: [
        {
          op: "remember",
          fact: fact("costly-refusal", quote, { claim_kind: "occurred-event" }),
          claim_kind: "occurred-event",
          source_kind: "narration",
          evidence: quote,
        },
      ],
    });
    const saves = createFictionSaves({ db, store, media: {} });
    const restored = await saves.importSave(await saves.exportSave(story.id));
    story = restored;
    const p = payload();
    expect(
      p.narrative_continuity.memory_sources.find(
        (s) => s.fact_id === "costly-refusal",
      ),
    ).toMatchObject({ quote, source_kind: "narration" });
    expect(
      p.narrative_continuity.memory_sources.find(
        (s) => s.fact_id === "costly-refusal",
      ).source_beat_id,
    ).not.toBe(original);
    const plans = createGenerationPlans({
      db,
      providers: {
        exposure: () => ({ provider: null, model_id: "small" }),
        resolve: () => ({
          modelLimits: {
            context_tokens: 1000,
            output_tokens: 16000,
            source: "fixture",
          },
        }),
      },
    });
    const context = store.current(story.id);
    expect(() =>
      plans.build(
        context,
        { kind: "follow", text: "" },
        service.buildMessages(context, { kind: "follow", text: "" }),
      ),
    ).toThrow("does not fit");
    expect(complete).toHaveBeenCalledTimes(1);
    const ask = payload({ kind: "ask", text: "Who holds the watch?" });
    expect(ask.next_move_gate).toHaveLength(1);
    expect(ask.next_move_gate[0]).toContain("clarification only");
  });
});
