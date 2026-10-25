# Fiction and narration review of recovery guide 0.1

Reviewed 25 October 2026. Read the complete guide and checked the current fiction service, domain model, director, episodes, quality pipeline and save validator, together with retained writing, revision, scene and publication behavior. This is a design review, not a live narrative comparison. No application code, server, deployment or paid provider evaluation was changed or run.

The guide's direction is sound: recover sustained literary experience and creative control around the V5 graph rather than replace playable fiction with a compulsory writing desk. The items below need resolution before their affected implementation batches. None prevents writing or refining the guide. D1 and D2 remain explicit product gates.

## N1 — High: scene framing and reference revision can still masquerade as fictional events

**Sections:** 4.2–4.3, 10, 12.1–12.2; before B3.

The guide correctly distinguishes references from events, but a local configuration command can change location, time and present cast without defining whether it records current truth, proposes a future scene or merely annotates existing prose. “Reference intent/private truth where applicable” also leaves two different authorities in one phrase. A private foundation such as a fixed mystery solution is truth despite remaining undiscovered; a character's plan is not an accomplished event. Plain-text conflict detection cannot reliably distinguish these.

**Replace the scene/reference authority passages with:**

> Scene framing separates established circumstances from proposed direction. Current location, fictional time, present cast and completed transitions refer to accepted narrative evidence or an explicit owner fact declaration. A next-scene plan may propose a location, time cut, participants or purpose without asserting that anyone moved, arrived or agreed. Saving that plan is local and does not advance fictional time. A generated transition records its occurrence only when the accepted beat establishes it. Annotating an earlier scene changes organization, not what happened there.
>
> References supply baseline description, private background and motivation under explicit field labels. They do not outrank later authoritative facts or corrections. Enduring private truths that must constrain play use declared fact identities; reader visibility and character knowledge remain separate from truth. An adopted reference revision does not automatically rewrite those facts or promote wants and future plans into completed history. The comparison shows known explicit overlaps and offers factual correction or a fork when the owner intends a retcon. Free-text semantic conflicts cannot be detected completely: do not claim that a local save has proved consistency. Preserve and label unresolved source differences, and compile effective authoritative facts ahead of conflicting baseline reference descriptions.

**Acceptance additions:**

- Saving “next scene: winter at the castle” leaves current time, location, knowledge, resources and cast presence unchanged; a failed generation leaves that plan unconsumed and truth unchanged.
- A narrated time cut may establish the new circumstances, with source evidence. Forking before it restores the old circumstances and applicable plan.
- A reference changing an established eye color does not silently defeat the current fact. A private fixed solution is not reclassified as a mere stylistic preference; changing it requires the explicit truth-changing path.
- A motive such as “wants to leave” remains motivation. Reference adoption alone never creates “has left.”

**Source:** [current reference/context authority](../../../backend/src/modules/fiction/service.js#L36); [explicit correction authority](../../../backend/src/modules/fiction/store.js#L164).

## N2 — High: perspective, language and craft need executable scope rules

**Sections:** 12.1–12.2, 10; before B3.

The proposed settings are useful, but “optional viewpoint cast ID” is insufficient for first-person or close-third narration. Flexible perspective has no transition rule, and current contribution outranks perspective settings without saying whether a momentary direction persists. All of these are independent of who the user controls. A language tag for prose must also have an explicit relationship to export metadata and speech capabilities.

**Add after the first paragraph of 12.1:**

> First-person requires a declared narrative speaker; close-third requires a focal cast member. A first-person speaker may be a cast member or an explicitly defined framing narrator, never an assumed reader, avatar or Scribe persona. Selecting a narrative speaker or focal person does not grant player control or make that person the mandatory lead. Flexible perspective permits an intentional change at a scene boundary; unmarked mid-scene head-hopping is not the default. Omniscient narration may reveal different minds only within the selected disclosure policy and ownership boundary. The effective contract names tense, prose language, focal perspective and the source/scope of each value. A momentary direction may request a temporary variation; it does not save a new branch default. Persistent changes use the local configuration command and restore on fork.
>
> Inhabit retains its existing protection of decisions, speech, thoughts, feelings and commitments. A first-person or close-third focal setting does not authorize invented interiority for an inhabited person. Keep the chosen perspective, render only authorized content and surrounding circumstances, and stop before the protected decision. Do not silently release control or switch viewpoint to escape the boundary. A Scribe's preference for interiority remains subordinate to that rule.
>
> Prose language is a generation setting, distinct from the edition's language metadata and the speech provider's supported languages. Default a new edition's language from its selected source, show any override, and flag mixed-language editions explicitly. Selecting a language does not assert that a configured speech model supports it.

**Amend 12.2:** describe the list as authority domains, not permission for a higher-ranked wish to mutate lower-ranked state. Current input is interpreted under binding truth/control; persistent POV/tense/language changes must not be inferred silently from dialogue or reference text. Show effective Scribe settings and explicit overrides, rather than blending incompatible profiles invisibly.

**Acceptance additions:**

- First-person without a declared speaker, or close-third without a focal identity, fails before purchase with a local repair action; choosing either does not call Inhabit or assume the reader is that person.
- A six-person ensemble can change spotlight without creating a protagonist hierarchy. Perspective and control survive save-copy and fork independently.
- A momentary “use present tense here” does not alter the next turn's saved tense. A deliberate branch-level change does.
- An interiority-heavy Scribe does not authorize an inhabited character's new feelings. Separate mechanical ownership-source checks from later human judgment of prose compliance.
- A Japanese or French scene is not rejected by an English-only length/language heuristic; book and speech settings identify their actual language assumptions.

**Source:** [current ownership and style contract](../../../backend/src/modules/fiction/service.js#L27); [Scribe craft vocabulary](../../../backend/src/modules/scribes/store.js#L11).

## N3 — High: input budgeting alone cannot support the promised length and quality modes

**Sections:** 12.3, 13; before B3.

The draft introduces a 2,000-word target but does not specify how complete JSON, effects, review evidence and repair messages fit. Current narration uses fixed output budgets; quality calls append the candidate, and a repair additionally includes prior raw output and issues. A draft can fit while a selected reviewer or repair cannot. Pricing a valid draft and discovering an impossible review plan afterward is avoidable.

**Replace the budget paragraph with:**

> Preflight a stage-specific token plan for every permitted draft, review and repair call before the first paid dispatch. Each plan includes its model's input/context/output limits, protocol and schema overhead, immutable authoritative context, maximum serialized candidate/issue size where applicable, and an output reserve for the entire response object. The narration reserve covers target prose plus bounded summary, effects, resolution and optional aside; it is not a words-to-tokens multiplier for prose alone. Bound aggregate candidate metadata as well as individual fields. Revalidate the actual candidate against subsequent stage plans before dispatch. Selected review roles cannot be silently dropped or given contradictory authority to make them fit.
>
> Length remains a target, not a hard minimum or permission to pad. Use provider-supported token counting when available; otherwise apply a documented conservative bound to the complete serialized message set and explicit model capacities. A word target does not determine output-token capacity, especially across languages. A model/quality combination that cannot support the selected target receives a repairable pre-purchase explanation and supported alternatives, with no automatic downgrade or purchase. Invalid/truncated responses retain the existing bounded failure/repair and accounting behavior.

**Acceptance additions:**

- Test maximum permitted structured metadata at brief, developed and advanced targets, with and without an aside/adjudication.
- A small-context memory reviewer can make an otherwise valid extended plan unavailable before any call. Both mode cannot quietly become Standard.
- An actual larger-than-planned candidate cannot overflow the review or repair context. A rejected paid draft is accounted for without committing it.
- Longer prose and multibyte language change plan sizes correctly. An early owned-character decision can finish well below target without being padded or rejected solely for brevity.

**Source:** [current fixed narration budgets](../../../backend/src/modules/fiction/service.js#L141); [candidate/review/repair payloads](../../../backend/src/modules/fiction/quality.js#L37).

## N4 — High: define evidence authority and goal dispositions, not one new outcome label

**Sections:** 10, 12.4, 17.1, 20.1; before B2 evidence shapes and B3 effects.

“Add an explicit proposed outcome classification” is not yet a schema or policy. An intention can legitimately become a remembered desire or goal. A failed attempt can legitimately spend a resource. A spoken claim establishes what was said or believed, not necessarily its truth. Also, resolving an abandoned goal is different from achieving it; current `active/resolved` does not preserve that distinction. Episode payoff must not become a success stamp for every resolved record.

**Replace the first two paragraphs of 12.4 with:**

> Evidence records source authority separately from the proposed claim. Sources distinguish canonical narration, submitted owned intent/speech and explicit owner declaration; each quotation identifies its original field. Ask, summaries, fourth-wall asides, display overlays, rejected candidates and editorial wishes cannot establish in-world outcomes. Act/Say input authorizes only the supplied character content. A proposed action is not a completed action; a commitment based on supplied speech also needs the accepted fictional turn to establish that the utterance occurred. Define this performance rule consistently in narration, evidence, publication and audio, rather than leaving a promise in memory that the reader never heard made.
>
> Distinguish intention, attempt, reported claim/belief and occurred event in generated proposals. Remembering an intention as an active desire/goal is valid. Resolve, revelation and resource-change proposals must identify the occurred event supporting their actual change; a failed attempt can support a narrated cost without establishing the desired success. Separate the fact of a claim being spoken from the truth of its content. Explicit owner declarations remain a separate local authority, never a privilege inferred from Steer text.
>
> Resolved goals record a disposition such as achieved, abandoned, failed or superseded, with evidence. Do not invent a disposition for legacy resolved goals; retain a labelled legacy resolution. Episode closure kind is player-selected and independent of those dispositions. A goal-based payoff can cite what actually resolved and how; closure never implies that outstanding goals were achieved. Emotional satisfaction remains a human judgment, not an enum or timer.
>
> Source-kind/op compatibility and ancestry are deterministic checks. The truth of a classification and whether a quote entails a claim remain semantic limits: the model can mislabel future intent as an occurred event. Optional quality can reject concrete conflicts within its existing ceiling; Off does not silently purchase a judge or promise semantic proof.

**Acceptance additions:**

- “Ada intends to find the key tomorrow” may support a goal, not its achievement. A model falsely labelling that sentence as an occurrence remains an explicit semantic test, rather than a claimed solved parser problem.
- “The search failed and Ada paid the boatman” may justify a cost while leaving finding the key unachieved.
- A character falsely saying “the key is iron” records a claim/knowledge state without replacing the protected fact that it is brass.
- An interrupted or merely contemplated promise cannot enter memory as an uttered commitment. A successfully performed supplied promise retains both owned wording authorization and occurrence evidence.
- Abandoned and achieved goals remain distinguishable after save-copy and fork. A goal-free vignette can close with no synthetic goals/effects; reopening does not mark any old goal achieved.
- The new source/disposition shapes land with old/new state readers, reducers, projections and strict save validation in the same slice.

**Source:** [current quote-only effect checks](../../../backend/src/modules/fiction/model.js#L130); [current goal-based phase calculation](../../../backend/src/modules/fiction/episodes.js#L16); [strict current save shapes](../../../backend/src/modules/fiction/saves.js#L95).

## N5 — High, conditional on D1: specify which prose future narration reads

**Sections:** D1, 4.3, 5.2, 12.3, 15–16; before enabling display edits.

Evidence uses original prose and books/audio use effective wording, but future generation/review/recall have no declared source. Retained V4 is not a complete answer: it kept original canonical revisions while its writing service read a display-projected manuscript. Reusing those components can reproduce a split between remembered evidence and supplied recent prose.

**Add to D1:**

> D1 acceptance includes the source policy, not only permission to show an editor. Recommended initial policy: original canonical narration plus effective authoritative corrections feed future story generation, fact retrieval and evidence; effective display overlays feed ordinary reading, books and audio. Copyediting changes edition wording, not remembered events. Label that limitation when editing and preserve a source manifest for each artifact. A change of identity, action, knowledge, promise or outcome uses the explicit correction/fork workflow instead. Later use of copyedited text as presentation-only model context requires an explicit documented policy and tests; it must not enter as fresh canonical evidence by accident. No local validator can prove that arbitrary wording edits preserve meaning.

This is a proposed D1 choice, not an existing rule or blocker to core recovery. If the stakeholder chooses effective prose for future stylistic continuity instead, document the two authorities and unresolved semantic risk explicitly; do not leave an implicit blend.

**Acceptance additions:**

- A punctuation edit changes rendered/book/audio hashes and creates the appropriate new edition, while prior audio/book snapshots and original evidence remain valid.
- A semantic edit attempting to change a refusal into agreement does not change facts, challenge outcomes, future narrator authority or the sibling path. The UI offers correction/fork rather than implying the edit repaired canon.
- A fork before the edit has no overlay. Save-copy remaps overlays and original evidence without silently changing either source.
- Reader-facing change/evidence links explain why a displayed sentence may differ from its original supporting quotation.

**Source:** [retained display-only copyedit](../../../backend/src/modules/stories/revisions.js#L248); [retained writing reads projected pages](../../../backend/src/modules/writing/service.js#L41); [display projection](../../../backend/src/db.js#L1535).

## N6 — Medium: replace the arbitrary four-turn quiet rule with category fairness

**Sections:** 12.4, 20.1; before B3.

Fixing promise starvation is necessary. A universal quiet deadline is a weak substitute for narrative rhythm: a chase and a restful conversation should not receive the same turn recipe, and commitment acknowledgement can itself be quiet. The guide already names these as proposed opportunities; retain that precision.

**Replace the four-Follow sentence with:**

> Schedule eligible opportunity categories independently of the number of facts in each category. In a neutral reflective scene, a queue containing many equivalent promises must not crowd out an eligible quiet/connection opportunity merely because each promise has a different identity. Use a bounded scheduling round with one nomination per eligible category before repeating that category for another equivalent target. Eligibility and explicit urgency/focus can defer a category; record the reason and do not infer urgency from the mere existence or age of an open goal. This is a fairness rule for suggestions, not a prescribed mood cycle or evidence that quiet was delivered.

**Acceptance additions:** compare otherwise identical neutral fixtures with one, three and twelve promises, including input-order permutations. An eligible quiet category receives consideration in the same category round; changing promise cardinality cannot postpone it indefinitely. An established immediate danger can defer quiet without introducing a new danger to justify the deferral. A chosen quiet proposal does not set a “quiet achieved” flag or fulfil any fact.

**Source:** [current promise-first selection and two-record cooldown](../../../backend/src/modules/fiction/director.js#L5).

## N7 — Medium: length defaults and long-memory acceptance need calibration, not implied literary guarantees

**Sections:** 12.1, 12.3, 20.3; before B3 acceptance.

The three presets are reasonable starting values, not evidenced ideal lengths. The advanced floor of 100 also narrows retained V4's 50–2,000 range without an identified benefit. Larger scene targets do not solve long-form continuity unless old consequences are actually selected. “Completed consequential events” needs an identified existing source rather than a second invented memory authority.

**Replacement/addition:**

> Treat 180/400/800 as initial calibration targets, stored in a versioned preset definition and assessed in complete-scene journeys. Preserve a 50–2,000 advanced range initially. Existing stories retain a labelled legacy target policy until deliberately changed; changing pacing thereafter does not reset the chosen length. Language-specific length measures must be described honestly rather than treating whitespace counts as universal words.
>
> The completed-event/context category draws from accepted immutable changes and explicitly labelled beat/scene summaries linked to original passages. Summaries and rebuildable checkpoints are lossy navigation aids, not independent canon or sole evidence of an outcome. Current-scene circumstances and open obligations can select evidence by stable cast/fact/scene identities as well as lexical relevance. Never require the reader to remember the exact wording of an old promise to make it retrievable. Indexes/checkpoints preserve source versions and remain rebuildable from the graph.

**Acceptance additions:** in long fixtures, place a still-relevant promise and a completed consequential event outside both the 128-fact working set and the recent-prose window. Retrieve them through the involved cast/current scene with no copied wording in the direction. Include corrected, retired, resolved and sibling versions; the selected manifest must contain only the effective ancestral sources. Add more than twelve local/configuration/Ask records after the last scene and verify that they do not displace the recent narrative window. Reopening a long work buys nothing and invents no new synopsis.

**Source:** [retained length range](../../../frontend/app/core/state.js#L21); [current working set and ancestry memory](../../../backend/src/modules/fiction/memory.js#L3); [current mixed recent-history window](../../../backend/src/modules/fiction/service.js#L24).

## N8 — Medium: narrative evaluation needs observable journey checkpoints and an honest release disposition

**Sections:** 19/B8, 20.2–20.4, 21; define before qualification.

The named journeys and rubric topics are good, but currently permit a few attractive passages to count as whole-story evidence. Mechanical fixture success and generation quality must have separate pass/fail meanings. The “Begin and follow” row should explicitly distinguish local creation/reading from the paid Continue action.

**Replace 20.4 with:**

> Define and retain complete test journeys, checkpoint facts, evaluated passage ranges and comparison conditions before evaluation. Use at least:
>
> - **The Drowned Bell:** no-avatar Follow; spoiler-safe Ask before discovery; fair clue and correct deduction; the fixed buyer/cause do not move; affection remains distinct from trust; a fork before disclosure has different reader/character knowledge; recorded resolution permits aftermath and a chosen ending.
> - **The Garden After Rain:** several outstanding promises; reflective ordinary activity; Jo's established refusal; sufficient new grounds for a quiet role; cooperation without compulsory leadership; a shared pause that may have no effects; a separate goal-free vignette that closes without false success.
> - **Six-person ensemble:** at least two complete scenes and an intentional perspective change; distinct speech, stable tense/language, correct presence/location/time; a consequence retrieved from beyond the working set; Inhabit/Act/Say/Release without invented owned decisions; deliberate Scribe/length changes that alter craft without rewriting events.
> - **Return and edition:** interruption followed by free recap/bookmark restore; old evidence and private planning inspection; optional copyedit under the chosen D1 policy; new versus frozen audio/book content; save-copy and fork retain the selected narrative and presentation sources.
>
> Deterministic acceptance blocks wrong-source effects, ancestry/privacy/control violations detectable from the protocol, silent paid dispatch, dropped history and inconsistent artifacts. A mocked narrator can establish those mechanisms, not prove that a live model generates coherent fiction.
>
> If separately authorized, evaluate live or authorized captured sequences with fixed model/settings, declared directions and bounded spending. Read whole scenes and transitions, not selected highlights. Record any protected-truth change, spoiler in Ask, invented owned content, false completion or adjudication contradiction as a critical semantic failure requiring investigation. Rate literary qualities separately with concrete examples: causal continuity, particularity of place/action, distinct dialogue, stable perspective, meaningful quiet, varied rhythm, appropriate stopping and fidelity to direction. Record evaluator disagreement and mixed results. Define comparison and acceptance thresholds before seeing candidates; do not claim a baseline superiority result without comparable evidence.
>
> If live evaluation remains unauthorized or unavailable, record “live narrative quality not evaluated” alongside completed mechanical/visual evidence. Do not describe mocked fixtures, extra reviewers or a quality-mode approval as empirical story-quality certification.

**Acceptance additions:** a journey record identifies all evaluated passages and checkpoint state, critical failures, literary observations, model/settings where applicable, cost/latency and authorization status. “A quiet passage has no durable effect” is a valid result, not a failed progress criterion. Creating a local custom situation and reading saved passages cost nothing; an explicit Continue purchases the reviewed narration plan.

## Sound parts to preserve during integration

- Separate scene, episode, editorial grouping and device pagination. Do not regress to one generated page equalling all four.
- Keep Scribe persona, prose voice, provider model and speech voice distinct; existing studios and art/export surfaces are already implemented.
- Preserve the single graph, independent play styles, optional Inhabit, local recaps and no absent-time progression.
- Keep narrative-only context, explicit ancestry, immutable original evidence and candid semantic limitations.
- Keep Off and optional quality ceilings unchanged. Richer context and better literary controls do not require additional agents or mandatory calls.
- Keep explicit D1/D2 gates and local-only core journeys. Do not import old databases or enable retired APIs to speed up the restoration.
- Keep frozen audio/publication editions, explicit segmentation purchases and the prohibition on recursive hidden speech retries.

## Genuine decisions and minor corrections

- **D1:** decide both whether bounded wording edits are included and their future-generation source policy. Core B1–B3 work does not depend on accepting copyediting.
- **Recommended narrative policy, reviewable in this guide:** a submitted utterance must have occurred in the accepted fictional turn before it becomes an uttered promise. This avoids a hidden speech event and should be made explicit rather than deferred to each developer.
- **Calibration, not a new stakeholder approval gate:** preset values, scheduling implementation details and device/query budgets can be refined from declared fixtures and measurements.
- Section 4.3 says “24-character selection bound”; replace with “24 cast members.”
- Sections 20.2 and 21 should keep local/no-provider work distinct from a promise of new manually authored fiction; D1 does not implicitly authorize handwritten openings or a complete authoring mode.

Review complete. No blocker to the coordinator integrating these changes; no further work is running. Ready for the requested final consistency pass on the refined guide.

## Final consistency pass — refined draft 0.2

Read the complete refined guide and roundtable disposition. The integrated N1–N8 remedies are coherent. D1's effective-wording presentation category is an accurately specified alternative to my original-only recommendation: it is gated, preserves original facts/knowledge/evidence, and openly retains the possibility of model confusion. Agreement with that documented choice does not certify meaning preservation or live narrative quality. I do not require unanimity or a return to original-only context.

**One material remaining issue — medium, section 12.4, before the version-2 Say protocol ships:** the new rule inserts speech unconditionally on any accepted Say turn. A character unable to speak, or interrupted before delivering the words, needs an accepted fictional outcome that preserves that circumstance without silently recording the utterance and its promise. This is distinct from a failed provider request. The exact-word rendering rule is useful, but should not make speech performance an exception to established truth and attempted-versus-completed outcomes.

**Exact remedy:** replace the unconditional Say-performance paragraph with:

> Say authorizes the exact submitted words; it does not guarantee successful delivery against established circumstances. The version-2 narration proposal distinguishes performed from prevented speech, with occurrence/prevention evidence and any binding application adjudication. On an accepted performed outcome, the application renders the authorized utterance once, attributed to its speaker, before the reaction. On an accepted prevented outcome, narration can describe the obstacle/attempt, but the application inserts no performed utterance and creates no uttered commitment. Failed/interrupted requests commit neither outcome. The final combined text is bounded and reviewed where selected, and is the shared source for reading, occurrence evidence, books and audio. Performing speech does not itself prove that anyone heard, understood, believed or agreed to it; those effects need their own narrated support. Act remains attempted intent. Source/op checks are structural; correct classification of performance and duplicate/paraphrased owned speech remain semantic evaluation cases, not a new proof or extra mandatory call.

**Required acceptance cases:** an accepted prevented-speech turn adds no utterance/promise; an accepted performed turn places the exact authorized words in the same final text consumed by validation/review/reader/book/audio; a whispered or unheard statement does not grant blanket audience knowledge or cooperation. Add inability/interruption cases to the ensemble journey and the existing v2 source/save round-trip fixtures. Include the performance shape in the already required stage budget and serializer slice.

After that narrow correction, I find no remaining planning-blocking narrative/source contradiction. D1 still requires its recorded product acceptance; live literary quality remains unevaluated without separately authorized evidence. This final pass is complete, with no application changes or paid calls and no work continuing.
