# Ink Morrow 4.0 user guide

The published guide is [Ink-Morrow-4.0-User-Guide.pdf](Ink-Morrow-4.0-User-Guide.pdf).
Its print source is [index.html](index.html), which uses the approved production
brand assets and checked-in interface screenshots. The PDF is intentionally
committed so readers do not need a document toolchain.

## Rendering

The renderer requires Node.js, Playwright, and Chromium or Chrome. After the
repository's e2e dependencies are installed, run from the repository root:

```bash
node docs/user-guide/render.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may point to a system browser when the
Playwright-managed Chromium executable is not installed. The renderer also
recognizes the standard Chrome and Edge paths on Windows.

After rendering, verify the PDF is 20 A4 pages, inspect every page visually, and
confirm all canonical-reference links use the public repository URLs.
