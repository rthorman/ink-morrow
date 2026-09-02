# Project memory

Persistent notes for this project (Ink Morrow, ~/src/ink-morrow).

## Project overview

- Gothic interactive-fiction writing tool: Express backend (node:sqlite, no native builds) serves the API and the static vanilla-JS frontend on :3000
- AI via OpenRouter (key in backend/.env, see backend/.env.example); branding per InkMorrow-OpenCode-Branding/ in the repo root (frontend assets in frontend/brand/, WebP + SVG only — PNG masters stay in the package dir)
- Dev server control: `~/bin/im-server {start|stop|restart|status}` (PID-file based) — never `pkill -f` a pattern; a command line containing the plain string anywhere in its argv self-matches and kills the shell (hung the tool twice). Use the helper.

### 4.0.0 release record (shipped on `main`)

- The accepted alpha-to-beta contract and release evidence are archived at
  `docs/releases/4.0.0/README.md`. They explain how the current 4.0 line was
  built; current code, tests, and user-facing documentation define behavior.
- Product invariants in
  `docs/releases/4.0.0/WORKSHOP-DECISIONS.md` require explicit stakeholder
  approval to change. Do not silently reinterpret them during implementation.
- PRs 01–18 and the unrelated-history PR 19 cutover are completed history.
  New work branches from and targets `main`.

### 4.0 license and Git-history contract

- Project-owned material in the 4.0 release line is `AGPL-3.0-only`. Do not
  restore MIT project metadata from the historical line. Dependencies, fonts,
  and other third-party materials retain their own license metadata.
- `release/4.0.0` remains an immutable record of the decoupled release line.
  Do not rebase or rewrite it; ordinary maintenance now starts from `main`.
- The historical `main` line through 3.2.2 remains untouched and MIT-licensed.
  There is no commitment to keep a historical version hosted or distributed.
- Final integration used a dedicated cutover branch based on `main`, joined
  the unrelated histories explicitly, and preserved the release branch as an
  immutable historical record.

### 4.0 kernel contract (PR 01)

- A 4.0 database is family `ink-morrow-4`, schema version 1, with matching
  SQLite application/user versions and a checksummed migration ledger.
- Existing files are classified through a read-only connection before WAL,
  chmod, migration, FTS repair, or boot reconciliation. A 3.x database is
  refused with `DATA_DIR`/`DB_PATH` guidance and is never reinterpreted.
- Migrations are contiguous and transactional. Startup runs `quick_check` and
  `foreign_key_check`; an interrupted migration leaves the prior ledger and
  schema version intact.
- The generic operation journal permits one pending terminal transition. Boot
  changes abandoned pending rows to `interrupted`; it never invents success.
- Project archives are format `ink-morrow-project-archive`, version 2, use
  the `.inkmorrow` suffix, carry manifest/database schema identities, and
  reject 3.x and future versions during preflight before catalogue writes.
- `GET /api/capabilities` remains behind the existing auth/origin boundary and
  distinguishes the available kernel from planned release features.

### 4.0 manuscript hierarchy contract (PR 02)

- Schema version 2 activates Story -> Volume -> Chapter -> Page. Story
  creation writes Volume I and Chapter I in the same transaction.
- `pages` owns stable structural identity and scoped chapter order. During the
  PR 02/PR 03 compatibility seam, each committed `story_pages` row has the
  same opaque id as its `pages` row; prose remains in `story_pages` until
  immutable revisions land.
- New volumes are appended at the active tail with an empty Chapter I. New
  chapters may be appended only to the active volume. Historical volumes and
  chapters may be renamed, but only empty active-tail structure may be
  deleted, and every story/volume retains at least one child container.
- Story reads expose the ordered hierarchy; stable page reads use
  `GET /api/stories/:storyId/pages/:pageId` and return hierarchy position plus
  indexed previous/next identities. Scene breaks remain prose, never rows.
- Archive v2 story aggregates carry flat volume/chapter/page hierarchy arrays
  in addition to temporary compatibility pages. Copy import remaps all three
  identity levels. A schema-1 4.0 kernel archive has no hierarchy choices and
  is upgraded on import to the accepted Volume I / Chapter I default.

### 4.0 revisions and recovery contract (PR 03)

- Schema version 3 makes page revisions immutable and gives each page
  page-owned canonical and display pointers. An active-tail substantive edit
  advances both pointers and invalidates derived continuity; a historical
  copyedit advances only display prose and keeps canonical evidence and
  continuity intact.
- Every initial page, tail edit, copyedit, direct deletion, truncation, and
  restore records a terminal operation-journal entry. Idempotency keys replay
  the original result instead of repeating canon mutations.
- Truncation captures the exact suffix, hierarchy placement, revisions, and
  private page state in one transaction. Its one-use undo token lasts ten
  minutes; a fingerprint-safe restore remains available for 30 days by
  default. Changed surviving canon refuses restore and offers JSON export
  rather than attempting a merge.
- Expiry scrubs the private recovery payload and removes only media owned by
  the expired suffix. It never deletes or rewrites active canon.
- Archive v2 story aggregates always carry revision ancestry and
  canonical/display pointers. Direction, model, token, and cost provenance
  remains optional working history. Recovery suffixes and undo credentials
  never enter portable archives.

### 4.0 provider and vault contract (PR 04)

- Schema version 4 stores OpenAI-compatible provider profiles separately from
  the logical Scribe, Archivist, and Narrator assignments. A stored model
  choice is never silently replaced when catalogue discovery no longer finds
  it; the role becomes explicitly unavailable until the owner repairs it.
- The built-in OpenRouter environment credential is read-only. UI-submitted
  credentials are either process-session memory or AES-256-GCM vault entries;
  plaintext keys never enter profile rows, API responses, logs, archives,
  recovery payloads, snapshots, or browser persistence.
- The vault uses a random data-encryption key. The owner passphrase derives a
  separately salted and purpose-labelled wrapping key; password changes rewrap
  the data key without re-encrypting entries. Ciphertext, nonces, and tags are
  stored in the non-exported provider-vault tables and every secret reference
  is profile-owned.
- Explicit login unlocks an existing vault. A remembered browser session after
  process restart can still use manual features but saved-provider operations
  fail closed until passphrase re-entry. Logout, final session expiry, process
  disposal, and terminal reset remove plaintext access; terminal reset deletes
  saved credentials while preserving manuscripts and media.
- Provider/cost exposure descriptions name the logical role, profile, model,
  data categories, references, operation count, and estimate without exposing
  credentials. Catalogue, Library, and manual-writing work performs no
  provider call.

### 4.0 continuity ledger contract (PR 05)

- Schema version 5 binds one strict, versioned continuity delta to each
  immutable canonical page revision. Display-only copyedits retain the
  canonical delta; tail replacement creates a new revision/delta boundary;
  prepared prose never has continuity.
- Archivist schema 2 rejects unknown or malformed fields locally and requires
  direct page quotations for durable events, character state, world facts,
  goals, threads, and arc movement. Schema-1 archive rows remain readable.
- The Archivist role is server-owned: browser-local Scribe selection never
  enters automatic extraction or Codex repair. An explicit `CONTINUITY_MODEL`
  overrides a persisted Archivist assignment and must pass live OpenRouter
  catalogue validation before the server listens; invalid or unverifiable
  values fail startup.
- Extraction uses a compact tier-ordered cast index and at most 24 detailed
  cast states. A centered manuscript always reserves its MC as perspective
  anchor, then includes page-named cast and fills by Supporting/Background
  priority. Other accumulated state sections have independent size caps.
- Current state folds only current canonical revisions in manuscript order.
  Sparse 50-page plus head checkpoints, bounded inspection history, and
  revision-keyed FTS/LIKE rows keep prompt retrieval independent of full
  manuscript length. Every derived projection is AI-free and rebuildable.
- Character templates freeze into story-local snapshots. World fields remain
  canonical/live until explicitly accepted or edited in Codex; only those
  selected fields become manuscript-local. Every import/edit appends a local
  snapshot without changing the Library template.
- Author corrections are separate authoritative rows with optional revision
  evidence. Deterministic impact analysis records later possible conflicts as
  issues and never edits prose or extracted evidence.
- Author canon uses stable entries plus immutable, append-only revisions for
  world events/facts, character facts, relationships, goals, threads, story
  rules, and custom truths. Active author canon outranks extracted memory in
  future writing; edit/retire invalidates prepared work and never rewrites
  prose, extracted deltas, or corrections.
- Portable story archives carry template snapshots, revision deltas, and
  corrections plus every author-canon revision. Copy import remaps all world,
  character, page, author-canon, and revision
  references; search, checkpoints, and issues are rebuilt rather than
  exported. Full behavior: `docs/continuity-ledger.md`.

### 4.0 Codex contract (PR 13)

- Codex is the only author-facing home for editable story-local foundations,
  page-provenanced remembered canon, versioned author canon, and corrections. It consumes bounded
  continuity projections and never downloads the manuscript as a second
  reader; evidence links route to the exact Desk page.
- Remembered facts expose their canonical revision quotation and page.
  Prepared prose has no revision and is absent. Missing/failed repair is
  sequential, paid-review gated, resumable, and joins the revision-keyed
  extraction job instead of purchasing a duplicate result.
- Chronicle failure markers are actionable: their dialog exposes the safe
  stored error code, reason, and actual Archivist model, confirms prose is
  intact, and routes to Codex repair.
- Applying a correction writes a separate authoritative row. Deterministic
  later matches remain warnings until the author acknowledges intentional
  prose, returns to the Desk page, or marks review resolved. No path rewrites
  prose, extracted deltas, or unseen state.
- Authors can create, revise, and retire explicit canon without first finding
  an extracted fact to correct. Edits append immutable revisions. Manuscript
  rename is available in Codex and Library and preserves every identity.
- Library template updates are field-level diffs; only checked fields enter a
  new story-local snapshot. Optional AI impact summaries use separate paid
  consent, receive bounded warning metadata without prose, and cannot apply
  changes. Full behavior: `docs/codex.md`.

### 4.0 Gallery contract (PR 14)

- Gallery is the one owner-facing collection for uploaded and AI-generated
  art. Upload and Paint with AI are equal entry paths; local upload performs
  technical validation and normalization without semantic moderation or any
  provider call.
- Assets and placements remain separate. Gallery-only, before-first, and
  after-stable-page placement changes never renumber prose, alter revisions,
  continuity, prepared work, or canon. Delete removes the asset and its
  placements; unplace keeps the normalized asset.
- Provider-reference permission belongs to one local asset and selection for
  the next painting is a second explicit action. Only ready, permitted,
  explicitly selected IDs cross the provider boundary; imports reset consent.
- Grok refusal remains announce-and-wait: the reason and editable replacement
  are visible, originals remain unchanged, and retry requires a new action.
  Placed art without alt text receives a publication warning but private
  Gallery use remains available. Full behavior: `docs/gallery.md`.

### 4.0 transactional writing contract (PR 06)

- Schema version 6 activates durable `requested` / `running` / `succeeded` /
  `committed` / `failed` / `superseded` writing operations. Story-scoped
  idempotency keys replay one result and reject different input.
- A short expiring writer lease covers story and canon mutations. Provider
  replies recheck the exact lease and a context fingerprint containing the
  manuscript destination, tail canonical/display revisions, story settings,
  template snapshots, folded-state evidence version, and generation settings.
- One restart-safe prepared page may exist per story. **Use prepared page**
  promotes only its opaque identity and never falls back to live generation.
  Confirmed directed work consumes it before making one Scribe request;
  typing, clearing, cancelling review, or provider failure cannot commit it.
- No partial stream is canonical. Late, reordered, cancelled, context-stale,
  or lease-lost replies record known provider usage/spend but cannot mutate
  pages. Restart marks abandoned work failed and preserves completed prepared
  prose.
- Canonical prose commits before optional Archivist completion, creates one
  pending revision delta, and schedules exactly one server-owned successor.
  Speculative spend, current prepared spend, and committed story totals remain
  distinct.
- Working-history archives carry redacted operation rows and the prepared
  page, never writer-session or lease identities. Import remaps references and
  rebinds the prepared page to its imported context. Full behavior:
  `docs/writing-transactions.md`.

### 4.0 noncanonical art contract (PR 07)

- Schema version 7 activates story-owned `assets` and `asset_placements`.
  Uploaded and AI-generated art is never a narrative page: placement uses a
  stable prose page ID plus local ordinal, or `NULL` before the first page.
- Upload is streamed into private staging, capped at 20 MB and 40 megapixels,
  signature/container checked, decoded fail-closed, orientation-normalized,
  animation-flattened, metadata-stripped, and stored under a random name as a
  WebP derivative. Active SVG and trailing/polyglot inputs are rejected.
- Upload applies no semantic classification, calls no provider, and records
  zero spend. An uploaded asset may enter provider input only when its ID is
  explicitly selected and its per-asset reference permission is enabled.
- Placement, movement, unplacement, page deletion, and truncation never
  renumber art as prose or change continuity. Lost anchors unplace art while
  retaining the asset. Art creation does not invalidate prepared prose.
- Same-version archives carry ready art, placements, and normalized media but
  never storage keys or provider-reference consent. Copy import remaps asset
  and placement identities and assigns fresh storage names.
- The old image-page compatibility route now creates an AI-generated asset
  after the selected prose page. EPUB embeds placed art beside its anchor
  without adding a spine page. Full behavior: `docs/art-assets.md`.

### 4.0 Grok sanitation contract (PR 08)

- Grok refusal behavior lives in `imagery/provider-adapters.js`; only a Grok
  image model treats its HTTP 400 contract as a refusal eligible for
  sanitation. Non-Grok client errors never inherit Grok wording or trigger a
  sanitation call.
- Grok prompt condensation adds its visible renderable-by-design instruction.
  A refusal makes exactly one sanitation-model call, returns the bounded
  provider reason, editable replacement, model, billed attempts, exact cost,
  and reference count, and never starts another image request.
- The client keeps that prompt and cost visible and waits for another paid
  press. Two consecutive refusals with attached references reveal an unchecked
  reference-free option; only the author's explicit selection sends
  `drop_references: true`.
- Story/reference changes, a fresh condensation, and successful generation
  reset refusal state. Reference-free requests never mutate original asset
  bytes, metadata, placement, or consent. Full behavior:
  `docs/grok-sanitization.md`.
- This contract supersedes older notes that automatically dropped portraits
  after a second refusal.

### 4.0 adaptive shell contract (PR 09)

- Library is the global threshold. Manuscripts, world templates, character
  templates, import/recovery, and Settings remain global concerns; they are
  not additional manuscript workspace destinations.
- Every manuscript uses exactly five stable destination names: Desk,
  Chronicle, Codex, Gallery, and Gate. The vocabulary does not change with
  viewport size. Compact and portrait layouts use a labelled bottom bar;
  landscape tablet and desktop layouts use a labelled navigation rail.
- Desk remains reachable without a manuscript so manual creation can begin.
  The other four destinations require a selected manuscript and expose honest
  holding surfaces until their implementation PRs land.
- Canonical hashes are `#/library`, `#/desk`, and story-scoped workspace
  hashes. Historical `#/home` and `#/write` hashes resolve as compatibility
  aliases and never create duplicate navigation surfaces.
- The authentication gate hides the manuscript switcher, workspace navigation,
  global navigation, private surfaces, and storage state before unlock and
  after lock. No selected manuscript may survive that transition.
- Running prose uses the quiet opaque manuscript surface even when optional
  Scriptorium art is enabled around the Desk. Focus rings, reduced motion,
  44-pixel targets, reflow, and keyboard operation remain token-level shell
  guarantees. Full behavior: `docs/adaptive-shell.md`.

### 4.0 PR 10 — Library manuscript start contract

- Library owns the canonical manuscript creator. **Begin a manuscript**,
  **Import**, the empty catalogue, and Desk **New manuscript** all open the same
  sheet; there is no second Desk creation form.
- The dark workspace has three stages (Beginning, World & cast, Intent &
  review) and three mutually exclusive paths: a local manual opening, a
  seed carried to the Desk direction, and local prose import. Every path creates
  the valid Volume I / Chapter I hierarchy supplied by the story service.
- Closing saves the uncreated draft and current stage in session storage. A
  successful start clears it. The provider key field is never persisted by the
  browser.
- Manual and import paths must not read provider setup or make an AI request.
  Provider setup appears only after the author explicitly asks for an AI
  Foundations draft; the paid review precedes that draft request.
- Foundations remain optional working direction. Suggestions are bounded JSON
  and must be accepted field by field; they never mutate global world or
  character templates.
- Available characters render as a bulk roster with direct role and relation
  controls. Cover painting begins only after creation from Gallery.
- Markdown import maps headings to chapters and otherwise keeps prose in one
  chapter. It rejects oversized input before mutation and does not discard
  non-heading text. Full behavior: `docs/library-start.md`.

### 4.0 PR 11 — Desk contract

- The Desk consumes the PR 06 state machine without inventing another write
  path. Prepared promotion uses its opaque identity; directed work invalidates
  prepared prose only after consent; failed or stale provider replies preserve
  the author's direction and cannot paint another manuscript.
- The active-tail page exposes a prose editor. Debounced autosave writes a new
  canonical revision, names saving/saved/offline/error/conflict states, and
  invalidates the prepared successor at the same successful boundary. Failed
  and conflicting saves retain an isolated in-session draft.
- Earlier pages remain outside canonical editing. Their editor calls only the
  display-copyedit endpoint, says that canon and Archivist facts are unchanged,
  and makes no provider request.
- **Return manuscript to this page** names the exact removed count and range. The
  result exposes the brief one-click undo token and the longer recovery expiry;
  art is unplaced rather than renumbered into prose.
- Page brackets, Ctrl/Cmd+Enter, labelled 44-pixel controls, 200 percent reflow,
  a collapsible reading/media tool sheet, and the portrait sticky composer are
  part of the Desk contract. Full behavior: `docs/desk.md`.

### 4.0 ownership and ensemble cleanup contract

- The global shell control is the only manuscript selector. Desk shows the
  active context and **New manuscript**, but never maintains a second selector
  or a parallel current-manuscript state.
- Library's asset dialog owns EPUB, cover, audiobook, and stored art. It may
  summarize or link to remembered canon, but Codex is the only author-facing
  surface that reads, repairs, rebuilds, or corrects continuity.
- Gallery is the only owner-facing upload/paint/metadata/placement workflow.
  Desk may route to Gallery, but does not implement a reduced upload or paint
  path of its own.
- A cast with no `mc` is a real ensemble throughout generation, cover
  composition, continuity labels, and editing. Prompts must not invent a
  protagonist or instruct visual/narrative priority for an absent lead. The
  legacy `relationship_to_mc` storage key remains archive-compatible but is
  presented as a general connection/story note when no lead exists.
- User-facing managed objects are called **manuscripts**. Historical `story`
  API routes, database fields, compatibility aliases, and ordinary narrative
  prose may retain the backend/domain term.
- `chooseWorkspaceStory` is the one state transition used by Chronicle,
  Codex, Gallery, and Gate; room-local copies are forbidden.

### 4.0 PR 12 - Chronicle contract

- Chronicle reads the publication hierarchy through one bounded metadata
  response. Page prose is limited to a 240-character display excerpt and the
  client renders at most 80 page rows per chapter window, including for the
  3,000-page fixture.
- Volume, chapter, and page order is server order. The UI offers no reorder or
  scene entity; scene-break text may appear only inside a page excerpt.
- Every page may name active-tail, continuity coverage, display-copyedit, and
  placed-art status. Prepared prose is one manuscript-level marker and never a
  canonical page row.
- New volumes and chapters begin only at the active tail. Renames preserve
  stable structure/page identities and canon; only empty active-tail structure
  exposes removal controls with exact consequences.
- Recovery safety is server-derived from the current chain fingerprint. Only a
  `safe` record enables restore. Diverged, restored, and expired records remain
  honest and offer JSON export rather than a silent merge. Full behavior:
  `docs/chronicle.md`.

## Testing

- SETUP SAFETY: `bash setup.sh` updates an existing backend dependency tree in
  place and uses exact `npm ci` only when that tree is absent. `--dev` applies
  the same policy to the root, frontend, and e2e packages. Only explicit
  `--clean` may replace selected `node_modules`; it lists every absolute target
  first and refuses symlinks. Never restore implicit clean installs.
- Lint: `npm run lint` at the repo root (ESLint 9 flat config in eslint.config.js, installed at the ROOT, invoked via `node node_modules/eslint/bin/eslint.js` — never .bin shebangs on Termux). Config: backend = node/commonjs, frontend/app/** = ESM browser+node dual-world, frontend/tests = ESM + jest globals, e2e/tests = ESM + browser globals (page.evaluate callbacks run in the page). no-unused-vars is tuned (args/caughtErrors none) — express signatures and commented catches are the house style. `npm test` runs lint first; CI has a dedicated lint job gating the Jest job.
- Reply quality guards (backend/src/quality.js, wired into ai.js chatCompletion via `quality` opt): providers happily "succeed" with empty, clearly-truncated, or wrong-language text. checkReply = 'empty' (whitespace/prose-less; terse-but-finished is NOT this) | 'truncated' (prose, after stripping the <<<CHARACTER_STATE>>> block, doesn't end in [.!?…"'”’)] — em-dash/hyphen endings count as cuts — or below minWords) | 'language' (ENGLISH_STOPWORDS ratio: only fires when the user's own material (last user message) is confidently English (ratio ≥ 0.15) AND the reply is confidently not (< 0.02, or < 0.05 with ≥ 30% foreign-script letters) — a user writing French is never second-guessed; tokens must be /\p{L}'+/ Unicode or 'forêt' splinters into 'for' and poisons the ratio — LIVE-VERIFIED BUG). Bad replies retry (a language slip first appends a 'reply in English only' system message once); if the last attempt still fails → 502 with an honest message, NOTHING is saved (garbage never enters story_pages). pageQuality(wordTarget): minWords = quarter of the EXPLICIT words target (floor 15) — target-less (legacy) requests skip the floor (mocked tests & old clients send terse pages; truncation-shape/language still apply). quality: {minWords:30} on image-prompt condense, {minWords:20} on Grok sanitation; drafts are exempt (their strict-JSON parse failure is its own graceful retry path)
- Backend: `cd backend && node node_modules/jest/bin/jest.js` (jest via direct node — npm .bin shebangs fail on Termux)
- Frontend: `cd frontend && node --experimental-vm-modules node_modules/jest/bin/jest.js` (native ESM suite; plain `npm test` also works — the flag lives in the npm script). Tests import `jest` from '@jest/globals' explicitly (ESM Jest does not inject the global into imported modules) and load fresh app boots via `loadScript()` in tests/dom-helpers.js, which cache-busts the bootstrap with a query string (`import('../app/bootstrap.js?run=N')`). Each boot marks a liveness token (`window.__imLiveBoot`); routers of superseded boots are dead. Shared jsdom quieting in tests/setup.js stubs HTMLMediaElement play/pause/load + window.confirm + window.scrollTo (jsdom ships a scrollTo that only logs Not-implemented). tests/dom-helpers.js adds paidReview('confirm'/'cancel'); after remembered consent, confirm correctly observes the deliberate review bypass.
- If the current coding environment has no working Chromium, do NOT install or download one as part of verification. Run lint + backend/frontend Jest locally and leave Playwright to the existing CI/browser-capable environment.
- E2E (Playwright): `cd e2e && node sweep-e2e-server.cjs && node run-playwright.cjs test --project=chromium` then sweep again + `--project="Mobile Chrome"` — each project in its OWN invocation (one webServer spans a single invocation; sharing it leaks data between projects as duplicates); sweep before every invocation to clear orphans of aborted runs (the e2e npm test chain does this for you)

### E2E on Termux quirks

- Never patch installed Playwright files. `e2e/run-playwright.cjs` sets the Android-only browser-path override before Playwright loads, preserving the native Chromium workflow across every dependency install.
- Use system chromium via executablePath /data/data/com.termux/files/usr/bin/chromium-browser (`pkg install x11-repo chromium`); never `npx playwright` (.bin shebangs)
- An ABORTED e2e run (Ctrl-C, tool timeout) orphans its webServer (`node server.js`), which blocks the next invocation's port or serves stale data. Run `node sweep-e2e-server.cjs` before each project invocation (the e2e npm scripts do this automatically); the sweeper matches bare-argv `server.js` + NODE_ENV=e2e only — the dev server's full-path argv can never match. Playwright port-checks BEFORE any hook runs, so no in-playwright fix is possible; the orphan must be swept pre-CLI
- Suite speed is NOT a bug: ~3.5s per-test floor (browser context spawn on this tablet) × 38 chromium tests; the responsive viewport matrix runs in the chromium project ONLY (its contexts cover phone/tablet sizes; the npm test chain sweeps between projects). Mobile Chrome project runs the 29 non-matrix tests. When piping runs through `tail`, output is invisible until the phase ends — a running phase looks like a hang; prefer unpiped or grep-based output
- Isolation: e2e runs on port 3100, reuseExistingServer:false, env inlined in the webServer command (DB_PATH=":memory:" PORT="3100" …) — verified it creates nothing in database/ink-morrow.db. Never point e2e at 3000; the dev server there uses the real DB. If a leak is ever suspected, fixture names to hunt: 'Context Realm', 'Sir Context', 'Generation/Retry/Error/Export/Burn Test'

## Architecture notes

- Stories carry a tiered cast as [{id, role, relation, state}] in stories.characters: role mc|supporting|background (one MC MAX, server-enforced; MC is OPTIONAL — zero MC = ensemble), relation = free-text tie/start note, and state = EXPLICIT AUTHOR OVERRIDES only (personality/appearance/relationship_to_mc). AI evolution never mutates this JSON. `story_character_snapshots` freezes name/description/personality/appearance/background the first time a character joins a story; catalogue edits do not rewrite an existing cast. Legacy <<<CHARACTER_STATE>>> tails are stripped from prose defensively but ignored as state. Legacy plain-id casts remain rejected. Frontend creation still declares Centered/Ensemble; the cast editor handles roles/relations and clearly labels manual overrides as stronger than snapshot + ledger continuity.
- CONTINUITY LEDGER COMPATIBILITY PROJECTION (v3.1.0, superseded by PR 05 above): `story_memory_pages`, `story_memory_search`, and `stories.continuity_overrides` remain mirrored for existing clients and schema-1 archives. Authoritative 4.0 provenance lives in `continuity_deltas`, `template_snapshots`, and `continuity_corrections`; projections/search are locally rebuildable. Existing/manual pages are never automatically backfilled (surprise spend); repair remains sequential. New generated/committed pages auto-extract unless ordinary Jest silences it (`ENABLE_CONTINUITY_EXTRACTION=1` opts dedicated tests in).
- COMMITTED-PAGE TRANSACTION BOUNDARY (v3.2.2): previews never extract, fold, or index anything. Prepared commit saves the identified prose and returns it BEFORE continuity finishes; the server starts one background extraction and an immediate client sync joins the same per-page promise for cost reporting. Regeneration generates against a projection that excludes the old last page while old prose+delta remain intact; only successful prose atomically replaces content/usage, invalidates old memory and resets its continuity cost, after which replacement extraction runs. Extraction failure never invalidates a valid page: memory becomes failed and retryable. Deletion/truncation cascades page deltas and the next local fold deterministically reverts their state; no AI rollback call. Character/world-sheet future intentions are reference motivations, never page instructions or completed events. Prompts contain recent verbatim pages + compact folded state + bounded relevant older FTS memories; no embeddings/vector DB/local model/whole-story replay, preserving low-end-device performance.
- Per-page AI accounting: model, prompt/completion tokens, cost_usd on story_pages; stories expose total_cost_usd; frontend settings (localStorage im-settings): model picker (GET /api/models proxy marks the server default and exposes `reasoning_efforts`, `reasoning_default`, and `reasoning_mandatory`; the UI resolves the explicit selection OR server default, renders only that model's declared subset of none|minimal|low|medium|high|xhigh|max, and sends it as `reasoning_effort` on generate/regenerate/preview), words per page (50–2000, scales max_tokens), story font + text size, scriptorium writing background, cost ticker (default on), narration model/voice pickers with ≈per-page cost labels
- PAID-CONSENT CONTRACT (v3.0.4, superseding the repeated v3.0.1 reviews): the FIRST accepted `dialogs.confirmPaid` review stores `im-paid-consent-v1=1` in localStorage (session fallback when storage is blocked). Every later paid boundary resolves true without opening a modal, including after reload; a disabled action never bypasses. Cancel/Escape/backdrop stores nothing, sends zero paid requests, and preserves input. The first review uses core/cost.js structured rows (action/object/model/quantity/sends/also/estimate) and explains the permanent-on-device effect. Catalogue pricing drives estimates when present; otherwise use conservative numeric ballparks (`$0.02` per text call, `$0.05` per narration page), NEVER “unknown,” “unavailable,” or fake `$0.00`. Each feature keeps its `reviewing` flag against double submission; no paid POST is auto-retried.
- PAID-RETRY ACCOUNTING (v3.1.0): `chatCompletion` records every successful provider completion before local quality validation, accumulates usage/cost across accepted retries, and adds `{billed_attempts,cost_usd}` to final API errors when rejected attempts incurred known spend. Page write/rewrite reviews cover authoring + one continuity extraction + successor preview (normal three calls; authoring ceiling three attempts each, extraction one correction). Prepared commit prices continuity + successor because preview prose was already spent. `story_pages.continuity_*` records extraction model/usage/cost and `total_cost_usd` sums prose + continuity. A rewrite adds the FULL new persisted prose+continuity spend to Session while Story applies only the old→new persisted delta. Image-prompt condensation still returns/books its writing-model cost.
- SPECULATIVE PREVIEW CONTRACT (v3.2.2): `story_previews` holds one restart-safe, single-use successor per story. GET preview returns metadata only; POST returns an opaque content identity. `expected_page`, a context revision, newest-attempt ownership, a post-provider page check, and the commit identity collectively prevent old requests or tabs from overwriting/committing the wrong prose. Frontend preview/action/load tokens prevent late replies from mutating another story. Passive selection performs only the free GET; a paid POST follows every successful live write, rewrite, and prepared commit. The empty-direction control is disabled and labelled while preparation is in flight; a direction may explicitly supersede it only after consent. Cancel preserves it. Preview prose cost enters Session immediately and joins Story when committed.
- SPECULATIVE FAILURE RULE (v3.2.2): a successful prepared commit displays its existing prose without waiting for continuity, then always starts exactly ONE disclosed successor preview. The green path never calls `/pages/generate`, including after 404/409/network failure; it reconciles free page/preview reads instead. Live writes and rewrites snapshot next-page/tail identity + the same context revision before the provider call and return a billed 409 without saving if another tab/action changes the story. A failed or superseded live write/rewrite starts no successor. A late preview response can never alter DB/UI state, but known provider spend still counts in Session because staleness does not refund work.
- AI drafts: POST /api/ai/world + /api/ai/character (seeds → short/medium/long JSON drafts, variant counter for regenerate)
- Old pages are read-only; writing happens on the last page; "delete everything after this page" truncates via DELETE /api/stories/:id/pages?after=N with the shared destructive dialog (app/core/dialogs.js confirmDestructive: exact count + range + consequence, price-free). SINGLE-PAGE DELETE RENUMBERS (v3.0.1): store.deletePage deletes the row + decrements every later page one-by-one (page_number ASC) inside ONE transaction, invalidates the preview, and bumps updated_at — numbering is always contiguous 1..N, surviving page IDs keep their identity (plate files are keyed by page ID), and only the deleted page's plate file is unlinked. The frontend reader lands on an existing page after any delete
- One-click EPUB export uses the same validated PublicationDocument adapter as Gate (`backend/src/modules/publication/`); placed art embeds beside its prose anchor with alt text from asset metadata. A missing derivative fails honestly rather than producing a broken book.
- PORTABLE ARCHIVE CONTRACT (4.0 kernel, carrying forward the v3.2 transfer behavior): `.inkmorrow` ZIP container, format id `ink-morrow-project-archive`, version 2, manifest schema 1, and source database family/version; ordinary manifest + JSON aggregates + optional media, never raw SQLite. Character export includes its home world; world export includes an explicit resident subset; story export always includes story world/current cast/cast home worlds/pages/revisions/story-local templates/ready revision continuity/corrections/immutable publication snapshots; full includes all entities plus sanitized `im-settings`. Share records/capabilities and recovery suffixes/undo credentials are local-only and never travel. Visuals, audio, and working history are explicit (full defaults on; entity portability defaults audio/history off); audio is always shown as a choice. Working history = directions, preview, image prompts, replaced-revision deltas, model/token/cost/error traces; ready current continuity is functional and always included. API keys/credentials/passwords/paid consent never travel; archives remain unencrypted (the access password is separate and never travels). Export plan returns exposure + token, then GET streams ZIP; media is uncompressed and never read wholesale into JS memory. Import uploads via busboy to `database/transfers/{uploads,staging}`, yauzl validates traversal/backslashes/symlinks/duplicates/undeclared paths/entry+expanded limits/ratio/media/id safety and SHA-256 before any catalogue write. The preflight refuses v1/3.x, unknown-family, and future versions. Collision grammar: new=add, same-name=warn, identical data+included media=reuse, same-id divergent=copy recommended plus keep/replace; no field merge and no story page splice. Copy remaps world/character/story/page/revision ids through cast, snapshots, corrections, deltas and media. Commit stages sibling files + rollback moves and uses one SQLite transaction. Full replace first writes a persistent full safety archive under `database/transfers/backups`. Derived continuity search/FTS/checkpoints/issues are rebuilt, never exported. No AI/provider call occurs. Full spec: docs/portable-archives.md.
- SECURITY CONTRACT (v3.2.1): one local owner, no username/roles/MFA/email. Before setup, `/api/auth/status` and setup/login are the only usable API surface; the gate fails closed and no private catalogue/route/disk/model call starts. First-run requires the random terminal code plus a 15–128 Unicode-character password. Passwords are NFC-normalized and asynchronously scrypt-hashed with a per-owner random salt (production N=2^15,r=8,p=3); only an opaque session token's SHA-256 digest is stored. Cookie = HttpOnly + SameSite=Strict (+ Secure under HTTPS); remembered sessions idle 7d/absolute 30d, unremembered idle 8h/absolute 24h. Every protected mutation requires the in-memory per-session CSRF token and same-origin request; Host validation limits DNS rebinding. Setup/login use bounded in-memory progressive delay/10 attempts per 15m (restart clears attempts, never permanent lockout). Lock revokes one session; password change revokes all others; `npm run auth:reset -- --yes` deletes only owner/sessions. Auth runs before JSON parsing; ordinary bodies 256KiB, image-page 12MiB. Default bind is 127.0.0.1; direct non-loopback HTTP requires `ALLOW_INSECURE_LAN=1`; loopback HTTPS proxies use `ALLOWED_HOSTS` + `TRUST_PROXY=1`. Database/media remain unencrypted at rest and portable archives remain unencrypted/exclude auth. No security background poll; session touches/cleanup are throttled. Full boundary: SECURITY.md.
- HISTORICAL 3.x IMAGE-PAGE CONTRACT: superseded on `release/4.0.0` by the PR 07 noncanonical art contract above. The compatibility `image-page` route now creates and places an AI-generated asset; it never inserts a prose row, renumbers pages, invalidates prepared prose, or enters continuity.
- Low-storage banner (GET /api/disk = statfsSync on imageDir → {free_bytes,total_bytes}, nulls on failure): #diskBanner under the nav shows on EVERY section when free < 1GB or < 5% of the volume (< 250MB escalates to "almost full"), re-checked every 30s and right after each plate binding; hidden on nulls/server-down, keeps last state on error. Jest drives updateDiskBanner/checkDiskSpace directly — initDiskBanner skips its setInterval under JEST_WORKER_ID so tests hold no timers. NOTE: e2e/tests/app.e2e.test.js had a PRE-EXISTING stray `});` at old line 179 that closed its test.describe early (later tests ran as top-level tests, so Playwright never complained); fixed 2026-08-30 — new tests must live INSIDE the describe
- Audiobooks (schema v7, audiobooks TABLE keyed story_id, bytes at database/audio/<story-id>.mp3 + .mp3.tmp during jobs): whole-tale mp3 read by ONE GLOBAL sequential queue (decided: no parallelism on low-end devices; audiobookCurrent/audiobookQueue/audiobookCancel in app.js). Job narrates narrative prose pages in order; noncanonical art never contributes speech or page count. It reuses the narrationCache keyed sha256(text)+model+voice (unchanged pages free — cache hits make the job fully synchronous, finishing before the 201 lands), appends via writeAll to the tmp file, and renames on done; costs from fetchGenerationCost per segment (best-effort), duration = words/2.5. Cancel checks between pages AND after collecting a page's streams (mid-page). POST validates against the speech catalogue and REJECTS pcm narrators (catalogue entries carry pcm:/gemini/i since 2026-08-30) — audiobooks are mp3-only by design. GET row gains stale (fingerprint = sha256(model+voice+page ids+contents) mismatch), queue_position (0 = reading now), file_missing grace. Boot marks pending rows failed ('Interrupted…'). Story delete cancels+unlinks; DELETE /api/stories/:id/audiobook removes row+file. Frontend: #audiobookBtn beside Export opens a modal (narrator verdict + estimates = pages/words math shared with Settings labels: 150 wpm, ~6KB/s mp3, chars×prompt_per_mchar + words×20×completion_per_mtok), explicit #audiobookStartBtn carrying the price (Create audiobook (≈$…); disabled when unusable/pending/empty, reason in text), then #audiobookBanner (write section, below pastPageBar): pending = text + progress bar + Stop; ready = Download link + Hide (MIDDLE-GROUND visibility: shows once per completed reading — localStorage im-ab-seen:<story>:<updated_at>, Hide marks it; pending always shows; failed shows error + retry). Cost ticked once per reading (chargedAudiobooks Set keyed story@updated_at) + checkDiskSpace on ready. Poll every 2s (skipped under JEST_WORKER_ID)
- LIBRARY ASSET CONTRACT (v3.0.5, updated by the manuscript-workspace follow-up): there is NO duplicate top-level Manuscripts destination or duplicate creation form. Library retains its route-backed Manuscripts/Bookshelf tabs and owns the canonical staged creator, including maturity and the full Centered/Ensemble cast roster. Desk #storyNewBtn routes to it. Cover painting is a separate, reviewed post-create Gallery action. Library → Manuscripts cards show a 2:3 cover or honest status placeholder, first prose excerpt, world/maturity/page context, and measured media bytes from GET /api/storage. Clicking a card opens #storyAssetsModal with manuscript EPUB, cover, audiobook, and art downloads plus an explicit route to Codex; continuity inspection, repair, rebuild, and author canon never render in this asset modal. Deleting art removes the asset and placements while prose numbering and prepared writing remain unchanged, then refreshes the open reader's art only. Bookshelf remains the all-manuscript audiovisual aggregate. Cover bytes live in database/images/covers/<story-id>.<ext>; GET/POST/DELETE /api/stories/:id/cover fetches or downloads / explicitly queues repaint / removes only the cover. Old manuscripts are never auto-painted on boot because that would create surprise spend. Manuscript deletion unlinks cover, art, and audio. GET /api/storage returns excerpt, cover metadata, asset_count, and real disk_bytes in addition to audio and art placements.
- Narration (implemented per INKMORROW-STREAMING-TTS-IMPLEMENTATION.md, extended 2026-08-29): mp3 pass-through streaming (axios responseType:'stream' -> express pipe, upstream aborted via res.on('close')); pages are SEGMENTED at sentence boundaries (1800 chars; providers cap input — Deepgram 413s, Orpheus/Sesame 400 long text) and pieces stream back-to-back with bisect-retry on provider 400/413; pcm-only narrators (Gemini TTS) detected from the provider refusal and retried as pcm, delivered as one WAV (24kHz 16-bit mono header, not streamed); X-Generation-Id carries comma-joined segment ids; in-memory audio cache keyed sha256(text)+model+voice (replays never re-bill, entries ≤8MB); authoritative cost via GET /generation summed per id in /api/ai/generation-cost (server-cached per id); client bills once per joined id (Set guard); pages >16k chars → 413; CSP includes media-src 'self' blob:
- Speech catalogue (GET /api/speech-models) exposes TTS pricing {prompt_per_mchar, completion_per_mtok}; Settings narrator picker labels each model with ≈cost per page (chars = wordsPerPage×6.5, audio tokens ≈ words×20 — calibrated against a real Gemini bill), refreshed when words-per-page changes; Grok/MAI/Qwen/Kokoro/Voxtral take mp3 at page length, Gemini is slow (60s+/page) and priciest (~$0.12/page)
- Scene images: the current 4.0 behavior is defined by the PR 08 Grok sanitation contract above and `docs/grok-sanitization.md`. The legacy viewer, render-quality, entity-image queue, storage, and cost behavior remains, but provider refusal recovery is adapter-scoped, announce-and-wait, and reference dropping is always explicit.
- Entity editors (click a card; its buttons keep their own jobs): plain fields, NO AI assists; character sheet + image_prompt (editable blurb sent to the image generator, empty = auto-composed; honored by the redo queue); world name/genre/setting/lore + image_prompt. World LOREBOOK (schema v5, lore column, max 20k) is deliberately OUT of the creation form; it is honored by page generation, scene-image condensing, and world image prompts. WORLDS ARE CANONICAL/live for future pages. Characters are frozen into `story_character_snapshots` at first cast, then page ledger + author overrides evolve them. "Save & redo image" PUTs first, then POSTs the redo. Legacy ready-with-missing-file grace remains.


## Modular architecture (2026-08-30 restructure — shipped as v3.0.0)

- BACKEND: src/app.js is a COMPOSER (security/Host headers, auth-before-body middleware, one runtime/service set, router mounting, static, error middleware, app.locals.dispose). All domain behavior lives in src/modules/: catalog (worlds/characters CRUD + generate_image field), stories (story/page SQL + cast snapshots), continuity (structured extraction, local fold/search, correction API), writing (drafts/generate/regenerate/preview), imagery (service + ONE sequential entity queue), audio (narration cache/segments + ONE sequential audiobook queue), library (storage + EPUB), transfer (portable archive planning/streaming/staged import), auth (single-owner setup/password/sessions/CSRF). Shared bounded helpers live in src/core/{http,validation,security}.js. Existing domain routes/shapes stay compatible; v3.1 adds continuity, v3.2 transfer, and v3.2.1 authentication routes. createApp(db, {staticDir, imageDir, audioDir, transferDir, authRequired, authOptions, allowLan, allowedHosts, trustProxy, logger}) remains the test seam; ordinary Jest defaults auth off, dedicated auth tests opt in.
- FRONTEND: native ES modules under app/ — no build step, <script type="module" src="app/bootstrap.js">. bootstrap.js builds ONE context ({api, state, notify, dialogs, shell, router, features}); features receive dependencies by argument and reach each other through the features registry. core/router.js owns canonical `#/library`, `#/desk/:storyId[/page/:n]`, story-scoped Chronicle/Codex/Gallery/Gate, Library tabs, templates, and Settings routes; `#/home` and `#/write` are input aliases only. Invalid hashes recover to `#/library`, unknown story IDs recover to `#/library/stories`, page turns use history.replaceState, and leaving Desk stops narration. core/state.js is the small shared store. core/dialogs.js is the one focus-trapped dialog manager. CSS remains split by ownership; semantic state and surface tokens live in tokens.css.
- NAV SHELL: Library is the global threshold with route-backed Manuscripts/Bookshelf, world templates, character templates, Settings, and Lock. The manuscript workspace is exactly Desk, Chronicle, Codex, Gallery, Gate at every width; labelled bottom navigation becomes a labelled rail at 900px landscape. `aria-current="page"` marks only the active tier. Library owns the canonical creator; Desk remains reachable without a manuscript and its **New manuscript** entry routes back to that creator. Later rooms are disabled until selection and use honest holding surfaces until implemented. World/character catalogues remain collection-first. Library manuscript-card body click opens its asset manager while explicit Cast/More controls retain their own actions.
- AGE GATE IS GONE: replaced by a contextual explicit-maturity acknowledgement (first selection of Explicit in the story form, localStorage im-tone-explicit-ok) — no global first-visit gate.
- AUTH SEAM: app/features/auth/{adapter,gate}.js — real single-owner adapter (`status/setup/login/logout/changePassword`, CSRF held in memory only) plus `window.__imTestAuthAdapter` injection for Jest. The gate is fail-closed: it mounts branded first-run/unlock/error surfaces and renders no private route until status is unlocked. Setup uses terminal code + confirmed new password; login supports remembered/unremembered sessions; both expose accessible show/hide controls. A 401 immediately clears private client state, stops narration/audiobook/cover/catalog/disk work, closes dialogs, and returns to unlock. Lock is a persistent nav action; Settings changes the password. `pageshow` rechecks status. Tests default to an injected unlocked adapter so unrelated suites stay focused; real-auth tests opt in.
- WRITE DESK: controls grouped (page nav / reading-media tool sheet / composer / story management); narrationAutoBtn is labelled "Auto-read" (no glyph-only buttons); prepared-page state is explicit (#preparedNote: "Next page prepared…" / "…discards it"); primary button reads "Write next page" / "Use prepared page"; Ctrl/Cmd+Enter submits the composer; [ / ] turn pages when focus is outside form controls; #storyContextMode summarizes world + cast shape. Active-tail edits are canonical autosaves; historical copyedits are display-only. Return-to-page is recoverable and never described as permanent deletion.
- BRAND ASSETS: frontend/brand/ holds the three art-directed hero WebPs + vesper/cinder/moth WebPs (PNG masters stay in InkMorrow-UX-Architecture-OpenCode-2026-08-30/assets/generated/, never in production). moth-archive.webp = Bookshelf/lore empty states; cinder-cast.webp = cast-shape intro in story creation (never behind fields); vesper-threshold.webp = active first-run/unlock surface. Interface fonts are bundled under frontend/fonts/ (Latin + Latin Extended WOFF2 and OFL texts); do not restore Google Fonts network requests.
- READ-only earlier pages; delete-later-pages and all destructive flows go through confirmDestructive with exact counts; deleteCurrentPage distinguishes plates.
- NO-MANUSCRIPT DESK (v3.0.2, routed by PR 09): with no manuscript selected the Desk says "No manuscript selected" (never a fake "Page 1 of 1"), every manuscript-dependent control is disabled, and activating one fires no request or toast. A cold direct canonical `#/desk` route and the compatibility `#/write` alias MUST call `displayCurrentPage()` so static markup cannot flash a false enabled state.
- MODAL LIFECYCLE (v3.0.1): dialogs.js wireModal(id, {beforeClose, focusId}) is the ONE complete controller for every feature modal (entity editors, cast editor, AI draft, scene prompt + viewer, audiobook): opener recording, initial focus, ONE document-level Tab/Escape listener over a modal STACK (topmost wins — the scene viewer over the prompt popup, a paid review over anything), COUNTED scroll locks released exactly once, focus restoration (falling back to the modal underneath when stacked). Feature dirty guards are the close POLICY via beforeClose. The shared dialog overlay joins the same stack. Delete page copy says "later pages move up to close the gap".
- AUTH GATE (v3.2.1, superseding dormant v3.0.1): bootstrap awaits authGate init before ANY private route/catalog/model/disk load; a lifecycle token discards stale startup/routing results. `body.im-gated` is present in static HTML so slow/unreachable status checks never flash the shell. Setup/locked/error states strip active sections. An unlock starts protected features once; lock/expiry clears all private in-memory/DOM state and stops work. This is regression-covered with the real adapter and slow injected adapters in frontend/tests/auth-seam.test.js.
- ROUTE SCROLL (v3.0.1): a true top-level surface change calls window.scrollTo(0,0) instantly; same-surface transitions (page turns via replace, Library tab switches) never reset. jsdom stubs scrollTo in tests/setup.js.
- COMPONENT CONTRACT (v3.0.1, story placement superseded by the 4.0 canonical-start follow-up): pagination markup is .desk-group--pages (the old .page-navigation selector is GONE from CSS and tests — the old responsive test queried it vacuously); buttons carry explicit .btn variants (btn-primary/secondary/danger) and bare .btn has a safe base fallback so nothing renders native grey; dead burn-slider CSS/updateSliderFill are deleted; world/character/story descriptions are bounded (.item-card__desc line-clamp 4 — full text stays in DOM + editors/asset data); #storyNewBtn and a bare empty Desk route open the canonical Library sheet, which preserves its complete draft and opens the tale after creation; entering Library → Stories reloads cards/storage. An open `.card-more` releases the card overflow clip and raises its stacking order so its actions remain selectable. Home portrait keeps its dedicated art but bounded (≈52vh) so a hero action is in the initial viewport; the write-background assets resolve ../../brand/ (a dedicated portrait variant covers 768–1199 portrait).
- CAST CREATION CONTRACT (v3.0.2): `renderCastBuilder({resetAddDraft})` preserves the add-row character, supporting/background tier, and relation across passive character-catalog refreshes (portrait polling calls `loadCharacters()` every four seconds). Only a successful Add or successful story creation resets the draft. Creation roster rows show explicit Lead/Supporting/Background pills, and tests must exercise the real Add button plus persisted API payloads—not call the facade directly.
- SETTINGS/OPENCODE CLEAN-CLONE CONTRACT (v3.0.2): `renderNarrationSettings()` refreshes group summaries after the async speech catalogue resolves, so a valid saved narrator never remains labeled “No narrator chosen.” Every path in `opencode.json` must exist in a clean clone; do not reference ignored one-off instruction bundles.
- CAST/WORLD MAINTENANCE CONTRACT (v3.0.3): both new-story creation and the running-story Cast editor must add Supporting and Background members through their real controls and persist the selected role/relation. Edit character includes `world_id` (a blank choice means free-roaming); an ordinary Save performs only the character PUT and MUST NOT enqueue or call portrait regeneration. Only the explicit paid “Save & redo image” path POSTs `/api/characters/:id/image`. Existing story casts remain unchanged when a base character moves worlds.
- MODAL READING CONTRACT (v3.0.4): modal body copy and every label/value review row are left-aligned. Shared paid reviews render `.review-list` as a two-column left-aligned grid; ornamental modal headings may remain centered. Do not restore inherited centered paragraph/row text.
- MODEL-CAPABILITY CONTRACT (v3.0.5): `/api/models` keeps the legacy `reasoning` boolean and adds `reasoning_efforts`, `reasoning_default`, `reasoning_mandatory`, and `is_default`. OpenRouter's full accepted transport vocabulary is none|minimal|low|medium|high|xhigh|max. A catalogue entry's exact declared subset controls the dropdown; the old low/medium/high trio is only a compatibility fallback when an older catalogue says “reasoning” but publishes no ladder. The server default must be resolved and shown even when localStorage has no model override. Never offer an effort absent from the selected/default model's declared set.
