# Chronicle

Chronicle is the structure and recovery room for one selected manuscript. It
uses the canonical Story -> Volume -> Chapter -> Page order. It also owns
optional scene planning; scenes group prose without becoming a second timeline
or changing publication order.

## Bounded outline

`GET /api/stories/:storyId/hierarchy` returns stable identities, scoped order,
240-character display excerpts, and compact status metadata. Opening Chronicle
does not call the full page-list endpoint or load full manuscript prose. Each
chapter renders at most 80 page rows at once; previous/next windows and the
page-number finder keep the 3,000-page fixture keyboard-navigable.

Volume rows contain chapter rows and chapter rows contain narrative page rows.
An optional scene card may group one contiguous range of those pages or remain
empty while planned. Scene-break characters remain visible when they fall
inside a short excerpt and are never automatically converted into data. Page
actions deep-link to the Desk by publication number. Placed art is a count
marker anchored to prose, not a numbered page.

The summary and rows distinguish:

- current active tail;
- a prepared next page, which remains noncanonical;
- ready, pending, or failed continuity coverage;
- display-only copyedits;
- art placement counts; and
- optional scene membership.

## Structure maintenance

New volumes and chapters begin only at the current tail. A new volume creates
its first empty Chapter I in the same transaction. Any volume or chapter may be
renamed without changing its identity, page identity, prose revisions, or
continuity evidence. Only empty active-tail containers expose removal, and the
confirmation names the exact empty structure affected. Chronicle offers no
arbitrary historical reorder.

Any chapter may add optional scene metadata without making scene planning a
requirement. Removing a scene ungroups its pages and cannot delete prose,
revisions, art, or continuity. See [Optional scenes](scenes.md).

## Recovery

Recovery list responses include a server-derived restore state. The server
compares the current canonical chain fingerprint with the fingerprint captured
at truncation:

- `safe` enables an explicit restore review;
- `unsafe` disables restore because surviving canon changed;
- `restored` records a completed restore; and
- `expired` records that the private payload was scrubbed.

Every record offers JSON export. Unsafe recovery therefore has a manual
reconciliation fallback but can never silently merge. The restore endpoint
rechecks the fingerprint transactionally, so a stale open Chronicle cannot
bypass the same safety rule.

## Accessibility and privacy

The nested outline uses keyboard-operable disclosure controls and tree/group
semantics. Page, maintenance, paging, restore, and export controls meet the
shared 44-pixel target contract and reflow to one column in portrait layouts.
The authentication lock clears Chronicle content and invalidates in-flight
loads so hierarchy excerpts and recovery metadata cannot repaint the sealed
screen.
