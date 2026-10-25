# Contributing to InkMorrow

InkMorrow 5.0 is playable fiction for one owner. Protect causal history, explicit
character control, private data and honest paid authority. Manual prose authoring
and 4.x data migration are deliberately outside this product.

## Before changing behaviour

Read AGENTS.md, the [5.0 release record](docs/releases/5.0.0/README.md) and
[known limits](docs/releases/5.0.0/KNOWN-ISSUES.md). Reproduce with isolated fixture
data, never the owner's real database or provider key. Model fixtures are not
live quality certification.

Use the [private advisory form](https://github.com/rthorman/ink-morrow/security/advisories/new)
for vulnerabilities. Do not attach private saves, credentials, cookies,
unredacted logs or real story material to public issues.

## Local development

The active project is consolidated under WSL. Windows tooling can use that same
tree; do not create another source copy. Node 22.5+ with node:sqlite is required.

```bash
bash setup.sh --dev
npm test
npm run check:brand
npm run check:release
```

Existing dependencies are updated in place. Only explicit
`bash setup.sh --dev --clean` replaces the printed dependency directories.
Do not use broad destructive cleanup or restore abandoned branches.

For browser-sensitive changes, run `npm run test:e2e` in an existing
browser-capable environment. Desktop and Mobile Chrome run separately on
isolated port 3100 data. Never point tests at port 3000 or download a browser
merely to satisfy local testing when CI can provide it.

## Pull requests and documentation

Use substantial, coherent feature batches targeting release/5.0.0.
Explain the user outcome, changed contract, verification and limits.
Cover failures, concurrency, cancelled review, late navigation and known/unknown
costs, not only the happy path. Screenshots should use fixture stories.

All five CI gates must pass on the exact current head before merge.
Final integration to main follows complete approved implementation and its own
green PR. Deployment or starting the old port is a separate owner decision.

Update every affected manual source and regenerate all six PDFs plus the
freshness manifest. Run strict freshness and inspect rendered pages.
The [documentation workflow](docs/pdf-library/README.md) and
[Maintainer handbook](docs/pdf/Ink-Morrow-5.0-Maintainer-Testing-and-Release-Handbook.pdf)
define the complete checks.

Use the canonical frontend/brand/ink-morrow-lockup.svg wherever a product logo
is needed, including app/auth and PDF covers/headers. Do not re-typeset it.

AI-assisted contributions are welcome; the submitting human remains responsible
for understanding, testing, reviewing and having rights to the contribution.
Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Project code is accepted under
[AGPL-3.0-only](LICENSE), preserving separately licensed third-party materials.

## Current-fiction recovery work

B1 composes the existing V5 engine through five room adapters. Read
[the delivery record](docs/recovery/B1-DELIVERY.md) and
[continuation state](docs/recovery/CONTINUATION.md) before changing their scope.
Same-story room navigation keeps narrative authority alive; independent room
fences prevent an old media/dialog result from replacing a newer task. Preserve
legacy story-link aliases and truthful scope/loaded-window labels. B2 separates
inspection from actions and adds server-acknowledged private drafts; read
[its delivery record](docs/recovery/B2-DELIVERY.md), preserve frozen save-v1
validators, append migrations and test projection/privacy/save closure; do not enable
legacy authoring routes to supply those capabilities.


Recovery B3 uses appended schema 25, immutable story-local creative revisions and
strict creative collections inside save v2. Read [B3 delivery](docs/recovery/B3-DELIVERY.md)
before changing context compilation, Say assembly, local draft receipts or source
closure. Keep migration 24 and save-v1 dependencies frozen. Model capacity must be
known before a narration purchase; isolated tests explicitly declare synthetic
limits. Keep all five checks green on the exact PR head before main merge.
The stakeholder deferred PDF regeneration until the last recovery package; update
all affected source manuals now and retain the existing PDF integrity check.
