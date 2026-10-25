# Ink Morrow — continuation state

Updated 25 October 2026. This file is the handoff for a later session; it is stored with all recovery planning on **main**. Read [README.md](README.md), [implementation guide 1.1](IMPLEMENTATION-GUIDE.md) and the project [AGENTS.md](../../AGENTS.md) before changing runtime behavior.

## Stakeholder direction

The stakeholder finds V5 a major regression in visual quality, depth and usability, while valuing its playable-fiction idea. Restore the mature **Version 4.1** experience around V5's reader-director and immutable story graph. The stakeholder explicitly requested architect, UI/usability, behavioral and fiction/narration specialists, a detailed reviewed implementation guide, branch pruning, a V4.1 baseline upgrade and durable state/guides on main.

The stakeholder uses ChatGPT on an Android tablet. Real touch, Android Back, IME, portrait/landscape, rotation, enlarged text and recoverable long tasks matter. Existing screenshots and source reviews are not substitutes for observing these tasks.

## Source identities and architecture

- Runtime implementation baseline: main at `9647cdec4fc8ef4762e407e9c0ba705d563694fb`, V5.0.0, schema 23, family `ink-morrow-5`. Later planning commits on main do not imply changed runtime behavior. Fetch and compare actual main before implementing.
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

No recovery runtime code, schema migration, prototype or release has been implemented. No owner database, live deployment or external machine checkout has been inspected or changed. No old server was restarted, no paid provider calls made and no live literary-quality study conducted. No application test success is claimed from this documentation task. Shipped manuals remain for the unchanged V5 runtime.

The guide's proposed table names, endpoints, budgets and module splits are designs, not existing APIs. B0–B9 rows are not completed work. Real-device and narrative acceptance remain distinct from source/CI evidence.

## Pending policy / scope decisions

- **D1:** optional bounded copyediting would revise the current no-manual-prose rule. It stays disabled until explicitly accepted with its future-context policy and limitations; the core recovery does not depend on it.
- **D2:** V4.1-to-current conversion is a later previewed copy importer, not in-place database adoption. Do not interpret branch pruning as permission to migrate owner data.
- **D3:** sending reference images to models is separate from current text-only reviewed image plans.
- **D4:** no new public recovery version number has been selected. Final-4.1 archive tagging is not a new release declaration.
- Local solo tools are explicit follow-on **B9** after core B0–B8, with state/result/save requirements. Do not claim full 4.1 tool parity before B9 or silently erase the deferral.

## Next concrete work

1. Read the guide and final-4.1 source map, fetch current main, inspect the worktree and reconcile newer changes. Resume from main rather than deleted feature/release integration branches.
2. **B0 is next:** create a populated, tablet-reviewable five-room prototype and a row-by-row 4.1/V5 capability ledger, marking current, restored, deferred and policy-gated behavior. Use local fixtures; no providers or replacement server deployment required. Include loading, failure, paid review, keyboard-open and recovery states.
3. Obtain stakeholder feedback on that concrete B0 experience before broad runtime cutover. A useful five-room shell comes in B1 only when all existing tasks have working adapters.
4. Subsequent runtime slices follow the exact-head five-check CI policy and keep data readers/reducers/writers/save closure/projections together. Direct publication of these planning documents does not waive future code-review/release requirements.
5. Keep this state file current when a batch or decision changes. Record source integration, checks, prototype review, actual tablet evidence, live narrative evaluation and deployment separately.

## Remaining maintenance

Thirteen dependency PRs remain open and are separate from product recovery. Checkout and Express branches are stale against the runtime baseline; refresh before evaluating. Major Express/Jest/jsdom/ESLint/dotenv/Actions upgrades require compatibility review. No dependency was upgraded by this task. Never import old files wholesale merely to resolve stale branch context.

## Verification and publication

Branch deletion and retained-head/archive-tag identities were verified against the remote. Documentation links, whitespace, release/brand identities and shipped PDF freshness are checked before publication. The documents are committed/published on main; inspect this file's Git history to identify its documentation commit rather than expecting a self-referential commit hash here. Check remote main and CI when resuming; a push is not a claim that every later CI job passed.
