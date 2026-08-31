# ScribeTribe 4.0.0 UX architecture

Status: **accepted UX/UI contract**
Primary design profile: **portrait Android tablet in current Chrome Stable**

## Experience principle

ScribeTribe should feel like entering a living, decadent Scriptorium and then
sitting at an exceptionally competent contemporary writing desk.

The brand earns attention at thresholds, transitions, empty states, covers,
and art. The manuscript earns quiet. A reader becoming an author should never
have to decode internal state, hunt for the next action, or trade prose
legibility for atmosphere.

## Information architecture

### Global Library

The Library is the entry surface and owns:

- manuscripts;
- reusable world templates;
- reusable character templates;
- import and project restore;
- recent work and recovery notices; and
- the path to global Settings.

Selecting a manuscript enters its workspace. The story title in the workspace
header opens a manuscript switcher and provides a clear route back to the
Library.

### Story workspace

| Destination | Author's question | Primary content |
|---|---|---|
| **Desk** | What am I writing now? | Manuscript page, direction, page turn, read-aloud |
| **Chronicle** | Where am I in the work? | Volumes, chapters, pages, history, truncation recovery |
| **Codex** | What is true? | Local world/cast snapshots, continuity, arcs, corrections |
| **Gallery** | What images belong around it? | Uploaded/generated art and placements |
| **Gate** | How does this leave the Scriptorium? | Project backup, publication exports, read-only shares |

Settings is a utility, not a story destination. It lives in the global header
or utility menu.

## Adaptive navigation

The same five story destinations keep their names at every width:

- compact and portrait-tablet layouts use a labelled bottom navigation bar;
- landscape tablet and desktop use a labelled navigation rail;
- the manuscript switcher, lock action, and Settings remain outside the five
  story destinations; and
- a transient overlay must not replace navigation with an undiscoverable
  gesture.

This follows the contemporary adaptive pattern of a navigation bar on compact
layouts and a rail when horizontal space becomes available, informed by
[Material 3 adaptive layout guidance](https://m3.material.io/foundations/layout/overview).

No destination may depend on hover. Every primary target is comfortable for
touch, keyboard, mouse, and stylus.

## Beginning a manuscript

The start flow is deliberately short:

1. From Library, choose **Begin a manuscript** or **Import**.
2. On one sheet, choose one starting path:
   - **Write the opening** — title optional; enter or paste the active first
     page;
   - **Give the Scribe a seed** — premise and optional direction; or
   - **Import existing prose** — map headings or start as one chapter.
3. Confirm the manuscript name and AI role choices only when relevant.
4. Enter the Desk with Volume I and Chapter I already created.

Provider setup appears only when the author first invokes an AI action. Manual
writing, importing, organizing, copyediting, art upload, and local export do
not require a provider.

An optional **Foundations** drawer supports premise, narrative voice, point of
view, tense, cast, world, arcs, and constraints. AI suggestions are drafts and
must be accepted field by field. Foundations is not a blocking wizard.

At most three dismissible contextual hints appear across the first session:

1. the direction changes what the Scribe prepares;
2. older canon can be copyedited or made active by returning the story to that
   page; and
3. the Codex explains what the story currently remembers.

There is no product tour.

## The Desk

### Layout

The manuscript is the visual center. On portrait tablet:

- a compact story header sits above;
- the page occupies the calm central reading column;
- chapter/page context is present but secondary;
- the direction composer and primary action remain reachable near the lower
  edge without covering prose;
- secondary tools collapse into a clearly labelled sheet; and
- bottom navigation stays stable.

The active page supports inline prose editing. Autosave is quiet; a small
status near the page title moves among **Saved**, **Saving**, and **Offline —
kept locally** only when the distinction matters. Routine successful saves do
not produce toasts.

### Prepared-page action

The primary action is literal and stateful:

| State | Button | Supporting status |
|---|---|---|
| Preparing with empty direction | **Preparing next page…** disabled | The Scribe is at work; no competing request can start |
| Prepared, direction empty | **Next Page** green | “A page waits beyond the turn.” |
| Any non-whitespace direction | **Generate as directed** | “This replaces the waiting page when pressed.” |
| Direction cleared | **Next Page** green | The same prepared page is still waiting |
| Directed request running | **Generating…** disabled with Cancel when safe | Direction remains visible |
| Directed request failed | **Try again** | No page was added; clearing starts a fresh ordinary preparation |

The interface never implies that **Next Page** can produce different text from
the waiting page. Direction changes the button immediately but does not destroy
the prepared page until the directed action is deliberately pressed.

Keyboard submission is supported, but the shortcut is displayed next to the
action and never becomes the only path.

### Page turning and history

Authors can read all canonical pages without entering edit mode. Older pages
show:

- **Copyedit this page** — changes visible/exported prose without changing
  recorded state; and
- **Return story to this page** — a destructive, recoverable canon action.

The copyedit sheet carries one quiet notice:

> Copyedits do not recalculate the Codex. Future pages may still notice the
> revised wording.

It is shown at first use and remains available from an information icon. It is
not repeated after every edit.

Returning the story to an older page names the exact removed volume/chapter/page
range, number of narrative pages, consequence for prepared work, and 30-day
recovery. The confirmation action reads **Return and remove N later pages**,
not a vague branded verb. The resulting undo is prominent but temporary;
longer recovery lives in Chronicle.

## Chronicle

Chronicle presents the hierarchy as a navigable outline:

- volume rows contain chapter rows;
- chapter rows contain page titles/numbers and concise excerpts;
- scene-break markers are visible inside page previews but are not entities;
- current tail, prepared next page, memory coverage, art placements, and
  recovery records have distinct status markers; and
- reorder controls are not offered where they would violate canonical history.

Creating, naming, and closing volumes or chapters is direct. New structure
begins at the current tail. Historical structure may be renamed without
changing narrative state; moving canonical prose across the chain is deferred
unless its continuity semantics are explicitly designed.

Recovery records show removal time, range, expiry, and whether one-click
restore remains safe. Unsafe restore offers export, not silent merging.

## Codex

Codex separates three concepts visually:

1. **Foundations** — author intent and story-local world/cast snapshots;
2. **Remembered canon** — page-provenanced facts, events, conditions, goals,
   threads, and arc movement; and
3. **Author corrections** — authoritative overrides and their impact state.

A correction flow is:

1. select a fact or entity field;
2. see current authoritative value and page evidence;
3. propose the corrected value;
4. review detected later conflicts;
5. choose **Apply correction**, **Mark prose intentional**, **Return story to
   an earlier page**, or **Cancel**; and
6. receive a persistent, inspectable correction record.

AI may help summarize impacts but never applies them. Existing prose is never
automatically rewritten.

Template updates appear as a field-level diff between the Library template and
the local story snapshot. Nothing changes until fields are accepted.

## Gallery

Gallery has two equal primary actions:

- **Paint with AI**
- **Upload an image**

Upload uses the native file picker, then shows a local preview, optional title,
optional alt text, metadata-removal notice, and placement choice:

- keep in Gallery;
- place before the first page; or
- place after a selected narrative page.

The author can move or unplace art without changing page numbers, continuity,
or prose. Technical upload errors describe the actual constraint—unsupported
encoding, damaged file, file too large, or image dimensions too large—without
commenting on subject matter.

AI painting keeps the current announce-and-wait refusal flow:

1. condense or author a visible prompt;
2. choose references and quality;
3. generate deliberately;
4. if Grok refuses, explain the provider refusal and show the sanitized editable
   prompt;
5. wait for another press; and
6. on success, place or keep the result exactly like uploaded art.

An uploaded image is not selected as an AI reference by default.

## Gate

Gate divides leaving-the-app actions into:

- **Back up the project** — full-fidelity .scribetribe archive;
- **Prepare for publication** — format, metadata, front/back matter, art and
  style choices; and
- **Share a reading copy** — immutable, revocable snapshot.

The publication flow previews one normalized book structure before format
selection. Choosing several formats produces a single export job so metadata
and structure remain identical.

Share creation shows included manuscript revision, selected art, expiry,
revocation, and the rule that anyone with the link can read that frozen copy.
The link is shown once with copy/download controls and can be revoked later.

## Language system

Brand voice is strongest in orientation and weakest in irreversible actions.

| Context | Voice rule | Example |
|---|---|---|
| Threshold/empty state | Atmospheric and inviting | “The desks wait. Begin a manuscript.” |
| Section heading | Branded noun plus plain explanation | “Codex — what the story remembers” |
| Primary action | Plain, specific verb | “Generate as directed” |
| Status | Brief, truthful, lightly branded | “A page waits beyond the turn.” |
| Destructive action | Exact object and consequence | “Return and remove 14 later pages” |
| Error | Cause, retained work, next action | “The provider refused this image. Your prompt and original upload are unchanged.” |
| Legal/security | Plain language only | “Anyone with this link can read the snapshot.” |

Avoid faux-archaic grammar, unexplained lore terms, coy euphemisms for money or
deletion, gendered assumptions about the author, and moral commentary on story
content.

## Visual system

- **Display:** Cormorant Garamond for branded headings and thresholds.
- **Interface:** Inter or Source Sans for controls, metadata, and dense state.
- **Manuscript:** Literata for long-form reading and editing.
- **Technical:** IBM Plex Mono for IDs, models, diagnostics, and export details.

The palette uses black-plum and ink surfaces, wine and oxblood accents, antique
gold highlights, moonlit blue-violet, and restrained vellum manuscript
surfaces. Final token values must pass contrast testing in their actual text
sizes and states.

Ornament belongs in frames, separators, shallow texture, art, and transition
surfaces. Never place detailed artwork or texture directly behind running
manuscript text. Motion is slow and sparse: fades, lamplight, ink settling, and
page transition cues. Respect reduced-motion settings.

The accepted visual reference and usage rules are in
[ART-DIRECTION.md](ART-DIRECTION.md).

## Accessibility and input

4.0.0 targets WCAG 2.2 AA for the supported Chrome profiles:

- complete keyboard operation and logical focus order;
- visible focus with sufficient contrast;
- semantic landmarks, headings, labels, and live-region discipline;
- no color-only state;
- text reflow and zoom without lost actions;
- 44 CSS-pixel primary touch targets where practical, never below WCAG 2.2
  minimum target rules without an accepted exception;
- labelled icon buttons and no gesture-only commands;
- reduced motion and readable high-contrast manuscript themes;
- persistent user typography size and line-length preferences; and
- alt-text workflow for placed publication art.

Reference: [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/).

## Responsive acceptance profiles

| Profile | Critical expectation |
|---|---|
| 768 × 1024 portrait tablet | Entire authoring loop reachable; stable bottom nav; composer does not cover prose |
| 1024 × 768 landscape tablet | Rail or spacious adaptive layout; no stretched manuscript line |
| 1280 × 800 desktop/laptop | Rail, centered manuscript, supporting context without clutter |
| 1440 × 900 desktop | Same information hierarchy; no low-density decorative sprawl |
| 390 × 844 phone, best effort | Core read/write/page-turn path works; secondary depth may use sheets |

Viewport tests also run at 200% text zoom and with the on-screen keyboard
reducing available height.

## UX vetoes

Do not merge a screen that:

- makes the author choose every story setting before writing;
- hides the active canonical page or exact pending action;
- uses a branded label where a destructive or paid consequence is ambiguous;
- shows repeated success toasts for autosave;
- turns history browsing into accidental edit mode;
- treats art as a numbered narrative page;
- forces provider setup for manual work;
- exposes internal IDs or continuity JSON as ordinary UX;
- requires hover or a precision gesture; or
- lets ornament reduce manuscript legibility.
