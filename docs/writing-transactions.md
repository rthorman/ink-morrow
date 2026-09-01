# Transactional writing

Ink Morrow 4.0 treats every paid prose action as a durable operation around
the provider call. A provider reply is never canon by itself. It crosses the
canonical boundary only after its idempotency identity, story context, writer
lease, and complete result have all been checked again.

## Durable states

| State | Meaning |
|---|---|
| `requested` | The request and idempotency identity are durable |
| `running` | One provider call owns the operation |
| `succeeded` | Complete speculative prose and usage are durable |
| `committed` | One canonical transaction consumed the result |
| `failed` | Nothing was committed; known spend and the failure remain visible |
| `superseded` | The reply cannot commit because its context or ownership changed |

An idempotency key is scoped to one story. Reusing it with the same request
replays the stored result; reusing it for different input is rejected. A
process restart turns abandoned `requested` or `running` rows into honest
`failed` rows. It never guesses that an upstream request succeeded.

## Writer lease and context

Every story mutation acquires the story's short, expiring writer lease. The
same tab renews it while waiting on a provider. A second tab may read but gets
`WRITER_LEASE_CONFLICT` for a write until the lease is released or expires.
The response contains an expiry and a refresh/reconcile instruction.

Provider work snapshots a SHA-256 context identity over:

- story settings and cast;
- the active volume/chapter destination;
- tail canonical and displayed revision identities;
- bounded recent display revisions;
- latest story-local template snapshots;
- canonical revision and author-correction folded-state version; and
- generation settings, including direction and rewrite exclusions.

The lease and context are checked after the provider returns and inside the
same immediate transaction that would mutate canon. Late, reordered,
cancelled, or lease-lost replies retain attributable spend but cannot change
the manuscript.

## Prepared and directed paths

At most one complete prepared page exists per story. Its prose stays
server-side with an opaque identity, full context snapshot, provider result,
and spend. It has no page revision or continuity delta.

`Next Page` means exact promotion only: `POST .../commit-preview` must name the
currently prepared identity. Missing, replaced, or stale identities fail; the
route has no live-generation fallback. Promotion inserts that prose and its
usage exactly once.

Typing or clearing a direction does not consume the prepared page. Confirming
a non-empty direction does: it removes the prepared row before making one
Scribe request. Failure saves no page and the client keeps the author's
direction. Clearing it after failure begins a fresh ordinary preparation.
Partial streams are transient UI only and are never stored as complete prose.

Regeneration is also a durable operation. It asks the Scribe with the old tail
excluded, then atomically advances the tail's canonical/display revision only
if its original context and lease still hold.

## Commit aftermath and cost

A successful canonical transaction inserts prose and a pending revision-bound
continuity row before returning. Optional Archivist extraction and exactly one
successor preparation start in the background. The client observes that
server-owned successor with free reads; it never buys another successor after
a successful commit.

Cost state separates:

- all spent speculative preparation work, including stale work;
- the spend attached to the currently prepared page; and
- committed story prose and continuity totals.

Provider result JSON, usage, known cost, and billed attempt count are stored on
the operation. A promotion itself has zero additional Scribe spend; the
prepared provider cost becomes the committed page cost.

## Portable archives

Full working-history archives include redacted durable writing operations and
the prepared page. Writer-session and lease identities are never exported.
Import remaps entity and operation references, gives the prepared page a new
opaque identity, rebinds it to the imported story context, and converts an
in-flight archived operation to `RESTART_INTERRUPTED`. Earlier 4.0 beta
`story_previews` remain import-compatible.

Publication exports and archives made without working history contain neither
operation history nor prepared prose.
