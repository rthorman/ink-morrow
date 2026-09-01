# Adaptive Scriptorium shell

PR 09 establishes the 4.0 navigation and surface contract without pretending
that later feature rooms are complete.

## Information architecture

The Library is the global threshold. Its global controls lead to manuscripts,
world templates, character templates, Settings, and Lock. A manuscript is
opened through a separate, persistent five-destination workspace:

1. **Desk** — current reading and writing work.
2. **Chronicle** — hierarchy, history, prepared work, and recovery.
3. **Codex** — foundations, provenanced continuity, and author corrections.
4. **Gallery** — generated and uploaded art, references, and placements.
5. **Gate** — project backup, publication formats, and reading-copy sharing.

Desk is always available because it owns manuscript creation. Chronicle,
Codex, Gallery, and Gate remain disabled until a manuscript is selected. In
this PR they render explicit holding surfaces that say what will live there and
return the author to Desk; they do not invent data or duplicate old screens.

The header manuscript switcher contains only unlocked catalogue data. Choosing
a manuscript opens it at Desk. Locking clears the selection and hides the
switcher, global navigation, workspace navigation, disk state, and every
private section before another route can paint.

## Routes

Canonical shell routes are:

- `#/library`
- `#/library/stories` and `#/library/bookshelf`
- `#/desk[/<story-id>[/page/<number>]]`
- `#/chronicle/<story-id>`
- `#/codex/<story-id>`
- `#/gallery/<story-id>`
- `#/gate/<story-id>`
- `#/worlds`, `#/characters`, and `#/settings`

`#/home` and the former `#/write` forms remain input aliases for compatible
bookmarks. All new links and navigation output canonical hashes, so the aliases
never appear as duplicate destinations.

## Responsive and accessibility behavior

Compact and portrait layouts pin a labelled five-item bar above the safe-area
inset. Landscape layouts at 900 CSS pixels and wider use the same five labels
in a left rail. Every workspace target is at least 44 by 44 CSS pixels; global
focus tokens remain visible, and reduced-motion preference collapses shell
animation and transitions.

The shell uses min-width-safe grids and reserves bottom space for the compact
bar. The viewport opts into interactive-widget resizing so the writing
composer can remain reachable when a virtual keyboard reduces the visual
viewport. The established 200 percent zoom check continues to forbid
document-level horizontal scrolling.

Brand art may frame the Desk but never sits behind running prose. The prose
plane is an opaque light vellum surface with dark ink, while archive and
annotation surfaces retain their distinct dark and violet material tokens.
