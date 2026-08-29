# ScribeTribe frontend branding package

This package is written for an existing web frontend that will be inspected and modified by **OpenCode using GLM-5.3**. It is an implementation brief, not a mood board.

The brand premise is simple:

> **ScribeTribe is a living forbidden manuscript where stories grow claws.**

Desktop and tablet are first-class targets. Tablet is **portrait-first**, including tall 9:16 and 10:16-class viewports, with a separate landscape composition. Phone support is a stretch goal and must simplify gracefully rather than squeeze a larger composition into a narrow viewport.

## Package contents

- `OPENCODE-GLM53-TASK.md` — executable implementation instructions for the coding agent.
- `SCRIBETRIBE-FRONTEND-BRAND.md` — normative visual, responsive, character, voice and interaction specification.
- `ACCEPTANCE-CHECKLIST.md` — objective completion and regression checks.
- `design-tokens.json` — machine-readable tokens.
- `scribetribe.tokens.css` — ready-to-adapt CSS custom properties.
- `opencode.instructions.fragment.jsonc` — fragment to merge into an existing OpenCode configuration.
- `ASSET-MANIFEST.json` — dimensions, responsive roles, focal points and text-safe regions.
- `IMAGE-CONTINUATION-BRIEFS.md` — prompts and invariants for extending the illustrated system.
- `assets/brand/` — approved artwork, vector marks and production image variants.

## Add it to an existing project

1. Extract this directory into the project without replacing existing application files.
2. Preserve any existing `AGENTS.md` and `opencode.json`.
3. Merge the `instructions` entries from `opencode.instructions.fragment.jsonc` into the project's existing `opencode.json` or `opencode.jsonc`.
4. In OpenCode, select GLM-5.3 and begin in **Plan** mode.

OpenCode supports project instruction files through the `instructions` array in `opencode.json`; the current documentation is at <https://opencode.ai/docs/rules/>.

## First OpenCode prompt — Plan mode

```text
Read every ScribeTribe branding instruction loaded by this project. Inspect the existing frontend, routes, styling system, assets, build commands and tests. Do not edit anything yet.

Return:
1. a concise map of the current frontend;
2. conflicts between the current UI and the ScribeTribe specification;
3. a staged implementation plan that preserves existing behavior;
4. the exact files you expect to touch;
5. unresolved product questions that code inspection cannot answer.

Desktop and tablet are equal-priority targets. Treat portrait as the normal tablet posture and use the dedicated portrait artwork; landscape has its own composition. Phone is a stretch goal. Do not propose a framework rewrite or unrelated feature work.
```

Review that plan. Then switch OpenCode to **Build** mode.

## Second OpenCode prompt — Build mode

```text
Implement the approved ScribeTribe branding plan according to OPENCODE-GLM53-TASK.md and SCRIBETRIBE-FRONTEND-BRAND.md.

Use the supplied production assets and tokens. Preserve application behavior and data flows. Work in verified stages, run the relevant checks after each stage, and finish the complete responsive implementation—not merely a mockup or one hero screen.
```

## Important operating rule

The supplied words and artwork establish the direction. OpenCode may adapt component structure to the existing framework, but it must not quietly replace the identity with a generic black-and-purple SaaS theme, a cute maid-cat aesthetic or a pornographic pin-up treatment.
