# Ink Morrow frontend brand system

Status: **normative**  
Primary targets: **desktop and portrait-first tablet**  
Stretch target: **phone**  
Product category: **interactive-fiction writing web application**

## 1. Brand thesis

Ink Morrow is not “a dark writing app.” It is a living forbidden manuscript tended by a quarrelsome order of adult feline scribes.

The interface should make writing feel consequential: ink remembers, choices leave scars and unfinished stories grow restless. The experience can be lush, theatrical and playful because this is a personal fiction project—not a corporate tool pretending to be neutral.

### Primary promise

> **Where stories grow claws.**

### Supporting lines

- Write beautifully. Choose dangerously.
- Ink remembers.
- Every choice leaves a scar.
- Wake the scribes.

## 2. Desired emotional mixture

| Quality | Target | Failure mode to avoid |
|---|---:|---|
| Gothic atmosphere | Very high | Halloween-shop skull wallpaper |
| Literary credibility | Very high | Fake Latin and unreadable blackletter everywhere |
| Anime character presence | High | Generic franchise imitation or gacha-game clutter |
| Playfulness | High | Infantile kawaii noise |
| Sensuality | Low–moderate | Pornography, pin-up framing or fetish costuming |
| Usability while writing | Absolute | Art obscuring prose or controls |

## 3. Brand principles

### The manuscript is alive

Pages, ink, seals and marginalia behave as if they possess memory and appetite. The UI may respond with ink blooms, scratched annotations and character reactions.

### Beauty earns its space

Illustration is a first-class product surface, but its density follows the task. Home and discovery can be lavish. The editor must become quieter.

### Adult characters, adult confidence

The scribes are clearly adult women with authority, work, rivalries and opinions. Their appeal comes from intelligence, gaze, tailoring and attitude—not exposed anatomy.

### One sharp sentence beats ten cute noises

Use one memorable line per state. Do not make every tooltip perform a character voice.

### The dark must remain readable

Black-on-black is not sophistication. Establish visible surface hierarchy, generous type contrast and unmistakable interaction states.

## 4. The Ink Morrow cast

The three approved hero characters form a flexible ensemble. Do not force them into product functions that do not exist.

### Vesper Quill — First Scribe

- Lead visual identity and primary mascot.
- Wine-red hair, natural black feline ears and tail, amber-gold eyes.
- High-collared black velvet academic tailoring with oxblood lining and tarnished-gold embroidery.
- Controlled, incisive, amused and faintly dangerous.
- Best used for hero art, onboarding, major empty states, difficult editorial choices and milestone moments.
- Never place Vesper over active prose or under dense form controls.

### Moth — Archivist of Forgotten Things

- Silver-haired supporting scribe.
- Cool moonlit palette and precise, dry temperament.
- Best associated visually with lore, research, memory, history and recovered fragments.

### Cinder — The Inkbreaker

- Copper-haired supporting scribe.
- Restless, playful and happily destructive toward bad drafts.
- Best associated visually with beginnings, experiments, alternate branches and revision energy.

These names are brand personas, not mandatory navigation labels.

## 5. Logo system

### Name treatment

Always write the product name as **Ink Morrow**, with both words capitalized and separated by one space. Use **InkMorrow** only where spaces are technically invalid.

### Mark

The supplied mark combines cat-ear silhouettes, a quill nib and an open manuscript. It must remain recognizable at 24 px.

Approved variants:

- mark alone for favicon, compact navigation and loading state;
- horizontal lockup for desktop headers and sign-in/onboarding surfaces;
- live-text lockup built from the mark plus HTML text when maximum sharpness is required.

Do not place the detailed character art inside the logo. Do not add paw prints to the wordmark.

### Clear space

Leave clear space equal to at least one-third of the mark width on every side. Never place the lockup directly over a face, bright candle cluster or detailed manuscript text.

## 6. Color system

The tokens are authoritative; the names explain their intent.

| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#09060D` | deepest application background |
| `ink-900` | `#100A16` | global dark surface |
| `ink-850` | `#17101F` | raised navigation and panels |
| `ink-800` | `#21142B` | interactive dark surface |
| `oxblood-700` | `#6E1834` | primary brand field |
| `oxblood-500` | `#A62B58` | primary action and active state |
| `rose-400` | `#DF6E9D` | expressive highlight |
| `violet-500` | `#8E63D8` | magic, branch and annotation state |
| `witchlight-400` | `#69D9CB` | rare supernatural accent and focus aid |
| `gold-500` | `#C7A35B` | borders, prestige and selected state |
| `gold-300` | `#E0C584` | bright gold text/icon accent |
| `vellum-100` | `#F2E7D2` | primary light text and paper surface |
| `vellum-200` | `#DFCEAE` | secondary warm text |
| `ash-400` | `#A99FB1` | quiet dark-mode text |
| `danger-500` | `#D64B58` | destructive action only |
| `success-500` | `#64B98A` | saved/success state |

### Usage ratios

- 55–65% ink and shadow surfaces.
- 15–25% vellum and readable text fields.
- 8–15% oxblood.
- 3–8% violet.
- 2–5% tarnished gold.
- Less than 2% witchlight turquoise.

Turquoise is a shock of supernatural ink, not a second corporate accent color.

## 7. Typography

### Recommended stack

- Display and wordmark: `Cormorant Garamond`, Georgia, serif.
- Reading and editor prose: `Literata`, Charter, Georgia, serif.
- Interface labels: `Inter`, system-ui, sans-serif.
- Metadata and marginalia: `IBM Plex Mono`, ui-monospace, monospace.

Use open-source fonts through the project's existing font pipeline. Prefer self-hosting when practical.

### Rules

- Display type may be extravagant; body and editor type may not.
- Reserve blackletter-like ornament for tiny decorative initials or image artwork. Never use it for paragraphs, navigation or form labels.
- Body text: 16–18 px outside the editor, line-height 1.55–1.7.
- Editor prose: user-adjustable 17–22 px, optimal line length 58–72 characters.
- Display headlines: fluid `clamp()` sizing, never below 34 px on tablet portrait or 36 px on tablet landscape.
- Do not use all caps for long labels. Small uppercase metadata requires generous tracking.

## 8. Illustration direction

### Approved visual language

- Mature painterly anime fantasy.
- European Gothic architectural influence without pretending to be historically exact.
- Velvet, vellum, ink, scratched wood, gold leaf, candle wax and moonlit stone.
- Dense detail in narrative focal areas; controlled shadow where HTML copy sits.
- Dramatic candle gold against bruised violet moonlight.
- The characters' natural feline ears and tails are anatomical parts, not costume accessories.

### Prohibited visual language

- pornography, lingerie, cleavage-focused framing or bedroom poses;
- childlike, teenage or chibi character proportions;
- maid outfits, school uniforms, leashes or coercive “pet” framing. Moth's
  approved narrow plum velvet collar and small bell are a specific archivist
  character detail, not a reusable costume convention;
- generic AI-SaaS gradients, cyberpunk neon or green code rain;
- copied anime characters or studio/franchise imitation;
- excessive skulls, gore or cheap Halloween motifs;
- embedded generated text, fake UI or watermarks;
- decorative checkerboards pretending to be transparency.

### Art-density budget by surface

| Surface | Visual share | Rule |
|---|---:|---|
| Home / project landing | 55–70% | full hero and illustrated cards are welcome |
| Story/library browsing | 30–45% | artwork supports scanning, not replaces titles |
| Onboarding / empty state | 35–55% | one character or narrative vignette |
| Active writing editor | 10–20% | quiet margins; prose wins |
| Settings / forms | 0–15% | use mark, texture or small ornament only |

## 9. Responsive art direction

Desktop and tablet are not the same layout at different widths. Portrait is the canonical tablet posture; landscape is a separately composed state, not the design baseline rotated sideways.

### Desktop — 1200 px and above

- Use `hero-scriptorium-desktop.webp` as the default hero artwork.
- Place hero copy in the darker left region; do not cover character faces, quill or manuscript.
- Hero height: approximately 68–78 dynamic viewport height, with a sensible minimum around 620 px and maximum around 900 px.
- Content frame: up to 1440 px with fluid side padding.
- Multi-column browsing may use three or four cards when titles remain readable.
- Navigation may show the full lockup.

### Tablet — 768–1199 px

- Assume the tablet is normally held vertically. Treat portrait viewports around 9:16 through 10:16 as first-class, not edge cases.
- In portrait, use `hero-scriptorium-tablet-portrait.webp`. It is a complete tall composition; show it as art-directed imagery rather than cropping the landscape scene.
- Keep the portrait's stacked faces, hands and manuscript visible. Put short real HTML copy in the dark lower fade only when contrast remains AA; otherwise give copy its own block immediately before or after the image.
- In landscape, use `hero-scriptorium-tablet-landscape.webp` and a compact translucent copy panel in the upper-left shadow.
- Do not rotate layouts mechanically. Reflow navigation, story cards, drawers and editor panels for the available inline dimension after every orientation change.
- Touch targets are at least 44 × 44 px, preferably 48 × 48 px for primary actions.
- Never require hover to expose actions, explanations or selection state.
- A single generous browsing column is preferred in portrait; use two columns only when card titles and actions remain comfortably readable. Landscape may use two columns.
- Test both physical orientation changes and browser resizing.

### Phone stretch goal — below 768 px

- Do not force the full scriptorium hero into a narrow crop.
- Use a CSS ink/oxblood/violet background with `vesper-quill.webp` as an optional foreground figure.
- Show no more than the upper half or a carefully placed scaled full figure.
- Collapse secondary ornament, floating pages, parallax and nonessential motion.
- Preserve navigation, editing, saving and destructive confirmation without horizontal overflow.
- A simpler but coherent phone experience is preferable to a cramped imitation of desktop.

### Reference `<picture>` pattern

Adapt paths and component syntax to the current stack:

```html
<picture class="im-hero__picture" aria-hidden="true">
  <source
    media="(min-width: 1200px) and (pointer: fine)"
    srcset="/brand/hero-scriptorium-desktop.webp"
    width="1672"
    height="941"
  >
  <source
    media="(min-width: 768px) and (orientation: portrait)"
    srcset="/brand/hero-scriptorium-tablet-portrait.webp"
    width="941"
    height="1672"
  >
  <source
    media="(min-width: 768px)"
    srcset="/brand/hero-scriptorium-tablet-landscape.webp"
    width="1448"
    height="1086"
  >
  <img
    src="/brand/vesper-quill.webp"
    alt=""
    width="941"
    height="1672"
    decoding="async"
    fetchpriority="high"
  >
</picture>
```

The `pointer` condition keeps a wide, coarse-pointer tablet on the tablet-landscape art while a conventional wide desktop receives the desktop hero. Treat this as a starting point: preserve orientation-specific art direction when adapting breakpoints to the application's actual device support.

Background art is decorative and uses empty alt text. When an illustration communicates a story-specific fact, render it as content with meaningful alt text instead.

## 10. Core screen archetypes

### Home / manuscript hall

- A strong illustrated hero with the primary line “Where stories grow claws.”
- One primary action, one secondary action at most.
- Recent projects presented as manuscript covers or illustrated story portals.
- The opening viewport should not look like a dashboard of interchangeable rounded rectangles.

### Story and project library

- Artwork-forward cards with readable title, state, last-edited time and actions.
- Card aspect ratio around 4:3 or 3:2, depending on existing data.
- Use gold for selected state, oxblood for primary actions and violet for branching/story-state metadata.
- Keep actions visible or available through an explicit touch-safe menu.

### Writing desk / editor

- Dark application chrome surrounding a calm vellum or deep-ink writing surface.
- The prose column remains visually stable while side panels open.
- Marginalia may appear as restrained annotations, not decorations behind text.
- Save state must be textually and visually clear.
- Character art belongs in optional assistant panels, onboarding and empty states—not over the manuscript.

### Character and lore surfaces

- Permit larger portraits and image-led headers.
- Long content still uses a readable text measure and visible hierarchy.
- Use Moth's cool palette for archive/lore emphasis and Cinder's warmer energy for experiments or branches only when the actual product concept supports it.

### Empty states

- One illustration, one sharp line, one clear action.
- Example: “Nothing here yet. Disgraceful.” followed by a plainly labelled action such as “Create a story”.

### Destructive confirmation

- Gothic flavor may support the message, never replace clarity.
- Title: “Burn this draft?”
- Body: identify exactly what will be deleted and whether recovery is possible.
- Buttons: `Cancel` and `Delete draft`, not ambiguous theatrical labels.

## 11. Component language

### Shapes

- Panels: subtly asymmetric or clipped corners are allowed; avoid covering every element with ornate frames.
- Standard radius: 10–16 px. Small controls: 7–10 px.
- Manuscript and feature cards may use decorative corner SVGs.
- Pills are reserved for status and filters, not every button.

### Borders and depth

- Use one-pixel warm translucent borders and selective gold emphasis.
- Prefer layered shadow, vignette and inner highlight over glassmorphism everywhere.
- Backdrop blur is acceptable for hero-copy panels but must have a non-blur fallback.

### Buttons

- Primary: oxblood field, vellum text, gold/rose highlight on hover or focus.
- Secondary: dark raised surface with gold border.
- Destructive: dedicated danger token; never reuse oxblood without a `Delete` label.
- Focus: witchlight outline plus a visible offset; do not rely on glow alone.

### Inputs

- Labels remain outside fields.
- Use vellum-on-ink or ink-on-vellum with clear borders.
- Placeholder text is never the only instruction.
- Error copy states what happened and how to recover.

### Icons

- Use the existing icon system where possible.
- Add only a small set of custom quill, manuscript, branch, seal and claw motifs.
- Icons must not become indecipherable pseudo-medieval glyphs.

## 12. Motion and interaction

Preferred effects:

- a single ink bloom on major reveal;
- wax-seal press on confirmed selection;
- short page-edge lift on card hover/focus;
- marginalia stroke drawing once as an element enters;
- subtle candle variance in decorative hero layers.

Limits:

- interaction motion: 140–240 ms;
- major reveal: up to 600 ms;
- no continuous motion near editor prose;
- no scroll-jacking;
- no pointer-following mascot;
- no parallax required for tablet;
- `prefers-reduced-motion: reduce` disables transforms, drifting pages, parallax and nonessential fades.

## 13. Voice and microcopy

The voice is literate, sharp, conspiratorial and playful. It may swear lightly where appropriate, but it must not sound like a teenager performing “edginess.”

### Good examples

- Primary CTA: **Start something dangerous**
- Returning state: **The manuscript remembers you.**
- Empty library: **Nothing here yet. Disgraceful.**
- Saved: **The manuscript remembers.**
- Unsaved: **Words waiting in the margin.**
- Generic recoverable error: **The ink has gone feral. Try again.**
- 404: **This page was eaten.**
- Revision prompt: **Kill the darling. Keep the blood.**

### Voice limits

- One flavorful sentence per state is usually enough.
- Buttons remain clear verbs.
- Errors include real recovery information.
- Never joke about lost work, privacy, billing or irreversible deletion.
- Do not put every sentence in a named scribe's voice.
- Avoid baby-talk, cat puns in every label, role-play dialogue and breathless anime catchphrases.

## 14. Accessibility

- Meet WCAG AA contrast: 4.5:1 normal text and 3:1 large text and graphical controls.
- Keyboard focus is always visible.
- Tablet targets are at least 44 × 44 px.
- Do not encode story state or validation through color alone.
- Decorative hero art is hidden from assistive technology.
- Important character/story images receive concise, literal alt text.
- Support 200% text zoom without clipped controls or horizontal page scrolling.
- Respect reduced motion and increased contrast preferences when the stack permits.
- The editor remains usable with images disabled.

## 15. Image performance

- Use the supplied WebP files in production; retain PNG files as masters.
- Supply intrinsic dimensions or an `aspect-ratio` to prevent layout shift.
- Load only the art variant appropriate to the viewport.
- The first-view hero may use `fetchpriority="high"`; lazy-load below-fold images.
- Do not preload desktop, tablet-portrait and tablet-landscape hero files simultaneously.
- Generate additional card art with consistent aspect ratios and focal-point metadata.
- Prefer a restrained CSS texture to repeating a large raster background.

## 16. Absolute anti-patterns

Reject the implementation if it becomes:

- a generic black-and-purple SaaS template;
- a pornographic catgirl landing page;
- a maid-café or school-anime theme;
- an unreadable fake-medieval manuscript;
- a motion-heavy game menu around a weak editor;
- a pile of rounded cards with random gold borders;
- one impressive desktop hero followed by unbranded application screens;
- a desktop layout merely shrunk to tablet;
- a landscape image cropped into a supposedly designed portrait hero;
- a tablet layout that depends on hover;
- a phone layout that downloads the largest artwork and hides it with CSS.

## 17. Implementation priority

1. Readability, behavior and data safety.
2. Desktop, tablet-portrait and tablet-landscape responsive structure.
3. Brand foundations, typography and tokens.
4. Hero and major picture-heavy states.
5. Writing-desk restraint and state clarity.
6. Motion and flourishes.
7. Phone stretch-goal polish.
