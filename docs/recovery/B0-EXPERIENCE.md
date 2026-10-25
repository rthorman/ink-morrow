# B0 — the recovered Scriptorium experience

**Status:** implemented synthetic prototype; stakeholder review and real Android device qualification are pending. This is not the B1 production shell or a completed recovery release.

## Review the experience

- [Self-contained interactive preview](evidence/B0-PREVIEW.html): download and open in a browser that permits local HTML. It embeds scripts, fictional fixtures, brand art, fonts and font licenses; it needs no model, account or network connection. Browser/app download restrictions may require the local preview server below.
- Screenshots: [Desk](evidence/B0-desk-portrait.png), [Library](evidence/B0-library-portrait.png), [Chronicle](evidence/B0-chronicle-portrait.png), [Codex](evidence/B0-codex-portrait.png), [Gallery](evidence/B0-gallery-portrait.png), [Gate](evidence/B0-gate-portrait.png).
- [Capability ledger](CAPABILITY-LEDGER.md): 38 explicit dispositions, including every V4.1 campaign kind, all six deferred solo tools and the four policy gates.

For development, run `npm run prototype:recovery`, then open the loopback address it prints. `/preview.html` serves the self-contained artifact. The server exposes only synthetic prototype content and public artwork/type assets; it has no API or database access and never starts the production application. Run `npm run build:prototype` after changing the source, then `npm run test:prototype` for the isolated browser suite. E2E dependencies must be installed under `e2e/`; the standalone config uses installed system Chromium when present, otherwise Playwright's browser.

The editable source is in `prototypes/recovery/`. Production HTML, fiction modules, auth routes, migrations, manuals and data remain outside this prototype. The existing canonical brand artwork is used for reference composition; gallery pictures are explicitly labelled placeholders rather than newly generated story illustrations.

## What can be inspected

The Library has a bounded illustrated threshold, saved-work cards and world, character, Scribe and Bookshelf collections. The Desk puts readable Literata prose first on opaque vellum, with stable passage scrolling, explicit historical versus active scope, and labelled room navigation. Portrait uses a bottom bar; landscape uses a rail. All five rooms have populated examples.

Chronicle shows path ancestry, reading position and path head separately. Browsing another path does not activate it. A local example fork retains the original future and excludes later evidence. Codex separates public evidence and private planning; exact quotations lead to their source. The studio provides full-height identity/depth fields and a fixed sample candidate comparison without buying generation or changing an existing story.

The paid review shows purpose, destination, data exposure, illustrative call ceiling and estimate. Actual dispatches are zero. Simulated pending work allows reading and room navigation. Failure preserves prose and draft; an unknown outcome blocks another Continue until the original example is resolved. This demonstrates the intended authority distinction, not a real durable operation implementation.

Gate distinguishes selected-path reader-safe books from private all-path saves. Book options mirror the existing nine formats, including JSON. Editions, sharing, listening, upload and setup show truthful readiness/preview states; they do not claim to render files, store native uploads, synthesize speech or create production stories.

## Review tasks

1. Open a saved story, read an earlier passage, visit Chronicle/Codex/Gallery/Gate, and return to the same passage and scroll position.
2. Enter a direction, open its paid review, cancel, use Back/Escape, reload and recover the example direction. It is labelled as a tab-local demo draft, never a server acknowledgement.
3. Fork from passage 2. Inspect Codex and verify passage 3's repaired clock is absent. Return to the original path and verify that future still exists.
4. In Library → Characters, edit visible description, compare the sample development, cancel, reopen and verify fields remain. Existing story prose must not change.
5. Review a simulated failure and unknown outcome beside Continue; keep reading while pending. No action is a real provider call.
6. Try enlarged reading text, portrait/landscape, touch navigation and a short viewport with a task open. On the actual Android tablet, additionally exercise IME open/close, platform Back, rotation, font enlargement and focus restoration.
7. Inspect a book and a private save preview. Explain their different path/private-content boundaries in your own words.

## Verification and limits

Local automated browser verification covers portrait tablet (800×1280), landscape tablet (1280×800) and a phone profile using system Chromium. It includes navigation/bookmarks, draft cancellation/Back/reload, historical forks, evidence visibility, candidate restoration, pending/failure/unknown states, enlarged text/short viewport, demo Lock, self-contained asset loading, axe WCAG smoke checks, and server exposure boundaries. A short viewport is not real Android IME evidence; automated accessibility checks are not a screen-reader study.

Prototype data and edits are synthetic. Passage identity/preferences use prototype-namespaced local storage; the example direction uses session storage with an explicit failure label. Studio changes and forks are in-memory examples and may disappear on reload. Production server drafts, operation receipts, migrations, complete media queries, book/audio jobs and save-version extensions remain B1–B7 work. Optional prose editing, old-series conversion, image conditioning and a new release number remain unapproved policy gates.

The prior main CI run failed its production dependency audit before B0, skipping E2E. Compatible security patches are included as a verification prerequisite: body-parser 1.20.9, proxy-addr 2.0.8, follow-redirects 1.16.1, sharp/sharp-wasm 0.35.5 and matching platform/libvips packages; they do not take the pending Express/Jest/ESLint major upgrades. Review the actual patch/test evidence and exact-head CI before merge. No live database, replacement server, owner installation, paid call or deployment is part of B0.

## Gate to the next batch

The continuation plan requires stakeholder feedback on this populated experience before broad runtime cutover. B0's engineering artifact can be complete while its acceptance remains pending. B1 must keep every existing V5 task reachable through working adapters in all five rooms; this prototype is not a replacement for those adapters.

## Local check record

- Backend: all 44 suites / 479 tests pass with the compatible security patches.
- Frontend: all 33 suites / 313 tests pass.
- Production audit: zero vulnerabilities at the time of this check; Express remains 4.22.2.
- Lint, setup safety, canonical brand/release identities, strict six-PDF freshness and local links pass.
- Isolated prototype suite: eleven behavioral tests across three viewport profiles; inspect its recorded run and exact-head CI for the final result. All screenshots use fictional fixtures and the system Chromium browser, not the stakeholder’s device.

