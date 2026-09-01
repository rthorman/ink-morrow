# Ink Morrow 4.0.0 QA and release gates

Status: **accepted beta quality contract**

## Supported surface

The official browser is the current Chrome Stable version recorded in the
release notes when 4.0.0-beta.1 is cut.

Critical profiles:

| Profile | Automation | Manual release smoke |
|---|---|---|
| Chrome desktop, 1280 × 800 | Required | Required |
| Chrome desktop, 1440 × 900 | Visual/responsive | Recommended |
| Android tablet portrait, 768 × 1024 | Required | Required on a real device |
| Android tablet landscape, 1024 × 768 | Required | Required on a real device |
| Phone, 390 × 844 | Best-effort critical-flow test | Not a release blocker unless data/canon is at risk |

Keyboard, touch-sized controls, 200% text zoom, reduced motion, dark/light
manuscript themes, slow provider replies, and reduced viewport height from an
on-screen keyboard are part of the matrix.

## Definition of done for every implementation PR

An implementation PR is mergeable only when:

- its planned schema/API/UI contract and non-goals are satisfied;
- new behavior has unit or contract tests at the lowest useful layer;
- at least one integration test crosses each changed persistence boundary;
- user-visible states cover idle, loading, success, empty, refusal, failure,
  cancellation, retry, stale response, and restart where applicable;
- paid and provider-sending actions have cost/data exposure assertions;
- accessibility names, focus, keyboard operation, and responsive behavior are
  covered;
- no current regression test was weakened merely to fit the change;
- documentation, archive/export schema, and AGENTS.md contracts are updated
  where behavior changed; and
- the PR can be reverted without requiring unrelated later PRs to repair main.

## Automated test layers

### Unit and schema tests

- rank/order helpers, revision rules, fold determinism, operation transitions;
- strict validation for continuity, provider profiles, uploads, shares, and
  publication documents;
- format-specific escaping and serialization;
- pure impact-analysis and template-diff behavior; and
- security helpers, redaction, token hashing, media signatures and limits.

### Backend integration tests

Use in-memory SQLite unless filesystem behavior is the subject. Cover:

- transactional hierarchy and page-revision mutations;
- prepared-page promotion and directed generation;
- competing operations, stale context, idempotency and writer-lease expiry;
- tail substantive edits versus historical display-only copyedits;
- truncation, immediate undo, 30-day recovery and unsafe-restore refusal;
- story-local template snapshots and reviewed updates;
- continuity extraction, correction, deterministic replay and failed repair;
- upload staging, normalization, placement and cleanup;
- provider sanitation announce-and-wait;
- encrypted secret-vault setup, unlock, password change and reset;
- archive preflight and transactional import;
- normalized publication construction and every adapter; and
- share creation, immutable reads, expiry and revocation.

AI and speech/image providers are mocked. Tests assert exact call counts and
data categories so the suite never spends money.

### Frontend integration tests

Jest/jsdom covers feature state and shared interaction contracts:

- Library and one-sheet start paths;
- adaptive navigation state and route recovery;
- exact prepared/directed button transitions, including clearing direction;
- autosave and unsaved/failure handling;
- copyedit notice and historical return confirmation;
- Chronicle outline and recovery states;
- Codex evidence/correction/template-diff flows;
- Gallery upload/AI dual paths and placement;
- Gate exposure reviews and format selection;
- provider setup-on-first-use;
- all dialogs through one focus/dirty/scroll lifecycle; and
- fail-closed handling of 401, CSRF failure, stale async result, and story
  switch.

### Browser end-to-end tests

Playwright runs separate clean server/database invocations for desktop Chromium
and Mobile Chrome. Critical journeys:

1. first-run setup and unlock;
2. start manually and write the first page;
3. start from a seed and configure a provider at first AI use;
4. promote the exact prepared page and generate a replacement from direction;
5. refresh/retry/double-press/racing-tab generation without duplicate canon or
   spend;
6. edit the tail, copyedit history, truncate, undo, and restore;
7. inspect and correct continuity without rewriting prose;
8. upload arbitrary-subject test art, place it historically, and verify no
   provider call;
9. encounter Grok refusal, inspect sanitized prompt, and deliberately retry;
10. export each publication format and a full project archive;
11. publish, view, expire, and revoke a snapshot; and
12. lock the application and verify no private route flashes or loads.

Tests never point at a developer's real database or provider credentials.

### Visual regression

Stable screenshot fixtures cover:

- unlock threshold;
- empty and populated Library;
- one-sheet creation;
- Desk empty/loading/prepared/directed/error/history states;
- Chronicle, Codex, Gallery, and Gate;
- destructive, paid, refusal, provider, and share dialogs; and
- every critical viewport, plus 200% zoom for the Desk.

Visual review distinguishes intentional art changes from control movement,
clipping, contrast regression, and manuscript obstruction.

### Accessibility automation

Run an automated WCAG rules engine in critical pages and dialog states, then
manually verify:

- keyboard-only completion of every critical journey;
- focus visibility and restoration;
- sensible screen-reader names and status announcements;
- no color-only prepared/refusal/danger states;
- zoom/reflow and on-screen keyboard resilience;
- reduced motion; and
- readable exported alt text.

Automation does not replace manual judgment.

### Security and robustness

Maintain malicious fixture corpora for:

- archive traversal, duplicate paths, symlinks, undeclared entries, compression
  bombs, hash mismatches and future versions;
- image polyglots, false MIME, malformed decodes, oversized dimensions,
  metadata canaries, active SVG and interrupted uploads;
- XSS payloads in every author/provider-controlled text field;
- credential, prose, session, CSRF and share-token canaries across logs,
  responses, exports and snapshots;
- CSRF/origin/Host/session bypass attempts;
- provider timeouts, malformed structured output and oversized errors; and
- capability enumeration, expiry, revocation and cache behavior.

Production dependencies and pinned Actions are audited in CI.

## Long-manuscript fixture

The release suite builds a deterministic synthetic work with:

- 10 volumes;
- 100 chapters;
- at least 3,000 narrative pages;
- approximately 1.2 million words;
- 150 recurring characters;
- 10,000 continuity events/facts/threads;
- 500 placed and unplaced image metadata records; and
- copyedits, corrections, a prepared page, and a recovery suffix.

The fixture uses generated neutral text and tiny safe image fixtures so it can
live or be generated in tests without copyright or repository bloat.

Release checks prove:

- opening the Desk, turning pages, saving a copyedit, folding continuity,
  building context, and opening Chronicle do not scale with full manuscript
  text;
- the project archive round-trips losslessly;
- all publication adapters preserve semantic order;
- a snapshot excludes all private-state canaries; and
- no operation requires sending the whole work to an AI.

Performance budgets are recorded against the project's reference Android
tablet before beta. Regressions above 20 percent require explanation and
stakeholder acceptance; correctness gates never yield to a speed target.

## Publication validation

| Format | Automated validation |
|---|---|
| .inkmorrow | Manifest/schema/hash validation plus lossless round-trip |
| DOCX | OPC/ZIP structure, XML schema-level checks, semantic re-read |
| ODT | Package/mimetype/manifest checks, semantic re-read |
| RTF | Parser round-trip and control-word escaping fixtures |
| EPUB 3.3 | EPUBCheck-compatible validation and semantic re-read |
| PDF | Parser opens, pages/fonts/images present, text extraction order checked |
| HTML | Standards parser, CSP-safe standalone output, semantic comparison |
| Markdown | Golden parse tree and escaping fixtures |
| TXT | Encoding, ordering and separator fixtures |
| JSON | Published JSON Schema and canonical fixture comparison |

Before beta, manually open a representative DOCX, ODT, EPUB, and PDF in at
least one mainstream reader/editor each. Record applications and versions in
the release evidence; this is compatibility evidence, not an enduring support
guarantee.

## Release-blocking defects

Beta is blocked by any reproducible defect that can cause:

- loss or silent corruption of manuscript, hierarchy, revisions, continuity,
  recovery data, archive, or selected media;
- speculative prose becoming canonical or affecting state;
- the green action committing prose other than the shown prepared page;
- duplicate provider requests or unattributed known spend from one action;
- a stale response mutating another story, page, or operation;
- credential, session, private prose, direction, deleted suffix, or share-token
  disclosure outside its explicit boundary;
- a user upload invoking AI or semantic moderation without consent;
- a malformed upload/archive escaping storage or executing active content;
- public snapshot mutation, indexing by default, or private API access;
- failure to restore a project archive made by the same beta version;
- invalid DOCX, ODT, EPUB, PDF, or .inkmorrow output on the release fixture;
- inability to complete the primary authoring loop on desktop or portrait
  tablet Chrome;
- an authentication bypass or known critical/high supported-path
  vulnerability; or
- inaccessible critical action with no equivalent path.

Lower-severity defects are triaged with a documented workaround and explicit
stakeholder acceptance.

## Manual release script

On a clean self-hosted installation:

1. follow README setup without undocumented steps;
2. set the owner passphrase and test lock/unlock/restart/password change;
3. create a manuscript manually, from a seed, and from imported prose;
4. write, prepare, direct, cancel, fail, retry, refresh, and race a page turn;
5. edit the active page and copyedit an old page;
6. return to history, undo, then test Chronicle recovery;
7. review and correct state in Codex;
8. upload a personal photo and an external generated image, verify metadata
   behavior, and place both without provider traffic;
9. exercise Grok refusal sanitation and deliberate retry;
10. read a page aloud and create an audiobook where supported;
11. back up, restore on a fresh data directory, and compare;
12. export all publication formats and inspect representative files;
13. create a short-lived share, view it signed out, then revoke it;
14. run the long-manuscript smoke on the reference tablet; and
15. review logs and artifacts for secret/private-data canaries.

The release owner records commit, Node version, Chrome version, device,
commands, pass/fail evidence, known issues, and final stakeholder decision.

## Beta entry and exit

**Enter beta** when PRs 01–19 are merged, all blocking gates pass, install and
recovery documentation has been followed by someone other than the active
implementation context, and the stakeholder signs the release record.

**Exit beta toward a stable release** only after real external authors have
completed the full authoring loop on non-development data, no unresolved
data-loss/security blocker remains, provider cost behavior is observed in
practice, and feedback-driven UX fixes have their own reviewed contracts.
