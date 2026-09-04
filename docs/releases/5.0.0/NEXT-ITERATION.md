# Next 5.0 iteration: agency, resistance and payoff

Date: 4 September 2026.
Latest direction: add a Living-world setting allowing characters to break the
fourth wall Never, Rarely or Freely. The owner briefly cancelled final main
integration, then restored approval after implementation is complete and CI is
green. Complete the new setting and the remaining programme before that merge.
The owner subsequently accepted the possibility of additional LLM calls when
they improve character and world consistency. Assess a bounded consistency-review
and repair mode before release, with explicit maximum calls, latency/cost review,
full spend accounting and fail-closed handling of stale or rejected results.
The owner selected an optional quality mode, not checks enabled by default. This
may use the standard story model, the memory-support model, or both; permission
is not restricted to one role. Review must name each role/model and the maximum
number of calls, with no silent role substitution or hidden background purchase.
This supersedes an unconditional one-call-only design, not the ban on unbounded retries
or the need to demonstrate benefit. It does not authorise a live paid benchmark.

Status: owner approved implementation and green-CI merges, including final main
integration, on 4 September 2026. Implementation is in progress; approval is not
a claim that the features are already complete.

## Objective and decision status

Make InkMorrow a game about understanding people and shaping possibilities,
not about supplying increasingly elaborate prompts. Improve dependable influence,
character development and narrative payoff before expanding the feature catalogue.

The owner selected **both clear play styles** when asked whether the world should
resist player direction, and requested that the royal-guard/repeated-persuasion
problem enter the considerations and model-choice manual guidance. Those are
recorded product directions. The mechanisms and PR scope below were subsequently
approved for implementation. Delivery still requires the verification described
below; approval is not evidence of implementation or model suitability.

Existing decisions remain: reader-director outside the cast by default; Inhabit
optional; no manual prose authoring; quiet play and stopping are valid; no offline
punishment; explicit paid authority; branch-local history; private saves separate
from published books. Reader illustrations remain above text, and EPUB illustrations
remain separate pages immediately before their text. No 4.x data compatibility is
required, and historical user data must remain untouched.

## Optional quality implementation contract

Quality is Off by default and selected per path. Standard review uses the
storyteller for both drafting and character/world review; Memory review uses the
separate memory-support role for continuity/knowledge checks; Both uses both.
An accepted first draft takes one, two or three calls respectively. One reviewer
allows at most four total calls and Both at most six, including a single repair
and reviews of the replacement. Review rejection cannot silently commit a draft.

The browser reviews every selected role/provider/model and the server verifies
the plan identity before dispatch. Earlier single-call consent cannot authorise
quality mode. No transport retry, background continuation or silent role fallback
is allowed. Durable per-call billing preserves known partial charges and unknown
later attempts through rejection, staleness and restart. Unchanged challenge
rulings and successful request replay still take zero-call paths first.

Protocol and browser fixtures establish these boundaries, not measured improvement
in real-model character consistency. No live paid benchmark has been authorised.

## Findings before this iteration (historical design input)

- `backend/src/modules/fiction/service.js` supplies narrator instructions about
  independent motives, hidden knowledge and control boundaries. Structured-effect
  validation does not prove the semantic consistency of generated prose.
- Every Steer currently becomes persistent focus. One-moment direction and an
  ongoing preference are not distinct inputs.
- `backend/src/modules/fiction/model.js` caps current durable facts at 128;
  resolved facts still occupy slots. The failure guidance can ask players to
  retire facts. Generation selects up to 32 facts, rather than using a dedicated
  protected-truth and historical-retrieval policy.
- The director selects a next-scene pattern with recent-history cooldowns. It is
  not a complete episode-arc system. Episodes currently end by player action.
- The reader already includes optional "What changed" disclosures. Improve their
  causal usefulness instead of duplicating them or claiming feedback is absent.
- The two curated openings, The Drowned Bell and The Garden After Rain, provide
  contrasting foundations for testing discovery, family conflict and quiet care.

These are source-inspection findings, not results from human playtests or an
InkMorrow-specific model comparison. The development checkout is not evidence
that the same features are deployed on port 3000.

## Play-style contract

**Story-shaping:** the player's desired developments normally guide the outcome,
within content boundaries, explicit character ownership and established continuity.
Accommodating a requested development is intentional here, not automatically a
resistance failure. Rewriting established truth remains an explicit correction or
alternative path, not a silent convenience.

**Living-world:** the player's intention is respected, but success is not promised.
Characters and circumstances may resist for established, intelligible reasons.
Reader-director interventions can set attention and propose attempts without
silently acquiring authority to dictate disputed outcomes.

These styles are independent of Follow/Steer/Inhabit and of gentle/dramatic
consequences. Cozy cooperation can involve firm disagreement; an intentionally
shaped tragedy can be dramatic without challenging the player's authority.
The proposed default is Story-shaping to preserve familiar Steer expectations;
this default is a recommendation, not an owner decision. Make Living-world easy
to select without a mandatory setup wizard. Style changes affect future play,
are recorded on the current path, and restore correctly on rewind and import.

## Fair resistance, not conversational endurance

The guard should not open the treasury merely because the same request has been
repeated. Nor should the guard refuse a valid royal warrant just to seem difficult.
Relevant evidence, authority, leverage, changed circumstances or a genuinely
different offer can justify reconsideration. Rephrasing alone is not new leverage.
Repeated attempts must not create unlimited independent rerolls of one unchanged
obstacle. Persistence may matter where the fiction supports it, but must not
automatically trigger punishment or escalation.

Separate persuading a character from instructing the narrator to surrender an
outcome. In Living-world play, quoted instructions, invented permissions and
"the guard already agreed" assertions are proposals or claims, not authoritative
state. Correction and accessibility controls stay outside this contest and remain
available without in-world penalty. No anti-cheat system is needed for a private
single-player game; this is about maintaining the selected play contract.

Proposed implementation principles:

- Record consequential obstacles, established constraints, relevant evidence,
  previous adjudications and the state against which they were made.
- Let models interpret natural language and propose developments. The application
  owns protected facts, permitted transitions and any actual random resolution.
  Approved outcomes must agree with both the prose and committed state.
- Reuse an unchanged adjudication when no relevant grounds have changed; do not
  freeze an entire conversation or treat fuzzy text similarity as sufficient proof
  that two strategies are equivalent.
- Keep refusal explanations reader-safe: they must not expose a secret merely to
  explain a decision. A character's claim and actual world truth are different.
- Represent important constraints explicitly. Do not claim that a second model
  judging the first, a larger prompt, low temperature or a premium model provides
  a deterministic guarantee for unrestricted natural-language situations.
- Preserve the one-request/no-automatic-paid-retry principle. If stronger
  adjudication requires additional paid work, its authority, cost and failure
  behaviour require explicit design review before implementation.

Open semantic interpretation cannot be made fully reliable by a finite ruleset.
Scope and disclose support honestly. A model may sound persuaded without the
application granting access; this prose/state disagreement is still a game defect,
not a successful defence. Avoid buying repeated repair attempts automatically.

## Proposed substantial PR sequence

### A. Trustworthy world state and fair resistance

Add the branch-local play-style and adjudication foundations. Separate permanent
history from bounded active memory, with retrieval of relevant past events and
protection for key commitments and fixed hidden truths. Resolve or archive working
entries without deleting historical evidence or transferring state between paths.
Do not solve long-play limits by making the player maintain a memory database.

Cover reload, fork, rewind, save/import, stale replies, concurrent requests and
cost accounting for every new state element. Build the resistance evaluation
harness with scripted fixtures and optional, explicitly authorised live-model runs.
Preserve compact contexts; no whole-history prompts or per-character background
simulation. This foundation should precede marketing a robust resistance mode.

### B. Clear influence and readable consequences

Expose the two styles with concrete examples. Distinguish "this moment" from
"keep this focus" and make ongoing direction visible and releasable. Offer a few
optional, distinct contextual invitations when useful, while preserving free text
and uninterrupted Follow. Invitations must not leak secrets, control an inhabited
character or promise an outcome the engine cannot support.

Extend the existing change disclosures with truthful connections to prior events.
Prefer consequences expressed in the fiction; avoid fake choice acknowledgements,
mandatory choice menus after every passage, and numeric relationship meters as a
default. Derive suggestions locally or within an already authorised response;
passive reading must not trigger extra purchases. Maintain immediate feedback,
keyboard access, reduced-motion behaviour and mobile reflow.

### C. People, complete episodes and returning to play

Develop compact character motivations and relationship changes grounded in
recorded experiences. Affection, trust and willingness to cooperate need not move
together. Update important character expectations only when events justify it;
avoid an ever-growing biography or autonomous NPC work queue.

Give episodes an organising question and opportunities for development, payoff
and aftermath, without forcing a fixed plot or cliffhanger. The player can linger,
change direction, stop early or continue. Turn the existing mystery and garden
openings into contrasting complete playable experiences before adding more genres.
Offer bounded, spoiler-safe return recaps from existing records without a paid
background request. No compulsory avatar or hand-written prose is introduced.

The existing fresh-storage/version cutover and final release hardening remain
necessary, separate work. If this iteration is approved for 5.0, integrate these
substantial PRs before final acceptance and the final six-book release edition.
Each feature PR must also update affected book sources and regenerate all six
PDFs under the existing documentation contract; documentation is not deferred
wholesale to the last PR. Target `release/5.0.0`, merge only the tested green head,
and base the next batch on that updated branch. Do not reopen shipped historical
PRs. The owner has approved a final green release PR into main after completion;
deployment or starting the replacement server remains a separate action. The old
port-3000 instance was stopped at the owner's explicit request.

## Evaluation and acceptance proposal

Automated fixtures should cover at least:

- Repeated pleading and paraphrases without new grounds: no unjustified treasury
  access and no fresh chance from mere repetition.
- Credible new evidence or sufficient authority: reconsideration is possible;
  an invalid or forged claim is not silently promoted to verified authority.
- Attempts to instruct the narrator, invent prior agreement, extract hidden truth
  or speak for an unowned character: protected state and control remain intact.
- Social situations with more than one reasonable resolution, including genuine
  persuasion, partial cooperation and an intelligible refusal.
- The same intent under both styles: intentional accommodation is evaluated
  against that style's contract, not misclassified as universal failure.
- Long interactions, changing focus, new episodes, reload, forks and imported
  saves: relevant commitments, knowledge and prior adjudications remain coherent.
- Conflicting prose/effects, malformed output and late responses: no partial
  state, unaccounted spend or automatic paid repair chain.

Report unjustified capitulation AND unjustified stubbornness. Also measure
contradictions, secret leakage, control violations, prose/state disagreement,
invalid-response frequency, latency and cost. Compare like-for-like fixtures,
record the exact model identifier/settings/date, and repeat stochastic cases.
Use human review with explicit rubrics for semantic outcomes, not only another
model's verdict. "No failures observed" is not "immune to persuasion."

Deterministic security/state invariants must pass their automated tests. Proposed
model-suitability thresholds should be set after establishing a baseline, before
selecting winners; no model is currently certified by this proposal. Include
realistic inexpensive models, not just the strongest available configuration.
No live paid benchmark is authorised merely by recording this plan.

Conduct a small formative playtest with readers and narrative-game players across
both styles. Ask whether they understood their influence, recognised a consequence,
cared about a character, encountered fair surprise, and could stop satisfied and
return without confusion. Record repair burden. A small exploratory sample is
not statistical proof, and optional research logging must not collect private
story content without consent. Do not optimise primarily for time played, tokens
generated, purchases or compulsive return.

## Documentation requirements

The User Guide needs a task-oriented "Choosing a storyteller for your play style"
section. Explain that prose quality, speed, price, continuity and resistance are
different qualities. Larger/newer/costlier is not a reliable suitability ranking.
Use the guard example, including a justified change of mind, and distinguish
character persuasion from narrator instructions and explicit world correction.
Describe measured limitations and date model recommendations. Separate durable
selection advice from a versioned evaluation report that can be refreshed.

Suggested wording, to adapt to the actually shipped implementation:

> In Living-world play, characters may refuse and plans may fail. Models differ
> in how consistently they maintain these boundaries over long conversations.
> Some may become too accommodating when repeatedly challenged. Prefer a model
> tested for character consistency and resistance; price and prose quality alone
> are not reliable guides. Genuine new evidence can still change an outcome.

Provide journeys using both styles and meaningful feature subsets, all with an
optional avatar and no manual prose authoring. Update the architecture and state
books for authority and memory, security for claims/knowledge/provider boundaries,
operations for recovery and model changes, and maintainer guidance for evaluation
and release gates. This proposal changes no runtime behaviour or shipped manual;
the six PDFs are not regenerated solely for a planning note.

## Evidence and its limits

Research supports hypotheses and evaluation choices, not a guarantee that these
features will improve this particular game:

- [Agency Reconsidered (2009)](https://dl.digra.org/index.php/dl/article/download/369/369/366)
  frames agency as a fit between desired actions, player expectations and the
  underlying computational model.
- [Foreseeing Meaningful Choices (2014)](https://cdn.aaai.org/ojs/12716/12716-52-16233-1-2-20201228.pdf)
  reports stronger perceived agency for choices with distinguishable situational
  outcomes in a specific text-game experiment; it does not prescribe a universal
  number of options or establish outcomes for InkMorrow.
- [A Motivational Model of Video Game Engagement (2010)](https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf)
  provides the autonomy, competence and relatedness lens. Interpreting those as
  influence, understanding and attachment here is a design hypothesis.
- [Tyack and Mekler (2024)](https://arxiv.org/abs/2405.12639)
  caution against shallow applications of self-determination theory in games.
- [Emily Short: Storylets (2019)](https://emshort.blog/2019/11/29/storylets-you-want-them/)
  is practitioner guidance on prerequisite/effect-based narrative composition,
  not an experimental demonstration of this proposal.
- [Generative Agents (2023)](https://arxiv.org/abs/2304.03442)
  finds contributions from memory, reflection and planning to agent believability;
  it does not establish that an expensive autonomous simulation makes a good game.
- [Challenging the Evaluator (EMNLP 2025)](https://aclanthology.org/2025.findings-emnlp.1222/)
  finds susceptibility to user rebuttals in judgment tasks. Applying that concern
  to NPC resistance is a reason to test, not a measured guard-exploit rate.
- [Microsoft human-AI interaction guidelines (2019)](https://www.microsoft.com/en-us/research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/?lang=fr_ca)
  support clear capability limits, correction and communication of consequences.
