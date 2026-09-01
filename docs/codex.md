# Codex

Codex is the manuscript workspace for inspecting story-local foundations,
page-provenanced remembered canon, and author-declared canon. It consumes the
continuity-v2 projection; it does not load or render the manuscript as a
hidden second reader.

## Three views

- **Foundations** shows the live world and frozen cast sheets. Untouched world
  fields continue following the reusable Library template. Direct edits and
  explicitly accepted Library changes pin only those fields to a new
  story-local snapshot. Library changes appear as field-level diffs. Import submits only checked fields and
  creates a new story-local snapshot; unchecked fields remain frozen.
- **Remembered canon** shows coverage, current entity state, goals, threads,
  world facts, arcs, and a bounded recent event history. Every derived fact
  exposes its canonical page and stored quotation. Legacy rows that predate
  direct quotes say so and still link to the owning page.
- **Author canon** lets the author create, revise, and retire world events,
  world facts, character facts, relationships, goals, threads, story rules,
  and custom facts. It also shows separate correction rows and deterministic
  later-impact warnings. It never presents either layer as a prose edit or
  mutates hidden extraction records.

Prepared next-page prose has no canonical revision and therefore never
appears in Codex coverage or facts.

The manuscript name can be changed from Codex or the Library card menu. A
rename changes no manuscript, page, revision, continuity, or publication
identity.

## Author canon and revision history

An author-canon entry has a stable identity and append-only revisions. Editing
adds a revision instead of overwriting prior wording. Retiring an entry stops
it from guiding future writing while preserving its history in the database
and portable archive. The active revision is included in the writing context
and explicitly outranks conflicting extracted memory. Any author-canon change
invalidates prepared prose because the next page's context has changed.

## Repair and cost

Repair selects only coverage rows that are missing or failed, displays one
explicit paid review, and processes those canonical revisions sequentially.
Every completed revision is saved immediately. The continuity service joins
an already-running extraction for the same revision, so resuming cannot buy a
second copy of one in-flight result. Failure leaves the page valid and
visible for another deliberate repair.

## Corrections and impact

**Apply** creates an author correction containing scope, subject, field,
value, optional reason, and optional visible evidence. The local projection
then gives it precedence without changing templates, prose, or Archivist
deltas. Later deterministic matches remain warnings until the author chooses:

- **Mark prose intentional** acknowledges that the later wording should stay;
- **Return story** opens the exact Desk page for editing or review;
- **Mark resolved** records that the author has completed disposition; or
- **Cancel** leaves a draft correction unapplied.

An optional AI warning summary has its own paid-consent review. It receives
only correction fields, warning reasons, matched terms, and page numbers—no
manuscript prose—and cannot apply a correction or change an issue status.
