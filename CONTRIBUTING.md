# Contributing to ScribeTribe

Thank you for helping improve the Scriptorium. ScribeTribe is a self-hosted,
single-owner writing tool, so a good contribution protects manuscripts,
preserves literal consequences, and keeps the author—not the machinery—in
control.

## Before opening an issue

- Read the [known beta limits](docs/releases/4.0.0/KNOWN-ISSUES.md).
- Reproduce browser problems in current Google Chrome when possible. Chrome is
  the only browser tested for 4.0.
- Reproduce provider problems with OpenRouter when possible. It is the only AI
  supplier tested; another nominally compatible endpoint is a separate,
  unsupported integration.
- Use a new, empty 4.0 `DATA_DIR`. Never test 4.0 against valuable 3.x data.

For a vulnerability, use a
[private security advisory](https://github.com/rthorman/scribe-tribe/security/advisories/new)
instead of a public issue. Never attach real manuscripts, provider keys,
passwords, cookies, share capabilities, private prompts, or unredacted logs.

## Local development

ScribeTribe requires Node.js 22.5 or newer. Install each package from its own
lockfile:

```bash
npm ci
cd backend && npm ci
cd ../frontend && npm ci
cd ../e2e && npm ci
```

Run the fast verification from the repository root:

```bash
npm test
```

For a user-visible or browser-sensitive change, also run:

```bash
npm run test:e2e
```

Tests use isolated data. Do not point automated work at a real library.

## Pull requests

Keep a pull request focused enough to explain and review. In its description:

1. lead with the user-visible outcome;
2. name the behavior or contract that changed;
3. list the exact verification performed;
4. include before/after screenshots for meaningful visual changes; and
5. update the README, guide, release notes, operations, privacy, or security
   documentation when the user-facing boundary changes.

AI-assisted contributions are welcome. The submitting human remains responsible
for understanding, testing, reviewing, licensing, and standing behind every
change. Do not include generated material that you do not have the right to
submit.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Code
is accepted under the repository's [AGPL-3.0-only license](LICENSE).
