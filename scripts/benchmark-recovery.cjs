"use strict";
// Synthetic current-format qualification. No owner store or provider is opened.
const { createHash } = require("node:crypto");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { performance } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const repo = process.env.INKMORROW_REPOSITORY || path.resolve(__dirname, "..");
const load = (file) => require(path.join(repo, "backend/src", file));
const { createDb, schemaIdentity } = load("db");
const { createFictionStore } = load("modules/fiction/store");
const { createFictionService } = load("modules/fiction/service");
const { createWorkspaceQueries } = load("modules/fiction/workspace-queries");
const { createFictionMedia } = load("modules/fiction/media");
const { createFictionPublication } = load("modules/fiction/publication");
const { createEditions } = load("modules/fiction/editions");
const { createFictionSaves } = load("modules/fiction/saves");
const { applyEffects } = load("modules/fiction/model");
const { chooseScene, recordScene } = load("modules/fiction/director");
const { recordEpisode } = load("modules/fiction/episodes");
const { assemble } = load("modules/fiction/narrative-assembly");
const sharp = require(path.join(repo, "backend/node_modules/sharp"));
const output =
  process.argv[2] || path.join(repo, "docs/recovery/evidence/B8-CAPACITY.json");
const scratch =
  process.env.INKMORROW_BENCHMARK_TMPDIR || path.join(repo, ".benchmark-work");
fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
const root = fs.mkdtempSync(path.join(scratch, "inkmorrow-b8-"));
let db, editions;
let providerCalls = 0;
const measure = (work, n = 30) => {
  const values = [];
  let response;
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    response = work();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return {
    p50_ms: +values[Math.floor(n * 0.5)].toFixed(2),
    p95_ms: +values[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2),
    response_bytes: Buffer.byteLength(JSON.stringify(response)),
  };
};
async function main() {
  const file = path.join(root, "fixture.db");
  db = createDb(file);
  const store = createFictionStore(db);
  const media = createFictionMedia({
    db,
    store,
    rootDir: path.join(root, "art"),
  });
  let story = store.create({ scenario_id: "drowned-bell" });
  const pixel = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#58405e" },
  })
    .webp()
    .toBuffer();
  for (const target of [
    { kind: "cover", subject_id: null },
    { kind: "character", subject_id: "mara" },
    { kind: "character", subject_id: "iona" },
    { beat_id: story.head_beat_id },
  ]) {
    const asset = media.persist({
      buffer: pixel,
      mediaType: "image/webp",
      width: 16,
      height: 16,
    });
    story = (target.kind ? store.visualize : store.illustrate)(
      story.id,
      story.revision,
      { ...target, asset, alt_text: "Explicitly synthetic garden image" },
    );
  }
  for (let n = 0; n < 16; n++) {
    const context = store.current(story.id);
    const proposed = store.creativeRecords.reference(
      story.id,
      context.state,
      "character",
      "mara",
    );
    proposed.data.motive =
      "Protect the archive and continue her own craft. Synthetic reference revision " +
      n;
    story = store.creativeRecords.adopt(story.id, {
      action_key: "reference-" + n,
      expected_revision: story.revision,
      target_branch_id: story.active_branch_id,
      expected_head_beat_id: story.head_beat_id,
      kind: "character",
      subject_id: "mara",
      expected_reference_id:
        context.state.reference_heads["character:mara"] || null,
      proposed,
      selected_fields: ["data.motive"],
      acknowledge_overlaps: true,
    }).story;
  }
  const queries = createWorkspaceQueries({ db, store });
  const service = createFictionService({
    store,
    chatCompletion: async () => {
      providerCalls++;
      throw Error("Provider use is forbidden in this fixture");
    },
  });
  const publication = createFictionPublication({ store, media });
  editions = createEditions({
    db,
    store,
    queries,
    publication,
    media,
    rootDir: root,
  });
  const saves = createFictionSaves({ db, store, media });
  const insert = db.prepare(
    "INSERT INTO fiction_beats(id,game_id,branch_id,parent_id,kind,prose,summary,input_json,state_json,changes_json) VALUES(?,?,?,?,'scene',?,?,?,?,?)",
  );
  const assembly = db.prepare(
    "INSERT INTO fiction_narrative_assemblies(beat_id,manifest_json) VALUES(?,?)",
  );
  const intent = { kind: "follow", text: "", character_id: null };
  const game = store.current(story.id).game;
  let state = store.current(story.id).state;
  let parent = story.head_beat_id;
  let count = db
    .prepare("SELECT count(*) AS n FROM fiction_beats WHERE game_id=?")
    .get(story.id).n;
  let next = 0;
  let side = false;
  function append(branch, priorState, priorHead, prefix) {
    const id = prefix + "-" + ++next;
    const actor = "mara";
    const k = next % 5;
    const fact = {
      id: "record-" + id,
      kind: ["fact", "commitment", "goal", "relationship", "resource"][k],
      text:
        k === 1
          ? `Mara promises to label parcel ${id}.`
          : k === 2
            ? `Mara intends to catalogue parcel ${id}.`
            : k === 3
              ? `Mara trusts Iona to label parcel ${id}.`
              : k === 4
                ? `Mara owns one parcel named ${id}.`
                : `Parcel ${id} is by the gate.`,
      visibility: "public",
      known_by: [actor],
      status: "active",
      actor_id: actor,
      value: k === 4 ? 1 : null,
      claim_kind: k === 2 ? "intention" : "occurred-event",
      ...(k === 3 ? { facet: "trust", toward_id: "iona" } : {}),
    };
    const prose = fact.text;
    const plan = chooseScene(game, priorState, intent);
    const { state: after, changes } = applyEffects(
      priorState,
      [
        {
          op: "remember",
          fact,
          claim_kind: fact.claim_kind,
          source_kind: "narration",
          evidence: prose,
        },
      ],
      { prose, input: intent, beatId: id },
    );
    recordScene(after, plan, id);
    recordEpisode(after, changes, id);
    const manifest = assemble({
      prose,
      intent,
      cast: after.cast,
      protocol: 2,
    }).manifest;
    insert.run(
      id,
      story.id,
      branch,
      priorHead,
      prose,
      prose,
      JSON.stringify(intent),
      JSON.stringify(after),
      JSON.stringify(changes),
    );
    assembly.run(id, JSON.stringify(manifest));
    store.evidenceRecords.write(
      story.id,
      { id, kind: "scene", prose, input: intent, changes },
      [
        {
          change_index: 0,
          source_kind: "narration",
          source_field: "prose",
          quote: prose,
        },
      ],
    );
    count++;
    return { state: after, head: id };
  }
  const results = [];
  for (const target of [500, 3000, 10000]) {
    const begin = performance.now();
    db.exec("BEGIN");
    try {
      while (count < target) {
        const result = append(story.active_branch_id, state, parent, "main");
        state = result.state;
        parent = result.head;
        if (!side && count === 250) {
          side = true;
          db.prepare(
            "INSERT INTO fiction_branches(id,game_id,name,parent_branch_id,fork_beat_id,head_beat_id) VALUES(?,?,?,?,?,?)",
          ).run(
            "synthetic-side",
            story.id,
            "Synthetic alternate path",
            story.active_branch_id,
            parent,
            parent,
          );
          let sideState = structuredClone(state),
            sideHead = parent;
          for (let n = 0; n < 100; n++) {
            const alt = append("synthetic-side", sideState, sideHead, "side");
            sideState = alt.state;
            sideHead = alt.head;
          }
          db.prepare(
            "UPDATE fiction_branches SET head_beat_id=? WHERE id=?",
          ).run(sideHead, "synthetic-side");
        }
      }
      db.prepare("UPDATE fiction_branches SET head_beat_id=? WHERE id=?").run(
        parent,
        story.active_branch_id,
      );
      db.prepare("UPDATE fiction_games SET revision=? WHERE id=?").run(
        count,
        story.id,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const coldStart = performance.now();
    queries.codex(story.id);
    const cold = performance.now() - coldStart;
    const result = {
      moments: count,
      build_increment_ms: +(performance.now() - begin).toFixed(2),
      cold_codex_ms: +cold.toFixed(2),
      timeline: measure(() => queries.timeline(story.id)),
      codex: measure(() => queries.codex(story.id)),
      passage: measure(() => queries.passages(story.id, parent)),
      narration_context: measure(
        () => service.buildMessages(store.current(story.id), intent),
        10,
      ),
      rss_bytes: process.memoryUsage().rss,
    };
    const freezeStart = performance.now();
    const edition = editions.snapshot(story.id, {
      branch_id: story.active_branch_id,
      inspection_at: parent,
    });
    result.book_preview = {
      ms: +(performance.now() - freezeStart).toFixed(2),
      chapters: edition.chapter_count,
      passages: edition.page_count,
      images: edition.art.length,
      response_bytes: Buffer.byteLength(JSON.stringify(edition)),
    };
    const exportStart = performance.now();
    let packed;
    try {
      packed = await saves.exportSave(story.id);
      result.save = {
        status: "exported",
        packed_bytes: packed.length,
        export_ms: +(performance.now() - exportStart).toFixed(2),
      };
    } catch (error) {
      if (error.code !== "SAVE_TOO_LARGE") throw error;
      result.save = {
        status: "explicit_preflight_rejection",
        code: error.code,
        message: error.message,
        ms: +(performance.now() - exportStart).toFixed(2),
      };
    }
    if (packed) {
      const restoredRoot = path.join(root, "copy-" + count);
      fs.mkdirSync(restoredRoot);
      const restoredDb = createDb(path.join(restoredRoot, "copy.db"));
      try {
        const restoredStore = createFictionStore(restoredDb),
          restoredMedia = createFictionMedia({
            db: restoredDb,
            store: restoredStore,
            rootDir: restoredRoot,
          });
        const start = performance.now();
        const restored = await createFictionSaves({
          db: restoredDb,
          store: restoredStore,
          media: restoredMedia,
        }).importSave(packed);
        const total = restoredDb
          .prepare("SELECT count(*) AS n FROM fiction_beats WHERE game_id=?")
          .get(restored.id).n;
        if (total !== count || restored.branches.length !== 2)
          throw Error("Save copy lost graph records");
        result.save.import_ms = +(performance.now() - start).toFixed(2);
        result.save.restored_moments = total;
        result.save.restored_paths = restored.branches.length;
      } finally {
        restoredDb.close();
        fs.rmSync(restoredRoot, { recursive: true, force: true });
      }
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    result.database_bytes = fs.statSync(file).size;
    results.push(result);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(
      output,
      JSON.stringify({ status: "in_progress", results }, null, 2) + "\n",
    );
    process.stderr.write(
      JSON.stringify({
        moments: count,
        codex_p95: result.codex.p95_ms,
        context_p95: result.narration_context.p95_ms,
        save: result.save.status,
      }) + "\n",
    );
  }
  const evidence = {
    base_source_sha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    measurement_phase:
      "B8 candidate before its final commit; source file digests identify measured runtime code",
    source_digests: Object.fromEntries(
      [
        "scripts/benchmark-recovery.cjs",
        "backend/src/modules/fiction/context-compiler.js",
        "backend/src/modules/fiction/narrative-memory.js",
        "backend/src/modules/fiction/narrative-drive.js",
        "backend/src/modules/fiction/memory.js",
        "backend/src/modules/fiction/store.js",
        "backend/src/modules/fiction/saves.js",
        "backend/src/modules/fiction/creative-save.js",
        "backend/src/modules/fiction/editions.js",
      ].map((name) => [
        name,
        createHash("sha256")
          .update(fs.readFileSync(path.join(repo, name)))
          .digest("hex"),
      ]),
    ),
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0].model,
    hardware_threads: os.cpus().length,
    schema: schemaIdentity(db),
    fixture:
      "Current-format synthetic accepted graph, two paths sharing early ancestry, four normalized images (cover/two private portraits/passage), sixteen local character-reference revisions, one new evidenced fact per narrative moment with bounded 128-fact working snapshots. No real model, owner data, Android, network or prose quality measured.",
    samples: { queries: 30, narration_context: 10 },
    provider_calls: providerCalls,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    results,
    history_index_plan: db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT beat_id FROM fiction_history_index WHERE game_id=? AND narrative_ordinal=? AND is_narrative=1",
      )
      .all(story.id, 9000),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(output);
}
main()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    editions?.dispose();
    db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
