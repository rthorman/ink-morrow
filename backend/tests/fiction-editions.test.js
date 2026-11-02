"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const express = require("express"),
  request = require("supertest");
const { createDb, MIGRATIONS } = require("../src/db");
const { createFictionStore } = require("../src/modules/fiction/store");
const {
  createWorkspaceQueries,
} = require("../src/modules/fiction/workspace-queries");
const {
  createFictionPublication,
} = require("../src/modules/fiction/publication");
const { createEditions } = require("../src/modules/fiction/editions");
const { PUBLICATION_FORMATS } = require("../src/modules/publication/document");
const { rereadPublication } = require("../src/modules/publication/adapters");
describe("B7 frozen current-fiction books", () => {
  let root, db, store, story, editions, renderer, now;
  function service(extra = {}) {
    return createEditions({
      db,
      store,
      queries: createWorkspaceQueries({ db, store }),
      publication: createFictionPublication({
        store,
        media: {
          read() {
            throw Error("Missing fixture art");
          },
        },
      }),
      rootDir: root,
      shareBaseUrl: "https://reader.invalid",
      clock: () => now,
      ...extra,
    });
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fiction-editions-"));
    db = createDb(":memory:");
    store = createFictionStore(db);
    story = store.create({
      title: "The quiet gate",
      premise: "PRIVATE PREMISE",
      opening: "Jo opens the gate.\n\nRain collects in the stones.",
    });
    now = new Date("2026-11-02T12:00:00Z");
    editions = service();
  });
  afterEach(() => {
    editions.dispose();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const freeze = (extra) =>
    editions.snapshot(story.id, {
      branch_id: story.active_branch_id,
      inspection_at: story.head_beat_id,
      metadata: {
        title: "A frozen garden",
        author: "Fixture author",
        front_matter: [{ title: "Dedication", text: "For the garden." }],
        back_matter: [{ title: "Afterword", text: "The gate remains." }],
      },
      ...extra,
    });
  async function done(id) {
    for (let n = 0; n < 200; n++) {
      const job = editions.view(story.id, id);
      if (!["requested", "running"].includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error("Render did not finish");
  }
  test("one frozen reader-safe document renders every adapter without changing story authority", async () => {
    const before = store.view(story.id);
    const edition = freeze();
    expect(edition.metadata.title).toBe("A frozen garden");
    expect(edition.page_count).toBe(1);
    const stored = db
      .prepare("SELECT document_json FROM fiction_book_snapshots")
      .get().document_json;
    expect(stored).not.toContain("PRIVATE PREMISE");
    story = store.preferences(story.id, story.revision, {
      voice: "Changed after preview",
    });
    const job = editions.start(story.id, {
      snapshot_id: edition.id,
      formats: PUBLICATION_FORMATS,
      action_key: "all-nine",
    });
    const result = await done(job.id);
    expect(result.status).toBe("succeeded");
    expect(result.outputs).toHaveLength(9);
    for (const format of PUBLICATION_FORMATS) {
      const ready = editions.read(story.id, job.id, format);
      const output = fs.readFileSync(ready.filename);
      expect(output.length).toBeGreaterThan(0);
      const reread = await rereadPublication(format, output);
      expect(JSON.stringify(reread)).toContain("Jo opens the gate.");
    }
    expect(store.view(story.id).head_beat_id).toBe(story.head_beat_id);
    expect(before.revision + 1).toBe(story.revision);
    expect(
      db.prepare("SELECT document_json FROM fiction_book_snapshots").get()
        .document_json,
    ).toBe(stored);
    expect(editions.preview(story.id, edition.id).older_edition).toBe(true);
  });
  test("idempotency is bound to source and formats; verified cached reuse remains local", async () => {
    renderer = jest.fn(async () => ({
      buffer: Buffer.from("cached book"),
      contentType: "text/plain",
    }));
    editions.dispose();
    editions = service({ renderer });
    const edition = freeze();
    const input = {
      snapshot_id: edition.id,
      formats: ["txt"],
      action_key: "same",
    };
    const first = editions.start(story.id, input);
    await done(first.id);
    expect(editions.start(story.id, input).id).toBe(first.id);
    expect(() =>
      editions.start(story.id, { ...input, formats: ["md"] }),
    ).toThrow("another edition");
    const second = editions.start(story.id, { ...input, action_key: "second" });
    await done(second.id);
    expect(renderer).toHaveBeenCalledTimes(1);
    const bytes = editions.read(story.id, first.id, "txt");
    fs.writeFileSync(bytes.filename, "X".repeat(bytes.byte_size));
    expect(() => editions.read(story.id, first.id, "txt")).toThrow(
      "missing or damaged",
    );
    const third = editions.start(story.id, { ...input, action_key: "repair" });
    expect((await done(third.id)).status).toBe("succeeded");
    expect(renderer).toHaveBeenCalledTimes(2);
  });
  test("partial errors retain good formats and cancellation fences late rendering", async () => {
    let release;
    renderer = jest.fn(async (doc, format) => {
      if (format === "pdf") throw Error("Fixture renderer failed");
      return { buffer: Buffer.from("ready"), contentType: "text/plain" };
    });
    editions.dispose();
    editions = service({ renderer });
    const edition = freeze();
    const first = editions.start(story.id, {
      snapshot_id: edition.id,
      formats: ["pdf", "txt"],
      action_key: "partial",
    });
    const result = await done(first.id);
    expect(result.status).toBe("failed");
    expect(result.outputs.find((o) => o.format === "txt").available).toBe(true);
    editions.dispose();
    editions = service({
      renderer: () =>
        new Promise((r) => {
          release = r;
        }),
    });
    const late = editions.start(story.id, {
      snapshot_id: edition.id,
      formats: ["md"],
      action_key: "late",
    });
    await new Promise((r) => setImmediate(r));
    expect(release).toBeDefined();
    editions.cancel(story.id, late.id);
    release({ buffer: Buffer.from("late"), contentType: "text/plain" });
    await new Promise((r) => setImmediate(r));
    expect(editions.view(story.id, late.id)).toMatchObject({
      status: "cancelled",
      outputs: [],
    });
  });
  test("restart interrupts without automatic rendering; deleting an edition cannot unlink another pin", async () => {
    const edition = freeze();
    const first = editions.start(story.id, {
      snapshot_id: edition.id,
      formats: ["txt"],
      action_key: "pin1",
    });
    await done(first.id);
    story = store.preferences(story.id, story.revision, {
      voice: "Later private preference",
    });
    const secondEdition = freeze();
    const second = editions.start(story.id, {
      snapshot_id: secondEdition.id,
      formats: ["txt"],
      action_key: "pin2",
    });
    await done(second.id);
    expect(editions.read(story.id, second.id, "txt").filename).toBe(
      editions.read(story.id, first.id, "txt").filename,
    );
    editions.remove(story.id, edition.id);
    expect(editions.read(story.id, second.id, "txt").filename).toBeTruthy();
    const queued = editions.start(story.id, {
      snapshot_id: secondEdition.id,
      formats: ["md"],
      action_key: "interrupted",
    });
    editions.reconcile();
    await new Promise((r) => setImmediate(r));
    expect(editions.view(story.id, queued.id).status).toBe("interrupted");
  });
  test("public capabilities expose only frozen reader-safe content, expire and revoke", async () => {
    const edition = freeze();
    const link = editions.share(story.id, edition.id, { expires_in_days: 1 });
    const token = new URL(link.url).hash.slice(1);
    expect(
      JSON.stringify(db.prepare("SELECT * FROM fiction_reading_shares").get()),
    ).not.toContain(token);
    const app = express();
    app.use(editions.publicRouter);
    app.use((e, req, res, next) =>
      res.status(e.statusCode || 500).json({ error: e.code }),
    );
    expect((await request(app).get("/api/fiction-reading-copy")).status).toBe(
      404,
    );
    let response = await request(app)
      .get("/api/fiction-reading-copy")
      .set("Authorization", "Share " + token);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    expect(JSON.stringify(response.body)).not.toContain(story.id);
    expect(response.body.document.metadata.title).toBe("A frozen garden");
    now = new Date(now.getTime() + 86400001);
    expect(
      (
        await request(app)
          .get("/api/fiction-reading-copy")
          .set("Authorization", "Share " + token)
      ).status,
    ).toBe(404);
    const next = editions.share(story.id, edition.id, {});
    editions.revoke(story.id, edition.id, next.id);
    expect(
      (
        await request(app)
          .get("/api/fiction-reading-copy")
          .set("Authorization", "Share " + new URL(next.url).hash.slice(1))
      ).status,
    ).toBe(404);
  });
  test("migration 29 rolls back and preserves schema-28 graph and immutable ledger", () => {
    const file = path.join(root, "old.db");
    fs.copyFileSync(
      path.join(__dirname, "fixtures/recovery/schema-28.db"),
      file,
    );
    const baseline = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "fixtures/recovery/baseline-28.json"),
      ),
    );
    const migrations = MIGRATIONS.map((m) => ({ ...m }));
    const last = migrations.find((m) => m.version === 29),
      up = last.up;
    last.up = (handle) => {
      up(handle);
      throw Error("Injected interruption");
    };
    expect(() => createDb(file, { migrations })).toThrow(
      "Injected interruption",
    );
    const { DatabaseSync } = require("node:sqlite");
    const raw = new DatabaseSync(file);
    expect(raw.prepare("PRAGMA user_version").get().user_version).toBe(28);
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='fiction_book_snapshots'",
        )
        .get(),
    ).toBeUndefined();
    raw.close();
    const updated = createDb(file);
    try {
      expect(
        updated
          .prepare(
            "SELECT * FROM schema_migrations WHERE version<=28 ORDER BY version",
          )
          .all(),
      ).toEqual(baseline.ledger);
      expect(updated.prepare("SELECT * FROM fiction_games").get()).toEqual(
        baseline.game,
      );
      expect(
        updated.prepare("SELECT * FROM fiction_beats ORDER BY rowid").all(),
      ).toEqual(baseline.beats);
    } finally {
      updated.close();
    }
  });
});
