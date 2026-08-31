# Project archives and full backups (4.0 format v2)

The ScribeTribe 4.0 release line uses one versioned project-archive format for moving a single asset, a linked bundle, or the entire local installation. Archives use the `.scribetribe` suffix. They remain ZIP containers holding ordinary JSON plus optional image and MP3 files; they are not raw SQLite copies.

The installation password and browser sessions never enter an archive. Archive encryption is not part of format version 2, so treat an exported file according to what its review screen says it contains.

Format v2 is a clean break: ScribeTribe 4.0 does not import the 3.x
`scribetribe-portable-archive` v1 format. Use ScribeTribe 3.2.2 to read a v1
archive. PR 01 establishes the v2 identity and strict manifest scaffold; later
4.0 implementation PRs extend its domain aggregates before beta release.

## Export scopes and dependency rules

| Scope | Always included | User choice |
|---|---|---|
| Character | Character and their home world, if any | Paintings; working history (normally off); audio remains visible but has no effect because a character has none |
| World | World | None, some, or all characters whose catalogue home is that world; paintings; working history; audio remains visible but has no effect |
| Story | Story, every committed page/revision, ready revision continuity, author corrections, story-local world/cast snapshots, story world, every current cast member, and each cast member's different home world | Paintings/plates; audiobook MP3; working history |
| Full backup | Every world, character, story, page/revision, ready continuity delta, correction, template snapshot, and sanitized device setting | Paintings/plates; audiobook MP3; working history |

Story continuity is functional data, not optional history. A story would narrate differently without it, so ready current-revision deltas, story-local templates, and author corrections always travel. Immutable page-revision ancestry and canonical/display pointers are likewise authored manuscript evidence and always travel. Prepared pages are not committed story state and travel only with working history. Truncation-recovery suffixes and undo credentials are private local safety state and never enter portable archives.

The UI defaults portable entity exports to paintings on, audio off, and working history off. A full backup defaults all three on. Audio is always an explicit switch because an audiobook can be much larger than the remaining archive.

## What “working history” means

When enabled, an archive can contain:

- author directions for generated pages;
- a paid, prepared next page that has not yet been committed;
- writing and continuity model identifiers;
- prompt/completion token counts and recorded costs;
- image-generation prompts;
- continuity extraction diagnostics and errors.

When disabled, the authored manuscript, complete revision ancestry, canonical/display choices, and ready continuity state remain, but direction, model, token, cost, and diagnostic provenance fields are cleared. Audiobook model and voice remain when audio is included because they describe the file; its cost trace is cleared.

API keys, provider credentials, encrypted vault entries/wrapping material, passwords, and the remembered paid-action-consent flag never enter an archive. Full backups carry only the application's explicit settings whitelist (model choices, reading appearance, word target, narrator choice, reasoning level, render quality, and cost-ticker preference).

## Exposure review

Creating an export plan does not download anything. The review reports:

- worlds, characters, stories, pages, and continuity rows;
- image and audio file counts;
- whether directions/model-and-cost history/device settings are present;
- external home worlds pulled in for a cross-world cast;
- the estimated uncompressed byte count;
- the credential categories that are excluded.

The reviewed download is streamed. Image and MP3 files are read directly from disk and stored without another compression pass, limiting heap use and CPU work on small machines.

## Archive layout

Format identifier: `scribetribe-project-archive`

Current format version: `2`

```text
manifest.json
objects/
  worlds/<opaque-key>.json
  characters/<opaque-key>.json
  stories/<opaque-key>.json
assets/
  images/worlds/*
  images/characters/*
  images/covers/*
  images/pages/*
  audio/*.mp3
```

`manifest.json` declares `manifest_schema_version: 1`, the source
`database_schema` family/version, every entity, dependency, file path, byte
count, SHA-256 digest, and semantic digest. The checked-in
`archive-manifest-v2.schema.json` is the machine-readable field contract. Story
JSON is an aggregate containing its story row, ordered volume/chapter/page
hierarchy, immutable revision ancestry with canonical/display pointers,
temporary ordered compatibility prose rows, story-local world/cast snapshots, continuity
rows, optional prepared page, and optional ready-audiobook metadata.
Hierarchy identities and scoped ordinals are functional manuscript data, not
working history, so they always travel. Derived continuity search/FTS rows,
projection checkpoints, and impact issues are not exported; they are rebuilt locally from verified revision deltas during
import.

3.x, unknown-family, and future format/manifest/database versions are rejected
rather than guessed at. A schema-1 `scribetribe-4` kernel archive is the one
supported older case: it predates hierarchy and revision behavior, so import
gives each story the accepted Volume I / Chapter I default and synthesizes one
canonical/display revision per page while preserving page order. Schema-2
archives retain hierarchy and receive the same one-revision-per-page upgrade.
A future format can add an explicit migration without binding portable data to
an old SQLite layout.

## Import preflight and collision choices

An upload is first written to a staging directory and extracted there. Preflight performs no database or catalogue writes. It validates the ZIP structure, declared paths, allowed media types, object shapes, relationships, safe IDs, sizes, compression ratios, and every SHA-256 digest.

Each top-level entity receives one classification:

| Classification | Default | Available choices |
|---|---|---|
| New identity and name | Add | Add with original identity; import as a new copy |
| New identity, same name | Add with warning | Add with original identity; import as a new copy |
| Identical data and included media | Reuse local | Reuse local; import as a new copy |
| Same identity, different data or included media | Import copy | Keep local; import as a new copy; replace local |

“Identical” ignores timestamps, an entity's own primary ID, and story-page IDs (pages are compared in manuscript order), but retains dependency identities so differently linked graphs are not collapsed. It compares the meaningful fields, ordered manuscript, snapshots, continuity, optional working history, and every media file selected for this archive. If visuals or audio were deliberately left out, that omitted category does not create a collision.

ScribeTribe does not perform field-level world/character merges or page-level story splices. A divergent story is kept, copied, or replaced as one manuscript. Copying generates new IDs for the entity, volumes, chapters, pages, and revisions; every world, cast, story-local template, correction citation, continuity character/revision reference, override key, plate, cover, and audiobook reference is remapped as one dependency graph.

## Merge and full restore

Merge applies the reviewed per-entity choices. Database changes occur in one SQLite transaction. Incoming media is copied to temporary sibling files first; replaced files move to a rollback area; only then are files installed and rows committed. A failure rolls the database back and restores the moved files.

A full-backup import additionally offers **Replace everything**. Before changing local data, ScribeTribe automatically writes a complete safety archive of the current installation, including current ready media and working history. The completion dialog provides its download link. Safety archives remain under `database/transfers/backups/` until the owner removes them.

Import and export never call an AI model and never incur provider charges.

## Local staging and limits

Transient uploads and extracted content live under `database/transfers/uploads/` and `database/transfers/staging/`. They are removed after commit/cancel, after a 15-minute idle token expiry, or when the server next starts after an interruption. Safety backups are not transient.

The importer rejects absolute paths, `..` traversal, backslash paths, duplicate paths, symbolic links, undeclared files, unsupported media, suspicious expansion ratios, excessive entry counts, oversized JSON, and imports that would exhaust the staging filesystem. Media remains on disk throughout preflight; only bounded JSON records are parsed into memory.

## HTTP endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/transfers/exports/plan` | Validate scope/options, resolve dependencies, and return exposure plus a short-lived download token |
| GET | `/api/transfers/exports/:token` | Stream the reviewed `.scribetribe` once |
| POST | `/api/transfers/imports/preflight` | Multipart upload (`archive` file; optional `current_settings` JSON), verify/stage, and return collisions |
| POST | `/api/transfers/imports/:token/commit` | Apply merge/replace-all and collision resolutions |
| DELETE | `/api/transfers/imports/:token` | Cancel and remove staged content |
| GET | `/api/transfers/safety-backups/:filename` | Download an automatically created pre-restore safety archive |
