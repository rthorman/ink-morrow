# ScribeTribe 4.0.0 implementation plan

Status: **accepted pull-request contract**

## Integration policy

PR 00 remains in the historical MIT-licensed **main** line. The
**release/4.0.0** line begins at a parentless `AGPL-3.0-only` root containing
the accepted planning snapshot and merged PR 01 kernel. PRs 02–18 target that
release line. PR 19 uses a dedicated, reviewed unrelated-history cutover
branch to place the release tree on main and create the beta tag.

Every implementation branch starts from the latest release branch. Before
merge it is updated with intervening release changes, not the reverse. Each PR
must keep the application bootable and testable; feature flags or unavailable
states are acceptable while a later UX PR is pending, but half-written canon is
not.

Never merge main into the release line or rebase a release-line branch onto
main. Project-owned 4.0 material and machine-readable plans must remain
`AGPL-3.0-only`; third-party license metadata remains intact. Modified network
deployments must offer Corresponding Source as required by AGPLv3 section 13.

The UI/UX reviewer has veto over user-facing complexity and ambiguity. The
security contract has veto over credential, public-share, upload, archive, and
active-content shortcuts. Product invariants require stakeholder approval to
change.

## Queue summary

| ID | Title | Primary risk retired |
|---|---|---|
| 00 | Planning, legal, and release contract | Ambiguous scope and liability |
| 01 | Clean 4.0 kernel and schema identity | Accidental 3.x reinterpretation |
| 02 | Volume, chapter, and page hierarchy | Flat-page model |
| 03 | Revisions, copyediting, and truncation recovery | Prose/state ambiguity and irreversible mistakes |
| 04 | Provider profiles, secret vault, and AI roles | Credential handling and model ambiguity |
| 05 | Continuity ledger v2 | Long-form canon and correction integrity |
| 06 | Transactional writing state machine | Duplicate spend and wrong-page commits |
| 07 | Noncanonical art store and safe upload | Art corrupting canon and malicious media |
| 08 | Grok sanitation adapter | Provider refusal confusion |
| 09 | Adaptive Scriptorium shell | Developer-centric navigation and styling |
| 10 | Library and manuscript start | Setup friction |
| 11 | The Desk | Core authoring usability |
| 12 | Chronicle | Structure/history/recovery usability |
| 13 | Codex | State inspection and correction usability |
| 14 | Gallery | Unified generated/uploaded art workflow |
| 15 | Publication document and core format adapters | Export drift |
| 16 | EPUB, PDF, and Gate | Publisher delivery and exposure UX |
| 17 | Immutable snapshot sharing | Unsafe public access |
| 18 | Archive completion, hardening, and release evidence | Cross-cutting beta risk |
| 19 | Beta release merge | Uncontrolled cutover |

## PR 00 — Planning, legal, and release contract

**Target:** main
**Depends on:** none
**Risk:** low

### Includes

- accepted workshop decisions and final round-table disposition;
- system, security, UX, art, QA, and delivery contracts;
- machine-readable PR queue;
- root legal/liability and privacy notices;
- README, SECURITY.md, AGENTS.md, Code of Conduct, and credits pointers; and
- approved portrait art-direction reference.

### Acceptance

- all internal Markdown links resolve;
- PR-QUEUE.yaml parses and matches this plan;
- documents clearly distinguish shipped 3.2.2 behavior from 4.0.0 target;
- historical main through 3.2.2 remains unchanged under MIT;
- the independent 4.0 root carries canonical `AGPL-3.0-only` licensing;
- legal text disclaims legal advice and calls for qualified review; and
- stakeholder approval is recorded.

### Non-goals and rollback

No runtime, schema, route, dependency, or feature claim changes. Revert is
documentation-only.

## PR 01 — Clean 4.0 kernel and schema identity

**Target:** release/4.0.0
**Depends on:** 00
**Risk:** high

### Includes

- create explicit database family/version metadata and migration runner;
- create the empty 4.0 core tables and integrity constraints from
  SYSTEM-ARCHITECTURE.md;
- refuse 3.x databases before any write, with actionable data-directory
  guidance;
- establish 4.0 archive identity/version, manifest schema, and future-version
  refusal;
- add operation-journal and boot-reconciliation primitives;
- retain the Express composer, module injection seams, auth-before-body
  middleware, secure headers, same-origin API, and in-memory test support; and
- add a release-feature capability endpoint used by later UI work.

### Owned areas

**backend/src/db.js**, backend startup/configuration, transfer manifest/schema,
core validation, database tests, setup/start documentation.

### Acceptance and tests

- clean boot creates a valid 4.0 database;
- second boot is idempotent;
- recognized 4.0 upgrades are transactional;
- 3.x database and archive fixtures fail before mutation;
- unknown future schema/archive versions fail closed;
- foreign keys and integrity checks are active;
- interrupted migration fixture restores the last valid state; and
- 3.2.2 security/auth regression suite remains green or is ported without
  weakening assertions.

### Non-goals and rollback

No 3.x data migration, UI redesign, or complete archive import. Revert removes
only the new release branch; main remains on 3.2.2.

## PR 02 — Volume, chapter, and page hierarchy

**Target:** release/4.0.0
**Depends on:** 01
**Risk:** high

### Includes

- implement Story → Volume → Chapter → Page tables and stores;
- create Volume I and Chapter I atomically with every story;
- use opaque IDs plus transactionally maintained scoped order;
- add CRUD/rename operations for volumes and chapters at the active tail;
- add list/read APIs that return an ordered hierarchy and stable page identity;
- define scene-break markers as prose semantics, never rows; and
- update project archive aggregates for hierarchy.

### API and behavior

Story reads return a summary plus ordered volume/chapter/page descriptors;
individual page reads are addressable by stable ID. Display numbers are
derived and may change without changing identity. Creating a chapter or volume
at the current tail is explicit. Arbitrary historical page reordering is not
implemented.

### Acceptance and tests

- empty and large hierarchies preserve deterministic order;
- concurrent inserts cannot duplicate ranks;
- renaming structure changes no page identity or continuity provenance;
- deletion obeys foreign-key and nonempty-tail rules;
- archive round-trip fixture preserves hierarchy; and
- queries for active tail and neighboring pages are indexed.

### Non-goals and rollback

No UI beyond temporary test/admin seams, page revisions, or continuity. Schema
rollback is not performed in place; release-branch data may be recreated.

## PR 03 — Revisions, copyediting, and truncation recovery

**Target:** release/4.0.0
**Depends on:** 02
**Risk:** very high

### Includes

- immutable page revisions with canonical/display pointers;
- substantive active-tail editing and display-only historical copyediting;
- revision ancestry, direction provenance, timestamps, and author/AI source;
- transactional truncation after a selected page;
- immediate undo tokens and persisted expiring recovery suffixes;
- 30-day default configurable retention and cleanup;
- safe restore fingerprinting and recovery-package export fallback; and
- operation-journal entries for every canon mutation.

### API and behavior

Tail save creates a canonical revision and invalidates speculative work.
Historical copyedit creates only a display revision. The copyedit response
states that continuity was not recalculated. Truncation returns exact counts,
range, recovery expiry, and undo identity. Restore refuses if the surviving
head fingerprint has changed.

### Acceptance and tests

- canonical and display pointers cannot cross stories/pages;
- tail edit updates both pointers; copyedit changes only display;
- copyedit survives export/archive and leaves canonical evidence intact;
- truncation and undo are atomic across hierarchy/revisions/private state;
- unsafe restore cannot merge or overwrite;
- expiry cleanup never touches active canon;
- process interruption produces either old or new complete state; and
- property tests cover random edit/truncate/restore sequences.

### Non-goals and rollback

No continuity extraction or final UX. Reverting the PR discards only
release-branch 4.0 data; no down-migration is promised.

## PR 04 — Provider profiles, secret vault, and AI roles

**Target:** release/4.0.0
**Depends on:** 03
**Risk:** very high

### Includes

- provider-profile abstraction for OpenAI-compatible endpoints, with
  OpenRouter as the documented default;
- logical Scribe, Archivist, and Narrator model assignments;
- capability/model catalogue, pricing metadata, timeouts, and explicit
  unavailable states;
- environment, session-only, and encrypted-persistent credential sources;
- authenticated-encryption vault with passphrase-wrapped data key;
- password-change rewrap, reset/recovery behavior, redaction and file
  permissions;
- provider setup/status APIs that never return secrets; and
- cost/data exposure description primitives shared by later UI.

### Security decision gate

Persistent UI credentials ship only if vault cryptography, lifecycle, password
change, backups, and canary tests pass review. Otherwise the saved option is
disabled and beta supports environment plus session-only keys. Plaintext
database or JSON persistence is forbidden.

### Acceptance and tests

- profiles cannot read another secret reference;
- API/log/error/archive/frontend canaries never reveal a key;
- login unlocks the vault; lock/restart/password reset remove plaintext access;
- password change preserves encrypted entries by rewrapping;
- a remembered session after restart can use manual features but must re-enter
  the passphrase before using saved provider secrets;
- terminal password recovery removes unrecoverable saved provider credentials
  while preserving manuscripts and media;
- damaged/authentication-failed ciphertext fails closed;
- environment credentials remain read-only and clearly identified;
- role fallback to one physical model is explicit;
- model capability changes never silently select a different model; and
- no provider call occurs during catalogue/library/manual-writing work.

### Non-goals and rollback

No hosted OAuth, payment, key resale, automatic provider signup, or broad
vendor-specific feature matrix. Disable persistent vault capability as the safe
rollback.

## PR 05 — Continuity ledger v2

**Target:** release/4.0.0
**Depends on:** 04
**Risk:** very high

### Includes

- versioned Archivist schema for events, character state, world facts, goals,
  threads, and arc movement;
- one delta per canonical page revision with direct evidence/provenance;
- deterministic fold and rebuildable search/projection tables;
- story-local template snapshots for worlds and characters;
- reviewed field-level import of later Library template changes;
- author corrections as a separate authoritative layer;
- deterministic downstream issue discovery plus optional AI summary;
- coverage, failed extraction, repair, and rebuild APIs; and
- bounded retrieval for Scribe context.

### Invariants

Prepared pages have no delta. Display-only copyedits do not replace deltas.
Tail canonical revisions do. Template intent is not an event. Corrections never
rewrite evidence or prose. A complete fold can be reproduced without an AI.

### Acceptance and tests

- strict schema rejects extra/malformed model fields;
- identical ordered deltas fold identically across rebuilds;
- truncation deterministically removes suffix effects;
- tail replacement excludes and then replaces the former delta;
- display copyedit leaves state unchanged but appears in future prose context;
- correction precedence and evidence remain inspectable;
- impact analysis finds seeded later conflicts without inventing edits;
- snapshot update requires explicit accepted fields; and
- 3,000-page fixture retrieves bounded context without a whole-story scan.

### Non-goals and rollback

No vector database, embeddings service, autonomous prose repair, whole-novel AI
replay, or scene model. Derived ledger data can be cleared/rebuilt; prose is the
rollback-safe primary record.

## PR 06 — Transactional writing state machine

**Target:** release/4.0.0
**Depends on:** 05
**Risk:** critical

### Includes

- durable writing operations and idempotency keys;
- per-story single-writer lease with expiry/reconciliation;
- context fingerprint across tail, canonical revision, templates, settings,
  and folded-state version;
- at most one restart-safe prepared page per story;
- exact opaque preview promotion;
- directed generation that preserves preview until press, then consumes it;
- cancel, provider failure, stale response, restart, refresh and competing-tab
  behavior;
- partial-stream noncanonical handling;
- background continuity and exactly one successor preparation after commit; and
- authoritative provider usage/cost attribution.

### Acceptance and tests

- **Next Page** can only commit the identified prepared prose;
- it has no fallback path to live generation;
- typing/clearing direction preserves the same preview until directed press;
- directed press discards preview and makes one Scribe request;
- failed directed work saves no page and preserves direction;
- clearing after that failure creates a fresh ordinary preview;
- double submission and repeated idempotency key return one result;
- reordered provider replies cannot mutate or paint the wrong story;
- lease loss yields a clear reconcile state, never corruption;
- commit returns prose before optional Archivist completion;
- one successful canon action launches exactly one successor; and
- cost tests distinguish spent speculative work from committed story totals.

### Non-goals and rollback

No final Desk styling. This PR is not mergeable behind an old ambiguous button
without a temporary truthful test surface.

## PR 07 — Noncanonical art store and safe upload

**Target:** release/4.0.0
**Depends on:** 06
**Risk:** high

### Includes

- migrate 4.0 art design to separate Asset and AssetPlacement entities;
- sources **uploaded** and **ai-generated**;
- anchors before first page or after stable page ID, with local order;
- streamed multipart upload and private staging;
- signature/decode/pixel/byte validation, normalization and random filenames;
- metadata stripping by default;
- safe raster derivative; flatten animation for beta;
- SVG rasterize-or-reject and never serve active SVG;
- unplace/move/delete semantics that never renumber prose or alter continuity;
- explicit provider-reference consent flag; and
- project archive media/placement representation.

### Acceptance and tests

- arbitrary-subject fixture images are accepted without classification;
- upload produces zero provider calls and zero AI cost;
- JPEG/PNG/WebP plus available GIF/AVIF decoders work within limits;
- malformed, false-MIME, polyglot, pixel-bomb, oversized and active-SVG
  fixtures fail safely;
- GPS/device metadata canaries are absent from stored display derivatives;
- interrupted upload leaves no staging residue after reconciliation;
- placements survive page display-number changes;
- truncation unplaces orphaned art but preserves its asset in Gallery; and
- no image row can become a narrative page or continuity input.

### Non-goals and rollback

No semantic moderation, image-rights determination, general file upload,
animation guarantee, or final Gallery. Feature can be disabled without
changing narrative canon.

## PR 08 — Grok sanitation adapter

**Target:** release/4.0.0
**Depends on:** 07
**Risk:** medium

### Includes

- port the proven Grok renderable-by-design prompt and refusal detection;
- retain announce-and-wait sanitation with visible editable prompt;
- report sanitation-model cost separately;
- retain deliberate second-press generation;
- handle reference-related repeated refusal and explicit drop-references
  option;
- normalize provider refusal without pretending it is ScribeTribe policy;
- preserve original uploaded/generated references unchanged; and
- isolate behavior in a provider adapter so other image providers can define
  their own refusal contract.

### Acceptance and tests

- first refusal performs no silent image retry;
- sanitized prompt and reason are returned to the owner;
- no generation occurs until another explicit action;
- sanitation call count/cost is exact;
- a second reference-related refusal offers a truthful reference-free path;
- success/refusal resets state correctly when story or asset changes;
- original asset bytes and metadata record remain unchanged; and
- non-Grok adapters do not inherit Grok-specific wording accidentally.

### Non-goals and rollback

No app-wide content classification, guarantee of provider acceptance, or
automatic provider switching. Disable the Grok adapter while keeping upload.

## PR 09 — Adaptive Scriptorium shell

**Target:** release/4.0.0
**Depends on:** 08
**Risk:** high

### Includes

- fresh design tokens, typography, spacing, focus, motion and manuscript
  surfaces from ART-DIRECTION.md;
- new global Library threshold and story workspace shell;
- Desk/Chronicle/Codex/Gallery/Gate routes;
- labelled bottom bar on portrait/compact and rail on landscape/desktop;
- manuscript switcher, Settings, Lock, global error/disk state;
- shared sheet/dialog/menu/form/button/status primitives;
- quiet loading, autosave and notification grammar;
- reduced motion, zoom/reflow, keyboard and touch foundations; and
- production treatment of approved art direction without treating the
  reference as a screenshot specification.

### Acceptance and tests

- critical viewport screenshots and route transitions pass;
- one stable destination vocabulary exists at every width;
- no private shell flashes before auth;
- all controls have accessible names and 44-pixel primary touch targets where
  practical;
- focus/scroll/opener lifecycle remains singular and stack-safe;
- 200 percent text zoom retains the active action;
- virtual keyboard does not cover the composer area;
- manuscript text sits on a quiet, contrast-verified surface; and
- no old route becomes a hidden duplicate destination.

### Non-goals and rollback

No complete feature screens. Temporary honest empty states are expected.
Revert is CSS/shell/routes without changing domain data.

## PR 10 — Library and manuscript start

**Target:** release/4.0.0
**Depends on:** 09
**Risk:** medium-high

### Includes

- manuscript-first Library with recent work and templates;
- **Begin a manuscript** and **Import** entry actions;
- one-sheet start paths: manual opening, AI seed, imported prose;
- automatic Volume I and Chapter I;
- optional Foundations drawer and field-level AI draft acceptance;
- provider setup only at first provider-requiring action;
- three contextual hints maximum;
- template creation/editing and explicit story-local copy explanation; and
- empty, failure, retry, offline/restart and keyboard/touch states.

### Acceptance and tests

- manual author reaches an editable first page without provider setup;
- seed author reviews data/cost before the first call;
- import maps headings or creates one chapter without losing text;
- cancelling setup preserves all entered material;
- default hierarchy is always valid;
- global template edits do not mutate story snapshots;
- screen fits critical portrait viewport with first action in reach; and
- onboarding contains no blocking tour or required advanced fields.

### Non-goals and rollback

No 3.x import, collaborative invite, marketplace, public discovery, or required
premise/cast/world.

## PR 11 — The Desk

**Target:** release/4.0.0
**Depends on:** 10
**Risk:** critical

### Includes

- manuscript reading/editing surface for active tail;
- autosave with explicit failure/offline state and revision conflict repair;
- prepared/directed primary-action UI exactly matching PR 06;
- page turning, keyboard shortcuts, narration controls and secondary tool sheet;
- historical read mode, display-only copyedit flow and quiet notice;
- exact **Return story to this page** consequence/recovery dialog;
- process/race/restart reconciliation states; and
- portrait-tablet sticky composer that never covers prose.

### Acceptance and tests

- every PR 06 state is visually distinct and operable;
- clearing direction restores the same preview;
- no-story and empty-page states are truthful;
- active edits invalidate preview and continuity at correct boundaries;
- historical copyedit never calls Archivist;
- destructive return names exact count/range and offers undo;
- provider failure preserves author text/direction;
- switching stories cancels or isolates stale UI work;
- keyboard, touch, screen-reader labels and 200 percent zoom pass; and
- E2E completes the full authoring loop in desktop and portrait profiles.

### Non-goals and rollback

No branching, rich page-layout editor, live coauthor cursors, or desktop-only
power layout. Feature routes can fall back to read-only while data stays valid.

## PR 12 — Chronicle

**Target:** release/4.0.0
**Depends on:** 11
**Risk:** medium-high

### Includes

- hierarchical volume/chapter/page outline;
- active-tail, prepared, continuity-coverage and art-placement markers;
- create/rename current-tail volume and chapter flows;
- historical page navigation;
- recovery-suffix list, expiry, safe restore and export fallback;
- exact structural consequences and empty states; and
- scalable virtualization/paging only if measurement proves necessary.

### Acceptance and tests

- hierarchy order matches stores and every publication fixture;
- no scene entity appears;
- 3,000-page fixture remains navigable without rendering all prose;
- rename changes no canon/state identity;
- restore availability changes honestly when head fingerprint diverges;
- expired records cannot restore;
- placed art is visible but not numbered as prose; and
- keyboard/tree semantics and portrait navigation pass.

### Non-goals and rollback

No arbitrary historical reorder, branching timeline, drag gesture as only
control, or silent recovery merging.

## PR 13 — Codex

**Target:** release/4.0.0
**Depends on:** 12
**Risk:** high

### Includes

- Foundations, Remembered canon, and Author corrections views;
- entity state, event evidence, goals, threads, arcs and coverage;
- failed/missing Archivist repair with honest cost;
- correction workflow with evidence and deterministic impact list;
- **Apply**, **Mark prose intentional**, **Return story**, and **Cancel** paths;
- template snapshot field-diff/import UI; and
- optional AI impact summary behind separate consent.

### Acceptance and tests

- no model JSON is exposed as normal UI;
- every displayed fact links to source evidence;
- correction never rewrites prose or hidden deltas;
- impacts remain warnings until author disposition;
- template import applies only selected fields;
- prepared page never appears as remembered canon;
- repair is resumable and cannot double bill one extraction result;
- long fixture filters/searches without whole-story render; and
- copy remains comprehensible before atmospheric.

### Non-goals and rollback

No autonomous continuity resolution, automatic downstream prose rewrite,
knowledge graph editor, or moral/content analysis.

## PR 14 — Gallery

**Target:** release/4.0.0
**Depends on:** 13
**Risk:** high

### Includes

- unified view of uploaded and AI-generated assets;
- equal **Paint with AI** and **Upload an image** actions;
- native picker, local preview, title, alt text and metadata notice;
- Gallery-only, before-first-page and after-page placement;
- move/unplace/delete/download;
- visible source/provider/reference provenance;
- Grok sanitation/refusal/retry UI; and
- explicit “use as provider reference” selection.

### Acceptance and tests

- uploaded cat photo/external art fixtures work without provider request;
- UI never labels subject matter as safe/unsafe;
- technical rejection names encoding/size/damage rather than content;
- placement changes no narrative count, canon, preview, or state;
- original survives provider refusal;
- refusal prompt is visible/editable and waits;
- alt-text warning appears for publication-selected art without blocking
  private Gallery use; and
- critical touch, keyboard, focus, zoom and responsive states pass.

### Non-goals and rollback

No image editor, semantic moderation, rights verification, social gallery,
automatic reference sending, or canonical information extracted from art.

## PR 15 — Publication document and core format adapters

**Target:** release/4.0.0
**Depends on:** 14
**Risk:** high

### Includes

- immutable normalized PublicationDocument and JSON Schema;
- metadata, front/back matter, volumes, chapters, paragraphs, scene breaks,
  placed-art semantics and alt text;
- one publication snapshot transaction from a chosen story revision;
- adapter interface, streaming/job lifecycle and deterministic filenames;
- DOCX, ODT, RTF, standalone HTML, Markdown, TXT and JSON adapters;
- semantic re-read tools/golden fixtures; and
- publication-specific exposure allowlist.

### Acceptance and tests

- all adapters consume the same immutable document;
- volume/chapter/page order and text are semantically identical;
- display copyedits are exported; directions/continuity/recovery/cost are not;
- art inclusion and descriptions follow owner selection;
- Unicode, punctuation, headings, scene breaks and empty chapters escape
  correctly;
- generated packages parse in automated validators;
- jobs stream or stage without loading a long novel wholesale; and
- simultaneous exports cannot observe mid-build story changes.

### Non-goals and rollback

No PDF/EPUB yet, cloud publishing, copy-protection, typesetting marketplace, or
format-specific manuscript forks. Individual adapters can be disabled while
PublicationDocument stays stable.

## PR 16 — EPUB, PDF, and Gate

**Target:** release/4.0.0
**Depends on:** 15
**Risk:** high

### Includes

- EPUB 3.3 adapter and validation;
- PDF adapter with embedded fonts, page geometry, widow/orphan awareness and
  deterministic print styling;
- Gate interface for project backup, publication preparation and shares
  placeholder;
- multi-format selection from one publication snapshot;
- publication metadata, front/back matter, art and accessibility review;
- job progress, cancellation, retry, download and cleanup; and
- representative manual-open release evidence.

### Acceptance and tests

- EPUB passes an EPUBCheck-compatible validator;
- PDF opens, extracts text in reading order, embeds/subsets required fonts and
  contains selected art;
- one multi-format job produces semantically identical books;
- long fixture exports within recorded resource budget;
- cancelling leaves no downloadable partial file or staging leak;
- Gate clearly separates full project backup from publication files;
- no provider call is needed for export; and
- portrait/desktop exposure review is readable and keyboard complete.

### Non-goals and rollback

No print-on-demand API, DRM, ISBN purchase, hosted download, or promise of
pixel-identical rendering in every reader.

## PR 17 — Immutable snapshot sharing

**Target:** release/4.0.0
**Depends on:** 16
**Risk:** critical

### Includes

- authenticated snapshot creation from PublicationDocument;
- selected art, expiry and revision summary;
- high-entropy capability tokens stored only as hashes;
- isolated read-only public renderer and assets;
- revoke, list, expire and optional replace-with-new-snapshot;
- noindex/referrer/CSP/frame/cache headers and rate limits;
- HTTPS/public-origin validation and reverse-proxy documentation; and
- Gate share UX with explicit capability warning.

### Acceptance and tests

- snapshot remains unchanged after live story edits;
- viewer makes no authenticated/private API or provider request;
- omitted private-state canaries never appear in HTML, assets, logs or cache;
- unknown/expired/revoked tokens fail closed without enumeration detail;
- raw tokens are never stored or logged;
- CSRF/owner auth protect create/revoke;
- snapshot XSS fixtures render inert;
- TLS requirement blocks unsafe public creation;
- link-view E2E works signed out; and
- revocation invalidates future reads and cached responses as documented.

### Non-goals and rollback

No discovery, search indexing, likes, comments, reader accounts, analytics,
collaboration, mutable live share, custom domains, or maintainer hosting.
Disable snapshot creation and revoke records as emergency rollback.

## PR 18 — Archive completion, hardening, and release evidence

**Target:** release/4.0.0
**Depends on:** 17
**Risk:** critical

### Includes

- complete .scribetribe v2 export/import for all 4.0 entities and selected
  private history/media;
- exposure review and explicit credential/auth/share-token exclusion;
- staged validation, collision grammar, transactional import and safety backup;
- upgrade/backup/restore/operator documentation;
- long-manuscript fixture and performance evidence;
- upload/archive/security corpus, credential/private-data canary pass;
- accessibility and visual-regression completion;
- current Chrome desktop/Mobile Chrome suite;
- reverse-proxy public-share deployment example; and
- dependency/security review and known-issues register.

### Acceptance and tests

Every gate in QA-RELEASE-GATES.md passes. A clean instance imports its own full
archive and matches semantic/database/media hashes. 3.x/future archives refuse
without writes. The reference tablet completes the manual release script. No
critical/high supported-path vulnerability or release-blocking defect remains.

### Non-goals and rollback

No migration from 3.x, archive encryption promise, non-Chrome certification,
hosted operations, or new feature. Any feature unable to meet its gate is
disabled or deferred explicitly; no waiver for data, credential, canon, or
duplicate-spend blockers.

## PR 19 — Beta release cutover

**Target:** main
**Source:** release/4.0.0
**Depends on:** 18
**Risk:** controlled release

### Includes

- freeze release branch except blocker fixes;
- update version, changelog, current README feature claims, support statement,
  SECURITY.md, legal/privacy dates, archive/schema identifiers and screenshots;
- record Node/Chrome/device/test/manual evidence;
- list clean-break installation instructions and 3.x preservation guidance;
- publish known limitations and provider-policy boundary;
- create a dedicated cutover branch from main and join the unrelated release
  history with an explicit two-parent commit whose tree equals the reviewed
  release tip;
- tag **v4.0.0-beta.1** only after CI passes on the merge commit; and
- create release notes with archive checksums where distributed artifacts
  exist.

### Acceptance

- release cutover tree equals the reviewed `release/4.0.0` tip;
- the cutover preserves historical main as its first-parent line and records
  the release tip as its other parent;
- `release/4.0.0` itself remains free of main ancestry;
- full clean-clone CI and manual critical smoke pass;
- no documentation describes a disabled/deferred feature as shipped;
- legal/privacy/security links are visible;
- 3.x data directory is never modified by 4.0 startup;
- rollback instructions restore the prior application with its untouched 3.x
  data or restore a tested 4.0 backup; and
- stakeholder records the final go decision.

### Non-goals and rollback

Do not add features during release freeze. If a blocker appears, do not tag;
fix it on a dedicated branch targeting release/4.0.0 and repeat evidence.
After tag, rollback means publish a corrective release or advise return to the
preserved 3.x installation/data—never reinterpret a 4.0 database with 3.x.

## Dependency exceptions

The queue is intentionally close to linear because schema and frontend-shell
conflicts are expensive for one maintainer. A later PR may begin design or
fixture work early, but it cannot merge before its declared dependencies.

Security tests, documentation refinements, and reusable pure publication
fixtures may be pulled forward when they do not expose half-implemented
behavior. Splitting an oversized PR is encouraged if both children retain
independent contracts and the PR-QUEUE.yaml dependencies are updated. Combining
two planned PRs requires stakeholder approval because it reduces review and
rollback isolation.
