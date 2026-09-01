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
`rtf`, `html`, `md`, `txt`, or `json` from that snapshot. Filenames are
deterministic. Plain text is emitted in bounded semantic chunks; packaged
adapters consume only the frozen document and never query the live story.

DOCX and ODT include their required package parts and selected raster media.
Their adapters, and RTF, convert the immutable WebP derivative to a compatible
PNG without changing the snapshot; RTF also retains the accessible description. HTML
and Markdown are standalone and embed selected raster data. TXT retains the
ordered accessible description; JSON is the normalized document itself.
Automated semantic re-read compares all seven adapters with one golden ordered
view, including Unicode, punctuation, headings, scene breaks and empty
chapters.
