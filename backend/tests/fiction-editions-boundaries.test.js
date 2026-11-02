"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const request = require("supertest"),
  sharp = require("sharp");
const { createDb } = require("../src/db");
const { createFictionStore } = require("../src/modules/fiction/store");
const { createFictionMedia } = require("../src/modules/fiction/media");
const {
  createFictionPublication,
} = require("../src/modules/fiction/publication");
const {
  createWorkspaceQueries,
} = require("../src/modules/fiction/workspace-queries");
const { createEditions } = require("../src/modules/fiction/editions");
const { createTestApp, setupOwner } = require("./helpers");
describe("B7 source and owner boundaries", () => {
  let root, db, store, media, editions, story;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "edition-boundaries-"));
    db = createDb(":memory:");
    store = createFictionStore(db);
    media = createFictionMedia({ db, store, rootDir: root });
    editions = createEditions({
      db,
      store,
      publication: createFictionPublication({ store, media }),
      queries: createWorkspaceQueries({ db, store }),
      rootDir: root,
    });
    story = store.create({
      title: "Branch garden",
      premise: "A quiet garden.",
      opening: "The gate opens.",
    });
  });
  afterEach(() => {
    editions.dispose();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  test("an inactive path freezes without activation and rejects sibling/future moments", () => {
    const earlier = story;
    story = store.preferences(story.id, story.revision, {
      voice: "Original future",
    });
    const future = story.head_beat_id;
    story = store.fork(story.id, story.revision, {
      name: "Earlier fork",
      beat_id: earlier.head_beat_id,
    });
    const revision = story.revision;
    const edition = editions.snapshot(story.id, {
      branch_id: earlier.active_branch_id,
      inspection_at: future,
    });
    expect(edition.source_branch_id).toBe(earlier.active_branch_id);
    expect(store.view(story.id)).toMatchObject({
      revision,
      active_branch_id: story.active_branch_id,
    });
    expect(() =>
      editions.snapshot(story.id, {
        branch_id: story.active_branch_id,
        inspection_at: future,
      }),
    ).toThrow("not on the selected path");
  });
  test("embedded placed art stays available after source media disappears; new preflight fails visibly", async () => {
    const file = path.join(root, "upload.png");
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#876" },
    })
      .png()
      .toFile(file);
    story = await media.upload(
      story.id,
      story.revision,
      { path: file, mediaType: "image/png" },
      { beat_id: story.head_beat_id, alt_text: "The garden gate" },
    );
    const edition = editions.snapshot(story.id, {});
    expect(edition.art).toHaveLength(1);
    const asset = db.prepare("SELECT * FROM fiction_assets").get();
    fs.unlinkSync(media.assetPath(asset.storage_key));
    const frozen = JSON.parse(
      db.prepare("SELECT document_json FROM fiction_book_snapshots").get()
        .document_json,
    );
    expect(
      Buffer.from(frozen.assets[0].content_base64, "base64").length,
    ).toBeGreaterThan(0);
    expect(() =>
      editions.snapshot(story.id, { metadata: { title: "Missing art" } }),
    ).toThrow();
    expect(
      db.prepare("SELECT count(*) AS n FROM fiction_book_snapshots").get().n,
    ).toBe(1);
  });
  test("Bookshelf is bounded and never selects full immutable source JSON", () => {
    for (let n = 0; n < 23; n++)
      editions.snapshot(story.id, { metadata: { title: "Edition " + n } });
    const statements = [];
    const original = db.prepare.bind(db);
    db.prepare = (sql) => {
      statements.push(sql);
      return original(sql);
    };
    const page = editions.bookshelf({ kind: "book" });
    expect(page.items).toHaveLength(20);
    expect(page.next_offset).toBe(20);
    expect(
      statements.some(
        (sql) =>
          sql.includes("document_json") ||
          /SELECT \* FROM fiction_book_snapshots/.test(sql),
      ),
    ).toBe(false);
    expect(editions.bookshelf({ kind: "book", offset: 20 }).items).toHaveLength(
      3,
    );
  });
});
describe("B7 production router boundaries", () => {
  let fixture;
  afterEach(() => fixture?.close());
  test("private edition APIs require owner/CSRF while the capability adapter is independently revocable", async () => {
    fixture = createTestApp({
      legacyEnabled: false,
      authRequired: true,
      publicShareBaseUrl: "https://reading.invalid",
    });
    const { app, db } = fixture;
    const store = createFictionStore(db);
    const story = store.create({ scenario_id: "garden-after-rain" });
    expect((await request(app).get("/api/fiction/bookshelf")).status).toBe(401);
    const agent = request.agent(app);
    const session = await setupOwner(agent, app);
    expect(
      (await agent.post(`/api/fiction/${story.id}/editions`).send({})).status,
    ).toBe(403);
    const csrf = { "X-InkMorrow-CSRF": session.csrf_token };
    const edition = await agent
      .post(`/api/fiction/${story.id}/editions`)
      .set(csrf)
      .send({});
    expect(edition.status).toBe(201);
    const link = await agent
      .post(
        `/api/fiction/${story.id}/editions/${edition.body.edition.id}/shares`,
      )
      .set(csrf)
      .send({ expires_in_days: 7 });
    expect(link.status).toBe(201);
    const token = new URL(link.body.share.url).hash.slice(1);
    const response = await request(app)
      .get("/api/fiction-reading-copy")
      .set("Authorization", "Share " + token);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect((await request(app).get("/api/fiction/" + story.id)).status).toBe(
      401,
    );
    expect(
      (await request(app).get("/api/public/share/legacy")).status,
    ).not.toBe(200);
    await agent
      .post(
        `/api/fiction/${story.id}/editions/${edition.body.edition.id}/shares/${link.body.share.id}/revoke`,
      )
      .set(csrf)
      .send({});
    expect(
      (
        await request(app)
          .get("/api/fiction-reading-copy")
          .set("Authorization", "Share " + token)
      ).status,
    ).toBe(404);
  });
  test("unconfigured reading copies fail independently of frozen local books", async () => {
    fixture = createTestApp({ legacyEnabled: false, publicShareBaseUrl: null });
    const { app, db } = fixture;
    const story = createFictionStore(db).create({
      scenario_id: "garden-after-rain",
    });
    const edition = await request(app)
      .post(`/api/fiction/${story.id}/editions`)
      .send({});
    expect(edition.status).toBe(201);
    expect(edition.body.edition.sharing_available).toBe(false);
    const link = await request(app)
      .post(
        `/api/fiction/${story.id}/editions/${edition.body.edition.id}/shares`,
      )
      .send({});
    expect(link.status).toBe(503);
    expect(
      (
        await request(app)
          .get("/api/fiction-reading-copy")
          .set("Authorization", "Share " + "a".repeat(43))
      ).status,
    ).toBe(404);
  });
});
