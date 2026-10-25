# Ink Morrow branch inventory

Audited 25 October 2026. Repository: `rthorman/ink-morrow`. Baseline: `main` at `9647cdec4fc8ef4762e407e9c0ba705d563694fb` (7 September 2026, catalogue-studio integration).

## Completed cleanup — 25 October 2026

The stakeholder subsequently authorized pruning and preserving all planning/state on main. **53 integrated development/documentation branches have now been deleted**, using an atomic push with exact old-head leases. **15 remote branches remain:** main, immutable `release/4.0.0`, and the 13 open dependency branches. An annotated `archive/v4.1-pre-v5` tag now preserves the final V4.1 source snapshot; the original beta tag is unchanged. See [BRANCH-CLEANUP.json](BRANCH-CLEANUP.json) for every deleted tip and retained head.

The tables below are the **pre-cleanup audit**, retained as evidence; they are not a current branch listing. Recommendations to consider cleanup and statements that documents are untracked describe that earlier stage and are superseded by this completion record and [CONTINUATION.md](CONTINUATION.md).

## Findings (before cleanup)

- **68 remote branches:** main, 54 integrated product/documentation/history branches, and 13 unmerged dependency branches.
- Of the 54 integrated branches, 33 tips are ancestors of main and 21 have different commit identities but exactly the same aggregate diff as their merged PR. The two release records are preserved in main ancestry; all other integrated branches have merged PR records. Where a PR head exists, its identity matches the current branch tip.
- **No outstanding non-dependency feature branch was found.** The apparent ahead counts on older branches are rewritten or squashed history, not evidence of missing functionality.
- All 11 Version 5 feature branches and the reader-feedback fix are integrated. The Version 5 release branches are behind main, not newer development lines.
- All 13 open PRs are dependency updates. The complete PR inventory contains 101 records: 70 merged, 18 closed without merging, and 13 open. The 18 closed-unmerged records are superseded dependency proposals; their branch heads are absent.
- One local branch and one worktree: main, exactly matching origin/main. Existing recovery documents are untracked local files, not a published recovery feature branch.

## Best sources for the recovery programme

| Source | What it offers | How to use it |
|---|---|---|
| Current main | Latest integrated Version 5 story graph, reader/director flows, memory, relationships, quality mode, visual catalogues and studio drafting | Base all new recovery implementation on this |
| Final pre-cutover main, `74741f7` (3 September) | Mature Version 4.1.0, database schema 18; all late V4 features and async feedback fixes | Primary historical comparison snapshot; inspect source and journeys without restoring its runtime wholesale |
| `release/4.0.0` | Original decoupled beta release record | Preserve immutable; earlier than the later V4.1 work |
| `v4.0.0-beta.1` tag, `716433f` | Main cutover to the original beta | Historical anchor; not the final pre-V5 product |
| `pr/09-adaptive-shell`, `pr/10-library-start`, `pr/11-desk`, `pr/12-chronicle`, `pr/13-codex`, `pr/14-gallery`, `pr/16-epub-pdf-gate` | Focused development history for the V4 rooms and navigation | Understand individual changes; compare with final V4 snapshot for subsequent fixes |
| `feat/manuscript-workspace-author-canon` | Canonical manuscript creation, cast roster and versioned Author Canon | Extract useful craft and usability patterns; already integrated historically |
| `feature/5.0-catalogue-studio`, `feature/5.0-visual-library` | Studio, reusable references and image restoration following V5 cutover | Already in main; improve rather than re-merge |

The final V4 source has frontend rooms under `frontend/app/features/` (Chronicle, Codex, Gallery, Gate, write, library), plus Play, Scribes and solo tools. Backend modules include campaign, play, continuity, publication, audio, writing and transfer. This is a richer reference than the original beta branch.

Several valuable late V4 branch names no longer exist, but their merged work is retained in main history and in the final V4 snapshot:

- `docs/expand-user-guide-35-pages`: Expand Ink Morrow user guide to 35 pages ([merged PR](https://github.com/rthorman/ink-morrow/pull/64)).
- `fix/async-action-feedback-audit`: Guard asynchronous workspace transitions ([merged PR](https://github.com/rthorman/ink-morrow/pull/67)).
- `feature/solo-tools`: Add optional deterministic solo tools ([merged PR](https://github.com/rthorman/ink-morrow/pull/63)).
- `feature/play-forks-prose`: Add alternate Play paths and prose shaping ([merged PR](https://github.com/rthorman/ink-morrow/pull/62)).
- `feature/living-campaign-state`: Add optional living campaign state ([merged PR](https://github.com/rthorman/ink-morrow/pull/61)).
- `feature/play-sessions`: Add optional contract-bound Play sessions ([merged PR](https://github.com/rthorman/ink-morrow/pull/60)).
- `feature/optional-scenes`: Add optional manuscript scenes ([merged PR](https://github.com/rthorman/ink-morrow/pull/59)).
- `feat/first-class-scribes`: Add first-class Scribe personalities ([merged PR](https://github.com/rthorman/ink-morrow/pull/53)).

Historical integration does not mean an old feature is exposed by the current Version 5 runtime. This inventory establishes where the work lives; the recovery implementation guide governs which capabilities should return and how. The existing owner direction abandons older unmerged work and excludes manual prose authoring from V5. No historical feature has been reactivated by this audit.

## Complete branch inventory

`A/B` means commits ahead of / behind current main by commit identity. **Ancestor** means the branch tip is reachable from main. **Equivalent merge** means its aggregate changes exactly match the associated PR merge diff and that merge is reachable from main. Dates are latest commit dates, not proof of active development.

### Current baseline (1)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `main` | 2026-09-07 | 0/0 | Baseline | Merge pull request #84 from rthorman/feature/5.0-catalogue-studio |

### Version 5 product and release branches (14)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `feature/5.0-catalogue-studio` | 2026-09-07 | 0/1 | Ancestor | [Restore AI-assisted branded catalogue studios](https://github.com/rthorman/ink-morrow/pull/84) → `main` |
| `feature/5.0-visual-library` | 2026-09-04 | 0/3 | Ancestor | [Restore visual catalogues and story image workflows](https://github.com/rthorman/ink-morrow/pull/79) → `main` |
| `feature/5.0.0-clear-influence` | 2026-09-04 | 0/15 | Ancestor | [5.0 iteration B: clear influence and readable consequences](https://github.com/rthorman/ink-morrow/pull/73) → `release/5.0.0` |
| `feature/5.0.0-consistency-quality` | 2026-09-04 | 0/11 | Ancestor | [5.0 optional quality: standard, memory or both model roles](https://github.com/rthorman/ink-morrow/pull/75) → `release/5.0.0` |
| `feature/5.0.0-history-director` | 2026-09-04 | 0/23 | Ancestor | [5.0 batch 3: history-driven play and game-only scope](https://github.com/rthorman/ink-morrow/pull/70) → `release/5.0.0` |
| `feature/5.0.0-illustrated-saves` | 2026-09-04 | 0/21 | Ancestor | [5.0 batch 4: illustrated stories and complete playable saves](https://github.com/rthorman/ink-morrow/pull/71) → `release/5.0.0` |
| `feature/5.0.0-people-and-episodes` | 2026-09-04 | 0/13 | Ancestor | [5.0 iteration C: people, episode payoff and returning to play](https://github.com/rthorman/ink-morrow/pull/74) → `release/5.0.0` |
| `feature/5.0.0-product-cutover` | 2026-09-04 | 0/9 | Ancestor | [5.0 completion: fresh storage, game-only runtime and unified manuals](https://github.com/rthorman/ink-morrow/pull/76) → `release/5.0.0` |
| `feature/5.0.0-reader-director` | 2026-09-04 | 0/25 | Ancestor | [5.0 batch 2: reader-director experience](https://github.com/rthorman/ink-morrow/pull/69) → `release/5.0.0` |
| `feature/5.0.0-story-foundations` | 2026-09-04 | 0/27 | Ancestor | [5.0 batch 1: branch-local playable fiction foundations](https://github.com/rthorman/ink-morrow/pull/68) → `release/5.0.0` |
| `feature/5.0.0-trustworthy-world` | 2026-09-04 | 0/18 | Ancestor | [5.0: trustworthy world state and fair resistance](https://github.com/rthorman/ink-morrow/pull/72) → `release/5.0.0` |
| `fix/5.0-continue-feedback` | 2026-09-04 | 0/5 | Ancestor | [Restore tablet pagination and clear Continue failures](https://github.com/rthorman/ink-morrow/pull/78) → `main` |
| `release/5.0.0` | 2026-09-04 | 0/8 | Ancestor | Merge pull request #76 from rthorman/feature/5.0.0-product-cutover |
| `release/5.0.0-main-integration` | 2026-09-04 | 0/7 | Ancestor | [Release InkMorrow 5.0.0: playable fiction](https://github.com/rthorman/ink-morrow/pull/77) → `main` |

### Version 4 development and release history (21)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `feat/manuscript-workspace-author-canon` | 2026-09-01 | 4/66 | Equivalent merge | [Rebuild manuscript creation and add versioned Author Canon](https://github.com/rthorman/ink-morrow/pull/47) → `main` |
| `pr/02-manuscript-hierarchy` | 2026-08-31 | 1/148 | Equivalent merge | [PR 02: Volume, chapter, and page hierarchy](https://github.com/rthorman/ink-morrow/pull/21) → `release/4.0.0` |
| `pr/03-revisions-recovery` | 2026-08-31 | 1/147 | Equivalent merge | [PR 03: revisions, copyediting, and truncation recovery](https://github.com/rthorman/ink-morrow/pull/22) → `release/4.0.0` |
| `pr/04-providers-vault` | 2026-08-31 | 1/146 | Equivalent merge | [PR 04: provider profiles, encrypted vault, and AI roles](https://github.com/rthorman/ink-morrow/pull/23) → `release/4.0.0` |
| `pr/05-continuity-v2` | 2026-08-31 | 1/145 | Equivalent merge | [feat(continuity): implement PR 05 revision ledger v2](https://github.com/rthorman/ink-morrow/pull/24) → `release/4.0.0` |
| `pr/06-writing-transactions` | 2026-09-01 | 4/144 | Equivalent merge | [feat(writing): implement transactional writing state machine](https://github.com/rthorman/ink-morrow/pull/25) → `release/4.0.0` |
| `pr/07-art-upload` | 2026-09-01 | 1/143 | Equivalent merge | [feat(imagery): add noncanonical art store and safe uploads](https://github.com/rthorman/ink-morrow/pull/26) → `release/4.0.0` |
| `pr/08-grok-sanitization` | 2026-09-01 | 1/142 | Equivalent merge | [feat(imagery): isolate Grok sanitation and explicit reference retry](https://github.com/rthorman/ink-morrow/pull/27) → `release/4.0.0` |
| `pr/09-adaptive-shell` | 2026-09-01 | 3/141 | Equivalent merge | [feat: add adaptive Scriptorium shell](https://github.com/rthorman/ink-morrow/pull/28) → `release/4.0.0` |
| `pr/10-library-start` | 2026-09-01 | 2/140 | Equivalent merge | [feat: add Library manuscript start](https://github.com/rthorman/ink-morrow/pull/29) → `release/4.0.0` |
| `pr/11-desk` | 2026-09-01 | 3/139 | Equivalent merge | [feat: complete the Desk authoring surface](https://github.com/rthorman/ink-morrow/pull/30) → `release/4.0.0` |
| `pr/12-chronicle` | 2026-09-01 | 2/138 | Equivalent merge | [feat: build the Chronicle workspace](https://github.com/rthorman/ink-morrow/pull/31) → `release/4.0.0` |
| `pr/13-codex` | 2026-09-01 | 0/136 | Ancestor | [PR 13: Build the Codex workspace](https://github.com/rthorman/ink-morrow/pull/32) → `release/4.0.0` |
| `pr/14-gallery` | 2026-09-01 | 0/132 | Ancestor | [PR 14: Gallery](https://github.com/rthorman/ink-morrow/pull/33) → `release/4.0.0` |
| `pr/15-publication-core` | 2026-09-01 | 0/130 | Ancestor | [PR 15: Publication document and core format adapters](https://github.com/rthorman/ink-morrow/pull/34) → `release/4.0.0` |
| `pr/16-epub-pdf-gate` | 2026-09-01 | 0/128 | Ancestor | [PR 16: EPUB, PDF, and Gate](https://github.com/rthorman/ink-morrow/pull/35) → `release/4.0.0` |
| `pr/17-snapshot-sharing` | 2026-09-01 | 0/125 | Ancestor | [PR 17: Immutable snapshot sharing](https://github.com/rthorman/ink-morrow/pull/36) → `release/4.0.0` |
| `pr/18-beta-hardening` | 2026-09-01 | 0/123 | Ancestor | [PR 18: Archive completion, hardening, and release evidence](https://github.com/rthorman/ink-morrow/pull/37) → `release/4.0.0` |
| `pr/19-main-cutover` | 2026-09-01 | 0/73 | Ancestor | [PR 19: Cut over main to the historical product 4.0.0-beta.1](https://github.com/rthorman/ink-morrow/pull/40) → `main` |
| `rebrand/ink-morrow` | 2026-09-01 | 1/69 | Equivalent merge | [refactor: rebrand 4.0 as Ink Morrow](https://github.com/rthorman/ink-morrow/pull/44) → `main` |
| `release/4.0.0` | 2026-09-01 | 0/118 | Ancestor | Merge PR 19a: Freeze 4.0.0-beta.1 release candidate |

### Older fixes and documentation (11)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `docs/consolidate-user-guide` | 2026-09-02 | 1/60 | Equivalent merge | [Consolidate the PDF documentation library](https://github.com/rthorman/ink-morrow/pull/51) → `main` |
| `docs/fix-technical-pdf-code-blocks` | 2026-09-02 | 1/59 | Equivalent merge | [Fix technical PDF code block rendering](https://github.com/rthorman/ink-morrow/pull/52) → `main` |
| `docs/pdf-library` | 2026-09-02 | 0/62 | Ancestor | [Publish the Ink Morrow 4.0 PDF documentation library](https://github.com/rthorman/ink-morrow/pull/49) → `main` |
| `fix/canonical-manuscript-start` | 2026-09-01 | 1/71 | Equivalent merge | [PR 10 follow-up: canonical story start and visible More menus](https://github.com/rthorman/ink-morrow/pull/42) → `main` |
| `fix/chronicle-memory-failed` | 2026-09-01 | 1/68 | Equivalent merge | [Fix Chronicle memory extraction across reasoning models](https://github.com/rthorman/ink-morrow/pull/45) → `main` |
| `fix/continuity-extraction-quality` | 2026-09-02 | 0/52 | Ancestor | [Harden Chronicle memory extraction](https://github.com/rthorman/ink-morrow/pull/57) → `main` |
| `fix/continuity-model-fail-fast` | 2026-09-01 | 1/65 | Equivalent merge | [Fix Chronicle memory model selection and heavy-cast extraction](https://github.com/rthorman/ink-morrow/pull/48) → `main` |
| `fix/gemini-continuity-reasoning-budget` | 2026-09-03 | 0/36 | Ancestor | [Fix Gemini continuity output budget](https://github.com/rthorman/ink-morrow/pull/65) → `main` |
| `fix/remove-4-0-dualities` | 2026-09-01 | 109/70 | Equivalent merge | [fix: remove manuscript workflow dualities and refresh 4.0 guidance](https://github.com/rthorman/ink-morrow/pull/43) → `main` |
| `fix/safe-setup` | 2026-09-02 | 1/61 | Equivalent merge | [Make setup safe and clean up empty Manuscripts](https://github.com/rthorman/ink-morrow/pull/50) → `main` |
| `fix/v4-rebrand-database-upgrade` | 2026-09-01 | 1/67 | Equivalent merge | [Preserve earlier 4.0 databases across the Ink Morrow rebrand](https://github.com/rthorman/ink-morrow/pull/46) → `main` |

### Version 3 history (8)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `codex/v3.0.2-cast-cost-fixes` | 2026-08-30 | 0/124 | Ancestor | [fix: stabilize cast creation and paid accounting](https://github.com/rthorman/ink-morrow/pull/1) → `main` |
| `codex/v3.0.3-cast-world-edit` | 2026-08-30 | 0/122 | Ancestor | [v3.0.3: cast roles and editable character worlds](https://github.com/rthorman/ink-morrow/pull/2) → `main` |
| `codex/v3.0.4-persistent-paid-consent` | 2026-08-30 | 0/119 | Ancestor | [v3.0.4: remember paid consent and improve cost reviews](https://github.com/rthorman/ink-morrow/pull/3) → `main` |
| `codex/v3.0.5-stories-assets-reasoning` | 2026-08-30 | 0/117 | Ancestor | [v3.0.5: story asset library and model-aware reasoning](https://github.com/rthorman/ink-morrow/pull/4) → `main` |
| `codex/v3.1.0-continuity-ledger` | 2026-08-30 | 0/115 | Ancestor | [the historical product 3.1.0: page-provenanced long-form continuity](https://github.com/rthorman/ink-morrow/pull/5) → `main` |
| `codex/v3.2.0-portable-archives` | 2026-08-31 | 0/113 | Ancestor | [v3.2.0: portable archives and full backups](https://github.com/rthorman/ink-morrow/pull/6) → `main` |
| `codex/v3.2.1-security-baseline` | 2026-08-31 | 0/109 | Ancestor | [v3.2.1: single-owner security baseline](https://github.com/rthorman/ink-morrow/pull/7) → `main` |
| `codex/v3.2.2-generation-flow` | 2026-08-31 | 0/106 | Ancestor | [v3.2.2: restore instant chained page previews](https://github.com/rthorman/ink-morrow/pull/18) → `main` |

### Pending dependency maintenance (13)

| Branch | Latest commit | A/B | Classification | Work / PR |
|---|---|---|---|---|
| `dependabot/github_actions/actions/checkout-7.0.1` | 2026-09-01 | 1/68 | Open dependency PR | [build(deps): bump actions/checkout from 6.0.3 to 7.0.1](https://github.com/rthorman/ink-morrow/pull/8) → `main` |
| `dependabot/github_actions/actions/setup-node-7.1.0` | 2026-10-12 | 1/0 | Open dependency PR | [build(deps): bump actions/setup-node from 6.5.0 to 7.1.0](https://github.com/rthorman/ink-morrow/pull/97) → `main` |
| `dependabot/npm_and_yarn/backend/dotenv-18.0.5` | 2026-10-05 | 1/0 | Open dependency PR | [build(deps): bump dotenv from 16.6.1 to 18.0.5 in /backend](https://github.com/rthorman/ink-morrow/pull/95) → `main` |
| `dependabot/npm_and_yarn/backend/express-5.2.1` | 2026-09-01 | 1/73 | Open dependency PR | [build(deps): bump express from 4.22.2 to 5.2.1 in /backend](https://github.com/rthorman/ink-morrow/pull/13) → `main` |
| `dependabot/npm_and_yarn/backend/img/sharp-wasm32-0.35.5` | 2026-10-05 | 1/0 | Open dependency PR | [build(deps): bump @img/sharp-wasm32 from 0.35.4 to 0.35.5 in /backend](https://github.com/rthorman/ink-morrow/pull/94) → `main` |
| `dependabot/npm_and_yarn/backend/jest-30.5.2` | 2026-09-28 | 1/0 | Open dependency PR | [build(deps-dev): bump jest from 29.7.0 to 30.5.2 in /backend](https://github.com/rthorman/ink-morrow/pull/92) → `main` |
| `dependabot/npm_and_yarn/backend/supertest-7.3.0` | 2026-09-28 | 1/0 | Open dependency PR | [build(deps-dev): bump supertest from 6.3.4 to 7.3.0 in /backend](https://github.com/rthorman/ink-morrow/pull/90) → `main` |
| `dependabot/npm_and_yarn/e2e/axe-core/playwright-4.14.0` | 2026-10-19 | 1/0 | Open dependency PR | [build(deps-dev): bump @axe-core/playwright from 4.13.0 to 4.14.0 in /e2e](https://github.com/rthorman/ink-morrow/pull/101) → `main` |
| `dependabot/npm_and_yarn/e2e/playwright/test-1.64.1` | 2026-10-19 | 1/0 | Open dependency PR | [build(deps-dev): bump @playwright/test from 1.62.1 to 1.64.1 in /e2e](https://github.com/rthorman/ink-morrow/pull/100) → `main` |
| `dependabot/npm_and_yarn/eslint-10.12.0` | 2026-10-12 | 1/0 | Open dependency PR | [build(deps-dev): bump eslint from 9.39.5 to 10.12.0](https://github.com/rthorman/ink-morrow/pull/98) → `main` |
| `dependabot/npm_and_yarn/frontend/jest-30.5.2` | 2026-09-28 | 1/0 | Open dependency PR | [build(deps-dev): bump jest from 29.7.0 to 30.5.2 in /frontend](https://github.com/rthorman/ink-morrow/pull/89) → `main` |
| `dependabot/npm_and_yarn/frontend/jest-environment-jsdom-30.5.2` | 2026-09-28 | 1/0 | Open dependency PR | [build(deps-dev): bump jest-environment-jsdom from 29.7.0 to 30.5.2 in /frontend](https://github.com/rthorman/ink-morrow/pull/91) → `main` |
| `dependabot/npm_and_yarn/globals-17.13.0` | 2026-10-05 | 1/0 | Open dependency PR | [build(deps-dev): bump globals from 15.15.0 to 17.13.0](https://github.com/rthorman/ink-morrow/pull/96) → `main` |

## Pending work: dependency updates only

Every pending dependency branch contains a single commit. Direct inspection shows only package manifests/lockfiles, or the CI workflow, changed. No product source changes are hidden in these branches.

- **Stale branches:** checkout is 68 commits behind main and Express is 73 behind. Refresh/recreate their dependency changes on current main before evaluating. Do not merge the old checkout workflow or package context wholesale.
- **Major-version review:** Express 4→5, Jest/jsdom 29→30, ESLint 9→10, dotenv 16→18, globals 15→17, Supertest 6→7, and Actions major upgrades need compatibility review. Treat these as maintenance work separate from product recovery.
- **Coordinated tools:** evaluate frontend Jest and its jsdom environment together; review the backend Jest upgrade against its own suite. Verify Playwright runner/browser alignment and accessibility tooling together.
- These branches are proposals, not tested recommendations from this audit. CI check status, security advisories and runtime compatibility were not evaluated.

Changed-file evidence:

| Dependency branch | Files changed from its base |
|---|---|
| `dependabot/github_actions/actions/checkout-7.0.1` | `.github/workflows/ci.yml` |
| `dependabot/github_actions/actions/setup-node-7.1.0` | `.github/workflows/ci.yml` |
| `dependabot/npm_and_yarn/backend/dotenv-18.0.5` | `backend/package-lock.json`, `backend/package.json` |
| `dependabot/npm_and_yarn/backend/express-5.2.1` | `backend/package-lock.json`, `backend/package.json` |
| `dependabot/npm_and_yarn/backend/img/sharp-wasm32-0.35.5` | `backend/package-lock.json`, `backend/package.json` |
| `dependabot/npm_and_yarn/backend/jest-30.5.2` | `backend/package-lock.json`, `backend/package.json` |
| `dependabot/npm_and_yarn/backend/supertest-7.3.0` | `backend/package-lock.json`, `backend/package.json` |
| `dependabot/npm_and_yarn/e2e/axe-core/playwright-4.14.0` | `e2e/package-lock.json`, `e2e/package.json` |
| `dependabot/npm_and_yarn/e2e/playwright/test-1.64.1` | `e2e/package-lock.json`, `e2e/package.json` |
| `dependabot/npm_and_yarn/eslint-10.12.0` | `package-lock.json`, `package.json` |
| `dependabot/npm_and_yarn/frontend/jest-30.5.2` | `frontend/package-lock.json`, `frontend/package.json` |
| `dependabot/npm_and_yarn/frontend/jest-environment-jsdom-30.5.2` | `frontend/package-lock.json`, `frontend/package.json` |
| `dependabot/npm_and_yarn/globals-17.13.0` | `package-lock.json`, `package.json` |

## Why some integrated branches still appear ahead

Twenty-one older branches are not direct ancestors of main. For each, the exact textual diff from its merge base to its tip equals the diff from the associated PR merge’s first parent to that merge. The merge itself is an ancestor of current main. This checks cumulative changes, including multi-commit squash merges, rather than relying only on commit hashes or PR labels.

For example, `fix/remove-4-0-dualities` reports 109 ahead and 70 behind because it carries the historical release-line ancestry. Its aggregate change matches the merged PR; that count is not 109 missing features. The same issue affects multi-commit manuscript, shell, Desk and Chronicle branches.

## Recommended disposition

1. Build recovery on current main and keep a clear reference to final V4 snapshot `74741f7`; do not use the old beta as the sole definition of Version 4.
2. Preserve `release/4.0.0` unchanged as required by project history and licensing rules. Preserve the beta tag and historical MIT line; do not rewrite history.
3. The other 53 integrated non-main branches are candidates for later housekeeping after a deliberate retention decision. Their work is integrated; deleting names is unnecessary to recovery. No branch deletion or archival was performed.
4. Triage the 13 dependency proposals in a separate maintenance batch; refresh the two stale heads first and require appropriate CI before any merge.
5. Put the recovery guide and later implementation on a dedicated branch when implementation begins. The current guide, roundtable reviews and this inventory exist locally and have not been committed or pushed.

## Method and limits

- Fetched all remote heads and full history without checking out another branch. Reconciled 68 API branch heads against remote Git refs; excluded the symbolic origin/HEAD alias.
- Read both pages of PR history (100 plus 1 records). Verified branch tips against recorded PR heads; no mismatches.
- Compared merge bases, ahead/behind counts, direct ancestry, PR integration and exact aggregate patch equivalence for all 21 divergent integrated branches.
- Remote advertises one annotated tag, `v4.0.0-beta.1`. Only one local branch/worktree is present. Unpushed branches on another machine, forks, deleted branch-only commits, stashes in other checkouts, deployment state and live databases are outside this inventory.
- No application code, server, deployment, branch tip, remote PR or remote branch was changed. No application tests were needed for this documentation audit.
