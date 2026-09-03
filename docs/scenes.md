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
continuity evidence, art placement, or publication output. Deleting a scene
deletes only the container and its memberships; its pages become ordinary
ungrouped pages.

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

No scene action calls an AI provider. Existing prose scene-break markers stay
valid and are not automatically converted. Future detection may offer a
preview, but it must never create records without owner approval.

## Recovery and portability

Portable `.inkmorrow` archives carry scenes and page memberships, including
identity remapping during copy import. Truncation recovery records membership
for removed pages and restores it when the scene still exists. If the scene
was deliberately removed while the recovery waited, prose restores safely as
ungrouped pages.
