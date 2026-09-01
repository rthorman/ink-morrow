# Library manuscript start

PR 10 makes Library the ordinary threshold for beginning or importing a
manuscript. The start sheet is deliberately small: name, one of three starting
paths, optional template copies, optional Foundations, and maturity level.
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

Closing or cancelling the sheet stores its fields in session storage and never
creates a story. A successful start removes that draft. World and cast choices
copy templates into the manuscript's existing snapshot boundary, so later
template edits do not rewrite story-local state.

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
