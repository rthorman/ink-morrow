# Ink Morrow 4.1.0

Ink Morrow 4.1.0 is the schema-13 canonical-storage release.

| Identity | Value |
|---|---|
| Application | `4.1.0` |
| Database family | `ink-morrow-4` |
| Database schema | `13` |
| Portable archive | `.inkmorrow` v2 |
| Node.js | 22.5 or newer |

## What changes

Schema 13 makes manuscript hierarchy, immutable page revisions, and revision-bound continuity deltas the only writable sources of prose and Chronicle memory. The former page and page-memory mirror tables are removed after migration proves that their canonical equivalents are complete. Existing page-shaped API responses come from a read-only database view; this keeps the interface stable without keeping two mutable copies of the same facts.

The portable archive remains v2. Its page and continuity projections are now derived from canonical records, so a full archive made on 4.0.x can be preflighted and restored by 4.1.0.

## Required upgrade sequence from 4.0.x

1. While the old installation is running, open **Gate** and create a **full** `.inkmorrow` backup. Include visuals, audio, and working history. Download it somewhere outside `DATA_DIR`.
2. Finish or cancel visible provider and publication jobs.
3. Stop Ink Morrow completely.
4. Copy the entire `DATA_DIR` to a dated, separate location. This is the complete rollback image; a database-only copy is not equivalent.
5. Record the old commit and Node.js version.
6. Pull the reviewed 4.1.0 code and install the exact lockfile dependencies.
7. Start 4.1.0 once against the same valid 4.0.x `DATA_DIR`. Schema 12 migrates transactionally to schema 13. The database does **not** empty.
8. Verify Library counts, manuscript titles and casts, several opening and tail pages, Chronicle coverage, Codex facts, Gallery placements, and Gate export.
9. Create a new full Gate backup after verification.

If startup refuses the database, stop. Preserve the exact error and file paths. Do not rename databases, edit schema metadata, delete a newly created file, or retry against guessed paths.

## Rollback

Stop Ink Morrow, restore the **whole** pre-upgrade cold `DATA_DIR` copy, and run the recorded old commit. Do not pair a database from one backup with media from another. Ink Morrow 4.0.x correctly refuses a schema-13 database as newer than it understands.

## Boundaries

- This is an in-place bridge for valid Ink Morrow 4.0.x databases, not for 3.x.
- 3.x databases and archive format v1 remain unsupported and are refused before migration writes.
- Existing `.inkmorrow` archive v2 backups remain supported.
- Migration 13 is atomic: validation or conversion failure rolls back the schema change.
