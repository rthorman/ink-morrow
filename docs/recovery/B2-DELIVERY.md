# B2 — trustworthy inspection and private recovery

B2 continues the real five-room application on V5.0.0. It does not activate the
legacy runtime, change the public release number, deploy the application or make
live provider calls. Code integration follows the existing five-green-check policy.

## Delivered behavior

Chronicle has a read-only **Browse path** control, separate from the explicit
active-path mutation. Its server timeline defaults to 40 records, caps at 80 and
filters private-only records before paging. Narrative passage ordinals exclude
Ask answers and local operations. Context-bound cursors reject another path,
inspection moment, section or search. Browser links preserve the inspection context.

**Inspect state here** opens categorized, searchable Codex records at that moment.
Selected ancestry excludes future and sibling facts. Current owner controls are
hidden during historical inspection; the action target remains the named active
path at its latest moment. The inspected Desk retrieves one narrative passage with
neighbors and an explicit current/**As it was** presentation boundary. Ordinary
active-path reading keeps the B1 paragraph return and preferences. Inspection links
preserve identities and boundaries; they do not promise a second paragraph bookmark
system for alternate-path previews.

Public evidence displays new exact quotations from immutable accepted prose, with
a SHA-256 hash of the original full source field. Submitted-input and owner-declared
sources remain private, separately labelled and reachable through **Open private
owner sources**. Public owner assertions never masquerade as narrated proof. Old
records remain passage-level; migration invents neither quotations nor hashes.
Private owner planning includes motives, hidden facts, private configuration and
explicitly requested source material. Leaving the room or Lock removes its DOM.

Setup, catalogue and contribution drafts live in authenticated SQLite storage,
with typed scope, a 240 KiB body cap, optimistic revisions, acknowledgement and
30-day inactivity expiry. Contributions bind story, path, head and kind. Conflict
comparison preserves both versions; Save now, Copy and Discard are explicit.
Offline text stays in memory with copy recovery. A catalogue recovery list also
retains access to draft fields after the referenced entry disappears. Recovering
those fields creates a new reference only after an explicit choice.

A prepared contribution or catalogue-development identity is acknowledged before
its paid dispatch. A lost response opens journal inspection, never automatic retry.
An absent journal record remains unknown until a transactional cancellation fence
prevents a delayed undispatched original from starting. A pending dispatched request
is never claimed cancelled. Newer edits survive an older acknowledgement/result;
a draft at an obsolete moment requires an explicit latest-target choice.

Setup and new-catalogue creation consume the acknowledged draft in the same local
transaction as the resource and receipt. Exact retries recover the original result. Unacknowledged creation receipts also appear in scoped draft recovery after reload, so the owner can open the existing result before starting another resource.
Import retries likewise reuse a receipt and create one copy. Existing resource
updates retain their original compare-and-swap guard. Draft cleanup after an existing
catalogue update is separate; a lost response cannot silently overwrite a newer entry.

## Storage and compatibility

Schema **24** appends an immutable checksum-bound migration: ancestry jumps,
visible-history links, fact-event projections, exact evidence, owner drafts and
local receipts/cancellation fences. Existing migration text/checksums are unchanged.
The genuine schema-23 fixture preserves its original ledger and immutable story
bytes through upgrade/reopening; an injected interruption rolls back the entire
new migration.

New `.inkmorrow5` saves are format version **2** and preserve exact evidence while
remapping beat identities. Genuine version-1 saves still import through frozen
validators and their frozen enum/normalization dependencies. A checked manifest
protects that compatibility boundary. Drafts, browser bookmarks, credentials,
consent, action keys and resumable requests are excluded. Import always copies;
it never adopts an older product database or overwrites an existing story.

## Verification and limits

Backend coverage includes genuine migration rollback/reopen, strict v1/v2 saves,
quote/hash tampering, ID remapping, public filtering before limits, cursor binding,
future/sibling boundaries, draft CAS/scope/submission snapshots, auth/CSRF,
undispatched cancellation and creation/import receipt replay. Frontend coverage
includes late acknowledgements, conflicts, Lock, prepared identity sequencing and
the preserved reader/catalogue/quality workflows. Desktop and emulated Mobile
Chrome journeys cover the production workspace, private-draft reload, path preview,
privacy, accessibility and reflow; the B0 prototype remains separately identifiable.

[Host query measurements](evidence/B2-QUERY-BENCHMARK.json) are reproducible with
`node scripts/benchmark-inspection.cjs`: 30 warm samples per query at 500, 3,000 and
10,000 moments, with cold Codex time, response/database sizes, RSS and index plan.
The recorded long-path Codex p95 is below 50 ms at 10,000 moments. This fixture uses
24 recurring public/private fact identities. It does **not** measure dense all-path
media/save capacity, narrative quality, real Android hardware, IME or network latency.
Those broader acceptance tasks remain in the guide; do not present this benchmark
or browser emulation as stakeholder device acceptance.

All six manuals are updated and regenerated together; the User Guide remains
35 A4 pages. No live literary-quality acceptance, production migration, deployment,
optional prose editor, V4 converter, audio or complete retained-image inventory is
claimed. **B3 creative depth is the next implementation milestone.**

## Review artifacts

| Surface | Desktop | Emulated mobile |
|---|---|---|
| Chronicle | [Image](evidence/B2-CHRONICLE-DESKTOP.png) | [Image](evidence/B2-CHRONICLE-MOBILE.png) |
| Historical Codex | [Image](evidence/B2-CODEX-DESKTOP.png) | [Image](evidence/B2-CODEX-MOBILE.png) |
| Inspected Desk | [Image](evidence/B2-INSPECTED-DESK-DESKTOP.png) | [Image](evidence/B2-INSPECTED-DESK-MOBILE.png) |

These are isolated synthetic production fixtures, without owner data or paid calls.
