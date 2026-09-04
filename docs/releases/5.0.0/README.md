# InkMorrow 5.0.0 — playable fiction

Approved 4 September 2026. Integration branch: `release/5.0.0`.

Latest owner direction, 4 September 2026: add a Living-world fourth-wall setting
(Never, Rarely, Freely). The owner briefly cancelled the main merge and then
explicitly restored it **after implementation is complete**. This includes the
new setting, remaining approved release work and green CI, not an immediate merge.
The owner also approved an optional consistency-quality mode with bounded extra
LLM calls to the standard model, memory-support model, or both as useful. It is
off by default and requires explicit role/call disclosure and full spend accounting.
Optional quality passed all five CI gates and merged through PR #75. It is not
a deployed feature or a live-model benchmark; startup remains separately authorised.

Additional owner requirement before the main merge: unify product text logos on
the existing `frontend/brand/ink-morrow-lockup.svg` shown at the top of this
repository's GitHub README. App, authentication and manual branding use that one
artwork; normal product-name mentions are not replacement logos.

The player is normally a reader-director, not a member of the cast. Follow and
Steer must stand alone; Inhabit is optional and explicitly delegates character
control. Prose is the playing surface, not a conversion product. History creates
future possibilities. Quiet expression, scene resolution, and stopping are valid
parts of play. No points, streaks, forced avatar, or autonomous offline punishment.

## Release boundary

This is a new product, not a saved-data upgrade. Use fresh 5.0 storage; refuse older
database families without modifying them. No 4.x database, manuscript-archive or
character/template import is provided. Reuse secure infrastructure and useful
assets where appropriate, but do not preserve manuscript-first workflows merely
for compatibility.

Development uses `/home/rthorman/src/ink-morrow-5`. All feature PRs target the
release branch. The owner subsequently approved final main integration on green
CI and explicitly requested stopping the old port-3000 instance (now stopped).
Historical data remains untouched. Deployment/startup still needs a request.

## Substantial PR batches

1. **Story-state foundations** — transactional game/branch/beat state, immutable
   history, knowledge/control boundaries, corrections and forks, protected APIs,
   concurrency/idempotency and counterfactual tests. Status: PR #68 passed all CI
   gates and merged as `23d52e6` on 4 September 2026. Link:
   https://github.com/rthorman/ink-morrow/pull/68.
2. **Reader-director experience** — start/resume, unified readable story, Follow,
   Steer, optional Inhabit, cast/recap, history and alternate paths, immediate
   feedback, responsive keyboard-accessible navigation. Status: PR #69 passed all
   CI gates and merged as `30a1362` on 4 September 2026:
   https://github.com/rthorman/ink-morrow/pull/69. Local 343 backend tests,
   271 frontend tests including the added race regression, and 28 browser tests
   passed. All six PDFs regenerated.
3. **History-driven scenes** — curated openings, genre-aware scene patterns,
   persistent commitments and payoffs, bounded generation, episode endings,
   pacing, failure/spend accounting and causal regression tests. Status: PR #70
   passed all five CI gates and merged as `282cded` on 4 September 2026:
   https://github.com/rthorman/ink-morrow/pull/70. Local 358 backend tests,
   273 frontend tests and 32 browser tests passed. All six PDFs regenerated.
   Includes cast additions and preferences. Manual prose authoring was explicitly
   rejected by the owner and removed, not merely hidden.
4. **Illustrated stories and portable saves** — branch-local illustrations,
   explicit Illustrator purchases, safe local uploads, complete 5.0 save/import,
   reader-safe book exports and separate EPUB image pages. Status: PR #71 passed
   all five CI checks and merged as `1e2083a` on 4 September 2026:
   https://github.com/rthorman/ink-morrow/pull/71. Local 381 backend tests,
   277 frontend tests and 36 browser tests passed. All six PDFs regenerated.
5. **New-product release completion** — fresh database isolation and version
   identity, supporting surfaces, complete six-book rewrite/regeneration,
   integration/browser/accessibility checks and final release evidence.
   Status: PR [#76](https://github.com/rthorman/ink-morrow/pull/76) passed all five
   CI gates on head `6c4280a` and merged as `93a8f14` on 4 September 2026.
   The implementation programme is complete; final integration into main is
   separately gated on the final PR's exact head. Integration is not deployment.

Additional 5.0 presentation requirement: illustrations appear above their associated
story text in the reader/manuscript, but on a separate page immediately before that
text in EPUB. Cover both representations with export/layout regression tests.

Each batch is tested locally, pushed once coherent, opened as a PR, and merged
only after its current head is green. Pull the release head before the next batch.
Avoid tiny PRs and bypassing required checks. Record links and actual results here.

### Product-cutover verification

- Fresh ink-morrow-5/schema-21/IM50 identity, shared server/reset path selection,
  untouched old database and journal files, WAL-only 5.0 recovery, orphan and
  dangling-symlink rejection, private scratch failure and concurrent-change tests.
- Production auth stays explicit, legacy runtime and routes are not mounted,
  raw manual openings are refused, and local startup/play makes no provider call.
  Password recovery targets only the configured existing 5.0 database. Test-helper
  media roots are disposable rather than sharing production defaults.
- Local backend: 458 tests in the complete 43-suite run, plus the added dangling-
  symlink case in a passing 15-case isolation/production rerun (459 unique cases).
  Frontend: 297 tests in 32 suites. Browser: 24 desktop and 24 mobile scenarios,
  including canonical logo, keyboard/reflow/accessibility, saves and EPUB layout.
- PR #76 [CI run 33882024816](https://github.com/rthorman/ink-morrow/actions/runs/33882024816)
  verified all 459 backend tests in 43 suites and all 297 frontend tests in 32
  suites together on the final feature head. Brand, lint, production dependency
  audit and both Playwright projects also passed before the merge.
- Lint, setup safety, release/lockfile/PDF identity, brand and strict freshness
  pass. Production dependency audit reports zero vulnerabilities.
- All six current-product PDFs regenerated and checked for text, outlines,
  identity and visual layout. Pages: User Guide 35, Operations 15, Architecture
  15, State Machine Atlas 15, Security 16, Maintainer 16. Covers and running
  headers reuse the canonical README SVG; no active Development Edition label.
- Desktop/mobile logo screenshots and every PDF page were rendered for review.
  Verification used fixture data and no paid live model calls. Ports 3000 and
  3100 remain stopped after tests; code integration does not deploy a server.

The five 4.x browser specs are archived beside this file as historical product
contracts. Active browser tests now exercise the 5.0 reader-director journeys;
the existing backend and component regression suites remain active.

## Acceptance boundaries

- Readers can start and continue without becoming a character or editing lore.
- An explicit control handoff governs actions; Continue never silently takes an
  inhabited character's decisions or speech.
- A commitment on path A persists after reload and changes relevant later
  possibilities. Path B does not inherit it. Forks restore all relevant state.
- Hidden truth, character knowledge, future plans, and rendered prose are distinct.
- A failed/stale/duplicate operation never commits a partial or duplicate beat.
- Corrections, rewinds, and alternate paths are distinct and recoverable.
- State is bounded and relevant; no whole-history prompt or per-NPC background loop.
- Episodes can resolve and the player can stop without in-world absence penalties.
- Complete playable saves are separate from book-style exports; secrets and
  credentials never leak into a reader-facing recap or published text.
- No legacy database or save compatibility is a release blocker.

## Next-iteration considerations (4 September 2026)

The owner wants both Story-shaping and Living-world play styles and has asked
that repeated-persuasion/model-consistency risks be included in the design and
model-choice documentation considerations. The proposed next iteration is
[Agency, resistance and payoff](NEXT-ITERATION.md). It separates these recorded
decisions from proposed implementation scope, describes three substantial PRs,
and defines evaluation and documentation requirements. The owner then approved
these three PRs and the final green release PR into main.

- **A — trustworthy world:** PR [#72](https://github.com/rthorman/ink-morrow/pull/72)
  passed all five CI gates and merged as `499e23a` on 4 September 2026. Local
  verification passed 394 backend tests, 277 frontend tests and 36 browser tests.
  The six PDFs now use 5.0 filenames and development-edition covers.
- **B — clear influence:** PR [#73](https://github.com/rthorman/ink-morrow/pull/73)
  passed all five CI gates and merged as `2e6cd3b` on 4 September 2026. It includes visible play styles, moment
  versus ongoing direction, local invitations, free repeated-challenge review,
  current-path recall and earlier-evidence links. PR #73 also includes the new
  Never/Rarely/Freely Living-world fourth-wall setting. Local verification covered
  411 unique backend tests, 286 frontend tests and 42 browser tests; all six PDFs
  regenerated and passed QA. The current-head dependency audit passed after the
  previous run's registry timeout; no audit gate was bypassed.
- **C — people and complete episodes:** PR [#74](https://github.com/rthorman/ink-morrow/pull/74)
  passed all five CI checks and merged as `bea7fa3` on 4 September 2026. It adds
  qualitative relationship facets and development, episode questions/payoff,
  quiet aftermath and local current-path return recaps. Local verification passed
  420 backend tests, 289 frontend tests and 44 browser tests. All six PDFs passed
  regeneration, freshness and QA.
- **Optional consistency quality:** PR [#75](https://github.com/rthorman/ink-morrow/pull/75)
  passed all five CI gates and merged as `25bffb4` on 4 September 2026. Local
  verification covered 444 unique backend cases (442 full-suite plus two added
  real-API cases), 297 frontend tests and 46 browser tests. All six PDFs passed
  regeneration, strict freshness and QA. Off remains one call; Standard or Memory
  review caps at four total calls and Both at six. One repair at most, followed by
  all selected reviews; no transport retries or silent downgrade. Per-call durable
  accounting, reviewed role/configuration identity, local progress, role-specific
  settings and safe save/rewind restoration are implemented. No live paid model
  benchmark was performed. The separate fresh-storage/version cutover, full
  six-book release edition and final hardening subsequently passed CI and merged
  through PR #76, recorded above.

Development is consolidated in WSL; Windows Chrome and PDF tooling may operate on
the WSL checkout. The owner explicitly abandoned older unmerged changes during
cleanup. Do not bring those changes into the 5.0 line. No permission to deploy or
start the replacement server is implied.

## Post-release visual restoration

The owner restored reusable visual world, character and Scribe catalogues without
restoring manual prose authoring. The new `/api/fiction/catalog` API and Visual
Library screen support local details, upload and explicit Illustrator painting.
Setup freezes selected references and copies their normalized images to independent
story ownership. Story covers, cast portraits and world/Scribe reference pictures
support the same upload/paint choices; existing in-passage illustration remains.

Schema 22 adds catalogue metadata, owned images and a durable purchase journal.
Existing 5.0 schema-21 stories migrate without changing earlier ledger checksums.
Deleting catalogue content retains its spend record and never touches story copies.
Playable saves validate and copy all private references and story images. Books
include the current cover and passage art, with separate EPUB image pages, not
private world lore or reference portraits. Old-series import remains unsupported.

The reader pagination and Continue feedback repair shipped separately in
PR [#78](https://github.com/rthorman/ink-morrow/pull/78), merged at `400ce3b` after
all five exact-head gates passed. The visual restoration has its own substantial
PR and requires the same all-green main-merge boundary. All six current manuals
include these workflows; the User Guide remains 35 A4 pages. No further live paid
behaviour tests or deployment are part of this batch.
