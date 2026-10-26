# Ink Morrow — continuation state

Updated 26 October 2026. This file is the handoff for a later session; it is stored with all recovery planning on **main**. Read [README.md](README.md), [implementation guide 1.1](IMPLEMENTATION-GUIDE.md) and the project [AGENTS.md](../../AGENTS.md) before changing runtime behavior.

## Stakeholder direction

The stakeholder finds V5 a major regression in visual quality, depth and usability, while valuing its playable-fiction idea. Restore the mature **Version 4.1** experience around V5's reader-director and immutable story graph. The stakeholder explicitly requested architect, UI/usability, behavioral and fiction/narration specialists, a detailed reviewed implementation guide, branch pruning, a V4.1 baseline upgrade and durable state/guides on main.

The stakeholder uses ChatGPT on an Android tablet. Real touch, Android Back, IME, portrait/landscape, rotation, enlarged text and recoverable long tasks matter. Existing screenshots and source reviews are not substitutes for observing these tasks.

## Dependency maintenance after B3

The audit fix updates only brace-expansion 1.1.18 → 1.1.21 in root/backend/frontend
lockfiles. ESLint and Jest stay on their existing major versions. CI also audits
all dependencies in all four package directories, including development tools;
the existing production-only audit remains. No runtime/schema or PDF change.
B4 subsequently implements editorial organization; its checkpoint follows.

## Current continuation checkpoint — B4

Updated 26 October 2026. B4 is implemented on application 5.0.0, family
`ink-morrow-5`, schema **26**. Read [B4-DELIVERY.md](B4-DELIVERY.md) for exact ranges,
limits, source/authority rules, fixtures and verification. B4 starts from the audit
fix on main `8555c76`; integration uses **Restore branch-local chapters and volumes**.
Fetch actual main and inspect the final PR head's five checks before resuming.

B0–B3 remain. B4 adds optional chapter/volume adoption, split/tail/volume editing,
private layout drafts/receipts, bounded historical outline and chapter navigation,
restore preview, common nine-format book grouping and strict editorial save-v2
closure/remapping. Before adoption, episode grouping remains virtual. Original
prose, evidence, scenes and episode endings are unchanged by grouping.

**B5 — complete Gallery is next.** Wait for the stakeholder to authorize it.
B6 listening and B7 durable finishing/Bookshelf remain later work. D1 wording edits,
D2 old-version conversion and D3 image conditioning remain separately gated. No
manual-prose/display-overlay endpoint has been enabled by B4.

Keep one immutable fiction graph and explicit active/latest targets. Editorial
snapshots select an applicable revision, never global latest. Only the last
chapter is open; anchors must already be ancestral narrative passages. Missing
ranges receive automatic fallback groups. Empty plans never fabricate prose;
books omit empty groups. New records cap at 64 volumes / 512 chapters / 64 KiB;
large virtual layouts retain read/export behavior and a paged outline.

Keep migration 24, migration 25 and save-v1 dependencies frozen. New preservation
fixtures capture genuine synthetic schema 25 and a B3 save before B4 was written.
Private drafts and request authority never travel in saves. Keep source guides
and this state on main through normal PRs. Audit all four package trees including
development dependencies; do not undo the prior brace-expansion patch.

**Do not regenerate PDFs until the final recovery work package.** Update all six
source manuals now; existing PDFs remain the verified B2 build under the explicit
integrity policy. Remove the policy, rebuild/inspect the complete six-book set and
update its source/output manifest at final completion.

Verification uses synthetic isolated databases/providers and desktop/mobile
emulation. Real Android IME/rotation, literary quality, deployment and owner-data
migration acceptance remain separate. No paid provider calls or production server
restart is authorized. Require all five exact-head checks before main merge;
prune only the integrated feature branch and return to a clean main checkout.
