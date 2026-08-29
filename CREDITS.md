# Credits and Contributors

## Creator's Note

ScribeTribe was built start-to-finish on a very budget Android tablet running
Termux — no keyboard, no accessories, just the standard on-screen one, to show
it's doable. Tool suites were installed on-device; code was written there and
tests were run there. It was finished in a single afternoon while my wife was
out having lunch with her friends.

ScribeTribe is not an erotic-writing tool — it's a story engine biased toward
fantasy. Mature content is an opt-in tone per story, not the tool's purpose.

## Development Environment

Created, built, and tested entirely on an **Android tablet running Termux** —
including the full Jest test suite and live story generation against a real
OpenRouter key. Part of the [opencode-termux-native](https://github.com/Thr45hx/opencode-termux-native)
project: running AI coding CLIs natively on Termux (no proot, no root).

## Development Credits

ScribeTribe was written in partnership with **[OpenCode](https://opencode.ai)** —
an open-source AI coding agent — running **natively on Termux** (via the
[opencode-termux-native](https://github.com/Thr45hx/opencode-termux-native)
launcher — no proot, no root), powered by **GLM-5.3** by **Z.ai**, served
through OpenRouter.

Nearly everything here was written, reviewed, and fixed by that pairing,
on-device, on the same budget tablet: the Express backend, the `node:sqlite`
schema, the gothic frontend and its catgirl scribe, all 60 Jest tests, the
Playwright suite, the CI workflow — and the bug hunts that caught real
crashers (including a fresh-clone one) before they ever shipped.

The human's contributions: the vision, the direction, the taste — and lunch.

## Branding Credits

ScribeTribe's branding concept, art direction, design system, implementation
brief, and visual assets were developed collaboratively with **[OpenAI Codex
in ChatGPT](https://openai.com/codex/)** (GPT‑5‑based), under the project
author's direction, August 2026. Visual assets were created using OpenAI
image-generation tools.

## Original Code Structure

- **Backend**: Node.js + Express + SQLite (built-in `node:sqlite`, no native builds)
- **Frontend**: Vanilla JavaScript with Gothic CSS
- **API Integration**: OpenRouter for AI content generation

## Inspirations

- Interactive fiction writing tools
- Gothic literature aesthetics
- RPG character/world management systems

## License

This project is open source under the MIT License. Feel free to modify, distribute, and contribute to it.