"use strict";
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { keys, text, fail } = require("./model");
const { validateMp3 } = require("./mp3");
const { createNarration } = require("../audio/narration");
const MAX_SEGMENT = 16 * 1024 * 1024,
  MAX_EDITION = 512 * 1024 * 1024;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function createListening({ db, store, queries, providers, ai, rootDir }) {
  const router = express.Router();
  const base = "/api/fiction/:id/listening";
  const directory = path.join(rootDir, "fiction");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const split = createNarration({}).splitSegments;
  let working = false,
    disposed = false;
  let queueTimer = null;
  let incarnation = randomUUID();
  const file = (key) => {
    if (!/^[a-f0-9-]{36}\.mp3$/.test(key)) fail("Invalid audio file.");
    return path.join(directory, key);
  };
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const planRow = (id, plan) =>
    db
      .prepare("SELECT * FROM fiction_listening_plans WHERE game_id=? AND id=?")
      .get(id, plan) ||
    fail("Listening plan not found.", "AUDIO_NOT_FOUND", 404);
  const jobRow = (id, job) =>
    db
      .prepare("SELECT * FROM fiction_listening_jobs WHERE game_id=? AND id=?")
      .get(id, job) ||
    fail("Listening edition not found.", "AUDIO_NOT_FOUND", 404);
  function cache(key) {
    const row = db
      .prepare("SELECT * FROM fiction_audio_cache WHERE cache_key=?")
      .get(key);
    if (!row) return null;
    try {
      if (
        row.byte_size <= MAX_SEGMENT &&
        fs.statSync(file(row.storage_key)).size === row.byte_size
      ) {
        const bytes = fs.readFileSync(file(row.storage_key));
        if (bytes.length === row.byte_size && hash(bytes) === row.sha256)
          return { ...row, buffer: bytes };
      }
    } catch {
      /* Missing or unreadable cached bytes are not a new purchase authority. */
    }
    // Invalidate derived cache membership so a later deliberate plan can review
    // replacement. This plan still fails if it only approved a free cached unit.
    const removed = db
      .prepare(
        "DELETE FROM fiction_audio_cache WHERE cache_key=? AND storage_key=?",
      )
      .run(key, row.storage_key);
    if (removed.changes) {
      try {
        fs.unlinkSync(file(row.storage_key));
      } catch {
        /* Already missing or inaccessible; never erase an edition. */
      }
    }
    return null;
  }
  function availableCache(key) {
    const row = db
      .prepare(
        "SELECT storage_key,byte_size FROM fiction_audio_cache WHERE cache_key=?",
      )
      .get(key);
    if (!row || row.byte_size > MAX_SEGMENT) return false;
    try {
      return fs.statSync(file(row.storage_key)).size === row.byte_size;
    } catch {
      return false;
    }
  }
  async function charge(config, id) {
    if (!id) return null;
    try {
      const billing = providers.resolve("narrator", {
        capability: "speech",
        model: config.model,
        credentialOptional: true,
      });
      if (
        (billing.profileId === undefined ||
          billing.profileId === config.provider_id) &&
        billing.baseUrl === config.endpoint
      ) {
        const cost = await ai.fetchGenerationCost(id);
        return Number.isFinite(cost) && cost >= 0 ? cost : null;
      }
    } catch {
      /* An unavailable original-provider cost stays unknown. */
    }
    return null;
  }
  function configuration(input, { credentialOptional = true } = {}) {
    const selected = providers.exposure("narrator");
    if (
      !input.provider_id ||
      input.provider_id !== selected.provider?.id ||
      input.model !== selected.model_id
    )
      fail(
        "The narrator changed. Review a new plan.",
        "AUDIO_PROVIDER_CHANGED",
        409,
      );
    const resolved = providers.resolve("narrator", {
      capability: "speech",
      model: input.model,
      credentialOptional,
    });
    return {
      provider_id: input.provider_id,
      endpoint: resolved.baseUrl,
      model: input.model,
      voice: input.voice,
      format: "mp3",
      settings_version: 1,
    };
  }
  async function prepare(id, input) {
    keys(
      input,
      [
        "branch_id",
        "inspection_at",
        "kind",
        "scope",
        "beat_id",
        "chapter_id",
        "volume_id",
        "provider_id",
        "model",
        "voice",
      ],
      "Listening plan",
    );
    if (!["read-aloud", "auto-read", "audiobook"].includes(input.kind))
      fail("Choose a listening action.");
    text(input.voice, "Voice", 200);
    const config = configuration(input);
    const models = await ai.listSpeechModels();
    const model = models.find((row) => row.id === config.model);
    if (
      !model ||
      model.pcm ||
      !model.voices.some((voice) => voice.id === config.voice)
    )
      fail(
        "Choose an MP3-capable model and a voice from its catalogue. No format fallback is purchased.",
        "AUDIO_PROFILE_INVALID",
      );
    // No await across the source cut: all selected prose and editorial boundaries freeze together.
    const ctx = queries.context(id, input);
    let rows = store.publicationRows(id, ctx.head);
    const scope = input.scope || "path";
    if (!["path", "passage", "chapter", "volume"].includes(scope))
      fail("Choose a listening range.");
    if (scope === "passage")
      rows = rows.filter((row) => row.id === input.beat_id);
    if (scope === "chapter" || scope === "volume") {
      const layout = store.editorialValue(id, ctx.state, rows, ctx.game.title);
      const groups = layout.groups.filter((group) =>
        scope === "chapter"
          ? group.id === input.chapter_id
          : group.volume_id === input.volume_id,
      );
      if (!groups.length) fail("Select a chapter or volume on this edition.");
      const selected = new Set(
        groups.flatMap((group) =>
          rows.slice(group.start, group.end + 1).map((row) => row.id),
        ),
      );
      rows = rows.filter((row) => selected.has(row.id));
    }
    if (!rows.length) fail("This selection has no saved narrative prose.");
    const manifest = rows.flatMap((row) =>
      split(row.prose).map((value) => ({
        beat_id: row.id,
        text: value,
        text_hash: hash(value),
        cache_key: hash(JSON.stringify({ text: value, configuration: config })),
      })),
    );
    const limit = input.kind === "read-aloud" ? 16 : 512;
    if (manifest.length > limit)
      fail(
        `Choose a smaller passage/chapter/volume. This action supports at most ${limit} synthesis segments.`,
        "AUDIO_TOO_LARGE",
        413,
      );
    const estimated = manifest.reduce(
      (n, item) => n + Math.max(256 * 1024, item.text.length * 512),
      0,
    );
    if (estimated > MAX_EDITION)
      fail("Choose a smaller listening range.", "AUDIO_TOO_LARGE", 413);
    if (
      db
        .prepare(
          "SELECT count(*) AS n FROM fiction_listening_plans WHERE game_id=?",
        )
        .get(id).n >= 1000
    )
      fail(
        "This story has reached its retained listening-plan limit.",
        "AUDIO_PLAN_LIMIT",
        413,
      );
    for (const item of manifest)
      item.authorized_purchase = !availableCache(item.cache_key);
    const pending = db
      .prepare(
        "SELECT id FROM fiction_listening_plans p WHERE game_id=? AND NOT EXISTS(SELECT 1 FROM fiction_listening_jobs j WHERE j.plan_id=p.id) ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
    if (pending)
      fail(
        "A previous listening plan still needs review. Open it or cancel it before preparing another.",
        "AUDIO_PLAN_PENDING",
        409,
      );
    const plan = {
      id: randomUUID(),
      source_hash: hash(
        JSON.stringify(
          manifest.map((item) => ({
            beat_id: item.beat_id,
            text_hash: item.text_hash,
          })),
        ),
      ),
    };
    db.prepare(
      "INSERT INTO fiction_listening_plans(id,game_id,branch_id,head_id,kind,source_hash,configuration_json,manifest_json,estimated_bytes) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      plan.id,
      id,
      ctx.viewBranch.id,
      ctx.head,
      input.kind,
      plan.source_hash,
      JSON.stringify(config),
      JSON.stringify(manifest),
      estimated,
    );
    return preview(id, plan.id);
  }
  function preview(id, planId) {
    const plan = planRow(id, planId);
    const manifest = JSON.parse(plan.manifest_json);
    const config = JSON.parse(plan.configuration_json);
    const cached = manifest.filter((item) =>
      availableCache(item.cache_key),
    ).length;
    const missingUnreviewed = manifest.some(
      (item) => !item.authorized_purchase && !availableCache(item.cache_key),
    );
    return {
      id: plan.id,
      branch_id: plan.branch_id,
      head_id: plan.head_id,
      kind: plan.kind,
      source_hash: plan.source_hash,
      configuration: config,
      segments: manifest.length,
      cached_segments: cached,
      purchase_segments: manifest.length - cached,
      maximum_calls: manifest.filter((item) => item.authorized_purchase).length,
      missing_unreviewed_cache: missingUnreviewed,
      estimated_bytes: plan.estimated_bytes,
      exposure:
        "Only selected saved narrative prose is sent. No Ask, hidden references, directions, corrections or sibling paths. No retry or format fallback.",
      exclusions:
        "Audio is installation-local. Download the edition separately; playable saves exclude synthesized audio.",
    };
  }
  function view(id, jobId) {
    const job = jobRow(id, jobId);
    const plan = planRow(id, job.plan_id);
    const current = store.current(id);
    let available = false;
    if (job.storage_key) {
      try {
        available = fs.statSync(file(job.storage_key)).size === job.byte_size;
      } catch {
        /* Missing audio remains an explicit unavailable edition. */
      }
    }
    const spend = db
      .prepare(
        "SELECT coalesce(sum(cost_usd),0) AS known_usd,coalesce(sum(CASE WHEN cost_usd IS NULL THEN billed_attempts ELSE 0 END),0) AS unknown_attempts FROM fiction_audio_calls WHERE job_id=?",
      )
      .get(job.id);
    return {
      id: job.id,
      plan_id: plan.id,
      kind: plan.kind,
      status: job.status,
      completed: job.completed,
      total: JSON.parse(plan.manifest_json).length,
      error_code: job.error_code,
      spend,
      available,
      source_branch_id: plan.branch_id,
      source_head_id: plan.head_id,
      source_hash: plan.source_hash,
      older_edition:
        plan.branch_id !== current.branch.id ||
        plan.head_id !== current.branch.head_beat_id,
      download_url: available
        ? `/api/fiction/${id}/listening/jobs/${job.id}/file`
        : null,
    };
  }
  function diskSpace(estimate, cacheEstimate = estimate) {
    const space = fs.statfsSync(directory);
    if (space.bavail * space.bsize < estimate + 32 * 1024 * 1024)
      fail(
        "Not enough free disk space for this listening plan.",
        "AUDIO_DISK_LOW",
        413,
      );
    const retained = db
      .prepare(
        "SELECT (SELECT coalesce(sum(byte_size),0) FROM fiction_audio_cache)+(SELECT coalesce(sum(byte_size),0) FROM fiction_listening_jobs) AS n",
      )
      .get().n;
    if (retained + estimate + cacheEstimate > 4 * 1024 * 1024 * 1024)
      fail(
        "The installation audio cache is full. Keep downloads and review storage before preparing more.",
        "AUDIO_STORAGE_LIMIT",
        413,
      );
  }
  function start(id, input) {
    keys(input, ["plan_id", "action_key"], "Start listening preparation");
    const key = text(input.action_key, "Action key", 200);
    const job = tx(() => {
      const previous = db
        .prepare(
          "SELECT * FROM fiction_listening_jobs WHERE game_id=? AND action_key=?",
        )
        .get(id, key);
      if (previous) {
        if (previous.plan_id !== input.plan_id)
          fail(
            "This action key belongs to another listening plan.",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        return previous;
      }
      const plan = planRow(id, input.plan_id);
      if (
        db
          .prepare("SELECT id FROM fiction_listening_jobs WHERE plan_id=?")
          .get(plan.id)
      )
        fail(
          "This plan was already started. Review its edition or explicitly prepare a new plan for missing segments.",
          "AUDIO_ALREADY_STARTED",
          409,
        );
      if (
        db
          .prepare(
            "SELECT id FROM fiction_listening_jobs WHERE game_id=? AND status IN ('requested','running')",
          )
          .get(id)
      )
        fail(
          "A listening preparation is already active for this story.",
          "AUDIO_BUSY",
          409,
        );
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM fiction_listening_jobs WHERE status IN ('requested','running')",
          )
          .get().n >= 20
      )
        fail("The listening queue is full.", "AUDIO_QUEUE_FULL", 409);
      const pre = preview(id, plan.id);
      if (pre.missing_unreviewed_cache)
        fail(
          "A previously cached segment is missing. Cancel this plan and review a new one.",
          "AUDIO_CACHE_MISSING",
          409,
        );
      if (pre.purchase_segments)
        configuration(JSON.parse(plan.configuration_json), {
          credentialOptional: false,
        });
      diskSpace(
        plan.estimated_bytes,
        pre.purchase_segments ? plan.estimated_bytes : 0,
      );
      const jobId = randomUUID();
      db.prepare(
        "INSERT INTO fiction_listening_jobs(id,game_id,plan_id,action_key,status) VALUES(?,?,?,?,'requested')",
      ).run(jobId, id, plan.id, key);
      return jobRow(id, jobId);
    });
    queueMicrotask(pump);
    return view(id, job.id);
  }
  function cancel(id, jobId) {
    const job = jobRow(id, jobId);
    db.prepare(
      "UPDATE fiction_listening_jobs SET status='cancelled',error_code='CANCELLED' WHERE id=? AND status IN ('requested','running')",
    ).run(job.id);
    return view(id, job.id);
  }
  async function collect(stream) {
    let total = 0;
    const chunks = [];
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_SEGMENT) {
        stream.destroy?.();
        fail(
          "The charged segment exceeded its 16 MiB limit. Completed cached segments are retained.",
          "AUDIO_STREAM_TOO_LARGE",
          413,
        );
      }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (
      !bytes.length ||
      !(
        bytes.subarray(0, 3).toString() === "ID3" ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      )
    )
      fail(
        "The narrator returned an invalid MP3 segment. No fallback was purchased.",
        "AUDIO_INVALID_MEDIA",
        502,
      );
    validateMp3(bytes);
    return bytes;
  }
  async function run(job, token) {
    const plan = planRow(job.game_id, job.plan_id);
    const config = JSON.parse(plan.configuration_json);
    const manifest = JSON.parse(plan.manifest_json);
    let assembled = 0;
    const storage = randomUUID() + ".mp3";
    const destination = file(storage);
    const staging = destination + ".tmp";
    const digest = createHash("sha256");
    let fd = null;
    let published = false;
    try {
      fd = fs.openSync(staging, "wx", 0o600);
    } catch (error) {
      db.prepare(
        "UPDATE fiction_listening_jobs SET status='failed',error_code='AUDIO_DISK_ERROR' WHERE id=? AND status='running'",
      ).run(job.id);
      return;
    }
    try {
      for (let index = 0; index < manifest.length; index++) {
        if (
          disposed ||
          token !== incarnation ||
          jobRow(job.game_id, job.id).status !== "running"
        )
          return;
        const item = manifest[index];
        let audio = cache(item.cache_key);
        if (!audio) {
          if (!item.authorized_purchase)
            fail(
              "A reviewed cached segment is missing. Prepare a new plan.",
              "AUDIO_CACHE_MISSING",
              409,
            );
          if (
            plan.kind === "auto-read" &&
            store.current(job.game_id).branch.id !== plan.branch_id
          )
            fail(
              "Auto-read stopped because the active path changed.",
              "AUDIO_PATH_CHANGED",
              409,
            );
          const now = configuration(config, { credentialOptional: false });
          if (now.endpoint !== config.endpoint)
            fail(
              "The narrator endpoint changed. Prepare a new plan.",
              "AUDIO_PROVIDER_CHANGED",
              409,
            );
          diskSpace(Math.max(256 * 1024, item.text.length * 512));
          const callId = randomUUID();
          tx(() => {
            if (jobRow(job.game_id, job.id).status !== "running")
              fail("Listening was cancelled.", "AUDIO_CANCELLED", 409);
            db.prepare(
              "INSERT INTO fiction_audio_calls(id,job_id,segment_index,cache_key,model,status) VALUES(?,?,?,?,?,'dispatched')",
            ).run(callId, job.id, index, item.cache_key, config.model);
          });
          let cost = null,
            generationId = null,
            costChecked = false;
          try {
            const result = await ai.createSpeech({
              model: config.model,
              voice: config.voice,
              input: item.text,
              responseFormat: "mp3",
              noRetry: true,
            });
            generationId = result.generationId || null;
            if (!/^audio\/(mpeg|mp3)(?:;|$)/i.test(result.contentType || "")) {
              result.stream.destroy?.();
              fail(
                "The narrator returned an unsupported audio format.",
                "AUDIO_FORMAT_CHANGED",
                502,
              );
            }
            const buffer = await collect(result.stream);
            cost = await charge(config, generationId);
            costChecked = true;
            const previousCache = db
              .prepare(
                "SELECT storage_key FROM fiction_audio_cache WHERE cache_key=?",
              )
              .get(item.cache_key);
            const storage = randomUUID() + ".mp3";
            fs.writeFileSync(file(storage), buffer, {
              flag: "wx",
              mode: 0o600,
            });
            try {
              tx(() => {
                const existing = db
                  .prepare(
                    "SELECT storage_key FROM fiction_audio_cache WHERE cache_key=?",
                  )
                  .get(item.cache_key);
                if (existing)
                  db.prepare(
                    "DELETE FROM fiction_audio_cache WHERE cache_key=?",
                  ).run(item.cache_key);
                db.prepare(
                  "INSERT INTO fiction_audio_cache(cache_key,storage_key,sha256,byte_size,media_type) VALUES(?,?,?,?,?)",
                ).run(
                  item.cache_key,
                  storage,
                  hash(buffer),
                  buffer.length,
                  "audio/mpeg",
                );
                db.prepare(
                  "UPDATE fiction_audio_calls SET status=CASE WHEN status='dispatched' THEN 'succeeded' ELSE status END,cost_usd=?,generation_id=? WHERE id=?",
                ).run(
                  Number.isFinite(cost) && cost >= 0 ? cost : null,
                  generationId,
                  callId,
                );
              });
            } catch (error) {
              fs.rmSync(file(storage), { force: true });
              throw error;
            }
            if (previousCache && previousCache.storage_key !== storage)
              fs.rmSync(file(previousCache.storage_key), { force: true });
            audio = { buffer, byte_size: buffer.length };
          } catch (error) {
            if (!costChecked && generationId)
              cost = await charge(config, generationId);
            if (Number.isFinite(error.costUsd) && error.costUsd >= 0)
              cost = error.costUsd;
            db.prepare(
              "UPDATE fiction_audio_calls SET status=CASE WHEN status='dispatched' THEN 'failed' ELSE status END,cost_usd=?,generation_id=? WHERE id=?",
            ).run(
              Number.isFinite(cost) && cost >= 0 ? cost : null,
              generationId,
              callId,
            );
            throw error;
          }
        }
        // A completed dispatched call can populate private cache after Cancel, but never revive the edition.
        if (
          disposed ||
          token !== incarnation ||
          jobRow(job.game_id, job.id).status !== "running"
        )
          return;
        assembled += audio.byte_size;
        if (assembled > MAX_EDITION)
          fail(
            "This edition exceeded 512 MiB. Completed cached segments remain.",
            "AUDIO_EDITION_TOO_LARGE",
            413,
          );
        let offset = 0;
        while (offset < audio.buffer.length)
          offset += fs.writeSync(
            fd,
            audio.buffer,
            offset,
            audio.buffer.length - offset,
          );
        digest.update(audio.buffer);
        db.prepare(
          "UPDATE fiction_listening_jobs SET completed=? WHERE id=?",
        ).run(index + 1, job.id);
      }
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(staging, destination);
      const sha = digest.digest("hex");
      const result = db
        .prepare(
          "UPDATE fiction_listening_jobs SET status='succeeded',storage_key=?,sha256=?,byte_size=? WHERE id=? AND status='running'",
        )
        .run(storage, sha, assembled, job.id);
      published = Boolean(result.changes);
      if (!published) fs.rmSync(destination, { force: true });
    } catch (error) {
      if (!disposed && token === incarnation)
        db.prepare(
          "UPDATE fiction_listening_jobs SET status='failed',error_code=? WHERE id=? AND status IN ('requested','running')",
        ).run(error.code || "AUDIO_FAILED", job.id);
    } finally {
      if (fd !== null) fs.closeSync(fd);
      fs.rmSync(staging, { force: true });
      if (!published) fs.rmSync(destination, { force: true });
    }
  }
  async function pump() {
    if (working || disposed) return;
    working = true;
    const token = incarnation;
    try {
      while (!disposed && token === incarnation) {
        const next = db
          .prepare(
            "SELECT * FROM fiction_listening_jobs WHERE status='requested' ORDER BY rowid LIMIT 1",
          )
          .get();
        if (!next) break;
        const claimed = db
          .prepare(
            "UPDATE fiction_listening_jobs SET status='running' WHERE id=? AND status='requested' AND NOT EXISTS(SELECT 1 FROM fiction_listening_jobs WHERE status='running')",
          )
          .run(next.id);
        if (!claimed.changes) break;
        await run(next, token);
      }
    } finally {
      working = false;
      if (
        !disposed &&
        db
          .prepare(
            "SELECT id FROM fiction_listening_jobs WHERE status='requested' LIMIT 1",
          )
          .get()
      ) {
        queueTimer = setTimeout(pump, 250);
        queueTimer.unref?.();
      }
    }
  }
  function reconcile() {
    incarnation = randomUUID();
    db.prepare(
      "UPDATE fiction_listening_jobs SET status='interrupted',error_code='INTERRUPTED' WHERE status IN ('requested','running')",
    ).run();
    db.prepare(
      "UPDATE fiction_audio_calls SET status='interrupted' WHERE status='dispatched'",
    ).run();
  }
  function verify(id, jobId) {
    const job = jobRow(id, jobId);
    if (job.status !== "succeeded" || !job.storage_key)
      fail("This listening edition is not ready.", "AUDIO_NOT_READY", 409);
    let fd;
    const digest = createHash("sha256");
    let total = 0;
    try {
      fd = fs.openSync(file(job.storage_key), "r");
      const chunk = Buffer.alloc(65536);
      let size;
      while ((size = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        total += size;
        if (total > MAX_EDITION)
          fail("Invalid audio edition size.", "AUDIO_INTEGRITY_FAILED", 500);
        digest.update(chunk.subarray(0, size));
      }
    } catch (error) {
      if (error.code === "ENOENT")
        fail("The audio edition file is missing.", "AUDIO_FILE_MISSING", 404);
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    if (total !== job.byte_size || digest.digest("hex") !== job.sha256)
      fail(
        "The audio edition integrity check failed.",
        "AUDIO_INTEGRITY_FAILED",
        500,
      );
    return file(job.storage_key);
  }
  function read(id, jobId) {
    return fs.readFileSync(verify(id, jobId));
  }
  router.get("/api/fiction/listening/models", async (req, res, next) => {
    try {
      res.json({
        models: await ai.listSpeechModels(),
        generation: providers.exposure("narrator"),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(`${base}/plans`, async (req, res, next) => {
    try {
      res.status(201).json({ plan: await prepare(req.params.id, req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.get(`${base}/plans/:plan`, (req, res) =>
    res.json({ plan: preview(req.params.id, req.params.plan) }),
  );
  router.post(`${base}/jobs`, (req, res) =>
    res.status(201).json({ job: start(req.params.id, req.body) }),
  );
  router.post(`${base}/plans/:plan/cancel`, (req, res) => {
    const source = planRow(req.params.id, req.params.plan);
    let job = db
      .prepare("SELECT id FROM fiction_listening_jobs WHERE plan_id=?")
      .get(source.id);
    if (!job) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO fiction_listening_jobs(id,game_id,plan_id,action_key,status,error_code) VALUES(?,?,?,?,'cancelled','CANCELLED')",
      ).run(id, req.params.id, source.id, source.id);
      job = { id };
    }
    res.json({ job: cancel(req.params.id, job.id) });
  });
  router.get(`${base}/jobs`, (req, res) => {
    store.current(req.params.id);
    res.json({
      plans: db
        .prepare(
          "SELECT id FROM fiction_listening_plans p WHERE game_id=? AND NOT EXISTS(SELECT 1 FROM fiction_listening_jobs j WHERE j.plan_id=p.id) ORDER BY rowid DESC LIMIT 20",
        )
        .all(req.params.id)
        .map((row) => preview(req.params.id, row.id)),
      jobs: db
        .prepare(
          "SELECT id FROM fiction_listening_jobs WHERE game_id=? ORDER BY rowid DESC LIMIT 80",
        )
        .all(req.params.id)
        .map((row) => view(req.params.id, row.id)),
    });
  });
  router.get(`${base}/jobs/:job`, (req, res) =>
    res.json({ job: view(req.params.id, req.params.job) }),
  );
  router.post(`${base}/jobs/:job/cancel`, (req, res) =>
    res.json({ job: cancel(req.params.id, req.params.job) }),
  );
  router.get(`${base}/jobs/:job/file`, (req, res) =>
    res
      .set("Cache-Control", "private, no-store")
      .attachment("InkMorrow-listening-edition.mp3")
      .type("audio/mpeg")
      .sendFile(verify(req.params.id, req.params.job)),
  );
  return {
    router,
    prepare,
    preview,
    start,
    cancel,
    view,
    read,
    reconcile,
    pump,
    dispose() {
      disposed = true;
      clearTimeout(queueTimer);
      incarnation = randomUUID();
    },
  };
}
module.exports = { createListening };
