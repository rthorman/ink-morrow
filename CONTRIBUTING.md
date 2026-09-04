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
