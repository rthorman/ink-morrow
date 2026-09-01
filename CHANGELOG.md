# Changelog

All notable release changes are recorded here. Ink Morrow uses semantic
versioning; prerelease identifiers mark builds that still require beta field
validation.

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
