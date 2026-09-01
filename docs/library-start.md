# Library manuscript start

PR 10 makes Library the ordinary threshold for beginning or importing a
manuscript. The dark creation workspace is divided into three short stages:
**Beginning**, **World & cast**, and **Intent & review**. It remains the only
creation form: Library, the empty catalogue,
Home, and **New story** at the Desk all open this same sheet.
Volume I and Chapter I are created by the existing story service for every
successful path.

## Starting paths

- **Write the opening** stores the author's text directly as Page 1 and opens
  the Desk. It does not inspect providers or send text to an AI service.
- **Give the Scribe a seed** creates the manuscript locally and carries the
  premise, direction, and accepted Foundations into the Desk composer. The
  first paid generation still happens only when the author reviews and invokes
  the Desk action.
- **Import existing prose** accepts pasted text or a text file up to 1 MB and
  500,000 characters. Plain mode places it in Chapter I. Markdown mode treats
  ATX headings as chapter titles while preserving the remaining prose in order.

Closing the workspace stores its fields and current stage in session storage and never
creates a story. A successful start removes that draft. Cast choices freeze
story-local sheets. Untouched world fields remain live; later Codex edits can
pin individual world fields to the manuscript without changing the Library.

Cast shape is explicit. **Centered on a lead** assigns one `mc` role and allows
additional Supporting and Background members with starting relations.
**Ensemble** requires no lead and may begin empty. Switching a centered draft
to Ensemble keeps the former lead as Supporting rather than silently removing
them. The complete roster is visible together: each available character has a
direct role, relation, and Add action. Relations and in-progress choices
survive closing and reopening. Cover painting is deliberately after creation
in Gallery, where references, provider data, and price can be reviewed separately.

## Optional AI boundary

Foundations contain premise, narrative voice, point of view, tense, and
constraints. They are optional working direction, not a required schema or
wizard. Requesting suggestions first checks whether the Scribe role is
available. Only then may contextual, session-scoped provider setup appear.

After provider availability, the existing paid-action review discloses the
five fields sent and the estimate before `POST /api/ai/foundations`. The server
returns bounded strict JSON without creating or changing a story. Each proposed
field has its own Use action; ignored fields remain unchanged. The browser does
not persist the contextual API key.

The three path-specific, dismissible notes are the entire onboarding hint
budget. There is no blocking tour and no required world, cast, premise, or AI
configuration.

Vellum is reserved for prose and import previews; the creation workspace uses
the ink, violet, oxblood, and gold interface palette.
