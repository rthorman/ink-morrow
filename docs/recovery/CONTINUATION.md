# Ink Morrow — continuation state

Updated 25 October 2026. This file is the handoff for a later session; it is stored with all recovery planning on **main**. Read [README.md](README.md), [implementation guide 1.1](IMPLEMENTATION-GUIDE.md) and the project [AGENTS.md](../../AGENTS.md) before changing runtime behavior.

## Stakeholder direction

The stakeholder finds V5 a major regression in visual quality, depth and usability, while valuing its playable-fiction idea. Restore the mature **Version 4.1** experience around V5's reader-director and immutable story graph. The stakeholder explicitly requested architect, UI/usability, behavioral and fiction/narration specialists, a detailed reviewed implementation guide, branch pruning, a V4.1 baseline upgrade and durable state/guides on main.

The stakeholder uses ChatGPT on an Android tablet. Real touch, Android Back, IME, portrait/landscape, rotation, enlarged text and recoverable long tasks matter. Existing screenshots and source reviews are not substitutes for observing these tasks.

## Source identities and architecture

- Runtime implementation baseline: main at `9647cdec4fc8ef4762e407e9c0ba705d563694fb`, V5.0.0, schema 23, family `ink-morrow-5`. The later B0 work was isolated; B1 now changes the current-fiction workspace without changing schema/save format. See B1-DELIVERY.md and fetch actual main before continuing. Fetch and compare actual main before implementing.
- Historical comparator: `archive/v4.1-pre-v5`, commit `74741f7d4f6b7a29f7e3d19d795ab0dd252700cc`, V4.1.0, schema 18, family `ink-morrow-4`. This is final pre-V5 main, richer than the original beta. See [baseline source map](V4.1-BASELINE.md).
- Production uses authenticated `backend/src/app.js` with `legacyEnabled: false`; active browser entry is `frontend/app/fiction/bootstrap.js`. Retained legacy files are historical patterns/helpers, not a second application to enable.
- V5 already has restored catalogue studios, seed-based unsaved AI drafts, uploads/paintings, covers/passage art, reader pagination/error feedback, nine book formats and all-path strict version-1 `.inkmorrow5` saves. Do not rebuild them as if absent.
- Continue with a single fiction authority: `fiction_games`, `fiction_branches`, immutable `fiction_beats`, strict ancestry and durable per-call accounting. Restore the global Library plus Desk, Chronicle, Codex, Gallery and Gate through adapters.

## Completed in this planning programme

- Source investigation and four specialist analyses; initial recovery proposal archived here.
- Detailed guide 1.0, two specialist review passes, integrated fixes for command scopes, saved media ownership and conditional speech performance. Reports retained verbatim.
- All 68 remote branches inventoried, full history fetched, all PR history read, divergent historical branches checked against actual merged aggregate diffs. No unmerged product feature found.
- Pruned 53 integrated remote development/documentation branches. Retained main, immutable `release/4.0.0`, and 13 open dependency branches. Published final-V4.1 archive tag. Exact cleanup evidence is [BRANCH-CLEANUP.json](BRANCH-CLEANUP.json).
- Guide upgraded to 1.1 with explicit 4.1 capability/campaign/ownership mappings, B0/B8 parity gates and follow-on B9 for all six local solo-tool kinds. This amendment is source-based coordinator work; it has not received a third specialist pass.
- Original notes, proposal and review drafts copied into the repository with portable links. Guide/state discovery links added to root README and AGENTS.

## Not done / do not infer completion

B0 has the isolated synthetic prototype; B1 implements the current-fiction workspace. No schema migration, new release number or deployment is part of these batches. No owner database, live deployment or external machine checkout has been inspected or changed. No old server was restarted, no paid provider calls made and no live literary-quality study conducted. B0 browser/lint/audit evidence is recorded in B0-EXPERIENCE.md; actual tablet and narrative acceptance remain pending. All six shipped manuals have been updated for the B1 workspace; the application remains V5.0.0/schema 23.

The guide's proposed table names, endpoints, budgets and module splits are designs, not existing APIs. B0/B1 implementation and evidence are recorded separately; B2–B9 remain proposed work. Real-device and narrative acceptance remain distinct from source/CI evidence.

## Pending policy / scope decisions

- **D1:** optional bounded copyediting would revise the current no-manual-prose rule. It stays disabled until explicitly accepted with its future-context policy and limitations; the core recovery does not depend on it.
- **D2:** V4.1-to-current conversion is a later previewed copy importer, not in-place database adoption. Do not interpret branch pruning as permission to migrate owner data.
- **D3:** sending reference images to models is separate from current text-only reviewed image plans.
- **D4:** no new public recovery version number has been selected. Final-4.1 archive tagging is not a new release declaration.
- Local solo tools are explicit follow-on **B9** after core B0–B8, with state/result/save requirements. Do not claim full 4.1 tool parity before B9 or silently erase the deferral.

## B0 implementation update

The stakeholder subsequently requested implementation according to the plan. The first batch is the populated, isolated five-room prototype in `prototypes/recovery/`, with [interactive preview/screenshots/review tasks](B0-EXPERIENCE.md) and [38-row capability ledger](CAPABILITY-LEDGER.md). B0 demonstrates the recovery experience using fictional data; it does not mount the old runtime or replace current V5 surfaces.

Browser fixtures cover all five rooms, reading return, source evidence, fork/privacy scope, recoverable synthetic drafts, studio comparison, paid review, failure/unknown status, demo Lock, responsive layouts and access boundaries. Automated Chromium checks are not evidence of actual Android IME/platform behavior or literary quality. A self-contained artifact embeds all presentation assets and licenses and is tested without asset fetches.

Prior main CI failed its production dependency audit and skipped E2E. Narrow compatible patches to the vulnerable production dependencies accompany B0 so the exact-head CI policy can be met; pending major-version proposals are not adopted wholesale. Actual test and CI outcomes must be checked against the merged source head. No live provider calls, production database access or deployment are authorized by this batch.

## B1 implementation update

The stakeholder explicitly requested “Continue with B1.” The real V5 application now has Library and five current-fiction rooms, per-device story/path reading anchors, a shared full-height contribution sheet, typed session-only buffers, current-head Codex/Gallery/Chronicle adapters, local reading preferences, password change and paid-approval resets. Pending replies permit read-only navigation and do not steal the cursor/room. Lock hides and clears private UI immediately before awaiting logout. Existing V5 catalogue development, image tools, book/save export/import and control/correction/episode workflows remain reachable.

[B1-DELIVERY.md](B1-DELIVERY.md) is the detailed delivery/verification record with eight production-fixture screenshots. No backend authority, schema, save format, legacy-runtime flag or public release number changes. Six manuals and their PDF manifest are regenerated together; the User Guide stays 35 A4 pages. B1 source/CI and emulated-browser evidence do not certify actual Android use, paid narrative quality or deployment. Codex still shows current public state; branch selection changes the active destination; historical query/draft durability and complete media inventories remain later batches.

## Next concrete work

1. Read the guide and final-4.1 source map, fetch current main, inspect the worktree and reconcile newer changes. Resume from main rather than deleted feature/release integration branches.
2. **B1 is implemented:** inspect B1-DELIVERY.md and its production fixture screenshots; real Android device review remains unobserved. The stakeholder explicitly instructed proceeding with B1; do not reinterpret this as proof of a hands-on B0 review.
3. **B2 is next:** implement trustworthy bounded inspection/provenance and durable private drafts, with readers/reducers/writers/save closure/public projections together. Preserve the working B1 adapters and current owner workflows.
4. Subsequent runtime slices follow the exact-head five-check CI policy and keep data readers/reducers/writers/save closure/projections together. Direct publication of these planning documents does not waive future code-review/release requirements.
5. Keep this state file current when a batch or decision changes. Record source integration, checks, prototype review, actual tablet evidence, live narrative evaluation and deployment separately.

## Remaining maintenance

Thirteen dependency PRs remain open and are separate from product recovery. Checkout and Express branches are stale against the runtime baseline; refresh before evaluating. Major Express/Jest/jsdom/ESLint/dotenv/Actions upgrades require compatibility review. The B0 verification prerequisite updates only compatible production security patches; the sharp-wasm patch proposal may now be superseded. Reconcile current PR state before dependency triage. Never import old files wholesale merely to resolve stale branch context.

## Verification and publication

Branch deletion and retained-head/archive-tag identities were verified against the remote. Documentation links, whitespace, release/brand identities and shipped PDF freshness are checked before publication. The documents are committed/published on main; inspect this file's Git history to identify its documentation commit rather than expecting a self-referential commit hash here. Check remote main and CI when resuming; a push is not a claim that every later CI job passed.
