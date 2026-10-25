# Ink Morrow recovery — roundtable review record

**Status:** complete, 25 October 2026. Two specialist passes are recorded; final guide 1.0 incorporates both final-pass corrections. This is planning/design consistency acceptance, not implementation or device/narrative certification.

The stakeholder requested a detailed implementation guide followed by review and refinement by the architecture, UI/usability, behavioral and fiction/narration specialists. The coordinator wrote the complete draft before reconvening the reviewers.

## Review inputs

- Draft 0.1 of [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md), approximately 7,550 words, written against the current main implementation.
- An unchanged local draft snapshot at [archived draft 0.1](archive/IMPLEMENTATION-DRAFT-0.1.md).
- Refined draft 0.2, approximately 13,000 words, with an unchanged review snapshot at [archived draft 0.2](archive/IMPLEMENTATION-DRAFT-0.2.md).
- Current and retained source, project instructions, the earlier recovery proposal and the specialists' initial source-based findings.

## Review procedure

1. Each specialist reviews the complete draft independently and writes material findings with section references, severity and concrete remedies.
2. The coordinator reconciles the findings, resolves routine engineering choices and revises the guide.
3. The specialists receive the refined guide and cross-discipline changes for a final consistency pass.
4. This record lists accepted changes, any declined recommendations with reasons and genuine product decisions still pending.

## Specialist reports

- [Architecture](reviews/architecture.md)
- [UI and usability](reviews/ui.md)
- [Behavior and agency](reviews/behavior.md)
- [Fiction and narration](reviews/narrative.md)

## Scope of this task

Only planning and review documentation is being created. No application implementation, deployment, server startup, paid provider evaluation or merge is performed. Proposed behavior is distinguished from implemented behavior. Optional prose editing and old-series conversion remain explicitly recorded policy choices; neither prevents completion of the guide.

## Findings and dispositions

The first pass returned 43 review items across the four reports: architecture AR1–AR10, UI UI-01–UI-13, behavioral items 1–12, and narrative N1–N8. Findings were engineering/design gaps to resolve in the guide, not observations from a new live app or user study.

| Review items | Disposition in refined guide |
|---|---|
| AR1, UI-02/03, behavior 4 | Sections 4–5 and 8 now distinguish actual graph head, narrative tail, inspection moment, selected history entry and presentation edition. Every mutation names its destination; browsing is separate from branch activation. |
| AR2, AR4 | Sections 4.4 and 17 define same-story/subject ancestry, producers, atomic publication, closed collection roots, explicit count/byte limits and all historical/unplaced images in save closure. |
| AR3 | Sections 17–18 freeze v1 structural dependencies and old migration checksum sources, including genuine baseline fixtures and mixed old/new state versions. |
| AR5, behavior 1/3 | Sections 5–6, 13 and 17 specify durable local/import receipts, pre-story draft IDs, submitted draft/action identities and absent-status uncertainty. |
| AR6–AR8, UI-09/10 | Sections 13–16 separate dispatch claim/cancellation, production and attachment, immutable editions, source pins, race-safe collection, per-call accounting and one playback controller. Appendix A adds file-publication/restart behavior. |
| AR9, N3 | Section 12.3 budgets transport-normalized draft/review/repair payloads before purchase, including reasoning/output growth and smaller reviewer capacities. |
| AR10, UI-05, behavior 2/7 | Sections 4, 6 and 11 cover typed draft scopes, acknowledged saving/offline limits, immediate Lock, exact submitted seeds, comparison and transient native files. |
| UI-01/06 | Section 7 defines scroll ownership, modal keyboard-open tasks, module lifecycle, bounded task suspension, semantic focus and Back/return descriptors. |
| UI-04, behavior 5 | Sections 18–19 require useful adapters in every room before shell cutover, preserving every existing workflow. Private publication is explicitly independent of audio/sharing completion. |
| UI-07/08/11/12 | Sections 7, 11, 15–16 specify scoped Settings, Library/setup, Bookshelf, playback and Gate tasks. Existing brand assets and surface-specific composition have concrete rules; new art purchases are unnecessary. |
| UI-13, behavior 12, N8 | Section 20 records discriminating real-tablet tasks, acknowledged-draft/race cases, complete narrative journeys, separate evidence classes and provisional measured performance targets. |
| behavior 6 | Section 13 adds visible remembered-consent choice, per-family reset, exact current quantity and a distinction between future approval reset and active-run cancellation. |
| behavior 8, N5 | D1 and section 10.1 explicitly choose the future-prose source policy; the differing recommendation and remaining risk are recorded below. |
| behavior 9 | Section 12.4 separates Pause from End, supplies optional closure/default titles, and uses an append-only compensating undo when valid. |
| behavior 10/11 | Sections 5, 8 and 10 define refusal repair independently of fiction, private-planning transitions and source-filtered public evidence. |
| N1 | Sections 10 and 12 separate established scene circumstances/private facts from proposed scene plans, motivation and descriptive references. Free-text conflict checks are not claimed complete. |
| N2 | Section 12 defines speaker/focal identity, ensemble/control independence, temporary versus persistent overrides and language relationships. |
| N4 | Section 12.4 defines claim/source taxonomy, goal dispositions, conditional Say performance and explicit structural-versus-semantic limits; new protocol shapes must serialize with the state/save changes. Its initial unconditional speech-rendering rule was corrected in the final pass below. |
| N6 | Section 12.4 replaces the arbitrary four-turn quiet deadline with category fairness and recorded eligibility reasons. |
| N7 | Section 12 retains the 50–2,000 advanced range, labels presets as calibration and tests source retrieval beyond recent/working-set windows using stable identities. |

### Resolved disagreement: D1 and future prose context

The behavioral reviewer recommended effective edited prose as future recent context, with original facts/evidence authoritative. The narrative reviewer preferred original-only context as the safer initial policy, while explicitly allowing a different documented choice with its risks.

The coordinator chose effective wording for the **recent prose presentation** category, preserving original event/fact/knowledge evidence and explicit correction precedence. This keeps optional editing useful for the continuity of the telling. The guide openly states that a model can misread contradictory rendered prose and that no validator proves an arbitrary copyedit meaning-preserving. It does not turn an edit into new canonical event evidence or silently retcon a ruling. D1 acceptance includes this source policy; it remains gated before any feature is enabled. The final narrative pass is asked to verify that the alternative is explicit and its limitations are accurately represented.

### Other reconciliation choices

- The first shell includes useful adapters in all five rooms. B1 remains internal-only until those adapters preserve current tasks; richer room functionality follows in the planned batches.
- Unregistered/absent request status remains uncertainty. A deliberate identical application-command recovery can reuse the original key; this is distinct from retrying provider transport. A replacement key requires a terminal result or cancellation fence.
- Scene category fairness replaces a fixed literary rhythm. Proposed opportunity and actual event remain separate.
- The active branch remains the fiction-mutation boundary. Immutable edition creation/unplaced result production binds its explicit source independently; attachment and preferred-edition changes have separate authority.
- Routine parameters such as draft expiry, initial media bounds, layout fallback and provisional latency targets are documented engineering choices for fixture/device calibration, not new permission questions.

No initial finding was dismissed as a reason to skip the core recovery. Some requests are conditional by design: optional copyediting, old-series conversion and image conditioning remain explicit scope/policy gates; live model evaluation remains separately authorized.

## Final consistency pass

All four specialists read refined draft 0.2 and the combined dispositions. Their appended final-pass reports are retained in the linked specialist files.

| Reviewer | Final-pass outcome | Final disposition |
|---|---|---|
| Architecture | Initial AR1–AR10 substantively addressed; one remaining scope contradiction between path revisions and independent inventory/artifact commands. | Version 1.0 scopes producer/ancestry/row-count rules to the four branch revision collections, adds noncanonical inventory ownership and tagged command authority, and prevents auto-placement during conflicting narration. |
| UI/usability | No remaining planning-blocking contradiction. | Preserves conditional acceptance through populated prototype and real Android IME/Back/rotation/enlargement/focus tasks; no visual runtime approval claimed. |
| Behavioral/HCI | No remaining planning-blocking contradiction. | Preserves implementation gates for delayed-command races, acknowledged drafts/Lock, explicit targets, consent, accounting and actual tablet journeys. |
| Fiction/narration | Integrated N1–N8 coherent; D1 alternative accurately specified; one remaining issue with unconditional performance of Say. | Version 1.0 requires performed/attempted/interrupted/not-performed status and narrated support, renders exact words only when performed, and treats hearing/belief/agreement separately. All consumers share the final assembled source. |

The coordinator raised the interrupted-speech case during the final narrative pass, and the reviewer confirmed its materiality and precise remedy. Both requested final corrections were applied and given explicit regression cases in section 20.1. The architect and fiction reviewer each stated that after their narrow correction no other planning-blocking contradiction remained. The final text is a coordinator integration of those conditional remedies; this record does not pretend that a new application was built or that all reviewers ran the resulting code.

### Final consistency checks

- Path-changing commands require current active branch/game/head authority; drafts/catalogue work, imports and source-bound editions use their own tagged resource authority.
- Gallery inventory is noncanonical; unplaced assets have independent save ownership and do not need fictitious history events.
- Interrupted speech cannot manufacture an utterance, promise, audience knowledge or agreement. Semantic performance classification remains fallible.
- Current workflows remain reachable from useful room adapters, and private book delivery has no audio dependency.
- Old saved data/checksums remain protected through explicit versioned compatibility; new durable records require complete save closure/remapping.
- D1's source choice and its limitations are visible. Optional editing, old-series conversion, later image conditioning and release naming are recorded future product choices rather than hidden engineering assumptions.

Only the six planning/review Markdown files were added. Coordinator checks passed: all local links resolve, code fences are balanced, whitespace/final-status checks are clean, release identities still agree, and the shipped six-PDF freshness check remains valid. Git verification confirms no application, test, package, instruction or contribution files changed. No application test suite was run for this documentation-only work, and no manuals needed regeneration because runtime behavior was unchanged.

No server startup, paid provider call, deployment, merge, new user study or live-model certification occurred in this task.

## Version 4.1 baseline amendment — guide 1.1

After the specialist passes, branch/source inventory established that the final historical comparator must be Version 4.1.0, schema 18, at `74741f7`, rather than the original 4.0 beta. The stakeholder explicitly requested this upgrade, branch pruning and persistence of all planning/state documents on main.

Guide 1.1 adds a source-linked 4.1 preservation matrix, an accountable campaign-state adapter, a distinct B9 solo-tools follow-on and parity gates for B0/B8. Scene planning, play-control boundaries, campaign evidence, local tools and historical portability now have explicit dispositions. It preserves the V5 fiction graph, excludes the separate old transcript authority and does not approve optional manual prose editing or old-series conversion.

This amendment is a coordinator source-based revision. The four specialists have **not** reconvened for a third review pass. The original reports remain unchanged; their acceptance applies to guide 1.0, with the amendment separately visible for later review. The earlier statements about no commit/merge concern that original planning stage, not the later stakeholder-authorized documentation publication and cleanup.
