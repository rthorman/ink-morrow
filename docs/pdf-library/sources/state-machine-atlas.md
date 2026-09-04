# State Machine & Invariant Atlas

<div class="frontmatter">

Read each entry as trigger, guard, transition, persistence and failure consequence. A UI success message is not authority: database state and the reviewed purchase boundary are.

</div>

## Conventions and terminal outcomes

Local means no model request. It can still need the local server and can fail
because of access, validation, stale revision or storage. Paid means transport
may incur a provider charge even if no scene is accepted.

A request is not a beat. Several quality calls may produce one accepted beat;
zero accepted beats may still carry charges. Reader prose, private state, call
metadata and provider output are distinct records.

The common successful sequence is intent, expected revision, durable request,
reviewed dispatch, validated proposal, stale check and atomic commit. The common
failure sequence preserves the old head and records known/unknown spend.
A successful replay returns a prior result; it is not another transition.

Snapshot changes are immutable history. Correcting, retiring, changing a
preference or taking a role appends state rather than editing past prose.
Rewind creates a new path. It is not destructive truncation.

Tests should assert both what changed and what did not: path head, revision,
cast ownership, provider call count, private projection and billing.
A passed happy path alone cannot prove at-most-once behaviour under races.

## Start, continue and clarify

| Trigger | Guard | Durable result |
|---|---|---|
| Start own situation | Valid title/premise/cast/preferences | New game/path, no paid prose |
| Start curated situation | Known scenario and valid additions | Authored opening, cast and initial facts |
| Follow | Active episode, current revision, available reviewed plan | One accepted narrated beat |
| Steer | Valid direction and scope | Beat; ongoing focus only when explicitly selected |
| Ask | Valid outside-story question | Clarification, no fictional scene advancement |
| Submit raw opening prose | Production route rejects the field | No game created |

A pending purchase blocks conflicting local mutations. Invalid input fails before
dispatch. If the selected role is unavailable, the game does not silently choose
a different model. A draft response must pass structural validation even when
quality is Off.

Ask is still a paid response, but cannot invent an in-world event, grant a
challenge, increment the fourth-wall scene cooldown or resolve an episode goal.
It is not a hidden-solution endpoint.

Neither starting a story nor reading its existing opening starts a provider call.
There is no speculative successor waiting behind Continue. Busy feedback names
actual work rather than disguising a second background purchase.

## Character control and local correction

Inhabit validates a current cast identity and appends a handoff snapshot.
Act and Say require that explicit control. Release appends a return to
reader-director. None purchases text by itself or replaces the story graph.

Generated effects cannot choose an inhabited person's speech, commitments,
decisions or inner relationship expectations. A proposed interaction can leave
a choice for the player. Structural guards do not prove every prose sentence
respects that ownership; model evaluation remains necessary.

Correction validates an existing public fact or a new fact and a reason, then
records an authoritative local change. Earlier prose remains intact. Retirement
removes a fact from future retrieval on this path while preserving historical
evidence. Neither operation is a memory quota maintenance chore.

A correction and an alternate choice are different transitions. Fix a record
that is wrong; fork when exploring another possible history. Local changes do not
manufacture narrated payoff simply by marking a goal complete.

Reader evidence omits private reasons. A source link must point to a real ancestor,
not a future beat or another path. Import remaps the same constraint to fresh IDs.

## Path creation and selection

Explore an alternative selects an exact current or earlier moment, checks
revision and idle state, then creates a named branch at that snapshot.
Rewind uses the same mechanism and preserves the original path.

Selecting an existing branch checks its game ownership and current revision,
then changes active selection. Facts, knowledge, resources, commitments,
relationships, quality, play style, fourth-wall cooldown, focus, control,
episode and placements come from that branch's state.

No branch merge is implied. A promise made after the fork on one side is absent
from the other. A reader page outside current ancestry cannot be used as evidence
merely because it exists elsewhere in the same story.

At most 40 paths are supported. A limit or stale-revision failure creates no
partial path and retains the dialog draft. Refresh before choosing again;
never recover a failed local fork by buying narration.

A pending paid request prevents a branch change from becoming a hidden target
switch. A late response rechecks exact path and revision before commit. UI route
fencing independently prevents an old response from painting another screen.

## Provider assignment, vault and consent

A role assignment names profile and model. Saving it is local and does not
validate quality by buying a completion. Catalogue browsing is a provider read.
An unavailable saved model remains unavailable until deliberately repaired.

Session credentials exist in process memory. Vault storage encrypts credentials
under a data key wrapped from the owner password. Login can unlock; lock,
terminal reset and process disposal remove plaintext access. A remembered browser
session after restart does not itself decrypt the vault.

Ordinary paid consent is remembered on the device. Expanded quality uses a
separate identity derived from the complete role/provider/model plan and call
ceiling. Neither is a substitute for auth, CSRF or the server's revision checks.

A changed plan invalidates purchase authority. Missing memory support cannot be
silently omitted from Both. A transport failure does not authorise retry, and
a quality rejection does not earn a second repair.

Imported saves contain preferences and aggregate spend, not credentials,
consent, call IDs or request keys. Import therefore cannot resume a purchase or
authorise a new one. Free local repeated rulings remain independent of provider
and quality availability.

## Authentication and database startup

Static boot is gated. Status resolves setup-needed, locked or unlocked.
Setup requires a terminal code and valid password. Login creates an opaque
session, its digest is stored, and mutations require the session CSRF token.
Lock revokes one session; password change revokes the others.

Private API guards run before body parsing. Before unlock, even a large body
cannot become an import, upload or generation job. Production auth is explicit
in server.js and cannot be disabled by NODE_ENV=test.

Database startup resolves one file, inspects a private scratch copy of existing
database/journals, validates family/version/ledger/integrity, and only then
opens the original for normal WAL and transactional migration. Failure cleans
only private scratch space, not source data.

Missing/empty source plus orphan journals is rejected. Existing old-family,
unknown, corrupt or future databases are not adopted. An accepted 5.0 migration
is contiguous and transactional; failure leaves the prior valid version.

After startup, abandoned model requests become interrupted. Their already
dispatched uncertain calls remain unknown-cost, not free. No background
continuity rebuild, old image queue or retired share service starts.

## UI states and regression traces

| UI state | Allowed action | Required protection |
|---|---|---|
| Loading local data | Wait, leave view | Immediate status; late-result fencing |
| Editing a draft | Edit, cancel, choose input kind | No purchase while typing |
| Reviewing purchase | Confirm or cancel | Duplicate review guard; retain draft |
| Submitting | Read busy/progress state | No second paid POST |
| Failed | Inspect error, free refresh | No automatic paid retry |
| Locked | Unlock only | Clear private DOM/state and stale callbacks |
| Ended episode | Read or begin another | No forced continuation |

For any network mutation, delay its response, navigate elsewhere, then resolve
it. Assert both server accounting and absence of stale UI mutation. Repeat with
Lock and a second tab's revision change. Test cancellation before dispatch and
failure after a known charge separately.

For uploads/imports, inject validation and transaction failures and inspect
staged-file cleanup. For paths and evidence, test sibling/future references.
For every optional quality plan, enumerate its maximum calls and the one-repair
budget. A passing reviewer must not bypass deterministic state guards.

Use the real production composer without legacyEnabled for boundary tests.
Old module fixtures may opt into the retired seam explicitly; their passing
tests do not demonstrate that the writing suite is exposed in 5.0.

## Optional quality transitions

Off: dispatch draft → validate → commit or fail. Enabled: dispatch draft → validate
→ selected review(s) → commit if approved. An evidenced rejection permits one
repair → validate → all selected reviews → commit or fail. An invalid initial
draft can consume the same sole repair before review. Invalid reviewer output,
transport failure, stale state or changed provider configuration terminates work;
none grants another call. One reviewer caps at four total calls, both at six.

Each call moves pending → completed or failed; restart moves pending → interrupted.
A late completion may replace interrupted billing uncertainty but cannot reactivate
the parent request or append a scene. Dispatched unknown costs are not zero. Known
charges remain counted when another call lacks a price. A parent with call rows
is excluded from the parent-only spend sum. Exactly one accepted beat and state
snapshot commit, regardless of how many draft/review calls were bought.

An unchanged challenge ruling takes its local zero-call path before provider or
quality availability checks. Successful idempotency replay also buys nothing.
Quality consent is scoped to the server plan; old one-call consent and saved
story data cannot authorise an expanded purchase.

## People and episode transitions

Relationship development: quoted passage/input evidence → existing relationship
identity → ownership check → new description with unchanged aspect, people and
visibility → immutable change with prior provenance. World-fact replacement is
not a develop transition. Affection does not imply trust or cooperation.

Episode opening → public developments → narrated resolution of its recorded goals
→ payoff → subsequent aftermath. These are descriptive opportunities, not forced
story beats. No transition ends the episode: the player explicitly ends it or
starts the next one. Quiet turns and local goal corrections do not fabricate a
payoff. Rewind restores the earlier snapshot; saves remap payoff evidence and
reject missing, cross-path or non-scene payoff references.

Catch me up → public current-path read → bounded existing summaries and records.
There is no purchased recap, autonomous absence step or simulated offline progress.
Failed path/episode writes retain their local dialog drafts and create no new path.

## Fourth-wall transitions

Local preference change → snapshot the Never/Rarely/Freely choice, leaving the
last-address index intact. Narration → compute permission from play style,
participation, eligible non-inhabited cast and scene gap → validate optional aside
→ append named address and updated index with the complete scene. Rarely permits
at most one structured address in six narrated scenes. Failed, stale, Ask and free
repeat operations cannot advance the cooldown. No timer runs while away.

A forbidden address fails the response without partial prose or state; actual
provider spend remains recorded. Rewind restores the earlier index; save import
validates it against scene count and preserves it in the new copy. An aside is
neither world-state evidence nor a new source of challenge authority.

## Influence transitions

Invitation selection -> editable direction only, no request. Moment Steer -> one
response, unchanged ongoing focus. Ongoing Steer -> validated response and focus
change in one commit. Failure/cancel -> retained draft and scope, unchanged focus.
Clear focus -> explicit local preference snapshot. Rewind restores the prior focus
and style. Acting, speaking and asking cannot set an ongoing editorial focus.

Challenge review -> local comparison at expected revision -> either ordinary paid
consent or reuse of the recorded ruling. A changed revision fails before dispatch.
Source navigation -> current-ancestry check -> reader-safe beat, never a private
state snapshot. Prior evidence references cannot point to a future or sibling path.

## Resistance and memory transitions

Explicit approach: validate intent and challenge -> resolve requirements against
current-ancestry facts -> determine outcome and stable basis. An unchanged prior
decision -> local clarification, zero provider attempts, unchanged fictional scene
count. New grounds -> one reviewed narration -> check returned outcome/evidence ->
atomic prose, state, adjudication and usage. Wrong structured outcomes fail without
a partial commit; known charges remain. Grants remain recorded after later changes
to the grounds; rewind restores the previous decision set rather than rerolling it.

Facts: append evidence -> keep immutable change -> retain a bounded working set.
Historical retrieval chooses the latest fact version on the active ancestry.
Correction supersedes; retirement hides from retrieval; neither deletes history.
Forks cannot retrieve a sibling's future. Saves preserve challenge definitions and
adjudication evidence, validate ancestry and remap moment identities on import.

## Illustrated-path and save transitions

Local upload: validate target -> normalize raster -> stage private file -> append
placement snapshot and asset metadata atomically. Failure before commit removes
only the staged file. Describe/remove appends another snapshot; no prose is edited.
Fork/rewind restores the exact placement set at that moment. Historical assets stay.

Paid painting: journal pending -> check reviewed Illustrator -> mark dispatched ->
one provider attempt -> validate raster -> compare revision/path -> atomically save
asset, placement and terminal usage. Failure/interruption retains known or unknown
spend and never retries. Completed keys replay for free even after path changes.

Save: idle story -> complete graph/media snapshot -> bounded gzip file. Import:
bounded decompression -> strict graph/media validation -> read-only preview ->
explicit copy -> stage new media -> single deferred-FK transaction -> new story.
Rollback removes its staged files, never original data. Imported aggregate spend is
terminal; request keys, credentials and consent do not travel. Books are a separate
read-only active-path projection, with EPUB image-only spine pages before text.

Catalogue creation/editing: validate typed fields -> compare expected revision ->
require idle entry -> save metadata and increment revision. No provider call.
Upload follows raster normalization and stale recheck; replacement cleans only the
previous catalogue image after commit. Catalogue deletion scrubs content and removes
its owned image but preserves image accounting. Frozen story copies are not targets.

Catalogue painting uses its own pending/succeeded/failed/interrupted journal, one
pending request per entry and one dispatch per key. A changed provider or revision
refuses attachment. Restart marks pending work interrupted; a late completion can
settle its known cost but cannot make the image current. There is no silent retry.

Setup selection freezes world, Scribe and character references, copies normalized
images to fresh story-owned identities and commits the graph atomically. Story cover
and reference updates append path-local snapshots through the story request journal.
Saves validate/remap every visual asset reference. Covers enter books; other reference
art remains private. Images do not create facts, knowledge or cast control.
