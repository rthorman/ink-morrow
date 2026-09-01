# ScribeTribe acceptance checklist

OpenCode must use this list before reporting completion.

## Functional preservation

- [ ] Existing routes still resolve.
- [ ] Authentication and authorization behavior is unchanged unless separately requested.
- [ ] Existing create, edit, save, load, delete and recovery flows still work.
- [ ] No API or persistence contract was changed merely for visual branding.
- [ ] No unrelated dependency or framework migration was introduced.

## Brand identity

- [ ] The product name is consistently written `ScribeTribe`.
- [ ] The supplied mark or lockup appears crisply in the appropriate shell location.
- [ ] The primary palette uses ink, oxblood, violet, vellum and tarnished gold as specified.
- [ ] The result reads as a living gothic manuscript, not a generic dark SaaS theme.
- [ ] At least the home/landing, browse/library and writing surfaces share the same brand system.
- [ ] Character imagery depicts clearly adult literary scribes without sexualized framing.
- [ ] No maid, schoolgirl, chibi, leash/coercive-pet or copied-franchise visual language appears; Moth's approved velvet bell collar remains the sole intentional exception.

## Artwork integration

- [ ] Desktop hero uses `hero-scriptorium-desktop.webp` or an approved derivative.
- [ ] Tablet portrait uses `hero-scriptorium-tablet-portrait.webp` or an approved derivative.
- [ ] Tablet landscape uses `hero-scriptorium-tablet-landscape.webp` or an approved derivative.
- [ ] Neither tablet orientation merely crops the desktop or opposite-orientation composition.
- [ ] HTML copy does not cover faces, quills or the illuminated manuscript.
- [ ] `vesper-quill.png` is treated as a genuinely transparent asset.
- [ ] Interface text is real text, never generated lettering baked into art.
- [ ] Decorative images use empty alt text and do not capture pointer events.
- [ ] Content-bearing images have useful alt text.
- [ ] Below-fold artwork lazy-loads.

## Desktop checks

- [ ] 1440 × 900 has no overlap, clipping or awkward empty bands.
- [ ] 1280 × 800 remains composed and fully operable.
- [ ] Hero copy remains legible over the darker left region.
- [ ] Navigation, editor panels and primary actions have clear focus and hover states.

## Tablet checks

- [ ] 1180 × 820 landscape is intentionally composed.
- [ ] 1024 × 768 landscape is intentionally composed.
- [ ] 768 × 1366 portrait uses the complete tall composition without face-obscuring copy.
- [ ] 800 × 1280 portrait uses the complete tall composition without awkward crop bands.
- [ ] 820 × 1180 portrait moves copy when needed rather than covering character faces.
- [ ] Orientation change does not leave stale measurements or clipped panels.
- [ ] All essential controls work without hover.
- [ ] Touch targets are at least 44 × 44 px.
- [ ] Two-column or single-column content layouts maintain readable titles and actions.

## Phone stretch goal

- [ ] 390 × 844 has no document-level horizontal scrolling.
- [ ] Navigation, editor, saving and destructive confirmation remain usable.
- [ ] Full scriptorium artwork is replaced by the simplified art treatment.
- [ ] Secondary motion and ornament are removed.
- [ ] The phone does not download a hidden desktop hero unnecessarily.

## Typography and readability

- [ ] Editor prose remains within approximately 58–72 characters per line at its default setting.
- [ ] Body copy is at least 16 px under normal browser settings.
- [ ] Long copy does not use blackletter or decorative display faces.
- [ ] Normal text reaches 4.5:1 contrast; large text and graphical controls reach 3:1.
- [ ] 200% text zoom does not clip essential controls.

## States and interaction

- [ ] Keyboard focus is visible on every interactive element.
- [ ] Active, selected, disabled, loading, saved, unsaved, error and destructive states are distinguishable without color alone.
- [ ] Destructive confirmations use explicit labels and state recoverability.
- [ ] Flavor copy never obscures recovery instructions.
- [ ] No mascot or ornament overlays active prose.

## Motion

- [ ] Motion is brief and tied to an event.
- [ ] No continuous animation competes with active writing.
- [ ] Reduced-motion mode disables parallax, drifting pages and transform-heavy effects.
- [ ] No scroll-jacking or pointer-following character is present.

## Engineering verification

- [ ] Formatter passes.
- [ ] Linter passes.
- [ ] Typechecker passes where applicable.
- [ ] Relevant unit/integration tests pass.
- [ ] Production build passes.
- [ ] Browser console contains no new errors.
- [ ] Image dimensions prevent cumulative layout shift.
- [ ] OpenCode reports any deliberate compromise rather than hiding it.
