# Optional scenes

Scenes are chapter-owned planning and play containers. They are deliberately
optional: Story -> Volume -> Chapter -> Page remains a complete manuscript,
and an existing or new manuscript may contain no scenes.

## Stored fields

A scene has a stable identity, chapter-relative order, name, working mode
(`author`, `play`, or `hybrid`), status, optional viewpoint character,
location, story time, purpose, and stakes. A scene may group one contiguous
range of pages in its chapter or remain empty while planned.

Page membership is held separately from the canonical page row. Grouping or
ungrouping therefore changes no prose, page ordinal, revision pointer,
continuity evidence, art placement, or publication output. A scene without
Play history can be deleted; its pages become ordinary ungrouped pages. Once
a scene owns a Play transcript, Ink Morrow preserves that working history and
refuses deletion of the scene or an otherwise-empty parent chapter/volume.

## API

- `GET /api/stories/:storyId/scenes`
- `POST /api/stories/:storyId/chapters/:chapterId/scenes`
- `PUT /api/stories/:storyId/scenes/:sceneId`
- `DELETE /api/stories/:storyId/scenes/:sceneId`

Create and update accept the bounded metadata fields plus an optional
`page_ids` array. Selected pages must exist in the same chapter, form one
contiguous range, and not belong to another scene. The viewpoint character,
when present, must belong to the manuscript cast.

## Chronicle and Desk

Chronicle owns scene planning. Each chapter offers **Add optional scene**;
scene cards show metadata and grouped page ranges. Page rows retain their
normal publication order and show a scene marker where applicable. The Desk's
compact context line names the current page's scene without adding a second
reader or changing the writing controls.

Planning and grouping actions call no AI provider. **Open Play** enters the
optional Session Zero and transcript workspace; only the separately reviewed
**Send to Scribe** action can call a provider. Existing prose scene-break
markers stay valid and are not automatically converted. See
[Play sessions](play.md).

## Recovery and portability

Portable `.inkmorrow` archives carry scenes and page memberships, including
identity remapping during copy import. Truncation recovery records membership
for removed pages and restores it when the scene still exists. If the scene
was deliberately removed while the recovery waited, prose restores safely as
ungrouped pages.

When **working history** is included, archives also carry Play contracts,
turns, and provider-attempt accounting. Without that option, those private
transcripts are deliberately omitted.
