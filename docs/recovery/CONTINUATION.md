# Ink Morrow — continuation state

Updated 25 October 2026. This file is the handoff for a later session; it is stored with all recovery planning on **main**. Read [README.md](README.md), [implementation guide 1.1](IMPLEMENTATION-GUIDE.md) and the project [AGENTS.md](../../AGENTS.md) before changing runtime behavior.

## Stakeholder direction

The stakeholder finds V5 a major regression in visual quality, depth and usability, while valuing its playable-fiction idea. Restore the mature **Version 4.1** experience around V5's reader-director and immutable story graph. The stakeholder explicitly requested architect, UI/usability, behavioral and fiction/narration specialists, a detailed reviewed implementation guide, branch pruning, a V4.1 baseline upgrade and durable state/guides on main.

The stakeholder uses ChatGPT on an Android tablet. Real touch, Android Back, IME, portrait/landscape, rotation, enlarged text and recoverable long tasks matter. Existing screenshots and source reviews are not substitutes for observing these tasks.

## Dependency maintenance after B3

The audit fix updates only brace-expansion 1.1.18 → 1.1.21 in root/backend/frontend
lockfiles. ESLint and Jest stay on their existing major versions. CI also audits
all dependencies in all four package directories, including development tools;
the existing production-only audit remains. No runtime/schema or PDF change.
B4 remains the next recovery work package.

## Current continuation checkpoint — B3

B3 creative depth is implemented on the current V5 graph, application 5.0.0,
family `ink-morrow-5`, schema **25**. Read [B3-DELIVERY.md](B3-DELIVERY.md) for actual
modules, contracts, fixtures, source/cost boundaries and limitations. Prior main
was B2 merge `070c4cb`; B3 integration uses the pull request titled **Restore creative
studios and bounded narrative depth**. Fetch actual main and inspect its exact-head
five checks before continuing; do not assume an old local checkout is current.

Completed B0/B1/B2 behavior remains. B3 adds private recoverable story-local studios,
selected-field reference adoption and fact bindings, explicit creative/scene/length
settings, typed campaign declarations, AI field comparison/restore, conditional
Say/source assembly, truthful goal outcomes, fair opportunity categories, optional
episode closure/undo, improved Library/setup and all-stage narration preflight.
Existing stories retain legacy-short; new ones default to developed. Unknown model
capacity requires discovery or explicit Settings limits before affected purchases.

**Next authorized planning slice is B4 editorial organization.** Implement only
after the stakeholder asks to proceed. D1 optional prose editing, D2 old-version
conversion and D3 image conditioning remain gated; complete Gallery and listening
remain B5/B6. Preserve one immutable fiction graph, explicit active action targets,
private planning boundaries, spend accounting, frozen migration 24/save-v1 modules
and genuine schema-23/schema-24 preservation artifacts. Do not rewrite old migrations.

Keep source guides and this continuation checkpoint on main through normal PRs.
**Do not regenerate PDFs until the final recovery work package.** The PDF update
policy marks the six existing files as the verified B2 build, not current source
renderings. At final completion remove the deferral, regenerate and visually
inspect all six manuals, update their source/hash manifest and run strict checks.

Verification uses isolated fixtures and deterministic/mocked providers. No actual
Android tablet/IME/rotation, live literary-quality, paid provider or deployment
acceptance is claimed. No owner database, external checkout or server was touched.
After meaningful edits run lint/setup/brand/release/docs policy, backend/frontend,
desktop/mobile E2E; require all five exact-head CI checks before main merge and
remove only the integrated feature branch. See the delivery record and tests for
new source-closure and conservative capacity requirements.
