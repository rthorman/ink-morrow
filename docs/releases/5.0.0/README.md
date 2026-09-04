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
   Status: planned.

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
- **B — clear influence:** implementation includes visible play styles, moment
  versus ongoing direction, local invitations, free repeated-challenge review,
  current-path recall and earlier-evidence links. Verification and PR delivery
  are in progress; this entry is not a merge claim.
- **C — people and complete episodes:** remains planned, followed by fresh-storage
  cutover, the full six-book release edition and final hardening.

Development is consolidated in WSL; Windows Chrome and PDF tooling may operate on
the WSL checkout. The owner explicitly abandoned older unmerged changes during
cleanup. Do not bring those changes into the 5.0 line. No permission to deploy or
start the replacement server is implied.
