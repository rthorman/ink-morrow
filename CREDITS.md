# Credits and Contributors

## Ink Morrow 4.0.0-beta provenance

Ink Morrow 4.0.0-beta is a clean-break refactor of the earlier application.
The refactor was produced exclusively through **ChatGPT/Codex**, under
human-led feature planning, direction, review, and acceptance. This includes:

- product and technical implementation;
- automated tests and release verification work;
- the 4.0 visual identity and generated production assets; and
- release documentation and the illustrated user guide.

The project owner made the product decisions, supplied the creative direction,
reviewed behavior and visuals, and accepted or rejected the resulting work.
ChatGPT/Codex performed the implementation and generation work inside that
human-directed process. This statement applies to the 4.0 beta refactor, not
retroactively to the preserved historical line.

## Historical creator's note (through 3.2.2)

Ink Morrow was built start-to-finish on a very budget Android tablet running
Termux — no keyboard, no accessories, just the standard on-screen one, to show
it's doable. Tool suites were installed on-device; code was written there and
tests were run there. It was finished in a single afternoon while my wife was
out having lunch with her friends.

Ink Morrow is not an erotic-writing tool — it's a story engine biased toward
fantasy. Mature content is an opt-in tone per story, not the tool's purpose.

## Historical development environment

Created, built, and tested entirely on an **Android tablet running Termux** —
including the full Jest test suite and live story generation against a real
OpenRouter key. Part of the [opencode-termux-native](https://github.com/Thr45hx/opencode-termux-native)
project: running AI coding CLIs natively on Termux (no proot, no root).

## Historical development credits

Ink Morrow was written in partnership with **[OpenCode](https://opencode.ai)** —
an open-source AI coding agent — running **natively on Termux** (via the
[opencode-termux-native](https://github.com/Thr45hx/opencode-termux-native)
launcher — no proot, no root), powered by **GLM-5.3** by **Z.ai**, served
through OpenRouter.

Nearly everything in the historical through-3.2.2 line was written, reviewed,
and fixed by that pairing,
on-device, on the same budget tablet: the Express backend, the `node:sqlite`
schema, the gothic frontend and its catgirl scribe, the full Jest and
Playwright suites, the CI workflow — and the bug hunts that caught real
crashers (including a fresh-clone one) before they ever shipped.

The human's contributions: the vision, the direction, the taste — and lunch.

## 4.0 branding and documentation credits

Ink Morrow 4.0's branding concept, art direction, design system,
implementation brief, production integration, and user-facing documentation
were developed through **[OpenAI ChatGPT/Codex](https://openai.com/codex/)**
under the project author's direction, August-September 2026. Visual assets
were created using OpenAI image-generation tools and individually reviewed by
the project owner before acceptance.

Generated brand assets (OpenAI image generation, reference-led; production
WebP in `frontend/brand/`, PNG masters in the instruction packages):

- `hero-scriptorium-desktop.webp`, `hero-scriptorium-tablet-landscape.webp`,
  and `hero-scriptorium-tablet-portrait.webp` — separately composed Vesper
  Library heroes for the three first-class responsive profiles
- `vesper-quill.webp` — Vesper's phone and empty-state foreground figure; the
  approved source was converted from a generated light checker field to true
  alpha before production encoding
- `vesper-threshold.webp` — Vesper Quill at the locked threshold
  (first-password and unlock surface)
- `moth-archive.webp` — Moth, Archivist of Forgotten Things (Bookshelf and
  archive empty states)
- `cinder-cast.webp` — Cinder, the Inkbreaker (story-creation cast-shape
  introduction)

The accepted 4.0.0 planning package also includes
`docs/releases/4.0.0/assets/art-direction-reference.png`, an OpenAI-generated
portrait-tablet atmosphere reference selected by the project author. It is a
planning reference rather than a production UI screenshot; its approved use
and boundaries are documented in
`docs/releases/4.0.0/ART-DIRECTION.md`.

Interface typography uses self-hosted Latin/Latin Extended subsets of
Cormorant Garamond, Inter, Literata, and IBM Plex Mono from Google Fonts. The
approved blackletter wordmark uses self-hosted UnifrakturCook. Each family is
distributed under the SIL Open Font License 1.1; the applicable license texts
are included in `frontend/fonts/`.

## Original Code Structure

- **Backend**: Node.js + Express + SQLite (built-in `node:sqlite`, no native builds)
- **Frontend**: Vanilla JavaScript with Gothic CSS
- **API Integration**: OpenRouter for AI content generation

## Inspirations

- Interactive fiction writing tools
- Gothic literature aesthetics
- RPG character/world management systems

## License

The Ink Morrow 4.0 release line is open-source software under
`AGPL-3.0-only`; see [LICENSE](LICENSE) and
[LICENSE-NOTICE.md](LICENSE-NOTICE.md). The historical `main` line through
version 3.2.2 remains under the MIT License. Bundled fonts and other
third-party materials retain their separately identified licenses.
