# Architecture review — recovery implementation guide draft 0.1

Reviewed 25 October 2026 against the complete draft and current source. This is a documentation review, not implementation authorization. No application source was changed, tests or servers started, or provider calls made.

The architecture is sound in direction: one fiction graph, distinct reading and action positions, restored working rooms, immutable editions, bounded purchases, and strict copy import. The findings below make those decisions executable. **P1** means settle the contract before implementing the affected slice; **P2** means correct the affected workflow/specification before accepting its slice. None requires a user decision to finish the guide.

## AR1 — P1: Bind every command and read to an explicit authority tuple

**Guide:** 4.1, 5.2–5.3, 8, 20.1.

The draft correctly preserves the installation-wide active branch, but leaves the relationship between `viewPathId`, the server active branch, the narrative cursor, and the actual branch head partly implicit. In particular, the latest narrative passage need not be the branch head: a correction, reference update or placement can follow it. Existing `current()` always selects the global active branch, and `assertRequestCurrent()` checks global revision and branch. Existing readers are not suitable substitutes for a new read-at-path query.

**Source:** `backend/src/modules/fiction/store.js:24–40, 242–246`; current branch selection at `store.js:152–153`.

**Add this contract:**

> All new reads resolve an explicit `(story, view branch, inspection head)` and never change `active_branch_id`. Return `inspection_head`, `branch_head`, `latest_narrative_beat` and `global_action_target` as distinct fields. The inspection head must be an ancestor of the supplied branch head. `expected_head_beat_id` always means the actual graph head, including local history records. A command targeting branch B succeeds only when B is still the global active branch and its actual head and game revision match the submitted tuple. Selecting an action branch is a separate, idempotent, local transaction that returns a new tuple. It performs no purchase and cannot run during conflicting narration. A stale tuple is never silently rebased to the currently active branch.

For presentation, resolve two explicit heads: the inspection head for knowledge/evidence and, only for ordinary rereading, the selected branch presentation head for wording/art. Label that presentation choice. The “As it was” view uses the inspection head for both. An API must not obtain future corrections by resolving state at the presentation head.

**Acceptance:** two tabs browsing different branches; an intervening local correction without new prose; active-branch selection between review and dispatch; evidence viewed before its later correction. No mutation retargets and no free browse changes the other tab's authority.

## AR2 — P1: Specify the full immutable revision graph, including producing beats

**Guide:** 4.2–4.3, 5.3, 9–10, 17.1.

“Validate ancestry and collection parent chains” does not yet specify enough to prevent a snapshot from importing a sibling's revision or a collection from depending on a future producer. Foreign keys establish existence, not these properties. The new producing-beat links also form an intentional insertion cycle: a beat points to collection heads and the collection points back to its producing beat.

**Source:** current beat immutability in `backend/src/modules/fiction/schema.js:27–42`; snapshot ancestry checks in `fiction/saves.js:59–95, 166–192`; evidence validation in `fiction/model.js:130–174`.

**Add these rules:**

> Every collection row belongs to the same story as its producing beat. Every non-null parent belongs to the same collection kind and subject, and its producing beat is a strict ancestor of the child's producing beat. A snapshot may name a head only when that head's producer is the snapshot beat itself or an ancestor. The head, row and subject must all be compatible with that snapshot's cast/reference identities. Parent chains must be acyclic and resolve to a defined root. A null head on an old snapshot means that moment's embedded baseline; it never means a global latest value. The first revision stores a complete validated effective value over the baseline. Publish the collection row, producing local beat, updated branch head, revision bump and command result in one deferred-constraint transaction. No independently committed unattached revision is visible.

Define editorial operations and open-tail groups so every explicit passage anchor is ancestral at production and chronology remains implicit. On a fork, an open tail ends at the chosen read head; it cannot acquire the parent's later suffix. D1 wording revisions target an already-existing ancestral narrative beat, while original evidence continues to cite original bytes.

Generated primary evidence must retain the current accepted beat's prose or an allowed field of its stored input. The table's general “same ancestry” allowance must not broaden generation into citing an arbitrary old quotation as proof of a newly completed event. Separate older supporting references from occurrence evidence. Define source hashes over the exact UTF-8 bytes of the allowlisted source text field, rather than a serialization containing IDs that change on import.

**Acceptance:** reject cross-story heads, sibling-parent chains, future producers, self/cyclic parents, wrong subjects, dangling references and source-hash mismatches before staging. Accept a head produced by the consuming beat and preserve it through remapping.

## AR3 — P1: Freeze version-1 dependencies, not only the validator function

**Guide:** 4.2, 17.1, 18.

The proposed unchanged version-1 validator currently imports current genre, cast/fact, challenge and reference validators. Changing those modules for recovery can accidentally change version-1 acceptance even if the function body is untouched. Similarly, merely appending migrations is insufficient if a developer edits the imported schema constants used to checksum earlier migrations.

**Source:** validator imports at `backend/src/modules/fiction/saves.js:8–12`, exact state contract at `saves.js:100–106`; imported checksum sources at `backend/src/db.js:1901–1929`, checksum construction/verification at `db.js:1945–1949, 1960–1977`.

**Replace/expand the compatibility paragraph:**

> Preserve the version-1 structural decoder and all version-specific enum/shape/normalization semantics in a dedicated compatibility module. Share maintained technical media-safety checks where appropriate, but do not route version-1 shape validation through expanded version-2 validators. Validate the original version-1 object first; normalize a separate in-memory copy afterward. Version 2 supports historical state-version-1 snapshots and explicitly versioned new snapshots in the same save. Existing stored initial-state and beat JSON bytes remain unchanged. New writers emit only the declared new state shape. Each old reader supplies deterministic defaults without rewriting the historical record.

> Freeze historical migration names and checksum sources, including imported constants. Append new immutable migration sources. Keep a baseline fixture containing the actual pre-recovery migration ledger, and require every later slice to open and migrate it successfully with all prior ledger entries and historical story bytes unchanged. Test migration failure at intermediate steps, transactional rollback, successful re-entry, and subsequent startup. Update `DATABASE_SCHEMA_VERSION` and capabilities only with the corresponding contiguous migration.

**Acceptance:** genuine valid version-1 fixtures continue importing after current validators gain new fields; unknown old fields remain rejected; pre-recovery schema-23 storage migrates and reopens without ledger repair or source-data rewriting.

## AR4 — P1: Turn version-2 collection bounds into a concrete serializer contract

**Guide:** 4.3, 17.1, 20.3, B2–B5.

The guide supplies byte ceilings but defers collection counts. That leaves the first version-2 implementation free to accept unbounded revision chains or to serialize only current heads, losing historical roots. It also needs to specify unplaced assets: the current serializer exports every story-owned image, not only placed images.

**Source:** current complete asset export at `backend/src/modules/fiction/saves.js:202–220`; bounded graph validation at `saves.js:39–46`; current image-count enforcement at `fiction/store.js:263–275`.

**Add a version-2 limit/closure table before B2 implementation:**

> Initially permit at most one configuration/reference/editorial/display collection revision per producing local command, with one reference subject per adoption command. Across those collection kinds, total rows may not exceed the total retained moment count, initially 10,000. A generated change has one primary evidence record; retain the existing maximum of twelve changes per generated beat, and cap evidence rows at twelve times the retained moment limit. Keep quotation and reference field bounds consistent with their versioned validators and apply the stated UTF-8 payload ceilings only to new records, not retroactively to valid version-1 embedded baselines. Large imports additionally obey the complete expanded-byte ceiling, independently of count limits.

> Export the transitive closure of collection heads from every retained initial/beat snapshot, including all parent revisions needed to resolve them. Export every retained story-owned image in the collection, including unplaced images, and all placement metadata needed by historical snapshots. Excluding jobs must not exclude their committed collection results. Validate closure and reject missing or out-of-scope nodes; never silently drop them. If an accepted graph contains extra unreachable collection rows, define them as either named retained roots or reject them as malformed; do not depend on accidental database row order.

The suggested one-subject-per-command restriction is a routine scope choice that keeps the initial bound simple. Bulk adoption can be added later with an explicit revised bound. Track exact serialized size as the authoritative export test; do not treat existing rough preflight multiplication as proof that a file fits. Near a limit, show a recoverable save/export warning before a user spends on a new asset that cannot be preserved. Do not promise that all count-limit combinations fit the byte limit.

**Acceptance:** a save containing historical revisions and an unplaced upload round-trips; oversize closure fails before filesystem mutation; no historical revision is dropped to fit a limit.

## AR5 — P1: Give local commands and both import types durable replay ownership

**Guide:** 5.3, 6.2, 13, 17.1–17.2.

The mutation envelope requires idempotency but no durable result ownership is specified for local commands. `fiction_requests` is a purchase/narration lifecycle with a single pending slot; using it unchanged for local work risks coupling free operations to purchase state. Portable story import currently creates a fresh copy on every request, whereas only the proposed reference importer explicitly gains reconciliation.

**Source:** `backend/src/modules/fiction/store.js:224–239`; existing journal helper at `backend/src/core/operation-journal.js:14–69`; unconditional fresh story import at `fiction/saves.js:247–286`.

**Add this contract:**

> Local commands use a durable, story-scoped result journal adapted from the existing operation-journal pattern. Canonicalize and fingerprint the explicit target and normalized command payload. In one transaction, replay an existing matching terminal result before checking current revision/idle state, or commit the mutation and its result identity together. Same key with different payload conflicts. The journal records zero provider dispatches and does not acquire the narration pending slot. A response lost after commit replays the original result rather than appending another history record. Return the committed result identity separately from newer current-workspace metadata.

> Story-save import and reference-bundle import both take a private client import-action key plus a content digest. Commit the copy, identifier map/result identity and import receipt transactionally. Replaying the same action returns the same created copy; reusing the key for different bytes conflicts. Another deliberately requested copy uses a new key. Receipts are installation metadata, never purchase authority and never exported in a story save. If a result has subsequently been deleted, report that fact instead of silently recreating it.

Retain request keys before dispatch in the server-backed draft/action record; generating an opaque key only inside the final POST cannot support reload reconciliation. No automatic repeat POST is required for recovery: the free lookup is sufficient.

**Acceptance:** lost responses for a correction, reference adoption, branch selection and both imports cause one commit/copy; replay works after the active branch or provider availability changes.

## AR6 — P1: Define a linear cancellation/dispatch/attachment contract for jobs

**Guide:** 5.3, 6.3, 13–16.

“A separate stale-checked action or a conditional commit” leaves two valid implementations with materially different outcomes. The guide also permits a late audio result after view switching while prohibiting interrupted mutations; these are compatible only if view liveness and job authority are explicitly independent.

**Source:** existing art uses the story pending slot and checks authority before attachment in `backend/src/modules/fiction/media.js:49–68`; text dispatch records are durable at `fiction/call-ledger.js:14–31`; retained audiobook cancellation checks in `audio/audiobook-queue.js:68–104` are not a complete new job contract.

**Replace the job-attachment choice with this initial behavior:**

> A worker atomically claims each permitted call in the durable ledger before network dispatch, under the reviewed plan and still-active job authority. Cancellation atomically prevents further claims. A claim already made may incur a charge even if cancellation wins before bytes reach the provider. After each await, settle that call once and recheck job authority before making another claim or publishing a result. No cancelled or interrupted job can become successful or restore attachment authority; late completion may settle charges and retain technically valid private cache data only. View changes and lock do not, by themselves, cancel already-authorized jobs.

> Separate production status from attachment status. Art completion durably creates a ready story-owned asset. If the originally reviewed placement tuple is unchanged and automatic placement was explicitly part of that plan, publish the asset and placement in one guarded transaction. Otherwise keep the asset unplaced and offer a local placement action against a fresh target. No automatic paid rerun follows staleness. Audio/publication outputs attach only to their immutable edition; changing the current preferred edition is a separate local command. Persist result publication exactly once, and make replay return that result.

Specify worker disposal and generation/claim identities so callbacks from a reconciled runtime cannot publish files under a new job incarnation. Test cancellation immediately before claim, during transport, after file completion and during final publication.

## AR7 — P1: Integrate new spend without double counting or losing unknown charges

**Guide:** 4.3, 13, 15, 17.1, B5–B7.

Adding job ledgers does not automatically update the story's displayed spend or saved aggregate. Current story accounting unions old request-level charges with call rows while explicitly excluding requests that already have calls. It knows nothing about a new audio/media ledger. Reference development and catalogue painting also have a separate Library scope.

**Source:** `backend/src/modules/fiction/store.js:70–77`; `fiction/call-ledger.js:7–12`; catalogue aggregate in `fiction/library.js:183–186`; imported aggregate accounting in `fiction/saves.js:277–282`.

**Add this contract:**

> Define one story-spend projection over disjoint charge identities: existing request-level rows without child call rows, existing narrative call rows, new story media/audio call rows, and imported aggregate charges. Job totals are summaries, not additional charges. Use this projection for story UI, reconciliation and exported save aggregates. Every call preserves known amount and unknown-attempt count independently; an incomplete result is never zero cost. Late billing settlement updates the original charge once without reviving its operation. Cache reuse, placement, playback and attachment create no charge. A cached segment reused by another edition references its original cost provenance rather than copying that cost into another purchase.

> Catalogue/reference-draft costs remain Library-scoped unless the product deliberately attributes them to a story; selecting the resulting reference must not duplicate them. A save captures accounting at its export cut. It cannot promise to include billing information arriving after that cut; unfinished/uncertain charges remain explicitly unknown.

**Acceptance:** mixed legacy/request/call/job charges, a partially completed audiobook, cache reuse, imported aggregate spend, and late settlement yield the same known/unknown totals in UI and save without parent/child duplication.

## AR8 — P1: Pin immutable sources and make garbage collection race-safe

**Guide:** 5.3, 14–17, 18.

“Walk every retained root” describes reachability but not concurrency. A collector can decide an image is unreferenced just before a book or job pins it. File writes are also outside SQLite atomicity: a process can stop between file creation, database insertion, final rename and cleanup. Freezing a manifest alone does not keep its bytes available.

**Source:** private-file persistence/discard at `backend/src/modules/fiction/media.js:17–30`; staged save import at `fiction/saves.js:259–287`; current synchronous publication collection at `fiction/publication.js:16–47`.

**Add this contract:**

> Snapshot/edition creation resolves content and media under one consistent database read boundary, then transactionally records immutable source references and media pins before queuing asynchronous work. Source roots include all retained beat/initial presentations, the owner Gallery collection including unplaced assets, active jobs, completed retained editions, publication snapshots/shares, and any explicitly retained media drafts. An artifact may not reference a file that has not completed technical validation and publication.

> Garbage collection atomically marks an unreferenced asset unavailable for new references before unlinking it; attachment and pin acquisition must reject that mark or clear it under a defined transaction. Recheck roots under the same exclusion boundary before deletion. A file referenced by any pinned job or edition is retained even when removed from the current path. Use unique staging paths and a defined ready/publication transition; on restart reconcile known staged/partial/orphan files without deleting live files. A failed transaction cleans only files owned by that operation. Post-commit output publication is idempotent and can be completed locally or reported failed without a new purchase.

A simple transactional mark/delete protocol and one sequential worker are sufficient initially; no distributed queue or generic storage framework is needed.

**Acceptance:** concurrently remove an illustration while freezing a book, cancel at each file boundary, restart after rename-before-status, and import with injected SQL failure. Surviving roots always retain valid bytes.

## AR9 — P1: Budget the effective transport payload for every quality leg

**Guide:** 12.1–12.3, 13, B3.

The new length targets are independent of pacing in the guide, but the current service derives output tokens from pacing. More subtly, the shared transport can raise the requested output allowance when reasoning is enabled. A compiler checking a smaller reserve before transport normalization would be checking a payload different from the one actually purchased. Reviewer/repair messages also add candidate text and issues beyond the original generation context.

**Source:** narration options at `backend/src/modules/fiction/service.js:141–143`; transport normalization at `backend/src/ai.js:368–379`; candidate/repair/reviewer payloads at `fiction/quality.js:35–68`.

**Add this contract:**

> Resolve the final model capabilities and transport-normalized options before deriving budgets, hashing the reviewed plan or dispatching. The output allowance covers requested prose, JSON/effects and the model's reasoning convention, and is calculated from length independently of pacing. No downstream helper may silently enlarge it after review. The plan records those effective bounds. Check the actual serialized messages plus protocol overhead against each selected model's input/output/context limits for draft, review and repair, not only for the first Scribe call. Bound candidate and repair payloads by the same reviewed plan and recheck actual size before each subsequent dispatch. If a selected reviewer cannot accommodate the allowed candidate, refuse or explicitly review a smaller plan before the first purchase; do not silently omit that reviewer.

Keep the current call ceilings. Failure to fit after a charged draft does not authorize an extra retry and must preserve the real charge. A context-capacity configuration is model/profile-specific; changing it invalidates the corresponding plan.

**Acceptance:** a reasoning setting that raises effective output tokens, an extended-length passage, and a reviewer with a smaller context window all obey the reviewed bounds without transport mutation, truncation-by-surprise or reviewer fallback.

## AR10 — P2: Draft recovery must cover pre-story work and distinguish unsent data

**Guide:** 4.3, 6.2, 11, B1–B3.

The proposed draft key assumes a story and branch, but setup and a new reusable reference exist before either does. The text also promises recovery across reload while holding disconnected edits only in memory; those edits cannot survive reload reliably. This matters most to the restored studios, where a lost long reference draft recreates the exact usability failure the recovery is meant to repair.

**Source:** current studio accepts an unsaved `entry` and tracks an unsaved baseline/candidate in `frontend/app/fiction/library.js:76–157`; new-story creation happens only later through `backend/src/modules/fiction/library.js:153–176`.

**Replace the draft-storage scope paragraph:**

> Use typed draft scopes: new-story setup by private draft identity; reusable-reference studio by kind plus entry identity or private unsaved identity; and story contribution by story/branch/kind/narrative target. Story and branch are required only for the third scope. Do not create placeholder stories or catalogue entries merely to persist drafts. Retain fields, saved baseline and candidate separately where that workflow needs them. Draft records have optimistic revisions, bounded payloads, expiry and an explicit discard operation.

> Recover the last server-acknowledged revision after reload. Show when newer edits remain unsent or conflicted. In-memory buffering alone carries no offline/reload durability guarantee; warn on leaving with unsent work and offer an explicit local download/copy recovery where appropriate. Do not rely on `pagehide` delivery. Persist an action key and submitted draft revision before purchasing, and clear only that committed revision; later typing survives a late success. Lock invalidates callbacks, while already-received authenticated draft writes may finish without repopulating private UI.

**Acceptance:** create a reference and a setup without a story, reload after an acknowledged save, disconnect before a draft acknowledgement, submit then type newer text, and lock during a draft write. Each state has truthful recovery behavior.

## Choices already working and scope guidance

- Keep the five stable rooms around one selected story and graph. No second manuscript or transcript engine is needed.
- Keep the global action-branch compatibility boundary during early slices. Parallel browsing is a read capability, not permission to mutate multiple active branches concurrently.
- Preserve explicit owner planning, public filtering before limits, old passage-level evidence labels, local correction authority, and private original source text.
- Keep immutable publication/audio editions, one sequential audio worker, no automatic transport retries, no resumption of purchases on restart, and distinct known/unknown cost.
- Keep D1 and D2 as product decisions only when their optional endpoints/features are about to be enabled. Neither blocks core documentation or recovery.
- Keep migration append-only discipline and fail-closed old-family refusal. Add the baseline fixtures described above rather than attempting schema downgrade.
- Make the core book-preview/export slice independent of audio and reference-bundle delivery. B7's “as applicable” should become an explicit dependency: it requires the current publication projection plus any enabled editorial/display features; listening is required only for Bookshelf's audio subsection. Shares can be a later completed sub-slice. This reduces coupling without changing the single-product design.
- Final DDL remains an implementation review, but collection/authority/portable limits must be settled before B2 writes new data. Avoid building a generic command/job framework first; use the specified safeguards in the existing fiction modules and extract only genuinely shared mechanics.

**Genuine unresolved user decisions:** only the already-recorded optional wording-edit policy, optional old-series conversion scope, later image-conditioning expansion, and public release naming. The findings above are engineering decisions and do not need another stakeholder permission round.

Review complete. Only this review document was written. A short final consistency pass over the coordinator's refined guide remains available on request.

## Final consistency pass — refined draft 0.2

Read the complete refined guide and the roundtable disposition record. AR1–AR10 are substantively addressed. D1's selected wording/context policy is explicit, conditionally gated and honest about semantic limitations; it does not introduce a second fact authority. The source-bound edition, cost, cancellation, save-compatibility and migration contracts otherwise agree with the intended recovery architecture. This is design/source consistency review, not tested implementation.

### FP-AR1 — P1: Explicitly exempt non-path inventory and commands from path-only rules

**Guide:** 4.3–4.4, 5.3, 13–14, 17.1 and Appendix A.

The refinement correctly allows an unplaced asset to be produced without activating or advancing a branch and introduces a separate Gallery collection revision. But 4.4 still says every collection has a producing beat, while the revision-count/closure rules assume published revisions are rooted in beat snapshots. Appendix A also says all commands use the path-oriented 5.3 envelope, including pre-story creation, imports and source-bound editions. Applied literally, these rules either require a fictitious story mutation or reject the newly authorized independent operation. This exception was introduced by the refinement and needs one explicit scope definition.

**Exact correction:**

> The immutable collection producer/parent/head rules and aggregate revision-row bound apply to the four branch-scoped configuration, reference, editorial and display collections. Owner Gallery inventory is noncanonical installation/story-owned asset metadata, not another fictional timeline. Its concurrency version is separate from the story revision; inserting a ready unplaced asset changes that inventory only. Asset bytes remain immutable. The save's bounded story-image section carries every retained asset and necessary inventory metadata independently of beat reachability; imported copies receive fresh inventory concurrency authority and no job/receipt authority. Do not require an unplaced asset to have a fictional producing beat.

> The command envelope is a tagged union with a common action key, kind and fingerprint. Path mutations require the active branch/game/head tuple. Draft/catalogue commands require their own resource and expected revision; creation consumes the identified draft. Imports require the import key/digest. Artifact creation requires the explicit immutable source branch/head and selected presentation/configuration identities, plus a plan for paid work, without requiring that branch to be active or the game revision to remain unchanged. Irrelevant authority fields are rejected. Only a subsequent path placement changes the fictional/path presentation and requires the path mutation tuple and idle guard.

In section 14, spell out that unchanged placement coordinates alone do not authorize automatic placement: if conflicting narration is now pending, retain the result unplaced. This follows the existing idle rule and prevents art completion from invalidating a charged narrative response.

**Acceptance cases:** produce an unplaced image during narration without staling it; freeze an inactive path's book without activating it; create setup/catalogue drafts and import copies without fabricated branch fields; save/copy an unplaced result without a producing beat; finish art while narration is pending and keep the image unplaced.

With this scope correction, no other planning-blocking architectural contradiction remains. D1/D2/D3 and release naming remain the already-recorded conditional product choices. Implementation still needs the specified DDL, fixture, race, device and narrative evidence before its claims can be considered verified.

Final-pass review complete; only this report was appended. No source changes, server, tests, paid calls or merge were performed.
