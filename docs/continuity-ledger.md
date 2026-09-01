# Continuity ledger v2

Ink Morrow 4.0 treats immutable canonical page revisions as the evidence
boundary for continuity. Prose remains the primary record. Deltas, search
rows, projections, checkpoints, and issues are derived local data that can be
rebuilt without rewriting prose or asking an AI to replay the manuscript.

## Layers and precedence

| Layer | Purpose | Mutation rule |
|---|---|---|
| Library template | Reusable world or character material | Library edits never silently change an existing story |
| Story template snapshot | The world/cast reference accepted for this story | Created on assignment; later fields import only after explicit review |
| Canonical revision | Immutable prose that can establish story truth | Only the active tail can advance this pointer |
| Display revision | Exported/read prose, including historical copyedits | A copyedit advances display only and does not replace continuity |
| Revision delta | Archivist output for one canonical revision | One row per canonical revision, with direct quotations as evidence |
| Author correction | Author-owned authoritative state | Separate from extraction; wins without changing evidence or prose |
| Continuity issue | Deterministic warning about later possible conflict | Derived from a correction; contains no automatic edit |

The active projection folds only deltas whose revisions are the current
canonical pointers. Historical replaced-tail deltas remain inspectable in
working history but cannot affect current state.

## Versioned Archivist schema

Schema version 2 is a strict JSON object. Unknown keys, missing keys, wrong
types, invalid enum values, characters outside the story snapshot, and durable
items without evidence are rejected. It contains:

- a factual summary;
- events with stable IDs, involved character IDs, importance and type;
- character location, condition, knowledge, possessions, appearance,
  personality, and relationship changes;
- goal, thread, and world-fact updates;
- arc movement (`advance`, `setback`, `turning_point`, or `resolution`); and
- one to five short direct page quotations for every durable item.

The server requests provider JSON Schema support and also validates the parsed
reply locally. A schema-invalid successful reply gets one corrective attempt.
Fresh installations assign `google/gemini-2.5-flash-lite` to the Archivist by
default because it supports structured output, a long context, and an explicit
no-reasoning mode. Existing installations keep their saved role assignment.
If a chosen model cannot accept JSON Schema, the server makes one strict
plain-JSON fallback and applies the same local validation; invalid data is
never folded into canon and remains visibly repairable.
If that fails, the canonical page remains valid and its delta becomes
`failed`, with its provider spend retained.

Schema-1 rows from 3.2 archives remain readable and migrate to canonical
revision provenance. New extraction writes schema 2.

## Canon and mutation semantics

- Prepared prose is speculative and has no page revision or continuity row.
- Commit returns canonical prose before optional Archivist work finishes.
- A client sync joins the same in-flight revision job; it cannot buy a second
  extraction for that revision.
- Historical copyediting changes only the display pointer. Its established
  canonical delta stays active.
- A substantive tail edit creates a new canonical revision. The former delta
  remains historical and the new revision reports pending until extracted.
- Regeneration writes against the projection before the replaced tail and
  changes canon only after successful prose generation.
- Deletion and truncation cascade removed revision deltas. The surviving
  projection rolls back locally and deterministically.
- Corrections never mutate extracted evidence, templates, or prose.

There is no AI rollback or whole-novel replay.

## Deterministic projection and retrieval

Ready current-revision deltas fold in manuscript order. The fold operation is
pure: the same ordered deltas produce the same projection hash. Sparse
checkpoints are stored every 50 pages plus the active head. Each checkpoint
keeps compact current state and at most 200 inspection events/summaries, while
separate counters preserve full coverage totals. Checkpoints are disposable
and can be rebuilt from deltas.

Normal prompt construction reads the current checkpoint, recent displayed
prose, compact active state, unresolved threads, and at most six older FTS
matches. It does not scan or resend the manuscript. FTS5 is preferred; a
bounded indexed table with `LIKE` is the local fallback.

An explicit rebuild performs no provider call. Missing or failed revision
deltas still require deliberate sequential repair because extraction is paid
work.

## Corrections and impact analysis

A correction identifies its scope, subject, field, authoritative value,
optional reason, and cited page revisions. It is applied after the extracted
fold. Impact analysis deterministically searches later display revisions and
deltas for the affected subject and prior state, producing open issues with
matched terms and revision provenance. It never invents an edit. Authors may
acknowledge or resolve each issue separately.

## Template review

Cast templates are frozen as story-local snapshots. World fields stay live
until explicitly pinned by a Codex edit or accepted Library change. The review
API compares each current Library row with the latest story snapshot. Import
must name at least one accepted field, and only those fields are copied into a
new snapshot. Unselected world fields keep following the Library.

## Portable archives

Story archives carry revision ancestry, story-local world/character
snapshots, revision deltas, corrections, and every author-canon revision. Copy import remaps page,
revision, world, and character references. Search rows, FTS indexes,
checkpoints, and impact issues are derived and rebuilt locally. Credentials
and secret-vault material remain excluded.

## API

| Method | Route | Result |
|---|---|---|
| `GET` | `/api/stories/:id/continuity` | Coverage, snapshots, projection, evidence, author canon, corrections, issues, and bounded history |
| `POST` | `/api/stories/:id/continuity/pages/:pageId/sync` | Extract or repair the current canonical revision |
| `POST` | `/api/stories/:id/continuity/rebuild` | Rebuild deterministic local checkpoints; no AI call |
| `DELETE` | `/api/stories/:id/continuity` | Clear derived deltas, search, and checkpoints only |
| `GET` | `/api/stories/:id/continuity/templates` | Review later Library changes field by field |
| `POST` | `/api/stories/:id/continuity/templates/:kind/:sourceId/import` | Import explicitly selected template fields |
| `PUT` | `/api/stories/:id/continuity/templates/:kind/:sourceId` | Edit selected manuscript-local Foundation fields |
| `POST` | `/api/stories/:id/continuity/author-canon` | Create a versioned author-canon entry |
| `PUT` | `/api/stories/:id/continuity/author-canon/:entryId` | Append a new revision without overwriting history |
| `DELETE` | `/api/stories/:id/continuity/author-canon/:entryId` | Retire an entry while preserving its revisions |
| `POST` | `/api/stories/:id/continuity/corrections` | Add an authoritative correction and analyze impact |
| `PATCH` | `/api/stories/:id/continuity/issues/:issueId` | Acknowledge or resolve a derived issue |
| `POST` | `/api/stories/:id/continuity/issues/summary` | Optional paid plain-language summary of selected warnings; changes nothing |
| `PUT` | `/api/stories/:id/continuity/overrides` | Compatibility route for the earlier compact correction form |

`story_pages.continuity_*` remains the current-page cost projection for
existing clients. Authoritative v2 spend and provenance live with the
revision delta.

The author-facing inspection and correction behavior is specified in
`docs/codex.md`.
