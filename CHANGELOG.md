# Changelog

All notable release changes are recorded here. Ink Morrow uses semantic
versioning; prerelease identifiers mark builds that still require beta field
validation.

## Unreleased

### Added

- Play sessions can fork from an exact immutable turn into named alternate
  paths. Selecting a path or successor remains noncanonical working history;
  an explicitly reviewed Play-to-Prose request creates only a prepared page,
  which still needs the ordinary Desk commit review.
- Optional living campaign state now keeps revisioned relationships, promises,
  debts, knowledge boundaries, secrets, goals, factions, quests, conditions,
  inventory, resources, time, deadlines, and clocks. Codex provides the owner
  ledger; Play provides a bounded Main-first recap and explicitly reviewed AI
  proposals that are never applied automatically.
- The AI cost ticker now remains in the application shell across every private
  surface rather than appearing only on the Desk.
- Opt-in Play sessions now begin with a complete Session Zero control contract
  and record Act, Say, Ask, Direct, and Scribe turns as working history outside
  manuscript prose. Manual turns are free; paid replies are reviewed,
  idempotent, bounded, and fully accounted.
- The shipped User Manual is now directly downloadable before login and from
  the top of Settings, without an internet connection.
- Optional chapter-owned scenes can hold planning/play metadata and group a
  contiguous page range in Chronicle. Manuscripts without scenes remain
  unchanged, and removing a scene only ungroups its pages.
- Portable project archives and truncation recovery preserve optional scene
  membership without making it part of canonical prose.

### Fixed

- Scenes with Play transcripts, and their parent structure, can no longer be
  removed through an apparently empty-container action.
- Re-running `setup.sh` now updates existing dependency trees instead of
  deleting them. Exact `npm ci` replacement requires the explicit `--clean`
  flag, reports every affected path, and refuses linked `node_modules` paths.
- Android/Termux Playwright uses a tracked launcher instead of edits inside
  installed dependencies, so reinstalls no longer erase local compatibility.
- An empty Manuscripts catalogue presents one creation action, and its archive
  panel spans the catalogue grid without clipping at narrow widths.

## 4.0.0-beta.1 — 2026-09-01

This is a clean-break beta. Use a new, empty `DATA_DIR`; Ink Morrow 4.0
refuses 3.x databases and format-v1 archives before mutation. Keep the 3.2.2
application and its data available for historical projects.

The 4.0 beta refactor was produced exclusively through ChatGPT/Codex under
human-led feature planning, direction, review, and acceptance, including code,
visual assets, and documentation. See [CREDITS.md](CREDITS.md).

### Added

- Volume, chapter, and stable page hierarchy with immutable revisions,
  display-only historical copyedits, truncation undo, and recovery suffixes.
- Durable prepared-page writing transactions, idempotency, writer leases, and
  page-revision-provenanced continuity with bounded retrieval and corrections.
- Provider profiles and Scribe/Archivist/Narrator roles, including session
  credentials and an encrypted persistent vault.
- Adaptive Library, Desk, Chronicle, Codex, Gallery, and Gate surfaces for
  desktop, tablet, and phone layouts.
- Streamed image upload with technical normalization but no semantic
  moderation or implicit provider request.
- One immutable publication document rendered as DOCX, ODT, RTF, EPUB 3.3,
  PDF, HTML, Markdown, text, or JSON.
- `.inkmorrow` v2 portable backups and transactional restore with strict
  identity, hash, and collision validation.
- Immutable, expiring, revocable public reading snapshots with isolated
  capability access.
- Approved 4.0 gothic artwork, blackletter branding, and differentiated runic
  navigation symbols.

### Security and privacy

- Every private route remains behind the single-owner authentication seal.
- Uploaded media, archives, public capabilities, provider credentials, and
  publication output use explicit fail-closed boundaries documented in
  [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).
- The 4.0 release line is `AGPL-3.0-only`; historical versions through 3.2.2
  remain MIT-licensed in the preserved first-parent history.

### Known limits

See [docs/releases/4.0.0/KNOWN-ISSUES.md](docs/releases/4.0.0/KNOWN-ISSUES.md).

## 3.2.2 — historical line

The last 3.x release repaired exact prepared-page promotion and stale-response
handling. Its MIT-licensed history remains preserved for users who need to
retain or read 3.x data.
