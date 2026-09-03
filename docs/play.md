# Optional Play sessions

Play is an opt-in, scene-owned textual roleplay workspace. A manuscript can
ignore it completely. Opening Play never converts a scene, writes prose, or
calls an AI provider; the owner must first save a Session Zero contract.

## Session Zero contract

Every current cast member is assigned to **owner**, **Scribe**, or **shared**
control. This is a complete snapshot, including the cast role and displayed
name. At least one participant remains owner/shared when the cast is nonempty.
The contract also records:

- Scribe initiative, challenge, and pacing;
- consequence severity and a separate character-death permission;
- whether suggestions are off, on request, or proactive;
- whether player interiority is owner-only, sensory-only, or shared; and
- bounded free-form table notes.

The control boundary is absolute in the Scribe prompt. An owner turn may name
only an owner/shared participant. The Scribe may fully portray Scribe-owned
participants, may offer limited openings for shared participants, and must not
decide, speak, think, or complete actions for owner-controlled participants.

## Turns and cost

Owner input distinguishes **Act**, **Say**, **Ask**, and **Direct**. **Record
only** appends a local turn and makes no provider call. **Send to Scribe** uses
the shared paid review, makes one bounded logical request with at most two
billed attempts, and records the response, model, tokens, known/unknown cost,
and attempt count. Its idempotency key makes an exact retry replay-safe.

Only one reply may be in flight per session. Provider failure leaves the
owner's turn intact and records an explicit failed attempt; retry is possible
only while that turn remains the transcript tail. Server restart turns an
abandoned in-flight attempt into a visible failure rather than inventing a
reply. Ending a session makes its contract and turns read-only; a later
session may start on the same scene with a new contract.

The model receives bounded context: the contract, scene frame, current
world/cast continuity, selected remembered canon, recent manuscript excerpts,
the bound Scribe craft profile, and only the most recent transcript turns.
The prompt explicitly forbids invented dice results. Ask is out-of-character;
Act and Say are in-world; Direct changes facilitation or framing.

## Canon and deletion boundaries

Play turns are working history—not manuscript prose, publication content, or
remembered canon. There is no automatic promotion. Later Play-to-Prose work
must produce a separately reviewed prepared page through the ordinary writing
transaction.

A scene with Play history cannot be removed, nor can an apparently empty
chapter or volume that contains it. Deleting the entire manuscript remains
the explicit whole-project deletion boundary.

## Campaign recap and proposals

Play opens a bounded campaign recap above the transcript. It combines
owner-authored campaign records with selected page-extracted continuity and
orders them Main, supporting, then background. A centered manuscript keeps its
Main Character as the perspective anchor even when the most recent turn does
not name them. The complete editable ledger remains in **Codex → Campaign**.

**Suggest state with AI** is optional and paid. Its review discloses the model,
maximum attempts, estimate, and the exact categories sent. Returned items are
proposals only: each needs a separate **Add to campaign state** action. Every
accepted proposal keeps its source Play turn; the local server verifies that
the model's evidence quotation occurs exactly in that turn.

## Alternate paths and Play into Prose

Every session begins on a Main path. **Fork from here** creates a named child
path at an exact immutable turn; the shared ancestry is read through that turn
and neither it nor the abandoned successor is copied or changed. The Path
picker changes only which working-history path is shown and receives new
turns. Forking again from shared ancestry makes a sibling at that exact turn,
so later history from either path cannot leak into the new one.

On the current path, **Select as successor** marks the precise endpoint the
owner wants to keep. This is an explicit local review and still creates no
canon. **Shape selected path into prose** has a separate paid review and sends
up to the 60 most recent turns of the selected path through that endpoint,
plus the Session Zero contract, compact world and cast memory, relevant
remembered canon, recent manuscript prose, the bound Scribe profile, and
manuscript/scene framing. This bound avoids an unexpectedly large provider
request; remembered canon and recent prose carry earlier context.
The returned prose becomes the manuscript's one prepared page. It remains
server-side and noncanonical until the owner returns to the Desk and accepts
the ordinary **Use prepared page** review. The original paths stay intact.

If the selected path or endpoint changes while the provider is working, the
paid response is accounted but rejected as stale. A retry key replays the
same preparation rather than buying it twice.

## API

- `GET/POST /api/stories/:storyId/scenes/:sceneId/play-sessions`
- `GET/PUT /api/stories/:storyId/play-sessions/:sessionId`
- `POST /api/stories/:storyId/play-sessions/:sessionId/turns`
- `POST /api/stories/:storyId/play-sessions/:sessionId/replies`
- `POST /api/stories/:storyId/play-sessions/:sessionId/end`
- `POST /api/stories/:storyId/play-sessions/:sessionId/branches`
- `PUT /api/stories/:storyId/play-sessions/:sessionId/branch`
- `PUT /api/stories/:storyId/play-sessions/:sessionId/branches/:branchId/successor`
- `POST /api/stories/:storyId/play-sessions/:sessionId/prepare-prose`
- `GET /api/stories/:storyId/scenes/:sceneId/recap`
- `POST /api/stories/:storyId/scenes/:sceneId/campaign-suggestions`

Paid reply requests require `Idempotency-Key`. The frontend also includes its
generated key in the JSON body for review transparency; the header is the
authoritative transport value.

## Portability and privacy

When an `.inkmorrow` export includes **working history**, it preserves Session
Zero contracts, turns, and provider-attempt accounting while remapping scene,
session, turn, and character identities on copy import. An imported in-flight
attempt becomes `RESTART_INTERRUPTED`. Exports without working history contain
no Play transcript. Credentials, login state, and paid-consent state never
travel.
