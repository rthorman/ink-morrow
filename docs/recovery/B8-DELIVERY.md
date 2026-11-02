# B8 — final engineering and manual qualification

Final candidate on `recovery/b8-qualification`, based on delivered N1–N6 main
`0d23a704a901c5d7d15188062f9f8842563ef1df`. Application remains **5.0.0**, family
`ink-morrow-5`, schema **29**. Its exact-head five-check CI and actual main merge
remain the integration boundary. This is not a new release number or deployment.

The owner explicitly waived backwards compatibility. Current runtime/formats are
the target; no old-series converter or compatibility layer is required. Historical
files/migrations remain protected. D1 wording edits, D3 conditioning and optional
B9 solo tools are outside this work. No paid literary/voice trial was performed.

## Qualified scope

B1–B4 workspace, history/drafts, creative depth and editorial grouping remain.
B5 retained Gallery/reference portability, B6 saved-text listening, B7 frozen books/
Bookshelf/reading copies and N1–N6 source-grounded narrative context are delivered
through PRs #113–#116. The current capability endpoint and ledger now name retained
art, listening, frozen editions, Bookshelf, configured reading copies and narrative
context. Public reading still requires configured/reachable hosting and an explicit
owner capability; local export is complete without it.

A storage-failure path discovered during qualification previously attempted another
ROLLBACK even when SQLite had already rolled back the transaction, masking the
original error. The book service now preserves that original failure. A regression
injects the already-rolled-back failure, verifies the original error and confirms
no snapshot or fiction change. The focused edition/source-boundary run passes 12/12.
An initial large fixture run on the limited tmpfs exposed that path; the complete
fixture now uses a private directory on the checkout's filesystem, cleans only its
own generated files, and retains progress/evidence. No owner store is opened.

## Capacity evidence

Reproduce with `node scripts/benchmark-recovery.cjs`; the output is
[evidence/B8-CAPACITY.json](evidence/B8-CAPACITY.json). It records base SHA, measured
source digests, runtime, CPU, sample counts, database/response sizes, RSS and index
plan. The synthetic current-format fixture has two paths sharing early ancestry,
four normalized images (cover, two private portraits and passage), sixteen local
reference revisions and a new evidenced fact per narrative moment. Working facts
remain bounded at 128 while immutable history retains all sources.

| Total moments | Codex warm p95 | Passage warm p95 | Context compilation p95 | Portable save |
|---|---:|---:|---:|---|
| 500 | 6.47 ms | 3.89 ms | 55.61 ms | Complete round trip, both paths/source media |
| 3,000 | 23.57 ms | 2.96 ms | 231.78 ms | Complete round trip, both paths/source media |
| 10,000 | 127.71 ms | 5.50 ms | 1,196.43 ms | Explicit byte-ceiling preflight rejection |

Use the JSON as authoritative for exact measurements. Samples were collected on
a WSL i5-1245U host, with document rendering also active; they are not isolated
hardware certification. Metadata queries use 30 warm samples; narration compilation
uses ten. Reading responses stay around 1–11 KiB; compiled narration context stays
around 70 KiB instead of replaying the whole history. The 10,000-moment book preview
freezes 9,880 current-path passages and only two public book images, returning about
1.6 KiB of preview metadata in 7,525.86 ms in the measured concurrent run. No provider call occurred.
Peak process RSS includes save/import validation and is about 1.2 GB, not idle usage.

The dense 10,000-moment specimen exceeds the **128 MiB expanded** portable ceiling,
not the count limit. It fails with `SAVE_TOO_LARGE`, without omitting history or
claiming a successful portable backup. Bounded reading and frozen publication still
work. Use a cold full-installation backup for oversized material. This fixture does
not certify every media-heavy combination, phone hardware or network condition.

## Six-book PDF library

The temporary deferral is removed. All six sources, outputs and combined freshness
manifest are updated together. The User Guide integrates restored features into
its 33 task/journey chapters and remains **35 A4 pages**, using the existing type
size and canonical logo. Obsolete compatibility/pending-restoration descriptions
are replaced by current workflows; full local, complete-feature and subset journeys
remain. Covers use the current November 2026 checkpoint date.

| Manual | Pages |
|---|---:|
| User Guide | 35 |
| Operations & Recovery | 21 |
| System Architecture | 21 |
| State Machine & Invariant Atlas | 21 |
| Security, Privacy & AI Boundary | 22 |
| Maintainer, Testing & Release | 23 |

Repository QA rasterized all **143 pages**, checked extractable text, replacement/
brand residue and nonempty outlines, and produced six contact sheets. All contact
sheets and selected full-size cover/body/table/final pages were visually inspected.
Additional audits found no non-A4 pages, off-page words or loopback-only PDF links;
TOC links remain internal. See [evidence/B8-PDF-QA.json](evidence/B8-PDF-QA.json).
Poppler emitted Type 3 glyph bounding-box warnings while rasterizing retained
canonical artwork; covers/headers remained legible and text/bounds checks passed.
`npm run check:docs:strict` reports 58 source/assets and all six fresh outputs.

## Verification and acceptance ledger

| Evidence class | Actual result |
|---|---|
| Source features | B5–B7 and N1–N6 main merges verified after all five exact-head checks. |
| Local regressions | N1–N6 backend 593/593, frontend 344/344; B8 storage-boundary focused suite 12/12. Final B8 CI runs the complete suites. |
| Browser journeys | Desktop/Mobile Chrome deterministic fixtures; all N1–N6 exact-head browser CI green. B8 requires its own final browser check. |
| Populated visual review | Synthetic workspace/browser captures and all six PDF contact sheets/selected full pages inspected. |
| Capacity | Synthetic host measurements above; complete smaller saves, explicit dense-limit rejection, zero provider calls. |
| Real Android touch/IME/rotation | Not observed; browser emulation is not that evidence. |
| Live literary/voice evaluation | Not run; no paid trial authorized. Deterministic context tests do not establish model quality. |
| Owner migration, production startup/deployment | Not performed. |

Release-scale performance remains isolated from parallel correctness suites in CI;
its original build/export/import 60-second assertions are unchanged. Preserve
failures and exact source evidence; do not reclassify missing external acceptance
as a passing automated check. Final main/checkouts and task completion are recorded
only after the B8 PR actually merges with all five checks green.
