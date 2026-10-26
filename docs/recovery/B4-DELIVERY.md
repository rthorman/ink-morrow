# B4 — chapters and volumes on the playable path

B4 implements editorial organization on application **5.0.0**, family
`ink-morrow-5`, now schema **26**. It adds no paid operation. D1 wording edits remain
unaccepted and disabled: no manuscript editor, manual narrative replacement or
display-overlay endpoint is enabled. Scenes, episode endings and recorded truth
remain independent of chapter boundaries.

## Working journeys

Chronicle shows the applicable chapter/volume outline at its selected path and
moment. It pages 80 groups at a time; subsequent pages pin the original inspection
head. **Read chapter opening** uses the existing ancestry-checked reader. Reader
cursor, latest action moment and branch points have separate timeline labels.
Editorial bookkeeping is visible as a local record and never gains a narrative
passage ordinal.

Before adoption, the outline and books use the existing episode-based virtual
layout. No initial layout row is backfilled. **Organize chapters & volumes** opens
an authenticated full-height task for the active path's reviewed latest moment.
Historical/sibling layouts are read-only; return to the active path or explicitly
explore another path to change them.

The editor supports renaming chapters/volumes, splitting a chapter after a stable
passage, assigning chapters to volumes, starting a new tail chapter or volume,
removing chapter groupings and removing unused volumes. Passage choices are
searchable and page in batches of 80. No chronological reordering is offered.
**Preview chapter layout** validates current ranges without changing anything.
Save validates again before preparing its durable local-action identity.

A chapter covers the narrative passages after one anchor through another. Only
the final chapter is open-ended; its tail resolves through the selected head and
receives future prose on that path. Starting a chapter closes the old tail at the
current last narrative passage and creates an empty future tail. Empty closed
plans are also valid. Gaps receive explicit automatic **Unassigned passages**
groups, so removing a grouping never hides or deletes prose. Volume membership
must follow volume order and chapter ranges must be contiguous and non-overlapping.

This is optional organization, not a scene wizard or episode scheduler. An adopted
layout freezes its chapter choices: a later episode does not silently replace
those choices. A fork inherits only the editorial revision applicable at its fork
moment. A fork before adoption sees the virtual default; neither fork sees a
sibling's later anchors or tail.

Explore and Rewind now use one **Explore another path** task, with different
initial selections. Its free restore preview describes cast/control, telling and
chapter layout at the chosen moment, and explains that truth, knowledge, references
and private creative settings restore with it. The original future remains saved.
A changed selection needs its own preview before creating the path.

## Durability, source and publication contracts

`editorial-model.js` validates complete layout version 1. Each published value has
1–64 volumes, 1–512 chapters and at most 64 KiB of canonical UTF-8 JSON. Chapter and
volume identities are local to the layout; passage anchors are existing ancestral
opening/scene beats. Before/through-null supports the beginning and empty plans;
only the last chapter may have `open_tail: true`. No future or local-record anchor
is accepted. Limits apply to new adopted records. Oversized historical automatic
layouts remain readable/exportable and have a paged outline; the editor explains
its adoption limit rather than truncating their existing book structure.

Migration 26 appends a rebuildable narrative/episode metadata projection for bounded outline reads without reparsing full snapshots, and immutable `fiction_editorial_revisions`, with same-story
application checks, parent/producing-beat closure and deferred foreign keys. A
snapshot carries an optional `editorial_revision_id`; historical JSON is unchanged.
One editorial command produces one collection row and one local correction beat,
advances the branch and commits the existing idempotency receipt atomically.
Configuration/reference/editorial revisions share the 10,000 aggregate cap.
Immutable UPDATE guards and strict import validation complement runtime checks.

Story-local editorial drafts bind game, path, head and base revision. Incomplete
private headings can be acknowledged without publishing an invalid layout. Save
now, Copy, optimistic conflict comparison and earlier-proposal recovery use B2/B3's
private draft manager. A prepared command key is acknowledged before dispatch;
unknown results require receipt inspection or an undispatched cancellation fence.
Stale proposals never silently rebase. Close/Back/room changes/Lock fence abandoned
callbacks; offline text remains honestly unsaved with explicit copy recovery.
Drafts and request authority do not enter a playable save.

Book building resolves the active path's applicable structure into the existing
normalized PublicationDocument. All nine adapters consume that same volume/chapter
sequence and original prose/placed images. Empty planned groups and empty volumes
are omitted from books; they manufacture no paragraphs. Existing virtual exports
preserve episode grouping. An already returned document/download retains its old
headings; a later build uses the newer layout. B7's durable edition/jobs and
Bookshelf remain future work.

Playable-save v2 adds an optional `editorial: {version:1,revisions:[...]}` collection.
Save preflight includes editorial bytes in the expanded-size bound. Validation
checks complete shapes, aggregate counts, sole producers, collection parents,
ancestral narrative anchors, chronological ranges, unchanged snapshot heads and
reachable rows. It rejects editorial rows that introduce canonical effects, share
a producer with another collection, cite a sibling/future/local anchor, or omit
their producing operation. A temporary validation projection strips only this
feature's fields before applying existing B3/frozen-v1 contracts; original saved
bytes and evidence remain authoritative. Import remaps editorial revision IDs,
parents, producing beats and anchor pointers. Group identities remain story-local.

## Preservation and verification

Local validation passed 544 backend tests and 333 frontend tests. Full desktop
and mobile runs passed 55 journeys each; the five affected editorial/rewind
journeys were rerun after the final layout/projection changes. Lint, setup,
brand/release, all four full dependency audits and deferred-PDF integrity checks
passed. Final integration additionally requires the five exact-head CI checks.
Synthetic desktop/mobile screenshots were visually reviewed:
[layout preview](../screenshots/recovery-b4/editorial-preview-mobile.png),
[Chronicle](../screenshots/recovery-b4/chronicle-editorial-mobile.png).


The host-only [query benchmark](B4-QUERY-BENCHMARK.json), reproducible with
`node scripts/benchmark-editorial.cjs`, uses synthetic in-memory data at 500,
3,000 and 10,000 passages. At 10,000 passages, five post-warmup samples measured
outline median/max 31.93/34.06 ms and boundary-page median/max 34.11/38.26 ms on
Node 24. These are host observations, not tablet latency guarantees or prose
acceptance evidence.


Before writing migration 26, genuine synthetic schema-25/B3 artifacts were captured
from main `8555c76`: `schema-25.db`, `baseline-25.json` and
`save-b3-v2.inkmorrow5` under backend tests' recovery fixtures. Tests compare original
ledger, initial-state and beat bytes, inject migration interruption, reopen and
continue/import an old save before adopting a layout. Migration 24, migration 25
and frozen save-v1 dependencies are not edited.

Deterministic backend tests cover virtual defaults, adoption/replay/fences,
non-overlap and stable anchors, tail extension, empty/fallback groups, branch
isolation, publication structure, old-save continuation, hostile save mutations,
private drafts, authentication and byte-preserving migration/rollback.
The browser fixture contains five explicitly synthetic garden passages generated
with an injected deterministic transport, never a paid provider. Desktop/mobile
journeys exercise splits, volumes, preview, exports, draft reload/Lock, historical
inspection, restore preview and late loading after Back, including a short keyboard
viewport. Full lint/setup/brand/release/docs/audit, backend/frontend and browser
checks are required before main integration, with all five CI checks green on the
exact final head.

Source/CI evidence does not claim real Android IME/rotation acceptance, live
literary quality, a production migration, deployment or paid-provider testing.
The full retained/unplaced Gallery is **B5 next**. Audio/listening remains B6;
D1 wording edits, D2 V4 conversion and D3 image conditioning still require their
separate decisions.

All affected manual sources and continuation records are updated. **No manuals'
PDFs are regenerated** until the stakeholder's final recovery work-package
checkpoint. The existing six PDF files remain the verified B2 build; the explicit
update policy continues to check their last-built hashes.
