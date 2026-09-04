# InkMorrow 5.0.0 — playable fiction

Approved 4 September 2026. Integration branch: `release/5.0.0`.

The player is normally a reader-director, not a member of the cast. Follow and
Steer must stand alone; Inhabit is optional and explicitly delegates character
control. Prose is the playing surface, not a conversion product. History creates
future possibilities. Quiet expression, scene resolution, and stopping are valid
parts of play. No points, streaks, forced avatar, or autonomous offline punishment.

## Release boundary

This is a new product, not a saved-data upgrade. Use fresh 5.0 storage; refuse older
database families without modifying them. Old character/template import is a
convenience only. Reuse secure infrastructure and useful assets where appropriate,
but do not preserve manuscript-first workflows merely for compatibility.

Keep the existing main checkout and port-3000 application untouched. Development
uses `/home/rthorman/src/ink-morrow-5`. All feature PRs target the release branch;
main integration and production deployment require a separate decision.

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
   pacing, failure/spend accounting and causal regression tests. Status: in progress;
   also includes cast additions and local preferences. Manual prose authoring
   was explicitly rejected by the owner and removed, not merely hidden.
4. **Portability and release hardening** — complete 5.0 save/export/import,
   new-product database isolation and version identity, supporting surfaces,
   all six books regenerated, integration/browser/accessibility checks and final
   release evidence. Status: planned.

Additional 5.0 presentation requirement: illustrations appear above their associated
story text in the reader/manuscript, but on a separate page immediately before that
text in EPUB. Cover both representations with export/layout regression tests.

Each batch is tested locally, pushed once coherent, opened as a PR, and merged
only after its current head is green. Pull the release head before the next batch.
Avoid tiny PRs and bypassing required checks. Record links and actual results here.

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
