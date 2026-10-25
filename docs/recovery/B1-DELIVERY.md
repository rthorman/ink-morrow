# B1 — the current-fiction workspace

The stakeholder explicitly requested continuing with B1 after receiving the B0 prototype. This batch implements the production five-room workspace on the existing V5 engine. It does not claim an observed stakeholder prototype review, a deployment, actual Android qualification or completion of B2–B9.

## What changes for the owner

| Surface | Working B1 adapter |
|---|---|
| Library | Stories, new-story setup and playable-save import; world, character and Scribe catalogue access; existing full studio development/upload/paint flows |
| Desk | One scrolling passage on opaque paper, local page turns, per-device reading return, explicit latest-action destination, full-height contribution sheet and visible failure/progress feedback |
| Chronicle | Up to 80 loaded history records, distinct narrative/local entries, source inspection, explicit active-path selection, fork/rewind, earlier-window loading and episodes |
| Codex | Current public facts, frozen world/Scribe references, cast/control, current preferences/quality, recall/evidence, correction, retirement and challenges |
| Gallery | Current cover/reference images and placements from loaded history; working upload/paint/description/removal through the existing media dialogs |
| Gate | All existing book formats and private all-path save export, with different exposure explanations; provider spend and recent calls |
| Settings | Existing providers plus device type size/typeface/spacing/column/paper, sample/reset/return, password change and separate ordinary/quality approval resets |

Narrative lifetime and room-task lifetime are fenced independently: an old media result can update the same story without closing or reopening a newer dialog. Back before dispatch cancels the review without reviving its abandoned task.

No existing V5 workflow is intentionally removed. Original `#/story/:id` links still open Desk; room routes add `/desk`, `/chronicle`, `/codex`, `/gallery` or `/gate`. Same-story room changes reuse the loaded story and pending action instead of starting a second engine or purchasing generation.

## Reading and contribution contracts

The cursor, active path and graph head are separate. Reading earlier text does not silently direct Continue into the past: its label names the latest active-path target. New results announce themselves without stealing a reader's cursor or room. Read-only page turns, source/recall and room navigation remain usable during generation; changing the active path, facts or media remains guarded.

Bookmarks are bounded to 32 story/path records containing only IDs and a relative paragraph anchor/start marker. No prose, private lore or credentials go into bookmark storage. An older saved position is restored with existing ancestry-checked history/evidence GETs, validated against current revision/path; missing/foreign positions fall back visibly. An obsolete recovery cannot replace a newer explicit reading choice. Reflow restores a semantic anchor where available. Blocked browser storage is disclosed rather than promised as durable.

Steer, Ask, Act and Say use the existing contribution API. Ask is explicitly at the **current latest context** in B1. The full-height sheet uses the shared modal lifecycle; a paid review hides/inerts the lower sheet and cancellation restores its fields. Close/Escape/Back keep separate story/path/kind buffers in the open session. Reload and Lock clear contribution drafts; these are not B2 server-acknowledged drafts. A successful original request cannot clear a newer draft revision merely because its text is identical.

Lock immediately hides/clears room/task and password content before awaiting session revocation. A failed revocation stays an access error. Paid-approval resets affect future requests in the selected ordinary/quality family; they do not cancel already dispatched work or erase provider credentials.

## Source ownership

- `frontend/app/fiction/workspace-state.js`: normalized room/task routes, validated bounded bookmarks and reading preferences.
- `frontend/app/fiction/workspace-shell.js`: room adapters, shared contribution task, reading anchor/layout lifecycle and image/history collections.
- Existing `app.js`: application composition, current V5 commands, render/route fences and domain adapters.
- Shared `core/dialogs.js`: modal stack accessibility, cancellation resolution and consent-family reset; no second focus-trap implementation.
- `frontend/styles/fiction-workspace.css`: opaque reading surface, portrait bottom rooms, landscape rail and keyboard-height fallback.

No schema, save format, release number, backend fiction authority or legacy-route setting changes. Strict v1 `.inkmorrow5` saves remain supported. The only server launched for source review is an isolated in-memory test instance; the owner's data and port-3000 installation are untouched.

## Evidence and screenshots

Production fixture screenshots: [portrait Desk](evidence/B1-desk-portrait.png), [landscape Desk](evidence/B1-desk-landscape.png), [Chronicle](evidence/B1-chronicle-portrait.png), [Codex](evidence/B1-codex-portrait.png), [Gallery](evidence/B1-gallery-portrait.png), [Gate](evidence/B1-gate-portrait.png), [contribution task](evidence/B1-contribution-portrait.png), [Library](evidence/B1-library-landscape.png). They use an authenticated temporary in-memory installation, the curated opening and supplied artwork; they contain no owner data or live generated content.

Local verification includes the existing production journeys through new room destinations, read/return/reload, historical bookmark validation, pending-room/cursor races, paid-review Back/Escape, distinct/newer draft buffers, immediate Lock, shared modal accessibility and paid-approval resets. The desktop/mobile suites cover all existing image/book/save/cast/correction/preferences/episode operations. Axe checks cover every room, and viewport checks require the portrait room bar to reach the bottom of the viewport. These checks do not establish actual Android IME/platform Back, physical-touch ergonomics, screen-reader experience or live literary quality.

All six active manual sources were updated and PDFs/manifest regenerated together. The User Guide remains 35 tagged A4 pages. The renderer now uses a read-only ephemeral loopback documentation asset listener instead of file URLs, without starting the application or opening its database. Exact-head five-check CI is required before main integration; inspect this delivery's merge history for the integration and check evidence.

## Boundaries and next work

Codex is explicitly current-state-only, not historical inspection at the reading cursor. Chronicle is an honest loaded history window, and its path selector activates the path; it is not a separate read-only branch browser. Gallery is not yet a complete unplaced/older-asset inventory. Listening, immutable new publication jobs/sharing, deep story-local craft/campaign adaptation, scene grouping and optional solo tools remain later batches. No unsupported actions are presented as working implementations.

The next batch is **B2: trustworthy inspection**, including bounded server query projections, exact provenance and durable private draft recovery with strict save closure as specified by the guide. Optional manual copyediting, old-series conversion, image conditioning and release naming remain the four explicit policy decisions.

## Run on an existing Termux checkout

From the checkout root after updating main:

```bash
bash setup.sh
npm start
```

Open `http://localhost:3000`. B1 is the real authenticated application; `npm run prototype:recovery` still opens only the separate B0 example. There is no frontend build step. Stop an existing instance through its own terminal/helper before starting another on the same port; this source change does not operate that instance remotely.
