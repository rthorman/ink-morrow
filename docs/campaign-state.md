# Living campaign state

Campaign state is an optional manuscript-owned ledger for facts that matter
across authoring and textual roleplay. A manuscript can use none of it. It does
not replace prose, scene structure, or the Chronicle continuity ledger.

## State model

An owner record has a stable identity and append-only revisions. Each revision
contains a kind, title, compact structured details, status, visibility, cast
links, knowledge/witness lists, an optional note, and provenance. Supported
kinds are relationships, promises, debts, knowledge boundaries, secrets, NPC
goals, factions, quests, conditions, inventory, resources, world time,
deadlines, and progress clocks. Retiring a record hides it from normal reads
without erasing its history.

Codex also projects suitable character conditions, knowledge, possessions,
relationships, goals, and open threads from current page-provenanced
continuity. These projected records are read-only; corrections belong in the
existing remembered/author-canon workflows. The projection does not copy or
mutate continuity data.

## Retrieval and priority

Scene recap is bounded to 30 active records and at most 12 per tier. Records
associated with the Main Character come first, then supporting and background
cast. Global records use the supporting tier. The most recent eight scene Play
turns are returned separately; the server never replays an unbounded
transcript to build the recap.

## AI proposals and cost

AI state discovery is an explicit Play action with the standard paid review.
It sends a bounded transcript, compact existing state, cast identity/role, and
manuscript/scene titles. The request is durable, idempotent, limited to one in
flight per manuscript, and accounts for every billed attempt. A successful
response is only a proposal list. Nothing becomes state until the owner adds
an individual proposal.

The server rejects unknown cast identities and evidence that is not an exact
quotation from the cited turn. A changed transcript or ledger makes an older
request key stale. Restart changes abandoned in-flight work to a retryable
failure rather than inventing success.

## Portability

Campaign entries and every revision are functional project data and always
travel in `.inkmorrow` archives. Play-turn source excerpts and request history
travel only when working history is selected. Without it, Play-derived records
remain useful but their transcript identifier and excerpt are deliberately
detached. Copy import remaps cast, scene, page-revision, Play-turn, entry, and
request identities. Credentials and paid-consent state never travel.
