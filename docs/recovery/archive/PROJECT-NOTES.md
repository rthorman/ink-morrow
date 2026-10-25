# Ink Morrow — source-based project notes

Reviewed 25 October 2026. Repository: `rthorman/ink-morrow`, default branch `main`, commit `9647cdec4fc8ef4762e407e9c0ba705d563694fb` (7 September 2026, catalogue studio restoration). Local source copy: `/workspace/ink-morrow`.

These notes summarize the current production entry points, domain implementation, browser interface, retained historical code, project instructions, manuals, release history and test coverage. They describe the checked-in implementation; the owner's running installation and any uncommitted work in other environments were not inspected. Source files were not changed.

**Product identity and intent**

Ink Morrow 5.0 is a self-hosted, single-owner playable-fiction application. The default player is a reader-director outside the cast. Following a story and steering its development are complete experiences; inhabiting a character is optional. There is no compulsory avatar or main character. New prose comes from a configured provider; the current product deliberately excludes manual prose editing and handwritten opening submissions.

The game offers two independent play styles. Story-shaping accommodates desired developments within established continuity and ownership. Living-world permits credible cooperation and resistance grounded in the circumstances. Pacing and gentle/dramatic consequences are separate choices. Quiet scenes, aftermath, unresolved conversations, and stopping are intended parts of play. Nothing simulates forward during the player's absence, although an already authorized request may finish.

Two curated openings are implemented: **The Drowned Bell**, a harbour mystery and family relationship story with fixed hidden truth; and **The Garden After Rain**, a quiet communal-garden story. Their public catalogue excludes their private setup truth. A custom situation starts without a paid request and without an authored opening. Available genre categories are drama, mystery, exploration and cozy.

Sources: [README](../../../README.md), [current product decisions](../../../AGENTS.md), [curated scenarios](../../../backend/src/modules/fiction/scenarios.js).

**The most important distinction: active 5.0 versus historical code**

The repository retains a large manuscript-writing suite from versions 3 and 4. Those files are not a reliable list of current features. Production `server.js` explicitly selects authentication and `legacyEnabled: false`. The active HTML imports `app/fiction/bootstrap.js`, not the older `app/bootstrap.js`.

The old Desk, Chronicle, Codex, Gallery and Gate workspace, handwritten manuscripts, continuity-extraction queues, prepared successors, scene roleplay/campaign tools, narration/audiobooks, old portable archives and public snapshot sharing remain behind an explicit legacy test seam. Some utilities are reused by 5.0 without mounting their old APIs. Examples include image normalization, publication adapters, provider infrastructure, authentication, and Scribe craft definitions. Historical schemas and tests remain too.

Reusable catalogues were initially removed for 5.0, then explicitly restored in a new namespace. The **current Visual Library is active** and must not be confused with retired legacy catalogue routes. The September studio restoration also explicitly preserves the exclusion of manual prose authoring.

Sources: [production entry](../../../backend/server.js), [application composer](../../../backend/src/app.js), [active HTML](../../../frontend/index.html), [historical runtime](../../../backend/src/legacy-runtime.js).

**Technology and module ownership**

One Express process serves a protected API and static browser files. The backend uses CommonJS and built-in `node:sqlite`; the browser uses native JavaScript ES modules with no frontend build step. Node 22.5 or newer is declared. SQLite and private raster files provide persistence; there is no vector database, embedding service or per-character agent infrastructure.

| Area | Source ownership |
|---|---|
| Configuration, startup, bind, shutdown | `backend/server.js`, `backend/src/core/storage.js` |
| Middleware and current runtime composition | `backend/src/app.js` |
| Database identity, migrations, preflight | `backend/src/db.js`, `core/database-inspection.js`, `release.js` |
| Owner access and credential lifecycle | `modules/auth/`, `modules/providers/` |
| Domain validation and state transitions | `modules/fiction/model.js`, `store.js` |
| Storyteller context and request orchestration | `modules/fiction/service.js`, `memory.js` |
| Challenges, scene opportunities, episodes, asides | `resistance.js`, `director.js`, `episodes.js`, `fourth-wall.js` |
| Optional review and durable call accounting | `quality.js`, `quality-plan.js`, `call-ledger.js` |
| Reusable references and AI development | `library.js`, `library-model.js`, `library-draft.js`, `library-schema.js` |
| Art, books, playable portability | `media.js`, `publication.js`, `saves.js` |
| Current browser app | `frontend/app/fiction/` |
| Shared browser boundaries | `app/core/api.js`, `app/core/dialogs.js`, `app/features/auth/` |

The fiction folder is the starting point for current gameplay changes. The large older writing/continuity modules should not be treated as the current narrative engine.

**One authoritative story graph**

Core tables include `fiction_games`, `fiction_branches`, `fiction_beats`, `fiction_requests`, `fiction_calls` and `fiction_assets`. A game has an active branch and an optimistic revision. A branch points to its exact head, parent branch and fork moment. Every beat points to its parent and contains resulting state plus recorded changes.

Beat kinds distinguish opening/scene narration, outside-story clarification, corrections, control handoffs and episode changes. Local actions are durable history as well as generated passages. Snapshots contain cast, facts, knowledge, relationships, resources, control, play style, boundaries, voice, focus, quality choice, episode framing, director history, adjudications and images.

Mutations use immediate SQLite transactions, expected revision checks, and a pending-request exclusion. Network work takes place outside the database transaction. Commit rechecks the pending request, branch and revision. Rewind is a new branch at an exact existing moment; it preserves the original future. Branch switching does not merge histories.

Source: [fiction store](../../../backend/src/modules/fiction/store.js).

**Player actions and ownership**

- **Follow / Continue:** extend the current story without a supplied direction.
- **Steer:** supply editorial direction; it defaults to this moment. Only explicitly ongoing Steer replaces persistent focus, and only after success.
- **Ask:** buy an outside-story clarification. Structured effects are prohibited and scene counters do not advance.
- **Inhabit / Release:** local, explicit control handoffs. Act and Say require an inhabited character.
- **Correct / Retire:** append authoritative state records without rewriting older prose. Private correction reasons are filtered out of reader responses.
- **Episodes:** the player ends an episode and starts the next. Questions and up to six public goal references provide focus. Recorded goal resolution can create payoff and later aftermath, but does not end play automatically.

Facts distinguish ordinary truth, commitments, relationships, goals and numeric resources. Relationships use qualitative descriptions and facets: general, affection, trust, cooperation and expectation. There are no affection meters. Generated effects are bounded to twelve and require an exact quote from the new prose or supplied input. They can remember, resolve, reveal, adjust a resource, develop an existing relationship or introduce a named person. They cannot silently overwrite an existing fact or grant character control. Certain invented commitments/feelings for an inhabited character are rejected structurally; arbitrary prose compliance is still a model-quality limitation.

Sources: [domain model](../../../backend/src/modules/fiction/model.js), [episode logic](../../../backend/src/modules/fiction/episodes.js), [routes](../../../backend/src/modules/fiction/routes.js).

**Memory and scene direction**

The 128-fact snapshot is a working set, not the lifetime memory store. Initial facts and immutable beat changes retain history. Recursive ancestry queries select the latest version of each fact, honor correction and retirement, and exclude sibling paths. Public filtering happens before bounded reader retrieval. Recall returns up to 32 facts; local recaps include recent narrated summaries, open public commitments and qualitative relationships.

Storyteller context is bounded: up to twelve recent history entries with shortened prose, relevant facts, cast descriptions/motives, frozen selected references, preferences, input and a provisional scene plan. It is not a whole-story replay. The deterministic director proposes opportunities involving commitments, goals, quiet moments, discovery, connection, exploration or relationships. Plans remain suggestions rather than completed events.

Sources: [memory](../../../backend/src/modules/fiction/memory.js), [story service](../../../backend/src/modules/fiction/service.js), [director](../../../backend/src/modules/fiction/director.js).

**Living-world resistance and fourth-wall dialogue**

Structured challenges define specific approaches and application-owned requirements. The application evaluates public recorded grounds, required knowledge and resource thresholds. Free-form dialogue is not mechanically adjudicated. An unchanged prior ruling is reused without buying another response, even when providers are unavailable. New sufficient evidence can change a refusal. Flexible challenges can be granted by Story-shaping; Living-world does not treat repetition alone as authority.

Living-world also supports Never/Rarely/Freely character asides to the real reader. Never is default. Rarely uses a six-scene spacing check. A structured aside names an eligible cast member and contains at most 600 characters. Ask and Story-shaping do not permit these asides; an inhabited character cannot be supplied as their speaker. The aside is appended to the stored passage but cannot supply evidence for state effects. This does not prove a model cannot put an unstructured aside into ordinary prose.

Sources: [resistance](../../../backend/src/modules/fiction/resistance.js), [fourth-wall logic](../../../backend/src/modules/fiction/fourth-wall.js).

**Generation, review and money**

A narrative purchase requires a current revision and an idempotency key. Successful exact replay is free; reuse with different input conflicts. Failed/interrupted keys require a new explicit action. Each actual text call is durably recorded before dispatch. The current narrative service explicitly disables transport retries. It validates JSON, effects, ownership boundaries, challenge outcomes and current request authority before saving.

| Quality setting | First draft accepted | Maximum calls |
|---|---:|---:|
| Off, the default | 1 | 1 |
| Standard reviewer | 2 | 4 |
| Memory reviewer | 2 | 4 |
| Both reviewers | 3 | 6 |

There is at most one repair. The repaired candidate must pass all selected reviewers. Reviewers cite candidate text and propose no direct canon mutation. The server hashes the role/provider/model plan, endpoint, timeout and call ceiling into a review identity and checks it across dispatch boundaries. Missing roles do not cause silent downgrade.

Only the final accepted beat is committed. Rejected, stale or late work can still incur charges. Per-call accounting retains mixed known and unknown amounts and avoids double counting legacy request-level rows. Restart interrupts pending requests and calls; late replies can settle charges without regaining authority to save prose. Text cost is calculated best-effort from usage and model-catalogue pricing; it should not be confused with an independently reconciled invoice. UI review estimates are ballparks, not hard caps.

Ordinary purchase consent is remembered on the device by the shared dialog manager. Expanded quality consent has its own configuration-derived scope. Passive reading, recaps and page turns do not purchase text.

Sources: [generation service](../../../backend/src/modules/fiction/service.js), [quality pipeline](../../../backend/src/modules/fiction/quality.js), [call ledger](../../../backend/src/modules/fiction/call-ledger.js), [AI transport and pricing](../../../backend/src/ai.js), [consent dialogs](../../../frontend/app/core/dialogs.js).

**Visual Library and Scribes**

Reusable worlds, characters and Scribes use `/api/fiction/catalog`. Worlds have genre, setting and lore. Characters have appearance, personality, background and motive. Scribes combine identity fields with narrative craft settings such as diction, rhythm, distance, description density, dialogue, exposition, humour, tempo, progress appetite, tension and aftermath. Scribes are fictional craft personas with a specific adult catgirl brand canon; they are separate from the logical Scribe provider role.

The studio can expand seed fields into short/medium/long editable references. AI development returns an unsaved result; saving remains separate. It sends all entered reference fields, including private lore, motives and background. One invalid result permits one corrective second call, but transport failures do not authorize retries. The draft journal survives deletion of saved reference content and successful replay does not purchase again.

At story creation, selected references and normalized images become independent frozen copies. Later catalogue edits/deletion cannot alter that story. Catalogue CRUD, selection and saving are local. Image painting has a separate durable purchase journal, and deletion preserves spend while scrubbing reusable content. A playable save carries selected frozen copies, not the entire reusable catalogue.

Sources: [library backend](../../../backend/src/modules/fiction/library.js), [reference drafting](../../../backend/src/modules/fiction/library-draft.js), [reference shapes](../../../backend/src/modules/fiction/library-model.js), [browser studio](../../../frontend/app/fiction/library.js).

**Images, books and saves are different products**

Local raster upload and reviewed Illustrator painting are supported for passage illustrations, covers, world/Scribe references and character portraits. Uploads are technically checked, decoded, normalized and metadata-stripped into private WebP files. AI passage art sends the selected passage and art direction; reference art uses visible fields and appearance/setting, or title/premise for a cover. Private lore/motives and uploaded reference bytes are excluded from these current painting requests. Image bytes have integrity metadata and reader access remains authenticated.

Placements and story visuals belong to snapshots. Replacing or removing current story art preserves the earlier snapshots' assets. Reader illustrations appear above associated prose. A book includes only active-path opening/scene prose, the current cover and current passage placements; Ask, local history records, other branches and private reference portraits are excluded. Nine formats are implemented: EPUB, PDF, HTML, DOCX, ODT, RTF, Markdown, plain text and publication JSON. EPUB uses separate fixed-layout image spine pages before reflowable prose.

Playable `.inkmorrow5` saves are gzip-compressed, versioned JSON containing all paths, private snapshots, input directions, normalized assets and aggregate spend. They exclude credentials, provider configuration, consent, call IDs and resumable requests. Validation checks the complete graph, ancestry, evidence, references, bounded media and image hashes before import. Import assigns fresh game/branch/beat/media identities and transactionally creates a separate game. Failed imports clean only their newly staged files. Saves are unencrypted; books are not resumable saves. Mechanical metadata filtering cannot remove a fictional secret already leaked into generated prose.

Sources: [media](../../../backend/src/modules/fiction/media.js), [image normalization](../../../backend/src/modules/imagery/art-store.js), [book projection](../../../backend/src/modules/fiction/publication.js), [format adapters](../../../backend/src/modules/publication/adapters.js), [save validation/import](../../../backend/src/modules/fiction/saves.js).

**Frontend behavior and visual identity**

Current routes cover the story shelf, new-story setup, a story reader, provider settings and the three Visual Library kinds. The main controller coordinates smaller influence, reference-library, quality, media, save, provider and story-dialog modules.

The reader shows one passage at a time with Previous/Next/Latest. Older history loads through free bounded reads. Continue always extends the latest head, even when an older page is displayed. Pending actions show immediate feedback and protect against duplicate submission. Failures remain beside Continue and preserve entered direction. Failed paid operations reconcile through free reads rather than resending automatically. Route/epoch checks prevent late results from painting another story or refilling a locked app. Direction drafts are in memory; text-size preference is browser-persisted.

The design uses dark plum/wine, gold, vellum reading surfaces, bundled fonts, and the canonical SVG lockup shared with authentication, README and all manuals. It includes visible focus styling, labelled controls, keyboard submission, responsive studio layouts, reduced-motion handling and touch targets. Story prose is rendered through text nodes.

Sources: [browser controller](../../../frontend/app/fiction/app.js), [bootstrap](../../../frontend/app/fiction/bootstrap.js), [influence and recall](../../../frontend/app/fiction/influence.js), [current CSS](../../../frontend/styles/fiction.css), [brand assets](../../../frontend/brand).

**Access, storage and operations**

The app uses one owner with terminal-code setup, a 15–128-character password, scrypt password hashing, opaque sessions, HttpOnly/SameSite cookies and per-session CSRF. Host and same-origin guards and authentication run before private body processing. Static boot is gated; lock clears private browser state. A local HTTPS reverse proxy is supported; loopback is the default bind and direct LAN HTTP is an explicit operator option.

Logical providers include Storyteller/Scribe, optional Archivist memory reviewer, Illustrator, and a retained Narrator role used by historical infrastructure. Provider profiles are OpenAI-compatible, with the built-in OpenRouter profile as a default. Credentials can come from the environment, process memory or an AES-256-GCM vault. Vault data keys are password-wrapped; password changes rewrap rather than rewriting all credential ciphertext. Remembered browser login after restart does not itself decrypt the vault. Database and story media are not encrypted at rest.

Current identity is 5.0.0, database family `ink-morrow-5`, schema **23**, SQLite application marker IM50. Default storage is `database-v5/ink-morrow-5.db`. `DATA_DIR` and `DB_PATH` share one resolver between server and password recovery; relative paths start from `backend/`. Existing databases and sidecars are examined through a private scratch copy before the original can enter normal SQLite startup. Family/version markers, checksummed migration ledger and integrity must pass. Old product families and orphan sidecars are rejected rather than adopted. This preflight is not a live-backup mechanism. Operator backups need the configured database and media locations; a story save does not back up the installation catalogue or credentials.

Sources: [authentication](../../../backend/src/modules/auth/service.js), [provider service](../../../backend/src/modules/providers/service.js), [vault](../../../backend/src/modules/providers/vault.js), [database startup](../../../backend/src/db.js), [release identity](../../../backend/src/release.js).

**Implemented bounds**

| Bound | Value |
|---|---:|
| Cast per story | 24 |
| Snapshot fact working set | 128 |
| Effects per generated response | 12 |
| Alternate paths | 40 |
| Shelf/catalogue entries per page | 80 |
| Recall results | 32 |
| Structured challenges / approaches each | 12 / 6 |
| Current illustrated passage placements | 200 |
| Retained story image assets | 400 |
| Cover and reference targets | 27 |
| Portable-save moments | 10,000 |
| Save compressed / expanded | 64 MB / 128 MB |
| Incoming raster upload | 20 MB |
| Generated prose / direction | 24,000 / 4,000 characters |

These are implementation bounds, not demonstrated real-device capacity or proof of long-running model consistency.

**Tests, release discipline and manuals**

The repository has backend Jest/Supertest, frontend ESM Jest/jsdom and Playwright desktop/mobile Chrome tests. Browser tests isolate storage and use a separate test server. Current fixtures cover state/fork isolation, public/private boundaries, idempotency, stale requests, interrupted/late work, mixed billing, strict quality limits, frozen references, saves, image layout, retained direction, locking, accessibility and responsive reading. Retained historical tests exercise the disabled legacy composer too.

Five GitHub CI checks on the reviewed main commit are successful: Brand residue, Lint, Jest backend/frontend, Production dependency audit and Playwright e2e. Those completed on 7 September; this is recorded CI evidence, not a new test execution or current dependency audit. In this workspace, the brand-residue guard, canonical-logo check, release identity check and strict PDF freshness check were run successfully. Full Jest/browser suites were not rerun, no server was started, and no paid provider calls were made.

Six committed PDF manuals cover User Guide, Operations/Recovery, Architecture, State Machines, Security/Privacy/AI Boundary and Maintenance/Testing/Release. Their active sources are declared in `docs/pdf-library/books.mjs`. The current User Guide is Markdown; the retained HTML guide is historical. Manuals share the renderer, assets and freshness manifest. The 5.0 User Guide has a 35-A4-page acceptance target. Freshness validates source/output hashes, not semantic accuracy.

Project-owned current material is AGPL-3.0-only; the older line through 3.2.2 retains its historical MIT licensing. Project instructions require preserving historical data, no automatic/background purchases, and exact-head green CI before merges. The current request is source familiarization and supplies no authorization to deploy, start the replacement server, or run paid live-model benchmarks.

Sources: [CI](../../../.github/workflows/ci.yml), [current browser tests](../../../e2e/tests/fiction.e2e.test.js), [PDF workflow](../../../docs/pdf-library/README.md), [release record](../../../docs/releases/5.0.0/README.md), [project instructions](../../../AGENTS.md).

**Documentation drift to keep in mind**

1. The current known-issues document still lists reusable catalogues among absent features; current code and README implement the restored Visual Library.
2. The architecture manual source still names schema 22; the release constant, migration chain and studio code use schema 23.
3. The README's migration paragraph mentions schema 21 to 22 without describing the additional schema-23 draft journal.
4. Some release/integration instructions retain pre-merge wording despite current main containing the restored studios. Historical plans should not be mistaken for outstanding implementation work.

These are observed source/document mismatches, not changes made during this review. The code, active entry points and latest product decisions take precedence when understanding current behavior. A passing PDF freshness check does not catch these semantic mismatches.

**Working context for future changes**

Current gameplay work belongs in the fiction engine and fiction frontend. A change to durable story behavior may also affect fork restoration, public projection, save validation/remapping, provider context, cost/consent, reader feedback and the six manuals. The graph is the common authority across these surfaces. Proposed improvements should be assessed against the current game design rather than accidentally reinstating the retired manuscript suite.
