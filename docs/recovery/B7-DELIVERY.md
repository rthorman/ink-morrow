# B7 — frozen books, Bookshelf and current-fiction reading copies

Implemented on `recovery/b7-finishing`, based on B6 main `5842623`. Application
remains 5.0.0, with append-only schema 29. Delivery remains pending exact-head CI
and actual main integration. PDFs remain deferred through the final recovery
checkpoint, as requested; all six source manuals include this feature.

## Behavior and authority

Gate explicitly separates readable books from all-path playable saves. The viewed
path/head is frozen without activation, together with its applicable editorial
layout, cover and placed art. Validated title, author, language and front/back
matter enter the same normalized PublicationDocument for all nine adapters.
Private server drafts recover metadata; edits require another preview. Contents,
art, source links, sample prose and exclusions precede explicit local rendering.

Immutable sources embed art bytes in one synchronous transaction/read cut. Missing
media fails preflight. No asynchronous renderer rereads mutable fiction/media.
Jobs have idempotent source/format-bound keys, one SQL running claim, bounded queue,
partial results, cancellation fencing and interrupted-on-restart behavior. Opening
screens never starts work. Output writes use owned staging, file fsync and rename
before a guarded DB commit. This does not claim directory-fsync durability on every
filesystem; missing committed bytes become unavailable, never fabricated success.
Identical output reuse and download verify size/hash; corrupt files are invalidated
and only an explicit new local build replaces them.

Bookshelf pages at 20 items with book/audio/art filters. Its book projection reads
metadata and file status, not complete story/book JSON. It retains the latest job
and latest successful output jobs for each format. Older sources, unavailable
bytes and interrupted builds remain visible; downloads/playback are explicit.
Removing a source cascades its jobs/shares and marks unreferenced file registry
entries unavailable before unlink. Pins reject unavailable files; files retained
by another snapshot are preserved. Source art is owner-only until placed/frozen.

Public reading copies use the new immutable current-fiction adapter, independent
of legacy APIs. Explicit configured HTTP(S) origin, owner preview/create, expiry,
revocation and clipboard/manual-copy fallback are implemented. Only SHA-256 bearer
hashes persist. Tokens live in URL fragments and Authorization headers, not request
paths/query logs. Reader content is normalized reader-safe text/art, no owner IDs,
private state, credentials or jobs. No-store/noindex/no-referrer and safe DOM text
rendering apply. No automatic hosting/reachability/deployment is provided. Local
export is complete with sharing unconfigured. Revocation cannot retract downloads.

Limits: sources 96 MiB each / 1,000 and 512 MiB aggregate; 20 active jobs, 10,000
retained jobs; outputs 256 MiB each / 2 GiB available files; 100 active unexpired
links per edition, 1–365 day expiry. Source bytes/preview metadata are private local
storage. Playable saves exclude rendered editions, audio, jobs and share authority.

## Evidence

- New backend tests cover all nine rendered/reread formats, frozen sources,
  inactive/sibling paths, missing media/embedded pins, bounded collection reads,
  cache corruption/rebuild, replay, cancellation/late results, restart, partial
  failures, source deletion/shared pins, genuine schema-28 preservation/rollback,
  owner authentication/CSRF, configured/unconfigured sharing, expiry and revocation.
- New frontend tests cover viewed-source selection, draft/preview invalidation,
  provider-free bounded collection loading and XSS-safe paginated public reading.
- Browser tests cover actual draft reload, JSON build/download, retained Bookshelf,
  no provider calls, public reading and the inherited illustrated EPUB/save journey.
  All four new B7 browser cases passed across desktop/mobile; the inherited
  illustrated EPUB/save case passed on both profiles. Clipboard refusal now has
  an explicit select-and-copy frontend regression.
- Full frontend run: 343/343 passed, plus the added clipboard fallback test. Focused
  backend: 11/11 passed. Both desktop/mobile B7 export journeys passed. The inherited
  illustrated EPUB/save journey also passed on both browser profiles.
- An inherited restart test closed SQLite without disposing its app. Its deferred
  callback failed the next test in the initial full run (577/578). The test now uses
  isolated createTestApp fixtures with disposal before close, including failure
  paths; all 51 generation tests pass. The repeated full backend run passed
  583/583 across 54 suites. Later thumbnail/private-art availability assertions
  passed in the focused 11-case edition suite. Exact final-head CI follows.
- CI at `411ee5f` passed all functional cases but the inherited scale import took
  62.6s against its unchanged 60s limit while Jest ran other suites in parallel.
  CI now runs that exact performance fixture separately from the parallel
  correctness suites. No test/data/threshold is removed or relaxed. The local
  full sequential run passed, with the scale suite completing in 46.7s.
- Automated screenshot inspected for the mobile frozen-book form. This is not
  real Android touch/IME, deployment or live literary evaluation evidence.

## Remaining integration

Record the final exact head/five CI results and actual merge before marking B7
complete. Then start N1–N6 from updated main. Final B8/PDF qualification follows.
D1/D2/D3, optional B9, paid evaluation and production startup remain outside scope.
