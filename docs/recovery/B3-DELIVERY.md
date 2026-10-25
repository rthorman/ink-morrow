# B3 — creative depth on the playable-fiction graph

B3 implements the stakeholder-authorized creative-depth work package on current
V5 main. The public application stays **5.0.0**, family `ink-morrow-5`; storage
advances transactionally from schema 24 to **25**. No legacy runtime, production
database, deployment, server restart or live provider evaluation is involved.

## Delivered journeys

The authenticated Library retains complete world, character and Scribe studios,
images and reviewed AI development. AI results appear in a separate comparison
beside submitted seed, current fields and saved baseline. The owner accepts
selected fields, then saves explicitly. Field revision markers protect edits
made during the request, including text changed back to an identical seed.
Restore compares pre-acceptance fields and leaves later edits unchecked. Late or
uncertain development uses the existing durable AI journal; it never auto-saves
an entry or retries a purchase.

**Use in a new story / Add to this setup** copies reference selections into the
acknowledged setup draft while retaining title, premise, cast and other settings.
An outstanding creation receipt must be reviewed first. The shelf adds title/
premise search, genre filtering, explicit latest-moment entry, local rename and
free return recap, alongside ordinary reading-position resume.

Codex opens full **story-local world / character / Scribe** studios. Manual or
selected reusable-template fields become immutable story-owned revisions. Template
identity/revision is inert provenance; changing or deleting that template never
rewrites the story. A reference change establishes no fact, revelation, cast
transition or completed backstory event. Recorded truth wins. The editor shows
known overlaps and requires acknowledgement; this is not a semantic contradiction
solver. Up to 32 explicit current fact bindings per reference keep older relevant
constraints in narration context. Private motives and craft remain private.
Character reference names never rename the cast identity.

Creative settings include flexible/first-person/close-third/omniscient perspective,
explicit cast speaker or outside framing narrator, focal character, past/present,
prose language, genre description, tone, disclosure, voice, boundaries and focus.
A missing required speaker/focal identity can be kept as a private configuration,
but must be repaired before purchasing narration. Brief/developed/extended targets
are approximately 180/400/800 words or characters; custom targets run 50–2,000.
Pacing, length and reader pagination remain independent. New stories default to
developed; inherited stories retain deterministic legacy-short behavior. Existing
ongoing Steer focus remains effective and can be cleared deliberately.

An optional next-scene proposal names proposed place, time, cast presence, purpose
and notes. It is not established framing. Failed requests retain it; the next
accepted narrative scene consumes it. Only separately quoted ordinary narration
can establish actual circumstances. Ask does neither.

Campaign records adapt relationships, promises, debts, knowledge, secrets, goals,
factions, quests, conditions and inventory onto existing qualitative relationships,
commitments, facts, goals and numeric resources. The private editor supports
knowledge holders, actor/relationship target, visibility and actual goal outcome,
with declaration reason. Bounded search retrieves older records outside the working
snapshot. Public/historical Codex filters before paging; secrets require explicit
private planning. These sections do not claim separate faction, debt or inventory
simulation engines.

Chronicle supports optional open-ending, vignette or resolved-thread closures.
A resolved-thread closure requires an actually achieved recorded goal. End/start
buy no narration. Immediate undo appends a compensating record and is available
only before subsequent activity; it never deletes history or invents a payoff.

## Narration, truth and paid authority

`context-compiler.js` resolves ownership/application rules, recorded branch truth
and knowledge, current contribution, established scene, creative configuration,
Scribe craft and provisional opportunities in that order. Recent history follows
narrative links, so intervening Ask/local operations do not displace the prose
window. Full ordinary passages are retained; complete oldest passages may be
removed to fit, keeping the latest passage and binding authority. Selected older
fact bindings, foundational secrets, actor-relevant truth, obligations, resources
and actual outcomes augment the compact snapshot. Retrieval remains bounded; it
is not a promise that every historical sentence fits every model.

Before the first paid call, a free operation plan checks **every possible stage**:
draft, selected reviewers, one repair and re-review. Capacity comes from declared
provider catalogue metadata or explicit owner settings. Unknown capacity blocks
the affected purchase with Settings guidance; local reading/editing still work.
The counter is a conservative serialized UTF-8 byte bound plus protocol overhead,
not a tokenizer estimate. Model context/output limits, narration output allowance,
length, quality roles and selected references bind the reviewed consent. Whole
recent passages are trimmed before refusing; ownership/truth are never silently
dropped. Actual stages are checked again before dispatch. Reasoning allowance is
included in the reviewed ceiling; transport cannot silently enlarge output after
review or retry. Existing quality call ceilings remain Off 1, one reviewer 4,
Both 6. Oversized or invalid paid results retain their known/unknown charge and
cannot trigger an unreviewed extra call.

Narrative response version 2 distinguishes intention, attempt, reported claim and
occurred event. Submitted Steer/Ask wishes cannot prove world events. Act can
record an intention/attempt or explicitly owned personal claim, not its desired
external outcome. Goal dispositions distinguish achieved, abandoned, failed and
superseded; legacy unspecified resolution is never reclassified as achievement.
Quiet opportunities receive one eligible category nomination per round regardless
of whether one, three or twelve promises exist. Quiet/goal-free fiction remains
valid; no crisis, quest or payoff is compulsory.

Say requires performed, attempted, interrupted or not-performed status and exact
ordinary-narration evidence. Performed speech is assembled once from the owner's
unchanged words at a validated paragraph boundary, with attribution. The model
supplies reactions rather than rewriting the utterance. Other statuses insert no
speech. Source segments and hashes distinguish ordinary narration, inserted owned
speech and fourth-wall aside. Reviewers see the complete assembled candidate;
inserted speech and asides cannot masquerade as narrated occurrence evidence.
Version-1 model responses remain compatible, with conservative legacy claim labels;
new Say still requires an explicit occurrence outcome.

## Durability and portable closure

Migration 25 is an appended checksummed module. Migration 24 and `save-v1/` remain
unchanged. New immutable configuration/reference revisions have deferred producing
beat and parent links; snapshots carry only heads and a deterministic baseline.
Private drafts, local receipts/cancellation fences, expiring operation plans,
private context manifests and provider capacities have separate owners.

Story-local configuration/reference/campaign forms use server-acknowledged drafts
with optimistic revisions, target/base scope and explicit recovery. A local action
key is acknowledged before mutation. A missing response opens receipt inspection;
an unknown undispatched key can be fenced before reuse. Applying never silently
rebases stale fields. Earlier proposals can be compared and copied into a fresh
current-target private proposal, after reviewing any prior action. Lock clears
private DOM/controllers and fences late UI callbacks. Failed/offline draft writes
remain honestly unsaved; they are not promised to survive device loss.

Playable-save v2 adds optional `creative` version-1 collections for configurations,
references/bindings and narrative assemblies. Import remaps produced revision IDs,
scene-proposal/frame provenance and beat pointers while preserving prose bytes,
segment hashes and inert template provenance. Strict validation checks producing
beats, subject, ancestry, unchanged baselines, parent chains, reachability, complete
shapes, fact bindings at adoption, source assemblies and evidence closure. A
reference/configuration cannot smuggle canonical changes or silently change a
snapshot head. New precise sources cannot be omitted. Frozen v1 validation is used
only on a temporary structural projection; original historical JSON is retained.
Drafts, paid permissions, plans, provider credentials and capacities do not travel.
The 10,000-moment / 128 MiB expanded / 64 MiB packed save caps remain.

Genuine synthetic B2 preservation artifacts are `fixtures/recovery/schema-24.db`,
`baseline-24.json` and `save-b2-v2.inkmorrow5`, captured from main `070c4cb` before
schema 25 was written. Original schema-23/save-v1 fixtures remain unchanged.
Rollback/reopen tests cover interruption during migration 25 as well as migration
24, and ledger/beat bytes are compared rather than reconstructed from new code.

## Verification and acceptance limits

Local verification passed lint, setup safety, brand/release and deferred-PDF
integrity checks; the production dependency audit found no vulnerabilities.
Backend full regression passed 526 tests before the final secret-reveal/Say cases;
the expanded 24-case narrative-contract suite passed afterward. Frontend passed
333 tests. Desktop passed 51 browser journeys; five affected desktop journeys were
rerun after the mobile layout/restore changes. Mobile passed all 51 on the polished
interface, including a 440-pixel-high creative viewport and the reload-task race.
Final exact-head CI reruns the integrated suite, including the two added cases.

Synthetic Mobile Chrome screenshots were reviewed for the creative sheet,
campaign ledger and catalogue comparison. The footer was reduced to two actions,
checkboxes were aligned with their labels and fieldsets span the form grid:
[creative studio](../screenshots/recovery-b3/creative-studio.png),
[campaign records](../screenshots/recovery-b3/campaign-ledger.png),
[catalogue comparison](../screenshots/recovery-b3/character-catalogue-studio.png).
These are emulated-device artifacts, not a real Android acceptance session.


Focused contract tests cover migration preservation/rollback, branch-local immutable
revisions, source/shape rejection, compaction retrieval, Say outcomes and assembly,
goal dispositions, context preflight/expiry/capacity and opportunity cardinality.
Real browser journeys exercise the authenticated app with synthetic local data:
creative configuration, selected template adoption, reference bindings, campaign
records, episode closure/undo and existing Library/media/save workflows. Full lint,
setup, backend/frontend and desktop/mobile browser verification plus five exact-head
CI checks are required before main integration. Consult the PR checks for the
integrated head; this record does not substitute for them.

Mobile Chrome emulation is not an actual Android tablet/IME/rotation acceptance
session. Deterministic providers and mocked purchase endpoints do not establish
literary quality or model compliance in live fiction. Semantic reference conflicts
and real prose-length quality still need stakeholder evaluation. No live paid
benchmark or deployment acceptance is claimed.

All six **manual sources** are updated. At the stakeholder's explicit request,
PDF regeneration is deferred until the final recovery work package. Existing PDFs
are the B2 build; `update-policy.json` makes that status explicit and verifies their
last-built hashes instead of claiming source freshness. Remove the policy and
regenerate/inspect all six books at final completion.

B4 editorial organization is next. Optional prose editing (D1), V4 conversion (D2)
and image conditioning (D3) remain gated; B5 complete Gallery and B6 audio remain
later work. B3 does not activate any of them.
