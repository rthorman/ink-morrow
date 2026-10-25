# Ink Morrow recovery — implementation guide

**Status:** planning guide 1.1, 25 October 2026. Guide 1.0 received two specialist review passes; this revision adds the stakeholder-requested final Version 4.1 baseline and preservation contracts. The 1.1 amendment has not received a third specialist pass. This document describes proposed work. It does not claim that the recovery is implemented or authorize deployment, server startup, paid model evaluation, or merging code. The two final-pass corrections and the remaining product-policy choices are recorded in the companion review record.

**Baseline:** current `main`, application 5.0.0, database family `ink-morrow-5`, schema 23, immutable fiction-state model and strict version-1 `.inkmorrow5` saves. The source baseline is `9647cdec4fc8ef4762e407e9c0ba705d563694fb`. Recheck the actual baseline before implementation; reserve new migration numbers only then.

**Stakeholder objective:** recover Version 4.1's visual identity, creative depth, usability and complete working journeys while retaining Version 5's reader-director, playable history, meaningful alternatives and explicit paid authority. A quiet reading experience and deep creative tools must coexist in one application.

The guide is organized so a developer can implement a coherent slice without rediscovering the product contract. Names of proposed files, tables and endpoints below are design contracts, not descriptions of existing APIs. Specialist review findings and their disposition belong in [ROUND-TABLE-REVIEW.md](ROUND-TABLE-REVIEW.md).

**Implementation tracking:** the stakeholder subsequently instructed proceeding with B1. [B0](B0-EXPERIENCE.md) and [B1](B1-DELIVERY.md) now have implementation/evidence records; later batches remain this engineering plan. B1 preserves current-state-only scope where richer queries are not yet implemented, and session-only drafts are not described as server saved.

**Implementation status after B2:** B0 remains the synthetic experience preview;
B1 is the production five-room workspace. [B2 delivery](B2-DELIVERY.md) now supplies
bounded read-only inspection, categorized Codex, new precise evidence, private
owner drafts, schema 24 and save-v2/v1 compatibility. Its endpoint/table choices
are recorded there and in source. The B3–B9 sections below remain a plan. Actual
Android, literary and deployment acceptance are separate from source/CI evidence.

## 1. Product boundary and decision status

### 1.1 What the recovery preserves

- Reader-director outside the cast by default; Follow and Steer work without an avatar.
- Optional, explicit Inhabit with Act/Say and an equally clear Release.
- Independent Story-shaping/Living-world, pacing, consequences, fourth-wall and quality choices.
- Immutable history, exact forks, authoritative local corrections, qualitative relationships and local return recaps.
- Current Visual Library studios, editable AI reference drafts, frozen selections, covers, passage art, safe image upload, nine publication formats and all-path saves.
- Authentication, provider vault, private reader projections, operation accounting, restart reconciliation and explicit provider exposure.

### 1.2 What changes

Restore the global Library and five stable story rooms: Desk, Chronicle, Codex, Gallery and Gate. Add reliable reading position, clear action scope, richer story-local references and craft, scene/editorial organization, precise evidence, collection-oriented media, listening and publication preparation. Existing utilities should support the restored journeys rather than remain a pile of isolated dialogs.

This work does not enable `legacyEnabled`, make old tables the current story authority, reinstate automatic successor purchases or boot image backfill, add per-character background agents, simulate time away, or require a compulsory writing wizard.

### 1.3 Explicit policy decisions

| Decision | Recommended default | Consequence before implementation |
|---|---|---|
| D1: optional wording edits | Include bounded copyediting; effective wording feeds recent prose context, with original facts/evidence authoritative. | Deliberately revises the earlier no-manual-prose rule. Acceptance includes this source policy and its semantic limitations in section 10. Record it and update product instructions before enabling the endpoint/UI. Core recovery does not depend on it. |
| D2: old-series conversion | Design a separate previewed copy importer after the core recovery. | Existing database-family checks remain. No in-place Version 4 adoption is permitted. |
| D3: reference images sent to AI | Keep text-only image requests in the initial recovery. | Explicit image conditioning is a separate extension with per-asset permission, selected references and a new reviewed plan. |
| D4: version and branch naming | Choose when the recovery contract is accepted. | This document assigns no new public release number and does not reopen abandoned branches. |

These are recorded design choices, not questions that block writing this guide. Most restoration work stays within existing product authority. A request to write and review this guide is not approval to change running behavior.

## 2. Invariants that every slice must preserve

| ID | Invariant |
|---|---|
| I01 | Exactly one authoritative fiction graph per story; every room uses the same story and path identities. |
| I02 | Existing beats and initial story state remain immutable. Revisions add records or new path history. |
| I03 | Reading cursor, browsed path, action branch/head and device presentation are separate concepts. |
| I04 | Reading, inspection, correction, organization, upload, export and return never implicitly buy generation. |
| I05 | Every paid dispatch has an explicit operation plan, durable identity, call ceiling, accounting and exact target. |
| I06 | Stale/late/duplicate work cannot mutate another context; a rejected result may still have a charge. |
| I07 | Reader views, provider context, owner planning, books and private saves are separate projections. |
| I08 | Reusable references and frozen story references are independent; adoption is field-reviewed and explicit. |
| I09 | Setup intent, proposed action, recorded outcome and supporting evidence remain distinct. |
| I10 | A character's fictional refusal cannot prevent the owner correcting state or operating the application. |
| I11 | A quiet passage can have no state effects. Episode closure remains the player's decision. |
| I12 | Historical data is preserved; strict save validation and data-family preflight are never weakened to obtain compatibility. |
| I13 | Prose remains readable at target tablet sizes, rotation, keyboard-open height, enlarged text and reduced motion. |
| I14 | A room is released only with a useful workflow, including loading, empty, failure and recovery states. |

## 3. Capability preservation and source ownership

| Capability | Reuse/adapt | New work and owning surface |
|---|---|---|
| Safe story commands | `fiction/store.js`, `service.js`, call ledger | Explicit destination contract, query separation, command replay coverage. |
| Adaptive shell | Retained `shell.js`, router concepts, shell CSS | New fiction workspace state/router; adapt components without booting the old app. |
| Studios | `fiction/library*`, current studio CSS | Full-height studio, field comparison, recoverable draft and setup handoff. |
| Chronicle | Retained bounded outline/excerpt patterns | Queries over fiction ancestry, stable narrative positions, scenes and paths. |
| Codex | Retained evidence cards, foundation diffs, correction patterns | Current-story query projections, source quotes and local reference revision commands. |
| Gallery | Current media persistence/normalization and retained collection patterns | Unplaced assets, collection queries, explicit path placements and media jobs. |
| Listening | Retained segmentation, cache and playback concepts | New snapshot-bound audio jobs, bounded transport and durable per-call billing. |
| Books/shares | `PublicationDocument`, format adapters, retained snapshot/share concepts | Current-fiction source selection, preview, jobs, immutable share projection. |
| Saves | Current complete graph validator and copy importer | Explicit portable versioning for every new reference and immutable collection. |
| Optional solo tools | Retained local dice/oracle/table/deck/fields/clock logic | B9 follow-on adapter that records immutable path results; no separate transcript authority. |

Current `frontend/app/fiction/app.js` should become a composer rather than continue accumulating every feature. Introduce focused modules under `frontend/app/fiction/`: `workspace-state.js`, `workspace-router.js`, `workspace-shell.js`, `reader.js`, `chronicle.js`, `codex.js`, `studio.js`, `gallery.js`, `listening.js`, and `gate.js`. Retain smaller influence, quality, provider, media and save utilities when their ownership stays clear. New code receives dependencies explicitly; it does not reach through a second app singleton.

Introduce focused backend query/command helpers under `backend/src/modules/fiction/`, including `workspace-queries.js`, `evidence.js`, `reference-revisions.js`, `editorial.js`, `context.js`, `drafts.js`, `audio-jobs.js` and `publication-jobs.js`. The existing composer remains responsible for mounting authenticated services and disposing their queues. Use domain-specific adapters around shared operation safeguards rather than forcing speech, text and image payloads into one artificial call type.

### 3.1 Final Version 4.1 is the historical comparator

Use **Version 4.1.0, database family `ink-morrow-4`, schema 18**, at the final pre-V5 main commit `74741f7`, now named by `archive/v4.1-pre-v5`. The exact full identity and retained branch records are in [BRANCH-CLEANUP.json](BRANCH-CLEANUP.json). This is a historical source snapshot, not a newly certified release or a promise to run an old database. The original `release/4.0.0` and beta tag remain immutable historical records; neither contains the complete later 4.1 experience.

The implementation target remains current V5 main. Shared history does not make the old runtime current: production continues with `legacyEnabled: false`. Read historical source using the archive tag; do not depend on pruned development branch names. [V4.1-BASELINE.md](V4.1-BASELINE.md) provides source links and comparative acceptance tasks.

### 3.2 Version 4.1 preservation matrix

| 4.1 capability / source | Recovery disposition and owner | Required evidence |
|---|---|---|
| Branded Library, five rooms and adaptive shell (`frontend/app/shell.js`, `core/router.js`) | Restore journeys through fiction workspace adapters, B0/B1 | Populated tablet comparison against 4.1; every current V5 task still reachable; no old bootstrap |
| Manuscript start, cast shape and Author Canon (`features/manuscript-start.js`, `modules/continuity/store.js`) | B1 start/return and B3 explicit story reference/fact management | No compulsory main character; supporting/background depth; private facts remain private; reference edits do not become narrated events |
| First-class Scribes and craft (`features/scribes.js`, `modules/scribes/`, `backend/src/prompt.js`) | B3 editable studios and versioned future-narration configuration | Field inventory from historical source, explicit adopt/revert and source-bound settings; persona/model/prose voice/speech voice distinct |
| Desk reading, page recovery, revision evidence (`features/write/`, `modules/stories/revisions.js`) | B1 reading/return, B2 history, B4 structure; optional copyediting still D1-gated | Return to exact passage; fork preserves original future; no prepared-successor purchase or manual-prose endpoint |
| Optional chapter-owned scenes (`modules/stories/scenes.js`, `docs/scenes.md`) | B3 scene frame and B4 contiguous editorial grouping | Empty plans allowed; grouping never creates events or alters prose; stable anchors; no forced scene wizard |
| Play Session Zero and Act/Say/Ask/Direct (`features/play.js`, `modules/play/`) | Translate ownership, intent and contribution boundaries into B3/V5 context compilation | Follow/Steer need no contract or avatar; Ask stays non-event; owned thoughts/actions respected; no parallel transcript or two-stage prose-promotion pipeline |
| Living campaign state (`modules/campaign/`, `docs/campaign-state.md`) | B2 evidence queries and B3 reviewed typed records; details in 3.3 | Stable identity/revisions, explicit visibility and evidence, correction/retirement, all-path save closure; no 4.1 main-character priority imposed on ensemble play |
| Alternate Play paths and prose shaping (`docs/play.md`) | Preserve exact ancestry, explicit successor intent and stale-result safeguards using V5 branches | Sibling history never leaks; paid stale results accounted; do not resurrect independent transcript paths or prepared-page authority |
| Dice, oracle, weighted table, deck, fields and clock (`modules/play/solo-tools.js`) | Explicit follow-on B9, not silently removed or claimed in B0–B8 | Local atomic command/results; deck/clock history preserved on fork/replay/save; no AI roll fabrication |
| Art collection/upload, narration and audiobooks (`modules/imagery/`, `modules/audio/`) | B5/B6 fiction-owned inventory and immutable editions | Upload/paint parity; unplaced art retained; cached audio free; no auto-generation or automatic synthesis |
| Publication, immutable shares, archives (`modules/publication/`, `modules/transfer/`) | B7 current-fiction adapters; all new data saves with its creating batch | Frozen reader-safe source, nine current formats preserved, local export independent; no legacy routes or old-family adoption |
| Later progress/loading/dismissal and async-transition fixes | B1/B8 lifecycle, error and tablet acceptance | Late completion never paints wrong room/story or loses submitted drafts; visible recoverable failures |

### 3.3 Campaign and optional-play adaptation contract

Before B3 implementation, inventory every 4.1 campaign kind: relationships, promises, debts, knowledge boundaries, secrets, NPC goals, factions, quests, conditions, inventory, resources, world time, deadlines and progress clocks. For each, specify its existing V5 equivalent or a new validated typed record, its public/private projection, lifecycle, evidence, serializer and UI destination. No generic free-text bucket may silently replace an unsupported type. B0 records any intentionally deferred kind and B8 must publish that limit; accepting the guide does not certify parity.

Use the same immutable branch-local fact/correction authority as other V5 state. Do not add a second mutable campaign ledger with competing truth. An owner-entered record identifies owner assertion and optional evidence, not model-confirmed reality. Proposed goals, intentions and plans cannot assert completion; knowledge records identify who knows and the narrated basis rather than broadcasting to all cast. Character expectations, promises and cooperation remain distinct. A private record never travels through reader, public recall, publication or ordinary illustration prompts. Factions and resources need stable identity and explicit updates; elapsed real time must not advance deadlines or clocks.

Campaign context retrieval remains bounded and ancestry-aware, with selected-scene relevance and explicit cast relevance rather than importing 4.1's compulsory Main/Supporting/Background retrieval priority. Preserve all durable records; the context working set is not storage history. Retiring or correcting a record appends a revision and does not erase its evidence. Follow-on model discovery, if offered, is an explicit separately reviewed purchase producing unsaved suggestions with exact source quotations. The local adoption/correction path is complete without it and never duplicates an existing automatic fact extractor.

For optional play, carry over the useful ownership promises in the V5 contribution/context boundary. Preserve current optional Inhabit and explicit Release, existing control rules and the performed/attempted speech contract in section 12. Do not require Session Zero to read, start, Follow or Steer, and do not buy a second narration to promote a transcript. Historical Play-to-Prose behavior is a comparison source, not an endpoint to remount. Old transcript import remains D2, with previewed omissions and no invented equivalence.

### 3.4 Version 4.1 parity gates

B0 produces a row-by-row capability ledger against this matrix, labelled **current V5**, **restored in batch**, **deliberately deferred**, or **policy gated** with a named batch/decision and observable acceptance task. B3 cannot be called creatively complete merely because studios render; craft, scene and campaign dispositions must be implemented or transparently deferred. B8 compares complete 4.1 and recovery journeys using retained source/fixtures and populated screens; untested historical runtime behavior is not treated as observed. A source comparison or mock transport does not certify live literary quality or real-tablet usability.

## 4. State model and authority

### 4.1 Workspace state

The client workspace contains:

| Field | Scope and meaning |
|---|---|
| `storyId` | Selected work. |
| `viewPathId` | Path currently being inspected, possibly during an operation on another action target. |
| `cursorBeatId` | Saved narrative passage being read; never a loaded-window array index. |
| `selectedHistoryBeatId` | Any selected Chronicle entry, including Ask or local history; separate from the nearest narrative cursor. |
| `inspectionAtBeatId` | Exact moment whose public facts/knowledge are being inspected. |
| `presentationMode`, `presentationHeadBeatId` | Current-path or historical wording/art, and its resolved immutable boundary. |
| `actionTarget` | `{branchId, expectedHeadBeatId, expectedRevision}` frozen when the user begins an action. |
| `room`, `inspector` | Device navigation only. |
| `draftKey` | Story, branch, contribution kind and expected narrative head. |
| `lifecycleEpoch` | Invalidates obsolete route, story and locked-session callbacks. |

Keep the current server-wide active branch as the mutation compatibility boundary for the first slices. Read-only browsing of another path does not change it. Continuing a different path is an explicit selection command, revision-checked before purchase. Do not silently make the server branch pointer per-tab without redesigning all mutation guards.

A free read may return a newer server revision while the user inspects an old passage. Updating the status strip is allowed; overwriting the cursor, draft or frozen action target is not. A stale target requires a refreshed review and explicit submission, never an automatic paid retry.

Every read resolves `(story, view branch, inspection head)` without changing `active_branch_id`. Return inspection head, branch head, latest narrative beat and global action target separately. The actual graph head can be a correction, Ask, reference or placement record after the latest narrative passage. `expected_head_beat_id` always names that actual graph head. A user at the latest narrative passage is still at the narrative tail even when local records follow it; do not misclassify that page as historical.

A command targeting branch B succeeds only if B is still globally active and its actual head and game revision match. Branch activation is a separate idempotent local command completed before a new purchase plan. Browsing another path never activates it. A stale tuple is never silently rebased. Each changing action names its destination; historical Codex/Chronicle inspection offers an explicit change at the chosen current head, after showing its current value, or Explore from this moment. An art/wording target can be an older passage while the new change is recorded at the current head; show both roles. The user can review an explicitly named latest target without being forced to scroll there, but an unqualified Continue beside historical text remains prohibited.

### 4.2 Durable narrative state

Continue using `fiction_games`, `fiction_branches`, immutable `fiction_beats`, pending requests and per-call accounting. Add optional snapshot fields through a versioned state reader/reducer. Old snapshots receive deterministic in-memory defaults; migrations do not rewrite their historical JSON.

Separate these concepts:

- **Scene:** location/time, present cast, perspective, immediate purpose and ongoing dramatic circumstances. Several passages may share a scene.
- **Episode:** a player's current question/focus, developments and chosen stopping point.
- **Editorial structure:** chapters and optional volumes grouping narrative passages for navigation and publication.
- **Presentation:** wording revisions and placements visible in a chosen path without rewriting the original evidence.

New branch-sensitive collections use immutable revision chains. The applicable collection head is held by that moment's state. Never select a collection by a global `latest` timestamp; that would leak changes made after a fork into its sibling.

### 4.3 Proposed persistence additions

Final DDL must be reviewed with the first schema slice. The following fields and ownership constraints are required:

| Record | Required fields and constraints |
|---|---|
| `fiction_effect_evidence` | Story, result beat, change ordinal, source kind, source beat/field, exact quotation, SHA-256 of immutable source bytes, visibility. Unique result-beat/change/source identity; source belongs to the same ancestry or the current request input. |
| `fiction_config_revisions` | Story, parent revision, producing beat, validated creative settings and scene context; immutable; bounded JSON. Snapshot points to this revision. |
| `fiction_reference_revisions` | Story, subject kind/ID, parent revision, producing beat, source template identity/revision when applicable, complete bounded fields. Snapshot holds at most one effective revision per world, Scribe and cast subject. |
| `fiction_editorial_revisions` | Story, parent revision, producing beat, bounded grouping changes. Snapshot points to the effective revision; passage identities remain stable. |
| `fiction_display_revisions` | Story, parent overlay revision, target narrative beat, producing beat, replacement text and content hash. Enabled only under D1; immutable chain resolves the latest applicable wording per target. |
| `fiction_owner_drafts` | Owner-scoped draft ID, typed scope, optional resource IDs, saved base revision, content/candidate/submitted revisions and expiry. Scopes cover new-story setup, catalogue new/edit, existing-story contribution and local-reference revision. Private and excluded from reader/books/saves. |
| `fiction_command_receipts` | Scoped local action key, canonical fingerprint, command kind, committed result identity and revision. Receipt commits atomically with a local mutation; never acquires the narration pending slot. |
| `fiction_import_receipts` | Owner-scoped import action key, content digest, format version and created-copy identity. Story and reference imports replay their existing copy rather than creating duplicates. |
| `fiction_media_jobs` / calls | Story, frozen source identity, purpose, plan hash, idempotency fingerprint, lifecycle, per-call known/unknown spend, result asset references. Paid fields survive failure/restart. |
| Gallery inventory metadata | Story-owned retained image membership and a separate concurrency version. It is noncanonical ownership metadata, not a fictional revision chain; ready unplaced assets require no producing beat. Bytes remain immutable. |
| `fiction_audio_assets` | Immutable edition/job ownership, exact text and synthesis identity, validated media type/size/hash, private storage key and ready state. Audio does not enter the image-only `fiction_assets` table. |
| `fiction_publication_snapshots` | Story, chosen branch/head, structure/display/art revisions, normalized reader-safe document hash, source manifest and private artifact references. Immutable. |

For schema economy, configuration and reference revision JSON share versioned validators. Cap each new configuration payload at 32 KiB UTF-8. Reference limits retain current per-field limits, with a 64 KiB UTF-8 ceiling per new reference and a bound of 24 cast members. Larger valid version-1 embedded baselines are evaluated by their original structural contract, not rejected through a new-record byte rule. Historical embedded `state.library` remains the baseline for old moments; new effective references resolve explicit revisions over that baseline. A reference revision cannot remove a cast identity or rewrite historical narrated facts merely by editing its description.

Editor/overlay chains require bounded resolution and rebuildable checkpoints. Store references to reusable immutable records in new snapshots instead of repeatedly copying large new collections. Do not normalize all existing snapshots speculatively; measure first.

### 4.4 Immutable collection and command rules

The following producer/parent/head rules apply to the four branch-scoped configuration, reference, editorial and display revision collections. They do not apply to draft records, Gallery inventory or immutable artifacts. Every such branch collection and its producing beat belong to the same story. A non-null parent has the same collection kind and subject, and its producer is a strict ancestor of the child's producer. Chains are acyclic and end in a defined root. A snapshot may select a head produced by itself or an ancestor, compatible with its cast/subject identities. Null on an old snapshot means that snapshot's embedded baseline, never a global latest revision. The first revision materializes a complete effective value; later revisions follow their declared complete-value or bounded-delta schema.

Initially one local adoption/configuration/editorial/display command produces at most one collection revision, and reference adoption changes one subject with any reviewed fields. Bulk multi-subject adoption is a later explicit extension. Allocate the beat and revision identities first; commit the revision, producing local beat, branch advance, revision increment and result receipt in one deferred-constraint transaction. Unattached draft candidates are private drafts, not published collection revisions. Historical immutable records have database update guards as well as application validation.

Display targets are already-existing ancestral narrative beats. Explicit editorial anchors must be ancestral at production; an open tail resolves only through the selected head, so a fork cannot inherit a parent's later suffix. These checks apply to live commands and portable import; foreign keys alone are insufficient.

New generated primary evidence cites the current accepted narrative prose or an allowlisted stored submitted field. It cannot cite an arbitrary old quote as proof of a new occurrence. Older supporting references are separate. Hash exact UTF-8 source-field bytes, with declared normalization before storage; never include remapped IDs in that content hash. Sources remain allowlisted and visibility-filtered in reader projections.

## 5. Read models and proposed API contracts

### 5.1 Public reader versus owner planning

Default Desk, Chronicle, Codex and recap queries are reader-safe. Owner planning is an explicit authenticated route and visible UI choice; leaving it closes private panels. It is an exposure distinction within one-owner authentication, not a claim that the browser owner lacks permission to see their own data.

Never implement spoiler protection by fetching private state and hiding it in CSS. Public projection filters before pagination, aggregation and result limits. It must cover descriptions, names, snippets, evidence quotations, derived counts and relationships. Keep provider configuration and credentials out of story query objects.

Planning remains visibly marked. Leaving clears its private DOM, transient candidates, queries and breadcrumbs from reader surfaces, while retaining authenticated server drafts. Back/Forward can restore a private task only through its explicit planning route after authentication. Lock clears private task/return state. Reader caches never share an object containing planning fields. “Private” means excluded from reader projections; paid review separately names which private fields go to a provider.

### 5.2 Query endpoints

Retain existing current APIs while adapting the fiction client. Add the following contracts under `/api/fiction/:id`:

| Endpoint | Required behavior |
|---|---|
| `GET /workspace?branch_id=&inspection_at=` | Bounded public state at the exact ancestral inspection head, actual branch/narrative heads and global action target separately, pending summary and capability map. No private snapshot. |
| `GET /timeline?branch_id=&cursor=&limit=` | Stable chronological entries with kind, narrative ordinal, episode/scene/group metadata and excerpts up to 240 characters. Default 40, maximum 80 entries. |
| `GET /passages/:beat?branch_id=&inspection_at=&presentation_mode=&presentation_head=` | Original/effective narrative text and selected presentation art, resolved immutable presentation identity, stable narrative ordinal and neighbors. Reject foreign/non-ancestral boundaries. |
| `GET /codex?branch_id=&inspection_at=&section=&cursor=` | Categorized public foundations/cast/facts at the inspection head. Maximum 40 rows; bounded evidence summaries. |
| `GET /evidence/:beat?branch_id=&inspection_at=` | Original narrative text and permitted stored quotes. Submitted private directions remain owner-planning-only. Legacy records say “passage-level evidence.” |
| `GET /planning?branch_id=&inspection_at=` | Explicit private reference/craft inspector and allowed original input provenance, with private labels and no credentials. |
| `GET /assets?branch_id=&inspection_at=&presentation_mode=&presentation_head=&cursor=` | Bounded Gallery metadata/thumbnail URLs and current versus historical placement edition. No inline full images. |
| `GET /jobs/:job` | Authenticated status, finished units, known/unknown cost and result links; rejected prose, hidden review explanations and secrets are omitted. |

Timeline cursors bind story, branch, ancestry head and sort key. If a head changes during a paginated read, return a clearly identified old snapshot or a refresh-required response; do not splice different histories into one window. Narrative ordinals exclude Ask, correction/control and editorial records. Older local bookkeeping stays visible in optional history filters.

Evidence at an older reading point must not show knowledge or corrections from its future. Art display has an explicit mode: current path presentation for ordinary rereading; historical presentation only when the user selects the “As it was” view. Label the difference.

`inspection_at` resolves truth/knowledge; `presentation_head` resolves wording/art only. The inspection boundary must never be replaced by the presentation boundary when selecting facts. Both are validated within the supplied branch ancestry and returned as resolved identities. A shared passage may have different current overlays on two paths, so cache keys include presentation identity. Selecting Ask opens its Q&A record and keeps the nearest narrative anchor; selecting a correction opens its state inspector. Neither is fetched from the narrative-only passage endpoint. Latest means latest narrative passage for reading, actual graph head for command authority.

### 5.3 Mutation envelope

The command envelope is a tagged union with common kind, action key and canonical fingerprint. Path mutations require `expected_revision`, active `branch_id` and `expected_head_beat_id`. Draft/catalogue commands require their own typed resource/base revision; creation consumes an identified draft revision. Imports require the import key and content digest. Artifact creation requires an explicit immutable source branch/head and selected configuration/presentation identities, without active-branch authority or a continuously unchanged game revision. Paid families additionally require their action plan. Reject irrelevant authority fields as well as unsupported fields. Replay precedes current availability/target checks; different input under the same key conflicts.

Preserve existing route behavior through adapters until the client has moved. New endpoints include `/commands/references`, `/commands/configuration`, `/commands/editorial`, `/commands/display`, `/commands/placements` and purpose-specific job starts. A local command atomically writes an immutable collection revision, appends its local history record and advances the branch/game revision. It performs no provider call.

Read-only path browsing remains available during a pending narrative operation. A mutation still uses current revision/idle checks. Art/audio/export jobs use immutable source snapshots and do not hold the story's pending-narration slot for their entire lifetime; attaching a result later must be a separate stale-checked action or a conditional commit to the reviewed unchanged target.

Local commands canonicalize the normalized payload and target, then replay a matching terminal receipt before current revision/idle checks. The mutation and receipt share one transaction and record zero dispatches. Return the committed result identity separately from newer workspace metadata. Same key/different payload conflicts. Branch activation and idempotent creation use the same receipt discipline. No generic job framework is required before these small domain adapters.

The active-branch requirement applies to mutations of fictional/path state. Freezing a read-only edition or producing an unplaced collection asset instead binds an explicit source branch/head and configuration; it does not activate that branch or advance its head. Gallery ownership has a separate collection revision so an unplaced result does not stale unrelated narration. Any later placement/preferred-edition change uses its declared local authority. Saves and spend capture one consistent export cut; results completed afterward belong to a later save.

### 5.4 Non-story resources and route placement

Pre-story and catalogue tasks must not fabricate a story ID to reach an API. Use authenticated, CSRF-protected owner routes for `POST/GET /api/fiction/drafts`, `GET/PATCH/DELETE /api/fiction/drafts/:draft`, and scoped free action lookup/recovery under `/api/fiction/actions`. Draft PATCH/DELETE require expected draft revision. Extend the existing story/catalogue creation adapters to accept a local action key and consumed draft revision. Expose story/reference import preview and import with action-key/digest headers on their bounded binary upload routes; do not wrap large files in ordinary JSON.

`POST /api/fiction/operation-plans` validates a tagged story-source or catalogue/studio scope. Purpose-specific adapters prepare the plan; this thin route is not a second domain engine. Story commands remain under `/api/fiction/:id/commands/*`, while source-bound jobs use the proper immutable-source envelope. Register fixed owner-resource routes before generic story matchers and retain the existing auth-before-body-size boundary. All lookup endpoints are owner authenticated and reveal no credentials or private draft content through reader status objects.

## 6. Reading position, drafts and lifecycle

### 6.1 Reading bookmarks

Persist a device-scoped bookmark using story/path/passage identity, effective display revision, paragraph anchor and relative offset. Do not store prose or private facts in localStorage. Save when navigating away, after throttled scroll, and on page hide. Validate ancestry on reopening. If wording changed and no verified anchor mapping exists, restore the passage start/nearest verified anchor and explain the fallback. Reserve artwork aspect ratios so lazy loading does not move the restored text.

The same bookmark survives room changes and rotation. A new server result does not move a user reading history. Show **A new passage is ready** with an explicit jump action. Cross-device synchronization is optional; the first slice must not overwrite one device's reading position from another.

### 6.2 Drafts

Draft identity is an owner-scoped typed union: new-story setup by its own draft ID; catalogue new/edit by kind and unsaved or saved-entry identity; story contribution by story/path/kind/target; and story-local reference by subject/base revision. Do not create placeholder stories or catalogue entries to persist work. Setup retains its opening/situation, references, added cast and advanced fields through studio visits, Back and reload.

Use the private server draft store for acknowledged recovery; retain an in-memory buffer while disconnected. Show **Saved on server**, **Saving**, **Not yet saved — connection unavailable**, or **Conflict**. Debounce writes and attempt a final authenticated flush on ordinary navigation; page-hide delivery is best effort. Only an acknowledged revision is promised to survive reload. Offline input remains available while the unlocked page stays open; offer explicit local copy/download recovery and warn before discarding unsent work. Do not promise offline browser-close durability. Cap direction at 4,000 characters, fields at their validators and total serialized draft at 256 KiB, including metadata within the request-body allowance.

On competing-tab conflict preserve base, local and server values for comparison. Persist the action key and exact submitted draft revision separately from the editable next draft before purchasing. An absent status record is uncertainty, not proof of no dispatch; section 13 defines recovery. Clear only the matching submitted revision, never a newer draft with identical text. Local story/catalogue creation consumes a draft revision idempotently; a lost response resolves to the same created resource. Handoffs carry setup draft ID and return descriptor and never submit automatically.

Lock immediately hides/clears private content, cancels unsent timers and invalidates callbacks without waiting on a dirty confirmation or network response. Already-dispatched authenticated draft writes may finish; unlock reconciles their acknowledged revision. Default expiry is 30 days after last edit. **Close/Keep draft** and **Discard draft** are different actions; discard is revision-checked and reconciled before claiming deletion. Native un-staged file selections cannot survive reload: retain other fields and state that reselection is needed, or implement a separately bounded private staging lifetime.

### 6.3 Lifecycle and busy state

Classify controls as read-only, local mutation or paid mutation. Block only the classes that conflict with the running operation. Read-only navigation and current saved evidence remain available. Every callback carries lifecycle epoch, story, view path and target/revision context. A stale callback may update an operation ledger/status in the background, but must not reopen a sheet, change focus, overwrite a draft or navigate the reader.

Leaving a view does not claim transport cancellation. Stop buttons explain whether they prevent undispatched work or merely stop local playback. Already-dispatched provider work may be billable.

## 7. Shell, responsive layout and visual implementation

### 7.1 Routes and room ownership

Proposed hashes: `#/library/stories`, `#/library/new/:draftId`, `#/library/worlds`, `#/library/characters`, `#/library/scribes`, `#/library/bookshelf`, `#/settings`, and `#/story/:id/:room` with validated branch/cursor state. `#/new` creates or resumes a local setup draft and resolves to its canonical route. Other existing `#/stories`, `#/story/:id`, `#/catalog/:kind` and `#/settings` routes remain aliases. Narrative cursor turns replace history; ordinary room/task navigation supports meaningful Back without polling-generated entries.

Use one story switcher and one selected-story transition. The route layer waits for authentication and dispatches a room loader; room modules do not create their own selection globals. Shortcut actions to Codex/Gallery/Gate carry a focus target and a return descriptor.

Room modules expose `enter(context)`, `leave(reason)`, `dispose()` and a bounded view-state snapshot. The router owns normalized context; only the current lifecycle paints or focuses. Return descriptors retain route, view path, cursor/anchor, selected item, query/filter/window, draft ID and a semantic focus target—not duplicated private prose. Deleted origins fall back to a room heading with an explanation. Room entry may focus its heading; passive refresh never moves focus. Lock clears private tasks and prevents stale-history overlay resurrection.

### 7.2 Visual system

Reuse `frontend/brand/ink-morrow-lockup.svg`, bundled fonts and approved artwork. Restore strong Scriptorium composition in Library, studios, Gallery and thresholds. Keep running prose on quiet opaque vellum. Define semantic tokens for room surfaces, reading ink/paper, selected path, paid action, local save, warning, danger and focus; do not multiply hard-coded panel colors.

Portrait tablet uses a compact story/path header, central reader, reachable action strip, and five labelled room controls at the bottom. Reserve room for safe-area insets. Landscape tablet uses a labelled rail and a drawer when an inspector would squeeze the text. Desktop permits a collapsible inspector. At enlarged text all layouts reflow to a single content column as needed; viewport orientation alone does not determine available width.

Normal portrait Desk is one grid: header, `minmax(0,1fr)` reader, action row, room bar and safe-area space. The reader owns passage scrolling; bottom rows consume layout space and never overlay prose. Remove competing document-sticky pagination/fixed composers. On tablet, Steer/Ask opens one full-height task sheet: Close/target header, one scrolling form body and submit/status region sized to the visual viewport. The underlying reader/room bar is inert while the task is modal. At very short height or enlarged text use a reachable scrolling-flow fallback. Android Back first follows platform keyboard dismissal, then task-close policy; it never submits or discards.

Touch targets are at least 44 CSS pixels. Normal reading line length should usually be approximately 58–72 characters, but accessibility zoom takes priority. Use dynamic viewport height and tested keyboard resizing. Avoid two fixed bottom rows competing with the on-screen keyboard; the active composer can replace the compact action strip. The first viewport of an existing story contains prose under a compact identity strip, not a full cover and accounting panel.

| Surface | Concrete brand composition |
|---|---|
| Library/threshold | Choose the supplied portrait/landscape/desktop Scriptorium artwork for the actual layout. Place real HTML Resume/Start text in its safe region or a separate panel, within the first viewport; cap hero height instead of stacking a huge header and figure. |
| Studios | Image/portrait preview, clear identity/depth/craft sections, one persistent action region. Fields sit on quiet surfaces, never over figures. |
| Chronicle/Codex | Restrained archival framing, gold hierarchy/evidence markers and limited existing archival art at thresholds or empty states. |
| Gallery/Bookshelf | Media-first collection/detail composition, large selected preview and truthful source/edition/placement badges. |
| Desk | Opaque reading paper, Literata prose, compact manuscript identity and limited edge atmosphere; full covers remain outside the opening reading viewport. |

Map existing semantic tokens to ink/plum materials, vellum paper, oxblood primary actions, restrained gold guidance, selected path, visible focus and distinct danger. Display type remains Cormorant, controls remain readable UI type, and technical identifiers use the established mono style where necessary. Critical money, refusal and destructive copy stays plain. This recovery does not depend on purchasing new artwork.

### 7.3 Sheets and dialogs

Studios use full-page routes or full-height task sheets with saved/unsaved status, section navigation and persistent actions. Dialogs remain appropriate for short confirmation/review. Opening evidence from a search preserves the search state and return focus. Shared focus/scroll/dirty guards remain the single lifecycle implementation. Escape/backdrop cannot silently discard an entered draft or duplicate an in-flight action. Paid review returns to the originating task on cancel.

The existing shared dialog replaces prior content; it does not by itself implement task suspension. Keep studio state mounted underneath a short review or add a bounded suspend/resume task mechanism to that shared lifecycle. Resume the same field, selection and form scroll. Evidence/search/correction Back navigation restores the previous query/results. Closing a pending task is permitted and distinct from cancelling undispatched work; a result arriving later becomes a recoverable notice/candidate.

### 7.4 Settings and Bookshelf contracts

Reading preferences are device-only typeface, size, spacing, column width and accessible paper/ink theme, with a live sample and Reset in B1. Story/path settings show a summary and link to the single Codex creative editor in B3; global defaults never overwrite existing paths silently. Provider settings show role readiness, searchable model discovery/capabilities, credentials/vault state, data exposure and per-family consent reset, preserving the originating task. Listening model/voice and local playback speed are separate in B6; changing speed buys no new file. Access/help includes working password-change markup and behavior, Lock, backup guidance and the user manual; calling old account wiring without its form is insufficient.

Bookshelf is a bounded authenticated aggregate of ready/interrupted/missing book editions, audio editions and story art. Show owning story/path/edition, source/current-versus-older status, filters, playback/download and private reference-art labels. Loading it queries retained artifacts and never builds them or downloads every full story. Add subsections only when their underlying capability is complete.

## 8. Desk behavior

| State | Primary action | Required result |
|---|---|---|
| At narrative head, empty composer | Continue story | One reviewed bounded Follow request. |
| Entered Steer text | Generate from this direction | Use the exact visible draft and selected moment/ongoing scope. |
| Ask selected | Ask outside the story | Paid clarification in a separate response surface; no fictional state/time advance. |
| Inhabit active | Act as / Say as named person | Explicit owned intent; preserve ownership boundaries. |
| Reading history | Return to latest / Explore from here | No unqualified generation control targeting an unseen head. |
| Review open | Review/cancel | No dispatch until accepted; draft retained. |
| Work running | Actual stage and call ceiling | Read saved material; block competing mutations. |
| Failed or uncertain | Inspect result / explicit retry when appropriate | Free reconciliation first; explain retained story, draft and possible charge. |
| Custom situation without prose | Continue story | Show its situation and “No passages yet,” without fake page 1 or an empty Latest target. |
| Browsing an inactive path | Make this the active path | Local revision-checked activation before planning a purchase; unavailable with a reason during conflicting narration. Browsing/drafts remain usable. |
| Episode ended | Begin another episode | Resting summary and local continuation setup; no enabled paid contribution that the server must reject. |
| Provider unavailable | Configure storyteller | Keep local work and drafts usable, explain the missing prerequisite and return from Settings to the same task. |

Ongoing focus is a visible chip with Edit/Clear. Invitations fill an empty draft and never submit, overwrite or claim that a proposed outcome occurred. Outside-story Ask entries appear in Chronicle and a separate Q&A surface, excluded from narrative page numbers, books and audio. Short **What changed** cards link a public change to its evidence and distinguish a local correction from a narrated event.

Each contribution mode retains its own draft. Direction scope appears only for Steer. Inhabit adds Act/Say; Follow remains available to develop surroundings without inventing owned decisions. Retargeting a stale draft offers Return to target, Retarget and Cancel; retargeting never submits. Typing an unsubmitted next draft is allowed while work runs and requires refreshed authority before later submission.

A structured refusal shows its public explanation/evidence and identifies unchanged outcomes as free. Offer evidence, a different approach draft, changed future play style, factual correction or an alternative path as distinct actions. Rephrasing is not advertised as another chance. Correction/style change does not reverse an old ruling or manufacture payoff. Fictional refusal, provider refusal, validation rejection and unavailable configuration have different explanations. Inconsistent prose can be retained and repaired locally or through a preserved alternative; any regenerated prose is a new reviewed purchase.

Listening has Read aloud, Pause/Resume and Stop; Auto-read is an explicitly started bounded run over existing passages. No audio synthesis starts merely by turning a page or reopening a story.

## 9. Chronicle and editorial organization

Chronicle initially provides a bounded vertical outline with episodes, scenes, narrative passages, local changes and fork markers. A branch overview supplements the list; it is never a required pan/zoom canvas. Each selected moment previews excerpt, public changes and actions. Show the reading cursor and action head with different labelled markers.

Explore selects a current-path moment, proposes a name and previews what will restore: truth/knowledge, control, creative settings, references and presentation. A fork before an existing future preserves that future visibly. Ordinary rewind uses this same command with a sensible earlier selection; remove two indistinguishable dialogs.

Editorial organization uses stable passage IDs with implicit chronology. A volume contains chapters, a chapter groups a contiguous narrative range; the default is an automatic chapter without required management. Renames/group changes are local, versioned and AI-free. Do not offer chronological reordering or cross-path group memberships. Scenes have their own circumstances and may span editorial boundaries where valid; episodes and chapters can align without being forced to.

Before the first explicit editorial change, present the current episode-based chapter layout as a virtual default, preserving existing book structure. When the user adopts a layout, freeze its grouping revision. Forks inherit the applicable revision. New passages append to the active tail group unless explicitly choosing a new group. Empty optional groups must not manufacture a narrative passage.

## 10. Codex, evidence and story-local references

Codex has References, People, Memory and Corrections sections. Memory groups commitments, goals, relationships, resources and ordinary facts. Evidence appears beside its fact with correction/retirement actions and exact path scope. The owner planning inspector is explicit and warns that it includes private setup truth.

New evidence stores whether the quote came from narrated prose, a character's submitted speech/intent, or an explicit owner declaration. An editorial Steer request is never proof that its desired event occurred. Keep the immutable original text available when display wording changes. Old facts without exact quotation data receive no fabricated backfill; they link to their original passage or beginning foundation.

Correction writes a separate authoritative record and preserves earlier prose. Show existing fact, proposed fact, reason and active-path target. Initially show directly known affected source references; do not claim a complete semantic downstream-impact analysis. An optional future analysis is a separately priced proposal, never an automatic consequence of saving.

Reference editing distinguishes reusable template, frozen selection and local revision. Field-level comparison shows template value, effective story value and proposed value. Only checked fields are applied. A world lore or character background change is reference intent/private truth where applicable, not a narrated event. If it conflicts with established truth, require explicit factual correction or a different path; a reference update does not silently erase existing facts.

Reference fields label baseline description, private background, motivation and proposed direction separately. Enduring private truths that must constrain play use declared fact identities; being hidden does not make them optional style. Adopted references do not outrank effective facts/corrections. Show deterministically known explicit overlaps and preserve unresolved differences; free-text semantic conflicts cannot be detected completely. “Wants to leave” never becomes “has left” by reference adoption.

### 10.1 D1 wording-source policy

If D1 is accepted, effective wording feeds ordinary reading, book/audio editions and the recent-prose presentation category of future narrative/review context. Authoritative facts, knowledge, corrections and original source evidence always retain precedence. Effective wording is labelled as an editorial rendering, never new event evidence or a replacement fact ledger. Evidence and fact retrieval continue citing immutable originals. This deliberately chooses the behavioral review's continuity-of-telling approach over the narrative review's more conservative original-only context option; both authorities and the residual semantic risk are explicit.

Before saving show original, effective and proposed wording, actual path/recording head, target passage and directly linked evidence. State: **Wording changes do not recalculate recorded events or knowledge. Use Correct a fact or Explore an alternative for changes of meaning.** Arbitrary text cannot be proven meaning-preserving by local validation. Save is local; it triggers no extraction, review or purchase. Conflicts preserve the proposed text. Revert appends another display revision. A display edit changing refusal into agreement cannot mechanically grant a challenge or mutate stored truth, but a model can still misread conflicting rendered prose; retain the original-only option as a future policy alternative if evaluation shows unacceptable confusion. No guarantee of semantic consistency is made.

Already frozen books/audio preserve their earlier wording; an explicit new edition uses new hashes. A fork before the display edit has no overlay. Owner instructions must record this policy before D1 is enabled; it grants no handwritten-opening or full manual-passage API.

Scribe persona, Storyteller model, prose voice and read-aloud voice have distinct labels. All existing Scribe craft settings remain available. Changing the Scribe affects future narration through an immutable local configuration; it does not rewrite old passages or insert that persona into the cast.

## 11. Studios and Library

Retain the current seed-based development and image studios. Replace short-lived modal editing with a recoverable full-height task. Show Identity, Depth/History, Craft and Image sections as appropriate. AI development creates a candidate with field-level comparison and Restore previous fields. Accepting a candidate is local; saving remains explicit. Track current fields, candidate and saved baseline separately.

Also freeze the submitted seed/draft revision, development plan and pre-acceptance snapshot. Compare candidate, submitted seed and currently edited fields; mark changes since request and leave conflicting acceptance unchecked. Restore preserves later edits through comparison. A late candidate is stored for recovery with a notice; it never automatically populates fields or reopens the task. Distinguish Draft saved privately, Entry saved and Applied to this story.

Preserve the current two-call maximum for an invalid AI reference draft and one image call for painting. Catalogue spend survives deleted content. Update exposure to state that private entered lore, motives and background go to reference drafting; image painting continues to receive the separate visible-field payload.

Add **Use in a new story** and **Add to this setup** handoffs that preserve the creation draft. Library cards show useful resume context and covers. Stories can be renamed through a local revisioned metadata command. References are collection-first; a new user can still start a custom situation without maintaining a catalogue or selecting a Scribe.

Library supplies Resume bookmark, Latest, free Catch me up, Start and clearly distinguished import/restore tasks. Preserve card search/filter/page state on return. Curated openings retain their authored cast/facts; additional chosen references supplement rather than silently replace them. A missing cover has an honest placeholder. Any title fallback is local. Before creation, setup and catalogue drafts use their own identities and durable receipts as specified in sections 4–6.

## 12. Narrative contract and context compiler

### 12.1 Configurable creative settings

Add validated story-local settings for perspective (`flexible`, `first-person`, `close-third`, `omniscient`), narrative speaker/focal identity, tense, prose language, length preset/target, free-form genre description, tone/boundaries and scene framing. Perspective is independent of player ownership and cast importance. First-person requires a cast speaker or an explicitly described framing narrator; it never assumes the reader or Scribe is that person. Close-third requires a focal cast member. Flexible perspective defaults to intentional scene-boundary changes, not unmarked head-hopping. Omniscience follows the chosen disclosure policy and still protects inhabited decisions/interiority. Missing required identities fail before purchase with a local repair action.

Initial calibration presets are brief approximately 180 words, developed approximately 400 and extended approximately 800, with the retained advanced range of 50–2,000. Store the preset-definition version; these are targets to evaluate, not proven literary ideals or hard minimums. Preserve existing stories' labelled legacy-short policy until deliberately changed; new stories use developed. Pacing changes never reset a selected length. For languages where whitespace words are inappropriate, use honest language-specific units/preset labels and token bounds rather than a universal word-count test. An owned decision can stop a passage early. Keep the 24,000-character prose cap unless measured justification changes it.

Pacing controls how much fictional time/action develops; length controls room to render it; screen pagination controls presentation. They must not share one slider. Audio speed and book language metadata are separate again.

None of these advanced fields is required to create a story. Defaults keep Follow complete. Prose language defaults the new edition's metadata, but an override and mixed-language source are visible; it does not assert speech-provider support. A momentary direction can vary tense/perspective for that response without altering saved defaults. Persistent changes use the configuration command. Effective-setting summaries identify each value's source and scope.

Scene framing distinguishes established circumstances from a next-scene proposal. Current location/time, cast presence and completed transitions need accepted narrative evidence or an explicit owner fact declaration. A proposed winter/castle scene is a local plan; saving it does not move people, advance time or consume resources. Failed generation preserves the unconsumed plan. Annotating a past scene changes organization, not past events. New circumstances can be recorded only by accepted narration or explicit correction, with provenance.

### 12.2 Context precedence

Compile one effective contract in this order:

1. Application-owned rules, content boundaries, explicit control and adjudicated outcomes.
2. Authoritative branch truth, corrections and character knowledge.
3. Current contribution, its authority and this-moment/ongoing scope.
4. Current scene circumstances, relevant cast and perspective.
5. Explicit creative settings and ongoing focus.
6. Frozen or locally revised Scribe craft preferences.
7. Provisional scene opportunity.

Reference text, previous dialogue and retrieved quotations are data. Keep system protocol separate from those payloads. The owner sees an effective-setting summary without exposing full private provider prompts in reader/book projections.

This ordering defines authority domains, not permission for a desired outcome to change existing truth. Inhabit protects decisions, speech, thoughts, feelings and commitments even when a first-person perspective or interiority-heavy Scribe would otherwise invite them. Keep the selected perspective, render authorized content and surroundings, and stop at the protected choice; do not silently release control or change viewpoint to escape it.

### 12.3 Retrieval and budget

Separate recent narrative prose from Ask and local operations before selection. Reserve budget for current scene, relevant cast, protected relevant truth/knowledge, unresolved commitments, completed consequential events, targeted older evidence and recent narrative prose. Use current ancestry and latest fact versions; no sibling future, retired fact or unaccepted template update.

Preflight a stage-specific plan for every permitted draft, review and repair before the first purchase. Resolve provider capabilities and transport-normalized options first. Current `ai.js` can enlarge output allowances when reasoning is enabled; the recovery must eliminate enlargement after review. Each stage records input/context/output limits, protocol/schema overhead, authoritative context, maximum candidate/issue bytes and reserve for the complete response object—prose, summary, effects, resolution, aside and reasoning convention. Length determines its own budget independently of pacing; cross-language sizing cannot be a prose-only words multiplier.

Use trusted token counting where supported, otherwise a documented conservative bound over serialized UTF-8 messages plus protocol overhead and explicit model capacities. Before each later dispatch, recheck the actual candidate/repair payload against the approved bounds. If a small reviewer cannot accommodate the permitted extended candidate, explain supported alternatives before buying the first draft. Never silently omit a role, truncate authority or enlarge output after review. If an actual paid candidate violates its bound, stop with honest accounting and no extra call beyond the approved ceiling.

Known catalogue/profile capabilities avoid unnecessary setup. Unknown capacity blocks only the affected paid action and offers a specific advanced profile repair with the task preserved; local creation, reading and export remain available. Remove optional low-priority context first. If binding constraints cannot fit, refuse the purchase rather than silently dropping ownership or relevant fixed truth.

Start with bounded deterministic SQL/relevance selection and narrative-only recent windows. Add rebuildable ancestry/fact indexes and sparse checkpoints only after measuring long fixtures. Store a bounded private context manifest of source IDs, versions and category sizes for diagnostics, without duplicating full story text or credentials in logs. Selected quality reviewers receive the same authoritative contract and candidate; more reviewers cannot recover omitted history.

Completed-event context comes from accepted immutable changes and passage-linked summaries, never an invented second memory ledger. Summaries/checkpoints are lossy navigation aids, not sole outcome evidence. Retrieve through stable cast/fact/scene identities as well as lexical matches, so the user need not repeat an old promise's exact words. Test relevant obligations and completed consequences outside both the working set and recent window, including corrected, retired, resolved and sibling variants. More than twelve intervening Ask/local records must not displace recent narrative prose.

### 12.4 Effects, intentions and narrative progression

Keep narrow effects and exact evidence. Version-2 proposals add `claim_kind` (`intention`, `attempt`, `reported-claim`, `occurred-event`), an allowlisted primary source and, for resolved goals, `resolution_disposition` (`achieved`, `abandoned`, `failed`, `superseded`). Legacy resolved goals retain `legacy-unspecified`; do not guess success. Sources distinguish original accepted narration, submitted owned intent/speech and explicit owner declaration. Ask, summaries, asides, display overlays, rejected candidates and editorial wishes cannot establish in-world outcomes.

Remembering an intention as a desire/goal is valid. Resolve/reveal/resource proposals identify the occurred event supporting the actual change. A failed attempt can spend a narrated resource without proving the desired success. A spoken claim records what was said/believed separately from whether its content is true. A Steer request never becomes owner declaration by implication. Source-kind/op compatibility and ancestry are deterministic; whether a model's label and quotation actually entail the claim remains a semantic limitation. Off stays one call; optional quality may reject concrete conflicts within its current ceiling. No hidden judge or semantic-proof claim is added.

Say authorizes exact submitted words, not guaranteed delivery against established circumstances. For Say only, the version-2 proposal contains `speech_performance` with status `performed`, `attempted`, `interrupted` or `not-performed`, plus bounded occurrence/prevention evidence in the ordinary model prose. Validate any binding adjudication and the source/op rules. An accepted performed outcome renders the authorized utterance once, attributed to its known speaker, before the relevant reaction at a validated paragraph boundary. Other accepted statuses describe the obstacle/attempt but insert no completed utterance and create no uttered promise. A failed/interrupted provider request commits neither outcome.

Use the same bounded final assembled narrative text for validation/selected review, reading, occurrence evidence, books and audio. Preserve its assembly/source manifest so permitted ordinary prose and authorized speech can be distinguished from an aside; asides remain ineligible for world effects. Performing speech does not establish that anyone heard, understood, believed or agreed; those changes need separate narrated support. Act remains an attempt requiring outcome evidence. Correct performance classification and duplicate/paraphrased owned speech remain semantic evaluation cases, not proof or another mandatory call. Land the performance shape, source hashes, output budget and state/save-v2 serialization together; never reinterpret old inputs as performed retrospectively.

Schedule opportunity categories independently of fact cardinality. Use a bounded round with one nomination per eligible category before repeating that category for another equivalent target. Explicit urgency/focus or established circumstances may defer a category with a recorded reason; an old open goal alone does not manufacture urgency. Compare neutral reflective fixtures with one, three and twelve promises and permuted input order: an eligible quiet/connection nomination is considered in the same category round. Established danger can defer it. A proposed quiet scene does not set “quiet achieved,” fulfil a fact or certify the passage's mood.

Leaving or Pause saves position/acknowledged drafts without changing episode status. End this episode is a separate local action with an optional summary and closure kind such as open ending or vignette. Defaults permit one-step ending and next-episode creation without mandatory planning. It never marks goals achieved. A goal-based payoff cites actual resolution and disposition; emotional satisfaction is not an enum. Immediate undo is an append-only compensating episode action when its target is unchanged; after later episode activity use an alternative path. No timer, compulsory crisis or state-change quota manufactures satisfaction.

## 13. Paid operation plans and recovery

Generalize reviewed operation plans around existing safeguards. A plan contains operation kind, exact story/branch/source, role/provider/model identities, data categories, credential-independent endpoint identity, maximum calls/segments, input/output bounds, timeout, references and estimate source. Hash its canonical representation. Estimates are not currency guarantees; only enforce a monetary cap when the provider supplies an enforceable contract. Unknown cost remains unknown.

Separate the review configuration identity from the exact action fingerprint so remembered configuration consent does not require a new modal for every passage. The server still checks the exact action target and current configuration on every dispatch. Changed provider/model, call ceiling, data exposure or reference use invalidates remembered configuration consent. Replace the old unscoped remembered flag with typed records; it grants no authority to new operation families.

Plan preparation is a free purpose-specific `POST /operation-plans` that validates target, normalizes all transport stages and returns an expiring action plan plus configuration-consent identity. Submission consumes that exact plan while retaining its action key and draft revision. The first review visibly offers Remember this operation configuration on this device. Settings provides per-family and all-family Forget approval; forgetting affects future actions, not already authorized runs or refunds. Cancellation remains separate. The action area still displays purpose, provider/model, exact quantity, maximum calls and estimate/unknown cost after modal bypass. Configuration identity may use a declared segment ceiling; every audio action still displays its exact planned segment count.

Text quality stays Off/Standard/Memory/Both with maximum 1/4/4/6 calls and one repair. Reference development stays at most two; painting stays one. Audio has an explicitly reviewed segment plan. Record every dispatch before network work, including uncertain transport. No automatic transport retry or silent provider fallback.

Required states are `requested`, `running`, `succeeded`, `failed`, `interrupted` and `cancelled` where a request has undispatched work. Existing narrative tables can retain their current compatible status vocabulary; map it explicitly instead of rewriting old rows. Successful replay returns the same outcome. Restart does not resume purchases. Late arrivals may improve accounting but never revive an interrupted canon mutation.

Expose free status lookup by scoped client action key. Before dispatch, durably retain the key, exact submitted draft revision, plan, kind/scope and target. Distinguish registered/pending, succeeded, terminal failure and unregistered/unknown. Absence is not proof that no request dispatched: a delayed original POST may still arrive. Never enable an automatic fresh key from an absent/unavailable lookup. Explicit recovery may resubmit the identical original application command under the same key/fingerprint, replay-checked before dispatch; this is not a provider transport retry. If that payload cannot be recovered, establish a server cancellation fence for the original key before permitting its replacement. A terminal failed/interrupted request needs a new deliberate action/key. Successful replay is returned before current provider/head checks. Status reads and reconciliation themselves buy nothing.

Job workers claim one permitted call atomically under the reviewed plan and job authority before network dispatch. Cancellation prevents further claims; a claim already made may be billable even if cancellation races before transport. Settle each call once after await, then recheck authority before another claim or publication. A cancelled/interrupted job never becomes successful; late results may settle billing and retain validated private cache data only. Route changes/Lock alone do not cancel authorized work. Worker/runtime generation identities prevent old callbacks from publishing under a reconciled incarnation.

Re-resolve credentials and configuration before each new claim. Lock may remove session/vault plaintext, making a later claim unavailable; report that state rather than retaining secrets to promise uninterrupted work. Already dispatched transport can finish and be billed. Initially allow one active art job and one active synthesis plan per story, with one sequential synthesis worker installation-wide and a bounded queue; no new dispatch occurs merely because an item is waiting in a UI form.

### 13.1 Unified accounting

Use one story-spend projection over disjoint charge identities: old request rows without child calls, narrative call rows, new story media/audio calls and imported aggregate charges. Job totals are summaries and never added again. Use this same projection in UI, reconciliation and save export. Preserve known amount and unknown-attempt count independently, including partial jobs and late settlement. Cache reuse/playback/placement buys nothing and does not copy the original cost into a new purchase. Catalogue drafting/painting remains Library-scoped; selecting its result does not reattribute or duplicate charges. A save captures spend at its frozen export cut and cannot include settlement arriving later. Extend browser error/status parsing to preserve partial-known and unknown metadata rather than only a single nullable cost.

## 14. Gallery and image handling

Gallery includes cover, world/Scribe/cast references, passage illustrations and unplaced ready assets. Use bounded metadata pages and thumbnails with lazy loading. Selecting an image shows full preview, alt description, provenance, current path use and retained historical use.

Upload and Paint are equal entry actions. A passage shortcut preselects its stable target, while the Gallery can find an older target directly through Chronicle queries. Placement commands are local and revision-checked. Preserve the existing one illustration per passage and one image per reference target during the first recovery; supporting multiple illustrations requires explicit reader/export/save layout contracts.

An unplaced asset remains in the collection. Removing a current placement does not delete bytes still needed by another path or saved historical presentation. Garbage collection walks every retained root before deleting an asset; local removal is never shorthand for erasing historical references. Preserve current upload limits, normalization, signature checks, random storage keys and content hashes.

Production and attachment have separate statuses. Successful painting durably creates a ready collection asset. If explicit automatic placement was part of the review and the original placement tuple is unchanged, asset/placement publication can commit atomically; otherwise show **Image ready; not placed** with Preview, Place on current path, Choose another target and Keep unplaced. A stale attachment never repaints or discards the charged result. Replacement previews show old/candidate images and target excerpt. Failed upload retains alt text; native picker cancellation or reload explains file reselection. Book layout preview distinguishes reader-before-prose from EPUB's separate image page.

Unchanged coordinates alone are insufficient for automatic placement. The action branch/head/revision must still match and narration must be idle; if conflicting narration is now pending, preserve the completed image unplaced. Inserting ready inventory alone advances only its inventory concurrency version, leaving the narrative request current. Save/copy carries all retained image ownership/metadata independently of producing beats, resets imported inventory concurrency authority and never restores a job or receipt capability.

Snapshot/edition creation resolves text/media under a consistent database read boundary and transactionally pins source references before asynchronous work. Roots include all retained story presentations, the owner collection including unplaced assets, active jobs, retained editions/snapshots/shares and explicitly staged media drafts. GC atomically marks an unreferenced asset unavailable before unlinking; new pins/attachments reject that mark or reverse it under the same exclusion protocol. Recheck roots before deletion. Use operation-owned staging, technical validation and a ready transition. Restart reconciles partial/orphan files without deleting referenced bytes. Local output publication is idempotent; SQL/file-boundary failures cannot trigger a new provider purchase.

D3 keeps initial painting text-only. If reference conditioning is later accepted, permissions reset on import, selected asset IDs and quantity appear in the reviewed plan, and provider refusal never deletes the local original. A refusal produces a visible reason and an explicit new action; it does not trigger a hidden repaint.

## 15. Listening and audiobook restoration

Adapt retained audio utilities to immutable fiction content. Build the speech input from selected-path narrative prose after effective wording resolution, excluding Ask, private references, input directions, corrections and sibling paths. Key audio by source text hash, provider/profile identity, model, voice, format and synthesis settings. Never cache across a different owner/installation; serve files only through authenticated routes.

A cache hit performs no synthesis. A new read-aloud purchase displays its segment count, model/voice and exposure. Plan segmentation locally before consent. Use bounded sentence-based segments within documented provider input limits. Count all synthesis calls, including any provider-specific repair. The initial implementation disables recursive bisect-and-retry; a rejected segment fails and requires a new deliberate plan.

One sequential worker is the initial default for constrained devices. Pause affects playback. Cancel prevents undispatched segments; dispatched work can still finish and be billed. Restart marks unfinished work interrupted, preserving completed cached segments and spend without automatic resumption. Explicit restart can reuse cached segments and purchases only the missing reviewed set.

Audiobook source freezes branch/head, effective wording and ordered text manifest before queueing. Narration continuing elsewhere does not alter that artifact. Label it as an edition and show when it differs from the current path. A late audio result may attach to its immutable edition even after the user switches views, but it cannot replace the current story's preferred edition silently. Include progress, file integrity, download, playback and cancellation in one workflow.

Auto-read is a bounded explicit run over saved text with a visible stop and reviewed maximum segments. Reaching unwritten text stops; it never generates new prose.

One workspace playback controller serves Desk, Gallery and Bookshelf. Room changes keep explicitly started playback with a labelled source and Return action. Story/path changes pause Auto-read and prevent further undispatched synthesis until the source is explicitly reconfirmed. Manual historical inspection stops automatic viewport following. Pause/Stop playback and Cancel remaining synthesis are distinct. Browser autoplay refusal or audio-focus loss offers Tap to resume, never another purchase; previously cached playback can continue while another preparation fails.

Initial limits are 16 synthesis segments per read-aloud action, 512 per audiobook/Auto-read plan, 16 MiB validated bytes per segment and 512 MiB per assembled edition. Preflight using selected format/provider estimates and enforce actual stream/disk bounds too. Offer chapter/volume selection or splitting when a larger book does not fit; do not purchase an infeasible whole-book plan. These limits are calibration parameters recorded with the operation, independent of narrative quality's six-call ceiling. Check free disk space and staging quotas before dispatch, retain completed cached units and report uncertainty honestly if a charged stream exceeds its bound. Media type/decoder support must be explicit; no automatic MP3/PCM fallback purchase.

## 16. Gate, publication snapshots and sharing

Gate presents **Make a readable book** and **Keep playing elsewhere** as distinct tasks. The book workflow chooses a path/edition, title, author credit, language, optional front/back matter, editorial grouping and cover/placed art. Show a contents and art preview and explicit exclusions before build. Keep one normalized PublicationDocument as the common input to all nine adapters.

Freeze the exact reader-safe document/source manifest before asynchronous rendering. Job workers render that immutable snapshot rather than reconstructing from mutable `current()`. Local continuation does not silently change the book being built. A rebuild is an explicit new selection; cached identical output can be reused. Preserve separate EPUB image spine pages immediately before associated prose, with reflowable text. Missing placed media is a visible preflight error rather than silent omission.

Saved publication presets and private artifact metadata remain local. Book bytes contain intended public prose/art and owner-approved front/back matter, never hidden state, directions, rejected drafts, review text or credentials. Generated prose can itself contain a fictional secret; metadata filtering cannot guarantee semantic spoiler removal.

Restore shares only through a new current-fiction immutable snapshot adapter. Store a hash of the bearer capability, support expiry and revocation, prevent private caching/indexing and make viewing AI-free. Sharing requires an owner action with an included-content preview. Do not mount retired story APIs or promise a share merely by exposing a disabled button. Local private export remains complete when sharing is not configured.

Gate starts from the explicitly chosen viewed path/head and presentation/structure edition, not whichever branch happens to be globally active. Retain metadata while preview builds; editing after preview marks a new draft as needing another preview, while the frozen earlier edition remains downloadable. Select one or multiple formats against the same document and report per-format local-render failures. Preflight links return to the relevant passage/asset and preserve the Gate draft. A browser download being initiated is not proof that the user saved it successfully.

Sharing supplies source preview, expiry, explicit Create, a copyable/selectable URL with clipboard fallback, identifiable active/expired/revoked records and Revoke. Revocation blocks future access but cannot retract downloaded copies. Report actual hosting unavailability and preserve complete local export. Book preview/rendering does not wait for audio or sharing delivery.

## 17. Saves, reference portability and recovery

### 17.1 Portable story versioning

Introduce portable save version 2 when the first new durable feature is enabled. Keep format name and `.inkmorrow5` extension unless D4 chooses a clearer public name; extension alone never determines compatibility. Export a declared version, state version and explicit immutable collection sections for configuration, references, editorial revisions, display overlays, evidence and referenced images. Exclude drafts, bookmarks, credentials, consent, jobs, resumable requests and share capabilities. Carry aggregate known/unknown spend.

Freeze version-1 enum, shape and normalization semantics in a dedicated compatibility module, not merely the existing validator function: it currently imports changeable model/reference validators. Share maintained technical media-safety checks where appropriate. Validate original v1 first, then normalize a separate copy. Version 2 can contain immutable historical state-version-1 and explicit new state-version-2 snapshots together. New writers emit the declared new shape; deterministic old-state readers do not rewrite historical bytes. Unknown versions/fields stay rejected. Warn that new saves need the recovery build; no false v1 label or silent lossy downgrade is allowed.

Validate all new record IDs, ancestry, collection parent chains, subject ownership, referenced sources/hashes and size limits before staging or SQL writes. Remap every story/branch/beat/revision/asset reference on copy. Template source IDs are inert provenance only and may never reconnect to a same-named local catalogue entry. Imported image-reference permissions and purchase authority are reset.

Retain 10,000 moments, 40 paths, 24 cast, 400 story images and 64/128 MiB compressed/expanded ceilings initially. Apply the following collection bounds from the first version-2 writer. Story saves initially exclude synthesized audio and publication binaries, which can be downloaded separately and recreated from prose. The preview names those exclusions. Do not promise a complete installation backup from a story save.

The initial aggregate bound across configuration/reference/editorial/display revisions is one published revision per producing local command, at most the retained moment count, capped at 10,000. At most twelve primary evidence records per retained moment, across generated and owner-declared changes, yields a 120,000-row ceiling; each quote is at most 1,000 characters. One generated change has one primary occurrence source and, where needed, a bounded authorization pointer into its already-stored submitted input. Initial foundation provenance is a tagged reference to the initial state, never a fabricated beat/quote. All JSON sections obey total expanded-byte ceilings independently of count limits; maximum-count graphs are not guaranteed to fit every byte combination.

Export the transitive closure of heads from every retained initial/beat snapshot, including all required revision parents and evidence. Export every retained story-owned image, including unplaced uploads and committed job results; omitting job authority never omits their resulting story assets. Extra unreachable published revision rows are rejected unless declared as an explicit retained root in the format. New saves carry new goal dispositions, effect-source taxonomy, performed utterance provenance and opportunity scheduling state. Validate these shapes and their ID remapping together with their reducer. Exact serialized size is authoritative; rough multiplication is only conservative early guidance. Warn before a new large asset threatens portable-save capacity without silently dropping history.

### 17.2 Reusable references

Create a separate versioned local reference bundle containing selected worlds/characters/Scribes and owned normalized images. It excludes journals, credentials and provider reference permission. Preview names/counts/private-data warning and duplicate handling; import creates new entries. Both reference-bundle and story-save imports take an owner-scoped action key plus content digest. Commit copy, remapping/result identity and import receipt transactionally. Same action replays the same copy; changed bytes under that key conflict; another deliberately requested copy uses a new key. A subsequently deleted result is reported as deleted and never silently recreated. Receipts are installation metadata and excluded from portable authority.

### 17.3 Installation and old-series recovery

Keep cold-backup instructions for the complete configured database/media locations, with stopped writers and sidecars preserved. Never use an online scratch preflight as a backup method. D2 old-series conversion is a separate read-only source parser, preview and new-copy transaction; it reports unmapped features instead of inventing story facts. It cannot be implemented by opening a Version 4 database through the Version 5 runtime.

## 18. Migration, rollout and rollback discipline

Append migrations after the actual current schema head. Never edit the SQL or imported constants used by historical checksums. Each migration creates its own immutable source constant and has rollback-on-failure tests. Existing beats and initial state bytes remain unchanged. New query helpers support missing fields with explicit old-state readers.

Keep genuine pre-recovery schema-23 ledger/database and valid save-v1 fixtures. Every later slice must migrate/reopen them while preserving all old migration entries and original story bytes. Test injected failure at intermediate migration steps, successful re-entry and subsequent startup. Updating a current shared validator or imported schema constant must not silently change historical acceptance/checksums.

Suggested migration groups are workspace drafts/projections, exact provenance, configuration/reference revisions, editorial/presentation revisions, and media/publication jobs. Assign final contiguous versions in implementation order. Application capabilities must identify which schema-backed features are actually available.

Before enabling a new state field, land its reader, reducer validation, transactional writer, strict save serializer/importer, ancestry/remapping tests and public/private projection together. A UI that can create data the save cannot preserve is a release blocker.

Before enabling the new shell, provide useful adapters in all five rooms: current Desk contribution/reading; Chronicle's current paths and honest bounded history window; Codex's current public references/facts/recall/correction; Gallery's current cover/reference/loaded-passage art with upload/paint; Gate's current book export and private saves. Label current-head-only inspection and incomplete loaded collections honestly until richer queries land. Preserve access to all currently supported tasks; never remove an old entry before its replacement works. B2–B7 deepen these adapters. If any adapter is incomplete, B1 remains internal-only and the old complete interface stays available.

Use capabilities for genuinely new features, not to hide existing workflows. A visual rollback flag cannot undo a schema: back up the installation, use compatible application code or restore into a separate location. Old executables keep refusing future schema; no downgrade is promised. Test tablet tasks in each relevant batch; B8 repeats whole-product qualification rather than postponing all device review.

The stakeholder authorized the planning documents, continuation state and branch cleanup to be recorded directly on main. This does not authorize runtime implementation or deployment. No server or replacement deployment starts from this planning task. Future implementation PRs follow the chosen integration branch and exact-head CI policy. Reconcile stale branch instructions before creating a new release line rather than resurrecting abandoned work.

## 19. Delivery batches and dependencies

| Batch | User-visible deliverable | Main files/modules | Depends on | Exit criteria |
|---|---|---|---|---|
| B0: recovered experience | Populated tablet prototype and explicit final-4.1 capability/decision matrix (3.2–3.4) | Prototype fixtures, workspace/brand design spec, policy record | This guide | Stakeholder can inspect all five rooms and critical failure/keyboard states; no paid services. |
| B1: orientation | Adaptive shell with useful adapters in every room, Desk actions, bookmark/return and device reading settings | HTML, fiction router/state/shell/reader, room adapters, CSS, auth | B0 | All current local art, correction, studios, export/save tasks remain reachable; prose visible; keyboard/Back/lock and action labels work. |
| B2: trustworthy inspection | Chronicle, categorized Codex, precise new provenance and private draft recovery | Query/evidence/draft helpers, store/routes, timeline/Codex, schema/save v2 | B1 | History and inspection work during generation; no future/sibling/private leak; drafts survive reload. |
| B3: creative depth | Full studios, story-local reference/craft/scene settings, typed campaign adaptation, context compiler | Library, reference/config helpers, context/service/director/model | B2 | Explicit adoption, bounded narrative-only context, varied Follow opportunities, independent length and pacing. |
| B4: editorial work | Chapters/volumes and optional wording edits | Editorial/display helpers, Chronicle, publication/save | B3; D1 for display editing | Grouping is AI-free; forks and imports preserve applicable layout/wording; original evidence remains available. |
| B5: visual collection | Gallery, unplaced assets, visual targeting, reference bundle | Media, asset queries, Gallery, bundle validation/import | B2 and save support | Upload/Paint equally usable; all-path retained assets survive removal and save-copy. |
| B6: listening | Read-aloud, bounded auto-read and audiobook editions | Audio job/call/cache adapters, provider routes, reader/listening | B3, B4 where enabled, B5 artifact shell | Cached replay free; cancellation/restart honest; immutable selected text and no surprise synthesis. |
| B7: finishing | Book preview/jobs and bookshelf; completed share sub-slice | Publication snapshots/jobs/adapters, Gate, shares | B2 plus enabled editorial/display/image contracts; no audio dependency | Formats agree on frozen content; private exports complete independently; sharing appears only when functional. Audio adds its Bookshelf subsection after B6. |
| B8: whole-product qualification | Final-4.1 parity ledger, real-tablet and long-work evidence, six manuals, release notes | Tests, fixtures, docs/PDF sources and release record | All released batches | End-to-end creative journeys pass; exact-head CI, visual and narrative evidence recorded separately. |

| B9: optional local tools | Dice/oracle/table/deck/fields/clock with recoverable local results | Fiction tool commands, store/query/save adapters and bounded room panel | B2/B3; explicit follow-on scope, not B8 release dependency | No provider calls; replay-safe draws/updates; fork/import preserves selected state and all retained outcomes. |

B5 can develop alongside B3/B4 after shared contracts stabilize. Audio and publishing do not require old-series conversion. Optional solo tools form the explicit later B9 batch; any included tool must use local application-owned results and the same graph/save contracts. No milestone is described as complete merely because its design or tests have been written.

## 20. Verification plan

### 20.1 Mechanical fixtures

Use isolated stores and fake transports. Add regression fixtures for: stale/duplicate/late commands; conflicting tabs; old/new state and saves; both path ancestors sharing a passage; future corrections hidden from earlier inspection; exact quote/source/hash preservation; old quote absence; private source fields excluded before limits; drafting conflicts; no paid work during reading; and interrupted audio/publication work.

Reproduce the two discovered narrative weaknesses explicitly. Test an intention-only passage proposing a completed goal and distinguish structural validation limits from optional review rejection. Test reflective Follow with three live commitments and an eligible quiet scene. Do not replace these with assertions that merely mirror a new helper's implementation.

Critical additional cases are a delayed original paid command arriving after an absent lookup; a newer draft with identical text to the submitted revision; local correction after the latest narrative passage; original/effective evidence across a shared early passage; a valid old save after current enum expansion; a sibling/future collection producer; mixed old/new charge sources; cancellation before/after claim; and image removal racing a book/media pin. Test transactional import receipts for both story and reference copies and a pre-recovery schema ledger through every migration.

Final-pass regressions additionally cover an unplaced image completing during narration without staling it, an inactive path's book frozen without activation, pre-story/import actions without fabricated branch fields, and an unplaced image saved without a producing beat. Test accepted interrupted/prevented speech with no utterance/promise, accepted performed speech with identical assembled text in every consumer, and an unheard statement without blanket audience knowledge/agreement. Save-copy/fork must preserve performance/source records and the absence of unperformed events.

### 20.2 Browser and device journeys

| Journey | Acceptance evidence |
|---|---|
| Begin and follow | No avatar or mandatory advanced setup; starting/reading performs zero paid calls. |
| Return to a long story | Exact passage/anchor restored after room changes, reload and rotation. |
| Inspect and repair | Find a relationship, read its evidence, correct/retire it, return without lost context. |
| Branch from history | Fork point and preserved original future are clear; state and settings restore correctly. |
| Wait for AI | Existing passages, public memory and evidence stay readable; duplicate mutations blocked. |
| Recover a failure | Input and target retained; free reconciliation detects existing success; no automatic replacement purchase. |
| Develop references | Candidate comparison, explicit save, selected-field adoption and frozen story independence work. |
| Illustrate/listen | Placement preview and declared audio plan; cached replay is free and Auto-read stops at saved text. |
| Finish/preserve | Preview chosen book edition; export and save-copy restore the intended content/state separately. |

Test desktop 1280×800 and 1440×900, portrait tablet around 768×1024, landscape around 1024×768, and narrow reflow. Add real Android tablet evidence with keyboard open, 200% text enlargement, touch and reduced motion. Automated desktop/mobile Chrome coverage is useful but not a substitute for that device check. Do not download a browser solely for local verification when existing CI/browser environments suffice.

The populated fixture includes a long title, shared early passages on two paths, Ask/local records, a pending response, acknowledged/unsent drafts, a delayed candidate, a tall illustration, missing media and ready/interrupted editions. Record tablet/browser, actual visual viewport with IME, zoom/text setting and touch steps. Follow search → evidence → correction → Back to the same result/focus; type → cancel review → rotate → Settings → return → reload; browse during work → resolve it without a jump; and compare current versus historical presentations. Exercise picker cancellation, lost playback focus and clipboard-unavailable share recovery. A reduced desktop viewport is supplemental, not evidence of a real Android keyboard.

At unchanged geometry, restore the same paragraph anchor within one rendered line when possible; after rotation/reflow preserve the paragraph identity and bring it visibly into view, explaining fallback after changed wording. Enlarged text requires reachable actions, not every action simultaneously on screen. Test 200% interface zoom/enlargement separately from merely setting prose to 24 pixels. Record wrong-target actions, unexpected-purchase expectations, lost work, help requests and actual task completion separately from attractive screenshots.

### 20.3 Long-form capacity

Build deterministic fixtures at approximately 500, 3,000 and 10,000 total history moments with multiple paths, dense facts, repeated reference revisions and bounded images. Record database/save sizes, maximum response size, query work, reader DOM size, peak memory and latency on the reference host/tablet. Output limits alone do not prove bounded query cost. Keep narrative windows capped independently of story length. The 10,000-moment boundary must either round-trip within the declared byte ceilings or fail with an explicit preflight explanation; never drop history to make the file fit.

Set performance budgets after B0/B1 baseline measurements and before B2 query implementations are accepted. At minimum the primary action acknowledges immediately, pagination does not render the full work, and no load performs a provider request. Capture reproducible hardware/runtime and cold/warm cases.

Initial engineering targets to validate at that baseline: visible action acknowledgement within 100 ms without awaiting network; at most 80 outline/Codex rows and one active passage rendered per window; a warm local query p95 target of 250 ms on the 3,000-moment fixture and 500 ms on 10,000 moments; and useful saved text within two seconds over the measured normal local connection. Record the actual host/tablet, sample procedure, cold/warm distributions and deviations. Adjust a target with evidence before accepting its owning slice; do not silently declare an unmeasured device fast enough. A slow query requires a bounded/indexed projection, not a larger client response.

### 20.4 Narrative evaluation

Define whole journeys, checkpoint facts, evaluated passage ranges and comparison conditions before judging output:

- **The Drowned Bell:** no-avatar Follow, pre-discovery spoiler-safe Ask, fair clue/correct deduction, fixed buyer/cause, affection distinct from trust, a fork before disclosure with different knowledge, evidenced resolution and aftermath.
- **The Garden After Rain:** several promises, reflective ordinary activity, Jo's justified refusal, sufficient grounds for a quiet role, cooperation without compulsory leadership, a shared pause with potentially zero effects and a separate goal-free vignette ending.
- **Six-person ensemble:** at least two complete scenes and intentional perspective change, distinct dialogue, stable tense/language, consistent presence/location/time, older consequences beyond the working set, Inhabit/Act/Say/Release and deliberate Scribe/length changes.
- **Return and edition:** free recap/bookmark, original evidence/private planning, D1 tests only if enabled, frozen versus current book/audio content and save-copy of all selected sources.

Mechanical tests block protocol-detectable wrong-source, ancestry/privacy/control, replay/accounting, dropped-history and artifact errors. They do not certify live narrative quality. If separately authorized, use fixed model/settings, declared directions and bounded spending for live or authorized captured sequences. Read whole scenes/transitions rather than selected highlights. Record protected-truth changes, spoilers in Ask, invented owned content, false completions and contradicted rulings as critical semantic failures for investigation. Rate literary particularity, causal continuity, dialogue, perspective, meaningful quiet, rhythm and stopping separately with examples and evaluator disagreement. Set comparative thresholds before viewing candidates; no superiority claim without comparable baseline evidence. Record cost/latency and evaluated ranges.

Without that authorization/evidence, release records state **Live narrative quality not evaluated** alongside mechanical/visual results. Local story creation and saved reading are free; explicit Continue buys the reviewed narrative plan. Extra reviewers, their approval and higher price never substitute for observed story quality.

## 21. Documentation and release acceptance

This guide does not change current behavior, so it does not require regenerating the six shipped manuals during this planning task. When implementation changes behavior, update every affected active source, regenerate all six PDFs and their manifest together, and inspect the output. Update README, release capabilities, known limits, CONTRIBUTING and AGENTS product decisions to match the accepted recovery scope. Historical documents stay historical.

Keep the canonical logo and AGPL-3.0-only project identity. The old 35-page User Guide constraint must not silently force omission of restored workflows; record the accepted target for the recovery edition before layout work. Preserve full local/no-optional-provider, complete-feature and focused-subset journeys.

Release evidence has separate columns for source integration, automated checks, populated visual review, real-tablet task review, narrative evaluation and deployment. Passing five CI checks establishes that those checks passed on that source head. It does not establish stakeholder acceptance, real-model story quality, deployment or successful migration of the owner's data.

## 22. Completion checklist for a feature slice

- The stakeholder task is complete through its actual screen, not only its API.
- Domain authority, privacy, paid plan and source destination are explicit.
- New durable records survive fork, old/new save import, restart and rollback-on-failure.
- Empty/loading/success/failure/uncertain/stale/cancel states preserve work and focus.
- Local operations and passive reading remain provider-free.
- Existing component helpers are adapted; no second active app/runtime is introduced.
- Relevant integration/browser/device evidence and documentation accompany the implementation.
- The implemented capability is distinguished from planned follow-on work.

## 23. Roundtable refinement record

Draft 0.1 was reviewed by architecture, UI/usability, behavioral and fiction/narration specialists. Draft 0.2 incorporated their remedies and underwent a second complete consistency pass. Version 1.0 applies the final architecture correction for non-path inventory/authority and the final narrative correction for prevented speech. The companion record maps findings and dispositions, including the explicit D1 source choice where reviewers differed. These are completed planning reviews; implementation and its acceptance evidence remain future work.

## Appendix A. Required command and error details

All commands below use the appropriate tagged authority envelope from section 5.3, strict normalized fields, local receipts or paid job/request journals, and reader-safe errors. Only path mutations require the active branch tuple. Conditional capabilities remain absent until enabled.

| Command | Specific payload and preconditions | Persisted result |
|---|---|---|
| Activate branch | Branch belongs to story; actual game revision/head match; no conflicting narration. | Selected branch plus refreshed actual-head tuple; no new narrative passage or purchase. |
| Apply local reference | One world/Scribe/cast subject, expected effective reference revision, allowlisted selected field changes, optional template source revision. Subject exists at action head. | Complete effective subject revision and producing local beat, known-overlap notice; no canonical event inferred. |
| Update creative configuration | Validated patch plus expected configuration revision; valid speaker/focal ID; established scene facts cannot be rewritten through a plan field. | Configuration revision/local beat, effective-setting summary and unchanged narrated truth. |
| Update editorial grouping | Create/rename/close a volume/chapter or annotate scene grouping; ancestral stable anchors and chronological contiguous ranges; no cross-path reorder. | Editorial revision/local beat; fallback groups keep every narrative passage visible. |
| Apply wording revision | D1 enabled; ancestral narrative target; expected effective text hash/overlay head; replacement within 24,000 characters; explicit wording-only acknowledgement. | Immutable overlay/local beat; original evidence and frozen editions unchanged. |
| Place/remove art | Ready owned image, validated presentation target, expected current placement revision and active action-head tuple. | New path presentation record; bytes retained through all required roots. |
| Save/discard draft | Typed scope, draft ID, expected draft revision and bounded payload or discard intent. | Acknowledged draft revision/tombstone, no story mutation or entry save. |
| Create story/catalogue entry | Consumed setup/studio draft revision and stable local action key, current input validation. | One created resource and receipt; newer working draft stays intact. |
| Import story/reference bundle | Import key, digest, declared version, validated complete closure and owned staging. | New-copy receipt plus remapped IDs; identical replay returns that copy. |
| Start speech/art job | Reviewed action plan, exact immutable source/target and durable client action key. | Claimed job/calls, ready result and separate attachment/preference status. |
| Freeze/build publication | Explicit path/actual source head, presentation/structure revisions, validated metadata/options. | Pinned immutable snapshot and local render jobs; no model call. |

Preflight distinguishes invalid input, missing capability/provider, target changed, command busy, unavailable source, capacity exceeded and unknown operation status. A known pre-dispatch rejection may state that no call was made; an uncertain network outcome may not. Return a safe operation/result identity, explicit reconciliation availability, `known_cost_usd` and `unknown_attempts` when relevant. Client copy describes cause, retained work and next action. Never put private source values or credential strings in error bodies/logs.

One prepared action plan expires for action acceptance after a short documented validity period (initially ten minutes) and is invalidated by relevant provider/capability/authority changes. An accepted bounded run is not cancelled merely because that pre-acceptance period later elapses; its stage timeouts, authority/configuration checks and call ceiling remain enforced. Identical successful command replay stays free after expiry. An expired unaccepted plan requires fresh explicit submission/review; an unknown original operation must first be reconciled under its old key. Configuration approval and action-plan identity remain separate; remembering configuration does not authorize a different quantity ceiling, data exposure or reference selection.

Source asset publication follows validate → operation-owned staged bytes → atomic ready-file publication → guarded database result commit. Pins exist before asynchronous consumption. A crash before the result commit may retain a private cache/staged artifact, but cannot turn an interrupted paid job into success automatically. Missing bytes behind a committed artifact produce a truthful unavailable state; local rerender/recovery can be explicit and provider-free. Only the owning operation's uncommitted files are cleaned. File/directory durability assumptions and restart cases must be tested on supported hosts.
