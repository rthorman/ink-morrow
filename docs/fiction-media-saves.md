# 5.0 illustrations, playable saves and reader-safe books

## Three different products of play

The reader shows each current-path illustration above its associated opening or
scene. An illustration is not a fact, character, choice or prose revision. Adding,
replacing, describing or removing it appends a local state snapshot. Forking before
that snapshot restores the earlier placement; other paths and the normalized file
remain available. A path has at most 200 illustrated moments; a story retains at
most 400 image assets across its history. These bounds fail before AI dispatch.

**Illustrate a moment** opens synchronously using the already loaded story. Older
targets become available through Read earlier moments. Upload accepts up to 20 MB
of supported raster input, validates its real container and decodes it under the
existing 40-megapixel ceiling. Metadata and animation are removed, orientation is
normalized, and the resulting WebP is at most 4096 pixels per side. SVG and
polyglot/trailing data are refused. No semantic classifier or provider is called.

Paint with AI uses the distinct **Illustrator** role configured in Settings. Its
provider/model must match the review. Only the selected passage (up to 12,000
characters) and art direction are sent; no hidden facts, motives, other passages
or uploaded reference images are sent. The request is journalled before dispatch,
has one transport attempt, and commits its asset/placement/spend atomically after
checking the revision and active path. Failed and interrupted work retains known
charges or an unknown-cost attempt. A successful idempotency replay is free even
after a branch change. There is no automatic painting or paid retry.

Descriptions are required. Check that the generated image matches its description;
**Save description only** corrects it locally without buying another painting.

## A book is not a save

Export this reading path creates one validated PublicationDocument from active
ancestry. Only opening and scene prose, episode headings and current image
placements enter it. Questions, control records, corrections, directions, private
facts, motives, director plans, other paths and provider configuration do not.
The client sends the selected revision/path so a concurrent change cannot silently
export a different reading. An unavailable or corrupt placed image fails the export
instead of creating a broken reference. Content is bounded to 64 MB and 100,000
moments; text-only formats describe images rather than carrying raster pixels.

All nine existing adapters consume this same document: EPUB, PDF, HTML, DOCX, ODT,
RTF, Markdown, plain text and JSON. Books are local operations, not AI purchases.
There is no book editor or manual prose authoring path.

EPUB uses one separate XHTML spine item per illustration, immediately before its
associated prose. Each image item is pre-paginated with explicit 1200×1600 viewport
dimensions and no synthetic spread; prose items remain reflowable. WebP is converted
to PNG for EPUB interoperability, sequentially to bound conversion pressure. The
reading sequence is checked across every spine item, not just the first text file.
This follows [EPUB 3.3 layout overrides](https://www.w3.org/TR/epub-33/#layout-overrides).
Actual display still depends on the receiving reading system's EPUB support.

## Private playable saves

Download a playable save exports `.inkmorrow5`: gzip JSON with format
`ink-morrow-fiction-save`, version 1. It carries the initial state, every branch
and immutable moment, hidden facts and private motives, correction reasons,
control, preferences, episodes, director history, normalized image bytes and
aggregate known/unknown provider spend. It deliberately excludes credentials,
provider configuration, payment consent and reusable request keys. It cannot resume
a paid operation. Save export waits until there is no pending request.

The file is **unencrypted**. It can reveal spoilers and private directions. Use a
book for ordinary readers, and keep saves private. Copying it elsewhere does not
copy a provider key or permit spending there. Configure the destination separately.

Import first offers a read-only preview. The same validated file is then imported
as a new story: never a merge or replacement. IDs for stories, paths, moments and
assets are remapped, including evidence and placement links. Only aggregate spend
is carried as terminal accounting records, not as executable work.

Bounds are 64 MB compressed, 128 MB expanded, 10,000 moments, 40 paths, 400 images,
24 cast members, 128 facts per snapshot and 12 director-history entries. Conservative
export preflight may refuse unusually large stories before allocating their complete
JSON. Decompression has a hard output ceiling. Validation rejects unsupported
versions, fields, duplicate IDs, cycles, dangling/cross-path references, invalid
control, future evidence, unreachable moments and unsafe or mismatched media.
All graph checks precede writes. Staged image files receive random server-owned
names; database import is one transaction; rollback cleans only its new files.

No 4.x database, `.inkmorrow` archive or earlier playable story is accepted by this
save importer. The final release identity/storage cutover is a separate batch.

## Verification

`fiction-media-saves.test.js` covers local normalization and isolation, path rewind,
description corrections, free replays, cost/failure accounting, EPUB reading order,
private-data exclusion, complete save round trips, malformed graphs/media and
rollback. HTTP tests exercise auth and CSRF before upload/import parsing. Frontend
tests cover immediate dialogs, draft retention, image-before-prose layout and late
reply isolation. Desktop/mobile journeys exercise real upload, book/save download,
copy import and failed painting without purchasing real provider work.
