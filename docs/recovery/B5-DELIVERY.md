# B5 — retained Gallery and private reference portability

Implementation branch: `recovery/b5-visual-collection`, based on main `80a5236`.
This record is provisional until the exact final head passes all five CI checks
and merges. Version remains 5.0.0; storage schema advances to 27. B6 and B7 remain
separate development batches. D1, D2 and D3 remain gated.

## B5 retained visual collection

Gallery now lists the story-owned image collection in metadata pages of forty,
including unplaced uploads and painting results. Thumbnails load lazily; Preview
shows the full image, provenance and bounded retained-use metadata. Choose a cover,
private reference or ancestral passage before placing an existing image. Placement
and removal are local actions; earlier path snapshots and retained collection bytes
remain available. New painting is one explicitly reviewed Illustrator purchase.
A changed path, cancellation or restart cannot silently attach a late result:
validated bytes remain ready and unplaced, and known/unknown spend remains visible.
There is no automatic retry or reference-image conditioning.

The existing 400-image story ceiling remains. Every inventory member is an owned
retained root; this batch exposes no permanent asset deletion or garbage collection.
Playable save v2 carries all owned images and optional inventory descriptions and
provenance, but no painting jobs, action keys, consent or provider credentials.
Import creates new image identities and a fresh inventory concurrency value.

Visual Library offers selected-reference bundles (`.inkrefs`): worlds, characters
and Scribes with normalized images and private lore/motives. Preview names matching
existing entries; import always makes independent copies. A repeated identical
import action returns the original copies, changed bytes conflict, and deleted
results are reported rather than recreated. Bundles omit credentials, purchase
journals and image-conditioning permission. They are unencrypted private files,
not reader-safe books or full installation backups.

## Implementation and preservation

`gallery.js` supplies selected-ancestry inventory queries, full preview/use metadata,
normalized uploads, reuse placement, independent art job/status/cancellation APIs,
and bounded target search. `gallery-migration-v27.js` appends inventory metadata,
an independent collection revision and painting records. Previous migrations,
initial-state JSON and beat bytes are untouched. Genuine synthetic schema-26
fixture/baseline files under `backend/tests/fixtures/recovery` verify byte-preserving
upgrade and rollback on injected migration failure. No owner database was opened.

Painting records bind the explicit source path/head/revision, reviewed provider,
model, target and action fingerprint. One active painting per story is claimed
before dispatch. Credentials resolve before the claim. Image transport has no
retry. Completed normalized bytes enter owned inventory before any placement;
attachment additionally needs the original active path, head and story revision,
and idle narration. Cancellation fences an unregistered key and stops attachment;
an already dispatched result may still be charged and retained. Restart marks
unfinished jobs interrupted. Late results cannot change terminal status back to
success. Status lookups buy nothing. Catalogue purchases remain Library scoped.

Story spend adds independent art charges once alongside old requests and narrative
call rows. Private-save export captures aggregate known/unknown costs and owned
images without resumable jobs. A save cut excludes results settled later. The
400-image cap remains; permanent removal/GC is deliberately unavailable because
all collection entries remain retained roots. An unsettled dispatched painting reserves one slot, including cancellation/interruption until settlement, so another upload cannot displace its paid result.

Image dialogs use server-acknowledged private Gallery drafts and submitted action
identities. Directions and descriptions recover after reopening; files require
reselection. Unknown submissions expose status and cancellation/fence controls,
not an automatic fresh purchase. Lock closes draft controllers and prevents late
callbacks from repopulating private UI. Manual painting still supports explicit
passage and story-reference targets with upload parity.

Reference bundle v1 has strict envelope/entry/media validation, 80 selected entries,
64 MiB packed / 128 MiB expanded bounds, normalized WebP decoding and hashes.
Import stages fresh image identities then commits all entries and a digest-bound
installation receipt in one transaction. Rollback removes only newly staged files.
Same-name entries are reported in preview and copied, never overwritten.

## Verification checkpoint

Initial complete backend run: 556 tests passed in 51 suites. Targeted new Gallery
and editorial tests passed, including stale/cancelled/interrupted painting and
unplaced save-copy. Reference-bundle tests passed private-data preview, copy/replay,
changed-key rejection, deleted-result rejection and transactional rollback.
New desktop and mobile browser journeys passed upload/place/remove/reload and
server-draft recovery. The complete browser suite exposed two obsolete painting
route mocks; these are corrected for the new endpoint and require rerun.

Audit maintenance updates minimatch to 11.0.1, test-exclude to 7.0.2 and its glob
line to 14.0.3; qs to 6.17.1 and follow-redirects to 1.16.2. ESLint and Jest majors
remain unchanged. Full tests and coverage-tool compatibility must pass after these
changes. Remaining low-severity development-tool findings do not cross the existing
moderate audit threshold; no audit check is weakened.

The corrected complete desktop and mobile suites each passed 57 journeys. All
557 backend cases passed after dependency updates; the added inventory-boundary
regression passed separately (10 Gallery cases). All 336 frontend cases passed
across the complete run plus the corrected UUID-fixture targeted rerun. Coverage
tooling, lint, setup, branding/release and deferred-PDF integrity checks passed.
The mobile Gallery screenshot is retained under `docs/screenshots/recovery-b5`.
Five exact-head CI checks and actual main integration remain pending.
Six manual sources are updated; PDFs intentionally remain deferred. No real Android
IME/rotation, live literary quality, production migration or deployment acceptance
is claimed.
