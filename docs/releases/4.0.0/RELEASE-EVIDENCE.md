# ScribeTribe 4.0.0-beta.1 release evidence

Evidence date: 2026-09-01

This record separates repeatable automated evidence from release-owner manual
work. A checked box is not inferred from an implementation claim.

## Evidence host

- Host: Windows NT 10.0.26200.0
- Node.js: v24.19.0 (supported contract: >=22.5.0)
- Chrome: 152.0.7977.65
- Source branch: `pr/19-beta-release`
- Reviewed release base: `6861be3` (merged PR 20 art/branding layer, after PR 18)
- Candidate identity: `4.0.0-beta.1`; the canonical cutover SHA is recorded by
  the PR 19 merge and `v4.0.0-beta.1` tag rather than duplicated speculatively
  in this pre-cutover tree

## Automated evidence

| Gate | Evidence | Result |
|---|---|---|
| Lint | ESLint over backend, frontend, and e2e | Pass |
| Backend | Complete Jest suite, including transfer attacks, publication, sharing, auth, and release-scale fixture | Pass (26 suites, 290 tests) |
| Frontend | Complete Jest/jsdom suite | Pass (28 suites, 241 tests) |
| Browser desktop | Playwright current Chrome/Chromium project | Pass (48/48) |
| Browser mobile | Playwright Mobile Chrome project | Pass (39/39; 9 viewport-matrix duplicates intentionally skipped) |
| Accessibility | axe-core WCAG 2.0/2.1 A/AA scan of Library, Desk, Chronicle, Codex, Gallery, Gate, and public share; lock focus/keyboard assertions | Pass (2/2 in desktop and Mobile Chrome projects) |
| Archive round trip | Strict v2 schema/hash validation, portable table-group equality, media digest equality, semantic re-export equality | Pass |
| Archive adversarial input | Traversal, duplicates, undeclared entries, compression/size limits, hash mismatch, relationship checks, future/3.x refusal, publication-snapshot tamper, excluded recovery field | Pass in focused transfer suite (13/13) |
| Production dependency audit | npm registry advisory service over 117 locked backend production packages | Pass (no findings); CI repeats `npm audit --omit=dev --audit-level=moderate` after clean install |

PR 19 local repeat on 2026-09-01 after the version, current-claim, legal,
privacy, security, and screenshot freeze:

- ESLint over backend, frontend, and e2e: pass;
- backend Jest: 26 suites / 290 tests pass;
- frontend Jest: 28 suites / 241 tests pass; and
- six current README screenshots were captured from an isolated in-memory
  server at 1440x900 and 768x1366, visually reviewed, and confirmed without
  horizontal overflow.

GitHub CI on the release-candidate PR remains the authoritative clean-checkout
repeat for lint, Jest, production dependency audit, and both Playwright
projects. Its URLs and final conclusions stay attached to the pull request.

The deterministic release fixture contains 10 volumes, 100 chapters, 3,000
pages, 1,200,001 words, 150 recurring characters, 10,000 continuity facts,
and 500 image records. It also contains revision copyedits, a correction, a
prepared operation, a recovery suffix, one publication snapshot, and one share.
The archive deliberately excludes the recovery/share credentials while
preserving every portable selected row and media object.

Measured fixture phases on the evidence host:

| Phase | Time | Budget |
|---|---:|---:|
| Build deterministic fixture | 577 ms | <60,000 ms |
| Stream archive export | 1,916 ms | <60,000 ms |
| Preflight and transactional import | 4,784 ms | <60,000 ms |

The focused Jest process completed the test body in 9.8 seconds; runner startup
and teardown are outside the phase budgets. These desktop measurements do not
replace the required reference-tablet measurement or establish a future
performance baseline.

Structural responsive automation covers 1440x900, 1280x800, 1180x820,
1024x768, 768x1366, 800x1280, 820x1180, 960x1536, and 390x844; it checks navigation mode, horizontal overflow,
touch-target size, critical actions, manuscript contrast, and decoded artwork.
The axe suite forces reduced motion. Pixel-level visual judgment and 200% zoom
remain manual checkpoints rather than falsely claimed screenshot baselines.

Publication adapter/package/semantic evidence is recorded in
[PUBLICATION-EVIDENCE.md](PUBLICATION-EVIDENCE.md).

## Manual release-owner checkpoints

These items remain **pending** until a release owner records the exact device,
application/version, outcome, and artifact or observation:

- [ ] Clean install from the README by someone outside the implementation
      context.
- [ ] Desktop Chrome manual critical journey, including lock/restart/password
      change and no private-route flash.
- [ ] Real Android tablet portrait (768x1024 reference) authoring loop.
- [ ] Real Android tablet landscape (1024x768 reference) authoring loop.
- [ ] Keyboard-only critical journey, visible/restored focus, screen-reader
      announcements, 200% zoom/reflow, and on-screen-keyboard resilience.
- [ ] Dark/light manuscript themes and reduced-motion visual review.
- [ ] Backup/restore into a clean data directory, followed by catalogue/media
      comparison and a second validated export.
- [ ] Representative DOCX, ODT, EPUB, and PDF opened in mainstream
      readers/editors, with product and version recorded.
- [ ] Short-lived public share viewed signed out over HTTPS, then revoked;
      proxy and application logs inspected for the capability/private canaries.
- [ ] Reference-tablet long-manuscript timing and comparison to the accepted
      baseline.
- [ ] Production dependency audit reviewed with no critical/high supported-path
      finding.
- [ ] Final known-issues triage and explicit stakeholder go/no-go decision.

PR 18 can provide the implementation and repeatable evidence, but it cannot
invent device observations or the stakeholder decision required for PR 19.

## Stakeholder sequencing record

On 2026-09-01 the stakeholder explicitly set the dependency order to PR 18,
the approved asset PR, then PR 19, with the user guide after PR 19. After the
asset PR merged green, the stakeholder instructed the implementation agent to
resume PR 19. That authorizes release-candidate and cutover preparation; it is
not used to fabricate any still-pending real-device or manual observation.
