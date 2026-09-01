# ScribeTribe 4.0.0-beta.1

ScribeTribe 4.0 is a clean-break beta for self-hosted, single-owner long-form
fiction writing. It replaces the 3.x application tree with the reviewed 4.0
release tree while preserving the historical 3.x line as the first parent of
the cutover commit.

## Before installing

- Install with Node.js 22.5 or newer and a **new, empty** `DATA_DIR`.
- Do not point 4.0 at a 3.x database. It will refuse the old family before
  writes, and there is no in-place migration.
- Keep the 3.2.2 application and its data intact for historical manuscripts.
- Read [OPERATIONS.md](OPERATIONS.md), [SECURITY.md](../../../SECURITY.md),
  [PRIVACY.md](../../../PRIVACY.md), and [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## What is in the beta

- A manuscript-first Library and five stable workspaces: Desk, Chronicle,
  Codex, Gallery, and Gate.
- Transactional page preparation and promotion, revision-aware editing,
  structured hierarchy, bounded continuity, and safe truncation recovery.
- Reusable world/character templates that become story-local snapshots.
- Local image upload, AI painting, noncanonical placement, provenance, and
  explicit provider-reference permission.
- Multi-format publication, full `.scribetribe` v2 backup/restore, and
  immutable expiring public reading snapshots.
- Approved responsive gothic art, blackletter identity, and runic navigation.

## Development provenance

The 4.0.0-beta clean-break refactor was produced exclusively through
ChatGPT/Codex under human-led feature planning, direction, review, and
acceptance. The generated work includes implementation, tests, visual assets,
and release/user documentation. This provenance applies to the 4.0 refactor;
the preserved through-3.2.2 line retains its separately documented credits in
[CREDITS.md](../../../CREDITS.md).

## Operational boundary

ScribeTribe is not a hosted service and does not operate a maintainer cloud.
Provider actions use credentials and endpoints configured by the owner and may
cost money. Uploaded images are technically validated without semantic subject
moderation. Archives and publication files are local and unencrypted. Public
sharing requires HTTPS and careful handling of the capability URL.

OpenRouter is the only AI supplier tested for this beta. Other
OpenAI-compatible endpoints may lack required model discovery, image,
narration, or reasoning capabilities, and may not work at all. Chrome is the
only browser tested; other current standards-respecting browsers may work but
are not certified.

## Validation

The immutable release record, automated suite counts, archive/publication
fixtures, device coverage, pending manual owner checks, and final decision are
kept in [RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md). Do not publish the tag while
that record contains an unresolved release blocker.

