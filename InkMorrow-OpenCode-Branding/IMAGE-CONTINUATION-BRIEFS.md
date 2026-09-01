# Ink Morrow image-continuation briefs

These briefs extend the approved art system. They are not instructions to regenerate assets that already exist.

When an image tool accepts references, use:

1. `hero-scriptorium-desktop.png` for world, ensemble, lighting and rendering style;
2. `hero-scriptorium-tablet-portrait.png` for the primary, tall tablet composition;
3. `hero-scriptorium-tablet-landscape.png` for tablet landscape composition;
4. `vesper-quill.png` when Vesper's identity must remain consistent.

## Global invariants

- Characters are unambiguously adult women.
- Natural feline ears and tails are anatomy, not costume headbands.
- Mature painterly anime-gothic editorial illustration.
- Obsidian, oxblood, bruised violet, parchment, tarnished gold and rare turquoise witchlight.
- No embedded text, fake interface, logo or watermark.
- No pornographic framing, lingerie, cleavage emphasis, fetish wear, maid costume, school uniform, chibi proportions or childlike appearance.
- No recognizable franchise character or studio imitation.
- Keep hands, ears, tails and props anatomically plausible.
- Compose for the declared web slot; do not generate a generic poster and crop blindly.

## Story-cover template

```text
Use case: illustration-story
Asset type: Ink Morrow story/project cover, 4:3
Input images: approved Ink Morrow hero as world/style reference
Primary request: illustrate the supplied story premise as a forbidden manuscript coming alive inside the Ink Morrow universe
Subject: story-specific focal image; a scribe may appear only when relevant
Style/medium: mature painterly anime-gothic editorial fantasy matching the reference
Composition/framing: 4:3 cover; strong central silhouette; keep the upper and lower 12% free of critical detail for responsive card overlays
Lighting/mood: candle gold against moonlit violet, adjusted to the story's emotional tone
Constraints: no text, title, logo, watermark or fake UI; clearly adult characters; readable at card size
Avoid: pornographic framing, chibi, maid/school costumes, generic cyberpunk, excessive skulls, copied franchise styling
```

## Vesper empty-state vignette

```text
Use case: illustration-story
Asset type: transparent Ink Morrow empty-state character vignette
Input images: `vesper-quill.png` as the exact identity reference
Primary request: show the same Vesper Quill examining one comically blank sheet of vellum with an incisive, unimpressed expression
Subject: preserve her adult identity, face, wine-red hair, natural black ears and tail, high-collared black/oxblood academic tailoring and gold embroidery
Composition/framing: waist-up or three-quarter figure; clean silhouette; all edges and props inside the canvas
Constraints: genuinely transparent background; no checkerboard; no text, logo, watermark or additional characters; preserve identity and outfit
Avoid: redesign, pin-up pose, exposed cleavage, maid/school styling, chibi, white halo
```

## Moth lore/archive vignette

```text
Use case: illustration-story
Asset type: Ink Morrow lore-panel illustration, 3:2
Input images: approved Ink Morrow hero as character/world/style reference
Primary request: feature Moth, the clearly adult silver-haired feline Archivist of Forgotten Things, opening a chained archive drawer as pale violet memory fragments escape
Scene/backdrop: moonlit archive alcove with vellum labels, dark wood and restrained candlelight
Style/medium: mature painterly anime-gothic editorial fantasy matching the reference
Composition/framing: Moth on the right two-thirds; controlled dark space on the left for HTML copy
Constraints: no embedded text, logo, watermark or fake UI; preserve the silver-haired supporting scribe's identity and professional gothic clothing
Avoid: sexualized framing, maid/school uniform, chibi, excessive skulls, cyberpunk
```

## Cinder branching/revision vignette

```text
Use case: illustration-story
Asset type: Ink Morrow branching-story illustration, 3:2
Input images: approved Ink Morrow hero as character/world/style reference
Primary request: feature Cinder, the clearly adult copper-haired feline Inkbreaker, splitting one written line into several luminous manuscript paths with a reckless grin and an ink-stained quill
Scene/backdrop: active writing desk with torn drafts, candles and spectral violet/oxblood branch lines
Style/medium: mature painterly anime-gothic editorial fantasy matching the reference
Composition/framing: dynamic central action; important face, hand and branch origin within the central 70%; leave a clean lower band for real controls
Constraints: no embedded text, logo, watermark or fake UI; preserve the copper-haired supporting scribe's identity and professional gothic clothing
Avoid: sexualized framing, maid/school uniform, chibi, gore, cyberpunk
```

## Responsive generation rule

For a major hero, generate or deliberately recompose separate desktop, tablet-portrait and tablet-landscape artwork. Portrait tablet is the primary tablet state and should support tall 9:16 and 10:16-class screens without borrowing a landscape crop. Do not request a single “responsive” picture and assume CSS can rescue every crop. Phone should normally use a transparent character asset over a lightweight CSS background rather than another enormous scene.
