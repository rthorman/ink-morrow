# Ink Morrow 4.0 PDF documentation library

The published PDFs are committed in [`docs/pdf/`](../pdf/) so readers do not
need a documentation toolchain. Their version-controlled sources live in
[`sources/`](sources/). The shared renderer and theme deliberately adapt the
User Guide's approved plum, wine, gold, vellum, gothic type, ornaments, and
Scriptorium art for denser technical writing.

| Book | Primary reader |
|---|---|
| User Guide | Authors using Ink Morrow |
| Operations & Recovery Handbook | Owner-operator |
| System Architecture & Design Rationale | Maintainer and technical reviewer |
| State Machine & Invariant Atlas | Implementer, tester, incident investigator |
| Security, Privacy & AI Boundary | Author, operator, security reviewer |
| Maintainer, Testing & Release Handbook | Contributor and release owner |

## Rendering

Install the repository's E2E dependencies, then run from the repository root:

```bash
npm run docs:pdf
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a system Chrome/Chromium. The
renderer also recognizes the standard Chrome and Edge locations on Windows.
It loads bundled fonts and local brand assets, rejects broken images, and emits
tagged PDFs with document outlines.

The optional repository-local QA tool requires Poppler plus the pinned Python
packages in `requirements.txt`:

```bash
python -m pip install -r docs/pdf-library/requirements.txt
python docs/pdf-library/qa.py --output output/pdf-qa
```

The QA tool checks text extraction, outlines, old-brand residue, and page
counts, then rasterizes every page and builds overview contact sheets.

Every complete render also rewrites `generated.json` with one combined source
fingerprint and exact hashes for all six PDFs. CI runs `npm run check:docs` and
annotates a change to any book source, screenshot, brand asset, font, renderer,
or theme when the PDFs have not been regenerated. It is intentionally a
warning, not a merge gate. Documentation and release work can run
`npm run check:docs:strict` when staleness must fail the command. Neither mode
substitutes for the visual inspection above.

## Publication QA

After every source or theme change:

1. Render all six books from a clean checkout.
2. Confirm every expected PDF opens and has a nonempty outline/bookmark tree.
3. Render every PDF page to PNG.
4. Visually inspect covers, headings, tables, code, callouts, diagrams, links,
   page breaks, headers, footers, and final pages at readable scale.
5. Search extracted text for missing sections, replacement characters, and old
   product naming.
6. Keep the PDFs and sources in the same pull request.

The User Guide keeps its art-directed fixed-page HTML source in
[`sources/user-guide.html`](sources/user-guide.html), while the five denser
technical books use Markdown sources plus the shared theme. All six books are
declared in [`books.mjs`](books.mjs), rendered through the same
[`render.mjs`](render.mjs) entry point, published together in
[`docs/pdf/`](../pdf/), and covered by the same freshness manifest and QA pass.

## User Guide scope

The existing published User Guide is the baseline for tone, visual direction,
task coverage, safety language, and information architecture. Its historical
page count is **not** a target or maximum. The guide may become substantially
larger whenever the current feature set needs more room for readable examples,
screens, explanations, or complete workflows.

Every release-level User Guide must include end-to-end example journeys that:

1. use no optional AI or provider-backed features;
2. use the complete applicable feature set together; and
3. use logical subsets for recognizable goals, such as AI-assisted drafting,
   continuity-led revision, or illustration and publication of existing prose.

Each journey states its goal, prerequisites, enabled features, deliberately
unused features, ordered actions, provider/cost boundary, and final preservation
or delivery step. Do not shorten or remove those journeys to match an older PDF.

The current 4.1 User Guide is accepted at **exactly 35 A4 pages**. Treat that as
this edition's render acceptance criterion, not as a ceiling for future releases.
