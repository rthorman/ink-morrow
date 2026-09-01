# ScribeTribe 4.0.0 system architecture

Status: **accepted target architecture**

## Architectural objective

The 4.0 kernel must make one promise above all others: the manuscript,
authoritative story state, and provider spend advance together through explicit,
recoverable transactions.

The 3.2.2 modular Express and native-ES-module structure remains a useful
starting point. The 4.0 work is a clean data-contract break, not permission to
discard working safeguards. In particular, preserve and adapt:

- opaque prepared-page identities and context revalidation;
- page-provenanced continuity deltas and deterministic folding;
- bounded prompt context;
- single-owner authentication and CSRF/origin/Host protections;
- staged, verified portable archives; and
- one coherent frontend composition root and dialog lifecycle.

## Runtime shape

ScribeTribe remains one Node.js process serving one same-origin web
application and one SQLite database. Media and transient staging remain on the
same self-hosted filesystem. There is no required cloud service other than the
AI providers explicitly configured by the owner.

Backend modules own domain behavior:

| Module | Owns |
|---|---|
| auth | Single-owner setup, login, sessions, password change, secret-vault unlock |
| providers | Provider profiles, model capabilities, role assignments, requests and cost |
| catalog | Reusable world and character templates |
| stories | Stories, volumes, chapters, pages, revisions, template snapshots |
| continuity | Provenanced deltas, deterministic fold, corrections, issue analysis |
| writing | Tail edits, prepared pages, generation operations, writer lease |
| imagery | AI painting, Grok refusal sanitation, uploaded assets, placements |
| audio | Page narration and audiobook jobs |
| publication | Normalized publication document and format adapters |
| sharing | Immutable snapshots and capability-token reads |
| transfer | Versioned project archives, import preflight, backup and restore |

Frontend features receive shared services through the composition root and do
not reach into another feature's implementation. The 4.0 surface modules are
Library, Desk, Chronicle, Codex, Gallery, Gate, Settings, and the authentication
threshold.

## Storage identity and versioning

- The 4.0 database declares schema family **scribetribe-4** and an explicit
  monotonic schema version.
- Every durable domain object has an opaque stable ID independent of its
  display order.
- Volume, chapter, and page order use scoped rank or ordinal fields enforced
  transactionally.
- A 4.0 process encountering a 3.x database stops before mutation and explains
  how to choose a new data directory or return to 3.x.
- The 4.0 portable archive has a new format version and does not import 3.x
  archives. Unknown future versions fail closed.
- Derived indexes, search tables, projections, and export caches are rebuildable
  and never treated as the sole record of canon.

## Core data model

| Entity | Essential relationships and responsibility |
|---|---|
| Story | Owns ordered volumes, local template snapshots, settings, and one active tail |
| Volume | Belongs to one story; owns ordered chapters |
| Chapter | Belongs to one volume; owns ordered narrative pages |
| Page | Belongs to one chapter; points to canonical and displayed revisions |
| Page revision | Immutable prose revision with kind, parent, direction, and timestamps |
| Prepared page | At most one per story; speculative prose plus context fingerprint and opaque identity |
| Writing operation | Idempotency key, expected tail/revision, state, spend, and provider result |
| Continuity delta | One structured result per canonical page revision; never per speculative page |
| Continuity correction | Author-owned authoritative override with evidence and scope |
| Continuity issue | Derived warning connecting a correction to possibly divergent prose |
| Template snapshot | Story-local world or character source data and originating template revision |
| Recovery suffix | Expiring recoverable package of truncated pages and their private state |
| Asset | Immutable original or generated media with source, metadata, hashes, and technical type |
| Asset placement | Noncanonical ordering anchor between narrative pages |
| Publication snapshot | Immutable normalized document used for export or sharing |
| Share | Revocable capability record pointing to one publication snapshot |

### Page revisions

A page has two explicit prose pointers:

- **canonical revision** is the text from which that page's continuity delta was
  established; and
- **display revision** is the text the reader sees and exports.

For a normal page these pointers are equal. Substantively editing the active
tail creates a new canonical revision, points both fields to it, invalidates
the preview, and replaces that page's delta after successful extraction.

Copyediting a frozen historical page creates a display-only revision. It does
not change the canonical pointer or recalculate continuity. Future prompts may
use the display prose alongside authoritative folded state, making the author's
responsibility visible without pretending the two sources cannot diverge.

### Template snapshots

Global Library worlds and characters are reusable templates. Adding one to a
story copies its relevant source fields into a versioned story-local snapshot.
Generation reads the snapshot, never the mutable global record.

An explicit “Review template changes” operation computes a field-level diff.
Accepted fields create a new local snapshot and invalidate any prepared page.
It never modifies historical prose or continuity without a separate author
action.

## Canon transaction rules

All canon-changing writes execute in one SQLite transaction and emit an
operation-journal record:

1. validate the single-writer lease and idempotency key;
2. validate expected story, tail page, canonical revision, and context
   fingerprint;
3. write or promote the immutable page revision;
4. update ordered manuscript pointers;
5. consume or invalidate the prepared page exactly once;
6. create the continuity-delta work item;
7. commit the database transaction; and
8. only then schedule background extraction and successor preparation.

Continuity extraction may finish later. Its failure marks memory incomplete but
never rolls back valid prose. A retry joins or replaces the same per-revision
work item and cannot add a second charge record for the same provider result.

No partial provider stream is canonical. It may be shown as transient progress,
but only a complete, quality-checked result can cross the transaction boundary.

## Writing-operation state machine

Durable writing operations use these states:

| State | Meaning |
|---|---|
| requested | Validated request and idempotency identity exist |
| running | One provider call owns the operation |
| succeeded | Complete prose and usage are recorded |
| committed | Canon transaction consumed the result |
| failed | No canonical write; retry policy and known spend recorded |
| superseded | Context changed; result cannot be committed |

A story has one writer lease with a short heartbeat and a visible owning
session. Another tab may read, but a conflicting write is rejected with a
reconciliation action. Expired leases are recoverable; they are not permanent
locks.

The exact prepared page is promoted only through its opaque identity. The
green **Next Page** path has no fallback that can generate replacement prose.

## Truncation and recovery

Truncating after page N:

- verifies N is in the current canonical chain;
- packages the removed suffix, revisions, deltas, directions, and relevant
  private operation history into an expiring recovery record;
- removes it from canon transactionally;
- invalidates the preview and derived fold;
- keeps image assets, but unplaces any art whose anchor no longer exists; and
- returns an immediate undo token.

The default recovery window is 30 days and is owner-configurable. Restore is
allowed only when the surviving head still matches the recovery fingerprint;
otherwise the author exports the recovery package for manual reconciliation.
Recovery data is omitted from publication and sharing.

## Continuity architecture

The Archivist produces strict, versioned structured output for:

- durable events;
- character location, condition, knowledge, possessions, appearance,
  relationships, and goals;
- world facts;
- open and resolved threads; and
- arc movement with supporting evidence.

Each delta cites the page and canonical revision that caused it. Folding is
deterministic and ordered. Corrections are a separate author-owned layer, never
destructive edits to extracted evidence.

Impact analysis is primarily deterministic: search later display revisions and
deltas for affected entities, facts, and states. Optional AI assistance may
summarize suspected consequences, but it cannot apply changes or rewrite prose.

The generation context remains bounded: recent display prose, compact folded
state, unresolved threads, relevant older evidence, current local templates,
and explicit author direction. It never resends the full novel.

## Provider and credential architecture

Provider profiles support OpenAI-compatible endpoints with OpenRouter as the
documented default. A profile has a display name, endpoint, declared
capabilities, model assignments, and a reference to a secret; APIs never return
the secret after submission.

Environment-provided credentials remain supported and read-only. UI-entered
credentials may be session-only or explicitly saved locally. Saved credentials
live in a separate encrypted secret vault:

- a random data-encryption key encrypts entries with authenticated encryption;
- the owner passphrase derives a distinct wrapping key using a separate salt
  and purpose label;
- password changes rewrap rather than re-encrypt every entry;
- plaintext keys exist only in process memory while unlocked;
- secrets are redacted from logs, errors, cost records, archives, snapshots,
  and frontend state.

After a server restart, an otherwise valid remembered web session may reopen
the private application, but it cannot reconstruct the vault key. The first
provider action asks for the owner passphrase to unlock saved provider secrets;
manual work remains available. Terminal password recovery cannot recover the
old wrapping key, so it explicitly removes saved provider credentials and
requires re-entry while preserving manuscripts and media.

If the vault cannot be implemented and reviewed safely in PR 04, beta falls
back to environment or session-only credentials. Plaintext UI persistence is
not an acceptable shortcut.

Scribe, Archivist, and Narrator assignments are logical roles. The same profile
and model may fill multiple roles. Capability discovery never silently changes
an author's stored choice; unavailable choices produce a clear repair state.

## Art architecture

Narrative pages and images are different entity types. Art no longer occupies
page numbers.

An asset records source **uploaded** or **ai-generated**, a content hash,
technical media type, decoded dimensions, original/display derivatives,
optional title and alt text, and provider provenance when applicable. Placement
records position art before the first page or after a stable page ID. Multiple
assets at one anchor have their own order.

Upload processing is streamed and bounded. Active formats are decoded and
stored as safe raster derivatives; embedded metadata is stripped by default.
There is no semantic content scan. A user must explicitly select an asset
before any provider receives it as a reference.

AI image generation retains provider-specific Grok sanitation as an
announce-and-wait flow. Sanitation output is a new editable prompt, not a
secret second generation.

## Publication and sharing architecture

All exports first build one immutable **PublicationDocument** containing:

- title, author and publication metadata;
- ordered volumes, chapters, prose blocks, and scene-break markers;
- owner-selected placed art and accessible descriptions; and
- style-independent semantic roles.

Adapters render that document to DOCX, ODT, RTF, EPUB 3.3, PDF, HTML,
Markdown, plain text, or JSON. Golden semantic fixtures test cross-format
agreement.

A share freezes the same normalized document into a publication snapshot.
Snapshot creation is authenticated; snapshot reading is the only unauthenticated
route. A random high-entropy capability token is stored only as a hash. Shares
are revocable and may expire. Responses prohibit indexing and framing, use a
strict public-snapshot CSP, and expose no application API, provider action, or
mutable story identifier.

## Backup and archive architecture

The 4.0 project archive is the lossless interchange format. It includes
manuscript hierarchy, all revisions selected by the exposure review,
story-local templates, continuity, placements, and selected media. It never
includes authentication records, sessions, provider credentials, saved paid
consent, or secret-vault material.

Import retains the 3.2.2 safety pattern: stream to staging, verify manifest and
hashes, reject traversal and expansion attacks, show collisions, then commit
database and files transactionally. Restore-all creates a safety backup first.

## Performance constraints

- Page turns, history browsing, and local editing perform no provider call.
- Prompt and continuity retrieval are bounded by configured character and row
  limits, not total manuscript length.
- SQLite queries used on the Desk are indexed and avoid whole-story scans.
- One queue per scarce local resource remains the default on low-powered
  devices.
- Media is streamed; archives, uploads, and exports must not require the entire
  payload in memory.
- Background work yields honest states and can resume after process restart.

## Architectural vetoes

Do not merge an implementation that:

- stores speculative prose as canon or continuity;
- lets art change narrative state implicitly;
- makes global template edits live inside existing stories;
- uses display order as durable identity;
- hides replacement prose behind the green prepared-page action;
- stores UI-entered provider keys in plaintext;
- serves an uploaded active document in the application's origin;
- exposes mutable private APIs through a share token;
- adds a second independent manuscript model for exports; or
- requires replaying the entire novel through an AI to recover state.
