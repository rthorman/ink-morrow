# OpenCode / GLM-5.3 implementation contract

## Mission

Transform the existing web frontend into **Ink Morrow**, a picture-rich gothic interactive-fiction writing environment inhabited by adult anime catgirl scribes.

The result must feel like a forbidden manuscript waking up around the writer: sumptuous, literary, mischievous and dangerous. It must remain an effective writing application rather than becoming an illustration gallery that happens to contain controls.

## Instruction precedence

1. Preserve working application behavior, data integrity and security.
2. Follow this implementation contract.
3. Follow `INKMORROW-FRONTEND-BRAND.md`.
4. Use `design-tokens.json`, `ink-morrow.tokens.css` and `assets/brand/` as implementation inputs.
5. Use `ACCEPTANCE-CHECKLIST.md` as the definition of done.

When existing code conflicts with the brand specification, adapt the presentation layer without inventing new product behavior. Ask only when code inspection cannot resolve a material ambiguity.

## Non-negotiable constraints

- Desktop and tablet are equal-priority, fully designed experiences. Tablet is portrait-first, with a separate landscape composition.
- Phone is a stretch goal: prevent breakage and provide a deliberately simplified experience.
- Preserve existing routes, editor behavior, persistence, authentication, API contracts and user content.
- Do not rewrite the framework, state layer or component library merely to apply branding.
- Do not replace existing dependencies unless a demonstrated incompatibility requires it.
- Do not put generated lettering inside raster artwork. Interface text remains real HTML.
- Do not sexualize the characters. They are clearly adult literary professionals, not maids, schoolgirls, pets or pin-ups.
- Do not ship fake checkerboards. `vesper-quill.png` contains genuine transparency.
- Do not let ornamental art reduce editor legibility, hide controls or capture pointer events unexpectedly.
- Do not use hover as the only way to reveal an action; tablets are touch-first.
- Do not claim completion until builds, tests and responsive checks have been run.

## GLM-5.3 working discipline

GLM-5.3 is capable of long autonomous work but can over-investigate, over-explain and expand scope. Counter that tendency explicitly:

- Build one persistent repo map and reuse it; do not repeatedly reread the entire repository.
- Keep a short task ledger: `pending`, `working`, `verified`, `blocked`.
- Make the smallest coherent changes that satisfy the approved plan.
- Never “improve” unrelated business logic while branding the frontend.
- When a command fails, read the actual failure, diagnose it and rerun the narrowest relevant check.
- Do not create duplicate components because an existing component was overlooked.
- Do not stop after producing a plan, screenshots, placeholders or unconnected CSS.
- Do not spend tokens narrating obvious edits. Spend them on inspection, implementation and verification.
- If an asset or feature does not exist, use an honest static fallback instead of fabricating functionality.

## Required workflow

### Stage 0 — Reconnaissance; no edits

Identify:

- framework, renderer and package manager;
- application entry points and route structure;
- current layout primitives and styling system;
- editor surface and content persistence boundaries;
- existing responsive rules and breakpoints;
- icons, fonts and image pipeline;
- available lint, typecheck, test and build commands;
- current visual regression or browser-testing facilities.

Return a plan before editing unless the user explicitly tells you to proceed immediately.

### Stage 1 — Foundations

- Integrate semantic Ink Morrow tokens with the existing styling system.
- Add fonts using the project's established loading method; self-host where the project already supports it.
- Add the vector mark, lockup, favicon and approved production images.
- Establish base surfaces, focus rings, selection colors, typography and reduced-motion behavior.
- Verify no existing functionality changed.

### Stage 2 — Application shell

- Brand the header, navigation, page frame and global background.
- Keep navigation labels functionally accurate. Gothic wording may support labels but must not obscure them.
- Make tablet navigation touch-safe and orientation-aware; portrait is the normal posture, including tall 9:16 and 10:16-class screens.
- Keep active, focus and disabled states unmistakable.

### Stage 3 — High-imagery surfaces

- Implement the responsive home/dashboard hero using the supplied desktop, tablet-portrait and tablet-landscape art direction. Do not substitute cross-orientation cropping for the dedicated tablet assets.
- Use illustrations on onboarding, project/story selection, empty states and major milestones.
- Turn story/project cards into visual manuscript covers where the existing data supports imagery.
- Keep text, calls to action and accessibility metadata in markup.

### Stage 4 — Writing surfaces

- Give the active editor a calmer visual density than the home surface.
- Keep the text column readable, stable and free from decorative obstruction.
- Use scribe characters as optional margin presences, assistant panels or empty-state anchors—not as persistent overlays on prose.
- Make save state, unsaved state, errors and destructive actions unambiguous.

### Stage 5 — Interaction and motion

- Add restrained ink-bloom, page, seal and marginalia motion using existing animation facilities or lightweight CSS.
- Ensure every effect has a reduced-motion state.
- Never animate continuously behind active writing.
- Verify touch, keyboard and pointer interactions independently.

### Stage 6 — Verification

Run the project's applicable:

- formatter;
- linter;
- typechecker;
- unit and integration tests;
- production build;
- browser or visual checks.

Check at minimum:

- 1440 × 900 desktop;
- 1280 × 800 compact desktop;
- 1180 × 820 tablet landscape;
- 1024 × 768 tablet landscape;
- 768 × 1366 tall tablet portrait;
- 800 × 1280 tablet portrait;
- 820 × 1180 tablet portrait;
- 390 × 844 phone stretch-goal sanity check.

Use the exact acceptance criteria in `ACCEPTANCE-CHECKLIST.md`.

## Completion report

Report only:

1. what was changed;
2. which responsive compositions were implemented;
3. which commands and checks passed;
4. any remaining failure or deliberate phone compromise;
5. exact files containing the main brand implementation.

Do not declare success based solely on a successful build.
