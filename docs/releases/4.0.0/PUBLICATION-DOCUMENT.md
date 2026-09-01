# PublicationDocument v1

`PublicationDocument` is the immutable, format-neutral boundary between a
private ScribeTribe project and a publication export. The published JSON
Schema is
[`backend/src/modules/publication/publication-document.schema.json`](../../../backend/src/modules/publication/publication-document.schema.json).

Every snapshot contains only these top-level fields:

- `format` and `schema_version` identify the contract;
- `metadata` contains the reviewed title, subtitle, author, language,
  description, publisher, rights and date;
- `front_matter` and `back_matter` contain reviewed semantic sections;
- `volumes[].chapters[].pages[].blocks[]` contains display prose, scene breaks
  and owner-selected art placements in publication order; and
- `assets[]` contains publication-local keys, technical image facts,
  accessible descriptions and the selected raster bytes.

Story IDs, page IDs, provider details, prompts, directions, canonical history,
continuity, prepared prose, recovery suffixes, costs, credentials and sessions
are not fields in this schema. Unknown snapshot-request fields fail closed.
Art is included only when its placed asset ID is explicitly selected; a
missing accessible description produces a warning without blocking private
Gallery use.

## Snapshot and adapter API

`POST /api/stories/:id/publications` accepts reviewed `metadata`,
`front_matter`, `back_matter`, `art.asset_ids`, and an optional
`expected_story_updated_at`. It takes an immediate SQLite transaction, reads
the current display-revision pointers and placements once, stores the
normalized document with a SHA-256 digest, and returns the immutable snapshot.
A stale expected timestamp refuses with `PUBLICATION_STORY_CHANGED`.

`GET /api/publications/:snapshotId` returns the same authenticated snapshot.
`GET /api/publications/:snapshotId/formats/:format` renders `docx`, `odt`,
`rtf`, `epub`, `pdf`, `html`, `md`, `txt`, or `json` from that snapshot. Filenames are
deterministic. Plain text is emitted in bounded semantic chunks; packaged
adapters consume only the frozen document and never query the live story.

`POST /api/publications/:snapshotId/exports` starts one cancellable job for a
reviewed set of formats. Status, retry, cancellation, per-file download, and
cleanup live under `/api/publication-jobs/:jobId`. Files are written through
private `.partial` names and renamed only when complete; cancellation and
failure remove the entire job stage.

DOCX and ODT include their required package parts and selected raster media.
Their adapters, and RTF, convert the immutable WebP derivative to a compatible
PNG without changing the snapshot; RTF also retains the accessible description. HTML
and Markdown are standalone and embed selected raster data. TXT retains the
ordered accessible description; JSON is the normalized document itself.
EPUB emits a deterministic EPUB 3 package with navigation and manifest checks.
PDF uses deterministic A4 geometry, widow/orphan-aware paragraph placement,
ActualText reading order, the bundled OFL Literata subset, and selected JPEG
image objects.
Automated semantic re-read compares all nine adapters with one golden ordered
view, including Unicode, punctuation, headings, scene breaks and empty
chapters.

## Immutable reading-copy links

PR 17 can bind a high-entropy, hash-only capability to this exact snapshot.
The isolated viewer receives the allowlisted document and digest but no live
story or private project state. Expiry, one-way revocation, public deployment,
and proxy logging requirements are specified in
[`SNAPSHOT-SHARING.md`](SNAPSHOT-SHARING.md).
