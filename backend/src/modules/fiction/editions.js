"use strict";
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { keys, text, fail } = require("./model");
const { PUBLICATION_FORMATS } = require("../publication/document");
const { renderPublication } = require("../publication/adapters");
const { bookInput } = require("./book-input");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function createEditions({
  db,
  store,
  queries,
  publication,
  media = null,
  listening = null,
  rootDir,
  shareBaseUrl = null,
  renderer = renderPublication,
  clock = () => new Date(),
}) {
  const router = express.Router(),
    publicRouter = express.Router();
  const base = "/api/fiction/:id/editions";
  const directory = path.join(rootDir, "fiction-books");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let working = false,
    disposed = false,
    queueTimer = null;
  let incarnation = randomUUID();
  let publicOrigin = null;
  if (shareBaseUrl) {
    const parsed = new URL(shareBaseUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw Error(
        "PUBLIC_SHARE_BASE_URL must be an HTTP(S) origin without a path or credentials.",
      );
    publicOrigin = parsed.origin;
  }
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
  const file = (key) => {
    if (
      !/^[a-f0-9-]{36}\.(?:docx|odt|rtf|epub|pdf|html|md|txt|json)$/.test(key)
    )
      fail("Invalid book file.");
    return path.join(directory, key);
  };
  function row(game, id) {
    return (
      db
        .prepare(
          "SELECT * FROM fiction_book_snapshots WHERE game_id=? AND id=?",
        )
        .get(game, id) ||
      fail("Book edition not found.", "BOOK_EDITION_MISSING", 404)
    );
  }
  function job(game, id) {
    return (
      db
        .prepare(
          "SELECT j.* FROM fiction_book_jobs j JOIN fiction_book_snapshots s ON s.id=j.snapshot_id WHERE s.game_id=? AND j.id=?",
        )
        .get(game, id) || fail("Book job not found.", "BOOK_JOB_MISSING", 404)
    );
  }
  function decode(snapshot) {
    const bytes = snapshot.document_json;
    if (hash(bytes) !== snapshot.document_hash)
      fail(
        "The saved book source integrity check failed.",
        "BOOK_SOURCE_DAMAGED",
        500,
      );
    return JSON.parse(bytes);
  }
  function snapshot(game, input) {
    keys(
      input,
      ["branch_id", "inspection_at", "metadata"],
      "Freeze book edition",
    );
    // The source document and embedded media freeze synchronously within one read cut.
    return tx(() => {
      const ctx = queries.context(game, {
        branch_id: input.branch_id,
        inspection_at: input.inspection_at,
      });
      const details = bookInput(input.metadata || {}, ctx.game.title);
      const document = publication.documentAt(ctx, details);
      const json = JSON.stringify(document);
      if (Buffer.byteLength(json) > 96 * 1024 * 1024)
        fail(
          "This edition exceeds the 96 MiB snapshot limit.",
          "BOOK_TOO_LARGE",
          413,
        );
      const digest = hash(json);
      const existing = db
        .prepare(
          "SELECT id FROM fiction_book_snapshots WHERE game_id=? AND branch_id=? AND head_id IS ? AND document_hash=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(game, ctx.viewBranch.id, ctx.head, digest);
      if (existing) return preview(game, existing.id);
      const size = db
        .prepare(
          "SELECT count(*) AS n,coalesce(sum(byte_size),0) AS bytes FROM fiction_book_snapshots",
        )
        .get();
      if (
        size.n >= 1000 ||
        size.bytes + Buffer.byteLength(json) > 512 * 1024 * 1024
      )
        fail(
          "Retained book sources are full. Download or remove older retained editions before freezing another.",
          "BOOK_STORAGE_LIMIT",
          413,
        );
      const id = randomUUID();
      const contents = document.volumes.flatMap((volume) =>
        volume.chapters.map((chapter) => ({
          volume_title: volume.title,
          title: chapter.title,
          pages: chapter.pages.length,
        })),
      );
      const info = {
        metadata: document.metadata,
        front_matter: details.front_matter,
        back_matter: details.back_matter,
        chapter_count: contents.length,
        page_count: contents.reduce((n, c) => n + c.pages, 0),
        contents,
        art: document.assets.map((asset) => ({
          key: asset.key,
          alt_text: asset.alt_text,
        })),
        sample:
          document.volumes[0]?.chapters[0]?.pages[0]?.blocks
            .filter((block) => block.type === "paragraph")
            .slice(0, 3)
            .map((block) => block.text.slice(0, 1000)) || [],
        exclusions:
          "Only this frozen path’s narrative prose, grouping, cover/placed art and approved front/back matter enter books and reading links. Hidden state, directions, Ask, private portraits, other paths, credentials and audio are excluded. Prose itself can contain fictional secrets.",
      };
      db.prepare(
        "INSERT INTO fiction_book_snapshots(id,game_id,branch_id,head_id,document_hash,document_json,byte_size,preview_json) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        game,
        ctx.viewBranch.id,
        ctx.head,
        digest,
        json,
        Buffer.byteLength(json),
        JSON.stringify(info),
      );
      return preview(game, id);
    });
  }
  function preview(game, id, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      fail("Invalid contents page.");
    const source =
      db
        .prepare(
          "SELECT id,game_id,branch_id,head_id,document_hash,preview_json,created_at FROM fiction_book_snapshots WHERE game_id=? AND id=?",
        )
        .get(game, id) ||
      fail("Book edition not found.", "BOOK_EDITION_MISSING", 404);
    const info = JSON.parse(source.preview_json);
    const current =
      db
        .prepare(
          "SELECT b.id AS branch_id,b.head_beat_id FROM fiction_games g JOIN fiction_branches b ON b.id=g.active_branch_id WHERE g.id=?",
        )
        .get(game) || fail("Story not found.", "STORY_MISSING", 404);
    return {
      ...info,
      id,
      game_id: game,
      source_branch_id: source.branch_id,
      source_head_id: source.head_id,
      document_hash: source.document_hash,
      older_edition:
        source.branch_id !== current.branch_id ||
        source.head_id !== current.head_beat_id,
      created_at: source.created_at,
      contents: info.contents.slice(offset, offset + 80),
      next_offset: info.contents.length > offset + 80 ? offset + 80 : null,
      art: info.art.map((asset) => ({
        ...asset,
        preview_url: `/api/fiction/${game}/editions/${id}/assets/${asset.key}`,
      })),
      formats: PUBLICATION_FORMATS,
      sharing_available: Boolean(publicOrigin),
    };
  }
  function intact(info) {
    if (!info || !info.available) return false;
    try {
      return fs.statSync(file(info.storage_key)).size === info.byte_size;
    } catch {
      return false;
    }
  }
  function view(game, id) {
    const source = job(game, id);
    const snapshot = db
      .prepare(
        "SELECT branch_id,head_id FROM fiction_book_snapshots WHERE id=?",
      )
      .get(source.snapshot_id);
    const current =
      db
        .prepare(
          "SELECT b.id AS branch_id,b.head_beat_id FROM fiction_games g JOIN fiction_branches b ON b.id=g.active_branch_id WHERE g.id=?",
        )
        .get(game) || fail("Story not found.", "STORY_MISSING", 404);
    const outputs = db
      .prepare(
        "SELECT o.format,o.status,o.error_code,f.storage_key,f.byte_size,f.sha256,f.available FROM fiction_book_outputs o LEFT JOIN fiction_book_files f ON f.storage_key=o.storage_key WHERE o.job_id=? ORDER BY o.rowid",
      )
      .all(id);
    return {
      id,
      snapshot_id: source.snapshot_id,
      status: source.status,
      error_code: source.error_code,
      formats: JSON.parse(source.formats_json),
      older_edition:
        snapshot.branch_id !== current.branch_id ||
        snapshot.head_id !== current.head_beat_id,
      outputs: outputs.map((output) => ({
        format: output.format,
        status: output.status,
        available: intact(output),
        byte_size: output.byte_size,
        error_code: output.error_code,
        download_url:
          output.status === "ready"
            ? `/api/fiction/${game}/editions/jobs/${id}/files/${output.format}`
            : null,
      })),
    };
  }
  function start(game, input) {
    keys(
      input,
      ["snapshot_id", "formats", "action_key"],
      "Build frozen edition",
    );
    const action = text(input.action_key, "Build action key", 200);
    if (
      !Array.isArray(input.formats) ||
      !input.formats.length ||
      input.formats.length > 9 ||
      new Set(input.formats).size !== input.formats.length ||
      input.formats.some((format) => !PUBLICATION_FORMATS.includes(format))
    )
      fail("Choose one or more supported book formats.");
    const formats = [...input.formats].sort();
    const encoded = JSON.stringify(formats);
    const id = tx(() => {
      row(game, input.snapshot_id);
      const old = db
        .prepare(
          "SELECT id,snapshot_id,formats_json FROM fiction_book_jobs WHERE action_key=?",
        )
        .get(action);
      if (old) {
        if (
          old.snapshot_id !== input.snapshot_id ||
          old.formats_json !== encoded
        )
          fail(
            "This build key belongs to another edition or format selection.",
            "IDEMPOTENCY_CONFLICT",
            409,
          );
        job(game, old.id);
        return old.id;
      }
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM fiction_book_jobs WHERE status IN ('requested','running')",
          )
          .get().n >= 20
      )
        fail("The book rendering queue is full.", "BOOK_BUSY", 409);
      if (
        db.prepare("SELECT count(*) AS n FROM fiction_book_jobs").get().n >=
        10000
      )
        fail(
          "Retained rendering history is full. Remove older editions before building another.",
          "BOOK_STORAGE_LIMIT",
          413,
        );
      const id = randomUUID();
      db.prepare(
        "INSERT INTO fiction_book_jobs(id,snapshot_id,action_key,formats_json,status) VALUES(?,?,?,?,'requested')",
      ).run(id, input.snapshot_id, action, encoded);
      return id;
    });
    queueMicrotask(pump);
    return view(game, id);
  }
  function cancel(game, id) {
    job(game, id);
    db.prepare(
      "UPDATE fiction_book_jobs SET status='cancelled',error_code='CANCELLED' WHERE id=? AND status IN ('requested','running')",
    ).run(id);
    return view(game, id);
  }
  function verified(info) {
    if (!intact(info)) {
      if (info)
        db.prepare(
          "UPDATE fiction_book_files SET available=0 WHERE storage_key=?",
        ).run(info.storage_key);
      return false;
    }
    let fd;
    const digest = createHash("sha256");
    let total = 0;
    try {
      fd = fs.openSync(file(info.storage_key), "r");
      const buffer = Buffer.alloc(65536);
      let size;
      while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        total += size;
        if (total > 256 * 1024 * 1024) break;
        digest.update(buffer.subarray(0, size));
      }
      if (total === info.byte_size && digest.digest("hex") === info.sha256)
        return true;
    } catch {
      /* Unavailable bytes cannot become reusable artifacts. */
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    db.prepare(
      "UPDATE fiction_book_files SET available=0 WHERE storage_key=?",
    ).run(info.storage_key);
    return false;
  }
  function read(game, id, format) {
    const source = job(game, id);
    if (!JSON.parse(source.formats_json).includes(format))
      fail("Book format not found.", "BOOK_FILE_MISSING", 404);
    const info = db
      .prepare(
        "SELECT f.* FROM fiction_book_outputs o JOIN fiction_book_files f ON f.storage_key=o.storage_key WHERE o.job_id=? AND o.format=? AND o.status='ready' AND f.available=1",
      )
      .get(id, format);
    if (!verified(info))
      fail(
        "This rendered file is missing or damaged. Build the selected format again explicitly.",
        "BOOK_FILE_MISSING",
        404,
      );
    return { ...info, filename: file(info.storage_key) };
  }
  async function run(source, token) {
    const snapshot = db
      .prepare("SELECT * FROM fiction_book_snapshots WHERE id=?")
      .get(source.snapshot_id);
    if (!snapshot) return;
    let failed = false;
    for (const format of JSON.parse(source.formats_json)) {
      if (
        disposed ||
        token !== incarnation ||
        db
          .prepare("SELECT status FROM fiction_book_jobs WHERE id=?")
          .get(source.id)?.status !== "running"
      )
        return;
      let stored = null,
        created = false;
      try {
        const candidates = db
          .prepare(
            "SELECT f.* FROM fiction_book_files f JOIN fiction_book_outputs o ON o.storage_key=f.storage_key JOIN fiction_book_jobs j ON j.id=o.job_id JOIN fiction_book_snapshots s ON s.id=j.snapshot_id WHERE s.document_hash=? AND o.format=? AND o.status='ready' AND f.available=1 ORDER BY o.rowid DESC LIMIT 10",
          )
          .all(snapshot.document_hash, format);
        stored = candidates.find(verified) || null;
        if (!stored) {
          const rendered = await renderer(decode(snapshot), format);
          if (
            !Buffer.isBuffer(rendered.buffer) ||
            !rendered.buffer.length ||
            rendered.buffer.length > 256 * 1024 * 1024
          )
            fail(
              "The renderer returned an invalid or oversized file.",
              "BOOK_RENDER_INVALID",
              500,
            );
          if (
            disposed ||
            token !== incarnation ||
            db
              .prepare("SELECT status FROM fiction_book_jobs WHERE id=?")
              .get(source.id)?.status !== "running"
          )
            return;
          const free = fs.statfsSync(directory);
          if (
            free.bavail * free.bsize <
            rendered.buffer.length + 32 * 1024 * 1024
          )
            fail(
              "Not enough space to retain this rendered book.",
              "BOOK_DISK_LOW",
              413,
            );
          const size = db
            .prepare(
              "SELECT coalesce(sum(byte_size),0) AS n FROM fiction_book_files WHERE available=1",
            )
            .get().n;
          if (size + rendered.buffer.length > 2 * 1024 * 1024 * 1024)
            fail(
              "Retained book files are full. Remove older editions before building another.",
              "BOOK_STORAGE_LIMIT",
              413,
            );
          stored = {
            storage_key: randomUUID() + "." + format,
            sha256: hash(rendered.buffer),
            byte_size: rendered.buffer.length,
            content_type: rendered.contentType,
            format,
          };
          const staging = file(stored.storage_key) + ".tmp";
          try {
            fs.writeFileSync(staging, rendered.buffer, {
              flag: "wx",
              mode: 0o600,
            });
            const fd = fs.openSync(staging, "r+");
            try {
              fs.fsyncSync(fd);
            } finally {
              fs.closeSync(fd);
            }
            fs.renameSync(staging, file(stored.storage_key));
            created = true;
          } finally {
            fs.rmSync(staging, { force: true });
          }
        }
        tx(() => {
          if (
            db
              .prepare("SELECT status FROM fiction_book_jobs WHERE id=?")
              .get(source.id)?.status !== "running"
          )
            fail("Book rendering was cancelled.", "BOOK_CANCELLED", 409);
          if (created)
            db.prepare(
              "INSERT INTO fiction_book_files(storage_key,sha256,byte_size,content_type,format) VALUES(?,?,?,?,?)",
            ).run(
              stored.storage_key,
              stored.sha256,
              stored.byte_size,
              stored.content_type,
              format,
            );
          db.prepare(
            "INSERT INTO fiction_book_outputs(job_id,format,status,storage_key) VALUES(?,?,'ready',?)",
          ).run(source.id, format, stored.storage_key);
        });
      } catch (error) {
        if (
          created &&
          stored &&
          !db
            .prepare(
              "SELECT storage_key FROM fiction_book_files WHERE storage_key=?",
            )
            .get(stored.storage_key)
        )
          fs.rmSync(file(stored.storage_key), { force: true });
        if (
          disposed ||
          token !== incarnation ||
          db
            .prepare("SELECT status FROM fiction_book_jobs WHERE id=?")
            .get(source.id)?.status !== "running"
        )
          return;
        failed = true;
        db.prepare(
          "INSERT OR IGNORE INTO fiction_book_outputs(job_id,format,status,error_code) VALUES(?,?,'failed',?)",
        ).run(source.id, format, error.code || "BOOK_RENDER_FAILED");
      }
    }
    db.prepare(
      "UPDATE fiction_book_jobs SET status=?,error_code=? WHERE id=? AND status='running'",
    ).run(
      failed ? "failed" : "succeeded",
      failed ? "BOOK_PARTIAL_FAILURE" : null,
      source.id,
    );
  }
  async function pump() {
    if (disposed || working) return;
    working = true;
    const token = incarnation;
    try {
      while (!disposed && token === incarnation) {
        const next = db
          .prepare(
            "SELECT * FROM fiction_book_jobs WHERE status='requested' ORDER BY rowid LIMIT 1",
          )
          .get();
        if (!next) break;
        const claimed = db
          .prepare(
            "UPDATE fiction_book_jobs SET status='running' WHERE id=? AND status='requested' AND NOT EXISTS(SELECT 1 FROM fiction_book_jobs WHERE status='running')",
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
            "SELECT id FROM fiction_book_jobs WHERE status='requested' LIMIT 1",
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
      "UPDATE fiction_book_jobs SET status='interrupted',error_code='INTERRUPTED' WHERE status IN ('requested','running')",
    ).run();
  }
  function remove(game, id) {
    const count = tx(() => {
      row(game, id);
      const files = db
        .prepare(
          "SELECT DISTINCT o.storage_key FROM fiction_book_outputs o JOIN fiction_book_jobs j ON j.id=o.job_id WHERE j.snapshot_id=? AND o.storage_key IS NOT NULL",
        )
        .all(id);
      const shares = db
        .prepare(
          "SELECT count(*) AS n FROM fiction_reading_shares WHERE snapshot_id=?",
        )
        .get(id).n;
      db.prepare("DELETE FROM fiction_book_snapshots WHERE id=?").run(id);
      const unused = [];
      for (const item of files) {
        if (
          !db
            .prepare(
              "SELECT job_id FROM fiction_book_outputs WHERE storage_key=? LIMIT 1",
            )
            .get(item.storage_key)
        ) {
          db.prepare(
            "UPDATE fiction_book_files SET available=0 WHERE storage_key=?",
          ).run(item.storage_key);
          unused.push(item.storage_key);
        }
      }
      return { shares, files: unused };
    });
    for (const key of count.files) {
      try {
        fs.unlinkSync(file(key));
      } catch {
        /* Marked unavailable before unlink; never remove retained references. */
      }
    }
    return { removed: true, revoked_links: count.shares };
  }
  function shares(game, id) {
    row(game, id);
    return db
      .prepare(
        "SELECT id,expires_at,revoked_at,created_at FROM fiction_reading_shares WHERE snapshot_id=? ORDER BY (revoked_at IS NULL AND expires_at>?) DESC,rowid DESC LIMIT 100",
      )
      .all(id, clock().toISOString())
      .map((item) => ({
        ...item,
        status: item.revoked_at
          ? "revoked"
          : Date.parse(item.expires_at) <= clock().getTime()
            ? "expired"
            : "active",
      }));
  }
  function share(game, id, input) {
    if (!publicOrigin)
      fail(
        "Reading links are unavailable on this installation. Local books and saves remain available.",
        "SHARING_UNAVAILABLE",
        503,
      );
    keys(input, ["expires_in_days"], "Reading link");
    const days = input.expires_in_days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 365)
      fail("Choose an expiry from 1 to 365 days.");
    row(game, id);
    if (
      db
        .prepare(
          "SELECT count(*) AS n FROM fiction_reading_shares WHERE snapshot_id=? AND revoked_at IS NULL AND expires_at>?",
        )
        .get(id, clock().toISOString()).n >= 100
    )
      fail(
        "This edition has reached its retained link limit. Revoke old links or create another edition.",
        "SHARE_LIMIT",
        413,
      );
    const token = randomBytes(32).toString("base64url"),
      shareId = randomUUID();
    const expiry = new Date(clock().getTime() + days * 86400000).toISOString();
    db.prepare(
      "INSERT INTO fiction_reading_shares(id,snapshot_id,capability_hash,expires_at) VALUES(?,?,?,?)",
    ).run(shareId, id, hash(token), expiry);
    return {
      id: shareId,
      expires_at: expiry,
      status: "active",
      url: publicOrigin + "/reading-copy#" + token,
      warning:
        "Anyone with this link can read this frozen edition until expiry or revocation. Revocation cannot retract downloaded copies.",
    };
  }
  function revoke(game, id, shareId) {
    row(game, id);
    if (
      !db
        .prepare(
          "SELECT id FROM fiction_reading_shares WHERE snapshot_id=? AND id=?",
        )
        .get(id, shareId)
    )
      fail("Reading link not found.", "SHARE_MISSING", 404);
    db.prepare(
      "UPDATE fiction_reading_shares SET revoked_at=coalesce(revoked_at,?) WHERE id=?",
    ).run(clock().toISOString(), shareId);
    return { revoked: true };
  }
  function bookshelf({ kind = "all", offset = 0 } = {}) {
    if (
      !["all", "book", "audio", "art"].includes(kind) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 1000000
    )
      fail("Invalid Bookshelf page.");
    const rows = db
      .prepare(
        `SELECT * FROM (
      SELECT 'book' AS kind,s.id,s.game_id,s.branch_id,s.head_id,s.created_at FROM fiction_book_snapshots s
      UNION ALL SELECT 'audio',j.id,j.game_id,p.branch_id,p.head_id,j.created_at FROM fiction_listening_jobs j JOIN fiction_listening_plans p ON p.id=j.plan_id
      UNION ALL SELECT 'art',a.id,a.game_id,NULL,NULL,a.created_at FROM fiction_assets a
    ) WHERE (?='all' OR kind=?) ORDER BY created_at DESC,kind,id LIMIT 21 OFFSET ?`,
      )
      .all(kind, kind, offset);
    return {
      items: rows.slice(0, 20).map((item) => {
        const game = db
          .prepare(
            "SELECT g.title,g.active_branch_id,b.head_beat_id FROM fiction_games g JOIN fiction_branches b ON b.id=g.active_branch_id WHERE g.id=?",
          )
          .get(item.game_id);
        const common = {
          ...item,
          story_title: game.title,
          older_edition:
            item.kind === "art"
              ? null
              : item.branch_id !== game.active_branch_id ||
                item.head_id !== game.head_beat_id,
        };
        if (item.kind === "book") {
          const jobs = db
            .prepare(
              `SELECT id FROM fiction_book_jobs WHERE id IN (
 SELECT id FROM fiction_book_jobs WHERE snapshot_id=? ORDER BY rowid DESC LIMIT 1)
 UNION SELECT job_id AS id FROM (
 SELECT o.job_id,row_number() OVER(PARTITION BY o.format ORDER BY o.rowid DESC) AS rank
 FROM fiction_book_outputs o JOIN fiction_book_jobs j ON j.id=o.job_id WHERE j.snapshot_id=? AND o.status='ready') WHERE rank=1`,
            )
            .all(item.id, item.id)
            .map((j) => view(item.game_id, j.id));
          return {
            ...common,
            title: preview(item.game_id, item.id).metadata.title,
            jobs,
            status:
              db
                .prepare(
                  "SELECT status FROM fiction_book_jobs WHERE snapshot_id=? ORDER BY rowid DESC LIMIT 1",
                )
                .get(item.id)?.status || "preview",
          };
        }
        if (item.kind === "audio")
          return { ...common, audio: listening.view(item.game_id, item.id) };
        const asset = db
          .prepare(
            "SELECT i.alt_text,a.storage_key,a.byte_size FROM fiction_inventory i JOIN fiction_assets a ON a.id=i.asset_id WHERE a.id=?",
          )
          .get(item.id);
        let available = false;
        try {
          available =
            Boolean(media) &&
            fs.statSync(media.assetPath(asset.storage_key)).size ===
              asset.byte_size;
        } catch {
          /* Owner can see unavailable art without downloading it. */
        }
        const uses = db
          .prepare(
            `SELECT coalesce(json_extract(j.value,'$.kind'),'passage') AS kind FROM fiction_beats b,json_each(b.state_json,'$.visuals') j WHERE b.id=? AND json_extract(j.value,'$.asset_id')=?
          UNION ALL SELECT 'passage' FROM fiction_beats b,json_each(b.state_json,'$.illustrations') j WHERE b.id=? AND json_extract(j.value,'$.asset_id')=? LIMIT 10`,
          )
          .all(game.head_beat_id, item.id, game.head_beat_id, item.id)
          .map((use) => use.kind);
        return {
          ...common,
          available,
          current_uses: uses,
          title: asset?.alt_text || "Retained story art",
          preview_url: `/api/fiction/${item.game_id}/assets/${item.id}/thumbnail`,
          download_url: `/api/fiction/${item.game_id}/images/${item.id}`,
          privacy: uses.some((kind) =>
            ["world", "character", "scribe"].includes(kind),
          )
            ? "Private reference art on the active path; reference portraits are excluded from books."
            : "Owner-only collection; inclusion in a book requires placement and a new preview.",
        };
      }),
      next_offset: rows.length > 20 ? offset + 20 : null,
    };
  }
  router.get("/api/fiction/bookshelf", (req, res) =>
    res.json(
      bookshelf({
        kind: req.query.kind || "all",
        offset: Number(req.query.offset || 0),
      }),
    ),
  );
  publicRouter.get("/api/fiction-reading-copy", (req, res) => {
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    const token = /^Share ([A-Za-z0-9_-]{43})$/.exec(
      req.get("Authorization") || "",
    )?.[1];
    if (!publicOrigin || !token)
      return res
        .status(404)
        .json({ error: "This reading link is unavailable." });
    const share = db
      .prepare(
        "SELECT s.document_json,s.document_hash FROM fiction_reading_shares r JOIN fiction_book_snapshots s ON s.id=r.snapshot_id WHERE r.capability_hash=? AND r.revoked_at IS NULL AND r.expires_at>?",
      )
      .get(hash(token), clock().toISOString());
    if (!share)
      return res
        .status(404)
        .json({ error: "This reading link is unavailable." });
    res.json({ document: decode(share) });
  });
  router.post(base, (req, res) =>
    res.status(201).json({ edition: snapshot(req.params.id, req.body) }),
  );
  router.get(base, (req, res) => {
    store.current(req.params.id);
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
      fail("Invalid edition page.");
    const rows = db
      .prepare(
        "SELECT id FROM fiction_book_snapshots WHERE game_id=? ORDER BY rowid DESC LIMIT 21 OFFSET ?",
      )
      .all(req.params.id, offset);
    res.json({
      editions: rows
        .slice(0, 20)
        .map((item) => preview(req.params.id, item.id)),
      next_offset: rows.length > 20 ? offset + 20 : null,
      sharing_available: Boolean(publicOrigin),
    });
  });
  router.post(`${base}/jobs`, (req, res) =>
    res.status(201).json({ job: start(req.params.id, req.body) }),
  );
  router.get(`${base}/jobs/:job`, (req, res) =>
    res.json({ job: view(req.params.id, req.params.job) }),
  );
  router.post(`${base}/jobs/:job/cancel`, (req, res) =>
    res.json({ job: cancel(req.params.id, req.params.job) }),
  );
  router.get(`${base}/jobs/:job/files/:format`, (req, res) => {
    const ready = read(req.params.id, req.params.job, req.params.format);
    res
      .set("Cache-Control", "private, no-store")
      .attachment("InkMorrow-book." + ready.format)
      .type(ready.content_type)
      .sendFile(ready.filename);
  });
  router.get(`${base}/:edition`, (req, res) =>
    res.json({
      edition: preview(
        req.params.id,
        req.params.edition,
        Number(req.query.offset || 0),
      ),
      jobs: db
        .prepare(
          "SELECT id FROM fiction_book_jobs WHERE snapshot_id=? ORDER BY rowid DESC LIMIT 80",
        )
        .all(req.params.edition)
        .map((item) => view(req.params.id, item.id)),
      shares: shares(req.params.id, req.params.edition),
    }),
  );
  router.get(`${base}/:edition/assets/:asset`, (req, res) => {
    const document = decode(row(req.params.id, req.params.edition));
    const asset =
      document.assets.find((item) => item.key === req.params.asset) ||
      fail("Book image not found.", "IMAGE_NOT_FOUND", 404);
    res
      .set("Cache-Control", "private, no-store")
      .type(asset.media_type)
      .send(Buffer.from(asset.content_base64, "base64"));
  });
  router.post(`${base}/:edition/remove`, (req, res) =>
    res.json(remove(req.params.id, req.params.edition)),
  );
  router.post(`${base}/:edition/shares`, (req, res) =>
    res
      .status(201)
      .json({ share: share(req.params.id, req.params.edition, req.body) }),
  );
  router.post(`${base}/:edition/shares/:share/revoke`, (req, res) =>
    res.json(revoke(req.params.id, req.params.edition, req.params.share)),
  );

  return {
    router,
    publicRouter,
    bookshelf,
    snapshot,
    preview,
    start,
    view,
    cancel,
    read,
    remove,
    shares,
    share,
    revoke,
    reconcile,
    pump,
    dispose() {
      disposed = true;
      incarnation = randomUUID();
      clearTimeout(queueTimer);
    },
  };
}
module.exports = { createEditions };
