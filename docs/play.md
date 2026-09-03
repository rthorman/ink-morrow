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

## API

- `GET/POST /api/stories/:storyId/scenes/:sceneId/play-sessions`
- `GET/PUT /api/stories/:storyId/play-sessions/:sessionId`
- `POST /api/stories/:storyId/play-sessions/:sessionId/turns`
- `POST /api/stories/:storyId/play-sessions/:sessionId/replies`
- `POST /api/stories/:storyId/play-sessions/:sessionId/end`

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
