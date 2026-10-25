# Ink Morrow recovery — implementation guide

**Status:** draft 0.1 for specialist roundtable review, 25 October 2026. This document describes proposed work. It does not claim that the recovery is implemented or authorize deployment, server startup, paid model evaluation, or merging code.

**Baseline:** current `main`, application 5.0.0, database family `ink-morrow-5`, schema 23, immutable fiction-state model and strict version-1 `.inkmorrow5` saves. The source baseline is `9647cdec4fc8ef4762e407e9c0ba705d563694fb`. Recheck the actual baseline before implementation; reserve new migration numbers only then.

**Stakeholder objective:** recover Version 4's visual identity, creative depth, usability and complete working journeys while retaining Version 5's reader-director, playable history, meaningful alternatives and explicit paid authority. A quiet reading experience and deep creative tools must coexist in one application.

The guide is organized so a developer can implement a coherent slice without rediscovering the product contract. Names of proposed files, tables and endpoints below are design contracts, not descriptions of existing APIs. Specialist review findings and their disposition belong in [ROUND-TABLE-REVIEW.md](../ROUND-TABLE-REVIEW.md).

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
| D1: optional wording edits | Include bounded copyediting as an optional tool. | Deliberately revises the earlier no-manual-prose rule. Record stakeholder acceptance and update product instructions before enabling its endpoint/UI. Core recovery does not depend on it. |
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
| Optional solo tools | Retained local random/oracle/deck logic | Follow-on adapter that records immutable path results; no separate transcript authority. |

Current `frontend/app/fiction/app.js` should become a composer rather than continue accumulating every feature. Introduce focused modules under `frontend/app/fiction/`: `workspace-state.js`, `workspace-router.js`, `workspace-shell.js`, `reader.js`, `chronicle.js`, `codex.js`, `studio.js`, `gallery.js`, `listening.js`, and `gate.js`. Retain smaller influence, quality, provider, media and save utilities when their ownership stays clear. New code receives dependencies explicitly; it does not reach through a second app singleton.

Introduce focused backend query/command helpers under `backend/src/modules/fiction/`, including `workspace-queries.js`, `evidence.js`, `reference-revisions.js`, `editorial.js`, `context.js`, `drafts.js`, `audio-jobs.js` and `publication-jobs.js`. The existing composer remains responsible for mounting authenticated services and disposing their queues. Use domain-specific adapters around shared operation safeguards rather than forcing speech, text and image payloads into one artificial call type.

## 4. State model and authority

### 4.1 Workspace state

The client workspace contains:

| Field | Scope and meaning |
|---|---|
| `storyId` | Selected work. |
| `viewPathId` | Path currently being inspected, possibly during an operation on another action target. |
| `cursorBeatId` | Saved narrative passage being read; never a loaded-window array index. |
| `actionTarget` | `{branchId, expectedHeadBeatId, expectedRevision}` frozen when the user begins an action. |
| `room`, `inspector` | Device navigation only. |
| `draftKey` | Story, branch, contribution kind and expected narrative head. |
| `lifecycleEpoch` | Invalidates obsolete route, story and locked-session callbacks. |

Keep the current server-wide active branch as the mutation compatibility boundary for the first slices. Read-only browsing of another path does not change it. Continuing a different path is an explicit selection command, revision-checked before purchase. Do not silently make the server branch pointer per-tab without redesigning all mutation guards.

A free read may return a newer server revision while the user inspects an old passage. Updating the status strip is allowed; overwriting the cursor, draft or frozen action target is not. A stale target requires a refreshed review and explicit submission, never an automatic paid retry.

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
| `fiction_owner_drafts` | Owner/story/branch/type/target key, content, draft revision and expiry. Private, excluded from reader/books/saves; never stored with provider credentials. |
| `fiction_media_jobs` / calls | Story, frozen source identity, purpose, plan hash, idempotency fingerprint, lifecycle, per-call known/unknown spend, result asset references. Paid fields survive failure/restart. |
| `fiction_publication_snapshots` | Story, chosen branch/head, structure/display/art revisions, normalized reader-safe document hash, source manifest and private artifact references. Immutable. |

For schema economy, configuration and reference revision JSON can reuse current validators; never create a second uncontrolled shape. Cap each configuration payload at 32 KiB UTF-8; reference limits remain the current per-field limits, with a 32 KiB UTF-8 per-reference ceiling and 24-character selection bound. Historical embedded `state.library` remains the baseline for old moments; new effective references resolve explicit revisions over that baseline. A reference revision cannot remove a cast identity or rewrite historical narrated facts merely by editing its description.

Editor/overlay chains require bounded resolution and rebuildable checkpoints. Store references to reusable immutable records in new snapshots instead of repeatedly copying large new collections. Do not normalize all existing snapshots speculatively; measure first.

## 5. Read models and proposed API contracts

### 5.1 Public reader versus owner planning

Default Desk, Chronicle, Codex and recap queries are reader-safe. Owner planning is an explicit authenticated route and visible UI choice; leaving it closes private panels. It is an exposure distinction within one-owner authentication, not a claim that the browser owner lacks permission to see their own data.

Never implement spoiler protection by fetching private state and hiding it in CSS. Public projection filters before pagination, aggregation and result limits. It must cover descriptions, names, snippets, evidence quotations, derived counts and relationships. Keep provider configuration and credentials out of story query objects.

### 5.2 Query endpoints

Retain existing current APIs while adapting the fiction client. Add the following contracts under `/api/fiction/:id`:

| Endpoint | Required behavior |
|---|---|
| `GET /workspace?branch_id=&at=` | Bounded public state at an exact ancestral moment, server action-head metadata separately, pending operation summary, effective configuration IDs and capability map. No full private snapshot. |
| `GET /timeline?branch_id=&cursor=&limit=` | Stable chronological entries with kind, narrative ordinal, episode/scene/group metadata and excerpts up to 240 characters. Default 40, maximum 80 entries. |
| `GET /passages/:beat?branch_id=` | One original/effective narrative text and current-path art placement, stable identity and neighboring narrative passage IDs. Reject non-ancestral/foreign beats. |
| `GET /codex?branch_id=&at=&section=&cursor=` | Categorized public foundations, cast, facts, goals, commitments or relationships. Maximum 40 rows; bounded evidence summaries. |
| `GET /evidence/:beat?branch_id=&at=` | Original source text and stored quotes where present, with source type. Legacy records say “passage-level evidence.” Never infer missing exact quotes. |
| `GET /planning?branch_id=&at=` | Explicit owner-only private reference/craft inspector, with private fields labelled and no credential material. |
| `GET /assets?branch_id=&at=&cursor=` | Gallery collection, bounded metadata/thumbnail URLs, current placements and historical retention explanation. No inline full images. |
| `GET /jobs/:job` | Authenticated status, finished units, known/unknown cost and result links; rejected prose, hidden review explanations and secrets are omitted. |

Timeline cursors bind story, branch, ancestry head and sort key. If a head changes during a paginated read, return a clearly identified old snapshot or a refresh-required response; do not splice different histories into one window. Narrative ordinals exclude Ask, correction/control and editorial records. Older local bookkeeping stays visible in optional history filters.

Evidence at an older reading point must not show knowledge or corrections from its future. Art display has an explicit mode: current path presentation for ordinary rereading; historical presentation only when the user selects the “As it was” view. Label the difference.

### 5.3 Mutation envelope

New commands accept `expected_revision`, `branch_id`, `expected_head_beat_id` and `idempotency_key`; paid commands also require `plan_id`. Every field is strictly validated. A fingerprint includes the target, normalized payload and referenced configuration. Replay is checked before current provider availability, so completed replay remains free. Different input under the same key conflicts.

Preserve existing route behavior through adapters until the client has moved. New endpoints include `/commands/references`, `/commands/configuration`, `/commands/editorial`, `/commands/display`, `/commands/placements` and purpose-specific job starts. A local command atomically writes an immutable collection revision, appends its local history record and advances the branch/game revision. It performs no provider call.

Read-only path browsing remains available during a pending narrative operation. A mutation still uses current revision/idle checks. Art/audio/export jobs use immutable source snapshots and do not hold the story's pending-narration slot for their entire lifetime; attaching a result later must be a separate stale-checked action or a conditional commit to the reviewed unchanged target.

## 6. Reading position, drafts and lifecycle

### 6.1 Reading bookmarks

Persist a device-scoped bookmark using story/path/passage identity and a paragraph anchor plus relative offset. Do not store prose or private facts in localStorage. Save when navigating away, after throttled scroll, and on page hide. Validate the bookmark against current ancestry when reopening. If missing or invalid, offer the nearest surviving narrative ancestor or latest, with a clear explanation.

The same bookmark survives room changes and rotation. A new server result does not move a user reading history. Show **A new passage is ready** with an explicit jump action. Cross-device synchronization is optional; the first slice must not overwrite one device's reading position from another.

### 6.2 Drafts

Use the private server draft store for recovery across reload; retain an in-memory pending buffer during transient disconnection. Debounce writes, include the draft revision, cap a direction at the current 4,000 characters, studio fields at their validators, and total draft size at 256 KiB. Draft recovery is scoped to story/path/action/target and never automatically submitted.

On competing-tab conflict, preserve both versions and offer comparison. On ambiguous paid completion, reconcile by request identity/free reads before permitting a fresh purchase. Show that the prior request may already have completed. Clearing the composer is allowed only after confirming which exact draft was committed. Lock clears private DOM/memory, cancels draft writes and invalidates callbacks; durable server drafts stay authenticated. Default expiry is 30 days after last edit, with an explicit discard action.

### 6.3 Lifecycle and busy state

Classify controls as read-only, local mutation or paid mutation. Block only the classes that conflict with the running operation. Read-only navigation and current saved evidence remain available. Every callback carries lifecycle epoch, story, view path and target/revision context. A stale callback may update an operation ledger/status in the background, but must not reopen a sheet, change focus, overwrite a draft or navigate the reader.

Leaving a view does not claim transport cancellation. Stop buttons explain whether they prevent undispatched work or merely stop local playback. Already-dispatched provider work may be billable.

## 7. Shell, responsive layout and visual implementation

### 7.1 Routes and room ownership

Proposed hashes: `#/library/stories`, `#/library/worlds`, `#/library/characters`, `#/library/scribes`, `#/library/bookshelf`, `#/settings`, and `#/story/:id/:room` with branch/cursor in validated query state. Support existing `#/stories`, `#/new`, `#/story/:id`, `#/catalog/:kind` and `#/settings` as compatibility aliases. Query changes that move the reading cursor use history replacement; room changes support meaningful Back navigation.

Use one story switcher and one selected-story transition. The route layer waits for authentication and dispatches a room loader; room modules do not create their own selection globals. Shortcut actions to Codex/Gallery/Gate carry a focus target and a return descriptor.

### 7.2 Visual system

Reuse `frontend/brand/ink-morrow-lockup.svg`, bundled fonts and approved artwork. Restore strong Scriptorium composition in Library, studios, Gallery and thresholds. Keep running prose on quiet opaque vellum. Define semantic tokens for room surfaces, reading ink/paper, selected path, paid action, local save, warning, danger and focus; do not multiply hard-coded panel colors.

Portrait tablet uses a compact story/path header, central reader, reachable action strip, and five labelled room controls at the bottom. Reserve room for safe-area insets. Landscape tablet uses a labelled rail and a drawer when an inspector would squeeze the text. Desktop permits a collapsible inspector. At enlarged text all layouts reflow to a single content column as needed; viewport orientation alone does not determine available width.

Touch targets are at least 44 CSS pixels. Normal reading line length should usually be approximately 58–72 characters, but accessibility zoom takes priority. Use dynamic viewport height and tested keyboard resizing. Avoid two fixed bottom rows competing with the on-screen keyboard; the active composer can replace the compact action strip. The first viewport of an existing story contains prose under a compact identity strip, not a full cover and accounting panel.

### 7.3 Sheets and dialogs

Studios use full-page routes or full-height task sheets with saved/unsaved status, section navigation and persistent actions. Dialogs remain appropriate for short confirmation/review. Opening evidence from a search preserves the search state and return focus. Shared focus/scroll/dirty guards remain the single lifecycle implementation. Escape/backdrop cannot silently discard an entered draft or duplicate an in-flight action. Paid review returns to the originating task on cancel.

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

Ongoing focus is a visible chip with Edit/Clear. Invitations fill an empty draft and never submit, overwrite or claim that a proposed outcome occurred. Outside-story Ask entries appear in Chronicle and a separate Q&A surface, excluded from narrative page numbers, books and audio. Short **What changed** cards link a public change to its evidence and distinguish a local correction from a narrated event.

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

Scribe persona, Storyteller model, prose voice and read-aloud voice have distinct labels. All existing Scribe craft settings remain available. Changing the Scribe affects future narration through an immutable local configuration; it does not rewrite old passages or insert that persona into the cast.

## 11. Studios and Library

Retain the current seed-based development and image studios. Replace short-lived modal editing with a recoverable full-height task. Show Identity, Depth/History, Craft and Image sections as appropriate. AI development creates a candidate with field-level comparison and Restore previous fields. Accepting a candidate is local; saving remains explicit. Track current fields, candidate and saved baseline separately.

Preserve the current two-call maximum for an invalid AI reference draft and one image call for painting. Catalogue spend survives deleted content. Update exposure to state that private entered lore, motives and background go to reference drafting; image painting continues to receive the separate visible-field payload.

Add **Use in a new story** and **Add to this setup** handoffs that preserve the creation draft. Library cards show useful resume context and covers. Stories can be renamed through a local revisioned metadata command. References are collection-first; a new user can still start a custom situation without maintaining a catalogue or selecting a Scribe.

## 12. Narrative contract and context compiler

### 12.1 Configurable creative settings

Add validated story-local settings for perspective (`flexible`, `first-person`, `close-third`, `omniscient`), optional viewpoint cast ID, tense, language tag, length preset/word target, free-form genre description, tone/boundaries and current scene circumstances. Perspective is independent of player ownership and cast importance. No setting grants permission to invent an inhabited character's decisions.

Initial length presets: brief approximately 180 words, developed approximately 400, extended approximately 800; advanced target 100–2,000. These are targets, not padding requirements or promises. Preserve existing stories' short behavior through a compatibility default until the owner chooses another target; new stories use developed. A natural owned-character decision can stop earlier. Keep current 24,000-character prose cap unless measured justification changes it.

Pacing controls how much fictional time/action develops; length controls room to render it; screen pagination controls presentation. They must not share one slider. Audio speed and book language metadata are separate again.

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

### 12.3 Retrieval and budget

Separate recent narrative prose from Ask and local operations before selection. Reserve budget for current scene, relevant cast, protected relevant truth/knowledge, unresolved commitments, completed consequential events, targeted older evidence and recent narrative prose. Use current ancestry and latest fact versions; no sibling future, retired fact or unaccepted template update.

The compiler accepts an explicit input budget, output reserve and provider capability. Serialize and size every category before dispatch. Never exceed a known model limit; when no trustworthy tokenizer exists, use a conservative byte upper bound with protocol overhead and an explicit configured context limit. Unknown model capacity requires owner/provider configuration rather than an undocumented guess. Remove optional low-priority context first. If binding constraints cannot fit, refuse the purchase with a repairable explanation; never silently drop character ownership or fixed relevant truth.

Start with bounded deterministic SQL/relevance selection and narrative-only recent windows. Add rebuildable ancestry/fact indexes and sparse checkpoints only after measuring long fixtures. Store a bounded private context manifest of source IDs, versions and category sizes for diagnostics, without duplicating full story text or credentials in logs. Selected quality reviewers receive the same authoritative contract and candidate; more reviewers cannot recover omitted history.

### 12.4 Effects, intentions and narrative progression

Keep narrow effects and exact evidence. Resolve/reveal/resource effects require narrated event evidence; editorial wishes and attempted actions do not themselves establish successful outcomes. Explicit character speech can establish an owned commitment when that is exactly what the user supplied. Owner corrections are a separate local authority.

Add an explicit proposed outcome classification to generated effects and test intended, attempted and completed distinctions. Classification is model output, so matching an enum and quote still does not prove semantic correctness. Off mode retains one call; optional quality may reject concrete future-intention-as-completion cases within its existing budget. User correction remains available. Do not market this as deterministic semantic proof or silently add a mandatory reviewer.

Separate a director's opportunity selection from recorded events. Improve eligibility/fairness so three unresolved commitments cannot starve all other fitting patterns. In a reflective fixture where a quiet scene is eligible, a dedicated quiet opportunity must be reachable within four Follow turns despite at least three commitments. Explicit direction and immediate fictional circumstances still take precedence. The scheduler records what it proposed; only accepted evidence records what happened.

Keep actual goal resolution as evidence for a goal-based payoff. Add player-selected episode closure kinds such as pause, open ending or vignette without falsely claiming that goals resolved. No timer, compulsory crisis or state-change quota manufactures satisfaction.

## 13. Paid operation plans and recovery

Generalize reviewed operation plans around existing safeguards. A plan contains operation kind, exact story/branch/source, role/provider/model identities, data categories, credential-independent endpoint identity, maximum calls/segments, input/output bounds, timeout, references and estimate source. Hash its canonical representation. Estimates are not currency guarantees; only enforce a monetary cap when the provider supplies an enforceable contract. Unknown cost remains unknown.

Separate the review configuration identity from the exact action fingerprint so remembered configuration consent does not require a new modal for every passage. The server still checks the exact action target and current configuration on every dispatch. Changed provider/model, call ceiling, data exposure or reference use invalidates remembered configuration consent. Replace the old unscoped remembered flag with typed records; it grants no authority to new operation families.

Text quality stays Off/Standard/Memory/Both with maximum 1/4/4/6 calls and one repair. Reference development stays at most two; painting stays one. Audio has an explicitly reviewed segment plan. Record every dispatch before network work, including uncertain transport. No automatic transport retry or silent provider fallback.

Required states are `requested`, `running`, `succeeded`, `failed`, `interrupted` and `cancelled` where a request has undispatched work. Existing narrative tables can retain their current compatible status vocabulary; map it explicitly instead of rewriting old rows. Successful replay returns the same outcome. Restart does not resume purchases. Late arrivals may improve accounting but never revive an interrupted canon mutation.

Expose a free operation-status/reconciliation lookup by client action key. The client retains the key across a lost response and does not invent a new one on refresh. Distinguish no request dispatched, request pending, succeeded with result, and terminal failure with known/unknown spend. A free status read is not a retry.

## 14. Gallery and image handling

Gallery includes cover, world/Scribe/cast references, passage illustrations and unplaced ready assets. Use bounded metadata pages and thumbnails with lazy loading. Selecting an image shows full preview, alt description, provenance, current path use and retained historical use.

Upload and Paint are equal entry actions. A passage shortcut preselects its stable target, while the Gallery can find an older target directly through Chronicle queries. Placement commands are local and revision-checked. Preserve the existing one illustration per passage and one image per reference target during the first recovery; supporting multiple illustrations requires explicit reader/export/save layout contracts.

An unplaced asset remains in the collection. Removing a current placement does not delete bytes still needed by another path or saved historical presentation. Garbage collection walks every retained root before deleting an asset; local removal is never shorthand for erasing historical references. Preserve current upload limits, normalization, signature checks, random storage keys and content hashes.

D3 keeps initial painting text-only. If reference conditioning is later accepted, permissions reset on import, selected asset IDs and quantity appear in the reviewed plan, and provider refusal never deletes the local original. A refusal produces a visible reason and an explicit new action; it does not trigger a hidden repaint.

## 15. Listening and audiobook restoration

Adapt retained audio utilities to immutable fiction content. Build the speech input from selected-path narrative prose after effective wording resolution, excluding Ask, private references, input directions, corrections and sibling paths. Key audio by source text hash, provider/profile identity, model, voice, format and synthesis settings. Never cache across a different owner/installation; serve files only through authenticated routes.

A cache hit performs no synthesis. A new read-aloud purchase displays its segment count, model/voice and exposure. Plan segmentation locally before consent. Use bounded sentence-based segments within documented provider input limits. Count all synthesis calls, including any provider-specific repair. The initial implementation disables recursive bisect-and-retry; a rejected segment fails and requires a new deliberate plan.

One sequential worker is the initial default for constrained devices. Pause affects playback. Cancel prevents undispatched segments; dispatched work can still finish and be billed. Restart marks unfinished work interrupted, preserving completed cached segments and spend without automatic resumption. Explicit restart can reuse cached segments and purchases only the missing reviewed set.

Audiobook source freezes branch/head, effective wording and ordered text manifest before queueing. Narration continuing elsewhere does not alter that artifact. Label it as an edition and show when it differs from the current path. A late audio result may attach to its immutable edition even after the user switches views, but it cannot replace the current story's preferred edition silently. Include progress, file integrity, download, playback and cancellation in one workflow.

Auto-read is a bounded explicit run over saved text with a visible stop and reviewed maximum segments. Reaching unwritten text stops; it never generates new prose.

## 16. Gate, publication snapshots and sharing

Gate presents **Make a readable book** and **Keep playing elsewhere** as distinct tasks. The book workflow chooses a path/edition, title, author credit, language, optional front/back matter, editorial grouping and cover/placed art. Show a contents and art preview and explicit exclusions before build. Keep one normalized PublicationDocument as the common input to all nine adapters.

Freeze the exact reader-safe document/source manifest before asynchronous rendering. Job workers render that immutable snapshot rather than reconstructing from mutable `current()`. Local continuation does not silently change the book being built. A rebuild is an explicit new selection; cached identical output can be reused. Preserve separate EPUB image spine pages immediately before associated prose, with reflowable text. Missing placed media is a visible preflight error rather than silent omission.

Saved publication presets and private artifact metadata remain local. Book bytes contain intended public prose/art and owner-approved front/back matter, never hidden state, directions, rejected drafts, review text or credentials. Generated prose can itself contain a fictional secret; metadata filtering cannot guarantee semantic spoiler removal.

Restore shares only through a new current-fiction immutable snapshot adapter. Store a hash of the bearer capability, support expiry and revocation, prevent private caching/indexing and make viewing AI-free. Sharing requires an owner action with an included-content preview. Do not mount retired story APIs or promise a share merely by exposing a disabled button. Local private export remains complete when sharing is not configured.

## 17. Saves, reference portability and recovery

### 17.1 Portable story versioning

Introduce portable save version 2 when the first new durable feature is enabled. Keep format name and `.inkmorrow5` extension unless D4 chooses a clearer public name; extension alone never determines compatibility. Export a declared version, state version and explicit immutable collection sections for configuration, references, editorial revisions, display overlays, evidence and referenced images. Exclude drafts, bookmarks, credentials, consent, jobs, resumable requests and share capabilities. Carry aggregate known/unknown spend.

Read version 1 through its unchanged strict validator, then normalize into a version-2 in-memory import model. Supply deterministic defaults and label missing old quote provenance. Preserve input bytes. Read version 2 through its own exact-field schema. Unknown versions/fields remain rejected. Never write a version-1 label onto data an old app cannot read; warn that new saves need the recovery build. Do not provide a silent lossy downgrade.

Validate all new record IDs, ancestry, collection parent chains, subject ownership, referenced sources/hashes and size limits before staging or SQL writes. Remap every story/branch/beat/revision/asset reference on copy. Template source IDs are inert provenance only and may never reconnect to a same-named local catalogue entry. Imported image-reference permissions and purchase authority are reset.

Retain 10,000 moments, 40 paths, 24 cast, 400 story images and 64/128 MiB compressed/expanded ceilings initially. Add explicit counts/bytes ceilings for new collection rows and audio inclusion before shipping their serializer. Story saves initially exclude synthesized audio and publication binaries, which can be downloaded separately and recreated from prose. The preview names those exclusions. Do not promise a complete installation backup from a story save.

### 17.2 Reusable references

Create a separate versioned local reference bundle containing selected worlds/characters/Scribes and owned normalized images. It excludes request journals, credentials and provider reference permission. Preview names/counts/private-data warning and duplicate handling; import always creates new local entries. Add an import idempotency token so a lost response can be reconciled without creating duplicates.

### 17.3 Installation and old-series recovery

Keep cold-backup instructions for the complete configured database/media locations, with stopped writers and sidecars preserved. Never use an online scratch preflight as a backup method. D2 old-series conversion is a separate read-only source parser, preview and new-copy transaction; it reports unmapped features instead of inventing story facts. It cannot be implemented by opening a Version 4 database through the Version 5 runtime.

## 18. Migration, rollout and rollback discipline

Append migrations after the actual current schema head. Never edit the SQL or imported constants used by historical checksums. Each migration creates its own immutable source constant and has rollback-on-failure tests. Existing beats and initial state bytes remain unchanged. New query helpers support missing fields with explicit old-state readers.

Suggested migration groups are workspace drafts/projections, exact provenance, configuration/reference revisions, editorial/presentation revisions, and media/publication jobs. Assign final contiguous versions in implementation order. Application capabilities must identify which schema-backed features are actually available.

Before enabling a new state field, land its reader, reducer validation, transactional writer, strict save serializer/importer, ancestry/remapping tests and public/private projection together. A UI that can create data the save cannot preserve is a release blocker.

Use an internal recovery capability during integration; keep unfinished rooms out of normal navigation. Prototype all five rooms early, then release useful end-to-end slices. A visual rollback flag cannot undo an applied schema: before migration keep an installation backup, and roll back by compatible application code or restore into a separate data location. Older executables must continue to refuse future schema families/versions. Never promise schema downgrade.

No server or replacement deployment starts from this planning task. Future implementation PRs follow the chosen integration branch and exact-head CI policy. Reconcile stale branch instructions before creating a new release line rather than resurrecting abandoned work.

## 19. Delivery batches and dependencies

| Batch | User-visible deliverable | Main files/modules | Depends on | Exit criteria |
|---|---|---|---|---|
| B0: recovered experience | Populated tablet prototype and capability/decision matrix | Prototype fixtures, workspace/brand design spec, policy record | This guide | Stakeholder can inspect all five rooms and critical failure/keyboard states; no paid services. |
| B1: orientation | Adaptive shell, Desk actions, stable bookmark and room return | HTML, fiction router/state/shell/reader, CSS, auth lifecycle | B0 | Prose in initial viewport; typed direction/action matches; lock/rotation/Back preserve correct context. |
| B2: trustworthy inspection | Chronicle, categorized Codex, precise new provenance and private draft recovery | Query/evidence/draft helpers, store/routes, timeline/Codex, schema/save v2 | B1 | History and inspection work during generation; no future/sibling/private leak; drafts survive reload. |
| B3: creative depth | Full studios, story-local reference/craft/scene settings, context compiler | Library, reference/config helpers, context/service/director/model | B2 | Explicit adoption, bounded narrative-only context, varied Follow opportunities, independent length and pacing. |
| B4: editorial work | Chapters/volumes and optional wording edits | Editorial/display helpers, Chronicle, publication/save | B3; D1 for display editing | Grouping is AI-free; forks and imports preserve applicable layout/wording; original evidence remains available. |
| B5: visual collection | Gallery, unplaced assets, visual targeting, reference bundle | Media, asset queries, Gallery, bundle validation/import | B2 and save support | Upload/Paint equally usable; all-path retained assets survive removal and save-copy. |
| B6: listening | Read-aloud, bounded auto-read and audiobook editions | Audio job/call/cache adapters, provider routes, reader/listening | B3, B4 where enabled, B5 artifact shell | Cached replay free; cancellation/restart honest; immutable selected text and no surprise synthesis. |
| B7: finishing | Book preview/jobs, bookshelf, implemented revocable shares | Publication snapshots/jobs/adapters, Gate, shares | B4–B6 as applicable | All formats agree on frozen content; books/shares omit private metadata; revocation works. |
| B8: whole-product qualification | Real-tablet and long-work evidence, six manuals, release notes | Tests, fixtures, docs/PDF sources and release record | All released batches | End-to-end creative journeys pass; exact-head CI, visual and narrative evidence recorded separately. |

B5 can develop alongside B3/B4 after shared contracts stabilize. Audio and publishing do not require old-series conversion. Optional solo tools form a later coherent batch; any included tool must use local application-owned results and the same graph/save contracts. No milestone is described as complete merely because its design or tests have been written.

## 20. Verification plan

### 20.1 Mechanical fixtures

Use isolated stores and fake transports. Add regression fixtures for: stale/duplicate/late commands; conflicting tabs; old/new state and saves; both path ancestors sharing a passage; future corrections hidden from earlier inspection; exact quote/source/hash preservation; old quote absence; private source fields excluded before limits; drafting conflicts; no paid work during reading; and interrupted audio/publication work.

Reproduce the two discovered narrative weaknesses explicitly. Test an intention-only passage proposing a completed goal and distinguish structural validation limits from optional review rejection. Test reflective Follow with three live commitments and an eligible quiet scene. Do not replace these with assertions that merely mirror a new helper's implementation.

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

### 20.3 Long-form capacity

Build deterministic fixtures at approximately 500, 3,000 and 10,000 total history moments with multiple paths, dense facts, repeated reference revisions and bounded images. Record database/save sizes, maximum response size, query work, reader DOM size, peak memory and latency on the reference host/tablet. Output limits alone do not prove bounded query cost. Keep narrative windows capped independently of story length. The 10,000-moment boundary must either round-trip within the declared byte ceilings or fail with an explicit preflight explanation; never drop history to make the file fit.

Set performance budgets after B0/B1 baseline measurements and before B2 query implementations are accepted. At minimum the primary action acknowledges immediately, pagination does not render the full work, and no load performs a provider request. Capture reproducible hardware/runtime and cold/warm cases.

### 20.4 Narrative evaluation

Use The Drowned Bell, The Garden After Rain and a six-person ensemble over complete scene sequences. Evaluate fixed truth, fair clues, distinction between affection/trust/cooperation, perspective/tense stability, distinct voices, older consequences, quiet play, justified refusal and justified cooperation, owned decisions, scene variety and satisfying pause/aftermath.

Mocked providers establish mechanics. Later live evaluation, if explicitly authorized, uses recorded model/version/settings, blinded comparisons, whole sequences and latency/spend. More reviewers and higher price do not establish better fiction. Report semantic/literary limitations rather than converting a model's self-approval into a quality guarantee.

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

Draft 0.1 is the input to the reconvened architecture, UI/usability, behavioral and fiction/narration reviews. Each reviewer must identify missing implementation contracts, contradictions, unnecessary complexity and acceptance gaps, propose concrete replacements, and distinguish a true blocking decision from a routine engineering choice. The coordinator resolves findings in the guide and records their disposition in the companion review record. A final consistency pass must examine the refined guide rather than only the initial proposal.
